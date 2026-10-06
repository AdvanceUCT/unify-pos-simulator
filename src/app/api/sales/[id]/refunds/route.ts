import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { isOperator, assertOrigin, InvalidOriginError } from "../../../../../lib/operator";
import { refundInputSchema } from "../../../../../lib/contracts";
import { refundRequest, UpstreamError } from "../../../../../lib/upstream";
// UNIFY rejections the cashier can act on keep their status; anything else is an unknown outcome (502) to retry with the same key.
const DEFINITIVE_UPSTREAM = new Set([400, 403, 404, 409]);
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
 if (!await isOperator()) return NextResponse.json({ error: "Operator login required." }, { status: 401 });
 const id = (await context.params).id;
 let body;
 try {
  assertOrigin(request);
  if (!/^[A-Za-z0-9_-]{32}$/.test(id)) return NextResponse.json({ error: "Invalid request reference." }, { status: 400 });
  body = refundInputSchema.parse(await request.json());
 } catch(error) {
  if (error instanceof InvalidOriginError) return NextResponse.json({ error: error.message }, { status: 403 });
  if (error instanceof ZodError || error instanceof SyntaxError) return NextResponse.json({ error: "Refund request is invalid." }, { status: 400 });
  throw error;
 }
 try {
  const result = await refundRequest(id, body);
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
 } catch(error) {
  if (error instanceof UpstreamError && DEFINITIVE_UPSTREAM.has(error.status)) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  return NextResponse.json({ error: "Refund outcome unknown. Check the refund again with the same reference." }, { status: 502 });
 }
}
