import { supabase } from './supabase'

// Feeds the admin page's usage numbers (supabase/migrations/20261126000100_usage.sql).
// One "visit" per browser tab per user, then a heartbeat every 30s while the tab is visible.
// The server only counts real elapsed time between beats, so nothing here needs to be trusted.
export function startUsageTracking(userId: string): () => void {
  const key = `oasis.visit.${userId}`
  // supabase.rpc() is lazy: the request only goes out once it's awaited or .then()'d.
  const send = (visit: boolean) => {
    supabase.rpc('track_usage', { p_visit: visit }).then(
      () => {},
      () => {},
    )
  }
  try {
    if (!sessionStorage.getItem(key)) {
      sessionStorage.setItem(key, '1')
      send(true)
    }
  } catch {
    // storage blocked: skip the visit count, heartbeats still work
  }
  const beat = () => {
    if (document.visibilityState === 'visible') send(false)
  }
  const id = window.setInterval(beat, 30_000)
  document.addEventListener('visibilitychange', beat)
  return () => {
    window.clearInterval(id)
    document.removeEventListener('visibilitychange', beat)
  }
}
