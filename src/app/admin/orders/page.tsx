import Link from 'next/link';
import { getAdminUser } from '@/lib/dal';
import { getOrdersList, ORDERS_PAGE_SIZE, type OrderListItem } from '@/lib/queries/orders';
import { getMockOrdersForVendor, type MockVendorSlug } from '@/lib/testing/mock-orders';
import { ORDER_STATUSES } from '@/lib/order-status';
import { OrdersListClient } from './OrdersListClient';

export const dynamic = 'force-dynamic';

function resolveMockVendorSlug(vendorName: string): MockVendorSlug | null {
  const normalized = vendorName.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (normalized === 'theaamghar') return 'theaamghar';
  if (normalized === 'minacafe') return 'minacafe';
  if (normalized === 'nigehban') return 'nigehban';
  return null;
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string; source?: string }>;
}) {
  const { status, page: pageParam, source: requestedSource } = await searchParams;
  const source = requestedSource === 'demo' ? 'demo' : 'real';
  const page = Math.max(parseInt(pageParam ?? '1', 10) || 1, 1);

  let orders: OrderListItem[];
  let totalCount: number;
  let pageSize: number;

  if (source === 'demo') {
    // Resolve the signed-in vendor on the server. Unknown vendor names fail closed.
    const admin = await getAdminUser();
    const vendorSlug = resolveMockVendorSlug(admin.vendor_name);
    const allowedStatus = status && ORDER_STATUSES.includes(status as (typeof ORDER_STATUSES)[number]) ? status : 'all';
    const vendorOrders = vendorSlug ? getMockOrdersForVendor(vendorSlug) : [];
    const filtered = allowedStatus === 'all' ? vendorOrders : vendorOrders.filter((order) => order.status === allowedStatus);
    totalCount = filtered.length;
    pageSize = ORDERS_PAGE_SIZE;
    orders = filtered.slice((page - 1) * pageSize, page * pageSize).map((order) => ({
      id: order.id,
      order_number: order.order_number,
      customer_name: order.customer_name,
      total: order.total,
      status: order.status,
      payment_status: order.payment_status,
      payment_method: order.payment_method,
      created_at: order.created_at,
    }));
  } else {
    const result = await getOrdersList(status, page);
    orders = result.orders;
    totalCount = result.totalCount;
    pageSize = result.pageSize;
  }

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-[var(--text)]">Orders</h1>
      <p className="mb-4 text-sm text-[var(--text-light)]">
        Track and update orders through the fulfillment pipeline.
      </p>
      <div className="mb-5 inline-flex rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-1">
        <Link
          href={`/admin/orders?${new URLSearchParams({ ...(status && status !== 'all' ? { status } : {}), source: 'real' }).toString()}`}
          aria-current={source === 'real' ? 'page' : undefined}
          className={`rounded-lg px-4 py-2 text-sm font-semibold ${source === 'real' ? 'bg-[var(--mango-orange)] text-white' : 'text-[var(--text-light)] hover:bg-[var(--surface-sunken)]'}`}
        >
          Real orders
        </Link>
        <Link
          href={`/admin/orders?${new URLSearchParams({ ...(status && status !== 'all' ? { status } : {}), source: 'demo' }).toString()}`}
          aria-current={source === 'demo' ? 'page' : undefined}
          className={`rounded-lg px-4 py-2 text-sm font-semibold ${source === 'demo' ? 'bg-[var(--mango-orange)] text-white' : 'text-[var(--text-light)] hover:bg-[var(--surface-sunken)]'}`}
        >
          Demo orders
        </Link>
      </div>
      {source === 'demo' && (
        <div role="status" className="mb-5 rounded-xl border-2 border-amber-500 bg-amber-50 p-4 text-amber-950">
          <p className="font-bold">DEMO DATA — NOT REAL SALES</p>
          <p className="mt-1 text-sm">
            These synthetic examples exist only in memory. They do not come from the database and cannot be paid, fulfilled, or counted as real revenue.
          </p>
        </div>
      )}
      <OrdersListClient
        orders={orders}
        statusFilter={status ?? 'all'}
        page={page}
        pageSize={pageSize}
        totalCount={totalCount}
        source={source}
      />
    </div>
  );
}
