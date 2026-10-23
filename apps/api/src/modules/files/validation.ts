import { fileTypeFromBuffer } from 'file-type';
import { unsupportedMedia } from '../../lib/errors.js';

const TEXT_TYPES = new Set(['text/plain', 'text/csv']);
/** Legacy Office formats are OLE compound files; file-type reports them as x-cfb. */
const CFB_TYPES = new Set(['application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint']);
const EXECUTABLE_EXT = /\.(exe|msi|bat|cmd|com|scr|ps1|vbs|js|jar|sh|dll|app|apk|html?|svg|xhtml)$/i;

export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'arquivo';
  const cleaned = base
    .normalize('NFKC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f<>:"|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  return cleaned || 'arquivo';
}

function looksLikeUtf8Text(buf: Buffer) {
  if (buf.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf.subarray(0, 64 * 1024));
    return true;
  } catch {
    return false;
  }
}

/**
 * Determines the real type of an upload from its content (magic bytes) rather than trusting the
 * client. Rejects anything outside the allow-list, executables and active content (HTML/SVG).
 */
export async function detectAllowedType(
  buf: Buffer,
  declaredMime: string,
  fileName: string,
  allowed: string[],
  opts: { imagesOnly?: boolean } = {},
): Promise<string> {
  if (EXECUTABLE_EXT.test(fileName)) throw unsupportedMedia('Tipo de arquivo não permitido por segurança.');
  const detected = await fileTypeFromBuffer(buf);
  let mime: string | undefined = detected?.mime;

  if (mime === 'application/x-cfb' && CFB_TYPES.has(declaredMime)) mime = declaredMime;
  if (!mime && TEXT_TYPES.has(declaredMime) && looksLikeUtf8Text(buf)) mime = declaredMime;

  if (!mime || !allowed.includes(mime)) {
    throw unsupportedMedia('Tipo de arquivo não permitido. Verifique a lista de formatos aceitos.');
  }
  if (opts.imagesOnly && !mime.startsWith('image/')) throw unsupportedMedia('Envie uma imagem PNG, JPEG ou WebP.');
  return mime;
}
