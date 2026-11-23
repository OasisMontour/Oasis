-- Red team Nov 23 (MEDIUM): students could read every question before watching.
--
-- get_student_lesson returned every question's prompt and choices the moment the student opened the
-- assignment, so a student could read all of them at 0:00 (devtools, or just the network tab), look the
-- answers up, and answer without paying attention to the video. The answer key was never exposed, but the
-- point of timestamped questions is lost.
--
-- Now a question's prompt and choices are only sent once the student has watched up to it (the same rule
-- submit_answer uses: max_watched_s + 1 >= at_s) or already answered it. Unreached questions come back as
-- { id, at_s, kind, answered: false, locked: true } so the player still knows where to pause.
--
-- Student player contract: when playback reaches a locked question's at_s, pause, save_progress up to at_s,
-- then call get_question(attempt_id, question_id) for its prompt and choices.

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
    'score', t.score,
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

-- One question's prompt and choices, once the student has reached it. Never the answer key.
create function public.get_question(p_attempt uuid, p_question uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t attempts; a assignments; q questions; answered boolean;
begin
  select * into t from attempts where id = p_attempt and student_id = auth.uid();
  if t.id is null then raise exception 'not your attempt'; end if;
  select * into a from assignments where id = t.assignment_id;
  if not public.enrolled_in(a.class_id) then raise exception 'not assigned to you'; end if;
  select * into q from questions where id = p_question and lesson_id = a.lesson_id;
  if q.id is null then raise exception 'question not in this lesson'; end if;
  answered := exists (select 1 from answers where attempt_id = t.id and question_id = q.id);
  if not answered and t.max_watched_s + 1 < q.at_s then raise exception 'you have not reached this question yet'; end if;
  return jsonb_build_object('id', q.id, 'at_s', q.at_s, 'kind', q.kind, 'prompt', q.prompt, 'choices', q.choices,
                            'answered', answered, 'locked', false);
end $$;
revoke all on function public.get_question(uuid, uuid) from public, anon;
grant execute on function public.get_question(uuid, uuid) to authenticated;
