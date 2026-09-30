/* eslint-disable @next/next/no-img-element -- QR is a locally generated data URI, not remote media. */
"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import Link from "next/link";
import { money, parsePrice, requestSchema, saleSchema, type PaymentRequest, type Sale } from "@/lib/contracts";
const STORAGE = "unify.pos.terminal.v1";
const examples = [
  { name: "Campus café", items: [{ description: "Flat white", quantity: 1, unitMinor: 2800 }, { description: "Blueberry muffin", quantity: 1, unitMinor: 2200 }] },
  { name: "Print counter", items: [{ description: "A4 printing", quantity: 10, unitMinor: 150 }] },
  { name: "Lunch checkout", items: [{ description: "Lunch special", quantity: 1, unitMinor: 4500 }] },
];
type Saved = { sale: Sale; submitted: boolean; requestId?: string; snapshots: Record<string, Sale["items"]> };
function newSale(items = examples[0].items): Sale { return { orderReference: `POS-${new Date().toISOString().slice(0,10)}-${crypto.randomUUID().slice(0,8).toUpperCase()}`, idempotencyKey: crypto.randomUUID(), items: items.map((item) => ({ ...item, id: crypto.randomUUID() })) }; }
async function api(path: string, body?: object) {
  const response = await fetch(`/api/sales${path}`, { cache: "no-store", ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Could not confirm the sale."); return data;
}
function PriceInput({ value, disabled, onChange }: { value: number; disabled: boolean; onChange: (value: number) => void }) {
  const [text, setText] = useState((value / 100).toFixed(2));
  return <input aria-label="Unit price in rand" inputMode="decimal" value={text} disabled={disabled} onChange={(event) => { setText(event.target.value); onChange(parsePrice(event.target.value) ?? 0); }} />;
}
export function Terminal() {
  const router = useRouter();
  const [saved, setSaved] = useState<Saved>(); const [request, setRequest] = useState<PaymentRequest>();
  const [history, setHistory] = useState<PaymentRequest[]>([]); const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [qr, setQr] = useState<{ id: string; url: string }>(); const [now, setNow] = useState(0);
  const [customer, setCustomer] = useState(false); const [synced, setSynced] = useState(""); const guard = useRef(false); const current = useRef<Saved | undefined>(undefined);
  function persist(next: Saved) { localStorage.setItem(STORAGE, JSON.stringify(next)); current.current = next; setSaved(next); }
  async function refreshHistory(next?: string) {
    try { const result = await api(next ? `?cursor=${encodeURIComponent(next)}` : ""); const items = result.items.map((item: unknown) => requestSchema.parse(item)); setHistory((old) => next ? [...old, ...items] : items); setCursor(result.nextCursor); } catch(error) { setError(error instanceof Error ? error.message : "History is unavailable."); }
  }
  function accept(result: PaymentRequest) { if (current.current?.requestId && current.current.requestId !== result.id) return; setRequest((previous) => previous?.id === result.id && previous.status !== "PENDING" ? previous : result); setSynced(new Date().toLocaleTimeString()); setError(""); }
  useEffect(() => {
    let initial: Saved;
    try { const raw = JSON.parse(localStorage.getItem(STORAGE) ?? "null"); const sale = saleSchema.parse(raw?.sale); sale.items = sale.items.map((item) => ({ ...item, id: item.id ?? crypto.randomUUID() })); initial = { sale, submitted: raw.submitted === true, requestId: /^[A-Za-z0-9_-]{32}$/.test(raw.requestId ?? "") ? raw.requestId : undefined, snapshots: raw.snapshots && typeof raw.snapshots === "object" ? raw.snapshots : {} }; }
    catch { initial = { sale: newSale(), submitted: false, snapshots: {} }; }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Hydrate browser-only persistent storage after server rendering.
    persist(initial); setNow(Date.now()); void refreshHistory();
    if(initial.requestId) void api(`/${initial.requestId}`).then((result) => accept(requestSchema.parse(result))).catch((error) => setError(error.message));
    const tick = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(tick);
    // Storage is hydrated once; subsequent changes are synchronously persisted.
  }, []);
  useEffect(() => {
    if (!request) return;
    let active = true;
    void QRCode.toDataURL(request.qrPayload, { width: 480, margin: 4, errorCorrectionLevel: "M", color: { dark: "#102820", light: "#ffffff" } }).then((url) => { if(active) setQr({ id: request.id, url }); });
    return () => { active = false; };
  }, [request]);
  const activeRequestId = saved?.requestId;
  useEffect(() => {
    if (!activeRequestId || request?.status && request.status !== "PENDING") return;
    let stopped = false; let delay = 2000; let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      if(stopped) return;
      try {
        const next = requestSchema.parse(await api(`/${activeRequestId}`));
        if(stopped) return; accept(next); delay = 2000;
        if(next.status !== "PENDING") { void refreshHistory(); return; }
      } catch(error) { if(stopped) return; setError(error instanceof Error ? error.message : "Connection lost. Checking the same sale again."); delay = Math.min(delay * 2, 30_000); }
      timer = setTimeout(poll, delay);
    }
    const reconnect = () => { clearTimeout(timer); timer = setTimeout(poll, 0); };
    timer = setTimeout(poll, 2000); window.addEventListener("online", reconnect);
    return () => { stopped = true; clearTimeout(timer); window.removeEventListener("online", reconnect); };
    // Polling owns a stable request reference and stops only on server-confirmed terminal state.
  }, [activeRequestId, request?.status]);
  async function create() {
    if(guard.current || !current.current) return; guard.current = true; setBusy(true); setError("");
    try {
      const sale = saleSchema.parse(current.current.sale);
      const frozen = { ...current.current, sale, submitted: true };
      persist(frozen); // A lost response must never unfreeze or change the instruction.
      const result = requestSchema.parse(await api("", sale));
      const snapshots = { ...frozen.snapshots, [result.id]: sale.items };
      for(const key of Object.keys(snapshots).slice(0, Math.max(0, Object.keys(snapshots).length - 50))) delete snapshots[key];
      persist({ ...frozen, requestId: result.id, snapshots }); accept(result); void refreshHistory();
    } catch(error) { setError(error instanceof Error ? `${error.message} Recover this sale using the same reference.` : "Sale outcome unknown. Recover this sale."); }
    finally { guard.current = false; setBusy(false); }
  }
  async function recoverOrCancel(cancel = false) {
    if(guard.current) return;
    if(!current.current?.requestId) { await create(); return; }
    guard.current = true; setBusy(true);
    try { accept(requestSchema.parse(await api(`/${current.current.requestId}`, cancel ? {} : undefined))); void refreshHistory(); }
    catch(error) { setError(error instanceof Error ? error.message : "Could not confirm result. Check the same reference again."); }
    finally { guard.current = false; setBusy(false); }
  }
  if(!saved) return <main className="loading">Opening terminal…</main>;
  const total = saved.sale.items.reduce((sum, item) => sum + item.quantity * item.unitMinor, 0);
  const editable = !saved.submitted; const terminal = Boolean(request && request.status !== "PENDING");
  const remaining = request ? Math.max(0, Math.ceil((Date.parse(request.expiresAt) - now) / 1000)) : 0;
  function updateItems(items: Sale["items"]) { persist({ ...saved!, sale: { ...saved!.sale, items } }); }
  const receiptItems = request ? saved.snapshots[request.id] : undefined;
  return <main className={`terminal ${customer ? "customer-mode" : ""}`}>
    <header className="mast"><Link href="/" className="brand">UNIFY<span> / POS</span></Link><div><span className="test-label">TEST MONEY</span><button className="quiet" onClick={async() => { await fetch("/api/operator", { method: "DELETE" }); router.refresh(); }}>Sign out</button></div></header>
    <section className="workspace">
      <div className="sale-pane">
        <div className="section-title"><div><p className="eyebrow">CASHIER WORKSPACE</p><h1>Prepared sale</h1></div><span className="terminal-tag">Terminal 01</span></div>
        <div className="examples">{examples.map((example) => <button className="quiet" disabled={!editable} key={example.name} onClick={() => persist({ ...saved, sale: newSale(example.items) })}>{example.name}</button>)}</div>
        <label className="reference-label">Order reference<input value={saved.sale.orderReference} disabled={!editable} maxLength={128} onChange={(event) => persist({ ...saved, sale: { ...saved.sale, orderReference: event.target.value } })} /></label>
        <div className="item-header"><span>ITEM</span><span>QTY</span><span>UNIT / ZAR</span><span>TOTAL</span><span /></div>
        {saved.sale.items.map((item,index) => <div className="item-row" key={item.id ?? `${saved.sale.idempotencyKey}-${index}`}><input aria-label={`Item ${index + 1} description`} disabled={!editable} maxLength={120} value={item.description} onChange={(event) => updateItems(saved.sale.items.map((old,i) => i === index ? { ...old, description: event.target.value } : old))} /><input aria-label={`Item ${index + 1} quantity`} disabled={!editable} type="number" min={1} max={999} step={1} value={item.quantity} onChange={(event) => updateItems(saved.sale.items.map((old,i) => i === index ? { ...old, quantity: Number(event.target.value) } : old))} /><PriceInput value={item.unitMinor} disabled={!editable} onChange={(value) => updateItems(saved.sale.items.map((old,i) => i === index ? { ...old, unitMinor: value } : old))} /><strong>{money(item.quantity * item.unitMinor)}</strong><button className="remove" aria-label={`Remove item ${index + 1}`} disabled={!editable || saved.sale.items.length <= 1} onClick={() => updateItems(saved.sale.items.filter((_,i) => i !== index))}>×</button></div>)}
        <button className="quiet add" disabled={!editable || saved.sale.items.length >= 30} onClick={() => updateItems([...saved.sale.items, { id: crypto.randomUUID(), description: "New item", quantity: 1, unitMinor: 100 }])}>+ Add item</button>
        <div className="total"><span>Sale total <small>ZAR · no purchase commission</small></span><strong>{money(total)}</strong></div>
        {editable ? <button className="button full" disabled={busy} onClick={() => void create()}>Create UNIFY checkout <span>↗</span></button> : <div className="actions"><button className="button" disabled={busy} onClick={() => void recoverOrCancel()}>{busy ? "Checking…" : saved.requestId ? "Refresh status" : "Recover sale"}</button>{request?.status === "PENDING" && <button className="secondary" disabled={busy} onClick={() => void recoverOrCancel(true)}>Cancel unpaid sale</button>}{terminal && <button className="secondary" onClick={() => { persist({ sale: newSale(), submitted: false, snapshots: saved.snapshots }); setRequest(undefined); setError(""); }}>New sale +</button>}</div>}
        {saved.submitted && <p className="helper">Sale terms are fixed. Check this reference before starting another checkout.</p>}
        {error && <p role="alert" className="notice">{error}</p>}
      </div>
      <aside className="checkout-pane">
        <div className="section-title"><p className="eyebrow">CUSTOMER DISPLAY</p><button className="quiet" onClick={() => setCustomer(!customer)}>{customer ? "Back to cashier" : "Expand ↗"}</button></div>
        {request ? <div className="checkout"><p className="vendor">{request.vendorName} <span>{request.branchName}</span></p><h2>{money(request.amountMinor)}</h2><p className="order">{request.orderReference}</p><div className={`qr-plane ${request.status === "PAID" ? "paid" : ""}`}>
          {request.status === "PENDING" && remaining > 0 && qr?.id === request.id ? <img src={qr.url} alt="Scan with the UNIFY wallet to review this sale" width={320} height={320} /> : <div className="outcome"><span>{request.status === "PAID" ? "✓" : request.status === "CANCELLED" ? "×" : "—"}</span><h3>{request.status === "PAID" ? "Payment confirmed" : request.status === "PENDING" ? "Checking expiry" : request.status === "EXPIRED" ? "Request expired" : "Sale cancelled"}</h3></div>}
        </div><p className="status" aria-live="polite">{request.status === "PENDING" ? remaining > 0 ? `Scan in UNIFY · ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2,"0")} remaining` : "Awaiting server confirmation of expiry" : request.status === "PAID" ? "Payment received in the vendor wallet" : "This request cannot be paid"}</p><p className="helper">{synced ? `Last confirmed ${synced}` : "Checking UNIFY"}</p>
        {request.status === "PAID" && <div className="receipt-summary"><p>Transaction: {request.transactionId}</p><p>Completed: {new Date(request.completedAt!).toLocaleString("en-ZA")}</p><button className="secondary" onClick={() => window.print()}>Print payment receipt</button></div>}</div> : <div className="empty-checkout"><div className="qr-placeholder"><span>U</span></div><h2>Ready when you are.</h2><p>Create the sale to display a secure payment QR.</p><small>The student reviews and approves the fixed total in their wallet.</small></div>}
      </aside>
    </section>
    <section className="history"><div className="section-title"><div><p className="eyebrow">FROM UNIFY</p><h2>Recent sales</h2></div><button className="quiet" onClick={() => void refreshHistory()}>Refresh history ↻</button></div><div className="table-scroll"><table><thead><tr><th>Order reference</th><th>Branch</th><th>Amount</th><th>Outcome</th><th>Created</th><th /></tr></thead><tbody>{history.map((sale) => <tr key={sale.id}><td>{sale.orderReference}</td><td>{sale.branchName}</td><td>{money(sale.amountMinor)}</td><td><span className={`state state-${sale.status.toLowerCase()}`}>{sale.status}</span></td><td>{new Date(sale.createdAt).toLocaleString("en-ZA")}</td><td><button className="quiet" disabled={busy || saved.submitted && !terminal && saved.requestId !== sale.id} onClick={() => { persist({ ...saved, submitted: true, requestId: sale.id, sale: { ...saved.sale, orderReference: sale.orderReference, items: saved.snapshots[sale.id] ?? [{ description: "Payment total", quantity: 1, unitMinor: sale.amountMinor }] } }); accept(sale); }}>View →</button></td></tr>)}</tbody></table></div>{!history.length && <p className="helper">Your confirmed and unpaid requests will appear here.</p>}{cursor && <button className="quiet" onClick={() => void refreshHistory(cursor)}>Load more sales</button>}</section>
    {request?.status === "PAID" && <section className="print-receipt"><h1>UNIFY · Payment receipt</h1><p>TEST-MONEY DEMONSTRATION</p><h2>{request.vendorName}</h2><p>{request.branchName}</p><p>Order: {request.orderReference}</p>{receiptItems?.map((item,index) => <p key={index}>{item.quantity} × {item.description} · {money(item.quantity * item.unitMinor)}</p>)}<h2>Total {money(request.amountMinor)}</h2><p>Payment method: UNIFY wallet</p><p>Transaction: {request.transactionId}</p><p>Completed: {request.completedAt}</p><p>Authoritative payment receipt. Item breakdown is a local sale snapshot when available.</p></section>}
    <footer>UNIFY POS simulator · Prepared sales and authoritative wallet payments · Test funds only.</footer>
  </main>;
}
