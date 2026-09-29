-- Runs after the auth server has created the auth schema: gives the API roles the same
-- access to auth.uid()/auth.jwt() a hosted Supabase project grants them.
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
grant select on auth.users to service_role;
