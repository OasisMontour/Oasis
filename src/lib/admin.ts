// Shapes returned by the admin RPCs (supabase/migrations/20261126000000_admin.sql).
export type AdminTotals = {
  teachers: number
  students: number
  classes: number
  lessons: number
  assignments: number
  attempts_started: number
  attempts_finished: number
  flagged_attempts: number
}

export type AdminTeacher = {
  email: string
  name: string | null
  on_allowlist: boolean
  /** How they became a teacher. null: an old teacher account from before sign-ups were tracked. */
  via: TeacherVia | null
  added_at: string | null
  added_by: string | null
  role: 'teacher' | 'student' | null // null: pre-approved, hasn't signed in yet
  classroom_connected: boolean
  last_synced_at: string | null
  classes: number
  students: number
  lessons: number
  assignments: number
}

export type AdminAssignment = {
  id: string
  created_at: string
  due_at: string | null
  teacher: string
  class: string
  lesson: string
  posted_to_classroom: boolean
  students: number
  started: number
  finished: number
  avg_score: number | null
  flagged: number
  focus_events: number
}

export type TeacherVia = 'allowlist' | 'verified_teacher' | 'admin'

export type AdminAudit = {
  actor: string
  action: 'add_teacher' | 'remove_teacher' | 'approve_teacher' | 'deny_teacher' | 'unblock_teacher' | 'add_domain' | 'remove_domain' | 'ai_on' | 'ai_off'
  target: string
  detail: string
  at: string
}

/** A teacher sign-up waiting for an admin. Evidence is what Google said about the account. */
export type AdminSignup = {
  user_id: string
  email: string
  name: string
  reason: 'personal_account' | 'trusted_domain' | 'on_student_roster' | 'not_verified' | string
  evidence: {
    hosted_domain: string | null
    verified_teacher: boolean
    active_courses: number
    students: number | null
    course_names: string[]
  }
  requested_at: string
}

export type AdminDashboard = {
  totals: AdminTotals
  teachers: AdminTeacher[]
  signups: AdminSignup[]
  domains: { domain: string; added_by: string | null; added_at: string }[]
  blocked: { email: string; kind: 'denied' | 'removed'; added_by: string | null; added_at: string }[]
  assignments: AdminAssignment[]
  audit: AdminAudit[]
}

/** One-line status for a teacher row. */
export function teacherStatus(t: AdminTeacher): { label: string; warn: boolean } {
  if (t.role === null) return { label: 'Pre-approved, not signed in yet', warn: false }
  if (t.role === 'student') return { label: 'Signed in as a student', warn: true }
  if (!t.classroom_connected) return { label: 'Classroom not connected', warn: true }
  if (t.classes === 0) return { label: 'No classes synced', warn: true }
  return { label: 'Active', warn: false }
}

export function looksLikeEmail(s: string) {
  // Same rule as admin_add_teacher on the server.
  return /^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(s.trim().toLowerCase())
}

export type UsageDay = { day: string; students: number; teachers: number; visits: number; active_s: number }
// admin_ai_usage(): this month's AI grading use. Counts only.
export type AdminAiUsage = {
  enabled: boolean
  teacher_daily_cap: number
  global_monthly_cap: number
  month_answers: number
  today_answers: number
  providers: { provider: string; calls: number; failures: number; cooldown_until: string | null; last_error: string | null }[]
}

export type AdminUsage = {
  active: {
    today_students: number; today_teachers: number
    week_students: number; week_teachers: number
    month_students: number; month_teachers: number
    visits_30d: number; visits_total: number
    active_s_30d: number; active_s_total: number
  }
  students_week: { avg_active_s: number; median_active_s: number }
  video: { watched_s_total: number; answers_total: number }
  daily: UsageDay[]
  teachers: { email: string; visits: number; active_s_7d: number; active_s_total: number; last_seen: string | null }[]
}

export const VIA_LABEL: Record<TeacherVia, string> = {
  allowlist: 'pre-approved by an admin',
  verified_teacher: 'verified teacher (Google)',
  admin: 'approved by an admin',
}

/** Why a sign-up is waiting, for the admin. */
export function signupReason(s: AdminSignup): string {
  switch (s.reason) {
    case 'personal_account':
      return 'Personal Google account. Anyone can make Classroom classes with one.'
    case 'trusted_domain':
      return `School account at a trusted school (${s.evidence.hosted_domain ?? '?'}), not verified as a teacher by Google. Probably a teacher; check the classes look real.`
    case 'on_student_roster':
      return 'Listed as a student on a Classroom roster in Oasis.'
    case 'not_verified':
      return `School account (${s.evidence.hosted_domain ?? '?'}), not verified as a teacher by Google, school not on your trusted list.`
    default:
      return s.reason
  }
}

export function looksLikeDomain(s: string) {
  // Same rule as admin_add_domain on the server.
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s.trim().replace(/^@/, '').toLowerCase())
}
