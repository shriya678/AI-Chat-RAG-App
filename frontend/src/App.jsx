import { useAuth } from './AuthContext';

export default function App() {
  const { user, loading } = useAuth();

  if (loading) return null;

  // Phase 4 will replace this with <AuthScreen />, Phase 5 with <ChatScreen />.
  return user ? (
    <div style={{ padding: 32 }}>Chat screen placeholder — logged in as {user.username}</div>
  ) : (
    <div style={{ padding: 32 }}>Auth screen placeholder — not logged in</div>
  );
}
