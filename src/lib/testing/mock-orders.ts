/**
 * Synthetic order fixtures for local UI/demo development only.
 *
 * These records are generated in memory. They are NOT inserted into Supabase,
 * must never be merged into production metrics, and must not be used as proof
 * of real sales, payment, fulfilment, or vendor performance.
 */
import type { OrderStatus } from '@/lib/order-status';

export type MockVendorSlug = 'theaamghar' | 'minacafe' | 'nigehban';

export interface MockOrder {
  id: string;
  order_number: string;
  vendor_slug: MockVendorSlug;
  vendor_name: string;
  customer_name: string;
  customer_email: string;
  status: OrderStatus;
  payment_status: 'pending' | 'paid' | 'rejected' | 'refunded';
  payment_method: 'cod' | 'bank_transfer';
  total: number;
  currency: 'PKR';
  created_at: string;
  is_mock: true;
  data_source: 'synthetic_fixture';
}

const VENDORS: Array<{ slug: MockVendorSlug; name: string; count: number }> = [
  { slug: 'theaamghar', name: 'TheAamGhar', count: 46 },
  { slug: 'minacafe', name: 'Mina Cafe', count: 34 },
  { slug: 'nigehban', name: 'Nigehban', count: 30 },
];

const STATUSES: OrderStatus[] = [
  'pending', 'confirmed', 'packed', 'shipped', 'delivered',
  'cancelled', 'refunded',
];

function buildMockOrders(): MockOrder[] {
  const orders: MockOrder[] = [];
  let sequence = 1;

  for (const vendor of VENDORS) {
    for (let index = 0; index < vendor.count; index += 1) {
      const status = STATUSES[(sequence - 1) % STATUSES.length];
      const paymentMethod = sequence % 3 === 0 ? 'bank_transfer' : 'cod';
      const paymentStatus: MockOrder['payment_status'] =
        status === 'refunded' ? 'refunded'
          : status === 'cancelled' ? 'rejected'
            : paymentMethod === 'cod' && status !== 'delivered' ? 'pending'
              : status === 'delivered' || status === 'shipped' || status === 'packed' ? 'paid'
                : 'pending';
      const day = ((sequence - 1) % 28) + 1;
      const hour = (sequence * 7) % 24;
      const minute = (sequence * 13) % 60;

      orders.push({
        id: `mock-order-${String(sequence).padStart(3, '0')}`,
        order_number: `MOCK-${String(sequence).padStart(5, '0')}`,
        vendor_slug: vendor.slug,
        vendor_name: vendor.name,
        customer_name: `Demo Customer ${String(sequence).padStart(3, '0')}`,
        customer_email: `demo-customer-${String(sequence).padStart(3, '0')}@example.invalid`,
        status,
        payment_status: paymentStatus,
        payment_method: paymentMethod,
        total: 500 + ((sequence * 347) % 9500),
        currency: 'PKR',
        created_at: `2026-10-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`,
        is_mock: true,
        data_source: 'synthetic_fixture',
      });
      sequence += 1;
    }
  }

  return orders;
}

/** Deterministic, in-memory-only mock data; never use as a canonical order ledger. */
export const MOCK_ORDERS: readonly MockOrder[] = Object.freeze(buildMockOrders());

export const MOCK_ORDER_COUNTS = Object.freeze({
  theaamghar: 46,
  minacafe: 34,
  nigehban: 30,
  total: 110,
});

export function getMockOrdersForVendor(vendor: MockVendorSlug): MockOrder[] {
  return MOCK_ORDERS.filter((order) => order.vendor_slug === vendor);
}
