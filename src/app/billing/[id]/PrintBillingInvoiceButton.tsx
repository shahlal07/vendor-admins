"use client";

export function PrintBillingInvoiceButton() {
  return <button type="button" onClick={() => window.print()} className="rounded-xl bg-[var(--mango-orange)] px-4 py-2.5 text-sm font-bold text-white print:hidden">Print / Save PDF</button>;
}
