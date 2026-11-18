-- Lesson builder: save a lesson and its questions in one call.
--
-- Why an RPC instead of plain table writes from the browser:
--   * The lesson and all its questions save atomically (no half-saved lesson if the tab closes).
--   * Question times are checked against the video length.
--   * Once students have answered, edits must not silently destroy their work:
--       - deleting an answered question is refused,
--       - changing an answered question's kind is refused,
--       - changing an MC answer key re-grades every auto-graded answer and every finished score.

create function public.save_lesson(p_lesson jsonb, p_questions jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  lid uuid := nullif(p_lesson ->> 'id', '')::uuid;
  dur numeric := (p_lesson ->> 'duration_s')::numeric;
  q jsonb;
  qid uuid;
  old questions;
  keep uuid[] := '{}';
  pos int := 0;
  rekeyed uuid[] := '{}';
begin
  if not public.is_teacher() then raise exception 'teachers only'; end if;
  if jsonb_typeof(p_questions) is distinct from 'array' then raise exception 'questions must be an array'; end if;
  if jsonb_array_length(p_questions) > 200 then raise exception 'too many questions (max 200)'; end if;

  if lid is null then
    insert into lessons (teacher_id, title, subject, youtube_id, duration_s, require_fullscreen, ai_grade_short, shared, source)
    values (auth.uid(), p_lesson ->> 'title', coalesce(p_lesson ->> 'subject', ''), p_lesson ->> 'youtube_id', dur,
            coalesce((p_lesson ->> 'require_fullscreen')::boolean, true),
            coalesce((p_lesson ->> 'ai_grade_short')::boolean, false),
            coalesce((p_lesson ->> 'shared')::boolean, false),
            coalesce(p_lesson ->> 'source', 'manual'))
    returning id into lid;
  else
    if not public.owns_lesson(lid) then raise exception 'not your lesson'; end if;
    if exists (select 1 from attempts t join assignments a on a.id = t.assignment_id where a.lesson_id = lid)
       and exists (select 1 from lessons where id = lid and youtube_id is distinct from p_lesson ->> 'youtube_id') then
      raise exception 'students have started this lesson, so the video cannot be changed. Make a new lesson instead.';
    end if;
    update lessons set
      title = p_lesson ->> 'title',
      subject = coalesce(p_lesson ->> 'subject', ''),
      youtube_id = p_lesson ->> 'youtube_id',
      duration_s = dur,
      require_fullscreen = coalesce((p_lesson ->> 'require_fullscreen')::boolean, true),
      ai_grade_short = coalesce((p_lesson ->> 'ai_grade_short')::boolean, false),
      shared = coalesce((p_lesson ->> 'shared')::boolean, false)
    where id = lid;
  end if;

  -- Collect ids being kept first so we can refuse deletes before writing anything else.
  for q in select * from jsonb_array_elements(p_questions) loop
    qid := nullif(q ->> 'id', '')::uuid;
    if qid is not null then
      if not exists (select 1 from questions where id = qid and lesson_id = lid) then
        raise exception 'question % is not in this lesson', qid;
      end if;
      keep := keep || qid;
    end if;
  end loop;

  if exists (select 1 from questions x where x.lesson_id = lid and x.id <> all (keep)
             and exists (select 1 from answers a where a.question_id = x.id)) then
    raise exception 'students already answered a question you removed. Edit it instead of deleting it.';
  end if;
  delete from questions where lesson_id = lid and id <> all (keep);

  for q in select * from jsonb_array_elements(p_questions) loop
    if (q ->> 'at_s')::numeric > dur then
      raise exception 'question at %s is past the end of the video', (q ->> 'at_s');
    end if;
    qid := nullif(q ->> 'id', '')::uuid;
    if qid is null then
      insert into questions (lesson_id, at_s, kind, prompt, choices, correct_index, position)
      values (lid, (q ->> 'at_s')::numeric, q ->> 'kind', q ->> 'prompt',
              case when q ->> 'kind' = 'mc' then q -> 'choices' end,
              case when q ->> 'kind' = 'mc' then (q ->> 'correct_index')::int end, pos);
    else
      select * into old from questions where id = qid;
      if old.kind <> q ->> 'kind' and exists (select 1 from answers where question_id = qid) then
        raise exception 'students already answered "%", so it cannot switch between multiple choice and short answer', left(old.prompt, 60);
      end if;
      update questions set
        at_s = (q ->> 'at_s')::numeric, kind = q ->> 'kind', prompt = q ->> 'prompt',
        choices = case when q ->> 'kind' = 'mc' then q -> 'choices' end,
        correct_index = case when q ->> 'kind' = 'mc' then (q ->> 'correct_index')::int end,
        position = pos
      where id = qid;
      if old.kind = 'mc' and old.correct_index is distinct from (q ->> 'correct_index')::int then
        rekeyed := rekeyed || qid;
      end if;
    end if;
    pos := pos + 1;
  end loop;

  -- Answer key changed: re-grade auto-graded answers, then re-score finished attempts.
  if array_length(rekeyed, 1) > 0 then
    update answers x set is_correct = (x.response::int = q2.correct_index)
      from questions q2
      where q2.id = x.question_id and x.question_id = any (rekeyed) and x.graded_by = 'auto';
    update attempts t set score = public.compute_score(t.id)
      from assignments a
      where a.id = t.assignment_id and a.lesson_id = lid and t.finished_at is not null;
  end if;

  return lid;
end $$;

-- New functions are executable by PUBLIC by default (and Supabase also grants anon). Lock that down
-- for this function and for every function created later in these migrations.
revoke all on function public.save_lesson(jsonb, jsonb) from public, anon;
grant execute on function public.save_lesson(jsonb, jsonb) to authenticated;
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;

-- Fix for the initial migration: it revoked function privileges *before* creating its RPCs, so these
-- were still executable by PUBLIC/anon. Each one already refuses signed-out callers, but don't rely on that.
revoke all on function
  public.join_class(text), public.get_student_lesson(uuid), public.save_progress(uuid, numeric, numeric),
  public.submit_answer(uuid, uuid, text), public.finish_attempt(uuid), public.grade_answer(uuid, uuid, boolean),
  public.log_focus_event(uuid, text, numeric)
from public, anon;
