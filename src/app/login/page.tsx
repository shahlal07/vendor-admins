import { Suspense } from 'react';
import { LoginForm } from './LoginForm';

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--surface-sunken)] px-4">
      <div className="w-full max-w-sm rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface)] p-8 shadow-lg">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--mango-orange)] text-lg font-extrabold text-white shadow-md">
            NP
          </div>
          <div className="text-xl font-bold text-[var(--text)]">
            Nashemann <span className="text-[var(--mango-orange)]">Vendor Admin</span>
          </div>
        </div>

        <h1 className="mb-1 text-2xl font-bold text-[var(--text)]">Admin sign in</h1>
        <p className="mb-6 text-sm text-[var(--text-light)]">
          Sign in with your vendor admin account. Your assigned vendor determines the admin panel and data you can access.
        </p>

        <Suspense fallback={null}>
          <LoginForm />
          <div className="mt-5 border-t border-[var(--border-subtle)] pt-4 text-center">
            <a href="/billing" className="text-sm font-semibold text-[var(--mango-orange)] hover:underline">Open billing and invoices</a>
            <p className="mt-1 text-xs text-[var(--text-light)]">Use this page to view invoices and submit payment details, including when your store is suspended.</p>
          </div>
        </Suspense>
      </div>
    </div>
  );
}
