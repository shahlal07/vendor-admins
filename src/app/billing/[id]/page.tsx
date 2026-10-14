import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatPKR } from "@/lib/format";
import { PrintBillingInvoiceButton } from "./PrintBillingInvoiceButton";

export const dynamic = "force-dynamic";

function monthLabel(month: string) {
  return new Date(`${month}T00:00:00.000Z`).toLocaleDateString("en-PK", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default async function VendorInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("id, role, vendor_id").eq("id", user.id).single();
  if (!profile || !profile.vendor_id || !["admin", "staff"].includes(profile.role)) redirect("/login?error=not_admin");

  const { data: invoice, error } = await supabase
    .from("settlements")
    .select("id, vendor_id, month, orders_count, gross_revenue, platform_fee, adjustment_total, amount_paid, status, due_date, plan_snapshot, unit_fee")
    .eq("id", id)
    .eq("vendor_id", profile.vendor_id)
    .maybeSingle();
  if (error || !invoice) notFound();

  const { data: vendor } = await supabase.from("vendors").select("name, plan").eq("id", profile.vendor_id).single();
  const plan = invoice.plan_snapshot ?? vendor?.plan ?? "per_order";
  const quantity = plan === "monthly" ? 1 : Number(invoice.orders_count);
  const unitFee = invoice.unit_fee == null
    ? (plan === "monthly" ? Number(invoice.platform_fee) : Number(invoice.orders_count) > 0 ? Number(invoice.platform_fee) / Number(invoice.orders_count) : 0)
    : Number(invoice.unit_fee);
  const baseFee = Number(invoice.platform_fee);
  const adjustmentTotal = Number(invoice.adjustment_total ?? 0);
  const totalDue = baseFee + adjustmentTotal;
  const balance = Math.max(0, totalDue - Number(invoice.amount_paid ?? 0));
  const vendorCredit = Math.max(0, Number(invoice.amount_paid ?? 0) - totalDue);

  return (
    <main className="mx-auto max-w-3xl space-y-5 p-5 text-slate-900">
      <div className="flex items-center justify-between print:hidden">
        <a href="/billing" className="text-sm font-semibold text-slate-600 hover:underline">← Back to billing</a>
        <PrintBillingInvoiceButton />
      </div>
      <article className="rounded-2xl border border-slate-200 bg-white p-7 print:rounded-none print:border-0 print:p-0">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-5">
          <div><p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Nashemann</p><h1 className="mt-2 text-3xl font-bold">Platform fee invoice</h1><p className="mt-2 break-all text-xs text-slate-500">Invoice ref: {invoice.id}</p></div>
          <div className="text-right"><p className="text-sm text-slate-500">Billing period</p><p className="font-semibold">{monthLabel(invoice.month)}</p><p className="mt-2 text-sm capitalize">{invoice.status.replace("_"," ")}</p></div>
        </div>
        <div className="grid gap-5 py-5 sm:grid-cols-2">
          <div><p className="text-xs font-bold uppercase text-slate-500">Bill to</p><p className="mt-2 text-lg font-semibold">{vendor?.name ?? "Your store"}</p></div>
          <div className="sm:text-right"><p className="text-xs font-bold uppercase text-slate-500">Due date</p><p className="mt-2 text-lg font-semibold">{invoice.due_date ?? "Not set"}</p><p className="text-sm text-slate-500">Plan: {plan === "monthly" ? "Monthly" : "Per order"}</p></div>
        </div>
        <table className="w-full border-collapse text-sm"><thead><tr className="border-y border-slate-200 text-left text-xs uppercase text-slate-500"><th className="py-3">Description</th><th className="py-3 text-right">Qty</th><th className="py-3 text-right">Unit fee</th><th className="py-3 text-right">Amount</th></tr></thead><tbody><tr className="border-b border-slate-100"><td className="py-4 font-semibold">{plan === "monthly" ? "Monthly platform subscription" : "Per-order platform plan fee"}</td><td className="py-4 text-right">{quantity}</td><td className="py-4 text-right">{formatPKR(unitFee)}</td><td className="py-4 text-right font-semibold">{formatPKR(baseFee)}</td></tr>{adjustmentTotal !== 0 && <tr className="border-b border-slate-100"><td className="py-4">Refund/cancellation credits and adjustments</td><td className="py-4 text-right">—</td><td className="py-4 text-right">—</td><td className="py-4 text-right">{formatPKR(adjustmentTotal)}</td></tr>}</tbody></table>
        <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">Eligible orders: {invoice.orders_count} · Gross sales (informational): {formatPKR(Number(invoice.gross_revenue))}</p>
        <div className="ml-auto mt-6 max-w-sm space-y-3"><div className="flex justify-between text-sm text-slate-600"><span>Invoice total</span><span>{formatPKR(totalDue)}</span></div><div className="flex justify-between text-sm text-slate-600"><span>Payments confirmed</span><span>{formatPKR(Number(invoice.amount_paid ?? 0))}</span></div><div className="flex justify-between border-t border-slate-200 pt-3 text-lg font-bold"><span>Balance due</span><span>{formatPKR(balance)}</span></div>{vendorCredit > 0 && <div className="flex justify-between text-sm font-semibold text-emerald-700"><span>Credit on account</span><span>{formatPKR(vendorCredit)}</span></div>}</div>
        <p className="mt-8 border-t border-slate-200 pt-4 text-xs leading-5 text-slate-500">Payment submissions are not confirmations. Your balance changes only after Nashemann Superadmin verifies the payment. Please include this invoice reference with any payment query.</p>
      </article>
    </main>
  );
}
