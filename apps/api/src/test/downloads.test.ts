import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BuiltApp } from '../app.js';
import { createTestApp, login } from './helpers.js';

let built: BuiltApp;
beforeAll(async () => {
  built = await createTestApp({ DOWNLOADS_DIR: mkdtempSync(path.join(os.tmpdir(), 'uon-dl-')) });
});
afterAll(async () => {
  await built.app.close();
});

const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(4096, 1)]);
const APK = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(2048, 2)]);
const DMG = Buffer.concat([Buffer.alloc(4096, 3), Buffer.from('koly'), Buffer.alloc(508)]);

describe('installers on the download page', () => {
  it('only administrators with settings permission can publish', async () => {
    const user = await login(built, 'bradesco1');
    expect((await user.upload('/admin/downloads/windows', 'UON.exe', EXE, 'application/octet-stream')).status).toBe(403);
  });

  it('publishes, lists publicly with checksum, serves the file and removes it', async () => {
    const admin = await login(built, 'platformAdmin');
    const r = await admin.upload('/admin/downloads/windows', 'UON CONNECT Setup 1.0.0.exe', EXE, 'application/octet-stream');
    expect(r.status).toBe(200);
    expect(r.json().size).toBe(EXE.length);

    const list = await built.app.inject({ method: 'GET', url: '/api/v1/downloads' });
    expect(list.statusCode).toBe(200);
    const item = list.json().items.find((i: { platform: string }) => i.platform === 'windows');
    expect(item).toMatchObject({ fileName: 'UON-CONNECT-Setup.exe', size: EXE.length });
    expect(item.sha256).toMatch(/^[a-f0-9]{64}$/);

    const file = await built.app.inject({ method: 'GET', url: '/api/v1/downloads/windows/file' });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-disposition']).toContain('attachment; filename="UON-CONNECT-Setup.exe"');
    expect(file.rawPayload.equals(EXE)).toBe(true);

    expect((await admin.del('/admin/downloads/windows')).status).toBe(200);
    expect((await built.app.inject({ method: 'GET', url: '/api/v1/downloads/windows/file' })).statusCode).toBe(404);
  });

  it('checks the real file type, not only the extension', async () => {
    const admin = await login(built, 'platformAdmin');
    expect((await admin.upload('/admin/downloads/windows', 'falso.exe', Buffer.from('<html>oi</html>'), 'application/octet-stream')).status).toBe(415);
    expect((await admin.upload('/admin/downloads/android', 'app.exe', EXE, 'application/octet-stream')).status).toBe(400);
    expect((await admin.upload('/admin/downloads/android', 'UON.apk', APK, 'application/vnd.android.package-archive')).status).toBe(200);
    expect((await admin.upload('/admin/downloads/mac', 'UON.dmg', DMG, 'application/x-apple-diskimage')).status).toBe(200);
    expect((await admin.upload('/admin/downloads/mac', 'UON.dmg', EXE, 'application/x-apple-diskimage')).status).toBe(415);
    const list = (await built.app.inject({ method: 'GET', url: '/api/v1/downloads' })).json();
    expect(list.items.map((i: { platform: string }) => i.platform).sort()).toEqual(['android', 'mac']);
  });

  it('accepts installers larger than the attachment limit', async () => {
    const admin = await login(built, 'platformAdmin');
    const big = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(30 * 1024 * 1024)]); // UPLOAD_MAX_FILE_MB is 20
    const r = await admin.upload('/admin/downloads/windows', 'big.exe', big, 'application/octet-stream');
    expect(r.status).toBe(200);
    expect(r.json().size).toBe(big.length);
  });
});
