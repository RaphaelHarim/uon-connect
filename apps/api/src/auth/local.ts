import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;

/* ---------------------------------------------------------------- passwords */

// scrypt N=2^16, r=8, p=1: 64 MiB per hash, below OWASP's 2^17 so a small VM can absorb a burst of
// logins. The parameters are stored with each hash, so they can be raised later without a reset.
const N = 2 ** 16;
const R = 8;
const P = 1;
const KEYLEN = 32;
const MAXMEM = 128 * N * R * 2;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [n, r, p] = parts.slice(1, 4).map(Number) as [number, number, number];
  const salt = Buffer.from(parts[4]!, 'base64url');
  const expected = Buffer.from(parts[5]!, 'base64url');
  const actual = await scrypt(password.normalize('NFKC'), salt, expected.length, { N: n, r, p, maxmem: 128 * n * r * 2 });
  return timingSafeEqual(actual, expected);
}

/** A hash of a random value, verified when the account does not exist so timing stays the same. */
let dummyHash: Promise<string> | null = null;
export const getDummyHash = () => (dummyHash ??= hashPassword(randomBytes(16).toString('hex')));

const COMMON = new Set([
  '123456789012',
  '1234567890123',
  'qwertyuiopas',
  'senha1234567',
  'senhasenha12',
  'password1234',
  'passwordpassword',
  'uonconsulting',
  'uonconnect123',
  'uon@2026uon@2026',
  'mudar@123456',
  'trocar123456',
]);

/**
 * Password rules (NIST SP 800-63B): length over composition rules. At least 12 characters, not a
 * well-known password, not derived from the e-mail, and not a single repeated character.
 */
export function passwordProblem(password: string, email: string): string | null {
  if (password.length < 12) return 'A senha deve ter pelo menos 12 caracteres.';
  if (password.length > 128) return 'A senha deve ter no máximo 128 caracteres.';
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return 'Esta senha é muito comum. Escolha outra.';
  if (/^(.)\1+$/.test(password)) return 'A senha não pode repetir um único caractere.';
  const local = email.toLowerCase().split('@')[0] ?? '';
  if (local.length >= 4 && lower.includes(local)) return 'A senha não pode conter o seu e-mail.';
  return null;
}

/* ---------------------------------------------------------------- TOTP (RFC 6238) */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/[\s=]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of clean) {
    const idx = B32.indexOf(c);
    if (idx < 0) throw new Error('base32 inválido');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const TOTP_PERIOD = 30;
export const newTotpSecret = () => base32Encode(randomBytes(20));
export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / TOTP_PERIOD);

export function totpAt(secretB32: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', base32Decode(secretB32)).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0xf;
  const bin = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return bin.toString().padStart(6, '0');
}

/**
 * Checks a 6-digit code against the current step ±1 (clock drift). Returns the matched step, or
 * null. Steps at or before `lastStep` are refused so a code can't be replayed.
 */
export function verifyTotp(secretB32: string, code: string, lastStep: number | null, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const step = currentStep(now);
  for (const s of [step - 1, step, step + 1]) {
    if (lastStep !== null && s <= lastStep) continue;
    const expected = totpAt(secretB32, s);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(code))) return s;
  }
  return null;
}

export function otpauthUri(secretB32: string, account: string, issuer = 'UON CONNECT'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const q = new URLSearchParams({ secret: secretB32, issuer, algorithm: 'SHA1', digits: '6', period: String(TOTP_PERIOD) });
  return `otpauth://totp/${label}?${q.toString()}`;
}
