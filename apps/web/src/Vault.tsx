import { Button } from '@mantine/core';
import { ArrowUpRight, KeyRound, Plus } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api, ApiError, errorMessage, type SecretSummary, type User } from './api';
import { SecretDialog } from './SecretDialog';

type List = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; items: SecretSummary[] };
type Dialog = { secret?: SecretSummary; opener: HTMLButtonElement };

export function Vault({ user, onSessionEnd }: { user: User; onSessionEnd: () => void }) {
  const [list, setList] = useState<List>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [dialog, setDialog] = useState<Dialog>();
  const [notice, setNotice] = useState('');
  const addButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    api<SecretSummary[]>('/secrets', { account: user.id, signal: controller.signal }).then((items) => {
      if (!controller.signal.aborted) {
        setList({ status: 'ready', items });
      }
    }).catch((error: unknown) => {
      if (controller.signal.aborted) {
        return;
      }
      if (error instanceof ApiError && error.status === 401) {
        onSessionEnd();
      } else {
        setList({ status: 'error', message: errorMessage(error) });
      }
    });
    return () => controller.abort();
  }, [attempt, user.id, onSessionEnd]);

  useLayoutEffect(() => {
    if (!dialog && restoreFocus.current) {
      const target = restoreFocus.current.isConnected ? restoreFocus.current : addButton.current;
      target?.focus();
      restoreFocus.current = null;
    }
  }, [dialog]);

  function closeDialog() {
    restoreFocus.current = dialog?.opener ?? null;
    setDialog(undefined);
  }

  function saveSecret(saved: SecretSummary) {
    setList((current) => {
      if (current.status !== 'ready') {
        return current;
      }
      const items = dialog?.secret
        ? current.items.map((item) => item.id === saved.id ? saved : item)
        : [saved, ...current.items];
      return { status: 'ready', items };
    });
    setNotice(dialog?.secret ? 'Изменения сохранены.' : 'Секрет добавлен.');
    closeDialog();
  }

  function deleteSecret(id: string) {
    setList((current) => current.status === 'ready'
      ? { status: 'ready', items: current.items.filter((item) => item.id !== id) }
      : current);
    setNotice('Секрет удалён.');
    closeDialog();
  }

  function reload() {
    setList({ status: 'loading' });
    setAttempt(attempt + 1);
  }

  return (
    <>
      <header className="page-heading page-heading-with-action">
        <div>
          <h1 tabIndex={-1}>Мои секреты</h1>
          <p>Ключи API и токены для подключений.</p>
        </div>
        <Button
          ref={addButton}
          leftSection={<Plus size={17} aria-hidden="true" />}
          disabled={list.status !== 'ready'}
          onClick={(event) => { setNotice(''); setDialog({ opener: event.currentTarget }); }}
        >
          Добавить секрет
        </Button>
      </header>
      <output className="vault-status">{list.status === 'loading' ? 'Загружаем секреты…' : notice}</output>
      {list.status === 'error' && (
        <div className="vault-error">
          <p role="alert">{list.message}</p>
          <Button variant="default" onClick={reload}>Повторить</Button>
        </div>
      )}
      {list.status === 'ready' && (list.items.length === 0 ? (
        <div className="vault-empty">
          <span className="vault-key" aria-hidden="true"><KeyRound size={22} /></span>
          <h2>Здесь пока нет секретов</h2>
          <p>Добавьте ключ или токен, чтобы сохранить его в своём хранилище.</p>
        </div>
      ) : (
        <ul className="vault-list">
          {list.items.map((item) => (
            <li key={item.id}>
              <span className="vault-key" aria-hidden="true"><KeyRound size={17} /></span>
              <span className="vault-name">{item.name}</span>
              <Button
                variant="subtle"
                rightSection={<ArrowUpRight size={15} aria-hidden="true" />}
                aria-label={`Открыть секрет ${item.name}`}
                onClick={(event) => { setNotice(''); setDialog({ secret: item, opener: event.currentTarget }); }}
              >
                Открыть
              </Button>
            </li>
          ))}
        </ul>
      ))}
      {dialog && (
        <SecretDialog
          account={user.id}
          secret={dialog.secret}
          onClose={closeDialog}
          onSave={saveSecret}
          onDelete={deleteSecret}
          onSessionEnd={onSessionEnd}
        />
      )}
    </>
  );
}
