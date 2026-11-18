-- Google Classroom is the only source of classes and rosters.
--
-- Before: teachers could create classes by hand, students could join with a code, teachers could
-- remove students, students could rename themselves. Now:
--   * classes only come from import_classroom (every class has a google_course_id),
--   * enrollments only come from Classroom rosters, and re-syncs mirror removals too,
--   * names come from the student's Google account.

-- No more manual classes or join codes.
revoke insert, update, delete on public.classes from authenticated;
drop function public.join_class(text);
alter table public.classes drop column join_code;
alter table public.classes alter column google_course_id set not null;

-- No more manual roster edits.
revoke delete on public.enrollments from authenticated;
drop policy enrollments_teacher_delete on public.enrollments;

-- Names come from Google, not typed in.
revoke update on public.profiles from authenticated;
drop policy profiles_update_self on public.profiles;

-- A student removed from the Classroom roster still shows up by name in results for work they did.
create policy profiles_teacher_sees_past_students on public.profiles for select using (
  exists (select 1 from attempts t join assignments a on a.id = t.assignment_id
          where t.student_id = profiles.id and public.teaches_class(a.class_id)));

-- Re-sync now also removes students who left the Classroom course.
create or replace function public.import_classroom(p_courses jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c jsonb;
  cid uuid;
  cname text;
  created int := 0; updated int := 0; enrolled int := 0; removed int := 0; n int;
  skipped text[] := '{}';
begin
  if not public.is_teacher() then raise exception 'teachers only'; end if;
  if jsonb_typeof(p_courses) is distinct from 'array' then raise exception 'courses must be an array'; end if;
  if jsonb_array_length(p_courses) > 100 then raise exception 'too many courses'; end if;

  for c in select * from jsonb_array_elements(p_courses) loop
    cname := left(trim(both from concat_ws(' · ', nullif(trim(c ->> 'name'), ''), nullif(trim(c ->> 'section'), ''))), 120);
    if cname = '' then cname := 'Untitled class'; end if;
    if jsonb_array_length(coalesce(c -> 'students', '[]')) > 500 then raise exception 'class % has too many students', cname; end if;

    select id into cid from classes where google_course_id = c ->> 'id';
    if cid is null then
      insert into classes (teacher_id, name, google_course_id, google_synced_at)
      values (auth.uid(), cname, c ->> 'id', now()) returning id into cid;
      created := created + 1;
    elsif public.teaches_class(cid) then
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
