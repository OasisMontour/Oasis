create table public.starter_lessons (
  id text primary key, title text not null, subject text not null,
  youtube_id text not null, questions jsonb not null
);
alter table public.starter_lessons enable row level security;
revoke all on public.starter_lessons from public, anon, authenticated;
grant select on public.starter_lessons to authenticated;
create policy teacher_catalog on public.starter_lessons for select to authenticated using (public.is_teacher());
insert into public.starter_lessons values ('zoo', 'Observing elephants', 'Biology', 'jNQXAC9IVRw', '[{"at_s": 8, "kind": "mc", "prompt": "Which observation can you verify from the video?", "choices": ["Elephants are standing behind the speaker", "The elephants have just eaten", "The elephants are the same age"], "correct_index": 0}, {"at_s": 17, "kind": "mc", "prompt": "Which structure does the speaker call attention to?", "choices": ["Tusks", "Trunks", "Ears"], "correct_index": 1}]');
insert into public.starter_lessons values ('bunny', 'Visual storytelling in Big Buck Bunny', 'Film studies', 'YE7VzlLtp-4', '[{"at_s": 100, "kind": "mc", "prompt": "Which detail most directly communicates a character’s emotion without dialogue?", "choices": ["The length of the credits", "The upload date", "Facial expression and posture"], "correct_index": 2}, {"at_s": 470, "kind": "mc", "prompt": "Which summary best describes the central conflict?", "choices": ["A rabbit responds to a group of bullies", "Two rabbits compete in a race", "A bird searches for its lost nest"], "correct_index": 0}]');
