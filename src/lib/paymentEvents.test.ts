import { randomUUID, createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eventMatchesRequest, paymentEventSchema, validPaymentSignature } from "./paymentEvents";
import { POST } from "../app/api/unify/payment-events/route";
import { oneRequest } from "./upstream";
vi.mock("./upstream", () => ({ oneRequest: vi.fn() }));
const secret = "test-signing-secret";
const request = { id: "a".repeat(32), branchId: "branch", orderReference: "order", vendorName: "Test", branchName: "Test branch", amountMinor: 3500, currency: "ZAR" as const, status: "PAID" as const, transactionId: "tx", completedAt: "2026-09-30T10:00:00.000Z", createdAt: "2026-09-30T09:55:00.000Z", expiresAt: "2026-09-30T10:05:00.000Z", qrPayload: `unifywallet://pay-request/${"a".repeat(32)}` };
const event = { id: randomUUID(), version: 1, type: "payment_request.paid", occurredAt: request.completedAt, data: { requestId: request.id, branchId: request.branchId, orderReference: request.orderReference, amountMinor: request.amountMinor, currency: request.currency, status: request.status, transactionId: request.transactionId, completedAt: request.completedAt } };
function signed(value = event) {
  const body = JSON.stringify(value); const timestamp = Math.floor(Date.now() / 1000).toString();
  return new Request("https://pos.example/api/unify/payment-events", { method: "POST", body, headers: { "X-Unify-Timestamp": timestamp, "X-Unify-Signature": `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`, "X-Unify-Event-Id": value.id } });
}
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("Signed stateless payment receiver", () => {
  it("rejects tampered bodies, expired timestamps and malformed signatures", () => {
    const body = JSON.stringify(event); const timestamp = "1790762400"; const now = Number(timestamp) * 1000;
    const signature = `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
    expect(validPaymentSignature(body, timestamp, signature, secret, now)).toBe(true);
    expect(validPaymentSignature(`${body} `, timestamp, signature, secret, now)).toBe(false);
    expect(validPaymentSignature(body, timestamp, signature, secret, now + 301_000)).toBe(false);
    expect(validPaymentSignature(body, timestamp, "sha256=x", secret, now)).toBe(false);
  });
  it("requires exact terms and rejects identity attributes", () => {
    const parsed = paymentEventSchema.parse(event);
    expect(eventMatchesRequest(parsed, request, "branch")).toBe(true);
    expect(eventMatchesRequest(parsed, { ...request, amountMinor: 3501 }, "branch")).toBe(false);
    expect(paymentEventSchema.safeParse({ ...event, data: { ...event.data, studentId: "private" } }).success).toBe(false);
    expect(paymentEventSchema.safeParse({ ...event, type: "payment_request.cancelled" }).success).toBe(false);
  });
  it("acknowledges duplicates by reading UNIFY each time without an operator cookie", async () => {
    vi.stubEnv("UNIFY_PAYMENT_WEBHOOK_SECRET", secret); vi.stubEnv("UNIFY_BRANCH_ID", "branch");
    vi.mocked(oneRequest).mockResolvedValue(request);
    expect((await POST(signed())).status).toBe(200); expect((await POST(signed())).status).toBe(200);
    expect(oneRequest).toHaveBeenCalledTimes(2);
  });
  it("does not confirm forged events, wrong branches or upstream failures", async () => {
    vi.stubEnv("UNIFY_PAYMENT_WEBHOOK_SECRET", secret); vi.stubEnv("UNIFY_BRANCH_ID", "branch");
    expect((await POST(new Request("https://pos.example/api/unify/payment-events", { method: "POST", body: "{}" }))).status).toBe(401);
    expect((await POST(signed({ ...event, data: { ...event.data, branchId: "other" } }))).status).toBe(400);
    vi.mocked(oneRequest).mockRejectedValue(new Error("offline"));
    expect((await POST(signed())).status).toBe(503);
    vi.mocked(oneRequest).mockResolvedValue({ ...request, amountMinor: 3501 });
    expect((await POST(signed())).status).toBe(409);
  });
});
