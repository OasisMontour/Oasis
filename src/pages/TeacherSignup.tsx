import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { takeClassroomIntent, useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { invokeFn } from '../lib/invokeFn'
import { pendingText, refusedText, type ClaimResponse, type MyRequest } from '../lib/teacherSignup'

// Teacher self sign-up. The browser only hands Google's token to the classroom function; the database decides
// whether this account becomes a teacher (verified by the school's Google admin, an approved school domain, or
// an Oasis admin). Nothing here can make anyone a teacher.
type View =
  | { kind: 'loading' }
  | { kind: 'start' }
  | { kind: 'working' }
  | { kind: 'pending'; reason: string | null }
  | { kind: 'refused'; reason: string }
  | { kind: 'error'; text: string }

export function TeacherSignup() {
  const { profile, session, connectClassroom, refreshProfile, signOut } = useAuth()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const [view, setView] = useState<View>({ kind: 'loading' })
  const started = useRef(false)

  useEffect(() => {
    if (profile?.role === 'teacher') navigate('/teacher', { replace: true })
  }, [profile, navigate])

  useEffect(() => {
    if (!profile || profile.role === 'teacher' || started.current) return
    started.current = true
    ;(async () => {
      const intent = takeClassroomIntent('/teacher/signup') && !!session?.provider_refresh_token
      if (params.get('classroom') === '1' || intent) {
        if (params.get('classroom')) setParams({}, { replace: true })
        const refresh = session?.provider_refresh_token
        if (!refresh) return setView({ kind: 'error', text: "Google didn't send back Classroom access. Try again." })
        setView({ kind: 'working' })
        // Same as connecting: drop Google's tokens from this browser first; the server keeps its own encrypted copy.
        await supabase.auth.refreshSession().catch(() => undefined)
        const { data, error } = await invokeFn<ClaimResponse>('classroom', { action: 'claim_teacher', refresh_token: refresh })
        if (error || !data) return setView({ kind: 'error', text: `Sign-up failed. ${error?.message ?? ''}`.trim() })
        if (!data.ok) {
          if (data.error === 'missing_scopes')
            return setView({ kind: 'error', text: 'Google Classroom access was only partly approved. Try again and tick every box on the Google screen.' })
          return setView({ kind: 'error', text: `Sign-up failed: ${data.error}` })
        }
        if (data.status === 'granted') {
          refreshProfile() // role is now teacher; the effect above moves to /teacher
          return
        }
        return setView(data.status === 'pending' ? { kind: 'pending', reason: data.reason } : { kind: 'refused', reason: data.reason })
      }
      const { data } = await supabase.rpc('my_teacher_request')
      const r = data as MyRequest | null
      if (r?.removed) setView({ kind: 'refused', reason: 'removed' })
      else if (r?.blocked) setView({ kind: 'refused', reason: 'blocked' })
      else if (r?.status === 'pending') setView({ kind: 'pending', reason: r.reason })
      else setView({ kind: 'start' })
    })()
  }, [profile, session, params, setParams, refreshProfile])

  const start = () => connectClassroom('/teacher/signup').catch((e: Error) => setView({ kind: 'error', text: e.message }))

  return (
    <main className="page signup">
      <header className="bar">
        <strong>Oasis</strong>
        <span className="muted">{profile?.email}</span>
        <button onClick={signOut}>Sign out</button>
      </header>
      <h1>Set up a teacher account</h1>

      {(view.kind === 'loading' || view.kind === 'working') && (
        <p className="muted" role="status">{view.kind === 'working' ? 'Checking your Google Classroom…' : 'Loading…'}</p>
      )}

      {view.kind === 'start' && (
        <div className="stack">
          <p>
            Oasis gets your classes and students from Google Classroom, and uses it to check you're a teacher. Click below, then
            approve Classroom access on Google's screen with <b>{profile?.email}</b>.
          </p>
          <p className="muted small">
            Oasis reads your class list and rosters, and posts assignments you create. It never sees your other Google data.
          </p>
          <p>
            <button className="primary" onClick={start}>Continue with Google Classroom</button>
          </p>
        </div>
      )}

      {view.kind === 'pending' && (
        <div className="card stack" role="status">
          <strong>Almost there. Your sign-up is waiting for a quick check.</strong>
          <p>{pendingText(view.reason)}</p>
          <p className="muted small">
            You don't need to do anything else. Once you're approved, sign in again and your classes import automatically.{' '}
            {view.reason === 'personal_account' && 'Or sign out and sign up with your school account.'}
          </p>
        </div>
      )}

      {view.kind === 'refused' && (
        <div className="card stack" role="alert">
          <strong>{view.reason === 'removed' ? 'Teacher access removed' : "Couldn't set up a teacher account"}</strong>
          <p>{refusedText(view.reason, profile?.email)}</p>
          {!['blocked', 'removed', 'student_account'].includes(view.reason) && (
            <p><button className="primary" onClick={start}>Try again</button></p>
          )}
        </div>
      )}

      {view.kind === 'error' && (
        <div className="stack">
          <p className="error" role="alert">{view.text}</p>
          <p><button className="primary" onClick={start}>Try again</button></p>
        </div>
      )}

      <p className="small">
        <Link to="/student">Not a teacher? Go to your assignments</Link> · <Link to="/report?from=%2Fteacher%2Fsignup">Report a bug</Link>
      </p>
    </main>
  )
}
