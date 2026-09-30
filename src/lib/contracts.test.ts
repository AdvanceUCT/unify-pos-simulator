import { describe, it, expect } from "vitest";
import { parsePrice, saleSchema, saleTotal, requestSchema } from "./contracts";
describe("sale contracts", () => {
  it("converts decimal price text without floating-point multiplication", () => { expect(parsePrice("0.29")).toBe(29); expect(parsePrice("28.50")).toBe(2850); expect(parsePrice("1.234")).toBeNull(); expect(parsePrice("-1")).toBeNull(); expect(parsePrice("1e3")).toBeNull(); });
  it("requires an actual itemised sale and safe integer cents", () => { expect(saleTotal([{ description: "Print", quantity: 3, unitMinor: 29 }])).toBe(87); expect(() => saleSchema.parse({ orderReference: "sale", idempotencyKey: "key", items: [{ description: "Print", quantity: 1.5, unitMinor: 150 }] })).toThrow(); });
  it("rejects browser-provided paid receipts missing authoritative fields", () => { expect(() => requestSchema.parse({ status: "PAID", amountMinor: 3500 })).toThrow(); });
});
