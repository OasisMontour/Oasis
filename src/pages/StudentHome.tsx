import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'

export function StudentHome() {
  const { profile, signOut } = useAuth()
  const [code, setCode] = useState('')
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const join = async (e: FormEvent) => {
    e.preventDefault()
    setStatus(null)
    const { error } = await supabase.rpc('join_class', { code })
    if (error) setStatus({ kind: 'error', text: error.message === 'no class with that code' ? 'No class has that code. Check it with your teacher.' : error.message })
    else {
      setStatus({ kind: 'ok', text: 'You joined the class.' })
      setCode('')
    }
  }

  return (
    <main className="page">
      <header className="bar">
        <strong>Oasis</strong>
        <span className="muted">{profile?.email}</span>
        <button onClick={signOut}>Sign out</button>
      </header>
      <h1>Hi, {profile?.name || 'there'}</h1>
      <form className="join" onSubmit={join}>
        <label htmlFor="join-code">Class code</label>
        <input
          id="join-code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={6}
          autoComplete="off"
          placeholder="ABC123"
        />
        <button className="primary" disabled={code.length !== 6}>Join class</button>
      </form>
      {status && <p className={status.kind} role="status">{status.text}</p>}
      <p className="muted">Your assignments will show up here.</p>
    </main>
  )
}
