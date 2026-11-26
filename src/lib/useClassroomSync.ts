import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { takeClassroomIntent, useAuth } from '../auth/AuthProvider'
import { supabase } from './supabase'
import { invokeFn } from './invokeFn'

// Re-sync rosters automatically when the dashboard opens and the last sync is older than this.
const AUTO_SYNC_AFTER_MS = 6 * 60 * 60 * 1000

type Status = { connected: boolean; last_synced_at: string | null }
type FnResult =
  | { ok: true; courses: number; students: number; created: number; updated: number; newly_enrolled: number; removed: number; skipped: string[]; hidden_emails?: number }
  | { ok: false; error: string; missing?: string[] }

export type ClassroomSync = {
  connected: boolean | null // null = still loading, or the status check failed (see statusError)
  /** classroom_status couldn't be read. Unknown is not "disconnected": offer a re-check, not a reconnect (audit #27). */
  statusError: boolean
  recheck: () => Promise<void>
  busy: boolean
  message: { kind: 'ok' | 'error'; text: string } | null
  connect: () => Promise<void>
  syncNow: () => Promise<void>
  disconnect: () => Promise<void>
}

/** Google Classroom connection for the teacher dashboard. Calls onImported after any successful sync. */
export function useClassroomSync(onImported: () => void): ClassroomSync {
  const { profile, session, connectClassroom } = useAuth()
  const [params, setParams] = useSearchParams()
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<ClassroomSync['message']>(null)
  const [statusError, setStatusError] = useState(false)
  const started = useRef(false)

  /** Reads the connection status, with one quiet retry. Null if it couldn't be read. */
  const readStatus = useCallback(async (): Promise<Status | null> => {
    for (let i = 0; i < 2; i++) {
      const { data, error } = await supabase.rpc('classroom_status')
      if (!error) return (data as Status | null) ?? { connected: false, last_synced_at: null }
    }
    return null
  }, [])

  const call = useCallback(
    async (body: Record<string, unknown>, quiet = false) => {
      setBusy(true)
      if (!quiet) setMessage({ kind: 'ok', text: 'Syncing with Google Classroom…' })
      const { data, error } = await invokeFn<FnResult>('classroom', body)
      setBusy(false)
      if (error || !data) {
        setMessage({ kind: 'error', text: `Google Classroom sync failed. ${error?.message ?? ''}`.trim() })
        return
      }
      if (!data.ok) {
        if (data.error === 'reconnect' || data.error === 'not_connected') {
          setStatus((s) => ({ last_synced_at: s?.last_synced_at ?? null, connected: false }))
          setMessage({ kind: 'error', text: 'Google Classroom needs to be reconnected. Click Connect Google Classroom.' })
        } else if (data.error === 'wrong_account') {
          setMessage({ kind: 'error', text: `That was a different Google account. Click Connect again and pick ${profile?.email ?? 'the account you signed in with'}.` })
        } else if (data.error === 'missing_scopes') {
          setMessage({ kind: 'error', text: 'Google Classroom access was only partly approved. Click Connect again and tick every box on the Google screen.' })
        } else setMessage({ kind: 'error', text: `Google Classroom sync failed: ${data.error}` })
        return
      }
      if (body.action === 'disconnect') {
        setStatus((s) => ({ last_synced_at: s?.last_synced_at ?? null, connected: false }))
        setMessage({ kind: 'ok', text: 'Google Classroom disconnected.' })
        return
      }
      setStatus({ connected: true, last_synced_at: new Date().toISOString() })
      let text = `Synced ${data.courses} class${data.courses === 1 ? '' : 'es'} and ${data.students} students from Google Classroom.`
      if (data.removed) text += ` Removed ${data.removed} student${data.removed === 1 ? '' : 's'} no longer in Classroom.`
      if (data.hidden_emails)
        text += ` Google didn't share the email of ${data.hidden_emails} student${data.hidden_emails === 1 ? '' : 's'}, so they can't be matched yet. Ask your school's Google admin to allow sharing student emails with apps.`
      if (data.skipped.length)
        text += ` Skipped ${data.skipped.join(', ')}: another teacher already imported ${data.skipped.length === 1 ? 'it' : 'them'}.`
      if (!quiet || data.created || data.newly_enrolled || data.removed || data.skipped.length) setMessage({ kind: 'ok', text })
      onImported()
    },
    [onImported, profile?.email],
  )

  // On load: finish a fresh connection, or auto-sync if it's been a while.
  useEffect(() => {
    if (!profile || started.current) return
    started.current = true
    ;(async () => {
      const read = await readStatus()
      setStatusError(!read)
      const s = read ?? { connected: false, last_synced_at: null }
      if (read) setStatus(read)
      const intent = takeClassroomIntent('/teacher') && !!session?.provider_refresh_token
      if (params.get('classroom') === '1' || intent) {
        // Back from the Google consent screen: hand the refresh token to the server, which stores it and syncs.
        if (params.get('classroom')) setParams({}, { replace: true })
        const refresh = session?.provider_refresh_token
        if (!refresh) return setMessage({ kind: 'error', text: "Google didn't send back Classroom access. Try Connect again." })
        // Refresh the Supabase session first: the new one has no Google tokens, so the Classroom refresh token
        // doesn't sit in this browser's localStorage (shared school computers, any future XSS) even if the tab
        // closes mid-call. The server keeps its own encrypted copy.
        await supabase.auth.refreshSession().catch(() => undefined)
        await call({ action: 'connect', refresh_token: refresh })
        return
      }
      const stale = !s.last_synced_at || Date.now() - new Date(s.last_synced_at).getTime() > AUTO_SYNC_AFTER_MS
      if (read && s.connected && stale) call({ action: 'sync' }, true)
    })()
  }, [profile, session, params, setParams, call, readStatus])

  const recheck = useCallback(async () => {
    const read = await readStatus()
    setStatusError(!read)
    if (read) setStatus(read)
  }, [readStatus])

  return {
    connected: status?.connected ?? null,
    statusError,
    recheck,
    busy,
    message,
    connect: () => connectClassroom(),
    syncNow: () => call({ action: 'sync' }),
    disconnect: () => call({ action: 'disconnect' }),
  }
}
