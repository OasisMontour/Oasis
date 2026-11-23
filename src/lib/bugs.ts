// Shapes returned by the bug report RPCs (supabase/migrations/20261126000300_bug_reports.sql).
export type Severity = 'low' | 'medium' | 'high'
export type BugStatus = 'open' | 'fixing' | 'fixed' | 'wont_fix'

export type MyBug = { id: number; created_at: string; description: string; status: BugStatus; fix_note: string; fixed_at: string | null }
export type ChangelogEntry = { fixed_at: string; note: string; severity: Severity }
export type AdminBug = {
  id: number
  created_at: string
  page: string
  description: string
  user_agent: string
  reporter_role: 'teacher' | 'student'
  reporter: string | null // teachers only; students stay anonymous
  severity: Severity
  severity_auto: Severity
  severity_reason: string
  status: BugStatus
  fix_note: string
  fixed_at: string | null
}

export const STATUS_LABEL: Record<BugStatus, string> = { open: 'Open', fixing: 'Being fixed', fixed: 'Fixed', wont_fix: "Won't fix" }

/**
 * The page a report came from. It's also used as the Back link, so only plain app paths pass:
 * no full URLs, no "//host", and no backslashes ("/\\evil.com" is "//evil.com" to a browser).
 */
export function reportPage(from: string | null | undefined): string {
  if (!from || from.length > 200 || !/^\/(?!\/)[A-Za-z0-9/_-]*$/.test(from)) return ''
  return from
}
