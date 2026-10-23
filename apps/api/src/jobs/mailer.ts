import nodemailer, { type Transporter } from 'nodemailer';
import type { Env } from '../config/env.js';

export interface Mailer {
  readonly configured: boolean;
  send(msg: { to: string; subject: string; text: string; html?: string }): Promise<void>;
  verify(): Promise<{ ok: boolean; detail?: string }>;
  /** Messages captured in test mode. */
  readonly outbox: { to: string; subject: string; text: string }[];
}

export function createMailer(env: Env): Mailer {
  const outbox: { to: string; subject: string; text: string }[] = [];
  let transport: Transporter | null = null;
  if (env.NODE_ENV === 'test') {
    transport = nodemailer.createTransport({ jsonTransport: true });
  } else if (env.emailConfigured) {
    transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    });
  }
  return {
    configured: env.NODE_ENV === 'test' || env.emailConfigured,
    outbox,
    async send(msg) {
      if (!transport) throw new Error('E-mail não configurado');
      await transport.sendMail({ from: env.SMTP_FROM ?? 'UON CONNECT <no-reply@localhost>', ...msg });
      if (env.NODE_ENV === 'test') outbox.push(msg);
    },
    async verify() {
      if (!transport) return { ok: false, detail: 'not_configured' };
      if (env.NODE_ENV === 'test') return { ok: true };
      try {
        await transport.verify();
        return { ok: true };
      } catch (err) {
        return { ok: false, detail: (err as Error).message };
      }
    },
  };
}
