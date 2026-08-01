import { useState } from 'react';
import { Button, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core';
import { Navigate, useNavigate } from 'react-router-dom';

import { useAuth } from '../context/AuthContext.jsx';

/* Phase 0 placeholder — owned by Dev 3 (Task 3.1).
   Minimal form so the documented auth redirect can be verified. */
export default function LoginPage() {
  const { isAuthenticated, login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (login(username, password)) {
      navigate('/dashboard', { replace: true });
      return;
    }
    setError('Invalid credentials');
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        padding: 'var(--space-24)',
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="neu-raised"
        style={{ width: 420, padding: 'var(--space-40)' }}
        aria-label="Sign in to OrganLink"
      >
        <Stack gap="md">
          <div>
            <Title order={1} c="var(--color-primary)">
              OrganLink
            </Title>
            <Text c="dimmed">Transplant Operations Hub</Text>
          </div>

          <TextInput
            label="Username"
            value={username}
            onChange={(event) => setUsername(event.currentTarget.value)}
            aria-label="Username"
            autoComplete="username"
          />
          <PasswordInput
            label="Password"
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
            aria-label="Password"
            autoComplete="current-password"
          />

          <Button type="submit" fullWidth h={48} aria-label="Sign in">
            Sign In
          </Button>

          {error ? (
            <Text c="var(--color-danger)" role="alert">
              {error}
            </Text>
          ) : null}
        </Stack>
      </form>
    </div>
  );
}
