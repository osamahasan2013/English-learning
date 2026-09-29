import Link from "next/link";
import { APP_SHORT_NAME } from "@/lib/app-info";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4 py-10">
      <Link href="/" className="flex items-center gap-2 text-2xl font-extrabold">
        <span aria-hidden>🌱</span> {APP_SHORT_NAME}
      </Link>
      {children}
    </main>
  );
}
