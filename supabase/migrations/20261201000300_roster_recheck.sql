-- Roster recheck (beta item 4): a student opens an assignment before their teacher's roster has synced (added to
-- the Google Classroom class this morning, say). Before "not assigned to you", the classroom Edge Function
-- re-reads that one class's roster from Google with the teacher's stored token, once.
--
-- This function (service role only) says which class/teacher to recheck, and rate-limits: one recheck per student
-- per class every 10 minutes, so a student (or a script) can't make Oasis hammer a teacher's Classroom quota.
create table public.roster_rechecks (
  student_id uuid not null references public.profiles(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  at timestamptz not null default now(),
  primary key (student_id, class_id)
);
alter table public.roster_rechecks enable row level security;  -- no policies: function only
revoke all on public.roster_rechecks from anon, authenticated;

-- { status: 'recheck', teacher_id, class_id, course_id } | { status: 'enrolled' } | { status: 'limited' }
-- | { status: 'not_found' } (no such assignment, not a Classroom class, or the caller isn't a student)
create function public.roster_recheck_target(p_student uuid, p_assignment uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a assignments; c classes;
begin
  if not exists (select 1 from profiles where id = p_student and role = 'student') then
    return jsonb_build_object('status', 'not_found');
  end if;
  select * into a from assignments where id = p_assignment;
  if a.id is null then return jsonb_build_object('status', 'not_found'); end if;
  select * into c from classes where id = a.class_id;
  if c.google_course_id is null then return jsonb_build_object('status', 'not_found'); end if;
  if exists (select 1 from enrollments where class_id = c.id and student_id = p_student) then
    return jsonb_build_object('status', 'enrolled');
  end if;
  insert into roster_rechecks (student_id, class_id) values (p_student, c.id)
    on conflict (student_id, class_id) do update set at = now() where roster_rechecks.at < now() - interval '10 minutes';
  if not found then return jsonb_build_object('status', 'limited'); end if;
  return jsonb_build_object('status', 'recheck', 'teacher_id', c.teacher_id, 'class_id', c.id, 'course_id', c.google_course_id);
end $$;
revoke all on function public.roster_recheck_target(uuid, uuid) from public, anon, authenticated;
grant execute on function public.roster_recheck_target(uuid, uuid) to service_role;
