"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

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
  const proofPath = String(formData.get("proofPath") ?? "").trim();
  if (!settlementId || !Number.isFinite(amount) || amount <= 0) throw new Error("Enter a valid payment amount.");
  if (!["bank_transfer", "cash", "cheque", "other"].includes(method)) throw new Error("Choose a valid payment method.");
  if (!reference) throw new Error("A transaction reference is required.");
  if (proofPath && (!proofPath.startsWith(`${user.id}/${settlementId}/`) || proofPath.includes(".."))) throw new Error("Invalid payment proof path.");

  const { data: settlement, error: settlementError } = await supabase
    .from("settlements")
    .select("id, vendor_id, status, platform_fee, adjustment_total, amount_paid")
    .eq("id", settlementId)
    .eq("vendor_id", profile.vendor_id)
    .single();
  if (settlementError || !settlement) throw new Error("Invoice not found for this vendor.");
  if (!["pending", "partially_paid"].includes(settlement.status)) throw new Error("This invoice is not accepting payment submissions.");
  const outstanding = Math.max(0, Number(settlement.platform_fee) + Number(settlement.adjustment_total ?? 0) - Number(settlement.amount_paid ?? 0));
  if (amount > outstanding) throw new Error(`Amount exceeds the remaining balance of Rs ${Math.round(outstanding).toLocaleString("en-PK")}.`);

  const { error } = await supabase.from("vendor_payment_submissions").insert({
    vendor_id: profile.vendor_id,
    settlement_id: settlement.id,
    submitted_by: user.id,
    amount,
    method,
    reference,
    notes,
    proof_path: proofPath || null,
    status: "submitted",
  });
  if (error) throw new Error(error.message);

  revalidatePath("/billing");
  redirect("/billing?submitted=1");
}