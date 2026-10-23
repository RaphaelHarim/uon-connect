/** Application error carrying an HTTP status and a stable machine-readable code. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Autenticação necessária.') => new AppError(401, 'unauthorized', message);
export const forbidden = (message = 'Você não tem permissão para esta ação.') => new AppError(403, 'forbidden', message);
/** Used when the caller may not even know the resource exists. */
export const notFound = (message = 'Recurso não encontrado.') => new AppError(404, 'not_found', message);
export const conflict = (message: string, details?: unknown) => new AppError(409, 'conflict', message, details);
export const payloadTooLarge = (message: string) => new AppError(413, 'payload_too_large', message);
export const unsupportedMedia = (message: string) => new AppError(415, 'unsupported_media_type', message);
export const unavailable = (message: string) => new AppError(503, 'service_unavailable', message);

/** Postgres raises these from the protection triggers (migration 0001). */
export function mapDatabaseError(err: unknown): AppError | null {
  const e = err as { code?: string; message?: string; cause?: { code?: string; message?: string } };
  const code = e?.code ?? e?.cause?.code;
  const msg = e?.message ?? e?.cause?.message ?? '';
  const full = `${msg} ${e?.cause?.message ?? ''}`;
  if (code === 'P0001' && full.includes('founder_protected')) {
    return new AppError(403, 'founder_protected', 'A conta fundadora é protegida e não pode ser alterada desta forma.');
  }
  if (code === 'P0001' && full.includes('audit_immutable')) {
    return new AppError(403, 'audit_immutable', 'Registros de auditoria são imutáveis.');
  }
  if (code === '23505') return conflict('Já existe um registro com esses dados.');
  if (code === '23503') return badRequest('Referência inválida a outro registro.');
  return null;
}
