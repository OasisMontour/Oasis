import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider'
import { RequireRole, RequireSignedIn } from './auth/RequireRole'
import { RequireAdmin } from './auth/RequireAdmin'
import { SignIn } from './pages/SignIn'
import { TeacherHome } from './pages/TeacherHome'
import { StudentHome } from './pages/StudentHome'
import { StudentPlayer } from './pages/StudentPlayer'
import { LessonBuilder } from './pages/LessonBuilder'
import { AssignmentResults } from './pages/AssignmentResults'
import { AdminHome } from './pages/AdminHome'
import { ReportBug } from './pages/ReportBug'
import { Changelog } from './pages/Changelog'
import { LegalFooter } from './components/LegalFooter'
import { LEGAL_DOCS, type LegalDocId } from './legal/docs'

const Legal = lazy(() => import('./pages/Legal'))

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<SignIn />} />
          {/* Any signed-in account; the server decides whether it becomes a teacher. */}
          <Route path="/teacher/signup" element={<RequireSignedIn><TeacherSignup /></RequireSignedIn>} />
          <Route path="/teacher" element={<RequireRole role="teacher"><TeacherHome /></RequireRole>} />
          <Route path="/teacher/lessons/new" element={<RequireRole role="teacher"><LessonBuilder /></RequireRole>} />
          <Route path="/teacher/lessons/:id" element={<RequireRole role="teacher"><LessonBuilder /></RequireRole>} />
          <Route path="/teacher/assignments/:id" element={<RequireRole role="teacher"><AssignmentResults /></RequireRole>} />
          <Route path="/student" element={<RequireRole role="student"><StudentHome /></RequireRole>} />
          {/* Google Classroom posts link here (supabase/functions/_shared/classroomHandler.ts studentAssignmentUrl). */}
          <Route path="/student/assignments/:id" element={<RequireRole role="student"><StudentPlayer /></RequireRole>} />
          <Route path="/admin" element={<RequireAdmin><AdminHome /></RequireAdmin>} />
          <Route path="/report" element={<RequireSignedIn><ReportBug /></RequireSignedIn>} />
          <Route path="/changelog" element={<RequireSignedIn><Changelog /></RequireSignedIn>} />
          {/* Legal pages are public: no sign-in. */}
          {(Object.keys(LEGAL_DOCS) as LegalDocId[]).map((id) => (
            <Route
              key={id}
              path={LEGAL_DOCS[id].path}
              element={
                <Suspense fallback={<p className="muted center">Loading…</p>}>
                  <Legal doc={id} />
                </Suspense>
              }
            />
          ))}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <LegalFooter />
      </BrowserRouter>
    </AuthProvider>
  )
}
