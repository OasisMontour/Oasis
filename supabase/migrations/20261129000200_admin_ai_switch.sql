-- AI grading kill switch on the admin page (live bug test, Nov 25). It was SQL-editor only, which is slow
-- to reach in a pilot emergency (bad grades, runaway quota). Every flip is in the admin audit log.
alter table public.admin_audit drop constraint admin_audit_action_check;
alter table public.admin_audit add constraint admin_audit_action_check check (action in (
  'add_teacher', 'remove_teacher', 'approve_teacher', 'deny_teacher', 'unblock_teacher', 'add_domain', 'remove_domain',
  'ai_on', 'ai_off'));

create function public.admin_set_ai_enabled(p_enabled boolean) returns boolean
language plpgsql security definer set search_path = public as $$
declare me text := public.admin_email();
begin
  if me is null then raise exception 'admins only' using errcode = 'insufficient_privilege'; end if;
  if p_enabled is null then raise exception 'enabled must be true or false'; end if;
  update ai_settings set enabled = p_enabled where id;  -- one row; Supabase rejects UPDATE without WHERE (safeupdate)
  insert into admin_audit (actor_email, action, target) values (me, case when p_enabled then 'ai_on' else 'ai_off' end, 'AI grading');
  return p_enabled;
end $$;
revoke all on function public.admin_set_ai_enabled(boolean) from public, anon;
grant execute on function public.admin_set_ai_enabled(boolean) to authenticated;
