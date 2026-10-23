# Celular: PWA, aplicativo empacotado e nativo

## O que existe hoje: PWA instalável — implementado e testado (Chromium/Android emulado)

- Layout responsivo com navegação inferior, menu lateral e telas adaptadas (testado em 390 px e Pixel 7).
- Manifesto (`name`, ícones 192/512 e maskable, `display: standalone`, cor da marca) e *service worker*.
- **Cache somente do "casco" da aplicação** (HTML/JS/CSS/ícones). Respostas da API, arquivos e dados
  corporativos **não** são guardados no aparelho (`NetworkOnly`).
- Sem conexão: faixa clara "Você está sem conexão… não serão enviados"; mensagens que falharem ficam marcadas
  como "não enviada" com opção de reenviar (sem duplicar).
- Atualizações: o aplicativo avisa "Nova versão disponível" e só atualiza quando a pessoa confirma.
- Sessão por cookie `httpOnly` (não acessível a scripts) com expiração por inatividade.

Como instalar:
- **Android (Chrome/Edge)**: abrir o endereço → menu → "Instalar aplicativo".
- **iPhone (Safari)**: Compartilhar → "Adicionar à Tela de Início" (iOS 16.4+). Não testado em aparelho iOS nesta versão.
- **Windows/macOS (Chrome/Edge)**: ícone de instalação na barra de endereço.

Ícones atuais são **provisórios** (`apps/web/public/icons`); substitua pelos aprovados pela marca.

## Diferenças entre as opções

| | PWA (atual) | Aplicativo empacotado (Capacitor) | Nativo (Swift/Kotlin) |
| --- | --- | --- | --- |
| Código | o mesmo da web | o mesmo da web dentro de um contêiner nativo | código separado por plataforma |
| Distribuição | link; sem loja | Google Play / App Store (ou MDM corporativo) | lojas / MDM |
| Push no iOS | só com PWA instalada (iOS 16.4+) | APNs/FCM completos | completos |
| Câmera/microfone | WebRTC do navegador | WebRTC no WebView + permissões nativas | nativo |
| Custo/esforço | já entregue | médio: projeto Capacitor, assinatura, publicação | alto |
| Contas e taxas | nenhuma | Apple Developer (anual), Google Play (única), certificados | idem |

Observação: ferramentas Python não convertem um sistema web em aplicativo móvel completo; o caminho
adequado para reaproveitar esta interface é o Capacitor.

## Evolução para Capacitor (planejado, não implementado)

1. `npm i -w @uon/web @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios` e `npx cap init "UON CONNECT" br.com.uonconsulting.connect --web-dir dist`.
2. Como a API fica em outro domínio dentro do app, configurar `server.url` (carregar do domínio oficial) **ou**
   habilitar CORS para a origem `capacitor://localhost` e cookies `SameSite=None; Secure` — a primeira opção
   preserva o modelo de mesma origem e é a recomendada.
3. Login Entra ID: abrir o fluxo no navegador do sistema (plugin Browser) com *redirect* por *deep link*.
4. Push: `@capacitor/push-notifications` + FCM/APNs (requer contas e chaves).
5. Gerar e assinar: Android Studio (keystore) e Xcode (certificados Apple), publicar nas lojas ou distribuir via
   MDM (Intune). A publicação depende das contas da UON — **não foi realizada**.
