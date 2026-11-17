import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider'
import { RequireRole } from './auth/RequireRole'
import { SignIn } from './pages/SignIn'
import { TeacherHome } from './pages/TeacherHome'
import { StudentHome } from './pages/StudentHome'
import { LessonBuilder } from './pages/LessonBuilder'
import { AssignmentResults } from './pages/AssignmentResults'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<SignIn />} />
          <Route path="/teacher" element={<RequireRole role="teacher"><TeacherHome /></RequireRole>} />
          <Route path="/teacher/lessons/new" element={<RequireRole role="teacher"><LessonBuilder /></RequireRole>} />
          <Route path="/teacher/lessons/:id" element={<RequireRole role="teacher"><LessonBuilder /></RequireRole>} />
          <Route path="/teacher/assignments/:id" element={<RequireRole role="teacher"><AssignmentResults /></RequireRole>} />
          <Route path="/student" element={<RequireRole role="student"><StudentHome /></RequireRole>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
