import { useEffect, useRef, useState } from 'react';
import { Button, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { Navigate, useNavigate } from 'react-router-dom';

import { useAuth } from '../context/AuthContext.jsx';

export default function LoginPage() {
  const { isAuthenticated, isLoading, login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isShaking, setIsShaking] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);
  const shakeTimerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (shakeTimerRef.current) {
        clearTimeout(shakeTimerRef.current);
      }
    };
  }, []);

  if (isLoading) {
    return null;
  }

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  async function handleSubmit(event) {
    event.preventDefault();

    // Clear previous shake state
    if (shakeTimerRef.current) {
      clearTimeout(shakeTimerRef.current);
    }
    setIsShaking(false);

    let ok = false;
    try {
      ok = await login(username, password);
    } catch {
      setError('Unable to reach the server');
      return;
    }
    if (ok) {
      setError('');
      navigate('/dashboard', { replace: true });
      return;
    }

    // On failed attempt, set exact error message and trigger shake animation
    setError('Invalid credentials');
    setShakeKey((prev) => prev + 1);
    setIsShaking(true);

    shakeTimerRef.current = setTimeout(() => {
      setIsShaking(false);
    }, 400);
  }

  return (
    <div className="login-page">
      <form
        key={shakeKey}
        onSubmit={handleSubmit}
        className={`login-card ${isShaking ? 'shake' : ''}`}
        aria-label="Sign in to OrganLink"
        noValidate={false}
      >
        <Stack gap="lg">
          <div>
            <Title order={1} style={{ color: '#ffffff', fontSize: 28, fontWeight: 700, letterSpacing: '-0.5px' }}>
              OrganLink
            </Title>
            <Text style={{ color: 'rgba(255, 255, 255, 0.75)', fontSize: 14, marginTop: 4 }}>
              Transplant Operations Hub
            </Text>
          </div>

          <TextInput
            label="Username"
            placeholder="Enter your username"
            value={username}
            onChange={(event) => setUsername(event.currentTarget.value)}
            aria-label="Username"
            autoComplete="username"
            className="login-input"
            required
          />

          <PasswordInput
            label="Password"
            placeholder="Enter your password"
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
            aria-label="Password"
            autoComplete="current-password"
            className="login-input"
            required
          />

          <Button type="submit" fullWidth h={48} className="login-button">
            Sign In
          </Button>

          {error ? (
            <div className="login-error" role="alert" aria-live="assertive">
              <IconAlertCircle size={18} aria-hidden="true" />
              <span>{error}</span>
            </div>
          ) : null}
        </Stack>
      </form>
    </div>
  );
}

