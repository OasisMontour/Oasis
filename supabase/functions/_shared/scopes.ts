// Google scopes Oasis asks teachers for (never students). Shared by the browser and the Edge Function.
export const CLASSROOM_SCOPES = [
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.rosters.readonly',
  'https://www.googleapis.com/auth/classroom.profile.emails',
  // Auto-posting assignments (next PR). Asked now so teachers only see one consent screen.
  'https://www.googleapis.com/auth/classroom.coursework.students',
]
