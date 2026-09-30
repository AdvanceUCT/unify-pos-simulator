import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { PaymentRequest } from "./contracts";

export const paymentEventSchema = z.object({
  id: z.string().uuid(), version: z.literal(1),
  type: z.enum(["payment_request.paid", "payment_request.cancelled", "payment_request.expired"]),
  occurredAt: z.string().datetime(),
  data: z.object({
    requestId: z.string().regex(/^[A-Za-z0-9_-]{32}$/), branchId: z.string().min(1), orderReference: z.string().min(1).max(128),
    amountMinor: z.number().int().positive().safe(), currency: z.literal("ZAR"), status: z.enum(["PAID", "CANCELLED", "EXPIRED"]),
    transactionId: z.string().min(1).nullable(), completedAt: z.string().datetime().nullable(),
  }).strict(),
}).strict().refine((event) => event.type === `payment_request.${event.data.status.toLowerCase()}`)
  .refine((event) => event.data.status === "PAID" ? Boolean(event.data.transactionId && event.data.completedAt) : event.data.transactionId === null && event.data.completedAt === null);
export type PaymentEvent = z.infer<typeof paymentEventSchema>;

export function validPaymentSignature(body: string, timestamp: string | null, signature: string | null, secret: string, now = Date.now()) {
  if (!secret || !timestamp || !/^\d{10}$/.test(timestamp) || !signature || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  if (Math.abs(Math.floor(now / 1000) - Number(timestamp)) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), "hex"));
}
export function eventMatchesRequest(event: PaymentEvent, request: PaymentRequest, branchId: string) {
  const data = event.data;
  return data.branchId === branchId && request.branchId === branchId && data.requestId === request.id &&
    data.orderReference === request.orderReference && data.amountMinor === request.amountMinor && data.currency === request.currency &&
    data.status === request.status && data.transactionId === request.transactionId && data.completedAt === request.completedAt;
}
