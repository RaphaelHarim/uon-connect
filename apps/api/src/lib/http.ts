import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthContext } from '../authz/context.js';
import type { RequestMeta } from '../modules/audit/service.js';
import { unauthorized } from './errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

export function requireAuth(req: FastifyRequest): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

export function reqMeta(req: FastifyRequest): RequestMeta {
  return { correlationId: String(req.id), ip: req.ip, userAgent: req.headers['user-agent'] };
}

export function sendCsv(reply: FastifyReply, filename: string, header: string[], rows: (string | number | null)[][]) {
  const esc = (v: string | number | null) => {
    if (v === null || v === undefined) return '';
    let s = String(v);
    // Prevent CSV/formula injection when opened in spreadsheet software.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = '﻿' + [header, ...rows].map((r) => r.map(esc).join(';')).join('\r\n');
  return reply
    .header('content-type', 'text/csv; charset=utf-8')
    .header('content-disposition', `attachment; filename="${filename}"`)
    .send(body);
}
