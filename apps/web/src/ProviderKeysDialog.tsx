import { Button, Group, Modal, Stack, TextInput } from '@mantine/core';
import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import {
  connectionNameLimit, isApiKey, providers, readConnectionName, type ConnectionState, type Provider, type ProviderKey,
} from '../../shared/connectionSettings';
import { api, ApiError, errorMessage } from './api';

export function ProviderKeysDialog({ account, provider, keys, onClose, onAdd, onRemove, onSessionEnd }: {
  account: number;
  provider: Provider;
  keys: ProviderKey[];
  onClose: () => void;
  onAdd: (key: ProviderKey) => void;
  onRemove: (state: ConnectionState) => void;
  onSessionEnd: () => void;
}) {
  const path = `/settings/connection/keys/${provider}`;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [deleting, setDeleting] = useState<ProviderKey>();
  const nameInput = useRef<HTMLInputElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const deleteTrigger = useRef<HTMLButtonElement>(null);

  useEffect(() => { if (deleting) cancel.current?.focus(); }, [deleting]);

  function handleError(failure: unknown) {
    if (failure instanceof ApiError && failure.status === 401) onSessionEnd();
    else setError(errorMessage(failure));
  }

  async function add(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || deleting) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const name = readConnectionName(fields.get('name'));
    const apiKey = String(fields.get('apiKey') ?? '').trim();
    if (!name || !isApiKey(apiKey) || name.includes(apiKey)) {
      setError('Укажите название ключа и введите API-ключ в отдельное поле.');
      return;
    }

    setPending(true);
    setError('');
    try {
      const saved = await api<ProviderKey>(path, { method: 'POST', account, body: { name, apiKey } });
      form.reset();
      onAdd(saved);
    } catch (failure) {
      handleError(failure);
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (!deleting || pending) return;
    setPending(true);
    setError('');
    try {
      const saved = await api<ConnectionState>(`${path}/${encodeURIComponent(deleting.id)}`, { method: 'DELETE', account });
      onRemove(saved);
      setDeleting(undefined);
      setNotice('Ключ удалён.');
      requestAnimationFrame(() => nameInput.current?.focus());
    } catch (failure) {
      handleError(failure);
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal opened onClose={onClose} title={`Ключи ${providers[provider].label}`} returnFocus={false} transitionProps={{ transition: 'fade' }}
      closeButtonProps={{ 'aria-label': 'Закрыть', disabled: pending }} closeOnEscape={!pending} closeOnClickOutside={!pending}>
      <Stack gap="lg">
        {keys.length > 0 && (
          <ul className="provider-key-list" aria-label="Сохранённые ключи">
            {keys.map((key) => (
              <li key={key.id}>
                <span>{key.name}</span>
                <Button type="button" variant="subtle" color="red" size="compact-sm" disabled={pending || Boolean(deleting)}
                  aria-label={`Удалить ключ ${key.name}`} onClick={(event) => {
                    deleteTrigger.current = event.currentTarget;
                    setDeleting(key);
                    setError('');
                    setNotice('');
                  }}>Удалить</Button>
              </li>
            ))}
          </ul>
        )}
        {deleting ? (
          <Stack gap="sm">
            <p className="connection-modal-copy">Удалить ключ «{deleting.name}»? В пресетах, где он выбран, привязка будет снята.</p>
            <Group justify="flex-end">
              <Button ref={cancel} variant="default" disabled={pending} onClick={() => {
                setDeleting(undefined);
                setError('');
                requestAnimationFrame(() => deleteTrigger.current?.focus());
              }}>Отмена</Button>
              <Button color="red" loading={pending} onClick={remove}>Удалить ключ</Button>
            </Group>
          </Stack>
        ) : (
          <form className="provider-key-form" method="post" onSubmit={add}>
            <TextInput ref={nameInput} data-autofocus label="Название ключа" name="name" required maxLength={connectionNameLimit}
              autoComplete="off" readOnly={pending} onChange={() => setError('')} />
            <TextInput type="password" label="API-ключ" name="apiKey" required description="Значение доступно только при вводе."
              autoComplete="off" spellCheck={false} autoCapitalize="none" maxLength={4096} readOnly={pending} onChange={() => setError('')} />
            <Group justify="flex-end"><Button type="submit" loading={pending}>Добавить ключ</Button></Group>
          </form>
        )}
        {error && <p role="alert" className="connection-error">{error}</p>}
        <output className="connection-hint">{notice}</output>
      </Stack>
    </Modal>
  );
}
