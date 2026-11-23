-- Bug pass Nov 23: two ways an honest student gets stuck in save_progress.
--
-- 1. A teacher edits an assigned lesson and adds (or moves) a question to a time *behind* where a student
--    already is. The gate becomes that question, `allowed` drops below the student's max_watched_s, and every
--    save is rejected, even one that doesn't move forward. The player's "seek back to max_watched_s" recovery
--    can't help because max_watched_s itself is rejected. Same thing if a re-save of the lesson lowers
--    duration_s below a student's progress. Fix: a save that doesn't move forward is always accepted. Moving
--    forward still needs the new question answered (submit_answer already allows it: it's behind them).
--
-- 2. Teachers' duration_s is floor(getDuration()), but at the very end the student's player reports the real
--    length (e.g. 600.4 for a 600 lesson). That final save was rejected as a jump, so max_watched_s stayed at
--    the previous save (up to 15s earlier) and finish_attempt said "video not finished". Fix: clamp to duration_s.

create or replace function public.save_progress(p_attempt uuid, p_max_watched numeric, p_last_pos numeric) returns void
language plpgsql security definer set search_path = public as $$
declare t attempts; l lessons; gate numeric; credit numeric; allowed numeric; gained numeric;
begin
  select * into t from attempts where id = p_attempt and student_id = auth.uid() for update;
  if t.id is null then raise exception 'not your attempt'; end if;
  if t.finished_at is not null then return; end if;
  if p_max_watched is null or p_last_pos is null or p_max_watched = 'NaN' or p_last_pos = 'NaN' then
    raise exception 'bad progress value';
  end if;
  select l2.* into l from lessons l2 join assignments a on a.lesson_id = l2.id where a.id = t.assignment_id;

  -- (2) the end of the video as the student's player sees it can be a fraction past the stored length
  p_max_watched := least(p_max_watched, l.duration_s);

  credit := least(30, t.watch_credit_s + greatest(0, extract(epoch from (now() - t.credit_at))));
  allowed := t.max_watched_s + credit;
  select min(q.at_s) into gate from questions q
    where q.lesson_id = l.id
      and not exists (select 1 from answers x where x.attempt_id = t.id and x.question_id = q.id);
  if gate is not null then allowed := least(allowed, gate + 1); end if;
  allowed := least(allowed, l.duration_s);
  -- (1) never reject a save that doesn't move forward
  allowed := greatest(allowed, t.max_watched_s);

  if p_max_watched > allowed then raise exception 'progress jump rejected'; end if;

  gained := greatest(0, p_max_watched - t.max_watched_s);
  update attempts set
    max_watched_s = greatest(max_watched_s, p_max_watched),
    last_pos_s = least(greatest(p_last_pos, 0), greatest(max_watched_s, p_max_watched)),
    watch_credit_s = credit - gained,
    credit_at = now(),
    updated_at = now()
  where id = t.id;
end $$;
