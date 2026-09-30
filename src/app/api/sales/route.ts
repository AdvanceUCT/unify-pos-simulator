import { NextResponse } from "next/server";
import { z } from "zod";
import { isOperator, assertOrigin } from "@/lib/operator";
import { saleSchema, saleTotal, requestSchema } from "@/lib/contracts";
import { upstream } from "@/lib/upstream";
export async function POST(request: Request) {
 if (!await isOperator()) return NextResponse.json({ error: "Operator login required." }, { status: 401 });
 try {
  assertOrigin(request);
  const sale = saleSchema.parse(await request.json());
  const result = requestSchema.parse(await upstream("", { method: "POST", body: { branchId: process.env.UNIFY_BRANCH_ID, orderReference: sale.orderReference, amountMinor: saleTotal(sale.items), currency: "ZAR", idempotencyKey: sale.idempotencyKey } }));
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
 } catch(error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Sale result is unknown. Retry with the same reference." }, { status: 400 }); }
}
export async function GET(request: Request) {
 if (!await isOperator()) return NextResponse.json({ error: "Operator login required." }, { status: 401 });
 try {
  const search = new URL(request.url).searchParams;
  const query = new URLSearchParams({ limit: "20" });
  for (const key of ["cursor", "orderReference"]) { const value = search.get(key); if (value) query.set(key, value); }
  const result = z.object({ items: z.array(requestSchema), nextCursor: z.string().nullable() }).parse(await upstream(`?${query}`));
  return NextResponse.json({ ...result, items: result.items.filter((item) => item.branchId === process.env.UNIFY_BRANCH_ID) }, { headers: { "Cache-Control": "no-store" } });
 } catch { return NextResponse.json({ error: "Could not retrieve UNIFY sale history." }, { status: 502 }); }
}
