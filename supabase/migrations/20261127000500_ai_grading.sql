-- AI grading of short answers (the "Suggest grades for short answers with AI" checkbox).
--
-- Flow: the teacher presses "Grade with AI" on the results page -> the ai-grade Edge Function calls
-- ai_claim_answers as the teacher (checks they teach the class, the lesson has AI grading on, and the quota)
-- -> sends question + expected answer + student answer (no names, emails or ids) to a provider that doesn't
-- train on or keep the data -> ai_record_grade (service role only) writes the verdict.
--
-- Rules this file enforces:
--   * Quotas fail closed. A teacher daily cap and a global monthly cap are checked and charged under a lock
--     before anything is sent out. Hit a cap and answers just stay "needs grading".
--   * A teacher grade always wins. AI only writes answers nobody has graded, and grade_answer (teacher)
--     overwrites AI grades as before.
--   * Only the Edge Function (service role) can write an AI verdict, and only for an answer it claimed for
--     that teacher. Teachers can't label their own grades as "AI" and can't skip the quota.
--   * Students never see the expected answer (questions stay teacher-only; get_student_lesson leaves it out).
--   * Provider usage is capped per day below the free tiers, and a provider that says "rate limited" is
--     parked until its retry time, so we never hammer a provider or run past what we planned to use.

-- ---------------------------------------------------------------- columns

-- What the teacher expects. Only for short answers; used by the AI grader and shown back to the teacher.
alter table public.questions add column rubric text not null default '' check (length(rubric) <= 1000);

alter table public.answers
  add column ai_checked_at timestamptz,                                  -- AI looked at it (graded or left for the teacher)
  add column ai_reason text check (length(ai_reason) <= 300),            -- one line for the teacher
  add column ai_model text check (length(ai_model) <= 100);              -- provider/model, for the record

-- ---------------------------------------------------------------- settings, quotas, claims

-- One row. Change it in the SQL editor: `update ai_settings set enabled = false;` is the kill switch.
create table public.ai_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default true,
  teacher_daily_cap int not null default 300 check (teacher_daily_cap >= 0),
  global_monthly_cap int not null default 15000 check (global_monthly_cap >= 0)
);
insert into public.ai_settings default values;

-- Answers sent to AI, per teacher per school day. Charged when claimed, refunded if no AI call was made.
create table public.ai_usage (
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  answers int not null default 0 check (answers >= 0),
  primary key (teacher_id, day)
);

-- Answers an ai-grade run is working on, so two runs never grade (or pay for) the same answer.
create table public.ai_claims (
  attempt_id uuid not null,
  question_id uuid not null,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  claimed_at timestamptz not null default now(),
  primary key (attempt_id, question_id),
  foreign key (attempt_id, question_id) references public.answers(attempt_id, question_id) on delete cascade
);
create index on public.ai_claims (teacher_id);

-- Calls per provider per UTC day (free tiers reset on UTC days), and parked providers.
create table public.ai_provider_usage (
  provider text not null check (provider ~ '^[a-z0-9_-]{1,30}$'),
  day date not null,
  calls int not null default 0,
  failures int not null default 0,
  primary key (provider, day)
);
create table public.ai_provider_state (
  provider text primary key check (provider ~ '^[a-z0-9_-]{1,30}$'),
  cooldown_until timestamptz,
  last_error text check (length(last_error) <= 200)
);

alter table public.ai_settings enable row level security;
alter table public.ai_usage enable row level security;
alter table public.ai_claims enable row level security;
alter table public.ai_provider_usage enable row level security;
alter table public.ai_provider_state enable row level security;
-- No policies: only security-definer functions and the service role touch these.
revoke all on public.ai_settings, public.ai_usage, public.ai_claims, public.ai_provider_usage, public.ai_provider_state
  from anon, authenticated;

-- ---------------------------------------------------------------- claim (runs as the teacher)

-- Claims up to p_limit (max 10) ungraded short answers on the caller's assignment and charges the quota.
-- Returns { ok: true, items: [{attempt_id, question_id, prompt, rubric, response}], remaining }
--      or { ok: false, reason: 'lesson_off' | 'disabled' | 'teacher_cap' | 'monthly_cap' | 'busy', remaining }.
create function public.ai_claim_answers(p_assignment uuid, p_limit int default 8) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a assignments;
  l lessons;
  s ai_settings;
  me uuid := auth.uid();
  today date := public.school_day();
  used_today int;
  used_month int;
  room int;
  items jsonb;
  n int;
  left_over int;
begin
  select * into a from assignments where id = p_assignment;
  if a.id is null or not public.teaches_class(a.class_id) then raise exception 'not your assignment'; end if;
  select * into l from lessons where id = a.lesson_id;

  -- Serialise quota checks across all teachers so two runs can't both see room under the cap.
  perform pg_advisory_xact_lock(hashtext('oasis_ai_quota'));
  delete from ai_claims where claimed_at < now() - interval '3 minutes';  -- a crashed run; its charge is kept (fail closed)

  select count(*) into left_over
    from answers x join attempts t on t.id = x.attempt_id join questions q on q.id = x.question_id
    where t.assignment_id = a.id and q.kind = 'short' and x.is_correct is null and x.graded_by is null
      and x.ai_checked_at is null;

  if not l.ai_grade_short then return jsonb_build_object('ok', false, 'reason', 'lesson_off', 'remaining', left_over); end if;
  select * into s from ai_settings;
  if s.id is null or not s.enabled then return jsonb_build_object('ok', false, 'reason', 'disabled', 'remaining', left_over); end if;
  -- One run at a time per teacher.
  if exists (select 1 from ai_claims where teacher_id = me) then
    return jsonb_build_object('ok', false, 'reason', 'busy', 'remaining', left_over);
  end if;

  select coalesce(sum(answers), 0) into used_today from ai_usage where teacher_id = me and day = today;
  select coalesce(sum(answers), 0) into used_month from ai_usage where day >= date_trunc('month', today)::date;
  if used_today >= s.teacher_daily_cap then
    return jsonb_build_object('ok', false, 'reason', 'teacher_cap', 'remaining', left_over);
  end if;
  if used_month >= s.global_monthly_cap then
    return jsonb_build_object('ok', false, 'reason', 'monthly_cap', 'remaining', left_over);
  end if;
  room := least(greatest(coalesce(p_limit, 8), 1), 10, s.teacher_daily_cap - used_today, s.global_monthly_cap - used_month);

  select coalesce(jsonb_agg(jsonb_build_object(
           'attempt_id', p.attempt_id, 'question_id', p.question_id,
           'prompt', p.prompt, 'rubric', p.rubric, 'response', p.response)), '[]'::jsonb),
         count(*)
    into items, n
    from (
      select x.attempt_id, x.question_id, q.prompt, q.rubric, x.response
      from answers x join attempts t on t.id = x.attempt_id join questions q on q.id = x.question_id
      where t.assignment_id = a.id and q.kind = 'short' and x.is_correct is null and x.graded_by is null
        and x.ai_checked_at is null
      order by x.answered_at, x.attempt_id, x.question_id
      limit room
    ) p;

  if n > 0 then
    insert into ai_claims (attempt_id, question_id, teacher_id)
      select (i ->> 'attempt_id')::uuid, (i ->> 'question_id')::uuid, me from jsonb_array_elements(items) i;
    insert into ai_usage (teacher_id, day, answers) values (me, today, n)
      on conflict (teacher_id, day) do update set answers = ai_usage.answers + excluded.answers;
  end if;

  return jsonb_build_object('ok', true, 'items', items, 'remaining', left_over - n);
end $$;

-- ---------------------------------------------------------------- record (service role only)

-- outcome: 'graded' (p_correct set), 'unsure' (AI looked, left for the teacher), 'skipped' (never sent: looked
-- like an attempt to talk to the grader, too long, blank), 'unavailable' (every provider failed; try again later).
-- 'skipped' and 'unavailable' refund the quota. Returns true if the claim existed.
create function public.ai_record_grade(
  p_teacher uuid, p_attempt uuid, p_question uuid, p_outcome text, p_correct boolean, p_reason text, p_model text
) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_outcome is null or p_outcome not in ('graded', 'unsure', 'skipped', 'unavailable') then raise exception 'bad outcome'; end if;
  if p_outcome = 'graded' and p_correct is null then raise exception 'graded needs a verdict'; end if;

  delete from ai_claims where attempt_id = p_attempt and question_id = p_question and teacher_id = p_teacher;
  if not found then return false; end if;

  if p_outcome in ('skipped', 'unavailable') then
    update ai_usage set answers = greatest(answers - 1, 0) where teacher_id = p_teacher and day = public.school_day();
  end if;
  if p_outcome = 'unavailable' then return true; end if;

  -- is_correct/graded_by null: nobody graded it meanwhile. A teacher grade always wins.
  update answers set
    ai_checked_at = now(),
    ai_reason = nullif(left(coalesce(p_reason, ''), 300), ''),
    ai_model = nullif(left(coalesce(p_model, ''), 100), ''),
    is_correct = case when p_outcome = 'graded' then p_correct end,
    graded_by = case when p_outcome = 'graded' then 'ai' end
  where attempt_id = p_attempt and question_id = p_question and is_correct is null and graded_by is null;

  if found and p_outcome = 'graded' then
    update attempts set score = public.compute_score(p_attempt) where id = p_attempt and finished_at is not null;
  end if;
  return true;
end $$;

-- Take one call from a provider's daily budget. False if it's parked or out of budget for today (UTC).
create function public.ai_provider_take(p_provider text, p_daily_cap int) returns boolean
language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  if exists (select 1 from ai_provider_state where provider = p_provider and cooldown_until > now()) then return false; end if;
  if coalesce(p_daily_cap, 0) <= 0 then return false; end if;
  insert into ai_provider_usage as u (provider, day, calls) values (p_provider, (now() at time zone 'utc')::date, 1)
    on conflict (provider, day) do update set calls = u.calls + 1 where u.calls < p_daily_cap
    returning true into ok;
  return coalesce(ok, false);
end $$;

-- Record a failed call; park the provider for p_cooldown_s seconds (max a day) if > 0.
create function public.ai_provider_fail(p_provider text, p_cooldown_s int, p_error text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update ai_provider_usage set failures = failures + 1
    where provider = p_provider and day = (now() at time zone 'utc')::date;
  if coalesce(p_cooldown_s, 0) > 0 then
    insert into ai_provider_state (provider, cooldown_until, last_error)
      values (p_provider, now() + make_interval(secs => least(p_cooldown_s, 86400)), left(p_error, 200))
      on conflict (provider) do update set cooldown_until = excluded.cooldown_until, last_error = excluded.last_error;
  end if;
end $$;

revoke all on function public.ai_claim_answers(uuid, int) from public, anon;
grant execute on function public.ai_claim_answers(uuid, int) to authenticated;
revoke all on function
  public.ai_record_grade(uuid, uuid, uuid, text, boolean, text, text),
  public.ai_provider_take(text, int),
  public.ai_provider_fail(text, int, text)
from public, anon, authenticated;
grant execute on function
  public.ai_record_grade(uuid, uuid, uuid, text, boolean, text, text),
  public.ai_provider_take(text, int),
  public.ai_provider_fail(text, int, text)
to service_role;

-- Admins: this month's AI use, for the spend check. Counts only.
create function public.admin_ai_usage() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s ai_settings;
begin
  if not public.is_admin() then raise exception 'admins only' using errcode = 'insufficient_privilege'; end if;
  select * into s from ai_settings;
  return jsonb_build_object(
    'enabled', s.enabled,
    'teacher_daily_cap', s.teacher_daily_cap,
    'global_monthly_cap', s.global_monthly_cap,
    'month_answers', (select coalesce(sum(answers), 0) from ai_usage where day >= date_trunc('month', public.school_day())::date),
    'today_answers', (select coalesce(sum(answers), 0) from ai_usage where day = public.school_day()),
    'providers', coalesce((
      select jsonb_agg(jsonb_build_object('provider', u.provider, 'calls', u.calls, 'failures', u.failures,
                                          'cooldown_until', st.cooldown_until, 'last_error', st.last_error) order by u.provider)
      from ai_provider_usage u left join ai_provider_state st on st.provider = u.provider
      where u.day = (now() at time zone 'utc')::date), '[]'::jsonb));
end $$;
revoke all on function public.admin_ai_usage() from public, anon;
grant execute on function public.admin_ai_usage() to authenticated;

-- ---------------------------------------------------------------- save_lesson: store the expected answer

-- Same as 20261115000000 plus `rubric` (short answers only). Changing it lets AI look again at answers it
-- left for the teacher.
create or replace function public.save_lesson(p_lesson jsonb, p_questions jsonb) returns uuid
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
  rub text;
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
    rub := case when q ->> 'kind' = 'short' then btrim(coalesce(q ->> 'rubric', '')) else '' end;
    if length(rub) > 1000 then raise exception 'expected answers can be at most 1000 characters'; end if;
    if qid is null then
      insert into questions (lesson_id, at_s, kind, prompt, choices, correct_index, position, rubric)
      values (lid, (q ->> 'at_s')::numeric, q ->> 'kind', q ->> 'prompt',
              case when q ->> 'kind' = 'mc' then q -> 'choices' end,
              case when q ->> 'kind' = 'mc' then (q ->> 'correct_index')::int end, pos, rub);
    else
      select * into old from questions where id = qid;
      if old.kind <> q ->> 'kind' and exists (select 1 from answers where question_id = qid) then
        raise exception 'students already answered "%", so it cannot switch between multiple choice and short answer', left(old.prompt, 60);
      end if;
      update questions set
        at_s = (q ->> 'at_s')::numeric, kind = q ->> 'kind', prompt = q ->> 'prompt',
        choices = case when q ->> 'kind' = 'mc' then q -> 'choices' end,
        correct_index = case when q ->> 'kind' = 'mc' then (q ->> 'correct_index')::int end,
        position = pos,
        rubric = rub
      where id = qid;
      if old.kind = 'mc' and old.correct_index is distinct from (q ->> 'correct_index')::int then
        rekeyed := rekeyed || qid;
      end if;
      if old.rubric is distinct from rub or old.prompt is distinct from q ->> 'prompt' then
        update answers set ai_checked_at = null, ai_reason = null, ai_model = null
          where question_id = qid and is_correct is null and graded_by is null;
      end if;
    end if;
    pos := pos + 1;
  end loop;

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

-- ---------------------------------------------------------------- assignment_results: show AI grades

-- Same as 20261119000000 plus: assignment.ai_grade_short, questions[].rubric, answers{}.ai_checked/ai_reason.
create or replace function public.assignment_results(p_assignment uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare a assignments; l lessons; cl classes; result jsonb;
begin
  select * into a from assignments where id = p_assignment;
  if a.id is null or not public.teaches_class(a.class_id) then raise exception 'not your assignment'; end if;
  select * into l from lessons where id = a.lesson_id;
  select * into cl from classes where id = a.class_id;

  with people as (
    select email, max(student_id::text)::uuid as student_id, max(name) as name from (
      select r.email, null::uuid as student_id, r.name from roster_entries r where r.class_id = a.class_id
      union all
      select p.email, p.id, p.name from enrollments e join profiles p on p.id = e.student_id
        where e.class_id = a.class_id
      union all
      select p.email, p.id, p.name from attempts t join profiles p on p.id = t.student_id
        where t.assignment_id = a.id
    ) u group by email
  ),
  rows as (
    select
      pe.email,
      pe.student_id,
      coalesce(nullif(pr.name, ''), nullif(ro.name, ''), '') as name,
      t.id as attempt_id, t.max_watched_s, t.finished_at, t.score,
      (ro.email is not null) as on_roster
    from people pe
    left join profiles pr on pr.id = pe.student_id
    left join roster_entries ro on ro.class_id = a.class_id and ro.email = pe.email
    left join attempts t on t.assignment_id = a.id and t.student_id = pe.student_id
  )
  select jsonb_build_object(
    'assignment', jsonb_build_object(
      'id', a.id, 'due_at', a.due_at, 'lesson_id', l.id, 'lesson_title', l.title,
      'class_id', cl.id, 'class_name', cl.name, 'duration_s', l.duration_s,
      'google_coursework_id', a.google_coursework_id, 'ai_grade_short', l.ai_grade_short),
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', q.id, 'at_s', q.at_s, 'kind', q.kind, 'prompt', q.prompt,
        'choices', q.choices, 'correct_index', q.correct_index, 'rubric', q.rubric) order by q.at_s, q.position)
      from questions q where q.lesson_id = l.id), '[]'::jsonb),
    'students', coalesce((
      select jsonb_agg(jsonb_build_object(
        'student_id', x.student_id,
        'attempt_id', x.attempt_id,
        'email', x.email,
        'name', x.name,
        'status', case
          when x.student_id is null then 'not_signed_in'
          when x.attempt_id is null then 'not_started'
          when x.finished_at is not null then 'finished'
          else 'in_progress' end,
        'progress_pct', case when x.attempt_id is null then 0
          else least(100, greatest(0, round(100 * x.max_watched_s / l.duration_s)))::int end,
        'score', x.score,
        'finished_at', x.finished_at,
        'late', case
          when x.finished_at is not null then coalesce(x.finished_at > a.due_at, false)
          else coalesce(now() > a.due_at, false) end,
        'on_roster', x.on_roster,
        'focus_events', coalesce((select count(*) from focus_events f where f.attempt_id = x.attempt_id
          and f.kind in ('exit_fullscreen', 'tab_hidden', 'blur')), 0)::int,
        'answers', coalesce((
          select jsonb_object_agg(an.question_id::text, jsonb_build_object(
            'response', an.response, 'is_correct', an.is_correct, 'graded_by', an.graded_by,
            'ai_checked', an.ai_checked_at is not null, 'ai_reason', an.ai_reason))
          from answers an where an.attempt_id = x.attempt_id), '{}'::jsonb)
      ) order by x.name, x.email)
      from rows x), '[]'::jsonb)
  ) into result;
  return result;
end $$;
