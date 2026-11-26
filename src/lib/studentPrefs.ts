// Student settings (beta item 3), kept on this device. Applied as data attributes on <html> so the CSS can react,
// and read by the player for captions. Nothing here is sent to the server.

export type StudentPrefs = {
  textSize: 'normal' | 'large' | 'larger'
  contrast: 'normal' | 'high'
  reduceMotion: boolean
  captions: boolean
}

export const DEFAULT_PREFS: StudentPrefs = { textSize: 'normal', contrast: 'normal', reduceMotion: false, captions: false }
const KEY = 'oasis:student-prefs'

export function readPrefs(store: Pick<Storage, 'getItem'> = localStorage): StudentPrefs {
  try {
    const raw = JSON.parse(store.getItem(KEY) ?? '{}') as Partial<StudentPrefs>
    return {
      textSize: raw.textSize === 'large' || raw.textSize === 'larger' ? raw.textSize : 'normal',
      contrast: raw.contrast === 'high' ? 'high' : 'normal',
      reduceMotion: raw.reduceMotion === true,
      captions: raw.captions === true,
    }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

export function savePrefs(p: StudentPrefs, store: Pick<Storage, 'setItem'> = localStorage) {
  store.setItem(KEY, JSON.stringify(p))
  applyPrefs(p)
}

export function applyPrefs(p: StudentPrefs, el: HTMLElement = document.documentElement) {
  el.dataset.text = p.textSize
  el.dataset.contrast = p.contrast
  el.dataset.motion = p.reduceMotion ? 'reduce' : 'normal'
}
