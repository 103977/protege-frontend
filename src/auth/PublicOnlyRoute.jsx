import { Navigate } from 'react-router-dom';
import { useAuth } from './useAuth';

export function PublicOnlyRoute({ children }) {
  const { status, isAuthed } = useAuth();

  if (status === 'loading') {
    return <div>Loading…</div>;
  }
  if (isAuthed) {
    return <Navigate to="/chat" replace />;
  }
  return children;
}