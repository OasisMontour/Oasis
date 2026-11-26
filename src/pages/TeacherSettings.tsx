import { useCallback, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { TeacherBar } from '../components/TeacherBar'
import { DEFAULT_INSTRUCTIONS } from '../lib/assign'
import { readPrefs, readTeacherDefaults, savePrefs, saveTeacherDefaults, THEMES, type Prefs, type TeacherDefaults } from '../lib/prefs'
import { AUTO_SYNC_AFTER_MS, useClassroomSync } from '../lib/useClassroomSync'

/**
 * Teacher settings: Google Classroom connection (manual Sync and Disconnect live here, beta item 4), appearance,
 * defaults for new lessons and assignments (kept on this device), and account.
 */
export function TeacherSettings() {
  const { profile, signOut } = useAuth()
  const noop = useCallback(() => {}, [])
  const classroom = useClassroomSync(noop)
  const mins = Math.round(AUTO_SYNC_AFTER_MS / 60000)
  const [prefs, setPrefs] = useState<Prefs>(() => readPrefs())
  const [defaults, setDefaults] = useState<TeacherDefaults>(() => readTeacherDefaults())
  const [saved, setSaved] = useState<'look' | 'defaults' | null>(null)
  const setLook = (patch: Partial<Prefs>) => {
    const next = { ...prefs, ...patch }
    setPrefs(next)
    savePrefs(next)
    setSaved('look')
  }
  const setDefault = (patch: Partial<TeacherDefaults>) => {
    const next = { ...defaults, ...patch }
    setDefaults(next)
    saveTeacherDefaults(next)
    setSaved('defaults')
  }

  return (
    <main className="page wide">
      <TeacherBar />
      <h1>Settings</h1>

      <section aria-labelledby="gc-h" className="card stack">
        <h2 id="gc-h">Google Classroom</h2>
        {classroom.connected === null &&
          (classroom.statusError ? (
            <div className="stack">
              <p className="error" role="status">Couldn't check your Google Classroom connection.</p>
              <button onClick={classroom.recheck}>Check again</button>
            </div>
          ) : (
            <p className="muted">Checking…</p>
          ))}
        {classroom.connected === false && (
          <>
            <p>Not connected. Your classes and students come from Google Classroom.</p>
            <button className="primary" onClick={classroom.connect}>Connect Google Classroom</button>
          </>
        )}
        {classroom.connected && (
          <>
            <p>
              Connected. Oasis re-reads your class lists every {mins} minutes while you have it open, and when you come back to it.
              {classroom.lastSyncedAt && (
                <span className="muted"> Last synced {new Date(classroom.lastSyncedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}.</span>
              )}
            </p>
            <div className="row">
              <button onClick={classroom.syncNow} disabled={classroom.busy}>{classroom.busy ? 'Syncing…' : 'Sync now'}</button>
              <button
                className="danger"
                onClick={() => {
                  if (window.confirm('Disconnect Google Classroom? Oasis stops syncing your classes and can’t make Classroom drafts or send grades until you connect again.'))
                    void classroom.disconnect()
                }}
                disabled={classroom.busy}
              >
                Disconnect
              </button>
            </div>
          </>
        )}
        {classroom.message && <p className={classroom.message.kind} role="status">{classroom.message.text}</p>}
      </section>

      <section aria-labelledby="look-h" className="card stack">
        <h2 id="look-h">Appearance</h2>
        <fieldset className="plain stack-tight">
          <legend className="sr-only">Theme</legend>
          <span className="label">Theme</span>
          <div className="row">
            {THEMES.map(([v, label]) => (
              <label key={v} className="check">
                <input type="radio" name="theme" checked={prefs.theme === v} onChange={() => setLook({ theme: v })} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="plain stack-tight">
          <legend className="sr-only">Text size</legend>
          <span className="label">Text size</span>
          <div className="row">
            {(['normal', 'large', 'larger'] as const).map((v) => (
              <label key={v} className="check">
                <input type="radio" name="text" checked={prefs.textSize === v} onChange={() => setLook({ textSize: v })} />
                {v === 'normal' ? 'Normal' : v === 'large' ? 'Large' : 'Larger'}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="check">
          <input type="checkbox" checked={prefs.reduceMotion} onChange={(e) => setLook({ reduceMotion: e.target.checked })} />
          Reduce motion
        </label>
        <p className="muted small" role="status" aria-live="polite">{saved === 'look' ? 'Saved on this device.' : 'Saved on this device as you change it.'}</p>
      </section>

      <section aria-labelledby="def-h" className="card stack">
        <h2 id="def-h">Defaults for new lessons</h2>
        <p className="muted small">Where every new lesson starts. You can still change each lesson in the builder. Lessons you already made don't change.</p>
        <label className="check">
          <input type="checkbox" checked={defaults.fullscreen} onChange={(e) => setDefault({ fullscreen: e.target.checked })} />
          Students must watch fullscreen
        </label>
        <label className="check">
          <input type="checkbox" checked={defaults.showFeedback} onChange={(e) => setDefault({ showFeedback: e.target.checked })} />
          Tell students right away if a choice answer was right
        </label>
        <label className="check">
          <input type="checkbox" checked={defaults.aiGrade} onChange={(e) => setDefault({ aiGrade: e.target.checked })} />
          Suggest grades for short answers with AI
        </label>
        <label className="stack-tight">
          Instructions for students when you assign <span className="muted small">(leave empty for the standard wording)</span>
          <textarea
            rows={3}
            maxLength={2000}
            placeholder={DEFAULT_INSTRUCTIONS}
            value={defaults.instructions}
            onChange={(e) => setDefault({ instructions: e.target.value })}
          />
        </label>
        <p className="muted small" role="status" aria-live="polite">{saved === 'defaults' ? 'Saved on this device.' : ''}</p>
      </section>

      <section aria-labelledby="acct-h" className="card stack">
        <h2 id="acct-h">Account</h2>
        <p>
          {profile?.name && <><b>{profile.name}</b><br /></>}
          <span className="muted">{profile?.email}</span>
        </p>
        <button onClick={signOut}>Sign out</button>
      </section>
    </main>
  )
}
