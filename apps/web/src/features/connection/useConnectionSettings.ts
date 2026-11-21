import { useEffect, useRef, useState } from 'react';
import type { ConnectionState, ProviderKey } from '@kuroko/contracts/connectionSettings';
import { ApiError, errorMessage } from '../../shared/http/api';
import { connectionApi } from './connectionApi';
import { createDraft, validateDraft, type ConnectionDraft } from './connectionDraft';
import { useModelCatalog } from './useModelCatalog';

type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: ConnectionState };
type Submission = { status: 'idle' | 'pending' } | { status: 'saved' | 'error'; message: string };

export function useConnectionSettings(account: number, onSessionEnd: () => void) {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [selectedId, setSelectedId] = useState<string>();
  const [drafts, setDrafts] = useState<Record<string, ConnectionDraft>>({});
  const [submission, setSubmission] = useState<Submission>({ status: 'idle' });
  const [deleteError, setDeleteError] = useState('');
  const pending = useRef(false);
  const { catalog, load: loadCatalog, reset: resetCatalog } = useModelCatalog(account, onSessionEnd);

  const data = load.status === 'ready' ? load.data : undefined;
  const presetId = selectedId ?? data?.activePresetId ?? '';
  const selectedPreset = data?.presets.find(({ id }) => id === presetId);
  const activePreset = data?.presets.find(({ id }) => id === data.activePresetId);
  const draft = drafts[presetId] ?? createDraft(selectedPreset);
  const providerKeys = data?.keys.filter(({ provider }) => provider === draft.provider) ?? [];
  const keyId = providerKeys.some(({ id }) => id === draft.keyId) ? draft.keyId : '';

  useEffect(() => {
    const controller = new AbortController();
    connectionApi.load(account, controller.signal).then((saved) => {
      if (!controller.signal.aborted) setLoad({ status: 'ready', data: saved });
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      if (error instanceof ApiError && error.status === 401) onSessionEnd();
      else setLoad({ status: 'error', message: errorMessage(error) });
    });
    return () => controller.abort();
  }, [account, attempt, onSessionEnd]);

  function retry() {
    setLoad({ status: 'loading' });
    setAttempt((count) => count + 1);
  }

  function updateDraft(change: Partial<ConnectionDraft>) {
    setDrafts((current) => ({ ...current, [presetId]: { ...draft, ...current[presetId], ...change } }));
    setSubmission({ status: 'idle' });
    if ('keyId' in change || 'provider' in change) resetCatalog();
  }

  function selectPreset(id: string) {
    setSelectedId(id);
    setSubmission({ status: 'idle' });
    resetCatalog();
  }

  function copyPreset() {
    setDrafts((current) => ({ ...current, '': { ...draft, name: '', keyId } }));
    selectPreset('');
  }

  function clearDraft(id: string) {
    setDrafts((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  async function save() {
    if (pending.current || catalog.status === 'loading') return;
    const result = validateDraft(draft, keyId);
    if ('error' in result) {
      setSubmission({ status: 'error', message: result.error });
      return result.field;
    }

    pending.current = true;
    setSubmission({ status: 'pending' });
    try {
      const saved = await connectionApi.savePreset(account, presetId, result.preset);
      setLoad({ status: 'ready', data: saved });
      setSelectedId(saved.activePresetId ?? '');
      clearDraft(presetId);
      setSubmission({ status: 'saved', message: 'Пресет сохранён.' });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onSessionEnd();
      else setSubmission({ status: 'error', message: errorMessage(error) });
    } finally {
      pending.current = false;
    }
  }

  async function removePreset() {
    if (!presetId || pending.current) return false;
    pending.current = true;
    setSubmission({ status: 'pending' });
    setDeleteError('');
    try {
      const saved = await connectionApi.deletePreset(account, presetId);
      clearDraft(presetId);
      setLoad({ status: 'ready', data: saved });
      selectPreset(saved.activePresetId ?? '');
      setSubmission({ status: 'saved', message: 'Пресет удалён.' });
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onSessionEnd();
      else setDeleteError(errorMessage(error));
      setSubmission({ status: 'idle' });
      return false;
    } finally {
      pending.current = false;
    }
  }

  function onKeyAdded(key: ProviderKey) {
    setLoad((current) => current.status === 'ready'
      ? { status: 'ready', data: { ...current.data, keys: [...current.data.keys, key] } }
      : current);
    updateDraft({ keyId: key.id });
  }

  function onKeyRemoved(saved: ConnectionState) {
    setLoad({ status: 'ready', data: saved });
    resetCatalog();
  }

  function loadModels() {
    if (!pending.current) return loadCatalog(draft.provider, keyId);
  }

  return {
    load, retry, presetId, selectedPreset, activePreset, draft, keyId, providerKeys, submission, deleteError,
    catalog, selectPreset, copyPreset, updateDraft, save, removePreset, loadModels, onKeyAdded, onKeyRemoved,
    clearDeleteError: () => setDeleteError(''),
  };
}
