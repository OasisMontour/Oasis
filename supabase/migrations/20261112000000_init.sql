-- Oasis initial schema.
-- Rules this file enforces (see docs/design.md):
--   * Every table has RLS on. No table is writable by students directly; students write through RPCs.
--   * Students can never read correct answers (questions table is teacher-only; students get questions via RPC).
--   * Scores and correctness are computed in the database, never trusted from the browser.
--   * Teacher accounts come from teacher_allowlist; everyone else who signs in is a student.

-- ---------------------------------------------------------------- tables

create table public.teacher_allowlist (
  email text primary key check (email = lower(email)),
  added_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'student' check (role in ('teacher', 'student')),
  name text not null default '',
  email text not null,
  created_at timestamptz not null default now()
);

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  join_code text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
  google_course_id text unique,            -- set when imported from Google Classroom
  created_at timestamptz not null default now()
);

create table public.enrollments (
  class_id uuid not null references public.classes(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (class_id, student_id)
);

create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (length(title) between 1 and 200),
  subject text not null default '',
  youtube_id text not null check (youtube_id ~ '^[A-Za-z0-9_-]{11}$'),
  duration_s numeric not null check (duration_s > 0),
  require_fullscreen boolean not null default true,
  ai_grade_short boolean not null default false,
  shared boolean not null default false,  -- visible in the subject library to other teachers
  source text not null default 'manual' check (source in ('manual', 'bulk_paste', 'edpuzzle', 'ai', 'copy')),
  created_at timestamptz not null default now()
);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  at_s numeric not null check (at_s >= 0),
  kind text not null check (kind in ('mc', 'short')),
  prompt text not null check (length(prompt) between 1 and 2000),
  choices jsonb,                           -- array of strings for mc, null for short
  correct_index int,                       -- mc only
  position int not null default 0,
  check (
    (kind = 'mc' and jsonb_typeof(choices) = 'array' and jsonb_array_length(choices) between 2 and 6
      and correct_index between 0 and jsonb_array_length(choices) - 1)
    or (kind = 'short' and choices is null and correct_index is null)
  )
);
create index on public.questions (lesson_id, at_s);

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  due_at timestamptz,
  google_coursework_id text,               -- set when auto-posted to Google Classroom
  created_at timestamptz not null default now(),
  unique (lesson_id, class_id)
);

create table public.attempts (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  max_watched_s numeric not null default 0,
  last_pos_s numeric not null default 0,
  finished_at timestamptz,
  score numeric,                           -- 0..100, set by finish_attempt / regrade
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_id, student_id)
);

create table public.answers (
  attempt_id uuid not null references public.attempts(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  response text not null check (length(response) <= 5000),
  is_correct boolean,                      -- null = short answer not graded yet
  graded_by text check (graded_by in ('auto', 'teacher', 'ai')),
  answered_at timestamptz not null default now(),
  primary key (attempt_id, question_id)
);

create table public.focus_events (
  id bigint generated always as identity primary key,
  attempt_id uuid not null references public.attempts(id) on delete cascade,
  kind text not null check (kind in ('exit_fullscreen', 'tab_hidden', 'blur', 'no_fullscreen_support')),
  video_s numeric not null,
  at timestamptz not null default now()
);
create index on public.focus_events (attempt_id);

-- ---------------------------------------------------------------- helpers
-- security definer so policies can call them without recursing through RLS.

create function public.is_teacher() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'teacher');
$$;

create function public.teaches_class(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from classes where id = c and teacher_id = auth.uid());
$$;

create function public.enrolled_in(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from enrollments where class_id = c and student_id = auth.uid());
$$;

create function public.owns_lesson(l uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from lessons where id = l and teacher_id = auth.uid());
$$;

-- New auth user -> profile. Teacher only if their email is on the allowlist.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, name, role)
  values (
    new.id,
    lower(new.email),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''),
    case when exists (select 1 from teacher_allowlist where email = lower(new.email)) then 'teacher' else 'student' end
  );
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- RLS

alter table public.teacher_allowlist enable row level security;  -- no policies: service role only
alter table public.profiles enable row level security;
alter table public.classes enable row level security;
alter table public.enrollments enable row level security;
alter table public.lessons enable row level security;
alter table public.questions enable row level security;
alter table public.assignments enable row level security;
alter table public.attempts enable row level security;
alter table public.answers enable row level security;
alter table public.focus_events enable row level security;

-- Start from nothing, then grant only what's needed.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, public;

-- profiles: see yourself; teachers see students in their classes. Only `name` is editable.
grant select on public.profiles to authenticated;
grant update (name) on public.profiles to authenticated;
create policy profiles_self on public.profiles for select using (id = auth.uid());
create policy profiles_teacher_sees_students on public.profiles for select using (
  exists (select 1 from enrollments e join classes c on c.id = e.class_id
          where e.student_id = profiles.id and c.teacher_id = auth.uid()));
create policy profiles_update_self on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- classes: teachers manage their own; students see classes they're in.
grant select, insert, update, delete on public.classes to authenticated;
create policy classes_teacher on public.classes for all
  using (teacher_id = auth.uid()) with check (teacher_id = auth.uid() and public.is_teacher());
create policy classes_student on public.classes for select using (public.enrolled_in(id));

-- enrollments: teacher sees/removes for their classes; student sees own. Joining goes through join_class().
grant select, delete on public.enrollments to authenticated;
create policy enrollments_teacher on public.enrollments for select using (public.teaches_class(class_id));
create policy enrollments_teacher_delete on public.enrollments for delete using (public.teaches_class(class_id));
create policy enrollments_self on public.enrollments for select using (student_id = auth.uid());

-- lessons: teacher manages own; teachers browse shared; students see lessons assigned to their classes.
grant select, insert, update, delete on public.lessons to authenticated;
create policy lessons_owner on public.lessons for all
  using (teacher_id = auth.uid()) with check (teacher_id = auth.uid() and public.is_teacher());
create policy lessons_library on public.lessons for select using (shared and public.is_teacher());
create policy lessons_student on public.lessons for select using (
  exists (select 1 from assignments a where a.lesson_id = lessons.id and public.enrolled_in(a.class_id)));

-- questions: teachers only (owner, or shared lesson for copying). Students use get_student_lesson().
grant select, insert, update, delete on public.questions to authenticated;
create policy questions_owner on public.questions for all
  using (public.owns_lesson(lesson_id)) with check (public.owns_lesson(lesson_id));
create policy questions_library on public.questions for select using (
  public.is_teacher() and exists (select 1 from lessons l where l.id = questions.lesson_id and l.shared));

-- assignments: teacher assigns their own lessons to their own classes; students see their classes'.
grant select, insert, update, delete on public.assignments to authenticated;
create policy assignments_teacher on public.assignments for all
  using (public.teaches_class(class_id))
  with check (public.teaches_class(class_id) and public.owns_lesson(lesson_id));
create policy assignments_student on public.assignments for select using (public.enrolled_in(class_id));

-- attempts / answers / focus_events: read-only to clients; written by RPCs below.
grant select on public.attempts, public.answers, public.focus_events to authenticated;
create policy attempts_self on public.attempts for select using (student_id = auth.uid());
create policy attempts_teacher on public.attempts for select using (
  exists (select 1 from assignments a where a.id = attempts.assignment_id and public.teaches_class(a.class_id)));
create policy answers_self on public.answers for select using (
  exists (select 1 from attempts t where t.id = answers.attempt_id and t.student_id = auth.uid()));
create policy answers_teacher on public.answers for select using (
  exists (select 1 from attempts t join assignments a on a.id = t.assignment_id
          where t.id = answers.attempt_id and public.teaches_class(a.class_id)));
create policy focus_self on public.focus_events for select using (
  exists (select 1 from attempts t where t.id = focus_events.attempt_id and t.student_id = auth.uid()));
create policy focus_teacher on public.focus_events for select using (
  exists (select 1 from attempts t join assignments a on a.id = t.assignment_id
          where t.id = focus_events.attempt_id and public.teaches_class(a.class_id)));

-- ---------------------------------------------------------------- RPCs

-- Student joins a class by code. Teachers can't join as students.
create function public.join_class(code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if public.is_teacher() then raise exception 'teachers cannot join a class as a student'; end if;
  select id into c from classes where join_code = upper(trim(code));
  if c is null then raise exception 'no class with that code'; end if;
  insert into enrollments (class_id, student_id) values (c, auth.uid()) on conflict do nothing;
  return c;
end $$;

-- Everything the player needs, without correct answers. Creates the attempt on first open.
create function public.get_student_lesson(p_assignment uuid) returns jsonb
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
    'max_watched_s', t.max_watched_s,
    'last_pos_s', t.last_pos_s,
    'finished_at', t.finished_at,
    'score', t.score,
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', q.id, 'at_s', q.at_s, 'kind', q.kind, 'prompt', q.prompt, 'choices', q.choices,
        'answered', exists (select 1 from answers x where x.attempt_id = t.id and x.question_id = q.id))
        order by q.at_s, q.position)
      from questions q where q.lesson_id = l.id), '[]'::jsonb));
end $$;

-- Progress save. Rejects skipping: progress can't outrun wall-clock time (+5s slack),
-- can't pass the first unanswered question, and can't exceed the video length.
create function public.save_progress(p_attempt uuid, p_max_watched numeric, p_last_pos numeric) returns void
language plpgsql security definer set search_path = public as $$
declare t attempts; l lessons; gate numeric; allowed numeric;
begin
  select * into t from attempts where id = p_attempt and student_id = auth.uid() for update;
  if t.id is null then raise exception 'not your attempt'; end if;
  if t.finished_at is not null then return; end if;
  select l2.* into l from lessons l2 join assignments a on a.lesson_id = l2.id where a.id = t.assignment_id;

  allowed := t.max_watched_s + extract(epoch from (now() - t.updated_at)) + 5;
  select min(q.at_s) into gate from questions q
    where q.lesson_id = l.id
      and not exists (select 1 from answers x where x.attempt_id = t.id and x.question_id = q.id);
  if gate is not null then allowed := least(allowed, gate + 1); end if;
  allowed := least(allowed, l.duration_s);

  if p_max_watched > allowed then raise exception 'progress jump rejected'; end if;

  update attempts set
    max_watched_s = greatest(max_watched_s, p_max_watched),
    last_pos_s = least(greatest(p_last_pos, 0), greatest(max_watched_s, p_max_watched)),
    updated_at = now()
  where id = t.id;
end $$;

-- Answer a question. Must have watched up to it. MC auto-graded; one answer per question.
create function public.submit_answer(p_attempt uuid, p_question uuid, p_response text) returns boolean
language plpgsql security definer set search_path = public as $$
declare t attempts; q questions; correct boolean;
begin
  select * into t from attempts where id = p_attempt and student_id = auth.uid();
  if t.id is null then raise exception 'not your attempt'; end if;
  if t.finished_at is not null then raise exception 'attempt already finished'; end if;
  select q2.* into q from questions q2 join assignments a on a.lesson_id = q2.lesson_id
    where q2.id = p_question and a.id = t.assignment_id;
  if q.id is null then raise exception 'question not in this lesson'; end if;
  if t.max_watched_s + 1 < q.at_s then raise exception 'you have not reached this question yet'; end if;

  if q.kind = 'mc' then
    if p_response !~ '^[0-9]+$' then raise exception 'mc response must be a choice index'; end if;
    correct := (p_response::int = q.correct_index);
  end if;

  insert into answers (attempt_id, question_id, response, is_correct, graded_by)
  values (t.id, q.id, p_response, correct, case when q.kind = 'mc' then 'auto' end)
  on conflict (attempt_id, question_id) do nothing;
  if not found then raise exception 'already answered'; end if;
  return correct;  -- null for short answers
end $$;

create function public.compute_score(p_attempt uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select case when count(q.id) = 0 then 100
         else round(100.0 * count(*) filter (where x.is_correct) / count(q.id), 1) end
  from attempts t
  join assignments a on a.id = t.assignment_id
  join questions q on q.lesson_id = a.lesson_id
  left join answers x on x.attempt_id = t.id and x.question_id = q.id
  where t.id = p_attempt;
$$;
revoke all on function public.compute_score(uuid) from public, anon, authenticated;

-- Finish: must have watched to the end (within 2s) and answered everything.
create function public.finish_attempt(p_attempt uuid) returns numeric
language plpgsql security definer set search_path = public as $$
declare t attempts; l lessons; missing int; s numeric;
begin
  select * into t from attempts where id = p_attempt and student_id = auth.uid() for update;
  if t.id is null then raise exception 'not your attempt'; end if;
  if t.finished_at is not null then return t.score; end if;
  select l2.* into l from lessons l2 join assignments a on a.lesson_id = l2.id where a.id = t.assignment_id;
  if t.max_watched_s < l.duration_s - 2 then raise exception 'video not finished'; end if;
  select count(*) into missing from questions q where q.lesson_id = l.id
    and not exists (select 1 from answers x where x.attempt_id = t.id and x.question_id = q.id);
  if missing > 0 then raise exception 'unanswered questions'; end if;
  s := public.compute_score(t.id);
  update attempts set finished_at = now(), score = s, updated_at = now() where id = t.id;
  return s;
end $$;

-- Teacher marks a short answer right or wrong; score is recomputed.
create function public.grade_answer(p_attempt uuid, p_question uuid, p_correct boolean) returns numeric
language plpgsql security definer set search_path = public as $$
declare a assignments; s numeric;
begin
  select a2.* into a from assignments a2 join attempts t on t.assignment_id = a2.id where t.id = p_attempt;
  if a.id is null or not public.teaches_class(a.class_id) then raise exception 'not your student'; end if;
  update answers set is_correct = p_correct, graded_by = 'teacher'
    where attempt_id = p_attempt and question_id = p_question;
  if not found then raise exception 'no such answer'; end if;
  s := public.compute_score(p_attempt);
  update attempts set score = s where id = p_attempt and finished_at is not null;
  return s;
end $$;

-- Anti-cheat log. Capped at 500 events per attempt so a script can't flood the table.
create function public.log_focus_event(p_attempt uuid, p_kind text, p_video_s numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from attempts where id = p_attempt and student_id = auth.uid()) then
    raise exception 'not your attempt';
  end if;
  if (select count(*) from focus_events where attempt_id = p_attempt) >= 500 then return; end if;
  insert into focus_events (attempt_id, kind, video_s) values (p_attempt, p_kind, p_video_s);
end $$;

grant execute on function
  public.join_class(text), public.get_student_lesson(uuid), public.save_progress(uuid, numeric, numeric),
  public.submit_answer(uuid, uuid, text), public.finish_attempt(uuid), public.grade_answer(uuid, uuid, boolean),
  public.log_focus_event(uuid, text, numeric),
  public.is_teacher(), public.teaches_class(uuid), public.enrolled_in(uuid), public.owns_lesson(uuid)
to authenticated;
