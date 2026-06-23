import { createContext, useEffect, useRef, useState } from 'react';
import { login as cognitoLogin, logout as cognitoLogout, refreshSession } from './CognitoAuth';

export const AuthContext = createContext(null);

const REFRESH_MARGIN_MS = 5 * 60 * 1000; // refresh 5 min before expiry

export function AuthProvider({ children }) {
  const [tokens, setTokens] = useState(null);
  const [status, setStatus] = useState('loading'); // 'loading' | 'authed' | 'anon'
  const refreshTimer = useRef(null);

  function scheduleRefresh(expiresAt) {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    const delay = Math.max(expiresAt - Date.now() - REFRESH_MARGIN_MS, 0);
    refreshTimer.current = setTimeout(async () => {
      const fresh = await refreshSession();
      if (fresh) {
        setTokens(fresh);
        scheduleRefresh(fresh.expiresAt);
      } else {
        setTokens(null);
        setStatus('anon');
      }
    }, delay);
  }

  useEffect(() => {
    (async () => {
      const restored = await refreshSession();
      if (restored) {
        setTokens(restored);
        setStatus('authed');
        scheduleRefresh(restored.expiresAt);
      } else {
        setStatus('anon');
      }
    })();
    return () => clearTimeout(refreshTimer.current);
  }, []);

  async function handleLogin(email, password) {
    const fresh = await cognitoLogin(email, password);
    setTokens(fresh);
    setStatus('authed');
    scheduleRefresh(fresh.expiresAt);
    return fresh;
  }

  function handleLogout() {
    clearTimeout(refreshTimer.current);
    cognitoLogout();
    setTokens(null);
    setStatus('anon');
  }

  const value = {
    status,
    isAuthed: status === 'authed',
    idToken: tokens?.idToken ?? null,
    login: handleLogin,
    logout: handleLogout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}