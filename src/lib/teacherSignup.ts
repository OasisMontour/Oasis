// Copy for the teacher sign-up page. Reasons come from claim_teacher_for
// (supabase/migrations/20261127000000_teacher_self_signup.sql).

export type ClaimResponse =
  | { ok: true; status: 'granted'; via: string | null; courses: number; students: number }
  | { ok: true; status: 'pending' | 'refused'; reason: string }
  | { ok: false; error: string }

export type MyRequest = { status: 'pending' | 'approved' | null; reason: string | null; requested_at: string | null; blocked: boolean }

/** Why the sign-up is waiting for the Oasis team, in the teacher's terms. */
export function pendingText(reason: string | null): string {
  switch (reason) {
    case 'personal_account':
      return "You used a personal Google account. Anyone can make a Classroom class with one, so the Oasis team checks these by hand. Using your school account is usually instant."
    case 'trusted_domain':
      return "Your school already works with Oasis. Unless your school's Google admin has verified you as a teacher, the Oasis team approves new teachers by hand. This is usually quick."
    case 'on_student_roster':
      return 'A Google Classroom roster in Oasis lists this account as a student, so the Oasis team will double-check.'
    case 'not_verified':
      return "Your school hasn't marked you as a verified teacher in Google Classroom, so the Oasis team will check and approve you."
    default:
      return 'The Oasis team will check and approve you.'
  }
}

/** Why the sign-up didn't go through, and what to do. */
export function refusedText(reason: string, email: string | undefined): string {
  switch (reason) {
    case 'no_courses':
      return "This Google account doesn't teach any active Google Classroom classes. Create your class in Google Classroom first (or ask to be added as a co-teacher), then try again."
    case 'wrong_account':
      return `You picked a different Google account on Google's screen. Try again and pick ${email ?? 'the account you signed in with'}.`
    case 'student_account':
      return 'This account is already a student in Oasis classes, so it can’t be a teacher account. Sign out and use your teacher account.'
    case 'blocked':
      return "This account can't be set up as a teacher. If you think that's a mistake, use Report a bug to reach the Oasis team."
    default:
      return 'Sign-up didn’t go through. Try again.'
  }
}
