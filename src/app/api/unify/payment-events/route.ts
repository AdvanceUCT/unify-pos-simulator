import { NextResponse } from "next/server";
import { paymentEventSchema, validPaymentSignature, eventMatchesRequest, refundEventMatchesRequest } from "../../../../lib/paymentEvents";
import { oneRequest } from "../../../../lib/upstream";

export const runtime = "nodejs";
// Machine-authenticated exception: cashier APIs still require the operator session.
export async function POST(request: Request) {
  const secret = process.env.UNIFY_PAYMENT_WEBHOOK_SECRET;
  const branchId = process.env.UNIFY_BRANCH_ID;
  if (!secret || !branchId) return NextResponse.json({ error: "Receiver is not configured." }, { status: 503 });
  if (Number(request.headers.get("content-length")) > 32_768) return NextResponse.json({ error: "Event is too large." }, { status: 413 });
  const body = await request.text();
  if (Buffer.byteLength(body) > 32_768) return NextResponse.json({ error: "Event is too large." }, { status: 413 });
  if (!validPaymentSignature(body, request.headers.get("x-unify-timestamp"), request.headers.get("x-unify-signature"), secret)) return NextResponse.json({ error: "Invalid event signature." }, { status: 401 });
  let parsed;
  try { parsed = paymentEventSchema.safeParse(JSON.parse(body)); } catch { return NextResponse.json({ error: "Invalid event." }, { status: 400 }); }
  if (!parsed.success || parsed.data.id !== request.headers.get("x-unify-event-id") || parsed.data.data.branchId !== branchId) return NextResponse.json({ error: "Invalid event terms." }, { status: 400 });
  try {
    const event = parsed.data;
    const authoritative = await oneRequest(event.data.requestId);
    const matches = event.type === "payment_request.refunded"
      ? refundEventMatchesRequest(event, authoritative, branchId)
      : eventMatchesRequest(event, authoritative, branchId);
    if (!matches) return NextResponse.json({ error: "Event does not match the payment request." }, { status: 409 });
    // Stateless acknowledgement: repeated calls are safe. Browser polling obtains the same state.
    return NextResponse.json({
      accepted: true, eventId: event.id, requestId: authoritative.id, status: authoritative.status,
      ...(event.type === "payment_request.refunded" ? { refundId: event.data.refund.id } : {}),
    });
  } catch { return NextResponse.json({ error: "Unable to retrieve authoritative payment state." }, { status: 503 }); }
}
