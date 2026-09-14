begin;

-- The admin API authenticates an allow-listed Supabase user before using the
-- server-only service role. Keep browser roles closed and expose only the
-- anonymized identifier, retained turns, and timestamp needed by the console.
grant select (user_hash, turns, updated_at)
  on table public.line_chat_sessions
  to service_role;

commit;
