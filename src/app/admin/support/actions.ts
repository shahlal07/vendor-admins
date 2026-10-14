'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getAdminUser } from '@/lib/dal';
import { logAdminAction } from '@/lib/audit-log';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendVendorSupportMessageAlertEmail } from '@/lib/email';
import { groqComplete, type ChatMessage } from '@/lib/groq';

export type SentMessage = { id: string; senderType: string; body: string; createdAt: string };
export type ActionState = { error?: string; success?: boolean; conversationId?: string; message?: SentMessage } | undefined;

const BodySchema = z.string().trim().min(1, 'Message cannot be empty.').max(4000);

// Both RPCs only return the conversation id / void, not the row they just
// inserted -- and the client's Realtime subscription for a brand-new
// conversation isn't mounted until *after* this action returns (it depends
// on conversationId, which only exists once this resolves), so the very
// first message in a conversation was inserted before anything was
// listening for it. Fetching the just-sent row back here and returning it
// lets the client add it to local state directly instead of relying on a
// Realtime event that can never arrive for that specific insert.
async function fetchLatestOwnMessage(supabase: Awaited<ReturnType<typeof createClient>>, conversationId: string): Promise<SentMessage | undefined> {
  const { data } = await supabase
    .from('support_messages')
    .select('id, sender_type, body, created_at')
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'customer')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return undefined;
  return { id: data.id, senderType: data.sender_type, body: data.body, createdAt: data.created_at };
}

async function notifyPlatformSupport(vendorName: string, message: string) {
  try {
    const adminClient = createAdminClient();
    const { data: settings } = await adminClient.from('platform_settings').select('support_email').eq('id', true).maybeSingle();
    if (settings?.support_email) {
      await sendVendorSupportMessageAlertEmail({ to: settings.support_email, vendorName, message });
    } else {
      console.warn('[email] Vendor support message saved, but platform_settings.support_email is not configured.');
    }
  } catch (error) {
    console.error('[email] Failed to notify platform about vendor support message:', error);
  }
}

export async function startSupportConversation(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await getAdminUser();
  const parsed = BodySchema.safeParse(formData.get('body'));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid message.' };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('start_support_conversation', {
    p_body: parsed.data,
    p_vendor_id: admin.vendor_id,
  });
  if (error) return { error: `Couldn't send your message: ${error.message}` };

  const conversationId = data as string;
  const message = await fetchLatestOwnMessage(supabase, conversationId);

  await notifyPlatformSupport(admin.vendor_name, parsed.data);

  await logAdminAction(admin, 'start_support_conversation', 'support_conversation', conversationId);
  revalidatePath('/admin/support');
  return { success: true, conversationId, message };
}

const ReplySchema = z.object({
  conversationId: z.uuid(),
  body: BodySchema,
});

export async function sendSupportMessage(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await getAdminUser();
  const parsed = ReplySchema.safeParse({
    conversationId: formData.get('conversationId'),
    body: formData.get('body'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };

  const supabase = await createClient();
  const { error } = await supabase.rpc('send_customer_support_message', {
    p_conversation_id: parsed.data.conversationId,
    p_body: parsed.data.body,
  });
  if (error) return { error: `Couldn't send your message: ${error.message}` };

  const message = await fetchLatestOwnMessage(supabase, parsed.data.conversationId);

  await notifyPlatformSupport(admin.vendor_name, parsed.data.body);

  await logAdminAction(admin, 'send_support_message', 'support_conversation', parsed.data.conversationId);
  revalidatePath('/admin/support');
  return { success: true, message };
}

const SUPPORT_REPLY_SYSTEM_PROMPT =
  'You are drafting a short, helpful, concise reply as a vendor admin, replying to the Nashemann platform support team inside the vendor admin dashboard. Only state facts you are given in the conversation history -- never invent order numbers, amounts, or policies. If you don\'t have enough information to give a real answer, draft a brief reply asking a clarifying question instead of guessing. Reply with only the message text, no quotes, no preamble.';

// Mirrors nashemann-admin's own generateSupportReplyDraftAction (superadmin
// side already had "suggest reply" -- vendor admins never got the same
// feature for the other end of the same conversation). Read-only (drafts
// text, doesn't send it), so no admin-mutating-action check is needed
// beyond confirming this is a real admin session.
export async function generateSupportReplyDraft(input: {
  messages: { senderType: string; body: string }[];
}): Promise<string> {
  await getAdminUser();

  // In this schema, sender_type='customer' actually means the vendor admin
  // (see CLAUDE.md's note on support_conversations.customer_id) -- the
  // conversational role for drafting has to be that admin's own past
  // messages are "assistant" and Nashemann support's are "user", the
  // reverse of the raw sender_type label.
  const history: ChatMessage[] = input.messages.slice(-12).map((m) => ({
    role: m.senderType === 'customer' ? 'assistant' : 'user',
    content: m.body,
  }));

  return groqComplete([
    { role: 'system', content: SUPPORT_REPLY_SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: 'Draft the next reply as the vendor admin.' },
  ]);
}

export async function markSupportConversationRead(conversationId: string): Promise<void> {
  await getAdminUser();
  const supabase = await createClient();
  await supabase.rpc('mark_support_conversation_read', { p_conversation_id: conversationId });
  revalidatePath('/admin/support');
}
