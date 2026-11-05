'use strict';
const { app, BrowserWindow, Menu, dialog, ipcMain, net, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeServerUrl, sameOrigin, permissionAllowed, isExternalWebLink } = require('./lib.js');

/**
 * UON CONNECT para computador: uma janela própria que abre o UON CONNECT do servidor da UON.
 * Nada de dados corporativos fica no aplicativo além do cookie de sessão (como no navegador).
 */

if (!app.requestSingleInstanceLock()) app.quit();

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function builtInServer() {
  // Embedded at build time from clients/server.json (extraResources).
  const candidates = [path.join(process.resourcesPath || '', 'server.json'), path.join(__dirname, '..', '..', 'server.json')];
  for (const file of candidates) {
    try {
      return normalizeServerUrl(JSON.parse(fs.readFileSync(file, 'utf8')).serverUrl);
    } catch {
      /* next */
    }
  }
  return null;
}

function savedServer() {
  try {
    return normalizeServerUrl(JSON.parse(fs.readFileSync(settingsFile(), 'utf8')).serverUrl);
  } catch {
    return null;
  }
}

function saveServer(origin) {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify({ serverUrl: origin }, null, 2));
}

let win = null;
let origin = process.env.UON_SERVER_URL ? normalizeServerUrl(process.env.UON_SERVER_URL) : savedServer() || builtInServer();

function openSetup(message) {
  win.loadFile(path.join(__dirname, 'setup.html'), { query: { atual: origin || '', erro: message || '' } });
}

function openApp() {
  if (!origin) return openSetup();
  win.loadURL(`${origin}/`);
}

function harden(contents) {
  // Stay on the UON CONNECT server; anything else opens in the browser.
  contents.on('will-navigate', (event, url) => {
    if (url.startsWith('file://') && url.includes('setup.html')) return;
    if (!origin || !sameOrigin(url, origin)) {
      event.preventDefault();
      if (isExternalWebLink(url)) shell.openExternal(url);
    }
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (origin && sameOrigin(url, origin)) {
      return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: secureWebPreferences() } };
    }
    if (isExternalWebLink(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
}

function secureWebPreferences(extra = {}) {
  return { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: true, ...extra };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 380,
    minHeight: 560,
    title: 'UON CONNECT',
    backgroundColor: '#f6f5f3',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: secureWebPreferences({ preload: path.join(__dirname, 'setup-preload.js') }),
  });
  win.webContents.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
    if (isMainFrame && code !== -3 && !url.startsWith('file://')) {
      openSetup(`Não foi possível abrir ${origin} (${description}). Verifique a conexão ou o endereço.`);
    }
  });
  openApp();
}

function buildMenu() {
  const template = [
    {
      label: 'UON CONNECT',
      submenu: [
        { label: 'Recarregar', accelerator: 'CmdOrCtrl+R', click: () => win && openApp() },
        { label: 'Alterar endereço do servidor…', click: () => win && openSetup() },
        { type: 'separator' },
        { label: `Versão ${app.getVersion()}`, enabled: false },
        { type: 'separator' },
        { role: 'quit', label: 'Sair' },
      ],
    },
    { label: 'Editar', submenu: [{ role: 'undo', label: 'Desfazer' }, { role: 'redo', label: 'Refazer' }, { type: 'separator' }, { role: 'cut', label: 'Recortar' }, { role: 'copy', label: 'Copiar' }, { role: 'paste', label: 'Colar' }, { role: 'selectAll', label: 'Selecionar tudo' }] },
    { label: 'Exibir', submenu: [{ role: 'zoomIn', label: 'Aumentar' }, { role: 'zoomOut', label: 'Diminuir' }, { role: 'resetZoom', label: 'Tamanho original' }, { role: 'togglefullscreen', label: 'Tela cheia' }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// The setup page asks for the address and checks that it really is a UON CONNECT server.
ipcMain.handle('uon:set-server', async (event, input) => {
  if (!event.senderFrame || !event.senderFrame.url.startsWith('file://')) return { ok: false, message: 'Origem não autorizada.' };
  const candidate = normalizeServerUrl(input);
  if (!candidate) return { ok: false, message: 'Endereço inválido. Use o endereço completo, por exemplo https://connect.suaempresa.com.br' };
  try {
    const res = await net.fetch(`${candidate}/api/v1/auth/providers`, { headers: { accept: 'application/json' } });
    const body = res.ok ? await res.json() : null;
    if (!body || typeof body.localEnabled !== 'boolean') throw new Error('not_uon');
  } catch (err) {
    const msg = String(err && err.message);
    if (/CERT|SSL/i.test(msg)) return { ok: false, message: 'O certificado de segurança deste endereço não é confiável neste computador. Fale com a TI.' };
    return { ok: false, message: 'Não encontramos o UON CONNECT neste endereço. Confira com a administração.' };
  }
  origin = candidate;
  saveServer(origin);
  openApp();
  return { ok: true };
});

app.on('web-contents-created', (_e, contents) => harden(contents));

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(() => {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    callback(!!origin && permissionAllowed(permission, details.requestingUrl || wc.getURL(), origin));
  });
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => !!origin && permissionAllowed(permission, requestingOrigin, origin));
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

process.on('uncaughtException', (err) => {
  dialog.showErrorBox('UON CONNECT', `Erro inesperado: ${err.message}`);
});
