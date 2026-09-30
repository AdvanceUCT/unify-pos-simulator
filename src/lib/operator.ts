import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
const COOKIE = "unify_pos_operator";
const MAX_AGE = 8 * 60 * 60;
const attempts = new Map<string, { count: number; expires: number }>();
function sessionKey() {
  const secret = process.env.POS_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("Operator access is not configured.");
  return secret;
}
export function equalSecret(left: string, right: string) {
  return timingSafeEqual(createHash("sha256").update(left).digest(), createHash("sha256").update(right).digest());
}
function signature(body: string) { return createHmac("sha256", sessionKey()).update(`${body}:${createHash("sha256").update(process.env.POS_OPERATOR_PASSWORD ?? "").digest("hex")}`).digest("base64url"); }
export function issueSession(now = Date.now()) {
  const body = `${Math.floor(now / 1000) + MAX_AGE}.${randomBytes(16).toString("base64url")}`;
  return `${body}.${signature(body)}`;
}
export function validSession(value: string | undefined, now = Date.now()) {
  if (!value || !/^\d+\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/.test(value)) return false;
  const [expires, nonce, mac] = value.split(".");
  if (Number(expires) <= now / 1000 || Number(expires) > now / 1000 + MAX_AGE + 1) return false;
  try { return equalSecret(mac, signature(`${expires}.${nonce}`)); } catch { return false; }
}
export async function isOperator() { return validSession((await cookies()).get(COOKIE)?.value); }
export async function saveOperatorSession() { (await cookies()).set(COOKIE, issueSession(), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: MAX_AGE }); }
export async function clearOperatorSession() { (await cookies()).delete(COOKIE); }
export function assertOrigin(request: Request) {
  const configured = process.env.POS_ORIGIN;
  if (!configured || request.headers.get("origin") !== new URL(configured).origin) throw new Error("Invalid request origin.");
}
export async function allowLogin(request: Request) {
  const address = request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const key = `pos-login:${createHash("sha256").update(address).digest("hex")}`;
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (redisUrl && redisToken) {
    const response = await fetch(redisUrl, { method: "POST", headers: { Authorization: `Bearer ${redisToken}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(4000), cache: "no-store", body: JSON.stringify(["EVAL", "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],900) end; return n", "1", key]) });
    if (!response.ok) throw new Error("Login is temporarily unavailable.");
    const data = await response.json(); if (!Number.isInteger(data.result)) throw new Error("Login is temporarily unavailable.");
    return data.result <= 5;
  }
  // Fail closed on Vercel: per-instance memory cannot provide a distributed limit.
  if (process.env.VERCEL && process.env.POS_LOGIN_FIREWALL_ENABLED !== "true") throw new Error("Distributed login protection is not configured.");
  const now = Date.now();
  for (const [key, entry] of attempts) if (entry.expires <= now) attempts.delete(key);
  const entry = attempts.get(key) ?? { count: 0, expires: now + 900_000 };
  entry.count += 1; attempts.set(key, entry); return entry.count <= 5;
}
