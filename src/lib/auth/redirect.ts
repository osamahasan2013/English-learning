// Only same-site relative paths are allowed as post-login destinations, so ?next= can
// never send someone to another site (open redirect). The value is resolved the way a
// browser would resolve it (the URL parser drops tabs and newlines, so "/\t/evil.example"
// would otherwise become "//evil.example") and must stay on our own origin; control
// characters and backslashes are refused outright.
const BASE = "https://same-origin.invalid";

export function safeNextPath(next: unknown, fallback: string) {
  const value = typeof next === "string" ? next : "";
  if (!value.startsWith("/") || /[\u0000-\u001f\u007f\\]/.test(value)) return fallback;
  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== BASE) return fallback;
  const path = `${url.pathname}${url.search}${url.hash}`;
  return path.startsWith("//") ? fallback : path;
}
