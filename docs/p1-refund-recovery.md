# Durable refund recovery (PR #3 follow-up)

Depends on the additive portal refund-operation contract in PR #122. Deploy the portal first; there is no new environment variable, key scope or production deployment in this implementation.

The terminal hydrates `/api/refund-operations` before enabling refunds. Registration freezes and durably stores the payment request, amount and key before execution. GET collection discovers the API credential's server-backed pending operation across browsers. GET `/{id}` recovers a recorded outcome. POST `/{id}/execute` and `/cancel` accept no replacement amounts. Server routes require the operator session and same-origin mutations, validate the portal's operation contract and keep the request bound to the configured branch.

A 401/403, missing record, timeout, provider 5xx or malformed success body retains the original reference. Only COMPLETED, REJECTED or CANCELLED clears it. The old `unify.pos.refund.v1` record is imported using its original terms/key; it is removed only after authoritative resolution. Current references are stored per vendor/API credential. Hydration and import never execute money movement automatically.

Completion refreshes the authoritative payment request and refund slip. Payment receipts and callback validation keep their existing contracts. The compatibility `/api/sales/{id}/refunds` endpoint remains available; the terminal uses the new registration/execution protocol.

Regression checks run only in GitHub Actions, using protocol/controller tests and mocked upstream responses. Portal PostgreSQL tests exercise the actual durable operation and ledger contract. The P2 findings remain deferred; no merge, deployment or live financial records are part of this change.
