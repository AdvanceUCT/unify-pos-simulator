import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isOperator } from "./operator";
import { upstreamRefundOperation } from "./upstream";
vi.mock("./operator", async original => ({ ...await original<typeof import("./operator")>(), isOperator: vi.fn() }));
vi.mock("./upstream", async original => ({ ...await original<typeof import("./upstream")>(), upstreamRefundOperation: vi.fn() }));
import { refundOperationRoute } from "./refundOperationRoute";
import { POST, GET } from "../app/api/refund-operations/route";
const op = { id: "operation-1", vendorProfileId: "vendor-1", operatorId: "api:key-1", originalTransactionId: "spend-1", paymentRequestId: "a".repeat(32), branchId: "branch-1", amountMinor: 1000, currency: "ZAR", idempotencyKey: "key-1", status: "PENDING", createdAt: "2026-10-07T00:00:00.000Z", resolvedAt: null };
const request = (body: unknown = {}, origin = "https://pos.example.com") => new Request("https://pos.example.com/api/refund-operations/operation-1/execute", { method: "POST", headers: { origin }, body: JSON.stringify(body) });
beforeEach(() => { vi.mocked(isOperator).mockResolvedValue(true); vi.stubEnv("POS_ORIGIN", "https://pos.example.com"); vi.stubEnv("UNIFY_BRANCH_ID", "branch-1"); });
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("POS durable refund routes", () => {
  it("checks operator, origin and fixed instruction shape before execution", async () => {
    vi.mocked(isOperator).mockResolvedValue(false); expect((await refundOperationRoute(request(), op.id, "execute")).status).toBe(401);
    vi.mocked(isOperator).mockResolvedValue(true); expect((await refundOperationRoute(request({}, "https://other.example"), op.id, "execute")).status).toBe(502);
    expect((await refundOperationRoute(request({ amountMinor: 2000 }), op.id, "execute")).status).toBe(502);
    expect(upstreamRefundOperation).not.toHaveBeenCalled();
  });
  it("checks the operation's binding and allows a durable rejected outcome through", async () => {
    vi.mocked(upstreamRefundOperation).mockResolvedValueOnce(op).mockResolvedValueOnce({ ...op, status: "REJECTED", resolvedAt: "2026-10-07T00:01:00.000Z", rejection: { code: "VENDOR_PAYMENT_SUSPENDED", message: "Suspended.", status: 403 } });
    const response = await refundOperationRoute(request(), op.id, "execute"); expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ status: "REJECTED", rejection: { status: 403 } });
    vi.mocked(upstreamRefundOperation).mockResolvedValueOnce(op).mockResolvedValueOnce({ ...op, amountMinor: 2000 });
    expect((await refundOperationRoute(request(), op.id, "execute")).status).toBe(502);
  });
  it("keeps transport errors and wrong-branch operations unresolved", async () => {
    vi.mocked(upstreamRefundOperation).mockRejectedValueOnce(new Error("timeout")); expect((await refundOperationRoute(request(), op.id, "execute")).status).toBe(502);
    vi.mocked(upstreamRefundOperation).mockResolvedValueOnce({ ...op, branchId: "other-branch" }); expect((await refundOperationRoute(request(), op.id, "execute")).status).toBe(403);
    expect(upstreamRefundOperation).toHaveBeenCalledTimes(2);
  });
  it("registers without executing and discovers the same operator's server instruction", async () => {
    vi.mocked(upstreamRefundOperation).mockResolvedValueOnce(op);
    expect((await POST(request({ paymentRequestId: op.paymentRequestId, amountMinor: op.amountMinor, idempotencyKey: op.idempotencyKey }))).status).toBe(200);
    expect(upstreamRefundOperation).toHaveBeenCalledWith("", { method: "POST", body: { paymentRequestId: op.paymentRequestId, amountMinor: op.amountMinor, idempotencyKey: op.idempotencyKey } });
    vi.mocked(upstreamRefundOperation).mockResolvedValueOnce({ vendorProfileId: op.vendorProfileId, operatorId: op.operatorId, operation: op });
    expect((await GET()).status).toBe(200);
  });
});
