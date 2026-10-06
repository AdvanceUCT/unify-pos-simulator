import { randomUUID, createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eventMatchesRequest, paymentEventSchema, refundEventMatchesRequest, refundEventSchema, terminalEventSchema, validPaymentSignature } from "./paymentEvents";
import { POST } from "../app/api/unify/payment-events/route";
import { oneRequest } from "./upstream";
import type { PaymentRequest } from "./contracts";
vi.mock("./upstream", () => ({ oneRequest: vi.fn() }));
const secret = "test-signing-secret";
const request: PaymentRequest = { id: "a".repeat(32), branchId: "branch", orderReference: "order", vendorName: "Test", branchName: "Test branch", amountMinor: 3500, currency: "ZAR", status: "PAID", transactionId: "tx", completedAt: "2026-09-30T10:00:00.000Z", createdAt: "2026-09-30T09:55:00.000Z", expiresAt: "2026-09-30T10:05:00.000Z", qrPayload: `unifywallet://pay-request/${"a".repeat(32)}`, refundedMinor: 0, refundableMinor: 3500, refundStatus: "NONE", refunds: [] };
const event = { id: randomUUID(), version: 1, type: "payment_request.paid", occurredAt: request.completedAt, data: { requestId: request.id, branchId: request.branchId, orderReference: request.orderReference, amountMinor: request.amountMinor, currency: request.currency, status: request.status, transactionId: request.transactionId, completedAt: request.completedAt } };
const refundedRequest: PaymentRequest = { ...request, refundedMinor: 1500, refundableMinor: 2000, refundStatus: "PARTIALLY_REFUNDED", refunds: [{ id: "refund-1", amountMinor: 1500, currency: "ZAR", source: "API", createdAt: "2026-10-06T12:00:00.000Z" }] };
const refundEvent = { id: randomUUID(), version: 1, type: "payment_request.refunded", occurredAt: "2026-10-06T12:00:00.000Z", data: { ...event.data, refund: { id: "refund-1", amountMinor: 1500, source: "API", createdAt: "2026-10-06T12:00:00.000Z" }, refundedMinor: 1500, refundableMinor: 2000 } };
function signed(value: { id: string; data: object } = event) {
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
    const parsed = terminalEventSchema.parse(event);
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

describe("Refund events", () => {
  it("accepts a valid refund event, including when later refunds raised the authoritative total", () => {
    const parsed = refundEventSchema.parse(refundEvent);
    expect(refundEventMatchesRequest(parsed, refundedRequest, "branch")).toBe(true);
    const later = { ...refundedRequest, refundedMinor: 2500, refundableMinor: 1000, refunds: [...refundedRequest.refunds, { id: "refund-2", amountMinor: 1000, currency: "ZAR" as const, source: "PORTAL" as const, createdAt: "2026-10-06T13:00:00.000Z" }] };
    expect(refundEventMatchesRequest(parsed, later, "branch")).toBe(true);
  });
  it("rejects a mismatched amount, unknown refund id, wrong branch or a lower authoritative total", () => {
    const parsed = refundEventSchema.parse(refundEvent);
    expect(refundEventMatchesRequest(parsed, { ...refundedRequest, refunds: [{ ...refundedRequest.refunds[0], amountMinor: 1400 }] }, "branch")).toBe(false);
    expect(refundEventMatchesRequest(parsed, { ...refundedRequest, refunds: [{ ...refundedRequest.refunds[0], id: "refund-x" }] }, "branch")).toBe(false);
    expect(refundEventMatchesRequest(parsed, refundedRequest, "other")).toBe(false);
    expect(refundEventMatchesRequest(parsed, { ...refundedRequest, refundedMinor: 1000 }, "branch")).toBe(false);
  });
  it("is strict and internally consistent", () => {
    expect(paymentEventSchema.safeParse(refundEvent).success).toBe(true);
    expect(paymentEventSchema.safeParse({ ...refundEvent, data: { ...refundEvent.data, studentId: "private" } }).success).toBe(false);
    expect(paymentEventSchema.safeParse({ ...refundEvent, data: { ...refundEvent.data, refundableMinor: 2001 } }).success).toBe(false);
    expect(paymentEventSchema.safeParse({ ...refundEvent, data: { ...refundEvent.data, status: "CANCELLED" } }).success).toBe(false);
  });
  it("acknowledges a signed refund event with its refund id, and rejects one UNIFY does not confirm", async () => {
    vi.stubEnv("UNIFY_PAYMENT_WEBHOOK_SECRET", secret); vi.stubEnv("UNIFY_BRANCH_ID", "branch");
    vi.mocked(oneRequest).mockResolvedValue(refundedRequest);
    const response = await POST(signed(refundEvent));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ accepted: true, refundId: "refund-1", status: "PAID" });
    vi.mocked(oneRequest).mockResolvedValue(request);
    expect((await POST(signed(refundEvent))).status).toBe(409);
  });
  it("still accepts terminal events", async () => {
    vi.stubEnv("UNIFY_PAYMENT_WEBHOOK_SECRET", secret); vi.stubEnv("UNIFY_BRANCH_ID", "branch");
    vi.mocked(oneRequest).mockResolvedValue(refundedRequest);
    expect((await POST(signed())).status).toBe(200);
  });
});
