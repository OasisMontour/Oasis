-- Classroom drafts (beta item 10). Oasis now creates the Classroom assignment as an unpublished DRAFT with the
-- lesson title, the teacher's instructions, the student link and the due date. The teacher picks a Classwork
-- topic and posts it in Classroom. Oasis never publishes on its own.
--
--   instructions            what the teacher typed in assignment setup ('' = default text)
--   google_coursework_state DRAFT / PUBLISHED / DELETED as Classroom last reported it. Null = posted before this
--                           change (those were published straight away).
--   google_coursework_url   where to finish it: the coursework's own Classroom link once Google gives one,
--                           otherwise the class's page.
alter table public.assignments
  add column instructions text not null default '' check (length(instructions) <= 2000),
  add column google_coursework_state text check (google_coursework_state in ('DRAFT', 'PUBLISHED', 'DELETED')),
  add column google_coursework_url text check (google_coursework_url ~ '^https://classroom\.google\.com/' and length(google_coursework_url) <= 500);

-- The classroom Edge Function writes these as the teacher (RLS: their own class's assignments only).
grant update (instructions, google_coursework_state, google_coursework_url) on public.assignments to authenticated;
