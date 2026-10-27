# Verified order operations workflow

Status: implementation plan / release gate. This document does not create or modify orders.

## Non-negotiable data rules

- A canonical customer order is created only by the existing validated checkout path in `vendor-storefronts`, which writes `public.orders`.
- Never insert made-up customers or order rows to reach a target count. Never mark an order paid without verified payment evidence, or fulfilled without an actual dispatch/delivery event.
- Do not use `storefront_orders` as a second order ledger for the same purchase. Before changing any adapter, determine which legacy paths still write there and whether they are isolated from canonical orders.
- Keep `orders.idempotency_key` uniqueness and the existing stock, platform-fee, vendor-plan-fee, cancellation/refund, notification, and audit triggers authoritative.
- Keep all vendor reads and mutations scoped to the authenticated admin's `vendor_id`; the client never chooses its own authoritative tenant.
- Production metrics must be derived from canonical backend records and explicitly label their status semantics. Pending orders are not paid revenue.

## Order lifecycle

1. **Submitted** — customer confirms checkout; server validates session/guest identity, active vendor/host, product ownership, published status, database price, options, stock, shipping, discounts, payment method and idempotency token. The order is stored once in `public.orders`; existing database triggers handle inventory and fee snapshots.
2. **Payment pending** — for COD or manual transfer, preserve the actual payment state. A submitted screenshot is evidence awaiting review, not proof of payment.
3. **Payment review** — vendor admin opens the order in `/admin/orders`, checks the uploaded proof against the actual receiving account/transaction, and uses the existing payment verification action. Approve only after the transfer is independently visible; reject with a customer-readable reason.
4. **Confirmed** — only use for an order that meets the store's confirmation policy. For prepaid manual transfer, the existing `verifyPayment` action marks payment paid and advances a pending order to confirmed. Do not use it as a generic order-creation mechanism.
5. **Packing / shipped / delivered** — advance only after the corresponding real operational event. Record courier and tracking information when actually available; notify the customer after the state change.
6. **Cancelled / refunded** — record the real reason and use the existing cancellation/refund path so stock restoration and billing credits happen once. Never delete an order to hide it from statistics.

## Required engineering hardening before unattended processing

- Add an explicit transition matrix to the server-side status actions; reject invalid state jumps rather than trusting the UI.
- Make each mutation conditional on both order ID and authenticated `vendor_id`, and verify exactly one row was updated. Preserve RLS as a second boundary.
- Prevent approving payment twice or changing a terminal/refunded payment back to paid without an audited reversal path.
- Move post-commit notifications to a durable outbox or equivalent retry-safe mechanism. A mail/WhatsApp failure must not imply that the order transaction failed, and retries must not duplicate orders.
- Derive sales/revenue metrics from canonical orders with documented status/payment filters; exclude cancelled, refunded, failed, test and duplicate records from paid-sales metrics.
- Add integration tests for tenant isolation, duplicate submissions, concurrent stock exhaustion, payment review, valid/invalid status transitions, cancellation/restock, notification retries, and metric calculations.
- Exercise checkout E2E only in a disposable test environment with synthetic identities/data. Never use production checkout to manufacture test orders.

## Operator checklist for every real order

- [ ] Customer and delivery details came from the customer or an authorized source.
- [ ] Order items, quantities, vendor and totals match the canonical order record.
- [ ] Stock was reserved/decremented by the existing transactional path.
- [ ] Payment state matches independently verified evidence or the selected COD policy.
- [ ] Status change is allowed by the transition policy and scoped to this vendor.
- [ ] Tracking/fulfillment details reflect an actual operational event.
- [ ] Customer notifications and admin audit log are present or queued for retry.
- [ ] Dashboard count and paid-revenue calculation match the underlying order status.

## Rollout sequence

1. Review current checkout/order engine and admin actions before changing schema or adding a new order table.
2. Implement server-enforced transition and vendor-scoping checks in admin actions.
3. Add tests for transitions, payment approval/rejection, tenant isolation and retries.
4. Verify production metrics use canonical `orders` data and distinct order/payment status filters.
5. Deploy via preview, pass CI and verify using staging/test data before production rollout.
