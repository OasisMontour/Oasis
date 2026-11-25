-- Real-Classroom hardening for import_classroom_for (live bug test, Nov 25):
-- * Classroom allows 1,000 students per class; we refused anything over 500, which failed the whole sync.
-- * A course where Google hid some students' emails (directory / contact-sharing settings) no longer unenrolls
--   anyone: "no email" isn't "left the class", and kids were losing access mid-lesson.
-- Everything else is unchanged from 20261120000000_security_fixes.sql.
create or replace function public.import_classroom_for(p_teacher uuid, p_courses jsonb) returns jsonb
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
    if jsonb_array_length(coalesce(c -> 'students', '[]')) > 1000 then raise exception 'class % has too many students', cname; end if;

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

    if coalesce((c ->> 'hidden_emails')::int, 0) > 0 then
      -- Some students came back without an email. Keep the existing roster rows and only add new ones,
      -- so nobody is dropped because Google hid their address this time.
      insert into roster_entries (class_id, email, name)
        select distinct on (lower(trim(s ->> 'email'))) cid, lower(trim(s ->> 'email')), left(coalesce(s ->> 'name', ''), 200)
        from jsonb_array_elements(coalesce(c -> 'students', '[]')) s
        where coalesce(trim(s ->> 'email'), '') like '%_@_%'
        on conflict do nothing;
    else
      delete from roster_entries where class_id = cid;
      insert into roster_entries (class_id, email, name)
        select distinct on (lower(trim(s ->> 'email'))) cid, lower(trim(s ->> 'email')), left(coalesce(s ->> 'name', ''), 200)
        from jsonb_array_elements(coalesce(c -> 'students', '[]')) s
        where coalesce(trim(s ->> 'email'), '') like '%_@_%';
    end if;

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
