import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { z } from 'zod';
import { requirePermission } from '../../authz/context.js';
import type { Deps } from '../../deps.js';
import { AppError, badRequest, notFound, payloadTooLarge } from '../../lib/errors.js';
import { reqMeta, requireAuth } from '../../lib/http.js';
import type { App } from '../../lib/types.js';
import { recordAudit } from '../audit/service.js';

/**
 * Installers offered on the public /baixar page. Administrators upload them (Administração ›
 * Instaladores); each platform has one current file with a fixed name, so links never change.
 */
export const PLATFORMS = {
  windows: { file: 'UON-CONNECT-Setup.exe', ext: '.exe', label: 'Windows', mime: 'application/vnd.microsoft.portable-executable' },
  mac: { file: 'UON-CONNECT.dmg', ext: '.dmg', label: 'Mac', mime: 'application/x-apple-diskimage' },
  android: { file: 'UON-CONNECT.apk', ext: '.apk', label: 'Android', mime: 'application/vnd.android.package-archive' },
} as const;
export type Platform = keyof typeof PLATFORMS;
const platformParam = z.object({ platform: z.enum(Object.keys(PLATFORMS) as [Platform, ...Platform[]]) });

interface Meta {
  version: string | null;
  size: number;
  sha256: string;
  uploadedAt: string;
  originalName: string;
}

/** Checks the file really is what the platform expects (not just the extension). */
async function looksValid(platform: Platform, file: string, size: number): Promise<boolean> {
  const fh = await open(file, 'r');
  try {
    const head = Buffer.alloc(4);
    await fh.read(head, 0, 4, 0);
    if (platform === 'windows') return head[0] === 0x4d && head[1] === 0x5a; // "MZ"
    if (platform === 'android') return head.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])); // zip
    // DMG: "koly" trailer in the last 512 bytes.
    if (size < 512) return false;
    const tail = Buffer.alloc(4);
    await fh.read(tail, 0, 4, size - 512);
    return tail.toString('latin1') === 'koly';
  } finally {
    await fh.close();
  }
}

export function registerDownloadRoutes(app: App, deps: Deps) {
  const { env, db } = deps;
  const dir = env.downloadsDir;
  const metaPath = (p: Platform) => path.join(dir, `${PLATFORMS[p].file}.json`);

  async function readMeta(p: Platform): Promise<Meta | null> {
    try {
      return JSON.parse(await readFile(metaPath(p), 'utf8')) as Meta;
    } catch {
      return null;
    }
  }

  // Public: installers carry no data; the apps still require signing in.
  app.get('/downloads', async () => {
    const items = await Promise.all(
      (Object.keys(PLATFORMS) as Platform[]).map(async (p) => {
        const m = await readMeta(p);
        return m ? { platform: p, label: PLATFORMS[p].label, fileName: PLATFORMS[p].file, url: `/api/v1/downloads/${p}/file`, version: m.version, size: m.size, sha256: m.sha256, uploadedAt: m.uploadedAt } : null;
      }),
    );
    return { items: items.filter(Boolean) };
  });

  app.get('/downloads/:platform/file', { schema: { params: platformParam } }, async (req, reply) => {
    const p = req.params.platform;
    const file = path.join(dir, PLATFORMS[p].file);
    const [m, st] = await Promise.all([readMeta(p), stat(file).catch(() => null)]);
    if (!m || !st) throw notFound('Instalador ainda não disponível.');
    return reply
      .header('content-type', PLATFORMS[p].mime)
      .header('content-length', String(st.size))
      .header('content-disposition', `attachment; filename="${PLATFORMS[p].file}"`)
      .header('cache-control', 'no-cache')
      .header('x-content-type-options', 'nosniff')
      .send(createReadStream(file));
  });

  app.post('/admin/downloads/:platform', { schema: { params: platformParam } }, async (req) => {
    const ctx = requireAuth(req);
    requirePermission(ctx, 'settings.manage');
    const p = req.params.platform;
    if (!req.isMultipart()) throw badRequest('Envie o arquivo como multipart/form-data.');
    const part = await req.file({ limits: { fileSize: env.DOWNLOAD_MAX_MB * 1024 * 1024 } });
    if (!part) throw badRequest('Nenhum arquivo enviado.');
    if (!part.filename.toLowerCase().endsWith(PLATFORMS[p].ext)) {
      part.file.resume();
      throw badRequest(`Para ${PLATFORMS[p].label}, envie um arquivo ${PLATFORMS[p].ext}.`);
    }
    const versionField = part.fields.version as { value?: unknown } | undefined;
    const version = typeof versionField?.value === 'string' && versionField.value.trim() ? versionField.value.trim().slice(0, 40) : null;

    await mkdir(dir, { recursive: true });
    const tmp = path.join(dir, `.upload-${p}-${Date.now()}`);
    const hash = createHash('sha256');
    let size = 0;
    try {
      await pipeline(
        part.file,
        new Transform({
          transform(chunk: Buffer, _enc, cb) {
            hash.update(chunk);
            size += chunk.length;
            cb(null, chunk);
          },
        }),
        createWriteStream(tmp, { mode: 0o640 }),
      );
      if (part.file.truncated) throw payloadTooLarge(`O instalador passa do limite de ${env.DOWNLOAD_MAX_MB} MB.`);
      if (size === 0) throw badRequest('O arquivo está vazio.');
      if (!(await looksValid(p, tmp, size))) throw new AppError(415, 'unsupported_media_type', `O arquivo não parece um instalador de ${PLATFORMS[p].label} válido.`);
      await rename(tmp, path.join(dir, PLATFORMS[p].file));
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
    const meta: Meta = { version, size, sha256: hash.digest('hex'), uploadedAt: new Date().toISOString(), originalName: path.basename(part.filename).slice(0, 200) };
    await writeFile(metaPath(p), JSON.stringify(meta, null, 2));
    await recordAudit(db, { actor: ctx, action: 'download.published', resourceType: 'installer', resourceId: p, outcome: 'success', metadata: { version, size, sha256: meta.sha256 }, meta: reqMeta(req) });
    return { platform: p, ...meta };
  });

  app.delete('/admin/downloads/:platform', { schema: { params: platformParam } }, async (req) => {
    const ctx = requireAuth(req);
    requirePermission(ctx, 'settings.manage');
    const p = req.params.platform;
    await rm(path.join(dir, PLATFORMS[p].file), { force: true });
    await rm(metaPath(p), { force: true });
    await recordAudit(db, { actor: ctx, action: 'download.removed', resourceType: 'installer', resourceId: p, outcome: 'success', meta: reqMeta(req) });
    return { ok: true };
  });
}
