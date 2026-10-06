import { z } from "zod";
import { refundOperationSchema, refundRecoverySchema, type RefundOperationView } from "./refundOperationContract";

const draftSchema = z.object({ transactionId: z.string().min(1).optional(), paymentRequestId: z.string().min(1).optional(), amountMinor: z.number().int().positive().safe(), idempotencyKey: z.string().min(1).max(128), operationId: z.string().optional() }).refine(d => Boolean(d.transactionId) !== Boolean(d.paymentRequestId));
export type RefundDraft = z.infer<typeof draftSchema>;
type Scope = { vendorProfileId: string; operatorId: string };
export type RefundRecoveryState = { hydrated: boolean; busy: boolean; operation?: RefundOperationView; draft?: RefundDraft; outcome?: RefundOperationView; error?: string };
const initial: RefundRecoveryState = { hydrated: false, busy: false };

/** Shared browser state machine. Missing/error responses never discard frozen instructions. */
export class RefundRecoveryClient {
  private state: RefundRecoveryState = initial;
  private scope?: Scope;
  private epoch = 0;
  private listeners = new Set<() => void>();
  constructor(private options: { baseUrl: string; storage: () => Pick<Storage, "getItem" | "setItem" | "removeItem">; fetch?: typeof fetch; legacyDraft?: () => RefundDraft | undefined; clearLegacy?: () => void }) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  getServerSnapshot = () => initial;
  private set(value: Partial<RefundRecoveryState>) { this.state = { ...this.state, ...value }; this.listeners.forEach(f => f()); }
  private key() { if (!this.scope) throw new Error("Refund recovery is not hydrated."); return `unify.refund-registration.v1:${this.scope.vendorProfileId}:${this.scope.operatorId}`; }
  private save(draft: RefundDraft) { this.options.storage().setItem(this.key(), JSON.stringify(draft)); this.set({ draft }); }
  private async request(path = "", body?: object) {
    const response = await (this.options.fetch ?? fetch)(this.options.baseUrl + path, { cache: "no-store", ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message ?? data.error ?? "Refund outcome unavailable. Keep this reference and check again.");
    return data;
  }
  private accept(value: unknown, draft?: RefundDraft) {
    const op = refundOperationSchema.parse(value);
    if (!this.scope || op.vendorProfileId !== this.scope.vendorProfileId || (op.status === "PENDING" && op.operatorId !== this.scope.operatorId)) throw new Error("Recover this refund with its original vendor and operator.");
    if (draft && (op.amountMinor !== draft.amountMinor || op.idempotencyKey !== draft.idempotencyKey || (draft.transactionId && op.originalTransactionId !== draft.transactionId) || (draft.paymentRequestId && op.paymentRequestId !== draft.paymentRequestId))) throw new Error("Refund response does not match the frozen instruction.");
    if (op.status === "PENDING") {
      this.save({ ...(op.paymentRequestId ? { paymentRequestId: op.paymentRequestId } : { transactionId: op.originalTransactionId }), amountMinor: op.amountMinor, idempotencyKey: op.idempotencyKey, operationId: op.id });
      this.set({ operation: op, outcome: undefined, error: undefined });
    } else {
      // Clear only after a validated, authoritative terminal outcome.
      this.options.storage().removeItem(this.key());
      this.options.clearLegacy?.();
      this.set({ draft: undefined, operation: undefined, outcome: op, error: undefined });
    }
    return op;
  }
  async hydrate() {
    if (this.state.busy) return;
    const epoch = ++this.epoch;
    this.set({ hydrated: false, busy: true, error: undefined });
    try {
      const recovery = refundRecoverySchema.parse(await this.request());
      if (epoch !== this.epoch) return;
      if (recovery.operation && (recovery.operation.operatorId !== recovery.operatorId || recovery.operation.vendorProfileId !== recovery.vendorProfileId)) throw new Error("Refund recovery scope does not match.");
      this.scope = { vendorProfileId: recovery.vendorProfileId, operatorId: recovery.operatorId };
      const raw = this.options.storage().getItem(this.key());
      const draft = raw ? draftSchema.parse(JSON.parse(raw)) : this.options.legacyDraft?.();
      this.set({ draft, operation: undefined, outcome: undefined });
      if (recovery.operation) this.accept(recovery.operation);
      else if (draft) {
        this.save(draft);
        const value = draft.operationId ? await this.request(`/${encodeURIComponent(draft.operationId)}`) : await this.request("", this.registration(draft));
        if (epoch !== this.epoch) return;
        this.accept(value, draft); // Hydration registers only; it never executes money movement.
      }
      this.set({ hydrated: true });
    } catch (error) { if (epoch === this.epoch) this.set({ error: error instanceof Error ? error.message : "Refund recovery unavailable." }); }
    finally { if (epoch === this.epoch) this.set({ busy: false }); }
  }
  private registration(draft: RefundDraft) { const { operationId: _id, ...body } = draft; void _id; return body; }
  private async run(action: "execute" | "cancel", draft: RefundDraft) {
    let op = this.state.operation;
    if (!op) op = this.accept(await this.request("", this.registration(draft)), draft);
    if (op.status !== "PENDING") return op;
    return this.accept(await this.request(`/${encodeURIComponent(op.id)}/${action}`, {}), draft);
  }
  async submit(input: Omit<RefundDraft, "idempotencyKey" | "operationId">) {
    if (!this.state.hydrated || this.state.busy || this.state.draft || this.state.operation) return;
    const draft = draftSchema.parse({ ...input, idempotencyKey: crypto.randomUUID() });
    this.set({ busy: true, outcome: undefined, error: undefined });
    try { this.save(draft); await this.run("execute", draft); }
    catch (error) { this.set({ error: error instanceof Error ? error.message : "Refund outcome unknown. Check this refund again." }); }
    finally { this.set({ busy: false }); }
  }
  async recover(action: "execute" | "cancel" = "execute") {
    if (!this.scope || !this.state.draft || this.state.busy) return;
    const draft = this.state.draft;
    this.set({ busy: true, error: undefined });
    try { await this.run(action, draft); }
    catch (error) { this.set({ error: error instanceof Error ? error.message : "Refund outcome unknown. Keep this reference." }); }
    finally { this.set({ busy: false }); }
  }
  dispose() { ++this.epoch; this.listeners.clear(); }
}
