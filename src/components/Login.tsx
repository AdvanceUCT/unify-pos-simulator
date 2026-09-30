"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
export function Login() {
 const router = useRouter(); const [error,setError] = useState(""); const [busy,setBusy] = useState(false);
 return <main className="login"><Link href="/" className="brand">UNIFY / POS</Link><form onSubmit={async(event) => { event.preventDefault(); setBusy(true); setError(""); const password = new FormData(event.currentTarget).get("password"); try { const response = await fetch("/api/operator", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({password}) }); const body = await response.json(); if(!response.ok) throw new Error(body.error); router.refresh(); } catch(error) { setError(error instanceof Error ? error.message : "Could not sign in."); } finally { setBusy(false); } }}><p className="eyebrow">OPERATOR ACCESS</p><h1>Open your terminal.</h1><label htmlFor="password">Demo password</label><input id="password" name="password" type="password" autoComplete="current-password" required maxLength={256} /><button disabled={busy}>{busy ? "Signing in…" : "Sign in →"}</button><p role="alert">{error}</p><small>Test-money environment. Your operator session lasts eight hours.</small></form></main>;
}
