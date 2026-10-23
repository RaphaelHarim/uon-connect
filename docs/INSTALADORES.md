# Instaladores: Windows, Mac e Android

O UON CONNECT tem três aplicativos instaláveis. Todos abrem o UON CONNECT do servidor da UON em janela
própria e não guardam dados corporativos além da sessão.

| Aparelho | Arquivo | Como é feito | Estado |
| --- | --- | --- | --- |
| Windows 10/11 | `UON-CONNECT-Setup-x.y.z.exe` | Electron 44 + instalador NSIS, por usuário, sem pedir administrador; atalhos no menu Iniciar e na área de trabalho | ✅ Gerado no GitHub Actions (Windows). App testado em Linux contra o servidor: endereço, login, bloqueio de sites externos, permissão de microfone, sessão lembrada. 🟡 **Não instalado num Windows real** |
| Mac (Intel e Apple Silicon) | `UON-CONNECT-x.y.z.dmg` | Mesmo app, universal, assinatura *ad hoc* | ✅ Gerado no GitHub Actions (macOS). 🟡 **Não aberto num Mac real** |
| Android 7+ | `UON-CONNECT.apk` | Capacitor 8, permissões de câmera, microfone e notificações | ✅ Gerado e conferido (`aapt2`, `apksigner`). 🟡 **Não instalado num celular real** |
| iPhone/iPad | — | A Apple não permite instalar fora da App Store; usa-se *Adicionar à Tela de Início* no Safari (PWA) | Instruções na página `/baixar` |

## Endereço do servidor

O endereço fica em `clients/server.json`:

```json
{ "serverUrl": "https://connect.seudominio.com.br" }
```

- **Computador:** se o arquivo estiver vazio, o app pergunta o endereço na primeira abertura e confere se
  é um UON CONNECT. Depois dá para trocar em *UON CONNECT › Alterar endereço do servidor…*.
- **Android:** se estiver vazio, também pergunta. O recomendado é gerar o APK já com o endereço; assim, o
  app abre direto e só navega nesse endereço.

## Gerar

Toda alteração em `clients/` enviada ao GitHub dispara o workflow **Instaladores**
(`.github/workflows/clients.yml`). Ele também pode ser rodado à mão em *Actions › Instaladores › Run
workflow*. Ao terminar, os arquivos ficam em **Artifacts** na página da execução: baixe os três `.zip` e
extraia.

Para mudar a versão, altere `version` em `clients/desktop/package.json` e em `clients/android/package.json`.

## Publicar para as pessoas

1. **Administração › Instaladores:** envie cada arquivo, com a versão. O servidor confere se o arquivo é
   mesmo um instalador daquele sistema e calcula o SHA-256.
2. Envie o link **`https://<endereço>/baixar`** por e-mail, Teams ou WhatsApp. A página reconhece o
   aparelho, oferece o arquivo certo e explica a instalação.

Quem já tem o app não precisa reinstalar quando o UON CONNECT ganha funções novas: o conteúdo vem do
servidor. Só é preciso um instalador novo quando o próprio app muda, por exemplo de ícone ou de endereço.

## Avisos de segurança (sem certificado de assinatura)

Sem um certificado de assinatura de código, cada sistema avisa na primeira instalação. As pessoas
conseguem continuar, e a página `/baixar` explica como:

| Sistema | Aviso | Como continuar | Para eliminar o aviso |
| --- | --- | --- | --- |
| Windows | "O Windows protegeu o computador" (SmartScreen) | **Mais informações › Executar assim mesmo** | Certificado de assinatura de código (OV/EV) em nome da UON, de uma autoridade certificadora, ou Azure Trusted Signing. Configure no workflow (`CSC_LINK`/`CSC_KEY_PASSWORD`, ou Azure). |
| Mac | "não pode ser aberto porque é de um desenvolvedor não identificado" | **Ajustes do Sistema › Privacidade e Segurança › Abrir Mesmo Assim** | Conta Apple Developer (paga, anual) e notarização no workflow. |
| Android | "Instalar apps desconhecidos" | Permitir para o navegador e voltar | Publicar na Play Store (conta de desenvolvedor) ou distribuir pelo Intune/Google Workspace. |

## Assinatura do Android (importante para atualizar)

Sem configuração, o APK sai com a **chave de depuração** de cada execução do GitHub. Funciona para
instalar, mas uma versão nova **não atualiza** a anterior: é preciso desinstalar antes. Para atualizações
normais, crie **uma vez** uma chave da UON e guarde nos *secrets* do GitHub:

```bash
keytool -genkeypair -v -keystore uon-connect.keystore -alias uon-connect \
  -keyalg RSA -keysize 4096 -validity 10000
base64 -w0 uon-connect.keystore > uon-connect.keystore.b64
```

No GitHub, em **Settings › Secrets and variables › Actions › New repository secret**:

| Nome | Valor |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | conteúdo de `uon-connect.keystore.b64` |
| `ANDROID_KEYSTORE_PASSWORD` | senha do keystore |
| `ANDROID_KEY_ALIAS` | `uon-connect` |
| `ANDROID_KEY_PASSWORD` | senha da chave |

Guarde o arquivo `uon-connect.keystore` e as senhas em local seguro, fora do repositório. **Se a chave for
perdida, nenhuma atualização futura poderá ser instalada por cima da atual.**

## Segurança do app de computador

- Isolamento de contexto, *sandbox* e sem Node.js nas páginas.
- Só navega no endereço do servidor; outros links abrem no navegador do sistema.
- Câmera, microfone, notificações e área de transferência são concedidos **só** ao servidor; o resto é
  negado.
- HTTPS obrigatório, exceto `localhost` e IP de rede privada, para testes.
- A tela de endereço é a única com acesso à ponte local, e só para gravar o endereço.
- Teste automatizado da lógica de endereço e permissões: `cd clients/desktop && npm test`.
