import { Link, NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import Brand from './Brand'

/** Header for teacher pages: Lessons, Settings, Report a bug (always visible), Admin, Sign out. */
export function TeacherBar() {
  const { isAdmin, signOut } = useAuth()
  const { pathname } = useLocation()
  return (
    <header className="bar teacher-bar">
      <Brand />
      <nav aria-label="Teacher" className="tnav">
        <NavLink to="/teacher" end>Home</NavLink>
        <NavLink to="/teacher/settings">Settings</NavLink>
      </nav>
      <Link to={`/report?from=${encodeURIComponent(pathname)}`}>Report a bug</Link>
      {isAdmin && <Link className="button" to="/admin">Admin</Link>}
      <button onClick={signOut}>Sign out</button>
    </header>
  )
}
