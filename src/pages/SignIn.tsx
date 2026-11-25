import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { peekClassroomIntent, useAuth } from '../auth/AuthProvider'
import { rememberNext, takeNext } from '../lib/next'

export function SignIn() {
  const { loading, session, profile, signInWithGoogle, connectClassroom } = useAuth()
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

  return (
    <main className="signin">
      <h1>Oasis</h1>
      <p className="muted">Video lessons your students actually watch.</p>
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
      <p className="muted small">Use your school Google account.</p>
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
    </main>
  )
}
