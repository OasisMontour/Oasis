-- Red team Nov 23 (HIGH): only Google sign-ins may create Oasis accounts.
--
-- handle_new_user decides who is a teacher (allowlist) and which classes a student lands in (Classroom
-- rosters) purely from auth.users.email. That is only safe if the email is one Google verified. Any other
-- Supabase provider breaks it:
--   * Email provider on + "Confirm email" off: anyone POSTs /auth/v1/signup with an allowlisted teacher's
--     address and is a teacher immediately, or with a rostered student's address and is enrolled in their
--     classes (opens their lessons, answers as them).
--   * Even with confirmation on, the unconfirmed row is created at signup, so the trigger has already run.
-- docs/SETUP.md says to turn the Email provider off, but a dashboard toggle is one misclick from undoing that.
-- This makes the database refuse any signup whose provider isn't Google, whatever the dashboard says.
--
-- Supabase's auth server writes raw_app_meta_data.provider ('google', 'email', 'phone', ...) on the same insert
-- that fires this trigger. If the key is missing (old rows, plain-Postgres tests) the behavior is unchanged.

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare r text;
begin
  if new.raw_app_meta_data ? 'provider' and new.raw_app_meta_data ->> 'provider' is distinct from 'google' then
    raise exception 'Oasis only allows Google sign-in (got provider %)', new.raw_app_meta_data ->> 'provider'
      using errcode = 'insufficient_privilege';
  end if;

  r := case when exists (select 1 from teacher_allowlist where email = lower(new.email)) then 'teacher' else 'student' end;
  insert into profiles (id, email, name, role)
  values (
    new.id,
    lower(new.email),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''),
    r
  );
  if r = 'student' then
    insert into enrollments (class_id, student_id)
      select class_id, new.id from roster_entries where email = lower(new.email)
      on conflict do nothing;
  end if;
  return new;
end $$;

-- A trigger function never needs to be callable through the API.
revoke all on function public.handle_new_user() from public, anon, authenticated;
