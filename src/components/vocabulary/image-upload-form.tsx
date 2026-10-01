"use client";

import { useActionState } from "react";
import { uploadWordImage, type UploadState } from "@/app/admin/words/actions";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/field";
import { IMAGE_LIMITS, IMAGE_MIME_TYPES } from "@/lib/content/media";

// Upload a picture for a word: PNG, JPEG or WebP up to 1 MB, with a description. The
// server checks the file again from its bytes.
export function ImageUploadForm({ wordId, word }: { wordId: string; word: string }) {
  const [state, action, pending] = useActionState<UploadState, FormData>(uploadWordImage, { status: "idle" });
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="wordId" value={wordId} />
      <div>
        <label htmlFor="image" className="block font-semibold">
          Picture (PNG, JPEG or WebP, up to 1 MB)
        </label>
        <input
          id="image"
          name="image"
          type="file"
          accept={IMAGE_MIME_TYPES.join(",")}
          required
          className="block"
        />
      </div>
      <div>
        <label htmlFor="altText" className="block font-semibold">
          Description for children who cannot see it
        </label>
        <Input
          id="altText"
          name="altText"
          required
          maxLength={IMAGE_LIMITS.altTextMax}
          placeholder={`A ${word}`}
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="bg-primary min-h-11 rounded-xl px-5 font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Uploading…" : "Upload picture"}
      </button>
      {state.status === "error" ? <Alert tone="error">{state.message}</Alert> : null}
      {state.status === "done" ? <Alert tone="success">{state.message}</Alert> : null}
    </form>
  );
}
