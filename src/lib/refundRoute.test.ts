import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/sales/[id]/refunds/route";
import { isOperator } from "./operator";
import { refundRequest, UpstreamError } from "./upstream";
vi.mock("./operator", async (original) => ({ ...await original<typeof import("./operator")>(), isOperator: vi.fn() }));
vi.mock("./upstream", async (original) => ({ ...await original<typeof import("./upstream")>(), refundRequest: vi.fn() }));
const id = "a".repeat(32);
const context = { params: Promise.resolve({ id }) };
function refund(origin = "https://pos.example.com", body: object = { amountMinor: 1500, idempotencyKey: "key-1" }) {
  return new Request(`https://pos.example.com/api/sales/${id}/refunds`, { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
beforeEach(() => { vi.stubEnv("POS_ORIGIN", "https://pos.example.com"); vi.mocked(isOperator).mockResolvedValue(true); });
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("POS refund route", () => {
  it("requires an operator session and a same-origin request before calling UNIFY", async () => {
    vi.mocked(isOperator).mockResolvedValue(false);
    expect((await POST(refund(), context)).status).toBe(401);
    vi.mocked(isOperator).mockResolvedValue(true);
    expect((await POST(refund("https://evil.example"), context)).status).toBe(403);
    expect((await POST(refund(undefined, { amountMinor: 1500, idempotencyKey: "key-1", extra: true }), context)).status).toBe(400);
    expect(refundRequest).not.toHaveBeenCalled();
  });
  it("passes definitive UNIFY rejections through and reports anything else as an unknown outcome", async () => {
    vi.mocked(refundRequest).mockRejectedValueOnce(new UpstreamError("Refund amount exceeds the remaining amount.", 409, "REFUND_AMOUNT_EXCEEDED"));
    const rejected = await POST(refund(), context);
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toMatchObject({ code: "REFUND_AMOUNT_EXCEEDED" });
    vi.mocked(refundRequest).mockRejectedValueOnce(new Error("The operation was aborted due to timeout"));
    expect((await POST(refund(), context)).status).toBe(502);
    expect(refundRequest).toHaveBeenCalledWith(id, { amountMinor: 1500, idempotencyKey: "key-1" });
  });
});
