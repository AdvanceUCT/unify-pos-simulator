import { requestSchema } from "./contracts";
export async function upstream(path: string, options: { method?: string; body?: object } = {}) {
  const base = process.env.UNIFY_API_BASE_URL;
  const key = process.env.UNIFY_VENDOR_API_KEY;
  if (!base || !key) throw new Error("UNIFY integration is not configured.");
  const origin = new URL(base);
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") throw new Error("Invalid UNIFY server configuration.");
  const response = await fetch(new URL(`/api/vendor/v1/payment-requests${path}`, origin), {
    method: options.method ?? "GET", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}), redirect: "error", signal: AbortSignal.timeout(15_000), cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message ?? "UNIFY could not confirm this request.");
  return data;
}
export async function oneRequest(id: string, cancel = false) {
  if (!/^[A-Za-z0-9_-]{32}$/.test(id)) throw new Error("Invalid request reference.");
  const result = requestSchema.parse(await upstream(`/${id}`));
  if (result.branchId !== process.env.UNIFY_BRANCH_ID) throw new Error("Sale is not assigned to this terminal branch.");
  return cancel ? requestSchema.parse(await upstream(`/${id}/cancel`, { method: "POST", body: {} })) : result;
}
