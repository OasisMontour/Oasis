-- Teacher results view: one call returns everything the results page needs for an assignment.
-- Students = Classroom roster + enrolled profiles + anyone with an attempt (so students who left
-- the course still show, flagged on_roster = false). Roster entries nobody has signed in for
-- show as 'not_signed_in'.
create function public.assignment_results(p_assignment uuid) returns jsonb
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
      'google_coursework_id', a.google_coursework_id),
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', q.id, 'at_s', q.at_s, 'kind', q.kind, 'prompt', q.prompt,
        'choices', q.choices, 'correct_index', q.correct_index) order by q.at_s, q.position)
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
            'response', an.response, 'is_correct', an.is_correct, 'graded_by', an.graded_by))
          from answers an where an.attempt_id = x.attempt_id), '{}'::jsonb)
      ) order by x.name, x.email)
      from rows x), '[]'::jsonb)
  ) into result;
  return result;
end $$;
revoke all on function public.assignment_results(uuid) from public, anon;
grant execute on function public.assignment_results(uuid) to authenticated;
