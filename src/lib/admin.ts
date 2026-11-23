// Shapes returned by the admin RPCs (supabase/migrations/20261125000000_admin.sql).
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
  added_at: string | null
  added_by: string | null
  role: 'teacher' | 'student' | null // null: hasn't signed in yet
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

export type AdminAudit = { actor: string; action: 'add_teacher' | 'remove_teacher'; target: string; detail: string; at: string }

export type AdminDashboard = {
  totals: AdminTotals
  teachers: AdminTeacher[]
  assignments: AdminAssignment[]
  audit: AdminAudit[]
}

/** One-line status for a teacher row. */
export function teacherStatus(t: AdminTeacher): { label: string; warn: boolean } {
  if (!t.on_allowlist) return { label: 'Teacher, not on allowlist', warn: true }
  if (t.role === null) return { label: 'Invited, not signed in yet', warn: false }
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
