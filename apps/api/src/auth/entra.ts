import * as oidc from 'openid-client';
import type { Env } from '../config/env.js';

/**
 * Microsoft Entra ID via OpenID Connect (authorization code + PKCE, confidential client).
 * `openid-client` validates issuer, audience, signature (JWKS), expiry, nonce and state.
 * We additionally check tenant, the stable object id, e-mail domain and group membership.
 */
export class EntraProvider {
  private config: oidc.Configuration | null = null;
  private discovering: Promise<oidc.Configuration> | null = null;

  constructor(private readonly env: Env) {}

  get enabled() {
    return this.env.entraEnabled;
  }

  get issuerUrl() {
    return new URL(`https://login.microsoftonline.com/${this.env.ENTRA_TENANT_ID}/v2.0`);
  }

  scopes(): string {
    const s = ['openid', 'profile', 'email', 'offline_access'];
    if (this.env.GRAPH_CALENDAR_ENABLED) s.push('User.Read', 'Calendars.Read');
    if (this.env.GRAPH_TEAMS_MEETINGS_ENABLED) s.push('OnlineMeetings.ReadWrite');
    return [...new Set(s)].join(' ');
  }

  async getConfig(): Promise<oidc.Configuration> {
    if (this.config) return this.config;
    this.discovering ??= oidc
      .discovery(this.issuerUrl, this.env.ENTRA_CLIENT_ID!, this.env.ENTRA_CLIENT_SECRET!)
      .then((c) => (this.config = c))
      .finally(() => (this.discovering = null));
    return this.discovering;
  }

  async buildLoginUrl(input: { state: string; nonce: string; codeVerifier: string }) {
    const config = await this.getConfig();
    return oidc.buildAuthorizationUrl(config, {
      redirect_uri: this.env.ENTRA_REDIRECT_URI!,
      scope: this.scopes(),
      code_challenge: await oidc.calculatePKCECodeChallenge(input.codeVerifier),
      code_challenge_method: 'S256',
      state: input.state,
      nonce: input.nonce,
      response_mode: 'query',
    });
  }

  async exchangeCode(currentUrl: URL, checks: { state: string; nonce: string; codeVerifier: string }) {
    const config = await this.getConfig();
    const tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: checks.codeVerifier,
      expectedState: checks.state,
      expectedNonce: checks.nonce,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    if (!claims) throw new EntraClaimError('missing_id_token', 'O provedor não retornou um ID token.');
    return { tokens, claims: claims as Record<string, unknown> };
  }

  async refresh(refreshToken: string) {
    return oidc.refreshTokenGrant(await this.getConfig(), refreshToken);
  }

  async logoutUrl(): Promise<string | null> {
    try {
      const config = await this.getConfig();
      if (!config.serverMetadata().end_session_endpoint) return null;
      const params: Record<string, string> = { client_id: this.env.ENTRA_CLIENT_ID! };
      if (this.env.ENTRA_POST_LOGOUT_REDIRECT_URI) params.post_logout_redirect_uri = this.env.ENTRA_POST_LOGOUT_REDIRECT_URI;
      return oidc.buildEndSessionUrl(config, params).href;
    } catch {
      return null;
    }
  }
}

export class EntraClaimError extends Error {
  constructor(
    public readonly reason: string,
    message: string,
  ) {
    super(message);
  }
}

export interface VerifiedEntraIdentity {
  tenantId: string;
  objectId: string;
  email: string | null;
  name: string | null;
}

/** Checks applied on top of the protocol validation. Pure function, unit-tested. */
export function verifyEntraClaims(claims: Record<string, unknown>, env: Env): VerifiedEntraIdentity {
  const tid = typeof claims.tid === 'string' ? claims.tid : null;
  const oid = typeof claims.oid === 'string' ? claims.oid : null;
  if (!tid || tid !== env.ENTRA_TENANT_ID) throw new EntraClaimError('wrong_tenant', 'Conta de outro diretório.');
  if (!oid) throw new EntraClaimError('missing_oid', 'O token não contém o identificador do usuário (oid).');

  const rawEmail =
    (typeof claims.email === 'string' && claims.email) ||
    (typeof claims.preferred_username === 'string' && claims.preferred_username) ||
    null;
  const email = rawEmail ? rawEmail.toLowerCase() : null;

  if (env.ENTRA_ALLOWED_EMAIL_DOMAINS.length > 0) {
    const domain = email?.split('@')[1];
    if (!domain || !env.ENTRA_ALLOWED_EMAIL_DOMAINS.map((d) => d.toLowerCase()).includes(domain)) {
      throw new EntraClaimError('domain_not_allowed', 'O domínio da conta não está autorizado.');
    }
  }

  if (env.ENTRA_ALLOWED_GROUP_IDS.length > 0) {
    if (claims._claim_names && typeof claims._claim_names === 'object' && 'groups' in (claims._claim_names as object)) {
      // Group overage: the token omits groups when the user belongs to too many. We fail closed.
      throw new EntraClaimError(
        'groups_overage',
        'Não foi possível confirmar os grupos autorizados (excesso de grupos no token). Contate a TI.',
      );
    }
    const groups = Array.isArray(claims.groups) ? (claims.groups as unknown[]).map(String) : [];
    if (!groups.some((g) => env.ENTRA_ALLOWED_GROUP_IDS.includes(g))) {
      throw new EntraClaimError('group_not_allowed', 'A conta não pertence a um grupo autorizado.');
    }
  }

  return { tenantId: tid, objectId: oid, email, name: typeof claims.name === 'string' ? claims.name : null };
}
