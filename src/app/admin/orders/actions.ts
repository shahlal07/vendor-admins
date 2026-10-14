'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAdminUser } from '@/lib/dal';
import { logAdminAction } from '@/lib/audit-log';
import { ORDER_STATUSES } from '@/lib/order-status';
import {
  sendOrderStatusUpdateEmail,
  sendPaymentApprovedEmail,
  sendPaymentRejectedEmail,
  sendOrderTrackingUpdateEmail,
  sendPaymentStatusUpdateEmail,
} from '@/lib/email';

export type ActionState = { error?: string; success?: boolean } | undefined;

// profiles.email is null for phone-only accounts -- callers must treat a
// null return as "skip the email", not an error, same as the storefront's
// user.email guard in checkout/actions.ts.
async function getCustomerEmail(
  supabase: SupabaseClient,
  customerId: string,
  fallbackEmail?: string | null
): Promise<string | null> {
  const { data } = await supabase
    .from('profiles')
    .select('email')
    .eq('id', customerId)
    .maybeSingle();
  return data?.email ?? fallbackEmail ?? null;
}

const StatusSchema = z.enum(ORDER_STATUSES);

const UpdateStatusSchema = z.object({
  orderId: z.uuid(),
  status: StatusSchema,
});

export async function updateOrderStatus(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const admin = await getAdminUser();

  const parsed = UpdateStatusSchema.safeParse({
    orderId: formData.get('orderId'),
    status: formData.get('status'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };

  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from('orders')
    .update({ status: parsed.data.status, updated_at: new Date().toISOString() })
    .eq('id', parsed.data.orderId)
    .select('order_number, customer_id, delivery')
    .single();

  if (error) return { error: `Failed to update status: ${error.message}` };

  await logAdminAction(admin, 'update_status', 'order', parsed.data.orderId, {
    status: parsed.data.status,
  });

  const email = await getCustomerEmail(supabase, updated.customer_id, (updated.delivery as { email?: string } | null)?.email);
  if (email) {
    await sendOrderStatusUpdateEmail({
      to: email,
      orderNumber: updated.order_number,
      status: parsed.data.status,
      businessName: admin.vendor_name,
    });
  }

  revalidatePath('/admin');
  revalidatePath('/admin/orders');
  revalidatePath(`/admin/orders/${parsed.data.orderId}`);
  return { success: true };
}

const BulkUpdateSchema = z.object({
  orderIds: z.array(z.uuid()).min(1),
  status: StatusSchema,
});

export async function bulkUpdateOrderStatus(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const admin = await getAdminUser();

  let orderIds: unknown[] = [];
  try {
    orderIds = JSON.parse(String(formData.get('orderIdsJson') || '[]'));
  } catch {
    return { error: 'Invalid selection.' };
  }

  const parsed = BulkUpdateSchema.safeParse({
    orderIds,
    status: formData.get('status'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };

  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from('orders')
    .update({ status: parsed.data.status, updated_at: new Date().toISOString() })
    .in('id', parsed.data.orderIds)
    .select('order_number, customer_id, delivery');

  if (error) return { error: `Failed to update orders: ${error.message}` };

  await logAdminAction(admin, 'bulk_update_status', 'order', null, {
    orderIds: parsed.data.orderIds,
    status: parsed.data.status,
  });

  // One profiles round trip for every affected customer, then fire the
  // per-order emails in parallel -- avoids an N+1 query per order in a bulk
  // action that could touch dozens of rows at once.
  const customerIds = [...new Set((updated ?? []).map((o) => o.customer_id))];
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, email')
    .in('id', customerIds);
  const emailByCustomerId = new Map((profiles ?? []).map((p) => [p.id, p.email]));

  await Promise.all(
    (updated ?? []).map((o) => {
      const email = emailByCustomerId.get(o.customer_id) ?? (o.delivery as { email?: string } | null)?.email;
      if (!email) return Promise.resolve();
      return sendOrderStatusUpdateEmail({
        to: email,
        orderNumber: o.order_number,
        status: parsed.data.status,
        businessName: admin.vendor_name,
      });
    })
  );

  revalidatePath('/admin');
  revalidatePath('/admin/orders');
  return { success: true };
}

const TrackingSchema = z.object({
  orderId: z.uuid(),
  trackingNumber: z.string().nullable(),
  courierName: z.string().nullable(),
  // 'submitted'/'rejected' come from the manual bank/Easypaisa/JazzCash flow.
  // They must be accepted here even though this form isn't where an admin
  // approves a payment -- otherwise saving tracking on an order that's
  // awaiting verification would fail validation on its current value.
  paymentStatus: z.enum(['pending', 'submitted', 'paid', 'rejected', 'failed', 'refunded']),
});

export async function updateOrderTracking(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const admin = await getAdminUser();

  const strOrNull = (v: FormDataEntryValue | null) =>
    v === null || String(v).trim() === '' ? null : String(v);

  const parsed = TrackingSchema.safeParse({
    orderId: formData.get('orderId'),
    trackingNumber: strOrNull(formData.get('trackingNumber')),
    courierName: strOrNull(formData.get('courierName')),
    paymentStatus: formData.get('paymentStatus'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };

  const supabase = await createClient();
  const d = parsed.data;
  const { data: previousOrder } = await supabase
    .from('orders')
    .select('order_number, customer_id, delivery, tracking_number, courier_name, payment_status')
    .eq('id', d.orderId)
    .maybeSingle();

  const { error } = await supabase
    .from('orders')
    .update({
      tracking_number: d.trackingNumber,
      courier_name: d.courierName,
      payment_status: d.paymentStatus,
      updated_at: new Date().toISOString(),
    })
    .eq('id', d.orderId);

  if (error) return { error: `Failed to save: ${error.message}` };

  await logAdminAction(admin, 'update_tracking', 'order', d.orderId, {
    trackingNumber: d.trackingNumber,
    courierName: d.courierName,
    paymentStatus: d.paymentStatus,
  });

  if (previousOrder && (
    previousOrder.tracking_number !== d.trackingNumber ||
    previousOrder.courier_name !== d.courierName
  )) {
    const email = await getCustomerEmail(supabase, previousOrder.customer_id, (previousOrder.delivery as { email?: string } | null)?.email);
    if (email) {
      await sendOrderTrackingUpdateEmail({
        to: email,
        orderNumber: previousOrder.order_number,
        trackingNumber: d.trackingNumber,
        courierName: d.courierName,
        businessName: admin.vendor_name,
      });
    }
  }

  if (previousOrder && previousOrder.payment_status !== d.paymentStatus &&
      (d.paymentStatus === 'refunded' || d.paymentStatus === 'failed')) {
    const email = await getCustomerEmail(supabase, previousOrder.customer_id);
    if (email) {
      await sendPaymentStatusUpdateEmail({
        to: email,
        orderNumber: previousOrder.order_number,
        paymentStatus: d.paymentStatus,
        businessName: admin.vendor_name,
      });
    }
  }

  revalidatePath('/admin');
  revalidatePath('/admin/orders');
  revalidatePath(`/admin/orders/${d.orderId}`);
  return { success: true };
}

const VerifyPaymentSchema = z.object({
  orderId: z.uuid(),
  approve: z.boolean(),
  rejectionReason: z.string().nullable(),
});

/**
 * Approve or reject a manually-transferred payment after eyeballing the
 * customer's uploaded proof. Approving also moves the order itself from
 * `pending` to `confirmed` — a verified payment is exactly what "confirmed"
 * means for a prepaid order, and making the admin do it as a second separate
 * step would just be a chance to forget.
 */
export async function verifyPayment(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const admin = await getAdminUser();

  const parsed = VerifyPaymentSchema.safeParse({
    orderId: formData.get('orderId'),
    approve: formData.get('approve') === 'true',
    rejectionReason:
      String(formData.get('rejectionReason') ?? '').trim() === ''
        ? null
        : String(formData.get('rejectionReason')).trim(),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };

  const d = parsed.data;
  if (!d.approve && !d.rejectionReason) {
    return { error: 'Please say what was wrong — the customer sees this message.' };
  }

  const supabase = await createClient();

  const { data: order, error: readError } = await supabase
    .from('orders')
    .select('status, order_number, total, customer_id, delivery')
    .eq('id', d.orderId)
    .maybeSingle();
  if (readError || !order) return { error: 'Order not found.' };

  const { error } = await supabase
    .from('orders')
    .update({
      payment_status: d.approve ? 'paid' : 'rejected',
      payment_verified_at: d.approve ? new Date().toISOString() : null,
      payment_verified_by: d.approve ? admin.id : null,
      payment_rejection_reason: d.approve ? null : d.rejectionReason,
      // Only nudge a still-pending order forward; never walk back an order
      // that's already been packed/shipped by a later manual status change.
      ...(d.approve && order.status === 'pending' ? { status: 'confirmed' } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', d.orderId);

  if (error) return { error: `Failed to save: ${error.message}` };

  await logAdminAction(
    admin,
    d.approve ? 'approve_payment' : 'reject_payment',
    'order',
    d.orderId,
    d.approve ? undefined : { reason: d.rejectionReason }
  );

  const email = await getCustomerEmail(supabase, order.customer_id, (order.delivery as { email?: string } | null)?.email);
  if (email) {
    if (d.approve) {
      await sendPaymentApprovedEmail({ to: email, orderNumber: order.order_number, total: order.total, businessName: admin.vendor_name });
    } else {
      // d.rejectionReason is guaranteed non-null here by the check above.
      await sendPaymentRejectedEmail({
        to: email,
        orderNumber: order.order_number,
        reason: d.rejectionReason!,
        businessName: admin.vendor_name,
      });
    }
  }

  revalidatePath('/admin');
  revalidatePath('/admin/orders');
  revalidatePath(`/admin/orders/${d.orderId}`);
  return { success: true };
}

/**
 * Payment proofs live in a PRIVATE bucket (they're customers' bank
 * screenshots), so there's no public URL to render. This mints a short-lived
 * signed URL on demand instead.
 */
export async function getPaymentProofUrl(path: string): Promise<string | null> {
  const admin = await getAdminUser();
  const supabase = await createClient();
  // The storage path is keyed by customer uid, not vendor -- nothing in the
  // path itself proves the caller's own vendor owns this proof. This Server
  // Action is directly invocable with an arbitrary path, so verify against a
  // real order belonging to the admin's vendor before ever minting a URL.
  const { data: owningOrder } = await supabase
    .from('orders')
    .select('id')
    .eq('vendor_id', admin.vendor_id)
    .ilike('payment_proof_url', `%${path}%`)
    .maybeSingle();
  if (!owningOrder) return null;

  const { data, error } = await supabase.storage
    .from('payment-proofs')
    .createSignedUrl(path, 60 * 10);
  if (error) return null;
  return data.signedUrl;
}
