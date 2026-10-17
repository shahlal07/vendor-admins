'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getAdminUser } from '@/lib/dal';
import { groqComplete } from '@/lib/groq';
import { generateReviewReplyDraft } from '@/lib/review-reply-templates';
import { checkRateLimit } from '@/lib/rate-limit';

export type ActionState = { error?: string; success?: boolean } | undefined;
export type UploadState = { error?: string; urls?: string[] } | undefined;
export type AIReplyState = { error?: string; draft?: string } | undefined;

const GenerateAIReplySchema = z.object({
  reviewId: z.uuid(),
  rating: z.number().int().min(1).max(5),
  reviewerName: z.string().nullable(),
  productName: z.string(),
  reviewBody: z.string(),
});

/**
 * Drafts a reply using Groq — this only ever returns text for the admin to
 * review/edit in the UI; it never posts anything itself (replyToReview,
 * called separately by an explicit "Post Reply" click, is the only thing
 * that writes to the reviews table). Falls back to the offline template
 * generator if the Groq call fails, so a flaky/rate-limited API never
 * blocks the admin from getting *a* draft to start from.
 */
export async function generateAIReply(
  _prev: AIReplyState,
  formData: FormData
): Promise<AIReplyState> {
  const admin = await getAdminUser();

  const supabase = await createClient();
  const { allowed } = await checkRateLimit('admin_groq', admin.id, {
    maxAttempts: 30,
    windowMinutes: 10,
    lockMinutes: 10,
  });
  if (!allowed) return { error: 'Too many requests — please wait a moment and try again.' };

  const parsed = GenerateAIReplySchema.safeParse({
    reviewId: formData.get('reviewId'),
    rating: Number(formData.get('rating')),
    reviewerName: formData.get('reviewerName') || null,
    productName: formData.get('productName'),
    reviewBody: formData.get('reviewBody'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };

  const d = parsed.data;

  try {
    const draft = await groqComplete([
      {
        role: 'system',
        content:
          `You are writing a short public reply, as the business ${admin.vendor_name}, to a customer's product review. ` +
          'Keep it warm, genuine, and brief (2-3 sentences max). Match tone to the star rating: enthusiastic thanks for 4-5 stars, ' +
          'understanding + inviting more detail for 3 stars, sincere apology + invite them to contact support on WhatsApp to resolve it for 1-2 stars. ' +
          'Address the customer by first name if given. Do not invent specific facts (order numbers, dates, refund amounts) you were not given. ' +
          'Output only the reply text, no quotes, no preamble, no signature line.',
      },
      {
        role: 'user',
        content: `Product: ${d.productName}\nRating: ${d.rating}/5\nReviewer: ${d.reviewerName ?? 'Anonymous'}\nReview: "${d.reviewBody}"`,
      },
    ]);
    return { draft };
  } catch {
    // Groq unavailable/rate-limited — fall back to the offline template so
    // the admin still gets a usable starting draft instead of an error.
    return {
      draft: generateReviewReplyDraft({
        reviewId: d.reviewId,
        rating: d.rating,
        reviewerName: d.reviewerName,
        productName: d.productName,
      }),
    };
  }
}

const ReplySchema = z.object({
  reviewId: z.uuid(),
  body: z.string().trim().min(1, 'Reply cannot be empty.').max(2000),
  images: z.array(z.url()).max(4),
});

export async function replyToReview(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const admin = await getAdminUser();

  const parsed = ReplySchema.safeParse({
    reviewId: formData.get('reviewId'),
    body: formData.get('body'),
    images: JSON.parse(String(formData.get('images') || '[]')),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('reviews')
    .update({
      admin_reply_body: parsed.data.body,
      admin_reply_images: parsed.data.images,
      admin_reply_at: new Date().toISOString(),
      admin_reply_by: admin.id,
    })
    .eq('id', parsed.data.reviewId);

  if (error) return { error: `Failed to save reply: ${error.message}` };

  revalidatePath('/admin/reviews');
  return { success: true };
}

const ReviewIdSchema = z.object({ reviewId: z.uuid() });

export async function removeReply(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  await getAdminUser();

  const parsed = ReviewIdSchema.safeParse({ reviewId: formData.get('reviewId') });
  if (!parsed.success) return { error: 'Invalid review id.' };

  const supabase = await createClient();

  // Best-effort cleanup of any uploaded reply images before clearing the row.
  const { data: review } = await supabase
    .from('reviews')
    .select('admin_reply_images')
    .eq('id', parsed.data.reviewId)
    .maybeSingle();

  if (review?.admin_reply_images?.length) {
    const paths = (review.admin_reply_images as string[])
      .map((url: string) => extractReviewImagesPath(url))
      .filter((p: string | null): p is string => p !== null);
    if (paths.length > 0) {
      await supabase.storage.from('review-images').remove(paths);
    }
  }

  const { error } = await supabase
    .from('reviews')
    .update({
      admin_reply_body: null,
      admin_reply_images: [],
      admin_reply_at: null,
      admin_reply_by: null,
    })
    .eq('id', parsed.data.reviewId);

  if (error) return { error: `Failed to remove reply: ${error.message}` };

  revalidatePath('/admin/reviews');
  return { success: true };
}

function extractReviewImagesPath(url: string): string | null {
  const marker = '/review-images/';
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return decodeURIComponent(url.slice(idx + marker.length));
}

export async function deleteReview(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  await getAdminUser();

  const parsed = ReviewIdSchema.safeParse({ reviewId: formData.get('reviewId') });
  if (!parsed.success) return { error: 'Invalid review id.' };

  const supabase = await createClient();

  const { data: review } = await supabase
    .from('reviews')
    .select('images, admin_reply_images')
    .eq('id', parsed.data.reviewId)
    .maybeSingle();

  const allPaths = ([...(review?.images ?? []), ...(review?.admin_reply_images ?? [])] as string[])
    .map((url: string) => extractReviewImagesPath(url))
    .filter((p: string | null): p is string => p !== null);
  if (allPaths.length > 0) {
    await supabase.storage.from('review-images').remove(allPaths);
  }

  const { error } = await supabase.from('reviews').delete().eq('id', parsed.data.reviewId);
  if (error) return { error: `Failed to delete review: ${error.message}` };

  revalidatePath('/admin/reviews');
  return { success: true };
}

export async function uploadReplyImage(
  _prev: UploadState,
  formData: FormData
): Promise<UploadState> {
  await getAdminUser();

  const reviewId = String(formData.get('reviewId') || '');
  if (!z.uuid().safeParse(reviewId).success) return { error: 'Invalid review id.' };

  const files = formData.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return { error: 'No files selected.' };
  if (files.length > 4) return { error: 'Up to 4 images per reply.' };

  const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
  for (const file of files) {
    if (!ALLOWED.includes(file.type)) {
      return { error: `Unsupported file type: ${file.type || 'unknown'}` };
    }
    if (file.size > 5 * 1024 * 1024) {
      return { error: `${file.name} is larger than 5MB.` };
    }
  }

  const supabase = await createClient();
  const urls: string[] = [];

  for (const file of files) {
    const ext = file.name.split('.').pop() || 'jpg';
    const path = `replies/${reviewId}/${crypto.randomUUID()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from('review-images')
      .upload(path, file, { contentType: file.type, upsert: false });

    if (uploadError) {
      return { error: `Upload failed for ${file.name}: ${uploadError.message}` };
    }

    const { data: publicUrl } = supabase.storage.from('review-images').getPublicUrl(path);
    urls.push(publicUrl.publicUrl);
  }

  return { urls };
}
