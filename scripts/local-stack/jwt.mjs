// Signs the local-only anon and service_role API keys with the local JWT secret
// (HS256), the same shape a hosted Supabase project issues. Prints shell exports.
import { createHmac } from "node:crypto";

const secret = process.argv[2];
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");

function sign(role) {
  const header = b64({ alg: "HS256", typ: "JWT" });
  const payload = b64({ iss: "supabase-local", role, iat: 1_700_000_000, exp: 2_000_000_000 });
  const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

console.log(`export LOCAL_ANON_KEY=${sign("anon")}`);
console.log(`export LOCAL_SERVICE_ROLE_KEY=${sign("service_role")}`);
