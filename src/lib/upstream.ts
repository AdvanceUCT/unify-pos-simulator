import { refundResultSchema, requestSchema, type RefundInput } from "./contracts";
/** A definitive UNIFY response (4xx/5xx) carrying its HTTP status and error code. */
export class UpstreamError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); }
}
async function upstreamAt(prefix: string, path: string, options: { method?: string; body?: object } = {}) {
  const base = process.env.UNIFY_API_BASE_URL;
  const key = process.env.UNIFY_VENDOR_API_KEY;
  if (!base || !key) throw new Error("UNIFY integration is not configured.");
  const origin = new URL(base);
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") throw new Error("Invalid UNIFY server configuration.");
  const response = await fetch(new URL(`${prefix}${path}`, origin), {
    method: options.method ?? "GET", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}), redirect: "error", signal: AbortSignal.timeout(15_000), cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok) throw new UpstreamError(data.error?.message ?? "UNIFY could not confirm this request.", response.status, data.error?.code);
  return data;
}
export async function upstream(path: string, options: { method?: string; body?: object } = {}) {
  return upstreamAt("/api/vendor/v1/payment-requests", path, options);
}
export async function upstreamRefundOperation(path: string, options: { method?: string; body?: object } = {}) {
  return upstreamAt("/api/vendor/v1/refund-operations", path, options);
}
function assertRequestId(id: string) {
  if (!/^[A-Za-z0-9_-]{32}$/.test(id)) throw new Error("Invalid request reference.");
}
export async function oneRequest(id: string, cancel = false) {
  assertRequestId(id);
  const result = requestSchema.parse(await upstream(`/${id}`));
  if (result.branchId !== process.env.UNIFY_BRANCH_ID) throw new Error("Sale is not assigned to this terminal branch.");
  return cancel ? requestSchema.parse(await upstream(`/${id}/cancel`, { method: "POST", body: {} })) : result;
}
/** Referenced refund of this terminal's own PAID sale; the same idempotency key replays the original refund. */
export async function refundRequest(id: string, body: RefundInput) {
  assertRequestId(id);
  const result = refundResultSchema.parse(await upstream(`/${id}/refunds`, { method: "POST", body }));
  if (result.paymentRequest.branchId !== process.env.UNIFY_BRANCH_ID) throw new Error("Sale is not assigned to this terminal branch.");
  return result;
}
