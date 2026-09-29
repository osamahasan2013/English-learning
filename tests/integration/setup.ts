import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// Loads .env.local (written by `npm run stack:start`) without overriding real env vars.
const file = path.resolve(__dirname, "../../.env.local");
if (existsSync(file)) {
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}
for (const name of [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
]) {
  if (!process.env[name])
    throw new Error(`${name} is required for integration tests (run npm run stack:start)`);
}
