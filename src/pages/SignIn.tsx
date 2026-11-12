import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'

export function SignIn() {
  const { loading, session, profile, signInWithGoogle } = useAuth()
  const [error, setError] = useState<string | null>(null)

  if (!loading && session && profile) {
    return <Navigate to={profile.role === 'teacher' ? '/teacher' : '/student'} replace />
  }

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
    </main>
  )
}
