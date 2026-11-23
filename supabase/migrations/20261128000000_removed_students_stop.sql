-- Integrated bug pass (Nov 23): a student taken off the Classroom roster mid-lesson got stuck.
-- get_question already refused them ("not assigned to you"), but save_progress, submit_answer, finish_attempt and
-- log_focus_event didn't check enrollment, so the video kept saving while every question failed to load, and the
-- player blamed the student's Wi-Fi. Now every write a student makes to their attempt needs them to still be in the
-- class. Done as triggers so it holds for any function that writes these rows, now or later, without copying the
-- (often replaced) function bodies. Teacher and service-role writes (grading, scores, AI) are unaffected: the
-- check only applies when the signed-in user is the attempt's own student.
-- Their attempt, answers and focus log stay, and the teacher still sees them on the results page.

create function public.require_still_enrolled() returns trigger
language plpgsql security definer set search_path = public as $$
declare att uuid; st uuid; cls uuid;
begin
  if tg_table_name = 'attempts' then att := new.id; else att := new.attempt_id; end if;
  select t.student_id, a.class_id into st, cls from attempts t join assignments a on a.id = t.assignment_id where t.id = att;
  if st is not null and st = auth.uid()
     and not exists (select 1 from enrollments e where e.class_id = cls and e.student_id = st) then
    raise exception 'not assigned to you' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
revoke all on function public.require_still_enrolled() from public, anon, authenticated;

create trigger attempts_require_enrolled before update on public.attempts
  for each row execute function public.require_still_enrolled();
create trigger answers_require_enrolled before insert on public.answers
  for each row execute function public.require_still_enrolled();
create trigger focus_events_require_enrolled before insert on public.focus_events
  for each row execute function public.require_still_enrolled();
