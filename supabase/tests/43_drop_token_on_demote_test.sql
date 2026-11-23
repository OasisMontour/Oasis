-- Integrated bug pass (Nov 23): a teacher who stops being a teacher doesn't leave a Google token behind.
\set ON_ERROR_STOP on
\set QUIET on

create temp table pre_tokens as select * from google_tokens;
insert into google_tokens (user_id, refresh_token_enc, scopes) values ('00000000-0000-0000-0000-0000000000a1', 'enc', 'classroom') on conflict do nothing;
insert into google_tokens (user_id, refresh_token_enc, scopes) values ('00000000-0000-0000-0000-0000000000b1', 'enc', 'classroom');

update profiles set name = name || '' where id = '00000000-0000-0000-0000-0000000000a1';
select tests.ok(exists (select 1 from google_tokens where user_id = '00000000-0000-0000-0000-0000000000a1'), 'other profile edits keep the token');

update profiles set role = 'student' where id = '00000000-0000-0000-0000-0000000000a1';
select tests.ok(not exists (select 1 from google_tokens where user_id = '00000000-0000-0000-0000-0000000000a1'), 'demoted teacher''s token is deleted');
select tests.ok(exists (select 1 from google_tokens where user_id = '00000000-0000-0000-0000-0000000000b1'), 'nobody else''s token is touched');

-- promotion (e.g. an approved sign-up holding a token) keeps it
update profiles set role = 'teacher' where id = '00000000-0000-0000-0000-0000000000b1';
select tests.ok(exists (select 1 from google_tokens where user_id = '00000000-0000-0000-0000-0000000000b1'), 'promotion keeps the token');

-- restore fixtures
update profiles set role = 'student' where id = '00000000-0000-0000-0000-0000000000b1';
update profiles set role = 'teacher' where id = '00000000-0000-0000-0000-0000000000a1';
delete from google_tokens where user_id in ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1');
insert into google_tokens select * from pre_tokens on conflict do nothing;
\echo 'ALL DROP TOKEN ON DEMOTE TESTS PASSED'
