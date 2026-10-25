// Google sign-in (OpenID Connect, authorization-code flow). Only asks Google for the person's
// name and email, so team members never see an "unverified app" warning.

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

export type GoogleIdentity = { email: string; name: string };

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

// Must match an "Authorized redirect URI" on the Google client exactly.
export function redirectUri(origin: string): string {
  return `${origin}/api/auth/callback/google`;
}

export function authorizeUrl(origin: string, state: string, nonce: string): string {
  const params = new URLSearchParams({
    client_id: env("GOOGLE_CLIENT_ID"),
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    prompt: "select_account",
  });
  return `${AUTHORIZE_URL}?${params}`;
}

// Swaps the one-time code for an ID token and checks it. The token comes straight from Google's
// token endpoint over HTTPS using our client secret, so its claims can be trusted after these checks.
export async function exchangeCode(origin: string, code: string, nonce: string): Promise<GoogleIdentity> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env("GOOGLE_CLIENT_ID"),
      client_secret: env("GOOGLE_CLIENT_SECRET"),
      redirect_uri: redirectUri(origin),
      grant_type: "authorization_code",
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Google sign-in failed (${res.status})`);
  const { id_token } = (await res.json()) as { id_token?: string };
  if (!id_token) throw new Error("Google sign-in returned no ID token");

  const claims = JSON.parse(Buffer.from(id_token.split(".")[1] ?? "", "base64url").toString()) as Record<string, unknown>;
  if (!ISSUERS.includes(String(claims.iss))) throw new Error("Google sign-in: wrong issuer");
  if (claims.aud !== env("GOOGLE_CLIENT_ID")) throw new Error("Google sign-in: wrong audience");
  if (typeof claims.exp !== "number" || claims.exp * 1000 < Date.now()) throw new Error("Google sign-in: token expired");
  if (claims.nonce !== nonce) throw new Error("Google sign-in: nonce mismatch");
  if (claims.email_verified !== true || typeof claims.email !== "string") {
    throw new Error("Google sign-in: email not verified");
  }
  return { email: claims.email.toLowerCase(), name: typeof claims.name === "string" ? claims.name : "" };
}
