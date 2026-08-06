import { useAuth } from './AuthContext';
import AuthScreen from './components/AuthScreen';

export default function App() {
  const { user, loading } = useAuth();

  if (loading) return null;

  // Phase 5 will replace this chat placeholder with <ChatScreen />.
  return user ? (
    <div style={{ padding: 32 }}>Chat screen placeholder — logged in as {user.username}</div>
  ) : (
    <AuthScreen />
  );
}
