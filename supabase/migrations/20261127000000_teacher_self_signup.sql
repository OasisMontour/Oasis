-- Teachers sign themselves up with Google Classroom. No allowlist needed.
--
-- Flow: anyone signs in with Google (basic scopes) and gets a student account. A teacher clicks "Sign up as a
-- teacher", approves Classroom access, and the `classroom` Edge Function asks Google about that account and calls
-- claim_teacher_for() with what Google said. The role is decided here, never by the browser.
--
-- Who gets the teacher role straight away: only someone Google says is a verified teacher (Classroom
-- UserProfile.verifiedTeacher: their Workspace for Education admin verified them) who teaches at least one active
-- Classroom course.
-- Everyone else who teaches a course waits for an admin (teacher_requests, status 'pending'). "Teaches a course"
-- alone proves nothing: anyone can make one with a personal Gmail in 30 seconds, and in districts that let any
-- user create classes, a student can make one with their school account too (before their real teacher's roster
-- syncs, nothing in Oasis says they're a student). A teacher account can read every shared lesson's answer key,
-- so either would be a cheating tool. Trusted school domains (teacher_domains) don't grant anything; they only
-- mark a pending sign-up as "from a school we work with" for the admin.
--
-- Refused outright: no active courses, a Google account that isn't the one signed in to Oasis, an account
-- already used as a student (enrolled or has attempts), and anyone an admin blocked.
--
-- The old allowlist stays as an optional admin override ("pre-approve"): an allowlisted email is a teacher on
-- first sign-in without Classroom, for a teacher who gets stuck in the normal sign-up.
-- Admin remove/deny now also blocks the email, otherwise a removed teacher could sign straight back up.

create table public.teacher_requests (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  status text not null check (status in ('pending', 'approved')),
  via text check (via in ('verified_teacher', 'admin')),             -- set when approved
  reason text not null default '',                                   -- why it's pending
  evidence jsonb not null default '{}',                              -- what Google said, for the admin
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text                                                     -- admin email, or 'auto'
);
alter table public.teacher_requests enable row level security;  -- no policies: RPCs only
revoke all on public.teacher_requests from anon, authenticated;

create table public.teacher_domains (
  domain text primary key check (domain = lower(domain) and domain ~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$'),
  added_by text,
  added_at timestamptz not null default now()
);
alter table public.teacher_domains enable row level security;
revoke all on public.teacher_domains from anon, authenticated;

create table public.teacher_blocks (
  email text primary key check (email = lower(email)),
  -- removed = was a teacher and an admin took it away; denied = a sign-up an admin turned down.
  -- Only changes what the person is told.
  kind text not null default 'denied' check (kind in ('denied', 'removed')),
  added_by text,
  added_at timestamptz not null default now()
);
alter table public.teacher_blocks enable row level security;
revoke all on public.teacher_blocks from anon, authenticated;

alter table public.admin_audit drop constraint admin_audit_action_check;
alter table public.admin_audit add constraint admin_audit_action_check check (action in (
  'add_teacher', 'remove_teacher', 'approve_teacher', 'deny_teacher', 'unblock_teacher', 'add_domain', 'remove_domain'));

-- Domains Google treats as personal accounts. Never approvable as a school domain.
create function public.is_consumer_domain(d text) returns boolean
language sql immutable as $$ select lower(d) in ('gmail.com', 'googlemail.com') $$;

create function public.has_student_footprint(u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from enrollments where student_id = u) or exists (select 1 from attempts where student_id = u);
$$;

-- ---------------------------------------------------------------- the role grant (service role only)

-- p_ev comes from the classroom Edge Function, fetched from Google with the caller's own fresh token:
--   google_email     Classroom profile email of the account that granted access
--   hosted_domain    Workspace domain from Google's userinfo (null = personal account)
--   verified_teacher Classroom UserProfile.verifiedTeacher
--   active_courses   courses with teacherId=me, courseStates=ACTIVE
--   students         total students across them
--   course_names     first few course names, for the admin
create function public.claim_teacher_for(p_user uuid, p_ev jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p profiles;
  dom text;
  hd text;
  verified boolean;
  n int;
  ev jsonb;
  why text;
  grant_via text;
begin
  select * into p from profiles where id = p_user;
  if p.id is null then raise exception 'no such user'; end if;
  if jsonb_typeof(p_ev) is distinct from 'object' then raise exception 'evidence must be an object'; end if;
  -- The Classroom access must belong to the Oasis account asking. Otherwise a student could borrow a
  -- teacher's (or their own throwaway) Google account to promote their school account. Checked before the
  -- already-a-teacher shortcut too: a granted claim stores the token and imports its classes.
  if lower(coalesce(p_ev ->> 'google_email', '')) is distinct from p.email then
    return jsonb_build_object('status', 'refused', 'reason', 'wrong_account');
  end if;
  if p.role = 'teacher' then return jsonb_build_object('status', 'granted', 'reason', 'already_teacher'); end if;

  if exists (select 1 from teacher_blocks where email = p.email) then
    return jsonb_build_object('status', 'refused', 'reason',
      case when (select kind from teacher_blocks where email = p.email) = 'removed' then 'removed' else 'blocked' end);
  end if;
  n := case when jsonb_typeof(p_ev -> 'active_courses') = 'number' then least((p_ev ->> 'active_courses')::numeric, 1000)::int else 0 end;
  if n < 1 then return jsonb_build_object('status', 'refused', 'reason', 'no_courses'); end if;
  if public.has_student_footprint(p.id) then
    return jsonb_build_object('status', 'refused', 'reason', 'student_account');
  end if;

  dom := split_part(p.email, '@', 2);
  hd := nullif(lower(trim(coalesce(p_ev ->> 'hosted_domain', ''))), '');
  if public.is_consumer_domain(hd) then hd := null; end if;
  verified := coalesce(p_ev -> 'verified_teacher' = 'true'::jsonb, false);

  -- Keep only what the admin needs, bounded.
  ev := jsonb_build_object(
    'google_email', p.email,
    'hosted_domain', hd,
    'verified_teacher', verified,
    'active_courses', n,
    'students', case when jsonb_typeof(p_ev -> 'students') = 'number' then least((p_ev ->> 'students')::numeric, 100000)::int else null end,
    'course_names', coalesce((
      select jsonb_agg(left(x, 120)) from (
        select x from jsonb_array_elements_text(case when jsonb_typeof(p_ev -> 'course_names') = 'array' then p_ev -> 'course_names' else '[]' end) x
        limit 5) y), '[]'::jsonb));

  if verified then
    grant_via := 'verified_teacher';
  elsif exists (select 1 from roster_entries where email = p.email) then
    -- An imported Classroom roster lists this account as a student. Only Google's own verification overrides that.
    why := 'on_student_roster';
  elsif hd is not null and exists (select 1 from teacher_domains where domain = dom) then
    -- A school we work with: a hint for the admin, never a grant. (Security review of #14: a student on a shared
    -- school domain could make a throwaway class and get in before their teacher's roster synced.)
    -- Matched on the email's own domain; hd only proves a school manages the account.
    why := 'trusted_domain';
  elsif hd is null then
    why := 'personal_account';
  else
    why := 'not_verified';
  end if;

  if grant_via is not null then
    update profiles set role = 'teacher' where id = p.id;
    insert into teacher_requests (user_id, status, via, evidence, decided_at, decided_by)
    values (p.id, 'approved', grant_via, ev, now(), 'auto')
    on conflict (user_id) do update set status = 'approved', via = excluded.via, reason = '', evidence = excluded.evidence,
      decided_at = now(), decided_by = 'auto';
    return jsonb_build_object('status', 'granted', 'via', grant_via);
  end if;

  insert into teacher_requests (user_id, status, reason, evidence)
  values (p.id, 'pending', why, ev)
  on conflict (user_id) do update set status = 'pending', via = null, reason = excluded.reason, evidence = excluded.evidence,
    decided_at = null, decided_by = null;
  return jsonb_build_object('status', 'pending', 'reason', why);
end $$;
revoke all on function public.claim_teacher_for(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.claim_teacher_for(uuid, jsonb) to service_role;

-- The signed-in user's own request, for the sign-up page.
create function public.my_teacher_request() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'status', r.status,
    'reason', r.reason,
    'requested_at', r.requested_at,
    'blocked', exists (select 1 from teacher_blocks b join profiles p on p.email = b.email where p.id = auth.uid()),
    -- An admin took their teacher access away. Shown on the student page so they aren't left guessing.
    'removed', exists (select 1 from teacher_blocks b join profiles p on p.email = b.email where p.id = auth.uid() and b.kind = 'removed'))
  from (select 1) one left join teacher_requests r on r.user_id = auth.uid();
$$;
revoke all on function public.my_teacher_request() from public, anon;
grant execute on function public.my_teacher_request() to authenticated;

-- A pending (not yet teacher) user may hold a stored Classroom token so approval needs no second consent.
-- classroom_status is still teacher-only.

-- ---------------------------------------------------------------- admin actions

create function public.admin_approve_teacher(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := public.admin_email(); p profiles;
begin
  if me is null then raise exception 'admins only' using errcode = 'insufficient_privilege'; end if;
  select pr.* into p from profiles pr join teacher_requests r on r.user_id = pr.id where pr.id = p_user and r.status = 'pending';
  if p.id is null then raise exception 'no pending sign-up for that account'; end if;
  if public.has_student_footprint(p.id) then
    raise exception '% already uses Oasis as a student (enrolled in classes), so it was not made a teacher', p.email;
  end if;
  update profiles set role = 'teacher' where id = p.id;
  update teacher_requests set status = 'approved', via = 'admin', reason = '', decided_at = now(), decided_by = me where user_id = p.id;
  delete from teacher_blocks where email = p.email;
  insert into admin_audit (actor_email, action, target) values (me, 'approve_teacher', p.email);
  return jsonb_build_object('email', p.email);
end $$;

-- Deny = block the email from signing up as a teacher again, and drop their stored Classroom token.
create function public.admin_deny_teacher(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := public.admin_email(); p profiles;
begin
  if me is null then raise exception 'admins only' using errcode = 'insufficient_privilege'; end if;
  select pr.* into p from profiles pr join teacher_requests r on r.user_id = pr.id where pr.id = p_user and r.status = 'pending';
  if p.id is null then raise exception 'no pending sign-up for that account'; end if;
  delete from teacher_requests where user_id = p.id;
  delete from google_tokens where user_id = p.id;
  insert into teacher_blocks (email, kind, added_by) values (p.email, 'denied', me) on conflict (email) do nothing;
  insert into admin_audit (actor_email, action, target) values (me, 'deny_teacher', p.email);
  return jsonb_build_object('email', p.email);
end $$;

create function public.admin_unblock_teacher(p_email text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := public.admin_email(); e text := lower(trim(p_email));
begin
  if me is null then raise exception 'admins only' using errcode = 'insufficient_privilege'; end if;
  delete from teacher_blocks where email = e;
  if not found then raise exception '% is not blocked', e; end if;
  insert into admin_audit (actor_email, action, target) values (me, 'unblock_teacher', e);
  return jsonb_build_object('email', e);
end $$;

create function public.admin_add_domain(p_domain text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := public.admin_email(); d text := lower(trim(trim(p_domain), '@'));
begin
  if me is null then raise exception 'admins only' using errcode = 'insufficient_privilege'; end if;
  if d is null or length(d) > 253 or d !~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$' then raise exception 'not a valid domain'; end if;
  if public.is_consumer_domain(d) then raise exception '% is personal Google accounts, not a school', d; end if;
  insert into teacher_domains (domain, added_by) values (d, me) on conflict (domain) do nothing;
  insert into admin_audit (actor_email, action, target) values (me, 'add_domain', d);
  return jsonb_build_object('domain', d);
end $$;

create function public.admin_remove_domain(p_domain text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := public.admin_email(); d text := lower(trim(p_domain));
begin
  if me is null then raise exception 'admins only' using errcode = 'insufficient_privilege'; end if;
  delete from teacher_domains where domain = d;
  if not found then raise exception '% is not an approved domain', d; end if;
  -- Teachers already approved through it stay teachers. Remove them one by one if needed.
  insert into admin_audit (actor_email, action, target) values (me, 'remove_domain', d);
  return jsonb_build_object('domain', d);
end $$;

-- Pre-approve (old "add teacher"): also lifts a block and approves a pending sign-up.
create or replace function public.admin_add_teacher(p_email text) returns jsonb
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
  if p.id is not null and p.role = 'student' and public.has_student_footprint(p.id) then
    raise exception '% already uses Oasis as a student (enrolled in classes), so it was not made a teacher', e;
  end if;

  insert into teacher_allowlist (email, added_by) values (e, me) on conflict (email) do nothing;
  listed := not found;
  delete from teacher_blocks where email = e;
  if p.id is not null and p.role = 'student' then
    update profiles set role = 'teacher' where id = p.id;
    update teacher_requests set status = 'approved', via = 'admin', reason = '', decided_at = now(), decided_by = me where user_id = p.id;
    promoted := true;
  end if;

  insert into admin_audit (actor_email, action, target, detail)
  values (me, 'add_teacher', e, case when listed then 'already listed' when promoted then 'promoted existing account' else '' end);
  return jsonb_build_object('email', e, 'already_listed', listed, 'promoted', promoted);
end $$;

-- Remove: off the allowlist, back to student, and blocked from signing back up through Classroom.
-- Their classes, lessons and student results are kept (teacher-side access is cut by the role checks).
create or replace function public.admin_remove_teacher(p_email text) returns jsonb
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
  delete from teacher_requests where user_id = (select id from profiles where email = e);
  insert into teacher_blocks (email, kind, added_by) values (e, 'removed', me)
    on conflict (email) do update set kind = 'removed', added_by = excluded.added_by, added_at = now();
  insert into admin_audit (actor_email, action, target, detail)
  values (me, 'remove_teacher', e, case when demoted then 'account demoted to student, blocked from signing up again' else 'had not signed in; blocked' end);
  return jsonb_build_object('email', e, 'was_listed', was_listed, 'demoted', demoted);
end $$;

-- ---------------------------------------------------------------- dashboard (adds sign-ups, domains, blocks, "via")

create or replace function public.admin_dashboard() returns jsonb
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

    'teachers', coalesce((
      select jsonb_agg(row order by row ->> 'email') from (
        select jsonb_build_object(
          'email', coalesce(al.email, p.email),
          'name', p.name,
          'on_allowlist', al.email is not null,
          'via', case when al.email is not null then 'allowlist' else tr.via end,
          'added_at', coalesce(al.added_at, tr.decided_at),
          'added_by', coalesce(al.added_by, nullif(tr.decided_by, 'auto')),
          'role', p.role,  -- null: pre-approved, hasn't signed in yet
          'classroom_connected', exists (select 1 from google_tokens g where g.user_id = p.id),
          'last_synced_at', (select max(c.google_synced_at) from classes c where c.teacher_id = p.id),
          'classes', (select count(*) from classes c where c.teacher_id = p.id),
          'students', (select count(distinct e.student_id) from enrollments e join classes c on c.id = e.class_id where c.teacher_id = p.id),
          'lessons', (select count(*) from lessons l where l.teacher_id = p.id),
          'assignments', (select count(*) from assignments a join classes c on c.id = a.class_id where c.teacher_id = p.id)
        ) as row
        from teacher_allowlist al
        full join profiles p on p.email = al.email
        left join teacher_requests tr on tr.user_id = p.id and tr.status = 'approved'
        where al.email is not null or p.role = 'teacher'
      ) t), '[]'::jsonb),

    -- Teachers waiting for an admin. Their own email, name and what Google said about them. Teachers, not students.
    'signups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', r.user_id, 'email', p.email, 'name', p.name, 'reason', r.reason,
        'evidence', r.evidence, 'requested_at', r.requested_at) order by r.requested_at)
      from teacher_requests r join profiles p on p.id = r.user_id
      where r.status = 'pending'), '[]'::jsonb),
    'domains', coalesce((select jsonb_agg(jsonb_build_object('domain', domain, 'added_by', added_by, 'added_at', added_at) order by domain)
                         from teacher_domains), '[]'::jsonb),
    'blocked', coalesce((select jsonb_agg(jsonb_build_object('email', email, 'kind', kind, 'added_by', added_by, 'added_at', added_at) order by added_at desc)
                         from teacher_blocks), '[]'::jsonb),

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

revoke all on function public.is_consumer_domain(text), public.has_student_footprint(uuid),
  public.admin_approve_teacher(uuid), public.admin_deny_teacher(uuid), public.admin_unblock_teacher(text),
  public.admin_add_domain(text), public.admin_remove_domain(text) from public, anon;
revoke all on function public.has_student_footprint(uuid) from authenticated;
grant execute on function public.admin_approve_teacher(uuid), public.admin_deny_teacher(uuid), public.admin_unblock_teacher(text),
  public.admin_add_domain(text), public.admin_remove_domain(text) to authenticated;
