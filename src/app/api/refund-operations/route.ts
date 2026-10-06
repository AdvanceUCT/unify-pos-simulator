import { NextResponse } from "next/server";
import { z } from "zod";
import { isOperator, assertOrigin } from "../../../lib/operator";
import { refundOperationSchema, refundRecoverySchema, refundRegistrationSchema } from "../../../lib/refundOperationContract";
import { upstreamRefundOperation } from "../../../lib/upstream";
export async function GET() {
 if (!await isOperator()) return NextResponse.json({ error: "Operator login required." }, { status: 401 });
 try {
  const snapshot = refundRecoverySchema.parse(await upstreamRefundOperation(""));
  if (snapshot.operation && snapshot.operation.branchId !== process.env.UNIFY_BRANCH_ID) return NextResponse.json({ error: "Recover the pending refund on its original terminal branch." }, { status: 403 });
  return NextResponse.json(snapshot, { headers: { "Cache-Control": "no-store" } });
 } catch { return NextResponse.json({ error: "Refund recovery unavailable. Keep the original reference." }, { status: 502 }); }
}
export async function POST(request: Request) {
 if (!await isOperator()) return NextResponse.json({ error: "Operator login required." }, { status: 401 });
 try {
  assertOrigin(request);
  const body = refundRegistrationSchema.extend({ paymentRequestId: z.string().regex(/^[A-Za-z0-9_-]{32}$/) }).strict().parse(await request.json());
  const op = refundOperationSchema.parse(await upstreamRefundOperation("", { method: "POST", body }));
  if (op.branchId !== process.env.UNIFY_BRANCH_ID) return NextResponse.json({ error: "Recover the refund on its original terminal branch." }, { status: 403 });
  return NextResponse.json(op, { headers: { "Cache-Control": "no-store" } });
 } catch { return NextResponse.json({ error: "Refund registration outcome unavailable. Keep the original reference." }, { status: 502 }); }
}
