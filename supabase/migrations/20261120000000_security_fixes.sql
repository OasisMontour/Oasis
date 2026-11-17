-- Security fixes from the Nov 17 red-team pass (PoCs in project files: oasis/redteam-2026-11-17).

-- ------------------------------------------------------------------ 1. skip-by-spam (HIGH)
-- Old rule: each save may move max_watched_s forward by (time since last save) + 5s. The +5s was
-- granted fresh on every call, so 120 rapid calls of +5s skipped a 10-minute video in ~75ms.
--
-- New rule: a token bucket. Every attempt has `watch_credit_s`, refilled at 1s per real second and
-- capped at 30s. Moving forward spends credit. Rapid calls refill ~nothing, so the most a student can
-- ever get ahead of real time is 30s total, not 5s per call. 30s comfortably covers the player's
-- 15s save interval plus network jitter, and a long pause just leaves the bucket full (still 30s max).

alter table public.attempts
  add column watch_credit_s numeric not null default 30,
  add column credit_at timestamptz not null default now();

create or replace function public.save_progress(p_attempt uuid, p_max_watched numeric, p_last_pos numeric) returns void
language plpgsql security definer set search_path = public as $$
declare t attempts; l lessons; gate numeric; credit numeric; allowed numeric; gained numeric;
begin
  select * into t from attempts where id = p_attempt and student_id = auth.uid() for update;
  if t.id is null then raise exception 'not your attempt'; end if;
  if t.finished_at is not null then return; end if;
  if p_max_watched is null or p_last_pos is null or p_max_watched = 'NaN' or p_last_pos = 'NaN' then
    raise exception 'bad progress value';
  end if;
  select l2.* into l from lessons l2 join assignments a on a.lesson_id = l2.id where a.id = t.assignment_id;

  credit := least(30, t.watch_credit_s + greatest(0, extract(epoch from (now() - t.credit_at))));
  allowed := t.max_watched_s + credit;
  select min(q.at_s) into gate from questions q
    where q.lesson_id = l.id
      and not exists (select 1 from answers x where x.attempt_id = t.id and x.question_id = q.id);
  if gate is not null then allowed := least(allowed, gate + 1); end if;
  allowed := least(allowed, l.duration_s);

  if p_max_watched > allowed then raise exception 'progress jump rejected'; end if;

  gained := greatest(0, p_max_watched - t.max_watched_s);
  update attempts set
    max_watched_s = greatest(max_watched_s, p_max_watched),
    last_pos_s = least(greatest(p_last_pos, 0), greatest(max_watched_s, p_max_watched)),
    watch_credit_s = credit - gained,
    credit_at = now(),
    updated_at = now()
  where id = t.id;
end $$;

-- ------------------------------------------------------------------ 2. forged rosters (MEDIUM)
-- import_classroom was callable by any signed-in teacher with any JSON, so a teacher could enroll
-- arbitrary students or squat another teacher's course id. Rosters must only come from Google, so the
-- only caller is now the `classroom` Edge Function (service role), which passes the verified teacher id.

drop function public.import_classroom(jsonb);

create function public.import_classroom_for(p_teacher uuid, p_courses jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c jsonb;
  cid uuid;
  cname text;
  created int := 0; updated int := 0; enrolled int := 0; removed int := 0; n int;
  skipped text[] := '{}';
begin
  if not exists (select 1 from profiles where id = p_teacher and role = 'teacher') then raise exception 'teachers only'; end if;
  if jsonb_typeof(p_courses) is distinct from 'array' then raise exception 'courses must be an array'; end if;
  if jsonb_array_length(p_courses) > 100 then raise exception 'too many courses'; end if;

  for c in select * from jsonb_array_elements(p_courses) loop
    cname := left(trim(both from concat_ws(' · ', nullif(trim(c ->> 'name'), ''), nullif(trim(c ->> 'section'), ''))), 120);
    if cname = '' then cname := 'Untitled class'; end if;
    if jsonb_array_length(coalesce(c -> 'students', '[]')) > 500 then raise exception 'class % has too many students', cname; end if;

    select id into cid from classes where google_course_id = c ->> 'id';
    if cid is null then
      insert into classes (teacher_id, name, google_course_id, google_synced_at)
      values (p_teacher, cname, c ->> 'id', now()) returning id into cid;
      created := created + 1;
    elsif exists (select 1 from classes where id = cid and teacher_id = p_teacher) then
      update classes set name = cname, google_synced_at = now() where id = cid;
      updated := updated + 1;
    else
      -- A co-teacher already imported this course. Don't hand it to a second teacher.
      skipped := skipped || cname;
      continue;
    end if;

    delete from roster_entries where class_id = cid;
    insert into roster_entries (class_id, email, name)
      select distinct on (lower(trim(s ->> 'email'))) cid, lower(trim(s ->> 'email')), left(coalesce(s ->> 'name', ''), 200)
      from jsonb_array_elements(coalesce(c -> 'students', '[]')) s
      where coalesce(trim(s ->> 'email'), '') like '%_@_%';

    insert into enrollments (class_id, student_id)
      select cid, p.id from roster_entries r join profiles p on p.email = r.email and p.role = 'student'
      where r.class_id = cid
      on conflict do nothing;
    get diagnostics n = row_count;
    enrolled := enrolled + n;

    -- Classroom is the source of truth: students no longer on the roster lose access to the class.
    -- Their attempts and answers stay, and the teacher can still see them in results.
    delete from enrollments e
      using profiles p
      where e.class_id = cid and p.id = e.student_id
        and not exists (select 1 from roster_entries r where r.class_id = cid and r.email = p.email);
    get diagnostics n = row_count;
    removed := removed + n;
  end loop;

  return jsonb_build_object('created', created, 'updated', updated, 'newly_enrolled', enrolled, 'removed', removed, 'skipped', to_jsonb(skipped));
end $$;
revoke all on function public.import_classroom_for(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.import_classroom_for(uuid, jsonb) to service_role;
