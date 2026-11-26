// Settings kept on this device (beta item 3, then dark mode). Applied as data attributes on <html> so the CSS can
// react, and read by the player (captions) and the builder (new-lesson defaults). Nothing here goes to the server.

export type Theme = 'system' | 'light' | 'dark'

export type Prefs = {
  theme: Theme
  textSize: 'normal' | 'large' | 'larger'
  contrast: 'normal' | 'high'
  reduceMotion: boolean
  captions: boolean
}

export const THEMES = [['system', 'Match my device'], ['light', 'Light'], ['dark', 'Dark']] as const satisfies readonly (readonly [Theme, string])[]

export const DEFAULT_PREFS: Prefs = { theme: 'system', textSize: 'normal', contrast: 'normal', reduceMotion: false, captions: false }
// Same key as before dark mode, so students keep the reading options they already picked.
const KEY = 'oasis:student-prefs'

export function readPrefs(store: Pick<Storage, 'getItem'> = localStorage): Prefs {
  try {
    const raw = JSON.parse(store.getItem(KEY) ?? '{}') as Partial<Prefs>
    return {
      theme: raw.theme === 'light' || raw.theme === 'dark' ? raw.theme : 'system',
      textSize: raw.textSize === 'large' || raw.textSize === 'larger' ? raw.textSize : 'normal',
      contrast: raw.contrast === 'high' ? 'high' : 'normal',
      reduceMotion: raw.reduceMotion === true,
      captions: raw.captions === true,
    }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

export function savePrefs(p: Prefs, store: Pick<Storage, 'setItem'> = localStorage) {
  try {
    store.setItem(KEY, JSON.stringify(p))
  } catch {
    // Storage full or blocked: still apply for this visit.
  }
  applyPrefs(p)
}

const darkQuery = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null)

export function resolveTheme(theme: Theme, systemDark = darkQuery()?.matches ?? false): 'light' | 'dark' {
  return theme === 'system' ? (systemDark ? 'dark' : 'light') : theme
}

export function applyPrefs(p: Prefs, el: HTMLElement = document.documentElement) {
  const theme = resolveTheme(p.theme)
  el.dataset.theme = theme
  el.dataset.text = p.textSize
  el.dataset.contrast = p.contrast
  el.dataset.motion = p.reduceMotion ? 'reduce' : 'normal'
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#101918' : '#0f7c78')
}

/** Apply saved settings now, and follow the OS light/dark switch while the theme is "system". */
export function startPrefs() {
  applyPrefs(readPrefs())
  darkQuery()?.addEventListener?.('change', () => {
    if (readPrefs().theme === 'system') applyPrefs(readPrefs())
  })
}

// ---------------------------------------------------------------- teacher defaults

export type TeacherDefaults = {
  /** Starting values for a new lesson's settings; each lesson can still change them. */
  fullscreen: boolean
  showFeedback: boolean
  aiGrade: boolean
  /** Starting text in the Assign dialog. Empty = Oasis's standard wording. */
  instructions: string
}

export const DEFAULT_TEACHER: TeacherDefaults = { fullscreen: true, showFeedback: true, aiGrade: false, instructions: '' }
const TKEY = 'oasis:teacher-defaults'

export function readTeacherDefaults(store: Pick<Storage, 'getItem'> = localStorage): TeacherDefaults {
  try {
    const raw = JSON.parse(store.getItem(TKEY) ?? '{}') as Partial<TeacherDefaults>
    return {
      fullscreen: raw.fullscreen !== false,
      showFeedback: raw.showFeedback !== false,
      aiGrade: raw.aiGrade === true,
      instructions: typeof raw.instructions === 'string' ? raw.instructions.slice(0, 2000) : '',
    }
  } catch {
    return { ...DEFAULT_TEACHER }
  }
}

export function saveTeacherDefaults(d: TeacherDefaults, store: Pick<Storage, 'setItem'> = localStorage) {
  try {
    store.setItem(TKEY, JSON.stringify(d))
  } catch {
    // ignore: defaults are a convenience
  }
}
