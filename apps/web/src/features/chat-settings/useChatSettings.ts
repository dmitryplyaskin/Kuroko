import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { defaultChatSettings, readChatSettings, sameChatSettings, type ChatSettings, type ChatSettingsResponse } from '@kuroko/contracts/chatSettings';
import { api, ApiError, errorMessage } from '../../shared/http/api';
import { notify } from '../../shared/notifications/notifications';

type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; settings: ChatSettings; fromBrowser: boolean };
type SaveState = { status: 'idle' | 'saving' } | { status: 'error'; message: string };

function readBrowserSettings() {
  try {
    const stored = window.localStorage.getItem('kuroko-chat-settings-v1');
    return stored ? readChatSettings(JSON.parse(stored)) : undefined;
  } catch {
    return undefined;
  }
}

export function useChatSettings(account: number, onSessionEnd: () => void) {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [draft, updateDraft] = useState(defaultChatSettings);
  const [submission, setSubmission] = useState<SaveState>({ status: 'idle' });
  const [attempt, setAttempt] = useState(0);
  const pendingSave = useRef<AbortController>(null);
  const applied = load.status === 'ready' ? load.settings : defaultChatSettings;
  const dirty = load.status === 'ready' && !sameChatSettings(draft, applied);

  useEffect(() => {
    const controller = new AbortController();
    api<ChatSettingsResponse>('/settings/chat', { account, signal: controller.signal }).then(({ settings }) => {
      if (controller.signal.aborted) return;
      const stored = settings === null ? readBrowserSettings() : undefined;
      setLoad({ status: 'ready', settings: settings ?? defaultChatSettings, fromBrowser: Boolean(stored) });
      updateDraft(settings ?? stored ?? defaultChatSettings);
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      if (error instanceof ApiError && error.status === 401) onSessionEnd();
      else setLoad({ status: 'error', message: errorMessage(error) });
    });
    return () => {
      controller.abort();
      pendingSave.current?.abort();
      pendingSave.current = null;
    };
  }, [account, attempt, onSessionEnd]);

  function retry() {
    setLoad({ status: 'loading' });
    setAttempt((count) => count + 1);
  }

  const setDraft: Dispatch<SetStateAction<ChatSettings>> = (value) => {
    if (pendingSave.current) return;
    setSubmission({ status: 'idle' });
    updateDraft(value);
  };

  async function save() {
    if (pendingSave.current || !dirty) return;
    const controller = new AbortController();
    pendingSave.current = controller;
    setSubmission({ status: 'saving' });
    try {
      const { settings } = await api<ChatSettingsResponse>('/settings/chat', {
        method: 'PUT', account, body: draft, signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (!settings) throw new Error('The server did not return the saved chat settings');
      setLoad({ status: 'ready', settings, fromBrowser: false });
      updateDraft(settings);
      setSubmission({ status: 'idle' });
      notify({ tone: 'success', message: 'Настройки чата сохранены' });
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof ApiError && error.status === 401) onSessionEnd();
      else setSubmission({ status: 'error', message: errorMessage(error) });
    } finally {
      if (pendingSave.current === controller) pendingSave.current = null;
    }
  }

  return { load, applied, draft, dirty, submission, setDraft, retry, save };
}
