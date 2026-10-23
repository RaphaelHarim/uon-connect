import { randomUUID } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Deps } from '../../deps.js';
import { files } from '../../db/schema/index.js';
import { sha256Hex } from '../../lib/crypto.js';
import { AppError, badRequest, payloadTooLarge } from '../../lib/errors.js';
import { detectAllowedType, sanitizeFileName } from './validation.js';

export type FileRow = typeof files.$inferSelect;

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export async function saveUpload(
  deps: Deps,
  req: FastifyRequest,
  opts: { purpose: 'ticket' | 'message' | 'avatar'; contextId: string; uploaderId: string; imagesOnly?: boolean },
): Promise<FileRow> {
  const { env, db, storage } = deps;
  if (!req.isMultipart()) throw badRequest('Envie o arquivo como multipart/form-data.');
  const part = await req.file();
  if (!part) throw badRequest('Nenhum arquivo enviado.');

  let buf: Buffer;
  try {
    buf = await part.toBuffer();
  } catch (err) {
    if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
      throw payloadTooLarge(`Arquivo maior que o limite de ${env.UPLOAD_MAX_FILE_MB} MB.`);
    }
    throw err;
  }
  if (buf.length === 0) throw badRequest('O arquivo está vazio.');
  const maxAvatar = 5 * 1024 * 1024;
  if (opts.purpose === 'avatar' && buf.length > maxAvatar) throw payloadTooLarge('A foto deve ter no máximo 5 MB.');

  const [used] = await db
    .select({ total: sql<number>`coalesce(sum(${files.sizeBytes}), 0)::bigint` })
    .from(files)
    .where(and(eq(files.uploadedBy, opts.uploaderId), isNull(files.deletedAt)));
  const quota = env.UPLOAD_USER_QUOTA_MB * 1024 * 1024;
  if (Number(used?.total ?? 0) + buf.length > quota) {
    throw new AppError(413, 'quota_exceeded', `Sua cota de armazenamento (${env.UPLOAD_USER_QUOTA_MB} MB) foi atingida.`);
  }

  const originalName = sanitizeFileName(part.filename);
  const allowed = opts.imagesOnly ? IMAGE_TYPES : env.allowedMimeTypes;
  const mime = await detectAllowedType(buf, part.mimetype, originalName, allowed, { imagesOnly: opts.imagesOnly });

  const now = new Date();
  const storageKey = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}`;
  await storage.put(storageKey, buf);
  try {
    const [row] = await db
      .insert(files)
      .values({
        storageKey,
        originalName,
        mimeType: mime,
        sizeBytes: buf.length,
        sha256: sha256Hex(buf),
        uploadedBy: opts.uploaderId,
        purpose: opts.purpose,
        contextId: opts.contextId,
      })
      .returning();
    return row!;
  } catch (err) {
    await storage.remove(storageKey).catch(() => undefined);
    throw err;
  }
}

/** Streams a file the caller has already been authorised to read. */
export async function streamFile(deps: Deps, reply: FastifyReply, file: FileRow, opts: { inline?: boolean } = {}) {
  const stream = await deps.storage.read(file.storageKey);
  // Only images may render inline; everything else is forced to download.
  const inline = opts.inline && file.mimeType.startsWith('image/');
  const encoded = encodeURIComponent(file.originalName);
  return reply
    .header('content-type', file.mimeType)
    .header('content-length', String(file.sizeBytes))
    .header('x-content-type-options', 'nosniff')
    .header('content-security-policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox")
    .header('cache-control', reply.getHeader('cache-control') ?? 'private, no-store')
    .header('content-disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encoded}`)
    .send(stream);
}

export const fileView = (f: FileRow) => ({
  id: f.id,
  name: f.originalName,
  mimeType: f.mimeType,
  sizeBytes: f.sizeBytes,
  createdAt: f.createdAt,
  uploadedBy: f.uploadedBy,
});
