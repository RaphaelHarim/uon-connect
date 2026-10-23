# Estado das funcionalidades — versão 0.1.0 (23/10/2026)

Legenda (sem "concluído" genérico):
- ✅ **Implementada e testada** — funciona neste ambiente e há teste automatizado.
- 🔌 **Implementada, depende de configuração externa** — código pronto; precisa de credencial/infraestrutura da UON para ser validada de ponta a ponta.
- 🟡 **Parcialmente implementada** — parte funciona; o que falta está descrito.
- 📝 **Planejada, não implementada**.
- ⛔ **Bloqueada por dependência externa** — depende de decisão/conta/licença.

## Fundação

| Funcionalidade | Estado | Observações |
| --- | --- | --- |
| Monorepo TypeScript, build, lint, typecheck | ✅ | |
| PostgreSQL, migrações versionadas, seeds base/demo | ✅ | |
| Sessões seguras, CSRF, rate limit, cabeçalhos de segurança | ✅ | |
| Login de desenvolvimento (contas fictícias) | ✅ | Bloqueado em produção (verificado em contêiner) |
| Login por usuário e senha (convite de uso único, bloqueio, troca e redefinição de senha) | ✅ | Desligado por padrão; ligado pelo instalador. Testado em integração, E2E e instalação em contêiner com HTTPS |
| Verificação em duas etapas (TOTP) e 2FA obrigatória para funções administrativas | ✅ | Recusa de código reutilizado; redefinição pela administração (exceto fundadora) |
| Login corporativo Microsoft Entra ID (OIDC + PKCE) | 🔌 | Regras de validação testadas; falta registrar o aplicativo no tenant da UON |
| Autorização RBAC + escopos + por recurso | ✅ | Aplicada na API e nas consultas SQL |
| Conta fundadora protegida (aplicação + banco) | ✅ | Bootstrap/recuperação testados em contêiner |
| Supreme Admins designados pela fundadora | ✅ | |
| Auditoria imutável com cadeia de hash | ✅ | |
| Papel de banco de menor privilégio | ✅ | Script testado em contêiner |

## Núcleo corporativo

| Funcionalidade | Estado | Observações |
| --- | --- | --- |
| Estrutura organizacional (6 departamentos, carteiras Bradesco/Itaú/Santander) configurável | ✅ | Nomes de responsáveis: configuração pendente (não inventados) |
| Gestão de usuários: criar, editar, ativar/desativar/desligar, lote, vínculos, funções, sessões | ✅ | |
| Acesso efetivo e detecção de configurações conflitantes | ✅ | |
| Histórico de alterações (via auditoria) | ✅ | |
| Perfil, foto, preferências, tema claro/escuro | ✅ | |
| Diretório de pessoas com contato restrito por departamento | ✅ | |
| Busca global respeitando permissões | ✅ | |
| Sincronização do diretório com o Entra ID | 📝 | Ver INTEGRATIONS §9 |

## Chamados

| Funcionalidade | Estado | Observações |
| --- | --- | --- |
| Abertura com destinos autorizados, protocolo, categorias, prioridades, confidencialidade | ✅ | |
| Fluxo de status configurável por papel, com motivo obrigatório | ✅ | |
| Atribuição, triagem, notas internas, acompanhantes, reabertura com prazo | ✅ | |
| Anexos com validação real de tipo, limites e cota | ✅ | Sem antivírus (recomendado) |
| Filtros, paginação, exportação CSV autorizada | ✅ | |
| SLA com calendário útil, feriados e fuso | ✅ | Políticas reais a definir pela UON; seed demo cria políticas "(demonstração)" |
| Pausa de SLA enquanto "aguardando solicitante" | 📝 | Hoje o prazo corre continuamente |
| Encerramento automático de resolvidos, alerta de prazo (uma vez por chamado) | ✅ | Tarefas agendadas no servidor |

## Dashboards

| Funcionalidade | Estado | Observações |
| --- | --- | --- |
| Pessoal, equipe, departamento (comparação e evolução por carteira), plataforma | ✅ | Números conferidos contra o banco em teste |
| Filtros por período, equipe; exportação CSV do departamento | ✅ | |
| Definição explícita de cada métrica; aviso sobre produtividade | ✅ | |
| Gráficos acessíveis (tabela, legenda, rótulos, tema escuro) | ✅ | axe sem violações sérias |

## Comunicação

| Funcionalidade | Estado | Observações |
| --- | --- | --- |
| Conversas individuais e grupos, política de contato | ✅ | |
| Tempo real, histórico paginado, envio idempotente, estados de envio/leitura | ✅ | |
| Respostas, reações, menções, edição/remoção, busca | ✅ | |
| Arquivos e imagens com download autorizado | ✅ | |
| Grupos vinculados a equipes (sincronização automática) | ✅ | |
| Indicador de digitação, presença | ✅ | |
| Marcação de mensagem importante | 🟡 | Campo existe na API; sem controle na interface |
| GIFs | ⛔ | Exige fonte autorizada e chave de API |

## Reuniões, presença e ausências

| Funcionalidade | Estado | Observações |
| --- | --- | --- |
| Chamada de vídeo individual e em grupo (WebRTC, até 6), convites, microfone/câmera, estados de conexão/reconexão, encerrar para todos | ✅ | Testada entre dois navegadores (mídia simulada) |
| Chamadas entre redes diferentes (NAT/firewall) | 🔌 | Exige TURN (coturn incluído) |
| Reuniões com mais de 6 pessoas | ⛔ | Teams (configuração) ou SFU (infraestrutura futura) |
| Agendamento de reuniões e criação de grupo a partir da chamada | ✅ | |
| Reuniões no Microsoft Teams | 🔌 | Testado com respostas simuladas do Graph |
| Calendário do Outlook (leitura) | 🔌 | Testado com respostas simuladas do Graph |
| Status manual × automático, ausências programadas ativadas pelo servidor, visibilidade, substituto | ✅ | |

## Notificações

| Funcionalidade | Estado | Observações |
| --- | --- | --- |
| Central unificada, tempo real, agrupamento, filtros, preferências por categoria | ✅ | |
| E-mail sem conteúdo sigiloso (fila com novas tentativas) | 🔌 | Testado com transporte simulado; requer SMTP |
| Push (celular/PWA) | 📝 | |

## Mobile e PWA

| Funcionalidade | Estado | Observações |
| --- | --- | --- |
| Layout responsivo, navegação móvel | ✅ | Testado em Pixel 7 (emulado) |
| PWA instalável, atualização controlada, sem cache de dados corporativos | ✅ | Ícones provisórios. Botão "Instalar o aplicativo" no menu do perfil (Edge/Chrome/Android). Guia em INSTALAR.md |
| Instalação forçada em computadores gerenciados (Intune/GPO `WebAppInstallForceList`) | 🔌 | Documentada; depende da TI |
| Instalador `.exe`/`.msi` (Electron/Tauri) | 📝 | O PWA cobre janela própria, ícone e atalho |
| Safari/iOS | 🟡 | Não testado em aparelho |
| App Android/iOS (Capacitor) e publicação em lojas | 📝 / ⛔ | Requer contas de desenvolvedor da UON |

## Integrações Microsoft 365

| Integração | Estado |
| --- | --- |
| Entra ID | 🔌 |
| Graph — calendário | 🔌 |
| Teams — reuniões | 🔌 |
| SharePoint/OneDrive | 📝 (avaliação documentada; recomendação: referenciar, não copiar) |
| Outlook — e-mail | 🔌 (via SMTP) |

## Operação

| Item | Estado | Observações |
| --- | --- | --- |
| Imagem Docker e Compose de produção | ✅ | Testados localmente |
| Instalador de servidor (`scripts/install.sh`): segredos, banco, papel mínimo, HTTPS (Caddy), fundadora, `--update` | ✅ | Executado do zero em contêiner (CA interna); certificado público automático depende de DNS real |
| Restrição de acesso por IP/rede | ✅ | Testado (403 fora da lista) |
| Implantação no Azure (VM) | 🔌 | Comandos documentados, **não executados** neste ambiente |
| Backup/restauração com verificação | ✅ | Também para a instalação Docker (`backup-docker.sh`, testado com restauração). Agendamento e cópia externa: operação |
| Logs estruturados, health checks, encerramento seguro | ✅ | |
| Monitoramento externo/alertas | 📝 | Integrar com a ferramenta da UON |
| Antivírus em anexos | 📝 | |
| Teste de carga e de intrusão | 📝 | |

## Dependências externas pendentes (o que a UON precisa fornecer)

1. Servidor Linux (da UON ou VM no Azure) e um domínio apontando para ele.
2. Nome e e-mail da pessoa que será a conta fundadora.
3. Opcional: registro do aplicativo no Entra ID (Tenant ID, Client ID, segredo, grupos) e o Object ID da
   fundadora, para usar o login Microsoft no lugar ou além das senhas.
4. SMTP corporativo (conta de serviço) para e-mails.
5. VM/portas para o TURN (se chamadas entre redes diferentes forem necessárias).
6. Logotipo e ícones oficiais da marca.
7. Definição de responsáveis e coordenadores de cada departamento/carteira (cadastro na Administração).
8. Políticas aprovadas: SLA por prioridade/categoria, retenção de dados (DPO), política de contato no chat.
9. Contas Apple/Google (somente se for publicar aplicativo em lojas).
