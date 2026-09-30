import { NextResponse } from "next/server";
import { allowLogin, assertOrigin, clearOperatorSession, equalSecret, saveOperatorSession } from "@/lib/operator";
export async function POST(request: Request) {
 try {
  assertOrigin(request);
  if (!await allowLogin(request)) return NextResponse.json({ error: "Too many attempts. Try again in fifteen minutes." }, { status: 429 });
  const { password } = await request.json();
  const expected = process.env.POS_OPERATOR_PASSWORD;
  if (!expected || expected.length < 16) return NextResponse.json({ error: "Operator access is not configured." }, { status: 503 });
  if (typeof password !== "string" || password.length > 256 || !equalSecret(password, expected)) return NextResponse.json({ error: "Invalid operator password." }, { status: 401 });
  await saveOperatorSession(); return NextResponse.json({ ok: true });
 } catch { return NextResponse.json({ error: "Operator login is unavailable or the request origin is invalid." }, { status: 503 }); }
}
export async function DELETE(request: Request) {
 try { assertOrigin(request); await clearOperatorSession(); return NextResponse.json({ ok: true }); }
 catch { return NextResponse.json({ error: "Invalid request origin." }, { status: 403 }); }
}
