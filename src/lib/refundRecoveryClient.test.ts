// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { RefundRecoveryClient } from "./refundRecoveryClient";

const scope = { vendorProfileId: "vendor-1", operatorId: "user:owner-1" };
const op = (key: string, status = "PENDING") => ({ id: "operation-1", ...scope, originalTransactionId: "spend-1", paymentRequestId: null, branchId: "branch-1", amountMinor: 2000, currency: "ZAR", idempotencyKey: key, status, createdAt: "2026-10-07T00:00:00.000Z", resolvedAt: status === "PENDING" ? null : "2026-10-07T00:01:00.000Z",
  ...(status === "COMPLETED" ? { result: { originalTransactionId: "spend-1", refundTransactionId: "refund-1", paymentRequestId: null, refundedAmountMinor: 2000, totalRefundedMinor: 2000, remainingRefundableMinor: 8000, refundStatus: "PARTIALLY_REFUNDED", vendorBalanceMinor: 8000, replayed: true, refund: { id: "refund-1", amountMinor: 2000, currency: "ZAR", source: "PORTAL", createdAt: "2026-10-07T00:01:00.000Z" } } } : {}),
});
function storage() { const map = new Map<string, string>(); return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); } }; }
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

describe("durable refund browser recovery", () => {
  it("keeps the original amount and key after a lost response, editing, reload and another browser", async () => {
    const local = storage(); let authoritative: ReturnType<typeof op> | null = null; let postings = 0;
    const network = vi.fn(async (_url: string | URL | Request, options?: RequestInit) => {
      if (!options?.method) return json({ ...scope, operation: authoritative?.status === "PENDING" ? authoritative : null });
      if (!String(_url).endsWith("/execute")) { const draft = JSON.parse(String(options.body)); authoritative ??= op(draft.idempotencyKey); return json(authoritative); }
      if (authoritative?.status === "PENDING") { authoritative = op(authoritative.idempotencyKey, "COMPLETED"); postings++; throw new Error("response lost"); }
      return json(authoritative);
    });
    const client = new RefundRecoveryClient({ baseUrl: "/refunds", storage: () => local, fetch: network });
    await client.hydrate(); await client.submit({ transactionId: "spend-1", amountMinor: 2000 });
    const key = client.getSnapshot().draft!.idempotencyKey;
    await client.submit({ transactionId: "spend-1", amountMinor: 3000 });
    expect(postings).toBe(1); expect(client.getSnapshot().draft?.amountMinor).toBe(2000);
    // A fresh browser sees the server's unresolved instruction, without copying local storage.
    authoritative = op(key);
    const second = new RefundRecoveryClient({ baseUrl: "/refunds", storage: () => storage(), fetch: network });
    await second.hydrate(); expect(second.getSnapshot().operation?.idempotencyKey).toBe(key);
    authoritative = op(key, "COMPLETED");
    const reloaded = new RefundRecoveryClient({ baseUrl: "/refunds", storage: () => local, fetch: async url => String(url).endsWith("operation-1") ? json(authoritative) : json({ ...scope, operation: null }) });
    await reloaded.hydrate(); expect(reloaded.getSnapshot().outcome?.status).toBe("COMPLETED"); expect(local.map.size).toBe(0); expect(postings).toBe(1);
  });
  it.each([401, 403, 500, 502])("retains frozen instructions after HTTP %s", async status => {
    const local = storage(); let pending: ReturnType<typeof op> | null = null;
    const client = new RefundRecoveryClient({ baseUrl: "/refunds", storage: () => local, fetch: async (url, options) => {
      if (!options?.method) return json({ ...scope, operation: pending });
      if (String(url).endsWith("/execute")) return json({ error: "Cannot recover this refund." }, status);
      pending = op(JSON.parse(String(options.body)).idempotencyKey); return json(pending);
    } });
    await client.hydrate(); await client.submit({ transactionId: "spend-1", amountMinor: 2000 });
    expect(client.getSnapshot().draft?.operationId).toBe("operation-1"); expect(local.map.size).toBe(1);
    await client.recover(); expect(local.map.size).toBe(1);
  });
  it("does not send a refund when durable browser storage fails", async () => {
    const network = vi.fn(async () => json({ ...scope, operation: null }));
    const client = new RefundRecoveryClient({ baseUrl: "/refunds", fetch: network, storage: () => ({ getItem: () => null, removeItem() {}, setItem() { throw new Error("Storage full"); } }) });
    await client.hydrate(); await client.submit({ transactionId: "spend-1", amountMinor: 2000 });
    expect(network).toHaveBeenCalledTimes(1); expect(client.getSnapshot().error).toBe("Storage full");
  });
  it("retains the reference after a malformed success body and supports cancellation", async () => {
    const local = storage(); let pending: ReturnType<typeof op> | null = null;
    const client = new RefundRecoveryClient({ baseUrl: "/refunds", storage: () => local, fetch: async (url, options) => {
      if (!options?.method) return json({ ...scope, operation: pending });
      if (String(url).endsWith("/execute")) return json({ status: "COMPLETED" });
      if (String(url).endsWith("/cancel")) return json(op(pending!.idempotencyKey, "CANCELLED"));
      pending = op(JSON.parse(String(options.body)).idempotencyKey); return json(pending);
    } });
    await client.hydrate(); await client.submit({ transactionId: "spend-1", amountMinor: 2000 }); expect(local.map.size).toBe(1);
    await client.recover("cancel"); expect(client.getSnapshot().outcome?.status).toBe("CANCELLED"); expect(local.map.size).toBe(0);
  });
  it("recovers by operation ID after authorization returns, without registering new terms", async () => {
    const local = storage(); const key = "frozen-key";
    local.setItem("unify.refund-registration.v1:vendor-1:user:owner-1", JSON.stringify({ transactionId: "spend-1", amountMinor: 2000, idempotencyKey: key, operationId: "operation-1" }));
    let denied = true;
    const network = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
      if (String(url) === "/refunds") return json({ ...scope, operation: null });
      if (denied) return json({ error: "Sign in again." }, 403);
      return json(op(key, options?.method ? "COMPLETED" : "PENDING"));
    });
    const client = new RefundRecoveryClient({ baseUrl: "/refunds", storage: () => local, fetch: network });
    await client.hydrate(); expect(local.map.size).toBe(1);
    denied = false; await client.recover();
    expect(client.getSnapshot().outcome?.status).toBe("COMPLETED");
    expect(network.mock.calls.filter(([url, options]) => url === "/refunds" && options?.method)).toHaveLength(0);
  });
  it("keeps another operator's stored reference and clears only the imported legacy key", async () => {
    const local = storage(); local.setItem("unify.refund-registration.v1:other-vendor:api:old-key", "old-record");
    const clearLegacy = vi.fn();
    const legacy = { transactionId: "spend-1", amountMinor: 2000, idempotencyKey: "legacy-key" };
    const client = new RefundRecoveryClient({ baseUrl: "/refunds", storage: () => local, legacyDraft: () => legacy, clearLegacy, fetch: async (url, options) => {
      if (!options?.method) return json({ ...scope, operation: op("different-key") });
      return json(op("different-key", "COMPLETED"));
    } });
    await client.hydrate(); await client.recover();
    expect(clearLegacy).not.toHaveBeenCalled(); expect(local.getItem("unify.refund-registration.v1:other-vendor:api:old-key")).toBe("old-record");
    const imported = new RefundRecoveryClient({ baseUrl: "/refunds", storage: () => local, legacyDraft: () => legacy, clearLegacy, fetch: async (url, options) => {
      if (!options?.method) return json({ ...scope, operation: null });
      return json(op("legacy-key", "COMPLETED"));
    } });
    await imported.hydrate(); expect(clearLegacy).toHaveBeenCalledTimes(1);
  });
  it("a late terminal response cannot delete another tab's newer instruction", async () => {
    const local = storage(); let release!: (response: Response) => void;
    const delayed = new Promise<Response>(resolve => { release = resolve; });
    let key = "";
    const client = new RefundRecoveryClient({ baseUrl: "/refunds", storage: () => local, fetch: async (url, options) => {
      if (!options?.method) return json({ ...scope, operation: null });
      if (String(url).endsWith("/execute")) return delayed;
      key = JSON.parse(String(options.body)).idempotencyKey; return json(op(key));
    } });
    await client.hydrate(); const submission = client.submit({ transactionId: "spend-1", amountMinor: 2000 });
    while (!client.getSnapshot().operation) await new Promise(resolve => setTimeout(resolve, 0));
    const storeKey = "unify.refund-registration.v1:vendor-1:user:owner-1";
    local.setItem(storeKey, JSON.stringify({ transactionId: "spend-2", amountMinor: 1000, idempotencyKey: "newer-key" }));
    release(json(op(key, "COMPLETED"))); await submission;
    expect(JSON.parse(local.getItem(storeKey)!).idempotencyKey).toBe("newer-key");
  });
});
