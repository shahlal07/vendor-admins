import type { OrderStatus } from '@/lib/order-status';

const ALLOWED_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['packed', 'cancelled'],
  packed: ['shipped', 'cancelled'],
  shipped: ['delivered', 'cancelled'],
  delivered: ['refunded'],
  cancelled: [],
  refunded: [],
};

/** Same-state updates are idempotent; all other changes must follow the lifecycle. */
export function canTransitionOrderStatus(current: string, next: string): boolean {
  if (current === next) return true;
  if (!Object.hasOwn(ALLOWED_TRANSITIONS, current) || !Object.hasOwn(ALLOWED_TRANSITIONS, next)) return false;
  return ALLOWED_TRANSITIONS[current as OrderStatus].includes(next as OrderStatus);
}
