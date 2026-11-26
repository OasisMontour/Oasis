// Audit #19: a script that loads but never calls onYouTubeIframeAPIReady must not hang forever.
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('loadYouTubeApi timeout', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.resetModules()
  })
  it('rejects after the timeout, then a retry starts a fresh load', async () => {
    vi.useFakeTimers()
    const appended: unknown[] = []
    const win: Record<string, unknown> = {}
    vi.stubGlobal('window', win)
    vi.stubGlobal('document', { createElement: () => ({}), head: { appendChild: (s: unknown) => appended.push(s) } })
    const { loadYouTubeApi } = await import('./youtube')

    const first = loadYouTubeApi(1000)
    const caught = first.catch((e: Error) => e.message)
    vi.advanceTimersByTime(1001)
    expect(await caught).toMatch(/taking too long/)

    const second = loadYouTubeApi(1000)
    expect(second).not.toBe(first)
    expect(appended).toHaveLength(2)
    const YT = { Player: function () {} }
    win.YT = YT
    ;(win.onYouTubeIframeAPIReady as () => void)()
    await expect(second).resolves.toBe(YT)
  })
})
