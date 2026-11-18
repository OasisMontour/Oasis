/** Pulls the 11-character video id out of any common YouTube link, or a bare id. */
export function parseYouTubeId(input: string): string | null {
  const t = input.trim()
  if (/^[A-Za-z0-9_-]{11}$/.test(t)) return t
  let url: URL
  try {
    url = new URL(t.startsWith('http') ? t : `https://${t}`)
  } catch {
    return null
  }
  const host = url.hostname.replace(/^(www\.|m\.|music\.)/, '')
  let id: string | null = null
  if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0]
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = url.searchParams.get('v')
    const m = /^\/(?:embed|shorts|live|v)\/([^/?#]+)/.exec(url.pathname)
    if (!id && m) id = m[1]
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null
}

// Minimal typing for the bits of the IFrame API we use.
export type YTPlayer = {
  getDuration(): number
  getCurrentTime(): number
  seekTo(seconds: number, allowSeekAhead: boolean): void
  pauseVideo(): void
  destroy(): void
}
type YTNamespace = {
  Player: new (
    el: HTMLElement,
    opts: {
      videoId: string
      playerVars?: Record<string, number | string>
      events?: { onReady?: () => void; onError?: (e: { data: number }) => void }
    },
  ) => YTPlayer
}
declare global {
  interface Window {
    YT?: YTNamespace
    onYouTubeIframeAPIReady?: () => void
  }
}

let apiPromise: Promise<YTNamespace> | null = null

/** Loads https://www.youtube.com/iframe_api once and resolves with window.YT. */
export function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (!apiPromise) {
    apiPromise = new Promise((resolve, reject) => {
      const prev = window.onYouTubeIframeAPIReady
      window.onYouTubeIframeAPIReady = () => {
        prev?.()
        resolve(window.YT!)
      }
      const s = document.createElement('script')
      s.src = 'https://www.youtube.com/iframe_api'
      s.onerror = () => {
        apiPromise = null
        reject(new Error('Could not load YouTube. Check that YouTube is not blocked on this network.'))
      }
      document.head.appendChild(s)
    })
  }
  return apiPromise
}

/** YouTube player error codes -> what to tell a teacher. */
export function youTubeErrorMessage(code: number): string {
  if (code === 101 || code === 150) return "This video's owner doesn't allow it to be played on other sites. Pick a different video."
  if (code === 100) return 'That video was removed or is private.'
  return "That video couldn't be loaded. Check the link."
}
