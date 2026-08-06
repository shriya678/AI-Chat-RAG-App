import { createContext, useContext, useState, useEffect } from 'react';
import { api } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  // `loading` is true until we've checked sessionStorage on first mount.
  // Prevents a flash of the login screen for a user who is already logged in.
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const storedToken = sessionStorage.getItem('token');
    const storedUser = sessionStorage.getItem('user');
    if (storedToken && storedUser) {
      setToken(storedToken);
      setUser(JSON.parse(storedUser));
    }
    setLoading(false);
  }, []);

  function persist(data) {
    // Backend returns { token, username, id } as flat fields — build the user object here.
    const nextUser = { id: data.id, username: data.username };
    sessionStorage.setItem('token', data.token);
    sessionStorage.setItem('user', JSON.stringify(nextUser));
    setToken(data.token);
    setUser(nextUser);
  }

  async function login(email, password) {
    const data = await api.post('/api/auth/login', { email, password });
    persist(data);
  }

  async function register(username, email, password) {
    const data = await api.post('/api/auth/register', { username, email, password });
    persist(data);
  }

  function logout() {
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('user');
    setToken(null);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
