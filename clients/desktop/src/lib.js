'use strict';

/**
 * Normalizes what a person types as the server address. Returns the origin (scheme + host + port)
 * or null. HTTPS is required, except for localhost and private network addresses during tests.
 */
function normalizeServerUrl(input) {
  if (typeof input !== 'string') return null;
  let text = input.trim();
  if (!text) return null;
  if (!/^[a-z]+:\/\//i.test(text)) text = `https://${text}`;
  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol === 'https:') return url.origin;
  if (url.protocol === 'http:' && isPrivateHost(url.hostname)) return url.origin;
  return null;
}

function isPrivateHost(host) {
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return true;
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

function sameOrigin(url, origin) {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

/** Only what the UON CONNECT pages use: calls (camera/mic), notifications, copy, fullscreen video. */
const ALLOWED_PERMISSIONS = new Set(['media', 'notifications', 'clipboard-sanitized-write', 'fullscreen']);

function permissionAllowed(permission, requestingUrl, origin) {
  return ALLOWED_PERMISSIONS.has(permission) && sameOrigin(requestingUrl, origin);
}

/** External links open in the system browser, but only for web addresses. */
function isExternalWebLink(url) {
  try {
    const p = new URL(url).protocol;
    return p === 'https:' || p === 'http:' || p === 'mailto:';
  } catch {
    return false;
  }
}

module.exports = { normalizeServerUrl, isPrivateHost, sameOrigin, permissionAllowed, isExternalWebLink };
