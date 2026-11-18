-- Teachers' Google refresh tokens, so Classroom roster sync (and, next, auto-posting assignments)
-- can run without the teacher re-approving Google every hour.
--
-- Defense in depth:
--   * No grants to anon/authenticated at all. Only the `classroom` Edge Function (service role) reads it.
--   * The token is AES-GCM encrypted by that function with TOKEN_ENCRYPTION_KEY, an Edge Function
--     secret that never touches the database. A leaked DB dump or backup alone is useless.
--   * Teachers only. Students never grant Classroom scopes.
--   * A teacher can disconnect any time, which revokes the token at Google and deletes the row.

create table public.google_tokens (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  refresh_token_enc text not null,
  scopes text not null,
  connected_at timestamptz not null default now(),
  last_used_at timestamptz
);
alter table public.google_tokens enable row level security;  -- no policies: service role only
revoke all on public.google_tokens from anon, authenticated;

-- What the dashboard needs to know, without exposing the token.
create function public.classroom_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'connected', exists (select 1 from google_tokens where user_id = auth.uid()),
    'last_synced_at', (select max(google_synced_at) from classes where teacher_id = auth.uid()))
  where public.is_teacher();
$$;
revoke all on function public.classroom_status() from public, anon;
grant execute on function public.classroom_status() to authenticated;
