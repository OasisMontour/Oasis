-- Beta lesson model (items 5, 7, 8, 11). Schema only; each item's UI is its own commit.
--
--   5. lessons.class_id: the builder's "Class" dropdown (replaces free-text Subject). Only a class the teacher
--      teaches. Carried into assignment. `subject` stays for the planned shared library.
--   7. Multi-select questions: kind 'multi', key in correct_indexes. Students pick a set of choices, sent as
--      "0,2". Scoring is exact match: right only if the set is exactly the key. Changing the key re-grades.
--   8. Timestamped notes: lesson_notes. The player pauses to show them; they're never graded and never gate
--      progress (they aren't questions, so compute_score / finish_attempt / save_progress don't see them).
--  11. Answer feedback: submit_answer returns { result: 'correct' | 'incorrect' | 'submitted' } for the answer
--      the student just locked in. Short answers are always 'submitted' (graded later).
--      Trade-off, on purpose (Wyatt asked for it): this reopens the "answer oracle" the Nov 23 cheat test
--      closed. Answers are still final and the key itself is never sent, but classmates can compare results and
--      work out a key. lessons.show_feedback (default on) lets a teacher turn it off for a lesson that's a quiz.
--      Scores stay hidden from students as before.

-- ---------------------------------------------------------------- 5 + 11: lesson columns

alter table public.lessons
  add column class_id uuid references public.classes(id) on delete set null,
  add column show_feedback boolean not null default true;

-- ---------------------------------------------------------------- 7: multi-select

create function public.valid_choice_set(idx int[], n int) returns boolean
language sql immutable as $$
  select idx is not null and cardinality(idx) between 1 and n
    and not exists (select 1 from unnest(idx) i where i is null or i < 0 or i >= n)
    and cardinality(idx) = (select count(distinct i) from unnest(idx) i);
$$;

alter table public.questions add column correct_indexes int[];
alter table public.questions drop constraint questions_kind_check;
alter table public.questions add constraint questions_kind_check check (kind in ('mc', 'short', 'multi'));
alter table public.questions drop constraint questions_check;
alter table public.questions add constraint questions_check check (
  (kind = 'mc' and jsonb_typeof(choices) = 'array' and jsonb_array_length(choices) between 2 and 6
    and correct_index between 0 and jsonb_array_length(choices) - 1 and correct_indexes is null)
  or (kind = 'multi' and jsonb_typeof(choices) = 'array' and jsonb_array_length(choices) between 2 and 6
    and correct_index is null and public.valid_choice_set(correct_indexes, jsonb_array_length(choices)))
  or (kind = 'short' and choices is null and correct_index is null and correct_indexes is null));

/** "2,0,2" -> '{0,2}'. Null if it isn't a list of single digits. */
create function public.parse_choice_set(r text) returns int[]
language sql immutable as $$
  select case when r ~ '^\s*[0-9](\s*,\s*[0-9])*\s*$'
    then (select array_agg(distinct x::int order by x::int) from unnest(string_to_array(regexp_replace(r, '\s', '', 'g'), ',')) x)
  end;
$$;

-- ---------------------------------------------------------------- 8: notes

create table public.lesson_notes (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  at_s numeric not null check (at_s >= 0 and at_s < 86400),
  body text not null check (length(body) between 1 and 1000),
  position int not null default 0
);
create index on public.lesson_notes (lesson_id, at_s);
alter table public.lesson_notes enable row level security;
-- Teachers read their own (and shared lessons', for copying); writes only through save_lesson. Students get
-- notes through get_student_lesson.
grant select on public.lesson_notes to authenticated;
create policy lesson_notes_owner on public.lesson_notes for select using (public.owns_lesson(lesson_id));
create policy lesson_notes_library on public.lesson_notes for select using (
  public.is_teacher() and exists (select 1 from lessons l where l.id = lesson_notes.lesson_id and l.shared));

-- ---------------------------------------------------------------- save_lesson

-- Same as 20261127000500 plus: class_id (must be one of the caller's classes), show_feedback, multi questions
-- (correct_indexes, re-graded when the key changes), notes (p_lesson.notes, replaces them when sent), and `shared`
-- is kept as it was when the builder doesn't send it.
create or replace function public.save_lesson(p_lesson jsonb, p_questions jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  lid uuid := nullif(p_lesson ->> 'id', '')::uuid;
  dur numeric := (p_lesson ->> 'duration_s')::numeric;
  cls uuid := nullif(p_lesson ->> 'class_id', '')::uuid;
  q jsonb;
  qid uuid;
  old questions;
  keep uuid[] := '{}';
  pos int := 0;
  rekeyed uuid[] := '{}';
  rub text;
  keyset int[];
  notes jsonb := coalesce(p_lesson -> 'notes', '[]'::jsonb);
begin
  if not public.is_teacher() then raise exception 'teachers only'; end if;
  if jsonb_typeof(p_questions) is distinct from 'array' then raise exception 'questions must be an array'; end if;
  if jsonb_array_length(p_questions) > 200 then raise exception 'too many questions (max 200)'; end if;
  if jsonb_typeof(notes) is distinct from 'array' then raise exception 'notes must be an array'; end if;
  if jsonb_array_length(notes) > 100 then raise exception 'too many notes (max 100)'; end if;
  if cls is not null and not public.teaches_class(cls) then raise exception 'that class is not one of yours'; end if;

  if lid is null then
    insert into lessons (teacher_id, title, subject, youtube_id, duration_s, require_fullscreen, ai_grade_short, shared, source,
                         class_id, show_feedback)
    values (auth.uid(), p_lesson ->> 'title', coalesce(p_lesson ->> 'subject', ''), p_lesson ->> 'youtube_id', dur,
            coalesce((p_lesson ->> 'require_fullscreen')::boolean, true),
            coalesce((p_lesson ->> 'ai_grade_short')::boolean, false),
            coalesce((p_lesson ->> 'shared')::boolean, false),
            coalesce(p_lesson ->> 'source', 'manual'),
            cls,
            coalesce((p_lesson ->> 'show_feedback')::boolean, true))
    returning id into lid;
  else
    if not public.owns_lesson(lid) then raise exception 'not your lesson'; end if;
    if exists (select 1 from attempts t join assignments a on a.id = t.assignment_id where a.lesson_id = lid)
       and exists (select 1 from lessons where id = lid and youtube_id is distinct from p_lesson ->> 'youtube_id') then
      raise exception 'students have started this lesson, so the video cannot be changed. Make a new lesson instead.';
    end if;
    update lessons set
      title = p_lesson ->> 'title',
      subject = coalesce(p_lesson ->> 'subject', subject),
      youtube_id = p_lesson ->> 'youtube_id',
      duration_s = dur,
      require_fullscreen = coalesce((p_lesson ->> 'require_fullscreen')::boolean, true),
      ai_grade_short = coalesce((p_lesson ->> 'ai_grade_short')::boolean, false),
      shared = coalesce((p_lesson ->> 'shared')::boolean, shared),
      class_id = case when p_lesson ? 'class_id' then cls else class_id end,
      show_feedback = coalesce((p_lesson ->> 'show_feedback')::boolean, show_feedback)
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
    keyset := case when q ->> 'kind' = 'multi' then
      (select array_agg(distinct x::int order by x::int) from jsonb_array_elements_text(coalesce(q -> 'correct_indexes', '[]')) x) end;
    if q ->> 'kind' = 'multi' and keyset is null then raise exception 'pick at least one right answer for every multi-select question'; end if;
    if qid is null then
      insert into questions (lesson_id, at_s, kind, prompt, choices, correct_index, correct_indexes, position, rubric)
      values (lid, (q ->> 'at_s')::numeric, q ->> 'kind', q ->> 'prompt',
              case when q ->> 'kind' in ('mc', 'multi') then q -> 'choices' end,
              case when q ->> 'kind' = 'mc' then (q ->> 'correct_index')::int end, keyset, pos, rub);
    else
      select * into old from questions where id = qid;
      if old.kind <> q ->> 'kind' and exists (select 1 from answers where question_id = qid) then
        raise exception 'students already answered "%", so its question type cannot change', left(old.prompt, 60);
      end if;
      update questions set
        at_s = (q ->> 'at_s')::numeric, kind = q ->> 'kind', prompt = q ->> 'prompt',
        choices = case when q ->> 'kind' in ('mc', 'multi') then q -> 'choices' end,
        correct_index = case when q ->> 'kind' = 'mc' then (q ->> 'correct_index')::int end,
        correct_indexes = keyset,
        position = pos,
        rubric = rub
      where id = qid;
      if (old.kind = 'mc' and old.correct_index is distinct from (q ->> 'correct_index')::int)
         or (old.kind = 'multi' and old.correct_indexes is distinct from keyset) then
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
    update answers x set is_correct = case q2.kind
        when 'mc' then x.response::int = q2.correct_index
        else public.parse_choice_set(x.response) = q2.correct_indexes end
      from questions q2
      where q2.id = x.question_id and x.question_id = any (rekeyed) and x.graded_by = 'auto';
    update attempts t set score = public.compute_score(t.id)
      from assignments a
      where a.id = t.assignment_id and a.lesson_id = lid and t.finished_at is not null;
  end if;

  -- Notes: not graded and nothing points at them, so replace them all (when the caller sent its notes).
  if p_lesson ? 'notes' then
  delete from lesson_notes where lesson_id = lid;
  insert into lesson_notes (lesson_id, at_s, body, position)
    select lid, (n ->> 'at_s')::numeric, btrim(n ->> 'body'), (ord - 1)::int
    from jsonb_array_elements(notes) with ordinality as e(n, ord);
  if exists (select 1 from lesson_notes where lesson_id = lid and at_s > dur) then
    raise exception 'a note is past the end of the video';
  end if;
  end if;

  return lid;
end $$;

-- ---------------------------------------------------------------- submit_answer (7 + 11)

-- Same guards as 20261129000100, plus multi-select, and it tells the student whether the answer they just
-- locked in was right (when the lesson shows feedback). Never which choice was right.
drop function public.submit_answer(uuid, uuid, text);
create function public.submit_answer(p_attempt uuid, p_question uuid, p_response text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t attempts; q questions; l lessons; correct boolean; resp text; picked int[];
begin
  select * into t from attempts where id = p_attempt and student_id = auth.uid();
  if t.id is null then raise exception 'not your attempt'; end if;
  if t.finished_at is not null then raise exception 'attempt already finished'; end if;
  select q2.* into q from questions q2 join assignments a on a.lesson_id = q2.lesson_id
    where q2.id = p_question and a.id = t.assignment_id;
  if q.id is null then raise exception 'question not in this lesson'; end if;
  if t.max_watched_s + 1 < q.at_s then raise exception 'you have not reached this question yet'; end if;
  if p_response is null or btrim(p_response) = '' then raise exception 'answer is empty'; end if;
  select * into l from lessons where id = q.lesson_id;

  if q.kind = 'mc' then
    -- At most 6 choices, so one digit; checked as text before any cast.
    if p_response !~ '^[0-9]$' or p_response::int >= jsonb_array_length(q.choices) then
      raise exception 'mc response must be a choice index';
    end if;
    resp := p_response;
    correct := (p_response::int = q.correct_index);
  elsif q.kind = 'multi' then
    if length(p_response) > 40 then raise exception 'multi response must be choice indexes'; end if;
    picked := public.parse_choice_set(p_response);
    if picked is null or picked[cardinality(picked)] >= jsonb_array_length(q.choices) then
      raise exception 'multi response must be choice indexes';
    end if;
    resp := array_to_string(picked, ',');
    correct := (picked = q.correct_indexes);  -- exact match: every right choice and no wrong ones
  else
    resp := btrim(p_response);
  end if;

  insert into answers (attempt_id, question_id, response, is_correct, graded_by)
  values (t.id, q.id, resp, correct, case when q.kind in ('mc', 'multi') then 'auto' end)
  on conflict (attempt_id, question_id) do nothing;
  if not found then raise exception 'already answered'; end if;

  return jsonb_build_object('result',
    case when q.kind = 'short' or not l.show_feedback then 'submitted'
         when correct then 'correct' else 'incorrect' end);
end $$;
revoke all on function public.submit_answer(uuid, uuid, text) from public, anon;
grant execute on function public.submit_answer(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------- get_student_lesson (8 + 11)

-- Same as 20261125000000 plus notes and show_feedback.
create or replace function public.get_student_lesson(p_assignment uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a assignments; l lessons; t attempts;
begin
  select * into a from assignments where id = p_assignment;
  if a.id is null or not public.enrolled_in(a.class_id) then raise exception 'not assigned to you'; end if;
  select * into l from lessons where id = a.lesson_id;
  insert into attempts (assignment_id, student_id) values (a.id, auth.uid())
    on conflict (assignment_id, student_id) do update set updated_at = attempts.updated_at
    returning * into t;
  return jsonb_build_object(
    'attempt_id', t.id,
    'title', l.title,
    'youtube_id', l.youtube_id,
    'duration_s', l.duration_s,
    'require_fullscreen', l.require_fullscreen,
    'show_feedback', l.show_feedback,
    'max_watched_s', t.max_watched_s,
    'last_pos_s', t.last_pos_s,
    'finished_at', t.finished_at,
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object('id', n.id, 'at_s', n.at_s, 'body', n.body) order by n.at_s, n.position)
      from lesson_notes n where n.lesson_id = l.id), '[]'::jsonb),
    'questions', coalesce((
      select jsonb_agg(
        case when x.answered or t.max_watched_s + 1 >= x.at_s
          then jsonb_build_object('id', x.id, 'at_s', x.at_s, 'kind', x.kind, 'prompt', x.prompt, 'choices', x.choices,
                                  'answered', x.answered, 'locked', false)
          else jsonb_build_object('id', x.id, 'at_s', x.at_s, 'kind', x.kind, 'answered', false, 'locked', true)
        end
        order by x.at_s, x.position)
      from (
        select q.*, exists (select 1 from answers y where y.attempt_id = t.id and y.question_id = q.id) as answered
        from questions q where q.lesson_id = l.id
      ) x), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- assignment_results (7)

-- Same as 20261127000500 plus questions[].correct_indexes.
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
        'choices', q.choices, 'correct_index', q.correct_index, 'correct_indexes', q.correct_indexes, 'rubric', q.rubric) order by q.at_s, q.position)
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
