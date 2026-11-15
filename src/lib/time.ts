/** 75 -> "1:15", 3725 -> "1:02:05" */
export function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

/** "1:15" -> 75, "1:02:05" -> 3725, "90" -> 90. Returns null if it isn't a time. */
export function parseTime(text: string): number | null {
  const t = text.trim()
  if (/^\d+$/.test(t)) return Number(t)
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(t)
  if (!m) return null
  const [, h, min, sec] = m
  if (Number(sec) > 59 || (h !== undefined && Number(min) > 59)) return null
  return Number(h ?? 0) * 3600 + Number(min) * 60 + Number(sec)
}
