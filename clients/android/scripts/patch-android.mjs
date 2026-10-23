// Adjusts the generated Android project: permissions for calls, version and the launcher icon.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifestPath = path.join(root, 'android/app/src/main/AndroidManifest.xml');
let manifest = readFileSync(manifestPath, 'utf8');
const perms = ['android.permission.CAMERA', 'android.permission.RECORD_AUDIO', 'android.permission.MODIFY_AUDIO_SETTINGS', 'android.permission.POST_NOTIFICATIONS'];
for (const p of perms) {
  if (!manifest.includes(p)) manifest = manifest.replace('</manifest>', `    <uses-permission android:name="${p}" />\n</manifest>`);
}
writeFileSync(manifestPath, manifest);

const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const [maj, min, pat] = version.split('.').map(Number);
const gradlePath = path.join(root, 'android/app/build.gradle');
let gradle = readFileSync(gradlePath, 'utf8');
gradle = gradle.replace(/versionCode \d+/, `versionCode ${maj * 10000 + min * 100 + pat}`).replace(/versionName "[^"]*"/, `versionName "${version}"`);
// Release signing when a keystore is provided (CI secrets); otherwise Gradle's debug signing is used.
if (process.env.UON_KEYSTORE_FILE && !gradle.includes('signingConfigs {')) {
  gradle = gradle.replace(
    /android \{/,
    `android {
    signingConfigs {
        release {
            storeFile file(System.getenv("UON_KEYSTORE_FILE"))
            storePassword System.getenv("UON_KEYSTORE_PASSWORD")
            keyAlias System.getenv("UON_KEY_ALIAS")
            keyPassword System.getenv("UON_KEY_PASSWORD")
        }
    }`,
  );
  gradle = gradle.replace(/buildTypes \{\s*release \{/, (m) => `${m}\n            signingConfig signingConfigs.release`);
}
writeFileSync(gradlePath, gradle);

// Provisional icon (replace with the official logo when available).
const icon = path.join(root, '..', 'desktop', 'build', 'icon.png');
const res = path.join(root, 'android/app/src/main/res');
for (const d of ['mipmap-mdpi', 'mipmap-hdpi', 'mipmap-xhdpi', 'mipmap-xxhdpi', 'mipmap-xxxhdpi']) {
  const dir = path.join(res, d);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  for (const f of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png']) copyFileSync(icon, path.join(dir, f));
}
console.log('Projeto Android ajustado:', perms.length, 'permissões, versão', version);
