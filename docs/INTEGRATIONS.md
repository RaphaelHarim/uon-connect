# Integrações

Cada integração é isolada: se estiver desligada ou indisponível, o restante da plataforma funciona, e a tela
**Administração → Integrações** mostra o estado real (não configurada / configurada / operacional / com erro).
Nenhuma credencial é configurada pela interface; tudo vem de variáveis de ambiente no servidor.

## 1. Microsoft Entra ID (login corporativo)

Estado: **implementado; depende de configuração externa** (não testado contra um tenant real neste ambiente —
não havia credenciais). As regras de validação de *claims* têm testes automatizados.

### Registro do aplicativo (feito por um administrador do Entra ID da UON)

1. Portal do Azure → **Microsoft Entra ID → Registros de aplicativo → Novo registro**.
   - Nome: `UON CONNECT`; Tipos de conta: **somente este diretório (single tenant)**.
   - URI de redirecionamento (Web): `https://<domínio>/api/v1/auth/entra/callback`
     (desenvolvimento: `http://localhost:5173/api/v1/auth/entra/callback`).
2. **Certificados e segredos → Novo segredo do cliente**. Guarde o valor (aparece uma vez) em um cofre.
3. **Configuração do token → Adicionar declaração opcional → ID**: `email`. (Opcional) **Adicionar declaração de
   grupos**: "Grupos atribuídos ao aplicativo" — evita *overage* de grupos.
4. **Permissões de API (delegadas)**: `openid`, `profile`, `email`, `offline_access`. Se usar as integrações
   abaixo, acrescente `User.Read`, `Calendars.Read` e/ou `OnlineMeetings.ReadWrite` e conceda **consentimento
   do administrador**.
5. (Recomendado) **Aplicativos empresariais → UON CONNECT → Propriedades → Atribuição necessária = Sim** e
   atribua os grupos autorizados. Acesso condicional/MFA conforme a política da UON.
6. Forneça à equipe de implantação: Tenant ID, Client ID, segredo, URIs. Preencha:

```
ENTRA_TENANT_ID=…   ENTRA_CLIENT_ID=…   ENTRA_CLIENT_SECRET=…
ENTRA_REDIRECT_URI=https://<domínio>/api/v1/auth/entra/callback
ENTRA_POST_LOGOUT_REDIRECT_URI=https://<domínio>/login
ENTRA_ALLOWED_EMAIL_DOMAINS=uongroup.com      # elegibilidade, nunca autorização
ENTRA_ALLOWED_GROUP_IDS=<guid1>,<guid2>       # opcional
```

### Comportamento

- Fluxo *authorization code* + PKCE (cliente confidencial), `state` e `nonce` de uso único (10 min).
- Validação de assinatura, emissor, audiência e expiração (biblioteca `openid-client`), mais: `tid` igual ao
  tenant configurado, presença de `oid`, domínio permitido, grupos permitidos (falha fechada em *overage*).
- Vínculo: por `oid`. No primeiro login, conta **pré-cadastrada** com o mesmo e-mail é associada
  (`ENTRA_LINK_BY_EMAIL`), sem nunca conceder funções. `ENTRA_AUTO_PROVISION=true` cria conta sem vínculos.
- Sair encerra a sessão local e redireciona para o logout do Entra ID.
- Verificação: Administração → Integrações → Entra ID → **Verificar** (faz o *discovery* OIDC).

## 2. Microsoft Graph — calendário do Outlook

Estado: **implementado; depende de configuração externa**. Testado com respostas simuladas da API Graph
(sucesso, 403 e ausência de conexão); não validado contra um tenant real.

- Variáveis: `GRAPH_CALENDAR_ENABLED=true`, `TOKEN_ENCRYPTION_KEY=$(openssl rand -base64 32)`.
- Permissão delegada `Calendars.Read`: cada pessoa vê **somente o próprio** calendário.
- Tokens do usuário são obtidos no login, guardados **cifrados** (AES-256-GCM) no banco e renovados com o
  *refresh token*; se a renovação falhar (consentimento revogado), o token é apagado e o usuário é avisado.
- Eventos são lidos sob demanda (`/me/calendarView`) e exibidos em **Reuniões**; **nada é copiado** para o UON CONNECT.

## 3. Microsoft Teams — reuniões online

Estado: **implementado; depende de configuração externa** (mesmo cliente Graph; testes com respostas simuladas).

- `GRAPH_TEAMS_MEETINGS_ENABLED=true`, permissão delegada `OnlineMeetings.ReadWrite`.
- Ao criar uma reunião escolhendo "Microsoft Teams", o servidor chama `POST /me/onlineMeetings` e guarda o link.
- Sem a configuração, a opção aparece desabilitada e a API responde 503 — não há "Teams de faz de conta".

## 4. SharePoint e OneDrive — avaliação (não implementado)

| | Armazenamento próprio (atual) | SharePoint/OneDrive via Graph |
| --- | --- | --- |
| Controle de acesso | Regras do UON CONNECT (chamado/conversa) aplicadas a cada download | Permissões do Microsoft 365; exigiria sincronizar membros de conversas/filas com permissões de arquivo |
| Retenção/eDiscovery | Política própria (a definir) e backup do volume | Políticas de retenção e eDiscovery do M365 já existentes |
| Custo | Disco/objeto storage do servidor | Incluído no licenciamento M365 (cota do tenant) |
| Complexidade | Baixa | Alta: permissões `Sites.Selected`/`Files.ReadWrite.All`, consentimento, tratamento de throttling |
| Risco | Cópia de documentos fora do M365 | Permissões amplas se mal configurado |

**Recomendação**: manter anexos operacionais (chamados e conversas) no armazenamento próprio e, numa fase
futura, permitir **referenciar** (link) documentos do SharePoint em vez de copiá-los, usando `Sites.Selected`
apenas para os sites aprovados. Nenhuma cópia automática foi implementada, conforme exigido, por falta de
política de acesso/retenção definida.

## 5. E-mail (SMTP)

Estado: **implementado; depende de configuração externa**. Testado com transporte simulado (conteúdo
verificado) e verificável com Mailpit local.

- `EMAIL_ENABLED=true`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`.
- Pode ser o SMTP do Microsoft 365 (conta de serviço com *SMTP AUTH* habilitado) ou um relay interno.
- Envio pela fila (`jobs`), com novas tentativas exponenciais (até 5). O e-mail contém apenas o **título** da
  notificação e um link — nunca o conteúdo de mensagens ou chamados.

## 6. TURN (chamadas de vídeo entre redes)

Estado: **implementado; depende de infraestrutura**. Sem TURN, chamadas funcionam na mesma rede/VPN e em
muitas redes domésticas, mas podem falhar atrás de NAT simétrico/firewall corporativo.

- coturn incluído em `docker-compose.prod.yml` (perfil `turn`). Libere UDP/TCP 3478 (e 5349 para TLS) e a
  faixa 49160-49200/UDP.
- Variáveis: `TURN_URLS`, `TURN_SECRET`, `WEBRTC_STUN_URLS`. O servidor gera credenciais temporárias
  (HMAC-SHA1, padrão `use-auth-secret`), válidas por `TURN_TTL_SECONDS`.
- Custo: uma VM pequena (o tráfego de vídeo passa por ela quando necessário). Alternativa paga: serviços TURN gerenciados.
- Reuniões com mais de 6 pessoas: usar Teams (item 3) ou, no futuro, um SFU (LiveKit/mediasoup, auto-hospedado).

## 7. GIFs

Estado: **planejado, não implementado**. Exige uma fonte autorizada (ex.: API da Tenor/Giphy com chave,
termos de uso e filtro de conteúdo). Não há botão de GIF na interface até que isso seja aprovado e configurado.

## 8. Notificações push (PWA)

Estado: **planejado, não implementado**. Exigiria chaves VAPID, armazenamento de inscrições e decisão sobre o
conteúdo exibido na tela bloqueada. Hoje as notificações são exibidas no aplicativo e por e-mail.

## 9. Sincronização de diretório

Estado: **planejado**. A estrutura (tabelas `integration_events`, identidades por `oid`) está pronta; a
sincronização periódica de usuários/grupos via Graph (`User.Read.All`, `GroupMember.Read.All`, permissões de
aplicativo) exige aprovação de escopo pela TI e definição de qual sistema é a fonte da estrutura organizacional.
