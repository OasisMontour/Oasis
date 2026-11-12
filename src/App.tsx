import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider'
import { RequireRole } from './auth/RequireRole'
import { SignIn } from './pages/SignIn'
import { TeacherHome } from './pages/TeacherHome'
import { StudentHome } from './pages/StudentHome'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<SignIn />} />
          <Route path="/teacher" element={<RequireRole role="teacher"><TeacherHome /></RequireRole>} />
          <Route path="/student" element={<RequireRole role="student"><StudentHome /></RequireRole>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
