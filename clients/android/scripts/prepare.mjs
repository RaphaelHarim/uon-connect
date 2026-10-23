// Generates capacitor.config.json and www/ from ../server.json.
// With an address: the app opens the UON CONNECT server directly.
// Without one: a local screen asks for the address and remembers it.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { serverUrl = '' } = JSON.parse(readFileSync(path.join(root, '..', 'server.json'), 'utf8'));
const url = (process.env.UON_SERVER_URL ?? serverUrl).trim().replace(/\/+$/, '');
if (url && !/^https:\/\/[^/]+$/.test(url)) {
  console.error(`serverUrl inválido: "${url}" (use https://host, sem caminho).`);
  process.exit(1);
}
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;

rmSync(path.join(root, 'www'), { recursive: true, force: true });
mkdirSync(path.join(root, 'www'));
cpSync(path.join(root, 'www-src'), path.join(root, 'www'), { recursive: true });

const config = {
  appId: 'uonconnect.android',
  appName: 'UON CONNECT',
  webDir: 'www',
  android: { allowMixedContent: false, captureInput: true, webContentsDebuggingEnabled: false },
  server: url
    ? { url, cleartext: false, androidScheme: 'https', allowNavigation: [new URL(url).host] }
    : { androidScheme: 'https', allowNavigation: ['*'] },
};
writeFileSync(path.join(root, 'capacitor.config.json'), JSON.stringify(config, null, 2));
console.log(`capacitor.config.json gerado (versão ${version}) — servidor: ${url || 'perguntar na primeira abertura'}`);
