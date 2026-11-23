-- Usage analytics for the admin page: active users, visits, time in the app.
--
-- One row per user per school day. The app calls track_usage(true) once per browser tab session (a "visit")
-- and track_usage(false) every 30s while the tab is visible (a heartbeat). Time in app only grows by the real
-- time between heartbeats, so a script hammering the RPC can't inflate it: beats closer than 20s apart are
-- ignored, and a gap over 90s starts a new stretch instead of counting the gap (closed laptop, other tab).
--
-- Students are minors: per-student rows are only ever read in aggregate (admin_usage below). Rows go away
-- with the account (on delete cascade) and nothing older than a school year is needed; prune as you like.

create table public.usage_days (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  visits int not null default 0,
  active_s int not null default 0,
  last_beat_at timestamptz,
  primary key (user_id, day)
);
create index on public.usage_days (day);
alter table public.usage_days enable row level security;  -- no policies: written by track_usage, read by admin_usage
revoke all on public.usage_days from anon, authenticated;

-- The pilot district is in Pennsylvania, so a "day" is a school day in Eastern time.
create function public.school_day(t timestamptz default now()) returns date
language sql stable as $$ select (t at time zone 'America/New_York')::date $$;

create function public.track_usage(p_visit boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare u usage_days; gap numeric;
begin
  -- Only people the pilot is about: teachers, and students enrolled in a class. Anyone else with a Google
  -- account can sign in, but they shouldn't show up as "active students" (or leave a trail here).
  if not exists (select 1 from profiles p where p.id = auth.uid()
                 and (p.role = 'teacher' or exists (select 1 from enrollments e where e.student_id = p.id))) then
    return;
  end if;

  insert into usage_days (user_id, day) values (auth.uid(), public.school_day()) on conflict do nothing;
  select * into u from usage_days where user_id = auth.uid() and day = public.school_day() for update;

  if p_visit then
    update usage_days set visits = least(visits + 1, 200), last_beat_at = now()
      where user_id = u.user_id and day = u.day;
    return;
  end if;

  gap := extract(epoch from now() - u.last_beat_at);
  if gap is not null and gap < 20 then return; end if;  -- too soon: ignore, don't move the clock
  update usage_days set
    active_s = least(active_s + case when gap is not null and gap <= 90 then gap::int else 0 end, 86400),
    last_beat_at = now()
  where user_id = u.user_id and day = u.day;
end $$;

-- Aggregates only. Teachers are staff, so they're listed by email; students are counts and averages.
-- Aggregates only. Teachers are staff, so they're listed by email; students are counts and averages.
-- Admins' own browsing is left out.
create function public.admin_usage() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare today date := public.school_day();
begin
  if not public.is_admin() then raise exception 'admins only' using errcode = 'insufficient_privilege'; end if;
  return (
    with u as (
      select d.user_id, p.role, d.day, d.visits, d.active_s, d.last_beat_at
      from usage_days d join profiles p on p.id = d.user_id
      where not exists (select 1 from admins a where a.email = p.email))
    select jsonb_build_object(
      'active', (
        select jsonb_build_object(
          'today_students', count(distinct user_id) filter (where day = today and role = 'student'),
          'today_teachers', count(distinct user_id) filter (where day = today and role = 'teacher'),
          'week_students', count(distinct user_id) filter (where day > today - 7 and role = 'student'),
          'week_teachers', count(distinct user_id) filter (where day > today - 7 and role = 'teacher'),
          'month_students', count(distinct user_id) filter (where day > today - 30 and role = 'student'),
          'month_teachers', count(distinct user_id) filter (where day > today - 30 and role = 'teacher'),
          'visits_30d', coalesce(sum(visits) filter (where day > today - 30), 0),
          'visits_total', coalesce(sum(visits), 0),
          'active_s_30d', coalesce(sum(active_s) filter (where day > today - 30), 0),
          'active_s_total', coalesce(sum(active_s), 0))
        from u),
      -- Per student: average and median time in the app over the last 7 days, among students active that week.
      'students_week', (
        select jsonb_build_object(
          'avg_active_s', coalesce(round(avg(s)), 0),
          'median_active_s', coalesce(round(percentile_cont(0.5) within group (order by s)), 0))
        from (select sum(active_s) s from u where role = 'student' and day > today - 7 group by user_id) x),
      'video', jsonb_build_object(
        'watched_s_total', (select coalesce(round(sum(max_watched_s)), 0) from attempts),
        'answers_total', (select count(*) from answers)),
      'daily', (
        select jsonb_agg(jsonb_build_object(
          'day', g.day,
          'students', (select count(*) from u where u.day = g.day and role = 'student'),
          'teachers', (select count(*) from u where u.day = g.day and role = 'teacher'),
          'visits', (select coalesce(sum(visits), 0) from u where u.day = g.day),
          'active_s', (select coalesce(sum(active_s), 0) from u where u.day = g.day)) order by g.day)
        from (select (today - i) as day from generate_series(0, 29) i) g),
      'teachers', coalesce((
        select jsonb_agg(t order by t ->> 'email') from (
          select jsonb_build_object(
            'email', p.email,
            'visits', coalesce(sum(u.visits), 0),
            'active_s_7d', coalesce(sum(u.active_s) filter (where u.day > today - 7), 0),
            'active_s_total', coalesce(sum(u.active_s), 0),
            'last_seen', max(u.last_beat_at)) as t
          from profiles p left join u on u.user_id = p.id
          where p.role = 'teacher' group by p.email) x), '[]'::jsonb)));
end $$;

revoke all on function public.school_day(timestamptz), public.track_usage(boolean), public.admin_usage() from public, anon;
grant execute on function public.track_usage(boolean), public.admin_usage() to authenticated;
