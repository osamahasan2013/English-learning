// Only same-site relative paths are allowed as post-login destinations, so ?next= can
// never send someone to another site (open redirect).
export function safeNextPath(next: unknown, fallback: string) {
  const value = typeof next === "string" ? next : "";
  return value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") ? value : fallback;
}
