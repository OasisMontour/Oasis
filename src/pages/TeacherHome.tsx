import { useAuth } from '../auth/AuthProvider'

// Placeholder: dashboard, classes, and lesson builder land here next.
export function TeacherHome() {
  const { profile, signOut } = useAuth()
  return (
    <main className="page">
      <header className="bar">
        <strong>Oasis</strong>
        <span className="muted">{profile?.email}</span>
        <button onClick={signOut}>Sign out</button>
      </header>
      <h1>Welcome, {profile?.name || 'teacher'}</h1>
      <p className="muted">Classes and lessons are coming next.</p>
    </main>
  )
}
