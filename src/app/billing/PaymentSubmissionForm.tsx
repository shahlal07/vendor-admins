"use client";

import { useState } from "react";
import { submitVendorPaymentAction } from "./actions";
import { createClient } from "@/lib/supabase/client";

export function PaymentSubmissionForm({ settlementId, balance }: { settlementId: string; balance: number }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      const form = event.currentTarget;
      const formData = new FormData(form);
      let proofPath = "";

      if (file) {
        if (!["image/jpeg", "image/png", "application/pdf"].includes(file.type)) {
          throw new Error("Payment proof must be a JPG, PNG, or PDF.");
        }
        if (file.size > 5 * 1024 * 1024) throw new Error("Payment proof must be 5 MB or smaller.");

        const supabase = createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) throw new Error("Your session expired. Sign in again.");
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/\.{2,}/g, ".");
        proofPath = `${user.id}/${settlementId}/${Date.now()}-${safeName}`;
        const { error: uploadError } = await supabase.storage
          .from("vendor-billing-proofs")
          .upload(proofPath, file, { upsert: false, contentType: file.type });
        if (uploadError) throw new Error(uploadError.message);
      }

      formData.set("proofPath", proofPath);
      await submitVendorPaymentAction(formData);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Couldn't submit payment details.";
      if (!message.includes("NEXT_REDIRECT")) setError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 grid gap-3 border-t border-[var(--border-subtle)] pt-4 sm:grid-cols-2">
      <input type="hidden" name="settlementId" value={settlementId} />
      <label className="text-xs font-medium">Amount (PKR)
        <input required name="amount" type="number" min="0.01" max={balance} step="0.01" defaultValue={balance} className="mt-1 block w-full rounded-lg border border-[var(--border-subtle)] bg-transparent px-3 py-2 text-sm" />
      </label>
      <label className="text-xs font-medium">Payment method
        <select required name="method" defaultValue="bank_transfer" className="mt-1 block w-full rounded-lg border border-[var(--border-subtle)] bg-transparent px-3 py-2 text-sm">
          <option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option><option value="cheque">Cheque</option><option value="other">Other</option>
        </select>
      </label>
      <label className="text-xs font-medium sm:col-span-2">Transaction reference
        <input required name="reference" maxLength={160} placeholder="Bank / Easypaisa / JazzCash reference number" className="mt-1 block w-full rounded-lg border border-[var(--border-subtle)] bg-transparent px-3 py-2 text-sm" />
      </label>
      <label className="text-xs font-medium sm:col-span-2">Payment proof (optional, JPG/PNG/PDF up to 5 MB)
        <input type="file" accept="image/jpeg,image/png,application/pdf" onChange={(event) => setFile(event.target.files?.[0] ?? null)} className="mt-1 block w-full text-sm" />
      </label>
      <label className="text-xs font-medium sm:col-span-2">Notes (optional)
        <textarea name="notes" maxLength={1000} rows={2} placeholder="Additional details for the finance team" className="mt-1 block w-full rounded-lg border border-[var(--border-subtle)] bg-transparent px-3 py-2 text-sm" />
      </label>
      {error && <p role="alert" className="text-sm font-medium text-red-600 sm:col-span-2">{error}</p>}
      <button type="submit" disabled={busy} className="rounded-xl bg-[var(--mango-orange)] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60 sm:col-span-2">{busy ? "Submitting…" : "Submit payment details for verification"}</button>
    </form>
  );
}
