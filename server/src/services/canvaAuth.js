import crypto from 'crypto';
import { getCanvaConnection, saveCanvaConnection, clearCanvaConnection } from './templateStore.js';

const AUTHORIZE_URL = 'https://www.canva.com/api/oauth/authorize';
const TOKEN_URL = 'https://api.canva.com/rest/v1/oauth/token';
const REVOKE_URL = 'https://api.canva.com/rest/v1/oauth/revoke';
const SCOPES = 'design:content:read design:meta:read';

// Canva's OAuth requires PKCE (Authorization Code + SHA-256 code challenge).
// Since Fillcraft is a single-user personal tool, an in-memory map of
// pending {state -> code_verifier} is sufficient — no need for a persisted,
// multi-user-safe state store. Entries are short-lived (a few minutes at
// most, for the length of the OAuth redirect round-trip) and self-clean.
const pendingAuth = new Map();

function base64url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function basicAuthHeader() {
  const credentials = `${process.env.CANVA_CLIENT_ID}:${process.env.CANVA_CLIENT_SECRET}`;
  return `Basic ${Buffer.from(credentials).toString('base64')}`;
}

export function buildAuthorizeUrl() {
  const codeVerifier = base64url(crypto.randomBytes(64));
  const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());
  const state = base64url(crypto.randomBytes(16));

  pendingAuth.set(state, codeVerifier);
  // Self-clean after 10 minutes in case the user never completes the flow.
  setTimeout(() => pendingAuth.delete(state), 10 * 60 * 1000).unref?.();

  const params = new URLSearchParams({
    client_id: process.env.CANVA_CLIENT_ID,
    redirect_uri: process.env.CANVA_REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeCodeForToken(code, state) {
  const codeVerifier = pendingAuth.get(state);
  if (!codeVerifier) {
    throw new Error('Unknown or expired OAuth state — the authorization flow may have timed out. Try connecting again.');
  }
  pendingAuth.delete(state);

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuthHeader(),
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      redirect_uri: process.env.CANVA_REDIRECT_URI,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Canva token exchange failed: ${JSON.stringify(data)}`);
  }
  await persistToken(data);
  return data;
}

async function refreshToken(refresh_token) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuthHeader(),
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Canva token refresh failed: ${JSON.stringify(data)}`);
  }
  await persistToken(data);
  return data;
}

async function persistToken(tokenData) {
  const expires_at = new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString();
  await saveCanvaConnection({
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    scope: tokenData.scope,
    expires_at,
  });
}

// Returns a currently-valid access token, transparently refreshing it first
// if it's expired or about to expire. Throws if there's no connection at all
// (caller should treat that as "not connected yet, needs /connect").
export async function getValidAccessToken() {
  const connection = await getCanvaConnection();
  if (!connection) {
    throw new Error('not_connected');
  }
  const expiresAt = new Date(connection.expires_at).getTime();
  const bufferMs = 60 * 1000; // refresh a minute early to avoid edge-of-expiry failures
  if (Date.now() < expiresAt - bufferMs) {
    return connection.access_token;
  }
  const refreshed = await refreshToken(connection.refresh_token);
  return refreshed.access_token;
}

export async function disconnectCanva() {
  const connection = await getCanvaConnection();
  if (connection) {
    try {
      await fetch(REVOKE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: basicAuthHeader(),
        },
        body: new URLSearchParams({ token: connection.refresh_token }),
      });
    } catch (err) {
      console.error('[canvaAuth] revoke call failed (clearing local record anyway):', err.message);
    }
  }
  await clearCanvaConnection();
}

export async function isConnected() {
  const connection = await getCanvaConnection();
  return !!connection;
}
