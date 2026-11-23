-- Cheat test Nov 23 (MEDIUM): students could learn which answers are right and share a verified key.
--
-- submit_answer returned true/false the moment a student answered, finish_attempt and get_student_lesson
-- returned the score, and students could read answers.is_correct and attempts.score over REST. Three
-- classmates each picking a different choice on a 3-choice question found the right one in one pass, and
-- anyone who scored 100 could post a proven answer key for later periods. No student screen uses any of it
-- (the player never shows right/wrong), so students now get none of it. Teachers still see everything
-- through assignment_results, their own RLS policies, and grades_to_push below.

-- 1. RPCs stop returning correctness or score.
drop function public.submit_answer(uuid, uuid, text);
create function public.submit_answer(p_attempt uuid, p_question uuid, p_response text) returns void
language plpgsql security definer set search_path = public as $$
declare t attempts; q questions; correct boolean;
begin
  select * into t from attempts where id = p_attempt and student_id = auth.uid();
  if t.id is null then raise exception 'not your attempt'; end if;
  if t.finished_at is not null then raise exception 'attempt already finished'; end if;
  select q2.* into q from questions q2 join assignments a on a.lesson_id = q2.lesson_id
    where q2.id = p_question and a.id = t.assignment_id;
  if q.id is null then raise exception 'question not in this lesson'; end if;
  if t.max_watched_s + 1 < q.at_s then raise exception 'you have not reached this question yet'; end if;

  if q.kind = 'mc' then
    if p_response !~ '^[0-9]+$' then raise exception 'mc response must be a choice index'; end if;
    correct := (p_response::int = q.correct_index);
  end if;

  insert into answers (attempt_id, question_id, response, is_correct, graded_by)
  values (t.id, q.id, p_response, correct, case when q.kind = 'mc' then 'auto' end)
  on conflict (attempt_id, question_id) do nothing;
  if not found then raise exception 'already answered'; end if;
end $$;

drop function public.finish_attempt(uuid);
create function public.finish_attempt(p_attempt uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t attempts; l lessons; missing int;
begin
  select * into t from attempts where id = p_attempt and student_id = auth.uid() for update;
  if t.id is null then raise exception 'not your attempt'; end if;
  if t.finished_at is not null then return; end if;
  select l2.* into l from lessons l2 join assignments a on a.lesson_id = l2.id where a.id = t.assignment_id;
  if t.max_watched_s < l.duration_s - 2 then raise exception 'video not finished'; end if;
  select count(*) into missing from questions q where q.lesson_id = l.id
    and not exists (select 1 from answers x where x.attempt_id = t.id and x.question_id = q.id);
  if missing > 0 then raise exception 'unanswered questions'; end if;
  update attempts set finished_at = now(), score = public.compute_score(t.id), updated_at = now() where id = t.id;
end $$;

revoke all on function public.submit_answer(uuid, uuid, text), public.finish_attempt(uuid) from public, anon;
grant execute on function public.submit_answer(uuid, uuid, text), public.finish_attempt(uuid) to authenticated;

-- get_student_lesson: same as 20261124000100 minus 'score'.
create or replace function public.get_student_lesson(p_assignment uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a assignments; l lessons; t attempts;
begin
  select * into a from assignments where id = p_assignment;
  if a.id is null or not public.enrolled_in(a.class_id) then raise exception 'not assigned to you'; end if;
  select * into l from lessons where id = a.lesson_id;
  insert into attempts (assignment_id, student_id) values (a.id, auth.uid())
    on conflict (assignment_id, student_id) do update set updated_at = attempts.updated_at
    returning * into t;
  return jsonb_build_object(
    'attempt_id', t.id,
    'title', l.title,
    'youtube_id', l.youtube_id,
    'duration_s', l.duration_s,
    'require_fullscreen', l.require_fullscreen,
    'max_watched_s', t.max_watched_s,
    'last_pos_s', t.last_pos_s,
    'finished_at', t.finished_at,
    'questions', coalesce((
      select jsonb_agg(
        case when x.answered or t.max_watched_s + 1 >= x.at_s
          then jsonb_build_object('id', x.id, 'at_s', x.at_s, 'kind', x.kind, 'prompt', x.prompt, 'choices', x.choices,
                                  'answered', x.answered, 'locked', false)
          else jsonb_build_object('id', x.id, 'at_s', x.at_s, 'kind', x.kind, 'answered', false, 'locked', true)
        end
        order by x.at_s, x.position)
      from (
        select q.*, exists (select 1 from answers y where y.attempt_id = t.id and y.question_id = q.id) as answered
        from questions q where q.lesson_id = l.id
      ) x), '[]'::jsonb));
end $$;

-- 2. Students can't read their graded answers or their score over REST.
-- Teachers keep answers_teacher; students see which questions they answered via get_student_lesson.
drop policy answers_self on public.answers;
-- Column grants are per role, and teachers and students share `authenticated`, so score is readable only
-- through security-definer RPCs (assignment_results, grade_answer, grades_to_push).
revoke select on public.attempts from authenticated;
grant select (id, assignment_id, student_id, max_watched_s, last_pos_s, finished_at, started_at, updated_at)
  on public.attempts to authenticated;

-- 3. The classroom Edge Function read attempts.score with the teacher's token to push grades. Same data,
-- now from an RPC that checks the caller teaches the class.
create function public.grades_to_push(p_assignment uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare a assignments; c classes;
begin
  select * into a from assignments where id = p_assignment;
  if a.id is null or not public.teaches_class(a.class_id) then return null; end if;
  select * into c from classes where id = a.class_id;
  return jsonb_build_object(
    'course_id', c.google_course_id,
    'coursework_id', a.google_coursework_id,
    'grades', coalesce((
      select jsonb_agg(jsonb_build_object(
        'email', p.email,
        'score', t.score,
        'ungraded', (select count(*) from answers x where x.attempt_id = t.id and x.is_correct is null)))
      from attempts t join profiles p on p.id = t.student_id
      where t.assignment_id = a.id and t.finished_at is not null and t.score is not null), '[]'::jsonb));
end $$;
revoke all on function public.grades_to_push(uuid) from public, anon;
grant execute on function public.grades_to_push(uuid) to authenticated;
