import { API_PREFIX, type ApiErrorBody } from '@uon/shared/browser';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly correlationId?: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

let csrfToken: string | null = null;
export const setCsrfToken = (t: string | null) => {
  csrfToken = t;
};

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();
export const onUnauthorized = (l: Listener) => {
  unauthorizedListeners.add(l);
  return () => {
    unauthorizedListeners.delete(l);
  };
};

async function parseError(res: Response): Promise<ApiError> {
  let body: Partial<ApiErrorBody> | null = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON error */
  }
  const e = body?.error;
  const fallback =
    res.status === 0 || res.status >= 500
      ? 'O servidor não respondeu como esperado. Tente novamente em instantes.'
      : 'Não foi possível concluir a operação.';
  return new ApiError(res.status, e?.code ?? 'http_error', e?.message ?? fallback, e?.correlationId, e?.details);
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { accept: 'application/json' };
  if (method !== 'GET') {
    headers['x-requested-with'] = 'uon-connect';
    if (csrfToken) headers['x-csrf-token'] = csrfToken;
  }
  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) body = opts.body;
  else if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(`${API_PREFIX}${path}`, { method, headers, body, credentials: 'same-origin', signal: opts.signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'network_error', navigator.onLine ? 'Não foi possível conectar ao servidor.' : 'Você está sem conexão. A operação não foi enviada.');
  }
  if (res.status === 401) {
    unauthorizedListeners.forEach((l) => l());
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  const type = res.headers.get('content-type') ?? '';
  return (type.includes('application/json') ? res.json() : res.text()) as Promise<T>;
}

export const get = <T>(path: string, signal?: AbortSignal) => api<T>(path, { signal });
export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: body ?? {} });
export const put = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PUT', body: body ?? {} });
export const patch = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body: body ?? {} });
export const del = <T>(path: string, body?: unknown) => api<T>(path, { method: 'DELETE', body });

/** Upload a single file with progress reporting (fetch can't report upload progress). */
export function upload<T>(path: string, file: File, onProgress?: (fraction: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_PREFIX}${path}`);
    xhr.setRequestHeader('x-requested-with', 'uon-connect');
    if (csrfToken) xhr.setRequestHeader('x-csrf-token', csrfToken);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let json: unknown = null;
      try {
        json = JSON.parse(xhr.responseText);
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(json as T);
      else {
        const e = (json as Partial<ApiErrorBody> | null)?.error;
        reject(new ApiError(xhr.status, e?.code ?? 'upload_failed', e?.message ?? 'Falha no envio do arquivo.', e?.correlationId));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, 'network_error', 'Falha de rede durante o envio. O arquivo não foi enviado.'));
    const form = new FormData();
    form.append('file', file);
    xhr.send(form);
  });
}

export const fileUrl = (id: string, inline = false) => `${API_PREFIX}/files/${id}${inline ? '?inline=true' : ''}`;
export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : 'Erro inesperado.');
