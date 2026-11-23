-- Bug reports: any signed-in user reports a bug, it's auto-ranked low / medium / high by simple rules,
-- admins triage it on /admin, and fixes are published on /changelog.
--
-- Rules this file enforces:
--   * Signed-in users only (no anonymous spam), rate limited per user, text only, length-capped.
--   * Reports are never readable through the tables. Reporters see their own via my_bug_reports();
--     admins see all via admin_bug_reports(). Students are minors, so admins see "student", not who.
--   * The changelog shows only the admin-written fix note, never a report's original text (which might
--     contain a kid's name or something private).

create table public.bug_reports (
  id bigint generated always as identity primary key,
  reporter uuid references public.profiles(id) on delete set null,
  reporter_role text not null check (reporter_role in ('teacher', 'student')),
  page text not null default '' check (length(page) <= 200),
  description text not null check (length(description) between 5 and 2000),
  user_agent text not null default '' check (length(user_agent) <= 300),
  severity text not null check (severity in ('low', 'medium', 'high')),
  severity_auto text not null check (severity_auto in ('low', 'medium', 'high')),
  severity_reason text not null default '',
  status text not null default 'open' check (status in ('open', 'fixing', 'fixed', 'wont_fix')),
  fix_note text not null default '' check (length(fix_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  fixed_at timestamptz
);
create index on public.bug_reports (reporter, created_at);
create index on public.bug_reports (status, fixed_at);
alter table public.bug_reports enable row level security;  -- no policies: RPCs only
revoke all on public.bug_reports from anon, authenticated;
revoke all on sequence public.bug_reports_id_seq from anon, authenticated;

-- Rule-based ranking. Free, instant, explainable; admins can override.
create function public.rank_bug(p_description text, p_page text, p_role text, out severity text, out reason text)
language plpgsql immutable as $$
declare d text := lower(coalesce(p_description, ''));
begin
  if d ~ '(privacy|private|someone else|somebody else|other (student|kid|person|teacher)|another (student|kid|person)|see (their|other)|hack|password|cheat|skip(ped)? (the )?(video|ahead|question))' then
    severity := 'high'; reason := 'possible privacy, security or cheating issue';
  elsif d ~ '(lost|lose|losing|deleted|disappear|gone|wiped|start(ed)? over|reset|progress|grade|score|marked (me )?wrong|wrong answer|can.?t (sign|log)|cannot (sign|log)|won.?t (load|open|start|submit)|can.?t (submit|finish|open|start)|cannot (submit|finish|open|start)|crash|blank (page|screen)|white screen|stuck|frozen|freez|error)' then
    severity := 'high'; reason := 'blocks work or loses data';
  elsif d ~ '(slow|lag|broken|doesn.?t work|does not work|not working|won.?t|can.?t|cannot|bug|glitch|video|fullscreen|full screen|question|classroom|button|link)' then
    severity := 'medium'; reason := 'something doesn''t work right';
  else
    severity := 'low'; reason := 'looks or wording';
  end if;
  -- Anything on the student player during a lesson matters more: a class is waiting on it.
  if severity = 'low' and coalesce(p_page, '') like '/student/assignments/%' then
    severity := 'medium'; reason := reason || '; reported from the lesson player';
  end if;
  if severity = 'low' and p_role = 'teacher' then
    severity := 'medium'; reason := reason || '; reported by a teacher';
  end if;
end $$;

create function public.submit_bug_report(p_description text, p_page text default '', p_user_agent text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare p profiles; r record; d text := trim(coalesce(p_description, '')); new_id bigint;
begin
  select * into p from profiles where id = auth.uid();
  if p.id is null then raise exception 'sign in to report a bug'; end if;
  if length(d) < 5 then raise exception 'tell us a bit more about what happened'; end if;
  if length(d) > 2000 then raise exception 'please keep it under 2000 characters'; end if;
  -- One report at a time per user, so parallel requests can't slip past the rate limit.
  perform pg_advisory_xact_lock(hashtextextended('bug_report:' || p.id::text, 0));
  if (select count(*) from bug_reports where reporter = p.id and created_at > now() - interval '1 hour') >= 5
     or (select count(*) from bug_reports where reporter = p.id and created_at > now() - interval '1 day') >= 20 then
    raise exception 'you''ve sent a lot of reports recently. Try again later';
  end if;
  -- Backstop against a pile of throwaway Google accounts: the whole pilot won't file 500 real bugs a day.
  if (select count(*) from bug_reports where created_at > now() - interval '1 day') >= 500 then
    raise exception 'bug reports are paused for today. Tell your teacher instead';
  end if;
  select * into r from public.rank_bug(d, p_page, p.role);
  insert into bug_reports (reporter, reporter_role, page, description, user_agent, severity, severity_auto, severity_reason)
  values (p.id, p.role, left(coalesce(p_page, ''), 200), d, left(coalesce(p_user_agent, ''), 300), r.severity, r.severity, r.reason)
  returning id into new_id;
  return jsonb_build_object('id', new_id, 'severity', r.severity);
end $$;

-- A reporter's own reports, so they can see what happened to them.
create function public.my_bug_reports() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'created_at', created_at, 'description', description, 'status', status, 'fix_note', fix_note, 'fixed_at', fixed_at)
    order by created_at desc), '[]'::jsonb)
  from (select * from bug_reports where reporter = auth.uid() order by created_at desc limit 50) b;
$$;

-- Public changelog: only fixed reports with a fix note, only the note.
create function public.changelog() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('fixed_at', fixed_at, 'note', fix_note, 'severity', severity)
    order by fixed_at desc), '[]'::jsonb)
  from (select * from bug_reports where status = 'fixed' and fix_note <> '' and auth.uid() is not null
        order by fixed_at desc limit 100) b;
$$;

create function public.admin_bug_reports() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only' using errcode = 'insufficient_privilege'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', b.id, 'created_at', b.created_at, 'page', b.page, 'description', b.description, 'user_agent', b.user_agent,
      'reporter_role', b.reporter_role,
      -- teachers are staff and can be followed up with; students stay anonymous here
      'reporter', case when b.reporter_role = 'teacher' then p.email end,
      'severity', b.severity, 'severity_auto', b.severity_auto, 'severity_reason', b.severity_reason,
      'status', b.status, 'fix_note', b.fix_note, 'fixed_at', b.fixed_at)
      order by (b.status in ('fixed', 'wont_fix')), array_position(array['high', 'medium', 'low'], b.severity), b.created_at desc)
    from (select * from bug_reports order by created_at desc limit 500) b
    left join profiles p on p.id = b.reporter), '[]'::jsonb);
end $$;

create function public.admin_update_bug(p_id bigint, p_severity text, p_status text, p_fix_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only' using errcode = 'insufficient_privilege'; end if;
  if p_status = 'fixed' and length(trim(coalesce(p_fix_note, ''))) = 0 then
    raise exception 'write a short fix note before marking it fixed (it goes on the changelog)';
  end if;
  update bug_reports set
    severity = p_severity,
    status = p_status,
    fix_note = left(trim(coalesce(p_fix_note, '')), 500),
    fixed_at = case when p_status = 'fixed' then coalesce(fixed_at, now()) else null end,
    updated_at = now()
  where id = p_id;
  if not found then raise exception 'no such report'; end if;
end $$;

revoke all on function public.rank_bug(text, text, text), public.submit_bug_report(text, text, text), public.my_bug_reports(),
  public.changelog(), public.admin_bug_reports(), public.admin_update_bug(bigint, text, text, text) from public, anon;
revoke all on function public.rank_bug(text, text, text) from authenticated;
grant execute on function public.submit_bug_report(text, text, text), public.my_bug_reports(), public.changelog(),
  public.admin_bug_reports(), public.admin_update_bug(bigint, text, text, text) to authenticated;
