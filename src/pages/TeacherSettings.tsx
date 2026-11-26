import { useCallback } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { TeacherBar } from '../components/TeacherBar'
import { AUTO_SYNC_AFTER_MS, useClassroomSync } from '../lib/useClassroomSync'

/** Teacher settings: Google Classroom connection (manual Sync and Disconnect live here, beta item 4) and account. */
export function TeacherSettings() {
  const { profile, signOut } = useAuth()
  const noop = useCallback(() => {}, [])
  const classroom = useClassroomSync(noop)
  const mins = Math.round(AUTO_SYNC_AFTER_MS / 60000)

  return (
    <main className="page wide">
      <TeacherBar />
      <h1>Settings</h1>

      <section aria-labelledby="gc-h" className="card stack">
        <h2 id="gc-h">Google Classroom</h2>
        {classroom.connected === null && <p className="muted">Checking…</p>}
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
