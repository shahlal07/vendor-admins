import { describe, expect, it } from 'vitest';
import { canTransitionOrderStatus } from './order-transition';

describe('canTransitionOrderStatus', () => {
  it('allows the expected forward lifecycle', () => {
    expect(canTransitionOrderStatus('pending', 'confirmed')).toBe(true);
    expect(canTransitionOrderStatus('confirmed', 'packed')).toBe(true);
    expect(canTransitionOrderStatus('packed', 'shipped')).toBe(true);
    expect(canTransitionOrderStatus('shipped', 'delivered')).toBe(true);
    expect(canTransitionOrderStatus('delivered', 'refunded')).toBe(true);
  });

  it('allows cancellation before delivery', () => {
    expect(canTransitionOrderStatus('pending', 'cancelled')).toBe(true);
    expect(canTransitionOrderStatus('confirmed', 'cancelled')).toBe(true);
    expect(canTransitionOrderStatus('packed', 'cancelled')).toBe(true);
    expect(canTransitionOrderStatus('shipped', 'cancelled')).toBe(true);
  });

  it('rejects skipped steps, backward moves and reopening terminal orders', () => {
    expect(canTransitionOrderStatus('pending', 'shipped')).toBe(false);
    expect(canTransitionOrderStatus('delivered', 'confirmed')).toBe(false);
    expect(canTransitionOrderStatus('cancelled', 'pending')).toBe(false);
    expect(canTransitionOrderStatus('refunded', 'delivered')).toBe(false);
    expect(canTransitionOrderStatus('unknown', 'delivered')).toBe(false);
  });

  it('treats a repeated status as idempotent', () => {
    expect(canTransitionOrderStatus('packed', 'packed')).toBe(true);
  });
});
