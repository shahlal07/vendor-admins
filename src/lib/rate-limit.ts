import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

type RateLimitOptions = {
  maxAttempts: number;
  windowMinutes: number;
  lockMinutes: number;
};

type RateLimitResult = { allowed: boolean; retryAfter: string | null };

// The underlying SECURITY DEFINER RPC mutates a private rate-limit table.
// Keep this helper server-only and use the service-role client so anon and
// authenticated API clients cannot directly seed/lock arbitrary bucket keys.
export async function checkRateLimit(
  bucket: string,
  identifier: string,
  { maxAttempts, windowMinutes, lockMinutes }: RateLimitOptions
): Promise<RateLimitResult> {
  const supabase = createAdminClient();
  const result = await supabase.rpc('check_and_record_rate_limit', {
    p_bucket: bucket,
    p_identifier: identifier,
    p_max_attempts: maxAttempts,
    p_window_minutes: windowMinutes,
    p_lock_minutes: lockMinutes,
  });
  const data = result.data as { allowed: boolean; retry_after: string | null }[] | null;
  const row = data?.[0];
  const error = result.error;

  return {
    allowed: !error && row?.allowed === true,
    retryAfter: row?.retry_after ?? null,
  };
}
