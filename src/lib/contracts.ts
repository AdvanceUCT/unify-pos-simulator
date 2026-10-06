import { z } from "zod";
export const requestSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{32}$/), branchId: z.string(), orderReference: z.string(),
  vendorName: z.string(), branchName: z.string(), amountMinor: z.number().int().positive().safe(), currency: z.literal("ZAR"),
  status: z.enum(["PENDING", "PAID", "CANCELLED", "EXPIRED"]), createdAt: z.string().datetime(), expiresAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(), transactionId: z.string().nullable(), qrPayload: z.string(),
  // Refund read model; defaults keep older portals (without these fields) readable.
  refundedMinor: z.number().int().nonnegative().safe().default(0), refundableMinor: z.number().int().nonnegative().safe().default(0),
  refundStatus: z.enum(["NONE", "PARTIALLY_REFUNDED", "FULLY_REFUNDED"]).default("NONE"),
  refunds: z.array(z.object({ id: z.string().min(1), amountMinor: z.number().int().positive().safe(), currency: z.literal("ZAR"), source: z.enum(["PORTAL", "API"]), createdAt: z.string().datetime() })).default([]),
});
export type PaymentRequest = z.infer<typeof requestSchema>;
export const refundInputSchema = z.object({ amountMinor: z.number().int().positive().safe(), idempotencyKey: z.string().min(1).max(128) }).strict();
export type RefundInput = z.infer<typeof refundInputSchema>;
export const refundResultSchema = z.object({
  refund: z.object({ id: z.string().min(1), paymentRequestId: z.string(), transactionId: z.string(), amountMinor: z.number().int().positive().safe(), currency: z.literal("ZAR"), source: z.enum(["PORTAL", "API"]), createdAt: z.string().datetime() }),
  paymentRequest: requestSchema,
});
export type RefundResult = z.infer<typeof refundResultSchema>;
export const saleSchema = z.object({ orderReference: z.string().trim().min(1).max(128), idempotencyKey: z.string().min(1).max(128), items: z.array(z.object({ id: z.string().uuid().optional(), description: z.string().trim().min(1).max(120), quantity: z.number().int().min(1).max(999), unitMinor: z.number().int().min(1).max(10_000_000) }).strict()).min(1).max(30) }).strict();
export type Sale = z.infer<typeof saleSchema>;
export function saleTotal(items: Sale["items"]) {
  const amount = items.reduce((sum, item) => sum + item.quantity * item.unitMinor, 0);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("Invalid sale total.");
  return amount;
}
export function parsePrice(value: string) {
  if (!/^\d{1,6}(\.\d{0,2})?$/.test(value)) return null;
  const [whole, cents = ""] = value.split(".");
  return Number(whole) * 100 + Number(cents.padEnd(2, "0"));
}
export function money(minor: number) { return new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(minor / 100); }
