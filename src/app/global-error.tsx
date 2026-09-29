"use client";

// Last-resort boundary (the root layout itself failed). Plain markup: no app styles load.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", textAlign: "center", padding: "4rem 1rem" }}>
        <p style={{ fontSize: "4rem" }} aria-hidden>
          🙈
        </p>
        <h1>Something went wrong. Let&apos;s try again.</h1>
        <button
          type="button"
          onClick={reset}
          style={{ fontSize: "1.25rem", padding: "0.75rem 1.5rem", borderRadius: "1rem" }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
