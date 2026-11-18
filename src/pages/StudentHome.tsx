import { useAuth } from '../auth/AuthProvider'

// Classes come from the teacher's Google Classroom roster, so there's nothing to join.
// Assignments list lands here with the student player.
export function StudentHome() {
  const { profile, signOut } = useAuth()
  return (
    <main className="page">
      <header className="bar">
        <strong>Oasis</strong>
        <span className="muted">{profile?.email}</span>
        <button onClick={signOut}>Sign out</button>
      </header>
      <h1>Hi, {profile?.name || 'there'}</h1>
      <p className="muted">Your assignments will show up here. Your classes come from Google Classroom, so there's nothing to join.</p>
    </main>
  )
}
