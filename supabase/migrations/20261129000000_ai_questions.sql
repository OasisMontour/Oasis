-- AI question generation ("Suggest questions with AI" in the lesson builder).
--
-- Flow: the teacher pastes the video's transcript -> the ai-questions Edge Function checks the input, then calls
-- ai_claim_generation as the teacher (teachers only, kill switches, daily and monthly caps, charged under a
-- lock before anything is sent) -> sends title, subject, grade level and transcript (never student data) to a
-- provider that doesn't train on or keep it -> returns suggestions to the builder. Nothing is written to the
-- lesson: the teacher adds each suggestion by hand and saves through save_lesson like any other question.
--
-- Rules this file enforces:
--   * Quotas fail closed: per-teacher daily and global monthly caps on generation runs, separate from grading's.
--   * Kill switches: ai_settings.enabled = false stops all AI; questions_enabled = false stops only generation.
--   * Provider budgets are shared with grading, but a generation call is charged as many units (it reads a
--     whole transcript), so generating can't quietly spend the budget grading needs.
--   * Only the Edge Function (service role) can refund a run, and only when no provider answered.

alter table public.ai_settings
  add column questions_enabled boolean not null default true,
  add column teacher_daily_generations int not null default 20 check (teacher_daily_generations >= 0),
  add column global_monthly_generations int not null default 2000 check (global_monthly_generations >= 0);

-- Generation runs per teacher per school day. Charged when claimed, refunded if no provider answered.
create table public.ai_generation_usage (
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  runs int not null default 0 check (runs >= 0),
  primary key (teacher_id, day)
);
alter table public.ai_generation_usage enable row level security;
-- No policies: only security-definer functions and the service role touch it.
revoke all on public.ai_generation_usage from anon, authenticated;

-- ---------------------------------------------------------------- claim (runs as the teacher)

-- Returns { ok: true, left_today } or { ok: false, reason: 'disabled' | 'questions_off' | 'teacher_cap' | 'monthly_cap' }.
create function public.ai_claim_generation() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s ai_settings;
  me uuid := auth.uid();
  today date := public.school_day();
  used_today int;
  used_month int;
begin
  if me is null or not public.is_teacher() then raise exception 'teachers only' using errcode = 'insufficient_privilege'; end if;
  -- Same lock as grading claims, so two runs can't both see room under a cap.
  perform pg_advisory_xact_lock(hashtext('oasis_ai_quota'));
  select * into s from ai_settings;
  if s.id is null or not s.enabled then return jsonb_build_object('ok', false, 'reason', 'disabled'); end if;
  if not s.questions_enabled then return jsonb_build_object('ok', false, 'reason', 'questions_off'); end if;

  select coalesce(sum(runs), 0) into used_today from ai_generation_usage where teacher_id = me and day = today;
  select coalesce(sum(runs), 0) into used_month from ai_generation_usage where day >= date_trunc('month', today)::date;
  if used_today >= s.teacher_daily_generations then return jsonb_build_object('ok', false, 'reason', 'teacher_cap'); end if;
  if used_month >= s.global_monthly_generations then return jsonb_build_object('ok', false, 'reason', 'monthly_cap'); end if;

  insert into ai_generation_usage (teacher_id, day, runs) values (me, today, 1)
    on conflict (teacher_id, day) do update set runs = ai_generation_usage.runs + 1;
  return jsonb_build_object('ok', true, 'left_today', s.teacher_daily_generations - used_today - 1);
end $$;

-- ---------------------------------------------------------------- refund (service role only)

-- Gives back one run when every provider failed (errors, timeouts, out of budget). A run where a provider
-- answered keeps its charge even if the reply was unusable, so retrying can't burn provider budget for free.
create function public.ai_refund_generation(p_teacher uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update ai_generation_usage set runs = greatest(runs - 1, 0) where teacher_id = p_teacher and day = public.school_day();
end $$;

-- ---------------------------------------------------------------- provider budget in units

-- Same as 20261127000500 plus p_units: how much of today's budget this call takes (1 for a grade).
drop function public.ai_provider_take(text, int);
create function public.ai_provider_take(p_provider text, p_daily_cap int, p_units int default 1) returns boolean
language plpgsql security definer set search_path = public as $$
declare ok boolean; n int := greatest(coalesce(p_units, 1), 1);
begin
  if exists (select 1 from ai_provider_state where provider = p_provider and cooldown_until > now()) then return false; end if;
  if coalesce(p_daily_cap, 0) < n then return false; end if;
  insert into ai_provider_usage as u (provider, day, calls) values (p_provider, (now() at time zone 'utc')::date, n)
    on conflict (provider, day) do update set calls = u.calls + n where u.calls + n <= p_daily_cap
    returning true into ok;
  return coalesce(ok, false);
end $$;

revoke all on function public.ai_claim_generation() from public, anon;
grant execute on function public.ai_claim_generation() to authenticated;
revoke all on function public.ai_refund_generation(uuid), public.ai_provider_take(text, int, int) from public, anon, authenticated;
grant execute on function public.ai_refund_generation(uuid), public.ai_provider_take(text, int, int) to service_role;

-- ---------------------------------------------------------------- admin: show generation use too

-- Same as 20261127000500 plus the generation settings and counts.
create or replace function public.admin_ai_usage() returns jsonb
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
    'questions_enabled', s.questions_enabled,
    'teacher_daily_generations', s.teacher_daily_generations,
    'global_monthly_generations', s.global_monthly_generations,
    'month_generations', (select coalesce(sum(runs), 0) from ai_generation_usage where day >= date_trunc('month', public.school_day())::date),
    'today_generations', (select coalesce(sum(runs), 0) from ai_generation_usage where day = public.school_day()),
    'providers', coalesce((
      select jsonb_agg(jsonb_build_object('provider', u.provider, 'calls', u.calls, 'failures', u.failures,
                                          'cooldown_until', st.cooldown_until, 'last_error', st.last_error) order by u.provider)
      from ai_provider_usage u left join ai_provider_state st on st.provider = u.provider
      where u.day = (now() at time zone 'utc')::date), '[]'::jsonb));
end $$;
