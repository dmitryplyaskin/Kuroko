import { ActionIcon, Autocomplete, Button, Group, Modal, NativeSelect, NumberInput, Stack, TextInput, Tooltip } from '@mantine/core';
import { ChevronDown, KeyRound } from 'lucide-react';
import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import {
  connectionNameLimit, defaultConnectionSettings, isModelId, isProvider, providers, readConnectionName, readConnectionSettings,
  type ConnectionPreset, type ConnectionSettings as Settings, type ConnectionState, type Provider, type ProviderModel,
} from '../../shared/connectionSettings';
import { api, ApiError, errorMessage } from './api';
import { ProviderKeysDialog } from './ProviderKeysDialog';
import './connectionSettings.css';

const path = '/settings/connection';
const providerOptions = Object.entries(providers).map(([value, { label }]) => ({ value, label }));
const formatter = new Intl.NumberFormat('ru');

type NumericField = Exclude<keyof Settings, 'model'>;
type NumericValue = number | string;
type Draft = Record<NumericField, NumericValue> & { name: string; provider: Provider; model: string; keyId: string };
type Catalog = { status: 'idle' | 'loading' } | { status: 'error'; message: string } | { status: 'ready'; models: ProviderModel[] };
type Submission = { status: 'idle' | 'pending' } | { status: 'saved' | 'error'; message: string };

function createDraft(preset?: ConnectionPreset): Draft {
  const settings = preset ?? defaultConnectionSettings;
  return {
    name: preset?.name ?? '',
    provider: preset?.provider ?? 'openai',
    model: settings.model,
    keyId: preset?.keyId ?? '',
    contextTokens: settings.contextTokens ?? '',
    responseTokens: settings.responseTokens ?? '',
    temperature: settings.temperature ?? '',
    topP: settings.topP ?? '',
    topK: settings.topK ?? '',
  };
}

function numericValue(value: NumericValue) {
  return value === '' ? null : Number(value);
}

export default function ConnectionSettings({ account, onSessionEnd }: { account: number; onSessionEnd: () => void }) {
  const [state, setState] = useState<ConnectionState>();
  const [attempt, setAttempt] = useState(0);
  const [loadError, setLoadError] = useState('');
  const [selectedId, setSelectedId] = useState<string>();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [keyManagerOpen, setKeyManagerOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [submission, setSubmission] = useState<Submission>({ status: 'idle' });
  const [catalog, setCatalog] = useState<Catalog>({ status: 'idle' });
  const catalogRequest = useRef<AbortController>(null);
  const keyManagerTrigger = useRef<HTMLButtonElement>(null);
  const presetName = useRef<HTMLInputElement>(null);
  const presetSelect = useRef<HTMLSelectElement>(null);
  const presetDelete = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    api<ConnectionState>(path, { account, signal: controller.signal }).then((saved) => {
      if (!controller.signal.aborted) setState(saved);
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      if (error instanceof ApiError && error.status === 401) onSessionEnd();
      else setLoadError(errorMessage(error));
    });
    return () => controller.abort();
  }, [account, attempt, onSessionEnd]);

  useEffect(() => () => catalogRequest.current?.abort(), []);

  if (loadError) {
    return (
      <div className="connection-feedback">
        <p role="alert">{loadError}</p>
        <Button variant="default" onClick={() => { setLoadError(''); setAttempt(attempt + 1); }}>Повторить загрузку</Button>
      </div>
    );
  }
  if (!state) return <output>Загружаем настройки подключения…</output>;

  const presetId = selectedId ?? state.activePresetId ?? '';
  const selectedPreset = state.presets.find(({ id }) => id === presetId);
  const activePreset = state.presets.find(({ id }) => id === state.activePresetId);
  const draft = drafts[presetId] ?? createDraft(selectedPreset);
  const { provider } = draft;
  const providerConfig = providers[provider];
  const models = catalog.status === 'ready' ? catalog.models : [];
  const model = models.find(({ id }) => id === draft.model.trim());
  const modelLimits = [
    model?.contextLimit && `Контекст целиком: ${formatter.format(model.contextLimit)}`,
    model?.inputLimit && `Ввод: ${formatter.format(model.inputLimit)}`,
    model?.outputLimit && `Ответ: ${formatter.format(model.outputLimit)}`,
  ].filter(Boolean).join(' · ');
  const saving = submission.status === 'pending';
  const loadingModels = catalog.status === 'loading';
  const providerKeys = state.keys.filter((key) => key.provider === provider);
  const keyId = providerKeys.some(({ id }) => id === draft.keyId) ? draft.keyId : '';
  const keyOptions = [{ value: '', label: providerKeys.length ? 'Без ключа' : 'Нет сохранённых ключей' },
    ...providerKeys.map(({ id, name }) => ({ value: id, label: name }))];
  const presetOptions = [{ value: '', label: 'Новый пресет' }, ...state.presets.map(({ id, name }) => ({ value: id, label: name }))];

  function resetCatalog() {
    catalogRequest.current?.abort();
    setCatalog({ status: 'idle' });
  }

  function updateDraft(change: Partial<Draft>) {
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
    presetName.current?.focus();
  }

  async function loadModels() {
    if (loadingModels || saving) return;
    if (!keyId) {
      setCatalog({ status: 'error', message: 'Выберите ключ или добавьте его в менеджере рядом с полем «API-ключ».' });
      return;
    }
    const controller = new AbortController();
    catalogRequest.current = controller;
    setCatalog({ status: 'loading' });
    try {
      const { models } = await api<{ models: ProviderModel[] }>(`${path}/models`, {
        method: 'POST', account, body: { provider, keyId }, signal: controller.signal,
      });
      if (!controller.signal.aborted) setCatalog({ status: 'ready', models });
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof ApiError && error.status === 401) onSessionEnd();
      else setCatalog({ status: 'error', message: errorMessage(error) });
    } finally {
      if (catalogRequest.current === controller) catalogRequest.current = null;
    }
  }

  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || loadingModels) return;
    const name = readConnectionName(draft.name);
    if (!name) {
      setSubmission({ status: 'error', message: 'Введите название пресета длиной до 120 символов.' });
      presetName.current?.focus();
      return;
    }
    const settings = readConnectionSettings(provider, {
      model: draft.model.trim(),
      contextTokens: numericValue(draft.contextTokens),
      responseTokens: numericValue(draft.responseTokens),
      temperature: numericValue(draft.temperature),
      topP: numericValue(draft.topP),
      topK: numericValue(draft.topK),
    });
    if (!settings) {
      setSubmission({ status: 'error', message: 'Проверьте ID модели и значения в полях генерации и лимитов.' });
      return;
    }
    setSubmission({ status: 'pending' });
    try {
      const saved = await api<ConnectionState>(presetId ? `${path}/presets/${encodeURIComponent(presetId)}` : `${path}/presets`, {
        method: presetId ? 'PUT' : 'POST', account, body: { name, provider, settings, keyId: keyId || null },
      });
      setState(saved);
      setSelectedId(saved.activePresetId ?? '');
      clearDraft(presetId);
      setSubmission({ status: 'saved', message: 'Пресет сохранён.' });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onSessionEnd();
      else setSubmission({ status: 'error', message: errorMessage(error) });
    }
  }

  function clearDraft(id: string) {
    setDrafts((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  async function removePreset() {
    if (!presetId || saving) return;
    setSubmission({ status: 'pending' });
    setDeleteError('');
    try {
      const saved = await api<ConnectionState>(`${path}/presets/${encodeURIComponent(presetId)}`, { method: 'DELETE', account });
      clearDraft(presetId);
      setState(saved);
      selectPreset(saved.activePresetId ?? '');
      setDeleteOpen(false);
      setSubmission({ status: 'saved', message: 'Пресет удалён.' });
      requestAnimationFrame(() => presetSelect.current?.focus());
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onSessionEnd();
      else setDeleteError(errorMessage(error));
      setSubmission({ status: 'idle' });
    }
  }

  function closePresetDelete() {
    setDeleteOpen(false);
    requestAnimationFrame(() => presetDelete.current?.focus());
  }

  function closeKeyManager() {
    setKeyManagerOpen(false);
    requestAnimationFrame(() => keyManagerTrigger.current?.focus());
  }

  function numberField(field: NumericField, label: string, min: number, max: number, step: number, description?: string) {
    const number = numericValue(draft[field]);
    const integer = step === 1;
    const invalid = number !== null && (!Number.isFinite(number) || number < min || number > max || (integer && !Number.isSafeInteger(number)));
    const range = integer ? `Введите целое число от ${min}.` : `Введите число от ${min} до ${max}.`;
    return <NumberInput label={label} description={description} value={draft[field]} placeholder="По умолчанию"
      min={min} max={max} step={step} allowDecimal={!integer} allowNegative={false} clampBehavior="none" hideControls
      decimalSeparator="," allowedDecimalSeparators={[',', '.']}
      error={invalid ? range : undefined} onChange={(value) => updateDraft({ [field]: value })} />;
  }

  return (
    <>
      <form className="connection-form" onSubmit={save}>
        <fieldset className="appearance-group connection-group connection-preset" disabled={saving}>
          <legend>Пресеты</legend>
          <div className="connection-preset-fields">
            <NativeSelect ref={presetSelect} label="Пресет" value={presetId} data={presetOptions}
              onChange={(event) => selectPreset(event.currentTarget.value)} />
            <TextInput ref={presetName} label="Название пресета" value={draft.name} required maxLength={connectionNameLimit}
              onChange={(event) => updateDraft({ name: event.currentTarget.value })} />
          </div>
          {selectedPreset && (
            <Group gap="xs">
              <Button type="button" variant="default" onClick={copyPreset}>Создать копию</Button>
              <Button ref={presetDelete} type="button" variant="subtle" color="red" onClick={() => {
                setDeleteError('');
                setDeleteOpen(true);
              }}>Удалить пресет</Button>
            </Group>
          )}
        </fieldset>
        <div className="connection-columns">
          <fieldset className="appearance-group connection-group" disabled={saving}>
            <legend>Провайдер и модель</legend>
            <NativeSelect label="Провайдер" value={provider} data={providerOptions} onChange={(event) => {
              const next = event.currentTarget.value;
              if (isProvider(next) && next !== provider) {
                updateDraft({ provider: next, model: '', keyId: '', topK: providers[next].topK ? draft.topK : '' });
              }
            }} />
            <div className="connection-key-control">
              <NativeSelect label="API-ключ" value={keyId} data={keyOptions}
                onChange={(event) => updateDraft({ keyId: event.currentTarget.value })} />
              <Tooltip label={`Ключи ${providerConfig.label}`} events={{ hover: true, focus: true, touch: false }}>
                <ActionIcon ref={keyManagerTrigger} type="button" variant="default" aria-label={`Управлять ключами ${providerConfig.label}`}
                  aria-haspopup="dialog" onClick={() => setKeyManagerOpen(true)}>
                  <KeyRound size={19} aria-hidden="true" />
                </ActionIcon>
              </Tooltip>
            </div>
            <Autocomplete label="Модель" required description={models.length
              ? 'Выберите модель из списка или введите её ID вручную.' : 'Введите ID модели или загрузите список у провайдера.'}
              maxLength={256} autoComplete="off" spellCheck={false} value={draft.model}
              data={models.map(({ id }) => id)} limit={60} rightSectionPointerEvents="none"
              rightSection={models.length ? <ChevronDown size={15} aria-hidden="true" /> : undefined}
              error={Boolean(draft.model.trim()) && !isModelId(draft.model.trim()) ? 'Проверьте написание ID модели.' : undefined}
              onChange={(value) => updateDraft({ model: value })} />
            {modelLimits && <p className="connection-hint">Лимиты модели в токенах · {modelLimits}</p>}
            <div className="connection-catalog">
              <Button type="button" variant="default" loading={loadingModels} onClick={loadModels}>
                {models.length ? 'Обновить список моделей' : 'Загрузить модели'}
              </Button>
              {catalog.status === 'error' && <p className="connection-error" role="alert">{catalog.message}</p>}
              <output className="connection-hint">
                {loadingModels && 'Запрашиваем список у провайдера…'}
                {catalog.status === 'ready' && (models.length
                  ? `Найдено моделей: ${formatter.format(models.length)}.`
                  : 'Провайдер вернул пустой список. Введите ID модели вручную.')}
              </output>
            </div>
          </fieldset>

          <div className="connection-parameters">
            <fieldset className="appearance-group connection-group" disabled={saving}>
              <legend>Лимиты токенов</legend>
              <div className="connection-fields">
                {numberField('contextTokens', 'Контекст', 1, Number.MAX_SAFE_INTEGER, 1, 'Сколько токенов можно передать модели.')}
                {numberField('responseTokens', 'Ответ', 1, Number.MAX_SAFE_INTEGER, 1, 'Сколько токенов модель может сгенерировать.')}
              </div>
            </fieldset>
            <fieldset className="appearance-group connection-group" disabled={saving}>
              <legend>Параметры генерации</legend>
              <p className="connection-hint">Пустые поля оставляют значения по умолчанию. Поддержка параметров зависит от модели.</p>
              <div className="connection-fields">
                {numberField('temperature', 'Температура', 0, providerConfig.temperatureMax, 0.05, 'Управляет разбросом вариантов ответа.')}
                {numberField('topP', 'Top P', 0, 1, 0.05, 'Ограничивает суммарную вероятность вариантов.')}
                {providerConfig.topK && numberField('topK', 'Top K', 1, Number.MAX_SAFE_INTEGER, 1, 'Сколько наиболее вероятных вариантов учитывать.')}
              </div>
            </fieldset>
          </div>
        </div>

        <div className="connection-actions">
          <div className="connection-action-status">
            {submission.status === 'error' && <p className="connection-error" role="alert">{submission.message}</p>}
            <output className="connection-hint">
              {submission.status === 'saved' ? submission.message : activePreset && `Активный пресет · ${activePreset.name}`}
            </output>
          </div>
          <Button type="submit" loading={saving && !deleteOpen} disabled={saving || loadingModels}>Сохранить пресет</Button>
        </div>
      </form>
      {keyManagerOpen && (
        <ProviderKeysDialog account={account} provider={provider} keys={providerKeys} onSessionEnd={onSessionEnd}
          onClose={closeKeyManager}
          onAdd={(key) => {
            setState((current) => current && { ...current, keys: [...current.keys, key] });
            updateDraft({ keyId: key.id });
            closeKeyManager();
          }}
          onRemove={(saved) => {
            setState(saved);
            resetCatalog();
          }} />
      )}
      {deleteOpen && selectedPreset && (
        <Modal opened onClose={closePresetDelete} title="Удалить пресет?" returnFocus={false} transitionProps={{ transition: 'fade' }}
          closeButtonProps={{ 'aria-label': 'Закрыть', disabled: saving }} closeOnEscape={!saving} closeOnClickOutside={!saving}>
          <Stack gap="sm">
            <p className="connection-modal-copy">Пресет «{selectedPreset.name}» будет удалён.</p>
            {deleteError && <p className="connection-error" role="alert">{deleteError}</p>}
            <Group justify="flex-end">
              <Button data-autofocus variant="default" disabled={saving} onClick={closePresetDelete}>Отмена</Button>
              <Button color="red" loading={saving} onClick={removePreset}>Удалить пресет</Button>
            </Group>
          </Stack>
        </Modal>
      )}
    </>
  );
}
