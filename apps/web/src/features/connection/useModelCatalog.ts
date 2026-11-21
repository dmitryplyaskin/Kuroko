import { useEffect, useRef, useState } from 'react';
import type { Provider, ProviderModel } from '@kuroko/contracts/connectionSettings';
import { ApiError, errorMessage } from '../../shared/http/api';
import { connectionApi } from './connectionApi';

type Catalog = { status: 'idle' | 'loading' } | { status: 'error'; message: string } | { status: 'ready'; models: ProviderModel[] };

export function useModelCatalog(account: number, onSessionEnd: () => void) {
  const [catalog, setCatalog] = useState<Catalog>({ status: 'idle' });
  const request = useRef<AbortController>(null);

  useEffect(() => () => request.current?.abort(), []);

  function reset() {
    request.current?.abort();
    request.current = null;
    setCatalog({ status: 'idle' });
  }

  async function load(provider: Provider, keyId: string) {
    if (request.current) return;
    if (!keyId) {
      setCatalog({ status: 'error', message: 'Выберите ключ или добавьте его в менеджере рядом с полем «API-ключ».' });
      return;
    }

    const controller = new AbortController();
    request.current = controller;
    setCatalog({ status: 'loading' });
    try {
      const { models } = await connectionApi.models(account, provider, keyId, controller.signal);
      if (!controller.signal.aborted) setCatalog({ status: 'ready', models });
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof ApiError && error.status === 401) onSessionEnd();
      else setCatalog({ status: 'error', message: errorMessage(error) });
    } finally {
      if (request.current === controller) request.current = null;
    }
  }

  return { catalog, load, reset };
}
