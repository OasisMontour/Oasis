-- Integrated bug pass (Nov 23): removing a teacher demoted them but kept their stored Google refresh token, which
-- can read every roster they teach (minors' names and emails). Nobody could see it any more: the admin page lists
-- teachers only, and the classroom function refuses non-teachers. Data we can't use is data we shouldn't hold.
-- A trigger, so it holds however the role changes (admin remove now, sign-up deny/remove later, SQL editor).
-- Google-side revoke isn't possible from SQL; deleting our only copy makes the token unusable to Oasis.
-- Re-adding the teacher means one more "Connect Google Classroom" click.

create function public.drop_google_token_on_demote() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from google_tokens where user_id = new.id;
  return new;
end $$;
revoke all on function public.drop_google_token_on_demote() from public, anon, authenticated;

create trigger profiles_drop_token_on_demote after update of role on public.profiles
  for each row when (old.role = 'teacher' and new.role is distinct from 'teacher')
  execute function public.drop_google_token_on_demote();
