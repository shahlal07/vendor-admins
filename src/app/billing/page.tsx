"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatPKR } from "@/lib/format";

export async function submitVendorPaymentAction(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, role, vendor_id")
    .eq("id", user.id)
    .single();
  if (profileError || !profile || !profile.vendor_id || !["admin", "staff"].includes(profile.role)) {
    throw new Error("This account is not linked to a vendor.");
  }

  const settlementId = String(formData.get("settlementId") ?? "");
  const amount = Number(formData.get("amount"));
  const method = String(formData.get("method") ?? "");
  const reference = String(formData.get("reference") ?? "").trim().slice(0, 160);
  const notes = String(formData.get("notes") ?? "").trim().slice(0, 1000);
  if (!settlementId || !Number.isFinite(amount) || amount <= 0) throw new Error("Enter a valid payment amount.");
  if (!["bank_transfer", "cash", "cheque", "other"].includes(method)) throw new Error("Choose a valid payment method.");
  if (!reference) throw new Error("A transaction reference is required.");

  const { data: settlement, error: settlementError } = await supabase
    .from("settlements")
    .select("id, vendor_id, status, platform_fee, amount_paid")
    .eq("id", settlementId)
    .eq("vendor_id", profile.vendor_id)
    .single();
  if (settlementError || !settlement) throw new Error("Invoice not found for this vendor.");
  if (!["pending", "partially_paid"].includes(settlement.status)) throw new Error("This invoice is not accepting payment submissions.");
  const outstanding = Math.max(0, Number(settlement.platform_fee) - Number(settlement.amount_paid ?? 0));
  if (amount > outstanding) throw new Error(`Amount exceeds the remaining balance of Rs ${Math.round(outstanding).toLocaleString("en-PK")}.`);

  const { error } = await supabase.from("vendor_payment_submissions").insert({
    vendor_id: profile.vendor_id,
    settlement_id: settlement.id,
    submitted_by: user.id,
    amount,
    method,
    reference,
    notes,
    status: "submitted",
  });
  if (error) throw new Error(error.message);

  revalidatePath("/billing");
  redirect("/billing?submitted=1");
}

function monthLabel(month: string) {
  return new Date(`${month}T00:00:00.000Z`).toLocaleDateString("en-PK", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default async function VendorBillingPage({ searchParams }: { searchParams: Promise<{ submitted?: string }> }) {
  const { submitted } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, role, vendor_id")
    .eq("id", user.id)
    .single();
  if (profileError || !profile || !profile.vendor_id || !["admin", "staff"].includes(profile.role)) {
    redirect("/login?error=not_admin");
  }

  const [{ data: vendor }, { data: settlements, error: settlementError }, { data: submissions }] = await Promise.all([
    supabase.from("vendors").select("id, name, status, plan").eq("id", profile.vendor_id).single(),
    supabase.from("settlements").select("id, month, orders_count, gross_revenue, platform_fee, amount_paid, status, due_date").eq("vendor_id", profile.vendor_id).order("month", { ascending: false }),
    supabase.from("vendor_payment_submissions").select("id, settlement_id, amount, method, reference, status, review_note, created_at").eq("vendor_id", profile.vendor_id).order("created_at", { ascending: false }),
  ]);
  if (settlementError || !vendor) redirect("/login?error=vendor_unavailable");

  const invoiceRows = settlements ?? [];
  const submissionRows = submissions ?? [];
  const outstandingTotal = invoiceRows
    .filter((s) => ["pending", "partially_paid"].includes(s.status))
    .reduce((sum, s) => sum + Math.max(0, Number(s.platform_fee) - Number(s.amount_paid ?? 0)), 0);

  return (
    <main className="mx-auto max-w-5xl space-y-7 px-4 py-8 text-[var(--text)]">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--mango-orange)]">Nashemann billing</p>
          <h1 className="mt-2 text-3xl font-bold">Invoices & payments</h1>
          <p className="mt-2 text-sm text-[var(--text-light)]">{vendor.name} · {vendor.plan === "monthly" ? "Monthly plan" : "Per-order plan"}</p>
        </div>
        <a href="/admin" className="rounded-xl border border-[var(--border-subtle)] px-4 py-2 text-sm font-semibold hover:bg-[var(--surface)]">Back to dashboard</a>
      </header>

      {vendor.status === "suspended" && (
        <section className="rounded-2xl border border-red-300 bg-red-50 p-5 text-red-950">
          <h2 className="font-bold">Your store is suspended</h2>
          <p className="mt-1 text-sm">You can still view invoices and submit payment details here. Your store will be restored only after Nashemann Superadmin confirms the payment and all overdue balances are cleared.</p>
        </section>
      )}
      {submitted === "1" && (
        <section className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm font-medium text-emerald-900">
          Payment details submitted. This is not yet a confirmed payment; Superadmin must verify it.
        </section>
      )}

      <section className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface)] p-5">
          <p className="text-sm text-[var(--text-light)]">Outstanding balance</p>
          <p className="mt-2 text-2xl font-bold">{formatPKR(outstandingTotal)}</p>
        </div>
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface)] p-5">
          <p className="text-sm text-[var(--text-light)]">Invoices</p>
          <p className="mt-2 text-2xl font-bold">{invoiceRows.length}</p>
        </div>
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface)] p-5">
          <p className="text-sm text-[var(--text-light)]">Payment submissions</p>
          <p className="mt-2 text-2xl font-bold">{submissionRows.length}</p>
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface)] p-5">
        <h2 className="text-lg font-bold">Your invoices</h2>
        <p className="mb-4 mt-1 text-sm text-[var(--text-light)]">Use your invoice reference when making a transfer. Balances update only after Superadmin confirms a payment.</p>
        <div className="space-y-3">
          {invoiceRows.map((s) => {
            const balance = Math.max(0, Number(s.platform_fee) - Number(s.amount_paid ?? 0));
            const payable = ["pending", "partially_paid"].includes(s.status) && balance > 0;
            return (
              <article key={s.id} className="rounded-xl border border-[var(--border-subtle)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">{monthLabel(s.month)}</h3>
                    <p className="mt-1 break-all text-xs text-[var(--text-light)]">Invoice: {s.id}</p>
                    <p className="mt-1 text-xs text-[var(--text-light)]">Due {s.due_date ?? "date not set"} · {s.orders_count} orders</p>
                  </div>
                  <span className="rounded-full border border-[var(--border-subtle)] px-3 py-1 text-xs font-semibold capitalize">{s.status.replace("_", " ")}</span>
                </div>
                <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
                  <p>Fee: <strong>{formatPKR(Number(s.platform_fee))}</strong></p>
                  <p>Paid: <strong>{formatPKR(Number(s.amount_paid ?? 0))}</strong></p>
                  <p>Balance: <strong>{formatPKR(balance)}</strong></p>
                </div>
                {payable && (
                  <form action={submitVendorPaymentAction} className="mt-4 grid gap-3 border-t border-[var(--border-subtle)] pt-4 sm:grid-cols-2">
                    <input type="hidden" name="settlementId" value={s.id} />
                    <label className="text-xs font-medium">Amount (PKR)
                      <input required name="amount" type="number" min="1" max={balance} step="0.01" defaultValue={balance} className="mt-1 block w-full rounded-lg border border-[var(--border-subtle)] bg-transparent px-3 py-2 text-sm" />
                    </label>
                    <label className="text-xs font-medium">Payment method
                      <select required name="method" defaultValue="bank_transfer" className="mt-1 block w-full rounded-lg border border-[var(--border-subtle)] bg-transparent px-3 py-2 text-sm">
                        <option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option><option value="cheque">Cheque</option><option value="other">Other</option>
                      </select>
                    </label>
                    <label className="text-xs font-medium sm:col-span-2">Transaction reference
                      <input required name="reference" maxLength={160} placeholder="Bank / Easypaisa / JazzCash reference number" className="mt-1 block w-full rounded-lg border border-[var(--border-subtle)] bg-transparent px-3 py-2 text-sm" />
                    </label>
                    <label className="text-xs font-medium sm:col-span-2">Notes (optional)
                      <textarea name="notes" maxLength={1000} rows={2} placeholder="Additional details for the finance team" className="mt-1 block w-full rounded-lg border border-[var(--border-subtle)] bg-transparent px-3 py-2 text-sm" />
                    </label>
                    <button type="submit" className="rounded-xl bg-[var(--mango-orange)] px-4 py-2.5 text-sm font-bold text-white sm:col-span-2">Submit payment details for verification</button>
                  </form>
                )}
              </article>
            );
          })}
          {invoiceRows.length === 0 && <p className="py-6 text-sm text-[var(--text-light)]">No invoices have been issued yet.</p>}
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface)] p-5">
        <h2 className="text-lg font-bold">Payment submission history</h2>
        <div className="mt-4 space-y-2">
          {submissionRows.map((s) => (
            <div key={s.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-[var(--border-subtle)] p-3 text-sm">
              <div><p className="font-semibold">{formatPKR(Number(s.amount))} · {s.method.replace("_", " ")}</p><p className="mt-1 text-xs text-[var(--text-light)]">Ref: {s.reference} · {new Date(s.created_at).toLocaleString("en-PK")}</p>{s.review_note && <p className="mt-1 text-xs">Review note: {s.review_note}</p>}</div>
              <span className="rounded-full border border-[var(--border-subtle)] px-3 py-1 text-xs font-semibold capitalize">{s.status}</span>
            </div>
          ))}
          {submissionRows.length === 0 && <p className="py-4 text-sm text-[var(--text-light)]">No payment submissions yet.</p>}
        </div>
      </section>
    </main>
  );
}
