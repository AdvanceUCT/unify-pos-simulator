import { z } from "zod";

export const refundRegistrationSchema = z.object({ amountMinor: z.number().int().positive().safe(), idempotencyKey: z.string().trim().min(1).max(128) }).strict();
export const refundResultContract = z.object({
  originalTransactionId: z.string().min(1), refundTransactionId: z.string().min(1), paymentRequestId: z.string().nullable(),
  refundedAmountMinor: z.number().int().positive().safe(), totalRefundedMinor: z.number().int().nonnegative().safe(),
  remainingRefundableMinor: z.number().int().nonnegative().safe(), refundStatus: z.enum(["NONE", "PARTIALLY_REFUNDED", "FULLY_REFUNDED"]),
  vendorBalanceMinor: z.number().int().safe(), replayed: z.boolean(),
  refund: z.object({ id: z.string().min(1), amountMinor: z.number().int().positive().safe(), currency: z.literal("ZAR"), source: z.enum(["PORTAL", "API"]), createdAt: z.string().datetime() }),
});
export const refundOperationSchema = z.object({
  id: z.string().min(1), vendorProfileId: z.string().min(1), operatorId: z.string().min(1), originalTransactionId: z.string().min(1),
  paymentRequestId: z.string().nullable(), branchId: z.string().min(1), amountMinor: z.number().int().positive().safe(), currency: z.literal("ZAR"),
  idempotencyKey: z.string().min(1).max(128), status: z.enum(["PENDING", "COMPLETED", "REJECTED", "CANCELLED"]),
  createdAt: z.string().datetime(), resolvedAt: z.string().datetime().nullable(), result: refundResultContract.optional(),
  rejection: z.object({ code: z.string().min(1), message: z.string(), status: z.number().int().min(400).max(599) }).optional(),
}).superRefine((op, ctx) => {
  if (op.status === "COMPLETED" && (!op.result || op.result.originalTransactionId !== op.originalTransactionId || op.result.refundedAmountMinor !== op.amountMinor || op.result.paymentRequestId !== op.paymentRequestId || op.result.refund.id !== op.result.refundTransactionId || op.result.refund.amountMinor !== op.amountMinor)) ctx.addIssue({ code: "custom", message: "Refund result does not match its instructions." });
  if ((op.status === "REJECTED") !== Boolean(op.rejection) || (op.status === "COMPLETED") !== Boolean(op.result) || (op.status === "PENDING") !== (op.resolvedAt === null)) ctx.addIssue({ code: "custom", message: "Invalid refund outcome." });
});
export const refundRecoverySchema = z.object({ vendorProfileId: z.string().min(1), operatorId: z.string().min(1), operation: refundOperationSchema.nullable() });
export type RefundOperationView = z.infer<typeof refundOperationSchema>;
