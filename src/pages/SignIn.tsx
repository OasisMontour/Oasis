import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { peekClassroomIntent, useAuth } from '../auth/AuthProvider'
import { AccountError } from '../auth/AccountError'
import { rememberNext, takeNext } from '../lib/next'

export function SignIn() {
  const { loading, session, profile, profileError, signInWithGoogle, connectClassroom } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const from = (useLocation().state as { from?: string } | null)?.from

  // Google sign-in always returns to the site root, so park the deep link in sessionStorage until then.
  useEffect(() => rememberNext(from), [from])

  const signedIn = !loading && !!session && !!profile
  const redirected = useRef(false) // takeNext() clears the saved path, so only read it once
  useEffect(() => {
    if (!signedIn || !profile || redirected.current) return
    redirected.current = true
    // Back from a Classroom connect that Supabase sent to the Site URL instead of where we asked:
    // go where it was meant to land. That page reads (and clears) the intent.
    const intent = peekClassroomIntent()
    if (intent && session?.provider_refresh_token) return navigate(intent, { replace: true })
    navigate(takeNext(profile.role), { replace: true })
  }, [signedIn, profile, session, navigate])

  if (signedIn) return null
  if (!loading && session && !profile && profileError) return <AccountError />

  return (
    <main className="signin">
      <div className="signin-hero">
        <p className="signin-brand brand"><img src="/logo.svg" alt="" width={40} height={40} />Oasis</p>
        <p className="lede">Video lessons your students <em>actually watch.</em></p>
        <ul className="facts">
          <li>Questions pause the video. No skipping ahead.</li>
          <li>Assign and grade straight from Google Classroom.</li>
          <li>Bring your Edpuzzle lessons with you.</li>
        </ul>
        <svg className="waves" viewBox="0 0 600 120" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 70 q37.5 -22 75 0 t75 0 t75 0 t75 0 t75 0 t75 0 t75 0 t75 0 V120 H0 Z" fill="#0a5754" />
          <path d="M0 92 q37.5 -18 75 0 t75 0 t75 0 t75 0 t75 0 t75 0 t75 0 t75 0" fill="none" stroke="#9fe3d6" strokeWidth="5" strokeLinecap="round" />
        </svg>
      </div>
      <div className="signin-panel">
        <h1>Sign in</h1>
        <p className="muted">Use your school Google account.</p>
        <button
          className="primary"
          disabled={loading}
          onClick={() => signInWithGoogle().catch((e: Error) => setError(e.message))}
        >
          Sign in with Google
        </button>
        {error && (
          <p className="error" role="alert">
            Sign-in failed: {error}. If you're a student, your school may need to approve Oasis. Ask your teacher.
          </p>
        )}
        <hr className="divider" />
        <p className="small">
          Teacher, new to Oasis?{' '}
          <button className="link" disabled={loading} onClick={() => connectClassroom('/teacher/signup').catch((e: Error) => setError(e.message))}>
            Sign up with Google Classroom
          </button>
        </p>
        <p className="muted small">
          By signing in you agree to the <Link to="/terms">Terms of Use</Link> and <Link to="/privacy">Privacy Policy</Link>.
          Students: <Link to="/student-privacy">how Oasis uses your information</Link>.
        </p>
      </div>
    </main>
  )
}
