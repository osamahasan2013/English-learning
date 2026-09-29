import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-7xl" aria-hidden>
        🔍
      </p>
      <h1 className="text-3xl font-extrabold">Page not found</h1>
      <Link href="/" className="text-primary font-semibold underline">
        Go to the start
      </Link>
    </main>
  );
}
