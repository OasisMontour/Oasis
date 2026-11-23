/** 0 -> "0m", 59 -> "1m", 5400 -> "1h 30m". */
export function formatDuration(seconds: number): string {
  const m = Math.round(seconds / 60)
  if (m < 60) return `${seconds > 0 && m === 0 ? 1 : m}m`
  const h = Math.floor(m / 60)
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`
}
