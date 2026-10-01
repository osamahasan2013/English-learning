"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { CONTENT_IMAGES_BUCKET, validateImageUpload } from "@/lib/content/media";
import { normalizeWord } from "@/lib/content/csv";
import { errorMessage, logger } from "@/lib/logging";
import { sha256 } from "@/lib/learning/sha256";
import { createClient } from "@/lib/supabase/server";

// Word pictures. The admin's own session uploads (storage policies allow admins only);
// the file is validated from its bytes first (src/lib/content/media.ts), stored under a
// content-addressed path, recorded in image_assets and linked to the word.

export type UploadState = { status: "idle" | "error" | "done"; message?: string };

const fields = z.object({ wordId: z.string().uuid(), altText: z.string().max(400) });

export async function uploadWordImage(_prev: UploadState, formData: FormData): Promise<UploadState> {
  await requireAdmin();
  const parsed = fields.safeParse({ wordId: formData.get("wordId"), altText: formData.get("altText") ?? "" });
  const file = formData.get("image");
  if (!parsed.success || !(file instanceof File))
    return { status: "error", message: "Choose a picture to upload." };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = validateImageUpload({
    bytes,
    declaredType: file.type || undefined,
    altText: parsed.data.altText,
  });
  if (!check.ok) return { status: "error", message: check.error };

  const supabase = await createClient();
  const { data: word } = await supabase
    .from("words")
    .select("id, normalized_word")
    .eq("id", parsed.data.wordId)
    .maybeSingle();
  if (!word) return { status: "error", message: "That word no longer exists." };

  const hash = [...sha256(bytes).slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const slug = normalizeWord(word.normalized_word).replace(/[^a-z0-9]+/g, "-");
  const storagePath = `words/${slug}-${hash}.${check.extension}`;
  const upload = await supabase.storage
    .from(CONTENT_IMAGES_BUCKET)
    .upload(storagePath, bytes, { contentType: check.info.mimeType, upsert: true });
  if (upload.error) {
    logger.warn("admin.image_upload_failed", { wordId: word.id, error: errorMessage(upload.error) });
    return {
      status: "error",
      message: "The picture could not be stored. Is file storage set up for this project?",
    };
  }

  const { data: asset, error: assetError } = await supabase
    .from("image_assets")
    .upsert(
      {
        storage_path: storagePath,
        alt_text: check.altText,
        width: check.info.width,
        height: check.info.height,
        mime_type: check.info.mimeType,
        byte_size: check.byteSize,
        source: "upload",
        status: "published",
      },
      { onConflict: "storage_path" },
    )
    .select("id")
    .single();
  if (assetError || !asset) {
    logger.warn("admin.image_record_failed", { wordId: word.id, error: errorMessage(assetError) });
    return { status: "error", message: "The picture was uploaded but could not be recorded. Try again." };
  }
  const { error: linkError } = await supabase
    .from("words")
    .update({ image_asset_id: asset.id })
    .eq("id", word.id);
  if (linkError) return { status: "error", message: "The picture could not be linked to the word." };
  revalidatePath(`/admin/words/${word.id}`);
  return { status: "done", message: "Picture saved." };
}
