import { NextResponse } from "next/server";
import { z } from "zod";
import { isOperator, assertOrigin } from "./operator";
import { refundOperationSchema } from "./refundOperationContract";
import { upstreamRefundOperation } from "./upstream";
export async function refundOperationRoute(request: Request, id: string, action: "read" | "execute" | "cancel") {
 if (!await isOperator()) return NextResponse.json({ error: "Operator login required." }, { status: 401 });
 try {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return NextResponse.json({ error: "Invalid refund reference." }, { status: 400 });
  if (action !== "read") { assertOrigin(request); const body = await request.text(); z.object({}).strict().parse(body ? JSON.parse(body) : {}); }
  const existing = refundOperationSchema.parse(await upstreamRefundOperation(`/${id}`));
  if (existing.branchId !== process.env.UNIFY_BRANCH_ID) return NextResponse.json({ error: "Refund belongs to another terminal branch." }, { status: 403 });
  const op = action === "read" ? existing : refundOperationSchema.parse(await upstreamRefundOperation(`/${id}/${action}`, { method: "POST", body: {} }));
  if (op.id !== existing.id || op.vendorProfileId !== existing.vendorProfileId || op.operatorId !== existing.operatorId || op.originalTransactionId !== existing.originalTransactionId || op.paymentRequestId !== existing.paymentRequestId || op.amountMinor !== existing.amountMinor || op.idempotencyKey !== existing.idempotencyKey || op.branchId !== existing.branchId) throw new Error("Refund instructions changed.");
  return NextResponse.json(op, { headers: { "Cache-Control": "no-store" } });
 } catch { return NextResponse.json({ error: "Refund outcome unavailable. Check the same reference again." }, { status: 502 }); }
}
