-- Google Classroom roster import.
--
-- The browser reads the teacher's courses + students from the Classroom API with the teacher's own
-- Google token (we never store it), then hands the result to import_classroom(). Students who
-- haven't signed into Oasis yet sit in roster_entries and are enrolled automatically the first
-- time they sign in, so nobody types a join code.

create table public.roster_entries (
  class_id uuid not null references public.classes(id) on delete cascade,
  email text not null check (email = lower(email)),
  name text not null default '',
  primary key (class_id, email)
);
create index on public.roster_entries (email);

alter table public.roster_entries enable row level security;
revoke all on public.roster_entries from anon, authenticated;
grant select on public.roster_entries to authenticated;
create policy roster_teacher on public.roster_entries for select using (public.teaches_class(class_id));

alter table public.classes add column google_synced_at timestamptz;

-- p_courses: [{ "id": "<google course id>", "name": "...", "section": "...",
--               "students": [{ "email": "...", "name": "..." }] }]
-- Creates or renames classes, replaces their rosters, enrolls students who already have accounts.
-- Never removes an existing enrollment (a student dropping in Classroom keeps their past work here).
create function public.import_classroom(p_courses jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c jsonb;
  cid uuid;
  cname text;
  created int := 0; updated int := 0; enrolled int := 0; n int;
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
  end loop;

  return jsonb_build_object('created', created, 'updated', updated, 'newly_enrolled', enrolled, 'skipped', to_jsonb(skipped));
end $$;
revoke all on function public.import_classroom(jsonb) from public, anon;
grant execute on function public.import_classroom(jsonb) to authenticated;

-- First sign-in: also enroll the new student in every class whose Classroom roster lists them.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare r text;
begin
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
