import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { PaymentRequest } from "./contracts";

const requestFields = {
  requestId: z.string().regex(/^[A-Za-z0-9_-]{32}$/), branchId: z.string().min(1), orderReference: z.string().min(1).max(128),
  amountMinor: z.number().int().positive().safe(), currency: z.literal("ZAR"),
};
export const terminalEventSchema = z.object({
  id: z.string().uuid(), version: z.literal(1),
  type: z.enum(["payment_request.paid", "payment_request.cancelled", "payment_request.expired"]),
  occurredAt: z.string().datetime(),
  data: z.object({
    ...requestFields, status: z.enum(["PAID", "CANCELLED", "EXPIRED"]),
    transactionId: z.string().min(1).nullable(), completedAt: z.string().datetime().nullable(),
  }).strict(),
}).strict().refine((event) => event.type === `payment_request.${event.data.status.toLowerCase()}`)
  .refine((event) => event.data.status === "PAID" ? Boolean(event.data.transactionId && event.data.completedAt) : event.data.transactionId === null && event.data.completedAt === null);
/** One event per completed refund; `refundedMinor` / `refundableMinor` are cumulative as of this refund. */
export const refundEventSchema = z.object({
  id: z.string().uuid(), version: z.literal(1), type: z.literal("payment_request.refunded"), occurredAt: z.string().datetime(),
  data: z.object({
    ...requestFields, status: z.literal("PAID"), transactionId: z.string().min(1), completedAt: z.string().datetime(),
    refund: z.object({ id: z.string().min(1), amountMinor: z.number().int().positive().safe(), source: z.enum(["PORTAL", "API"]), createdAt: z.string().datetime() }).strict(),
    refundedMinor: z.number().int().positive().safe(), refundableMinor: z.number().int().nonnegative().safe(),
  }).strict(),
}).strict().refine((event) => event.data.refundedMinor + event.data.refundableMinor === event.data.amountMinor)
  .refine((event) => event.data.refund.amountMinor <= event.data.refundedMinor);
export const paymentEventSchema = z.union([terminalEventSchema, refundEventSchema]);
export type TerminalEvent = z.infer<typeof terminalEventSchema>;
export type RefundEvent = z.infer<typeof refundEventSchema>;
export type PaymentEvent = z.infer<typeof paymentEventSchema>;

export function validPaymentSignature(body: string, timestamp: string | null, signature: string | null, secret: string, now = Date.now()) {
  if (!secret || !timestamp || !/^\d{10}$/.test(timestamp) || !signature || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  if (Math.abs(Math.floor(now / 1000) - Number(timestamp)) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), "hex"));
}
export function eventMatchesRequest(event: TerminalEvent, request: PaymentRequest, branchId: string) {
  const data = event.data;
  return data.branchId === branchId && request.branchId === branchId && data.requestId === request.id &&
    data.orderReference === request.orderReference && data.amountMinor === request.amountMinor && data.currency === request.currency &&
    data.status === request.status && data.transactionId === request.transactionId && data.completedAt === request.completedAt;
}
/** Later refunds may already exist, so the authoritative total may exceed the event's, never fall below it. */
export function refundEventMatchesRequest(event: RefundEvent, request: PaymentRequest, branchId: string) {
  const data = event.data;
  const refund = request.refunds.find((item) => item.id === data.refund.id);
  return data.branchId === branchId && request.branchId === branchId && data.requestId === request.id &&
    data.orderReference === request.orderReference && data.amountMinor === request.amountMinor && data.currency === request.currency &&
    request.status === "PAID" && data.transactionId === request.transactionId &&
    refund?.amountMinor === data.refund.amountMinor && request.refundedMinor >= data.refundedMinor;
}
