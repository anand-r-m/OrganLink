import { createContext, useCallback, useContext, useMemo, useState } from 'react';

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
  const [isAuthenticated, setIsAuthenticated] = useState(readStoredAuth);

  const login = useCallback((username, password) => {
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
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage unavailable — nothing persisted to clear */
    }
    setIsAuthenticated(false);
  }, []);

  const value = useMemo(
    () => ({ isAuthenticated, login, logout }),
    [isAuthenticated, login, logout],
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
