-- Admin access for the Oasis team (Wyatt + Ty).
--
-- What admins can do, all through the RPCs below (no table grants):
--   * see who's on the teacher allowlist and add / remove teachers
--   * see a read-only overview: teachers, classes, assignments, completion counts, anti-cheat flags
--
-- Design rules:
--   * Who is an admin lives in public.admins, which clients can't read or write. Seed it from the Supabase SQL
--     editor (docs/SETUP.md). No admin can add another admin from the app.
--   * Admin = the signed-in user's profile email is in admins. profiles.email is written once by
--     handle_new_user from the Google-verified address (non-Google signups are refused) and clients can only
--     update profiles.name, so nobody can talk their way into the list by changing their email.
--   * Checked on every call, so deleting a row from admins takes effect immediately, no sign-out needed.
--   * Students are minors: the overview returns counts only. No student names, emails or answers.

create table public.admins (
  email text primary key check (email = lower(email)),
  added_at timestamptz not null default now()
);
alter table public.admins enable row level security;  -- no policies: service role / SQL editor only
revoke all on public.admins from anon, authenticated;

-- Who changed the allowlist from the app, and when.
create table public.admin_audit (
  id bigint generated always as identity primary key,
  actor_email text not null,
  action text not null check (action in ('add_teacher', 'remove_teacher')),
  target text not null,
  detail text not null default '',
  at timestamptz not null default now()
);
alter table public.admin_audit enable row level security;  -- no policies: read through admin_dashboard()
revoke all on public.admin_audit from anon, authenticated;

alter table public.teacher_allowlist add column added_by text;  -- admin email, null = added in SQL

create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles p join admins a on a.email = p.email where p.id = auth.uid());
$$;

create function public.admin_email() returns text
language sql stable security definer set search_path = public as $$
  select p.email from profiles p join admins a on a.email = p.email where p.id = auth.uid();
$$;

-- ---------------------------------------------------------------- allowlist management

-- Add a teacher. If they already signed in (and got a student account because they weren't listed yet),
-- promote them, but only if that account has no student footprint: an enrolled account is a real student,
-- and promoting one by typo would hand a kid a teacher account.
create function public.admin_add_teacher(p_email text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me text := public.admin_email();
  e text := lower(trim(p_email));
  p profiles;
  listed boolean;
  promoted boolean := false;
begin
  if me is null then raise exception 'admins only' using errcode = 'insufficient_privilege'; end if;
  if e is null or length(e) > 254 or e !~ '^[a-z0-9._%+''-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$' then
    raise exception 'not a valid email address';
  end if;

  select * into p from profiles where email = e;
  if p.id is not null and p.role = 'student'
     and (exists (select 1 from enrollments where student_id = p.id) or exists (select 1 from attempts where student_id = p.id)) then
    raise exception '% already uses Oasis as a student (enrolled in classes), so it was not made a teacher', e;
  end if;

  insert into teacher_allowlist (email, added_by) values (e, me) on conflict (email) do nothing;
  listed := not found;
  if p.id is not null and p.role = 'student' then
    update profiles set role = 'teacher' where id = p.id;
    promoted := true;
  end if;

  insert into admin_audit (actor_email, action, target, detail)
  values (me, 'add_teacher', e, case when listed then 'already listed' when promoted then 'promoted existing account' else '' end);
  return jsonb_build_object('email', e, 'already_listed', listed, 'promoted', promoted);
end $$;

-- Remove a teacher: off the allowlist, and if they already have an account, back to student so the app
-- stops treating them as a teacher (no new lessons, classes, Classroom syncs or posts). Their existing
-- classes, lessons and student results are kept; students can still finish what was assigned.
create function public.admin_remove_teacher(p_email text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me text := public.admin_email();
  e text := lower(trim(p_email));
  was_listed boolean;
  demoted boolean;
begin
  if me is null then raise exception 'admins only' using errcode = 'insufficient_privilege'; end if;
  delete from teacher_allowlist where email = e;
  was_listed := found;
  update profiles set role = 'student' where email = e and role = 'teacher';
  demoted := found;
  if not was_listed and not demoted then raise exception '% is not a teacher', e; end if;
  insert into admin_audit (actor_email, action, target, detail)
  values (me, 'remove_teacher', e, case when demoted then 'account demoted to student' else 'had not signed in' end);
  return jsonb_build_object('email', e, 'was_listed', was_listed, 'demoted', demoted);
end $$;

-- ---------------------------------------------------------------- read-only overview

create function public.admin_dashboard() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only' using errcode = 'insufficient_privilege'; end if;
  return jsonb_build_object(
    'totals', jsonb_build_object(
      'teachers', (select count(*) from profiles where role = 'teacher'),
      'students', (select count(*) from profiles where role = 'student'),
      'classes', (select count(*) from classes),
      'lessons', (select count(*) from lessons),
      'assignments', (select count(*) from assignments),
      'attempts_started', (select count(*) from attempts),
      'attempts_finished', (select count(*) from attempts where finished_at is not null),
      'flagged_attempts', (select count(distinct attempt_id) from focus_events where kind <> 'no_fullscreen_support')),

    -- Everyone on the allowlist plus anyone with a teacher account (e.g. added by SQL and later de-listed).
    'teachers', coalesce((
      select jsonb_agg(row order by row ->> 'email') from (
        select jsonb_build_object(
          'email', coalesce(al.email, p.email),
          'name', p.name,
          'on_allowlist', al.email is not null,
          'added_at', al.added_at,
          'added_by', al.added_by,
          'role', p.role,  -- null: hasn't signed in yet
          'classroom_connected', exists (select 1 from google_tokens g where g.user_id = p.id),
          'last_synced_at', (select max(c.google_synced_at) from classes c where c.teacher_id = p.id),
          'classes', (select count(*) from classes c where c.teacher_id = p.id),
          'students', (select count(distinct e.student_id) from enrollments e join classes c on c.id = e.class_id where c.teacher_id = p.id),
          'lessons', (select count(*) from lessons l where l.teacher_id = p.id),
          'assignments', (select count(*) from assignments a join classes c on c.id = a.class_id where c.teacher_id = p.id)
        ) as row
        from teacher_allowlist al full join profiles p on p.email = al.email
        where al.email is not null or p.role = 'teacher'
      ) t), '[]'::jsonb),

    'assignments', coalesce((
      select jsonb_agg(row order by row ->> 'created_at' desc) from (
        select jsonb_build_object(
          'id', a.id,
          'created_at', a.created_at,
          'due_at', a.due_at,
          'teacher', tp.email,
          'class', c.name,
          'lesson', l.title,
          'posted_to_classroom', a.google_coursework_id is not null,
          'students', (select count(*) from enrollments e where e.class_id = a.class_id),
          'started', (select count(*) from attempts t where t.assignment_id = a.id),
          'finished', (select count(*) from attempts t where t.assignment_id = a.id and t.finished_at is not null),
          'avg_score', (select round(avg(t.score), 1) from attempts t where t.assignment_id = a.id and t.finished_at is not null),
          'flagged', (select count(distinct f.attempt_id) from focus_events f join attempts t on t.id = f.attempt_id
                      where t.assignment_id = a.id and f.kind <> 'no_fullscreen_support'),
          'focus_events', (select count(*) from focus_events f join attempts t on t.id = f.attempt_id
                           where t.assignment_id = a.id and f.kind <> 'no_fullscreen_support')
        ) as row
        from assignments a
        join classes c on c.id = a.class_id
        join lessons l on l.id = a.lesson_id
        join profiles tp on tp.id = c.teacher_id
        order by a.created_at desc
        limit 200
      ) t), '[]'::jsonb),

    'audit', coalesce((
      select jsonb_agg(jsonb_build_object('actor', x.actor_email, 'action', x.action, 'target', x.target, 'detail', x.detail, 'at', x.at) order by x.at desc, x.id desc)
      from (select * from admin_audit order by at desc, id desc limit 25) x), '[]'::jsonb));
end $$;

revoke all on function public.is_admin(), public.admin_email(), public.admin_add_teacher(text),
  public.admin_remove_teacher(text), public.admin_dashboard() from public, anon;
revoke all on function public.admin_email() from authenticated;
grant execute on function public.is_admin(), public.admin_add_teacher(text), public.admin_remove_teacher(text),
  public.admin_dashboard() to authenticated;
