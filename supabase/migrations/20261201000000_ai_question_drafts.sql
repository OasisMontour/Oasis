-- AI question drafts (beta item 6): "Draft questions with AI" in the lesson builder.
--
-- The teacher pastes material they're allowed to send to an AI service (a transcript, notes, a reading), and the
-- ai-draft Edge Function asks a free, no-training provider for editable questions, answer keys and pause points.
-- Nothing is saved: drafts land in the builder and go through save_lesson like any typed question.
--
-- Rules this file enforces:
--   * Separate from AI grading: its own on/off switch and its own caps, so drafts can't eat the grading quota
--     (or the other way round). The existing ai_settings.enabled kill switch still stops both.
--   * Caps fail closed and are charged under a lock before anything goes out. A failed run is refunded.
--   * Only the Edge Function (service role) can refund.

alter table public.ai_settings
  add column gen_enabled boolean not null default true,
  add column gen_teacher_daily_cap int not null default 15 check (gen_teacher_daily_cap >= 0),
  add column gen_global_monthly_cap int not null default 1500 check (gen_global_monthly_cap >= 0);

-- Draft runs per teacher per school day.
create table public.ai_gen_usage (
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  runs int not null default 0 check (runs >= 0),
  primary key (teacher_id, day)
);
alter table public.ai_gen_usage enable row level security;  -- no policies: functions only
revoke all on public.ai_gen_usage from anon, authenticated;

-- Runs as the teacher. Charges one run, or says why not.
-- { ok: true, left_today } | { ok: false, reason: 'disabled' | 'teacher_cap' | 'monthly_cap' }
create function public.ai_gen_claim() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  s ai_settings;
  today date := public.school_day();
  used_today int;
  used_month int;
begin
  if not public.is_teacher() then raise exception 'teachers only'; end if;
  perform pg_advisory_xact_lock(hashtext('oasis_ai_gen_quota'));
  select * into s from ai_settings;
  if s.id is null or not s.enabled or not s.gen_enabled then return jsonb_build_object('ok', false, 'reason', 'disabled'); end if;
  select coalesce(sum(runs), 0) into used_today from ai_gen_usage where teacher_id = me and day = today;
  select coalesce(sum(runs), 0) into used_month from ai_gen_usage where day >= date_trunc('month', today)::date;
  if used_today >= s.gen_teacher_daily_cap then return jsonb_build_object('ok', false, 'reason', 'teacher_cap'); end if;
  if used_month >= s.gen_global_monthly_cap then return jsonb_build_object('ok', false, 'reason', 'monthly_cap'); end if;
  insert into ai_gen_usage (teacher_id, day, runs) values (me, today, 1)
    on conflict (teacher_id, day) do update set runs = ai_gen_usage.runs + 1;
  return jsonb_build_object('ok', true, 'left_today', s.gen_teacher_daily_cap - used_today - 1);
end $$;

-- Service role: give back a run that produced nothing (every provider failed or returned junk).
create function public.ai_gen_refund(p_teacher uuid) returns void
language sql security definer set search_path = public as $$
  update ai_gen_usage set runs = greatest(runs - 1, 0) where teacher_id = p_teacher and day = public.school_day();
$$;

revoke all on function public.ai_gen_claim() from public, anon;
grant execute on function public.ai_gen_claim() to authenticated;
revoke all on function public.ai_gen_refund(uuid) from public, anon, authenticated;
grant execute on function public.ai_gen_refund(uuid) to service_role;
