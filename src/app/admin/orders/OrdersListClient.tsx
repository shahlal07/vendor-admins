'use client';

import { useEffect, useState } from 'react';
import { useActionState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import Link from 'next/link';
import { formatPKR } from '@/lib/format';
import { ORDER_STATUSES } from '@/lib/order-status';
import type { OrderListItem } from '@/lib/queries/orders';
import { PAYMENT_METHOD_LABELS } from '@/lib/payment-methods';
import { bulkUpdateOrderStatus } from './actions';

// PAYMENT_METHOD_LABELS only covers the manual-transfer methods (it's
// shared with the payment-accounts settings UI, which never deals with
// COD) -- 'cod' is added here rather than there.
const ORDER_PAYMENT_METHOD_LABELS: Record<string, string> = { cod: 'Cash on Delivery', ...PAYMENT_METHOD_LABELS };

const STATUS_CLASS: Record<string, string> = {
  pending: 'bg-[var(--surface-sunken)] text-[var(--text-light)]',
  confirmed: 'bg-[var(--golden)]/25 text-[#8a6d00]',
  packed: 'bg-[#c9d9ff] text-[#1e3a8a]',
  shipped: 'bg-[#c9d9ff] text-[#1e3a8a]',
  delivered: 'bg-[var(--orchard-green)]/15 text-[var(--orchard-green)]',
  cancelled: 'bg-[var(--error)]/15 text-[var(--error)]',
  refunded: 'bg-[var(--error)]/15 text-[var(--error)]',
};

export function OrdersListClient({
  orders,
  statusFilter,
  page,
  pageSize,
  totalCount,
  source,
}: {
  orders: OrderListItem[];
  statusFilter: string;
  page: number;
  pageSize: number;
  totalCount: number;
  source: 'real' | 'demo';
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<string>(ORDER_STATUSES[0]);
  const [state, formAction, pending] = useActionState(bulkUpdateOrderStatus, undefined);

  const totalPages = Math.max(Math.ceil(totalCount / pageSize), 1);

  function goToPage(p: number) {
    const params = new URLSearchParams(searchParams);
    if (p <= 1) params.delete('page');
    else params.set('page', String(p));
    router.push(`/admin/orders?${params.toString()}`);
  }

  useEffect(() => {
    if (source === 'demo') {
      // Never carry a real-order selection across into the demo view.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelected(new Set());
    }
    if (state?.success) {
      toast.success('Orders updated');
      // Clearing the selection after a successful bulk update has no
      // callback-based alternative (the useActionState result is only
      // observable via re-render), so this effect is the correct place.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelected(new Set());
    }
    if (state?.error) toast.error(state.error);
  }, [state, source]);

  function toggleAll() {
    setSelected((s) => (s.size === orders.length ? new Set() : new Set(orders.map((o) => o.id))));
  }

  function toggleOne(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleFilterChange(value: string) {
    const params = new URLSearchParams(searchParams);
    if (value === 'all') params.delete('status');
    else params.set('status', value);
    params.delete('page');
    router.push(`/admin/orders?${params.toString()}`);
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <select
          value={statusFilter}
          onChange={(e) => handleFilterChange(e.target.value)}
          className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--mango-orange)]"
        >
          <option value="all">All statuses</option>
          {ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        {source === 'real' && selected.size > 0 && (
          <form
            action={(fd) => {
              fd.set('orderIdsJson', JSON.stringify([...selected]));
              fd.set('status', bulkStatus);
              formAction(fd);
            }}
            className="flex items-center gap-2"
          >
            <span className="text-sm text-[var(--text-light)]">{selected.size} selected</span>
            <select
              value={bulkStatus}
              onChange={(e) => setBulkStatus(e.target.value)}
              className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-2 py-1.5 text-sm text-[var(--text)] outline-none focus:border-[var(--mango-orange)]"
            >
              {ORDER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-[var(--mango-orange)] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[var(--mango-deep)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? 'Applying…' : 'Bulk Update'}
            </button>
          </form>
        )}
      </div>

      {orders.length === 0 ? (
        <p className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface)] p-5 text-sm text-[var(--text-light)] shadow-sm">
          {source === 'demo'
            ? 'No demo orders match this filter for your vendor.'
            : 'No orders yet — real customer orders will show up here once the storefront checkout starts writing to this schema.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface)] shadow-sm">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] text-xs uppercase tracking-wide text-[var(--text-light)]">
                {source === 'real' && <th className="py-3 pl-5 pr-2">
                  <input
                    type="checkbox"
                    checked={orders.length > 0 && selected.size === orders.length}
                    onChange={toggleAll}
                    aria-label="Select all orders"
                    className="h-4 w-4 accent-[var(--mango-orange)]"
                  />
                </th>}
                <th className="py-3 pr-4">Order #</th>
                <th className="py-3 pr-4">Customer</th>
                <th className="py-3 pr-4">Total</th>
                <th className="py-3 pr-4">Payment</th>
                <th className="py-3 pr-4">Status</th>
                <th className="py-3 pr-4">Placed</th>
                <th className="py-3 pr-5"></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-b border-[var(--border-subtle)] last:border-b-0">
                  {source === 'real' && <td className="py-3 pl-5 pr-2">
                    <input
                      type="checkbox"
                      checked={selected.has(o.id)}
                      onChange={() => toggleOne(o.id)}
                      aria-label={`Select order ${o.order_number}`}
                      className="h-4 w-4 accent-[var(--mango-orange)]"
                    />
                  </td>}
                  <td className="py-3 pr-4 font-medium text-[var(--text)]">{o.order_number}</td>
                  <td className="py-3 pr-4 text-[var(--text-light)]">{o.customer_name}</td>
                  <td className="py-3 pr-4 text-[var(--text)]">{formatPKR(o.total)}</td>
                  <td className="py-3 pr-4 text-[var(--text-light)]">
                    {o.payment_method
                      ? (ORDER_PAYMENT_METHOD_LABELS[o.payment_method] ?? o.payment_method)
                      : '—'}
                  </td>
                  <td className="py-3 pr-4">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[o.status] ?? ''}`}
                    >
                      {o.status}
                    </span>
                  </td>
                  <td className="py-3 pr-4 whitespace-nowrap text-[var(--text-light)]">
                    {new Date(o.created_at).toLocaleDateString('en-PK')}
                  </td>
                  <td className="py-3 pr-5">
                    {source === 'real' ? (
                      <Link
                        href={`/admin/orders/${o.id}`}
                        className="rounded-lg bg-[var(--mango-orange)] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[var(--mango-deep)]"
                      >
                        View
                      </Link>
                    ) : (
                      <span className="rounded-full border border-amber-500 px-2 py-1 text-xs font-semibold text-amber-800">Demo only</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalCount > pageSize && (
        <div className="mt-4 flex items-center justify-between text-sm text-[var(--text-light)]">
          <span>
            Page {page} of {totalPages} · {totalCount} orders
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => goToPage(page - 1)}
              disabled={page <= 1}
              className="rounded-lg border border-[var(--border-subtle)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] transition hover:bg-[var(--surface-sunken)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Previous
            </button>
            <button
              onClick={() => goToPage(page + 1)}
              disabled={page >= totalPages}
              className="rounded-lg border border-[var(--border-subtle)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] transition hover:bg-[var(--surface-sunken)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
