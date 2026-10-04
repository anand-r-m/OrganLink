import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { USE_LIVE_API, apiFetch } from '../api/client.js';

const STORAGE_KEY = 'organlink.auth';

/* Hardcoded credentials — ui_mastercontext.md Section 5.1 */
const VALID_USERNAME = 'admin';
const VALID_PASSWORD = 'admin';

const AuthContext = createContext(null);

function readStoredAuth() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function AuthProvider({ children }) {
  // Mock mode: hardcoded admin/admin + localStorage flag. Live mode: server session, restored via /me.
  const [isAuthenticated, setIsAuthenticated] = useState(USE_LIVE_API ? false : readStoredAuth);
  const [isLoading, setIsLoading] = useState(USE_LIVE_API);

  useEffect(() => {
    if (!USE_LIVE_API) return undefined;
    let cancelled = false;
    apiFetch('/auth/me')
      .then(() => !cancelled && setIsAuthenticated(true))
      .catch(() => !cancelled && setIsAuthenticated(false))
      .finally(() => !cancelled && setIsLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  // Resolves true on success, false on bad credentials; other failures (network, 5xx) reject.
  const login = useCallback(async (username, password) => {
    if (USE_LIVE_API) {
      try {
        await apiFetch('/auth/login', { method: 'POST', body: { username, password } });
      } catch (err) {
        if (err.status === 401 || err.status === 400) return false;
        throw err;
      }
      setIsAuthenticated(true);
      return true;
    }
    if (username !== VALID_USERNAME || password !== VALID_PASSWORD) {
      return false;
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, 'true');
    } catch {
      /* storage unavailable — session stays in memory only */
    }
    setIsAuthenticated(true);
    return true;
  }, []);

  const logout = useCallback(() => {
    if (USE_LIVE_API) {
      // Clear local state even if the server call fails (e.g. session already expired).
      apiFetch('/auth/logout', { method: 'POST' }).catch(() => {});
      setIsAuthenticated(false);
      return;
    }
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage unavailable — nothing persisted to clear */
    }
    setIsAuthenticated(false);
  }, []);

  const value = useMemo(
    () => ({ isAuthenticated, isLoading, login, logout }),
    [isAuthenticated, isLoading, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside an <AuthProvider>');
  }
  return context;
}

export default AuthContext;
