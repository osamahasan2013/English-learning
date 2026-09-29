// A minimal stand-in for Supabase's API gateway (Kong): routes /auth/v1/* to the auth
// server and /rest/v1/* to PostgREST on one origin, which is the URL layout supabase-js
// expects. Local development and tests only.
import http from "node:http";

const routes = [
  { prefix: "/auth/v1", target: new URL(process.env.AUTH_URL ?? "http://127.0.0.1:9999") },
  { prefix: "/rest/v1", target: new URL(process.env.REST_URL ?? "http://127.0.0.1:3001") },
];
const port = Number(process.env.GATEWAY_PORT ?? 54321);

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "authorization, x-client-info, apikey, content-type, prefer, range, accept-profile, content-profile, x-supabase-api-version",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "access-control-expose-headers": "content-range, content-location",
};

http
  .createServer((req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders);
      res.end();
      return;
    }
    const route = routes.find(
      (r) => req.url === r.prefix || req.url.startsWith(`${r.prefix}/`) || req.url.startsWith(`${r.prefix}?`),
    );
    if (!route) {
      res.writeHead(404, corsHeaders);
      res.end("not found");
      return;
    }
    const path = req.url.slice(route.prefix.length) || "/";
    const upstream = http.request(
      {
        hostname: route.target.hostname,
        port: route.target.port,
        path,
        method: req.method,
        headers: { ...req.headers, host: route.target.host },
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, { ...upstreamRes.headers, ...corsHeaders });
        upstreamRes.pipe(res);
      },
    );
    upstream.on("error", (error) => {
      res.writeHead(502, corsHeaders);
      res.end(`gateway error: ${error.message}`);
    });
    req.pipe(upstream);
  })
  .listen(port, "127.0.0.1", () => console.log(`gateway listening on http://127.0.0.1:${port}`));
