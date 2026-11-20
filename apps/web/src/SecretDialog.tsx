import { Button, Group, Modal, Stack, Text, Textarea, TextInput } from '@mantine/core';
import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { api, ApiError, errorMessage, type Secret, type SecretFields, type SecretSummary } from './api';

type Props = {
  account: number;
  secret?: SecretSummary;
  onClose: () => void;
  onSave: (secret: SecretSummary) => void;
  onDelete: (id: string) => void;
  onSessionEnd: () => void;
};

export function SecretDialog({ account, secret, onClose, onSave, onDelete, onSessionEnd }: Props) {
  const path = secret ? `/secrets/${encodeURIComponent(secret.id)}` : '/secrets';
  const [fields, setFields] = useState<SecretFields | null>(secret ? null : { name: '', value: '' });
  const [loadingError, setLoadingError] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const cancelDelete = useRef<HTMLButtonElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!secret) {
      return;
    }
    const controller = new AbortController();
    api<Secret>(path, { account, signal: controller.signal }).then(({ name, value }) => {
      if (!controller.signal.aborted) {
        setFields({ name, value });
      }
    }).catch((failure: unknown) => {
      if (controller.signal.aborted) {
        return;
      }
      if (failure instanceof ApiError && failure.status === 401) {
        onSessionEnd();
      } else {
        setLoadingError(errorMessage(failure));
      }
    });
    return () => controller.abort();
  }, [account, onSessionEnd, path, secret]);

  useEffect(() => {
    if (confirmDelete) {
      cancelDelete.current?.focus();
    }
  }, [confirmDelete]);

  function handleError(failure: unknown) {
    if (failure instanceof ApiError && failure.status === 401) {
      onSessionEnd();
    } else {
      setError(errorMessage(failure));
    }
  }

  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!fields || pending || confirmDelete) {
      return;
    }
    setPending(true);
    setError('');
    try {
      onSave(await api<SecretSummary>(path, { method: secret ? 'PUT' : 'POST', account, body: fields }));
    } catch (failure) {
      handleError(failure);
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (!secret || pending) {
      return;
    }
    setPending(true);
    setError('');
    try {
      await api<void>(path, { method: 'DELETE', account });
      onDelete(secret.id);
    } catch (failure) {
      handleError(failure);
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      opened
      onClose={onClose}
      title={secret ? 'Секрет' : 'Новый секрет'}
      withCloseButton
      closeButtonProps={{ 'aria-label': 'Закрыть', disabled: pending }}
      closeOnEscape={!pending}
      closeOnClickOutside={!pending}
      returnFocus={false}
    >
      {fields ? (
        <Stack renderRoot={(props) => <form {...props} onSubmit={save} />} gap="md">
          <TextInput
            data-autofocus={!secret || undefined}
            name="name"
            label="Название"
            autoComplete="off"
            required
            maxLength={120}
            value={fields.name}
            readOnly={pending || confirmDelete}
            onChange={(event) => setFields({ ...fields, name: event.currentTarget.value })}
          />
          <Textarea
            name="value"
            label="Значение"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            required
            maxLength={16_384}
            minRows={4}
            autosize
            maxRows={12}
            value={fields.value}
            readOnly={pending || confirmDelete}
            onChange={(event) => setFields({ ...fields, value: event.currentTarget.value })}
          />
          <div>
            <div role="alert">{error && <Text c="var(--kr-danger)" size="sm" mb="sm">{error}</Text>}</div>
            {confirmDelete ? (
              <Stack gap="sm">
                <Text size="sm">Удалить этот секрет? Восстановить его не получится.</Text>
                <Group>
                  <Button
                    ref={cancelDelete}
                    type="button"
                    variant="default"
                    disabled={pending}
                    onClick={() => {
                      setConfirmDelete(false);
                      setError('');
                      requestAnimationFrame(() => deleteButton.current?.focus());
                    }}
                  >
                    Отмена
                  </Button>
                  <Button type="button" color="red" onClick={remove} loading={pending}>Удалить секрет</Button>
                </Group>
              </Stack>
            ) : (
              <Group justify="space-between">
                <Button type="submit" loading={pending}>Сохранить</Button>
                {secret && (
                  <Button
                    ref={deleteButton}
                    type="button"
                    color="red"
                    variant="subtle"
                    disabled={pending}
                    onClick={() => { setError(''); setConfirmDelete(true); }}
                  >
                    Удалить
                  </Button>
                )}
              </Group>
            )}
          </div>
        </Stack>
      ) : (
        <div>
          <output>{!loadingError && <Text component="span" c="dimmed">Открываем секрет…</Text>}</output>
          <div role="alert">{loadingError && <Text c="var(--kr-danger)">{loadingError}</Text>}</div>
        </div>
      )}
    </Modal>
  );
}
