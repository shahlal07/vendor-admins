'use server';

import { z } from 'zod';
import { getAdminUser } from '@/lib/dal';
import { groqComplete, type ChatMessage } from '@/lib/groq';
import { getAssistantContext } from '@/lib/queries/assistant-context';
import { checkRateLimit } from '@/lib/rate-limit';

export type AssistantState = { error?: string; reply?: string } | undefined;

const AskSchema = z.object({
  question: z.string().trim().min(1).max(1000),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })).max(20),
});

/**
 * Read-only Q&A over a snapshot of real business data. This assistant can
 * only ever return text — it has no access to any mutating action, so it
 * cannot change an order's status, edit stock, or do anything else on the
 * admin's behalf. Treat its answers as a summary/second-opinion tool, not
 * a source of truth to act on blindly for anything consequential.
 */
export async function askAssistant(
  _prev: AssistantState,
  formData: FormData
): Promise<AssistantState> {
  const admin = await getAdminUser();

  const { allowed } = await checkRateLimit('admin_groq', admin.id, {
    maxAttempts: 30,
    windowMinutes: 10,
    lockMinutes: 10,
  });
  if (!allowed) return { error: 'Too many requests — please wait a moment and try again.' };

  let history: unknown[] = [];
  try {
    history = JSON.parse(String(formData.get('history') || '[]'));
  } catch {
    return { error: 'Invalid conversation history.' };
  }

  const parsed = AskSchema.safeParse({
    question: formData.get('question'),
    history,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };

  const context = await getAssistantContext();

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        `You are an assistant embedded in the admin dashboard for ${admin.vendor_name}, an online store on the Nashemann platform. ` +
        "You help the admin understand and manage orders, inventory, and sales by answering questions using the business data snapshot below. " +
        'Be concise and direct — this is a busy admin, not a chat companion. Use Rs for currency. ' +
        "If asked to DO something (change an order, edit stock, send a message), tell them you can't take actions directly and point them to the relevant admin page (Orders, Inventory, Customers, etc.) instead — you can only answer questions, not perform actions. " +
        "If the data snapshot doesn't contain what's needed to answer, say so plainly rather than guessing.\n\n" +
        context,
    },
    ...parsed.data.history.map((m) => ({ role: m.role, content: m.content }) as ChatMessage),
    { role: 'user', content: parsed.data.question },
  ];

  try {
    const reply = await groqComplete(messages, { maxTokens: 500 });
    return { reply };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'The assistant is unavailable right now.' };
  }
}
