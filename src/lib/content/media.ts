// Validation for uploaded images (word pictures). The file's real type is read from its
// first bytes (never trusted from the file name or the browser's declared type), and its
// size and pixel dimensions are checked before anything is stored. The database and the
// storage bucket enforce the same type and size limits again
// (supabase/migrations/20261004100100_vocabulary_engine.sql).

export const IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];

export const IMAGE_LIMITS = {
  maxBytes: 1024 * 1024,
  minSide: 32,
  maxSide: 4096,
  altTextMax: 200,
} as const;

const EXTENSIONS: Record<ImageMimeType, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export type ImageInfo = { mimeType: ImageMimeType; width: number; height: number };

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.slice(i, i + n));

// Reads the type and dimensions from the file header; null for anything else (SVG, GIF,
// HTML pretending to be an image, truncated files).
export function sniffImage(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length >= 24 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => bytes[i] === v)) {
    if (ascii(bytes, 12, 4) !== "IHDR") return null;
    return { mimeType: "image/png", width: u32be(bytes, 16), height: u32be(bytes, 20) };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1];
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        i += 2;
        continue;
      }
      const length = u16be(bytes, i + 2);
      // SOF0–SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the frame size.
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { mimeType: "image/jpeg", height: u16be(bytes, i + 5), width: u16be(bytes, i + 7) };
      }
      if (length < 2) return null;
      i += 2 + length;
    }
    return null;
  }
  if (bytes.length >= 30 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    const chunk = ascii(bytes, 12, 4);
    if (chunk === "VP8 ") return { mimeType: "image/webp", width: u16le(bytes, 26) & 0x3fff, height: u16le(bytes, 28) & 0x3fff };
    if (chunk === "VP8L") {
      const b = bytes.slice(21, 25);
      return {
        mimeType: "image/webp",
        width: 1 + (((b[1] & 0x3f) << 8) | b[0]),
        height: 1 + (((b[3] & 0x0f) << 10) | (b[2] << 2) | ((b[1] & 0xc0) >> 6)),
      };
    }
    if (chunk === "VP8X") return { mimeType: "image/webp", width: 1 + u24le(bytes, 24), height: 1 + u24le(bytes, 27) };
    return null;
  }
  return null;
}

export type ImageUploadCheck =
  | { ok: true; info: ImageInfo; altText: string; extension: string; byteSize: number }
  | { ok: false; error: string };

export function validateImageUpload(input: {
  bytes: Uint8Array;
  declaredType?: string;
  altText: string;
}): ImageUploadCheck {
  const altText = input.altText.trim().replace(/\s+/g, " ");
  if (altText.length === 0) return { ok: false, error: "Describe the picture (alt text) for children who cannot see it." };
  if (altText.length > IMAGE_LIMITS.altTextMax)
    return { ok: false, error: `Keep the description under ${IMAGE_LIMITS.altTextMax} characters.` };
  if (input.bytes.length === 0) return { ok: false, error: "The file is empty." };
  if (input.bytes.length > IMAGE_LIMITS.maxBytes) return { ok: false, error: "The picture must be 1 MB or smaller." };
  const info = sniffImage(input.bytes);
  if (!info) return { ok: false, error: "Only PNG, JPEG and WebP pictures can be uploaded." };
  if (input.declaredType && input.declaredType !== info.mimeType)
    return { ok: false, error: "The file is not the kind of picture its name says." };
  const { width, height } = info;
  if (Math.min(width, height) < IMAGE_LIMITS.minSide || Math.max(width, height) > IMAGE_LIMITS.maxSide)
    return {
      ok: false,
      error: `Pictures must be between ${IMAGE_LIMITS.minSide} and ${IMAGE_LIMITS.maxSide} pixels on each side.`,
    };
  return { ok: true, info, altText, extension: EXTENSIONS[info.mimeType], byteSize: input.bytes.length };
}

export const CONTENT_IMAGES_BUCKET = "content-images";
export const CONTENT_AUDIO_BUCKET = "content-audio";

// Public URL of a stored file (the buckets are public; paths are not secrets).
function publicUrl(supabaseUrl: string, bucket: string, storagePath: string) {
  const path = storagePath.split("/").map(encodeURIComponent).join("/");
  return `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/${bucket}/${path}`;
}
export const publicImageUrl = (supabaseUrl: string, storagePath: string) =>
  publicUrl(supabaseUrl, CONTENT_IMAGES_BUCKET, storagePath);
export const publicAudioUrl = (supabaseUrl: string, storagePath: string) =>
  publicUrl(supabaseUrl, CONTENT_AUDIO_BUCKET, storagePath);
