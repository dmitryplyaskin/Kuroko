import { Button, Container, Paper, Stack, Text, Title } from '@mantine/core';
import { useState } from 'react';

const messages = {
  idle: '',
  checking: 'Проверяем соединение…',
  online: 'API доступен.',
  offline: 'Не удалось подключиться к API.',
};

export function App() {
  const [status, setStatus] = useState<keyof typeof messages>('idle');

  async function checkApi() {
    setStatus('checking');

    try {
      const response = await fetch('/api/health', { signal: AbortSignal.timeout(5000) });
      if (!response.ok) {
        setStatus('offline');
        return;
      }

      const body: unknown = await response.json();
      const isHealthy =
        typeof body === 'object' && body !== null && 'status' in body && body.status === 'ok';
      setStatus(isHealthy ? 'online' : 'offline');
    } catch {
      setStatus('offline');
    }
  }

  return (
    <Container component="main" size={560} py="xl">
      <Stack gap="lg">
        <Title order={1}>Kuroko</Title>
        <Paper withBorder p="lg" radius="md">
          <Stack align="flex-start" gap="sm">
            <Title order={2} size="h3">
              Статус API
            </Title>
            <Button onClick={checkApi} loading={status === 'checking'}>
              Проверить API
            </Button>
            <Text component="output" size="sm">
              {messages[status]}
            </Text>
          </Stack>
        </Paper>
      </Stack>
    </Container>
  );
}
