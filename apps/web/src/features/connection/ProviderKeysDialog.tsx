import { useI18n } from '../../shared/i18n/i18n';
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
  const { t } = useI18n();
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
    <Modal opened onClose={onClose} title={t('connection.providerKeys', { provider: provider === 'custom' ? t('connection.custom') : providers[provider].label })} returnFocus={false} transitionProps={{ transition: 'fade' }}
      closeButtonProps={{ 'aria-label': t('common.close'), disabled: pending }} closeOnEscape={!pending} closeOnClickOutside={!pending}>
      <Stack gap="lg">
        {keys.length > 0 && (
          <ul className="provider-key-list" aria-label={t('connection.savedKeys')}>
            {keys.map((key) => (
              <li key={key.id}>
                <span>{key.name}</span>
                <Button type="button" variant="subtle" color="red" size="compact-sm" disabled={pending || Boolean(deleting)}
                  aria-label={t('connection.deleteKeyNamed', { name: key.name })} onClick={(event) => {
                    deleteTrigger.current = event.currentTarget;
                    openDelete(key);
                  }}>{t('common.delete')}</Button>
              </li>
            ))}
          </ul>
        )}
        {deleting ? (
          <Stack gap="sm">
            <p className="connection-modal-copy">{t('connection.keyDeleteWarning', { name: deleting.name })}</p>
            <Group justify="flex-end">
              <Button ref={cancel} variant="default" disabled={pending} onClick={() => {
                dismissDelete();
                clearError();
                requestAnimationFrame(() => deleteTrigger.current?.focus());
              }}>{t('common.cancel')}</Button>
              <Button color="red" loading={pending} onClick={() => perform({ kind: 'deleteKey', id: deleting.id })}>{t('connection.deleteKey')}</Button>
            </Group>
          </Stack>
        ) : (
          <form className="provider-key-form" method="post" onSubmit={add}>
            <TextInput ref={nameInput} data-autofocus label={t('connection.keyName')} name="name" required maxLength={connectionNameLimit}
              autoComplete="off" readOnly={pending} onChange={clearError} />
            <TextInput type="password" label={t('common.apiKey')} name="apiKey" required description={t('connection.keyHint')}
              autoComplete="off" spellCheck={false} autoCapitalize="none" maxLength={4096} readOnly={pending} onChange={clearError} />
            <Group justify="flex-end"><Button type="submit" loading={pending}>{t('connection.addKey')}</Button></Group>
          </form>
        )}
        {feedback.status === 'error' && <p role="alert" className="connection-error">{t(`error.${feedback.code}`)}</p>}
        <output className="connection-hint">{feedback.status === 'removed' && t('connection.keyRemoved')}</output>
      </Stack>
    </Modal>
  );
}
