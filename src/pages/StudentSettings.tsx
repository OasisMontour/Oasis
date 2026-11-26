import { useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { StudentShell } from '../components/StudentShell'
import { readPrefs, savePrefs, type StudentPrefs } from '../lib/studentPrefs'

/** Student settings (beta item 3): reading and viewing options on this device, the signed-in account, sign out. */
export function StudentSettings() {
  const { profile, signOut } = useAuth()
  const [prefs, setPrefs] = useState<StudentPrefs>(() => readPrefs())
  const [saved, setSaved] = useState(false)
  const set = (patch: Partial<StudentPrefs>) => {
    const next = { ...prefs, ...patch }
    setPrefs(next)
    savePrefs(next)
    setSaved(true)
  }

  return (
    <StudentShell>
      <h1>Settings</h1>
      <p className="s-muted">These are saved on this device.</p>

      <section className="s-card" aria-labelledby="see-h">
        <h2 id="see-h">Reading and viewing</h2>
        <fieldset className="s-field">
          <legend>Text size</legend>
          {(['normal', 'large', 'larger'] as const).map((v) => (
            <label key={v} className="s-choice">
              <input type="radio" name="text" checked={prefs.textSize === v} onChange={() => set({ textSize: v })} />
              {v === 'normal' ? 'Normal' : v === 'large' ? 'Large' : 'Larger'}
            </label>
          ))}
        </fieldset>
        <label className="s-choice">
          <input type="checkbox" checked={prefs.contrast === 'high'} onChange={(e) => set({ contrast: e.target.checked ? 'high' : 'normal' })} />
          High contrast
        </label>
        <label className="s-choice">
          <input type="checkbox" checked={prefs.reduceMotion} onChange={(e) => set({ reduceMotion: e.target.checked })} />
          Reduce motion
        </label>
        <label className="s-choice">
          <input type="checkbox" checked={prefs.captions} onChange={(e) => set({ captions: e.target.checked })} />
          Turn on video captions when the video has them
        </label>
        <p className="s-muted" role="status" aria-live="polite">{saved ? 'Saved.' : ''}</p>
      </section>

      <section className="s-card" aria-labelledby="acct-h">
        <h2 id="acct-h">Account</h2>
        <p>
          Signed in with Google as <b>{profile?.email}</b>.
        </p>
        <p className="s-muted">Wrong account? Sign out and sign in with your school account.</p>
        <button className="s-btn" onClick={signOut}>Sign out</button>
      </section>
    </StudentShell>
  )
}
