import { Button, Group, Modal, Stack, TextInput } from '@mantine/core';
import { useUnit } from 'effector-react';
import { useEffect, useRef, type SubmitEvent } from 'react';
import { connectionNameLimit, providers, type Provider, type ProviderKey } from '@kuroko/contracts/connectionSettings';
import {
  $keyBeingDeleted, $keyPending, $keySubmission, connectionActionRequested, keyDeleteClosed, keyDeleteOpened, keyErrorCleared,
} from './model';

export function ProviderKeysDialog({ provider, keys, onClose }: {
  provider: Provider;
  keys: ProviderKey[];
  onClose: () => void;
}) {
  const [pending, feedback, perform, clearError, deleting, openDelete, dismissDelete] = useUnit([
    $keyPending, $keySubmission, connectionActionRequested, keyErrorCleared, $keyBeingDeleted, keyDeleteOpened, keyDeleteClosed,
  ]);
  const nameInput = useRef<HTMLInputElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const deleteTrigger = useRef<HTMLButtonElement>(null);

  useEffect(() => { if (deleting) cancel.current?.focus(); }, [deleting]);

  useEffect(() => {
    if (feedback.status === 'removed') {
      const frame = requestAnimationFrame(() => nameInput.current?.focus());
      return () => cancelAnimationFrame(frame);
    }
  }, [feedback]);

  function add(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (deleting) return;
    const fields = new FormData(event.currentTarget);
    perform({ kind: 'addKey', name: fields.get('name'), apiKey: fields.get('apiKey') });
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
                    openDelete(key);
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
                dismissDelete();
                clearError();
                requestAnimationFrame(() => deleteTrigger.current?.focus());
              }}>Отмена</Button>
              <Button color="red" loading={pending} onClick={() => perform({ kind: 'deleteKey', id: deleting.id })}>Удалить ключ</Button>
            </Group>
          </Stack>
        ) : (
          <form className="provider-key-form" method="post" onSubmit={add}>
            <TextInput ref={nameInput} data-autofocus label="Название ключа" name="name" required maxLength={connectionNameLimit}
              autoComplete="off" readOnly={pending} onChange={clearError} />
            <TextInput type="password" label="API-ключ" name="apiKey" required description="Значение доступно только при вводе."
              autoComplete="off" spellCheck={false} autoCapitalize="none" maxLength={4096} readOnly={pending} onChange={clearError} />
            <Group justify="flex-end"><Button type="submit" loading={pending}>Добавить ключ</Button></Group>
          </form>
        )}
        {feedback.status === 'error' && <p role="alert" className="connection-error">{feedback.message}</p>}
        <output className="connection-hint">{feedback.status === 'removed' && 'Ключ удалён.'}</output>
      </Stack>
    </Modal>
  );
}
