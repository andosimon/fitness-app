import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Pure session-token primitives with no framework dependencies.
 *
 * Kept separate from `auth.ts` because `proxy.ts` cannot import `next/headers`
 * — it reads cookies off the `NextRequest` instead — but still needs to verify
 * the same tokens. Both layers therefore share this module.
 *
 * The token is an HMAC-signed expiry stamp rather than a random token in a
 * sessions table: it needs no storage, survives redeploys, and cannot be forged
 * without `SESSION_SECRET`. The tradeoff is that individual sessions cannot be
 * revoked — rotating `SESSION_SECRET` invalidates all of them, an acceptable
 * blast radius for a single-user app.
 */

export const SESSION_COOKIE = "ft_session";

export const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "SESSION_SECRET is missing or shorter than 32 characters. Generate one with: openssl rand -base64 32",
    );
  }
  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("hex");
}

/**
 * Compares two strings without leaking content through timing. Both sides are
 * hashed first so `timingSafeEqual` always receives equal-length buffers, which
 * it requires — passing raw strings of differing length makes it throw.
 */
function safeEqual(a: string, b: string): boolean {
  const ha = createHmac("sha256", "compare").update(a).digest();
  const hb = createHmac("sha256", "compare").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function createSessionToken(now = Date.now()): string {
  const expiresAt = now + SESSION_DURATION_MS;
  // The nonce keeps otherwise-identical tokens distinct.
  const payload = `${expiresAt}.${randomBytes(8).toString("hex")}`;
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string | undefined | null): boolean {
  if (!token) return false;

  const lastDot = token.lastIndexOf(".");
  if (lastDot === -1) return false;

  const payload = token.slice(0, lastDot);
  const signature = token.slice(lastDot + 1);

  let expected: string;
  try {
    expected = sign(payload);
  } catch {
    // Missing SESSION_SECRET must fail closed, never open.
    return false;
  }

  if (!safeEqual(signature, expected)) return false;

  const expiresAt = Number(payload.split(".")[0]);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

/**
 * Checks the submitted password against `APP_PASSWORD`. Returns false when the
 * variable is unset, so a misconfigured deployment locks the app rather than
 * leaving it wide open.
 */
export function isPasswordValid(submitted: string): boolean {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return false;
  return safeEqual(submitted, expected);
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DURATION_MS / 1000,
  };
}
