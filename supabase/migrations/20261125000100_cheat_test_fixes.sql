-- Cheat test Nov 23, server side. PoCs: project files oasis/reviews/cheat-test-2026-11-23/.

-- ------------------------------------------------------------------ 1. parallel saves minted credit (HIGH)
-- now() is the transaction START time, taken before save_progress waits on the attempt's row lock. A
-- request that started earlier but got the lock later wrote an older credit_at, so the next save was
-- credited for the same seconds again. Flooding no-op saves in parallel with small forward saves got a
-- student ~140s of progress in ~19s. Fix: measure with clock_timestamp() after the lock, and never let
-- credit_at go backwards.
--
-- Also: inputs are rounded to milliseconds (a 16,383-decimal value was stored and sent back on every
-- load), +-Infinity is rejected, and a new attempt starts with an empty bucket instead of a full 30s, so
-- a script can't bank 30s before the video has even started.

alter table public.attempts alter column watch_credit_s set default 0;

create or replace function public.save_progress(p_attempt uuid, p_max_watched numeric, p_last_pos numeric) returns void
language plpgsql security definer set search_path = public as $$
declare t attempts; l lessons; gate numeric; credit numeric; allowed numeric; gained numeric; ts timestamptz;
begin
  select * into t from attempts where id = p_attempt and student_id = auth.uid() for update;
  if t.id is null then raise exception 'not your attempt'; end if;
  if t.finished_at is not null then return; end if;
  if p_max_watched is null or p_last_pos is null or p_max_watched = 'NaN' or p_last_pos = 'NaN'
     or p_max_watched in ('Infinity', '-Infinity') or p_last_pos in ('Infinity', '-Infinity') then
    raise exception 'bad progress value';
  end if;
  p_max_watched := round(p_max_watched, 3);
  p_last_pos := round(p_last_pos, 3);
  select l2.* into l from lessons l2 join assignments a on a.lesson_id = l2.id where a.id = t.assignment_id;

  -- the end of the video as the student's player sees it can be a fraction past the stored length
  p_max_watched := least(p_max_watched, l.duration_s);

  ts := greatest(clock_timestamp(), t.credit_at);  -- after the lock; never backwards
  credit := least(30, t.watch_credit_s + extract(epoch from (ts - t.credit_at)));
  allowed := t.max_watched_s + credit;
  select min(q.at_s) into gate from questions q
    where q.lesson_id = l.id
      and not exists (select 1 from answers x where x.attempt_id = t.id and x.question_id = q.id);
  if gate is not null then allowed := least(allowed, gate + 1); end if;
  allowed := least(allowed, l.duration_s);
  -- never reject a save that doesn't move forward
  allowed := greatest(allowed, t.max_watched_s);

  if p_max_watched > allowed then raise exception 'progress jump rejected'; end if;

  gained := greatest(0, p_max_watched - t.max_watched_s);
  update attempts set
    max_watched_s = greatest(max_watched_s, p_max_watched),
    last_pos_s = least(greatest(p_last_pos, 0), greatest(max_watched_s, p_max_watched)),
    watch_credit_s = credit - gained,
    credit_at = ts,
    updated_at = now()
  where id = t.id;
end $$;

-- ------------------------------------------------------------------ 2. hiding real exits behind the log cap (LOW-MEDIUM)
-- The 500-event cap was shared by every kind, so 500 scripted no_fullscreen_support events made every real
-- "left the video" event after them silently drop. no_fullscreen_support is now once per attempt and
-- doesn't count toward the cap; flooding the cap with real kinds just shows the teacher 500 exits.
-- Also: positions must be finite and are clamped to the video, and finished attempts log nothing.
create or replace function public.log_focus_event(p_attempt uuid, p_kind text, p_video_s numeric) returns void
language plpgsql security definer set search_path = public as $$
declare t attempts; dur numeric;
begin
  select * into t from attempts where id = p_attempt and student_id = auth.uid();
  if t.id is null then raise exception 'not your attempt'; end if;
  if t.finished_at is not null then return; end if;
  if p_video_s is null or p_video_s = 'NaN' or p_video_s in ('Infinity', '-Infinity') then
    raise exception 'bad position';
  end if;
  select l.duration_s into dur from lessons l join assignments a on a.lesson_id = l.id where a.id = t.assignment_id;
  p_video_s := round(least(greatest(p_video_s, 0), dur), 1);
  if p_kind = 'no_fullscreen_support' then
    if exists (select 1 from focus_events where attempt_id = p_attempt and kind = p_kind) then return; end if;
  elsif (select count(*) from focus_events where attempt_id = p_attempt and kind <> 'no_fullscreen_support') >= 500 then
    return;
  end if;
  insert into focus_events (attempt_id, kind, video_s) values (p_attempt, p_kind, p_video_s);
end $$;

-- ------------------------------------------------------------------ 3. shrinking a started lesson (INFO, teacher side)
-- save_lesson locks the video once students start but not duration_s, so re-saving with a shorter length
-- (e.g. a bad getDuration read) let students finish a 10-minute video at 2 minutes. Lengthening is fine.
create function public.lessons_keep_duration() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.duration_s < old.duration_s
     and exists (select 1 from attempts t join assignments a on a.id = t.assignment_id where a.lesson_id = old.id) then
    raise exception 'students have started this lesson, so the video length can''t get shorter. Make a new lesson instead.';
  end if;
  return new;
end $$;
revoke all on function public.lessons_keep_duration() from public, anon, authenticated;
create trigger lessons_keep_duration before update of duration_s on public.lessons
  for each row execute function public.lessons_keep_duration();
