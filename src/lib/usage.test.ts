// Audit #31: a failed first visit must be retried, not marked counted.
import { afterEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
vi.mock('./supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }))

describe('startUsageTracking', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    rpc.mockReset()
  })
  it('re-sends the visit on the next heartbeat when the first one failed', async () => {
    vi.useFakeTimers()
    const store = new Map<string, string>()
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) })
    vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: () => {}, removeEventListener: () => {} })
    vi.stubGlobal('window', { setInterval, clearInterval })
    rpc.mockResolvedValueOnce({ error: { message: 'Failed to fetch' } }).mockResolvedValue({ error: null })
    const { startUsageTracking } = await import('./usage')
    const stop = startUsageTracking('u1')
    await vi.advanceTimersByTimeAsync(0)
    expect(rpc).toHaveBeenNthCalledWith(1, 'track_usage', { p_visit: true })
    expect(store.size).toBe(0)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(rpc).toHaveBeenNthCalledWith(2, 'track_usage', { p_visit: true })
    expect(store.get('oasis.visit.u1')).toBe('1')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(rpc).toHaveBeenNthCalledWith(3, 'track_usage', { p_visit: false })
    stop()
  })
})
