import { Routes, Route, useNavigate } from "react-router-dom";
import { LoginPage } from "./pages/LoginPage";
import { ChatPage } from "./pages/ChatPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { PublicOnlyRoute } from "./auth/PublicOnlyRoute";
import { useAuth } from "./auth/useAuth";

function App() {
  const navigate = useNavigate();
  const { login } = useAuth();

  async function handleLogin(email, password) {
    await login(email, password);
    setTimeout(() => navigate("/chat"), 900);
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicOnlyRoute>
            <LoginPage onLogin={handleLogin} />
          </PublicOnlyRoute>
        }
      />
      <Route
        path="/chat"
        element={
          <ProtectedRoute>
            <ChatPage />
          </ProtectedRoute>
        }
      />
      <Route 
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
      />
      <Route path="/" element={<LoginPage onLogin={handleLogin} />} />
    </Routes>
  );
}

export default App;