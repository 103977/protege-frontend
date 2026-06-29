import { Navigate } from 'react-router-dom'
import { useAuth } from './useAuth'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { status, isAuthed } = useAuth()
  if (status === 'loading') return <div>Loading…</div>
  if (!isAuthed) return <Navigate to="/login" replace />
  return <>{children}</>
}
