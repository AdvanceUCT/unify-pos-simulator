import { describe, it, expect } from "vitest";
import { parsePrice, refundInputSchema, saleSchema, saleTotal, requestSchema } from "./contracts";
describe("sale contracts", () => {
  it("converts decimal price text without floating-point multiplication", () => { expect(parsePrice("0.29")).toBe(29); expect(parsePrice("28.50")).toBe(2850); expect(parsePrice("1.234")).toBeNull(); expect(parsePrice("-1")).toBeNull(); expect(parsePrice("1e3")).toBeNull(); });
  it("requires an actual itemised sale and safe integer cents", () => { expect(saleTotal([{ description: "Print", quantity: 3, unitMinor: 29 }])).toBe(87); expect(() => saleSchema.parse({ orderReference: "sale", idempotencyKey: "key", items: [{ description: "Print", quantity: 1.5, unitMinor: 150 }] })).toThrow(); });
  it("rejects browser-provided paid receipts missing authoritative fields", () => { expect(() => requestSchema.parse({ status: "PAID", amountMinor: 3500 })).toThrow(); });
  it("accepts only a strict positive refund amount and a bounded key", () => {
    expect(refundInputSchema.parse({ amountMinor: 3500, idempotencyKey: "key" })).toEqual({ amountMinor: 3500, idempotencyKey: "key" });
    for (const body of [{ amountMinor: 0, idempotencyKey: "key" }, { amountMinor: 1.5, idempotencyKey: "key" }, { amountMinor: 100, idempotencyKey: "" }, { amountMinor: 100, idempotencyKey: "k".repeat(129) }, { amountMinor: 100, idempotencyKey: "key", requestId: "other" }]) {
      expect(refundInputSchema.safeParse(body).success).toBe(false);
    }
  });
  it("reads requests from portals without refund fields", () => {
    const parsed = requestSchema.parse({ id: "a".repeat(32), branchId: "b", orderReference: "o", vendorName: "v", branchName: "n", amountMinor: 100, currency: "ZAR", status: "PAID", createdAt: "2026-10-06T12:00:00.000Z", expiresAt: "2026-10-06T12:10:00.000Z", completedAt: "2026-10-06T12:01:00.000Z", transactionId: "tx", qrPayload: "q" });
    expect(parsed).toMatchObject({ refundedMinor: 0, refundableMinor: 0, refundStatus: "NONE", refunds: [] });
  });
});
