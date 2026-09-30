import { NextResponse } from "next/server";
import { isOperator, assertOrigin } from "@/lib/operator";
import { oneRequest } from "@/lib/upstream";
async function handle(request: Request, context: { params: Promise<{ id: string }> }, cancel: boolean) {
 if (!await isOperator()) return NextResponse.json({ error: "Operator login required." }, { status: 401 });
 try { if(cancel) assertOrigin(request); return NextResponse.json(await oneRequest((await context.params).id, cancel), { headers: { "Cache-Control": "no-store" } }); }
 catch(error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not confirm sale status." }, { status: 502 }); }
}
export function GET(request: Request, context: { params: Promise<{ id: string }> }) { return handle(request, context, false); }
export function POST(request: Request, context: { params: Promise<{ id: string }> }) { return handle(request, context, true); }
