import 'server-only';
import { formatPKR } from '@/lib/format';
import { SITE_URL } from '@/lib/site-url';

// Same Gmail-SMTP-via-App-Password approach as the storefront's
// lib/email.ts (not a transactional email API/service, per the site
// owner's choice) -- this app sends its own separate set of emails
// (order status changes, payment verification outcomes) using its own
// GMAIL_USER/GMAIL_APP_PASSWORD env vars. No-ops with a console warning
// when unset so an admin action never fails just because email isn't
// configured.
const PLATFORM_MAILER_URL = process.env.NASHEMANN_MAILER_URL ?? 'https://superadmin.nashemann.store/api/notifications/send';

// A crude but effective HTML->text derivation -- an HTML-only email (no
// text/plain part) is one of the strongest signals spam filters use against
// automated mail, and every email this module sends was missing one
// entirely until now. Good enough for these short, simple templates; not
// meant to handle arbitrary HTML. Mirrors the storefront's copy in its own
// lib/email.ts -- keep both in sync if this ever needs to change.
function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li)>/gi, '\n\n')
    .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '$2 ($1)')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&(lt|gt|quot|#39);/g, (m) => ({ '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" })[m] ?? m)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Best-effort: a failed send must never fail the admin action (status
// update / payment verification) that already succeeded in the database.
async function sendMail(to: string, subject: string, html: string, _businessName: string): Promise<void> {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    console.error(`[email] Skipped "${subject}" to ${to} -- SUPABASE_SERVICE_ROLE_KEY is not configured.`);
    return;
  }
  try {
    const response = await fetch(PLATFORM_MAILER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to, subject, html, category: 'notifications' }),
    });
    if (!response.ok) {
      console.error(`[email] Internal mailer rejected "${subject}" to ${to}: HTTP ${response.status}`);
    }
  } catch (error) {
    console.error(`[email] Failed to send "${subject}" to ${to} through the internal mailer:`, error);
  }
}

function wrapEmail(bodyHtml: string, businessName: string): string {
  return `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;">
      <div style="background:#FF6B00;padding:20px 24px;border-radius:12px 12px 0 0;">
        <span style="color:#fff;font-size:20px;font-weight:700;">${businessName}</span>
      </div>
      <div style="background:#fff;border:1px solid #eee;border-top:none;border-radius:0 0 12px 12px;padding:24px;color:#2D2D2D;">
        ${bodyHtml}
      </div>
      <p style="text-align:center;color:#999;font-size:12px;margin-top:16px;">
        ${businessName}
      </p>
    </div>
  `;
}

const STATUS_COPY: Record<string, { emoji: string; message: string }> = {
  confirmed: { emoji: '✅', message: 'Your order is confirmed and headed to our packing table.' },
  packed: { emoji: '📦', message: 'Your order is packed and waiting for pickup.' },
  shipped: { emoji: '🚚', message: 'Your order is on its way!' },
  delivered: { emoji: '🎉', message: 'Delivered — enjoy!' },
  cancelled: { emoji: '❌', message: 'Your order has been cancelled.' },
  refunded: { emoji: '↩️', message: 'Your order has been refunded.' },
};

export async function sendOrderTrackingUpdateEmail(params: {
  to: string;
  orderNumber: string;
  trackingNumber: string | null;
  courierName: string | null;
  businessName: string;
}): Promise<void> {
  const safe = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const details = [
    params.courierName ? `<p><strong>Courier:</strong> ${safe(params.courierName)}</p>` : '',
    params.trackingNumber ? `<p><strong>Tracking number:</strong> ${safe(params.trackingNumber)}</p>` : '',
  ].join('');
  const html = wrapEmail(`
    <h2 style="margin-top:0;">Your order is on its way 📦</h2>
    <p>Hello, the delivery details for order <strong>${safe(params.orderNumber)}</strong> have been updated by ${safe(params.businessName)}.</p>
    ${details}
    <p>If no tracking number is listed yet, the seller may add it shortly.</p>
  `, params.businessName);
  await sendMail(params.to, `Delivery details updated — ${params.orderNumber}`, html, params.businessName);
}

export async function sendVendorSupportMessageAlertEmail(params: {
  to: string;
  vendorName: string;
  message: string;
}): Promise<void> {
  const safe = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const html = wrapEmail(`
    <h2 style="margin-top:0;">New message from a Nashemann vendor</h2>
    <p><strong>Vendor:</strong> ${safe(params.vendorName)}</p>
    <blockquote style="margin:16px 0;padding:12px 16px;border-left:3px solid #FF6B00;background:#f9fafb;white-space:pre-wrap;">${safe(params.message)}</blockquote>
    <a href="https://superadmin.nashemann.store/support" style="display:inline-block;margin-top:12px;background:#FF6B00;color:#fff;text-decoration:none;padding:12px 24px;border-radius:999px;font-weight:600;">Open support inbox</a>
  `, 'Nashemann');
  await sendMail(params.to, `New support message — ${params.vendorName}`, html, 'Nashemann');
}

export async function sendPlatformPaymentSubmissionAlertEmail(params: {
  to: string;
  vendorName: string;
  monthLabel: string;
  amount: number;
  method: string;
  reference: string;
}): Promise<void> {
  const safe = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const html = wrapEmail(`
    <h2 style="margin-top:0;">New vendor payment submission</h2>
    <p><strong>${safe(params.vendorName)}</strong> submitted a payment for the ${safe(params.monthLabel)} settlement.</p>
    <p><strong>Amount:</strong> Rs ${Math.round(params.amount).toLocaleString('en-PK')}<br/>
    <strong>Method:</strong> ${safe(params.method)}<br/>
    <strong>Reference:</strong> ${safe(params.reference)}</p>
    <p>Please review the proof and submission in the Super Admin panel.</p>
    <a href="https://superadmin.nashemann.store/settlements/submissions" style="display:inline-block;margin-top:12px;background:#FF6B00;color:#fff;text-decoration:none;padding:12px 24px;border-radius:999px;font-weight:600;">Review payment</a>
  `, 'Nashemann');
  await sendMail(params.to, `Payment submitted — ${params.vendorName} — ${params.monthLabel}`, html, 'Nashemann');
}

export async function sendOrderStatusUpdateEmail(params: {
  to: string;
  orderNumber: string;
  status: string;
  trackingNumber?: string | null;
  courierName?: string | null;
  businessName: string;
}): Promise<void> {
  const copy = STATUS_COPY[params.status];
  if (!copy) return; // pending has no customer-facing email -- nothing changed from their view yet

  const trackUrl = `${SITE_URL}/track?order=${params.orderNumber}`;
  const trackingLine =
    params.trackingNumber && params.status === 'shipped'
      ? `<p><strong>Tracking:</strong> ${params.trackingNumber}${params.courierName ? ` via ${params.courierName}` : ''}</p>`
      : '';

  const html = wrapEmail(`
    <h2 style="margin-top:0;">${copy.emoji} Order ${params.orderNumber}</h2>
    <p>${copy.message}</p>
    ${trackingLine}
    <a href="${trackUrl}" style="display:inline-block;margin-top:16px;background:#FF6B00;color:#fff;text-decoration:none;padding:12px 24px;border-radius:999px;font-weight:600;">Track Your Order</a>
  `, params.businessName);
  await sendMail(params.to, `Order ${params.orderNumber} — ${copy.message}`, html, params.businessName);
}

export async function sendAnnouncementEmail(params: {
  to: string;
  title: string;
  message: string;
  businessName: string;
}): Promise<void> {
  const html = wrapEmail(`
    <h2 style="margin-top:0;">${params.title}</h2>
    <p style="white-space:pre-wrap;">${params.message}</p>
    <a href="${SITE_URL}" style="display:inline-block;margin-top:16px;background:#FF6B00;color:#fff;text-decoration:none;padding:12px 24px;border-radius:999px;font-weight:600;">Shop Now</a>
  `, params.businessName);
  await sendMail(params.to, params.title, html, params.businessName);
}

export async function sendPaymentStatusUpdateEmail(params: {
  to: string;
  orderNumber: string;
  paymentStatus: "failed" | "refunded";
  businessName: string;
}): Promise<void> {
  const copy = params.paymentStatus === "refunded"
    ? { title: "Your payment has been refunded", message: "The payment for this order has been marked as refunded. Please allow time for your payment provider to reflect the refund." }
    : { title: "There was a problem with your payment", message: "The payment for this order was marked as failed. Please contact the store if you need help completing payment." };
  const safe = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const html = wrapEmail(`
    <h2 style="margin-top:0;">${copy.title}</h2>
    <p>${copy.message}</p>
    <p><strong>Order:</strong> ${safe(params.orderNumber)}<br/><strong>Store:</strong> ${safe(params.businessName)}</p>
  `, params.businessName);
  await sendMail(params.to, `${copy.title} — ${params.orderNumber}`, html, params.businessName);
}

export async function sendPaymentApprovedEmail(params: {
  to: string;
  orderNumber: string;
  total: number;
  businessName: string;
}): Promise<void> {
  const trackUrl = `${SITE_URL}/track?order=${params.orderNumber}`;
  const html = wrapEmail(`
    <h2 style="margin-top:0;">✅ Payment Verified</h2>
    <p>We've confirmed your ${formatPKR(params.total)} payment for order <strong>${params.orderNumber}</strong> — it's now headed through processing and packing.</p>
    <a href="${trackUrl}" style="display:inline-block;margin-top:16px;background:#FF6B00;color:#fff;text-decoration:none;padding:12px 24px;border-radius:999px;font-weight:600;">Track Your Order</a>
  `, params.businessName);
  await sendMail(params.to, `Payment Verified — ${params.orderNumber}`, html, params.businessName);
}

export async function sendPaymentRejectedEmail(params: {
  to: string;
  orderNumber: string;
  reason: string;
  businessName: string;
}): Promise<void> {
  const trackUrl = `${SITE_URL}/track?order=${params.orderNumber}`;
  const html = wrapEmail(`
    <h2 style="margin-top:0;color:#c0392b;">We couldn't verify this payment</h2>
    <p>For order <strong>${params.orderNumber}</strong>:</p>
    <p style="background:#fdf0ef;border-radius:8px;padding:12px 16px;">${params.reason}</p>
    <p>Please visit your tracking page to re-upload your payment proof, or reach out to us on WhatsApp.</p>
    <a href="${trackUrl}" style="display:inline-block;margin-top:16px;background:#FF6B00;color:#fff;text-decoration:none;padding:12px 24px;border-radius:999px;font-weight:600;">Go to Order</a>
  `, params.businessName);
  await sendMail(params.to, `Action Needed — Payment for ${params.orderNumber}`, html, params.businessName);
}
