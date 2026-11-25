-- submit_answer guards (live bug test, Nov 25). The player never sends these, but the RPC is callable
-- directly from a student's browser console, and an answer is final:
--   * an empty/whitespace short answer was stored, so the question was "answered" with nothing;
--   * an MC index past the last choice ('7' on a 3-choice question) was stored as a wrong answer;
--   * a huge index ('99999999999') surfaced a raw "integer out of range" error.
create or replace function public.submit_answer(p_attempt uuid, p_question uuid, p_response text) returns void
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
  if p_response is null or btrim(p_response) = '' then raise exception 'answer is empty'; end if;

  if q.kind = 'mc' then
    -- At most 6 choices, so one digit; checked as text before any cast.
    if p_response !~ '^[0-9]$' or p_response::int >= jsonb_array_length(q.choices) then
      raise exception 'mc response must be a choice index';
    end if;
    correct := (p_response::int = q.correct_index);
  end if;

  insert into answers (attempt_id, question_id, response, is_correct, graded_by)
  values (t.id, q.id, case when q.kind = 'mc' then p_response else btrim(p_response) end, correct, case when q.kind = 'mc' then 'auto' end)
  on conflict (attempt_id, question_id) do nothing;
  if not found then raise exception 'already answered'; end if;
end $$;
revoke all on function public.submit_answer(uuid, uuid, text) from public, anon;
grant execute on function public.submit_answer(uuid, uuid, text) to authenticated;
