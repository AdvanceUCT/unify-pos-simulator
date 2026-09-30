# Payment callbacks and recovery

This is a test-money demonstration. The receiver is `POST /api/unify/payment-events`. It is authenticated by UNIFY's payment signature; this is the explicit machine-authentication exception. All cashier APIs retain operator-session protection.

Configure a separate payment callback in the TechNest owner's integration screen, selecting only Rondebosch Branch. Use `https://unify-pos-simulator.vercel.app/api/unify/payment-events` and save the newly revealed secret as server-only `UNIFY_PAYMENT_WEBHOOK_SECRET` in Vercel. Redeploy after changing environment values. Never put the vendor key or signing secret in `NEXT_PUBLIC_*`, browser storage or screenshots.

The receiver reads the exact raw body and verifies HMAC-SHA256 of `${timestamp}.${rawBody}` using `X-Unify-Timestamp` and `X-Unify-Signature: sha256=<hex>`. Timestamps must be within five minutes. `X-Unify-Event-Id` must match the body's stable event ID. It validates version, terminal event type/state, configured branch, amount in integer cents, currency, order reference and applicable transaction/completion fields, then retrieves and compares the authoritative UNIFY request. Forged or mismatched events never confirm a sale.

```js
import { createHmac, timingSafeEqual } from "node:crypto";
// Check timestamp format/age and signature shape first (see src/lib/paymentEvents.ts).
const expected = createHmac("sha256", process.env.UNIFY_PAYMENT_WEBHOOK_SECRET)
  .update(`${timestamp}.${rawBody}`).digest();
const valid = timingSafeEqual(expected, Buffer.from(signature.slice(7), "hex"));
```

Every delivery rereads UNIFY; duplicate deliveries have no side effects. A real merchant system should durably deduplicate event IDs before fulfilling an order. This simulator has no database and does not perform fulfilment or post money. Browser polling continues every two seconds with failure backoff. Only an authoritative `PAID` response shows confirmation and enables a receipt. The browser does not depend on the receiver or scheduler being available.

UNIFY creates one immutable event transactionally for paid/cancelled/expired requests. Delivery happens after commit, then a signed QStash dispatcher runs every five minutes. Six automatic attempts use initial delivery followed by 5m, 15m, 1h, 6h and 24h delays. Owner history records attempts, HTTP results and next retry. Exhaustion needs manual retry. Disabling/replacing configuration parks outstanding events; old events move to the replacement only through an explicit owner retry.

For the coordinated demo:

1. Prepare an itemised sale and scan its QR on a locked phone.
2. Unlock, review fixed vendor/branch/reference/total, approve and compare the wallet, POS and portal receipts.
3. Reopen the receipt from wallet activity.
4. Interrupt the response after approval, reopen/reconnect and recover with the original submission key; demonstrate one debit. Repeat with a static QR payment.
5. Demonstrate cancelled and ten-minute-expired QRs.
6. Retry a delivered event in owner history; confirm another valid acknowledgement and no additional debit.
7. With callbacks/scheduler disabled, repeat a small sale and confirm polling still obtains its receipt. Restore callbacks afterwards.

Physical acceptance is pending. CI covers receiver authentication, duplicate delivery, term mismatches, unsafe signatures, upstream failure and existing operator isolation. Full portal contract and setup: [portal checkout documentation](https://github.com/AdvanceUCT/unify-admin-portal/blob/feature/checkout-reliability/docs/checkout-reliability.md).
