import Image from "next/image";
import { cn } from "@/lib/utils";

// A word's picture: the uploaded image when there is one, else its emoji. Decorative
// next to the written word (the word is the label), described when it stands alone.
export function WordPicture({
  word,
  emoji,
  image,
  size = "md",
  decorative = false,
  className,
}: {
  word: string;
  emoji: string;
  image: { url: string; alt: string } | null;
  size?: "sm" | "md" | "lg";
  // Next to its written word (a tile), the picture adds nothing for screen readers.
  decorative?: boolean;
  className?: string;
}) {
  const px = size === "lg" ? 192 : size === "md" ? 96 : 56;
  if (image)
    return (
      <Image
        src={image.url}
        alt={decorative ? "" : image.alt || word}
        width={px}
        height={px}
        unoptimized
        className={cn("rounded-3xl object-contain", className)}
      />
    );
  const text = size === "lg" ? "text-[8rem] leading-none" : size === "md" ? "text-6xl" : "text-4xl";
  return (
    <span
      className={cn(text, className)}
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": word })}
    >
      {emoji || "📖"}
    </span>
  );
}

export function Stars({ count, label }: { count: number; label?: string }) {
  return (
    <span className="text-xl whitespace-nowrap" aria-label={label ?? `${count} of 3 stars`} role="img">
      {"⭐".repeat(count)}
      <span className="opacity-25">{"⭐".repeat(3 - count)}</span>
    </span>
  );
}
