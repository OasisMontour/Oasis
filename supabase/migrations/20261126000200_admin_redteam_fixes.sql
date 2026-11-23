-- Red team of the admin page (Nov 23), fixes:
--
-- 1. Removing a teacher didn't cut off their data. Ownership checks (teaches_class, owns_lesson, and the
--    classes / lessons / student-profile policies) only compared teacher_id to the caller, never the role,
--    so a demoted teacher kept reading their classes, rosters, student names, attempts, answers and answer
--    keys through the API. Every teacher-side check now also requires role = 'teacher'. Re-adding the
--    teacher restores access to everything they had; nothing is deleted.
--    This also closes the open item from the Nov 23 red team: "de-listed teacher keeps role (manual)".
-- 2. Clients could call nextval() on admin_audit's id sequence (Supabase's default grants). Harmless, but revoked.
--
-- (Issues found in the new admin/usage code itself were fixed in those migrations before merge: usage counted
-- un-enrolled Google accounts and the admins as active users; teacher emails allowed markup characters.)

create or replace function public.teaches_class(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from classes cl join profiles p on p.id = cl.teacher_id
                 where cl.id = c and cl.teacher_id = auth.uid() and p.role = 'teacher');
$$;

create or replace function public.owns_lesson(l uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from lessons le join profiles p on p.id = le.teacher_id
                 where le.id = l and le.teacher_id = auth.uid() and p.role = 'teacher');
$$;

alter policy classes_teacher on public.classes
  using (teacher_id = auth.uid() and public.is_teacher());
alter policy lessons_owner on public.lessons
  using (teacher_id = auth.uid() and public.is_teacher());
alter policy profiles_teacher_sees_students on public.profiles using (
  public.is_teacher() and exists (select 1 from enrollments e join classes c on c.id = e.class_id
                                  where e.student_id = profiles.id and c.teacher_id = auth.uid()));

-- 2.
revoke all on sequence public.admin_audit_id_seq from anon, authenticated;
