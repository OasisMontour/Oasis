-- Red-team regression (Nov 17): rapid save_progress calls must not add up to a skip.
-- The old code granted +5s per call, so 120 calls of +5s skipped a 10-minute video in ~75ms.
-- Statements here run in autocommit (no begin/commit) so each call sees a fresh now(), like the real attack.
\set ON_ERROR_STOP on
\set QUIET on

insert into lessons (id, teacher_id, title, youtube_id, duration_s)
  values ('20000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-0000000000a1', 'Long video', 'abcdefghijk', 600);
insert into assignments (id, lesson_id, class_id)
  values ('40000000-0000-0000-0000-000000000099', '20000000-0000-0000-0000-000000000099', '10000000-0000-0000-0000-000000000001');

create function tests.try_save(att uuid, s numeric) returns void language plpgsql as $$
begin
  perform public.save_progress(att, s, s);
exception when others then null;  -- rejected saves are expected; we check where progress ends up
end $$;
grant execute on function tests.try_save(uuid, numeric) to authenticated;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', false);
select (get_student_lesson('40000000-0000-0000-0000-000000000099') ->> 'attempt_id') as spam_att \gset

-- the attack: 120 back-to-back +5s saves
select format('select tests.try_save(%L, %s)', :'spam_att', i * 5) from generate_series(1, 120) i \gexec
reset role;
select tests.ok((select max_watched_s from attempts where id = :'spam_att') <= 31,
  'spamming +5s saves gets at most ~30s ahead, not the whole video');

-- honest watching still works: 15s of real time, 15s of video, ten times in a row
select max_watched_s as before_honest from attempts where id = :'spam_att' \gset
select format(e'reset role;\n%s;\nset role authenticated;\n%s;', q, s)
  from (
    select format($f$update attempts set credit_at = credit_at - interval '15 seconds' where id = %L$f$, :'spam_att') as q,
           format('select save_progress(%L, %s, %s)', :'spam_att', :before_honest + i * 15, :before_honest + i * 15) as s, i
    from generate_series(1, 10) i
  ) x order by i \gexec
reset role;
select tests.ok((select max_watched_s from attempts where id = :'spam_att') = :before_honest + 150,
  'a student watching at normal speed is never blocked');

\echo 'ALL SKIP-SPAM TESTS PASSED'
