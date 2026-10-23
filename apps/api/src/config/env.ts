import path from 'node:path';
import { z } from 'zod';

const bool = (def: boolean) =>
  z
    .enum(['true', 'false', '1', '0', ''])
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v === 'true' || v === '1'));

const csv = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const DEFAULT_MIME = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/zip',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
].join(',');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().default(3000),
  APP_BASE_URL: z.url().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY: bool(false),
  CORS_ORIGINS: csv,

  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(12),
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(24 * 60).default(120),
  COOKIE_SECURE: z.enum(['auto', 'true', 'false']).default('auto'),

  AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(10_000).default(10),
  AUTH_DEV_LOGIN_ENABLED: bool(false),
  DEV_LOGIN_PASSWORD: z.string().optional(),

  ENTRA_TENANT_ID: z.string().optional(),
  ENTRA_CLIENT_ID: z.string().optional(),
  ENTRA_CLIENT_SECRET: z.string().optional(),
  ENTRA_REDIRECT_URI: z.string().optional(),
  ENTRA_POST_LOGOUT_REDIRECT_URI: z.string().optional(),
  ENTRA_ALLOWED_EMAIL_DOMAINS: csv,
  ENTRA_ALLOWED_GROUP_IDS: csv,
  ENTRA_LINK_BY_EMAIL: bool(true),
  ENTRA_AUTO_PROVISION: bool(false),

  GRAPH_CALENDAR_ENABLED: bool(false),
  GRAPH_TEAMS_MEETINGS_ENABLED: bool(false),
  TOKEN_ENCRYPTION_KEY: z.string().optional(),

  STORAGE_DRIVER: z.enum(['local']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./storage/files'),
  UPLOAD_MAX_FILE_MB: z.coerce.number().min(1).max(500).default(20),
  UPLOAD_USER_QUOTA_MB: z.coerce.number().min(10).max(100_000).default(2048),
  UPLOAD_ALLOWED_MIME: z.string().default(DEFAULT_MIME),

  EMAIL_ENABLED: bool(false),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: bool(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().optional(),

  WEBRTC_STUN_URLS: csv,
  TURN_URLS: csv,
  TURN_SECRET: z.string().optional(),
  TURN_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(3600),
  CALL_MAX_PARTICIPANTS: z.coerce.number().int().min(2).max(12).default(6),

  WEB_DIST_DIR: z.string().optional(),
  BRAND_LOGO_URL: z.string().optional(),
  JOBS_ENABLED: bool(true),
});

export type Env = z.infer<typeof schema> & {
  devLoginEnabled: boolean;
  entraEnabled: boolean;
  cookieSecure: boolean;
  allowedMimeTypes: string[];
  storageDir: string;
  emailConfigured: boolean;
};

export class ConfigError extends Error {}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ConfigError(`Configuração inválida: ${issues}`);
  }
  const e = parsed.data;
  const production = e.NODE_ENV === 'production';

  // The development login can never be enabled in production, whatever the flag says.
  if (production && e.AUTH_DEV_LOGIN_ENABLED) {
    throw new ConfigError(
      'AUTH_DEV_LOGIN_ENABLED=true não é permitido com NODE_ENV=production. Remova a variável.',
    );
  }
  const devLoginEnabled =
    !production && e.AUTH_DEV_LOGIN_ENABLED && !!e.DEV_LOGIN_PASSWORD && e.DEV_LOGIN_PASSWORD.length >= 8;

  const entraValues = [e.ENTRA_TENANT_ID, e.ENTRA_CLIENT_ID, e.ENTRA_CLIENT_SECRET, e.ENTRA_REDIRECT_URI];
  const entraEnabled = entraValues.every((v) => !!v && v.trim().length > 0);
  if (!entraEnabled && entraValues.some((v) => !!v)) {
    throw new ConfigError(
      'Configuração do Entra ID incompleta: informe ENTRA_TENANT_ID, ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET e ENTRA_REDIRECT_URI.',
    );
  }
  if ((e.GRAPH_CALENDAR_ENABLED || e.GRAPH_TEAMS_MEETINGS_ENABLED) && !entraEnabled) {
    throw new ConfigError('As integrações do Microsoft Graph exigem o Entra ID configurado.');
  }
  if (e.GRAPH_CALENDAR_ENABLED || e.GRAPH_TEAMS_MEETINGS_ENABLED) {
    const key = e.TOKEN_ENCRYPTION_KEY ? Buffer.from(e.TOKEN_ENCRYPTION_KEY, 'base64') : null;
    if (!key || key.length !== 32) {
      throw new ConfigError('TOKEN_ENCRYPTION_KEY deve conter 32 bytes em base64 para armazenar tokens do Graph.');
    }
  }
  if (production && !e.APP_BASE_URL.startsWith('https://')) {
    throw new ConfigError('Em produção, APP_BASE_URL deve usar https://.');
  }
  if (e.TURN_URLS.length > 0 && !e.TURN_SECRET) {
    throw new ConfigError('TURN_URLS exige TURN_SECRET (credenciais temporárias do coturn).');
  }

  const emailConfigured = e.EMAIL_ENABLED && !!e.SMTP_HOST && !!e.SMTP_FROM;

  return {
    ...e,
    devLoginEnabled,
    entraEnabled,
    cookieSecure: e.COOKIE_SECURE === 'auto' ? production : e.COOKIE_SECURE === 'true',
    allowedMimeTypes: e.UPLOAD_ALLOWED_MIME.split(',').map((s) => s.trim()).filter(Boolean),
    storageDir: path.resolve(e.STORAGE_LOCAL_DIR),
    emailConfigured,
  };
}
