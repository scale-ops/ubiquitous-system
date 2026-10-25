// Signed cookies for Google sign-in. A cookie holds a small JSON payload plus an HMAC signature
// made with AUTH_SECRET, so it can't be forged or edited in the browser.

export const SESSION_COOKIE = "hub_session";
export const OAUTH_COOKIE = "hub_oauth";
export const SESSION_HOURS = 12;

export type Session = { email: string; name: string; exp: number };
export type OAuthState = { state: string; nonce: string; returnTo: string; exp: number };

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

async function hmac(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(data))));
}

function authSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("Missing environment variable AUTH_SECRET");
  return secret;
}

// Constant-time comparison, so the signature check doesn't leak timing.
function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function seal(payload: object): Promise<string> {
  const body = base64url(encoder.encode(JSON.stringify(payload)));
  return `${body}.${await hmac(body, authSecret())}`;
}

// Returns the payload, or null if the cookie is missing, tampered with or expired.
export async function unseal<T extends { exp: number }>(value: string | undefined): Promise<T | null> {
  if (!value) return null;
  const [body, signature] = value.split(".");
  if (!body || !signature) return null;
  if (!sameString(signature, await hmac(body, authSecret()))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as T;
    return payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

// Google sign-in is on when its settings exist; otherwise the app keeps the old shared password.
export function googleSignInEnabled(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.AUTH_SECRET);
}

export function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}
