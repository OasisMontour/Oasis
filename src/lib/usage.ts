import { supabase } from './supabase'

// Feeds the admin page's usage numbers (supabase/migrations/20261126000100_usage.sql).
// One "visit" per browser tab per user, then a heartbeat every 30s while the tab is visible.
// The server only counts real elapsed time between beats, so nothing here needs to be trusted.
export function startUsageTracking(userId: string): () => void {
  const key = `oasis.visit.${userId}`
  // supabase.rpc() is lazy: the request only goes out once it's awaited or .then()'d.
  const send = (visit: boolean): Promise<boolean> =>
    Promise.resolve(supabase.rpc('track_usage', { p_visit: visit })).then(
      (r) => !r.error,
      () => false,
    )
  const counted = () => {
    try {
      return !!sessionStorage.getItem(key)
    } catch {
      return true // storage blocked: skip the visit count, heartbeats still work
    }
  }
  let visiting = false
  // Mark the visit counted only once the server took it; until then a heartbeat carries it (audit #31).
  const sendVisitOrBeat = () => {
    if (counted() || visiting) return send(false)
    visiting = true
    return send(true).then((ok) => {
      visiting = false
      if (ok) {
        try {
          sessionStorage.setItem(key, '1')
        } catch {
          /* storage blocked */
        }
      }
      return ok
    })
  }
  void sendVisitOrBeat()
  const beat = () => {
    if (document.visibilityState === 'visible') void sendVisitOrBeat()
  }
  const id = window.setInterval(beat, 30_000)
  document.addEventListener('visibilitychange', beat)
  return () => {
    window.clearInterval(id)
    document.removeEventListener('visibilitychange', beat)
  }
}
