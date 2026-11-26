import type { ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import Brand from './Brand'
import '../student.css'

/** Student pages: To-do, Classes, Settings (beta item 3). The signed-in address lives in Settings, not up here. */
export function StudentShell({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth()
  const { pathname } = useLocation()
  return (
    <div className="student-home">
      <header className="s-top">
        <Brand />
        <nav className="s-nav" aria-label="Student">
          <NavLink to="/student" end>To-do</NavLink>
          <NavLink to="/student/classes">Classes</NavLink>
          <NavLink to="/student/settings">Settings</NavLink>
        </nav>
        <Link className="s-btn ghost" to={`/report?from=${encodeURIComponent(pathname)}`}>
          Report a bug
        </Link>
        {isAdmin && (
          <Link className="s-btn ghost" to="/admin">
            Admin
          </Link>
        )}
      </header>
      <main className="s-main">{children}</main>
    </div>
  )
}
