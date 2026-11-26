import { useEffect } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { invokeFn } from '../lib/invokeFn'
import { supabase } from '../lib/supabase'
import { AUTO_SYNC_AFTER_MS, ROSTER_SYNC_EVENT, ROSTER_SYNC_KEY } from '../lib/useClassroomSync'

const CHECK_EVERY_MS = 60 * 1000

/**
 * Keeps a signed-in teacher's Google Classroom rosters fresh while they're using Oasis (beta item 4): a quiet
 * sync when the last one is older than 15 minutes, checked every minute while the tab is visible and again the
 * moment they come back to it. One tab syncs at a time (localStorage), and nothing runs in a hidden tab.
 * Pages that show classes listen for ROSTER_SYNC_EVENT and reload.
 */
export function RosterAutoSync() {
  const { profile } = useAuth()
  const isTeacher = profile?.role === 'teacher'

  useEffect(() => {
    if (!isTeacher) return
    let running = false
    let stopped = false
    const maybeSync = async () => {
      if (stopped || running || document.visibilityState !== 'visible') return
      const last = Number(localStorage.getItem(ROSTER_SYNC_KEY) ?? 0)
      if (Date.now() - last < AUTO_SYNC_AFTER_MS) return
      running = true
      try {
        const { data } = await supabase.rpc('classroom_status')
        const st = data as { connected: boolean; last_synced_at: string | null } | null
        if (!st?.connected) return
        if (st.last_synced_at && Date.now() - new Date(st.last_synced_at).getTime() < AUTO_SYNC_AFTER_MS) {
          localStorage.setItem(ROSTER_SYNC_KEY, String(new Date(st.last_synced_at).getTime()))
          return
        }
        // Claim the sync before calling, so another tab checking at the same moment backs off.
        localStorage.setItem(ROSTER_SYNC_KEY, String(Date.now()))
        const { data: r } = await invokeFn<{ ok: boolean }>('classroom', { action: 'sync' })
        if (r?.ok && !stopped) window.dispatchEvent(new Event(ROSTER_SYNC_EVENT))
      } finally {
        running = false
      }
    }
    void maybeSync()
    const id = window.setInterval(() => void maybeSync(), CHECK_EVERY_MS)
    const onBack = () => void maybeSync()
    document.addEventListener('visibilitychange', onBack)
    window.addEventListener('focus', onBack)
    return () => {
      stopped = true
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onBack)
      window.removeEventListener('focus', onBack)
    }
  }, [isTeacher])

  return null
}
