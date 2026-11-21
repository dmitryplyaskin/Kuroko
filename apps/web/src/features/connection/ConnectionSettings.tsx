import { ActionIcon, Autocomplete, Button, Group, Modal, NativeSelect, NumberInput, Stack, TextInput, Tooltip } from '@mantine/core';
import { ChevronDown, KeyRound } from 'lucide-react';
import { useUnit } from 'effector-react';
import { useCallback, useEffect, useRef, type SubmitEvent } from 'react';
import {
  connectionNameLimit, connectionParameterRanges, isModelId, isOptionalConnectionNumber, isProvider, providers,
} from '@kuroko/contracts/connectionSettings';
import { numericValue, type NumericField } from './connectionDraft';
import { ProviderKeysDialog } from './ProviderKeysDialog';
import {
  $connectionLoad, $connectionSelection, $keyManagerOpen, $keySubmission, $presetDeleteError, $presetDeleteOpen,
  $presetPending, $presetSubmission,
  connectionActionRequested, connectionClosed, connectionDraftChanged, connectionModelsRequested, connectionOpened,
  connectionProviderChanged, connectionRetryRequested, keyManagerClosed, keyManagerOpened, presetCopyRequested,
  presetDeleteClosed, presetDeleteOpened, presetSelected,
} from './model';
import { $modelCatalog } from './modelCatalog';
import './connectionSettings.css';

const providerOptions = Object.entries(providers).map(([value, { label }]) => ({ value, label }));
const formatter = new Intl.NumberFormat('ru');

export default function ConnectionSettings() {
  const {
    load, retry, selection, submission, deleteError, saving, catalog, selectPreset, copyPreset, updateDraft, changeProvider,
    perform, loadModels, keySubmission, open, close, keyManagerOpen, deleteOpen, openKeyManager,
    dismissKeyManager, openDelete, dismissDelete,
  } = useUnit({
    load: $connectionLoad, retry: connectionRetryRequested, selection: $connectionSelection, submission: $presetSubmission,
    deleteError: $presetDeleteError, saving: $presetPending, catalog: $modelCatalog, selectPreset: presetSelected,
    copyPreset: presetCopyRequested, updateDraft: connectionDraftChanged, changeProvider: connectionProviderChanged,
    perform: connectionActionRequested, loadModels: connectionModelsRequested, keySubmission: $keySubmission,
    open: connectionOpened, close: connectionClosed, keyManagerOpen: $keyManagerOpen, deleteOpen: $presetDeleteOpen,
    openKeyManager: keyManagerOpened, dismissKeyManager: keyManagerClosed, openDelete: presetDeleteOpened, dismissDelete: presetDeleteClosed,
  });
  const { presetId, selectedPreset, activePreset, draft, keyId, providerKeys } = selection;
  const keyManagerTrigger = useRef<HTMLButtonElement>(null);
  const presetName = useRef<HTMLInputElement>(null);
  const presetSelect = useRef<HTMLSelectElement>(null);
  const presetDelete = useRef<HTMLButtonElement>(null);

  const closeKeyManager = useCallback(() => {
    dismissKeyManager();
    requestAnimationFrame(() => keyManagerTrigger.current?.focus());
  }, [dismissKeyManager]);

  useEffect(() => {
    open();
    return () => { close(); };
  }, [open, close]);

  useEffect(() => {
    if (keySubmission.status === 'added') {
      const frame = requestAnimationFrame(() => keyManagerTrigger.current?.focus());
      return () => cancelAnimationFrame(frame);
    }
  }, [keySubmission]);

  useEffect(() => {
    if (submission.status === 'error' && submission.field === 'name') presetName.current?.focus();
    if (submission.status === 'deleted') {
      const frame = requestAnimationFrame(() => presetSelect.current?.focus());
      return () => cancelAnimationFrame(frame);
    }
  }, [submission]);

  if (load.status === 'error') {
    return (
      <div className="connection-feedback">
        <p role="alert">{load.message}</p>
        <Button variant="default" onClick={retry}>Повторить загрузку</Button>
      </div>
    );
  }
  if (load.status === 'loading') return <output>Загружаем настройки подключения…</output>;

  const { provider } = draft;
  const providerConfig = providers[provider];
  const ranges = connectionParameterRanges(provider);
  const models = catalog.status === 'ready' ? catalog.models : [];
  const model = models.find(({ id }) => id === draft.model.trim());
  const modelLimits = [
    model?.contextLimit && `Контекст целиком: ${formatter.format(model.contextLimit)}`,
    model?.inputLimit && `Ввод: ${formatter.format(model.inputLimit)}`,
    model?.outputLimit && `Ответ: ${formatter.format(model.outputLimit)}`,
  ].filter(Boolean).join(' · ');
  const loadingModels = catalog.status === 'loading';
  const keyOptions = [{ value: '', label: providerKeys.length ? 'Без ключа' : 'Нет сохранённых ключей' },
    ...providerKeys.map(({ id, name }) => ({ value: id, label: name }))];
  const presetOptions = [{ value: '', label: 'Новый пресет' }, ...load.data.presets.map(({ id, name }) => ({ value: id, label: name }))];

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    perform({ kind: 'savePreset' });
  }

  function closePresetDelete() {
    dismissDelete();
    requestAnimationFrame(() => presetDelete.current?.focus());
  }

  function numberField(field: NumericField, label: string, description: string) {
    const { min, max, integer } = ranges[field];
    const invalid = !isOptionalConnectionNumber(numericValue(draft[field]), ranges[field]);
    const range = integer ? `Введите целое число от ${min}.` : `Введите число от ${min} до ${max}.`;
    return <NumberInput label={label} description={description} value={draft[field]} placeholder="По умолчанию"
      min={min} max={max} step={integer ? 1 : 0.05} allowDecimal={!integer} allowNegative={false} clampBehavior="none" hideControls
      decimalSeparator="," allowedDecimalSeparators={[',', '.']}
      error={invalid ? range : undefined} onChange={(value) => updateDraft({ [field]: value })} />;
  }

  return (
    <>
      <form className="connection-form" onSubmit={submit}>
        <fieldset className="field-group connection-group connection-preset" disabled={saving}>
          <legend>Пресеты</legend>
          <div className="connection-preset-fields">
            <NativeSelect ref={presetSelect} label="Пресет" value={presetId} data={presetOptions}
              onChange={(event) => selectPreset(event.currentTarget.value)} />
            <TextInput ref={presetName} label="Название пресета" value={draft.name} required maxLength={connectionNameLimit}
              onChange={(event) => updateDraft({ name: event.currentTarget.value })} />
          </div>
          {selectedPreset && (
            <Group gap="xs">
              <Button type="button" variant="default" onClick={() => {
                copyPreset();
                presetName.current?.focus();
              }}>Создать копию</Button>
              <Button ref={presetDelete} type="button" variant="subtle" color="red" onClick={openDelete}>Удалить пресет</Button>
            </Group>
          )}
        </fieldset>
        <div className="connection-columns">
          <fieldset className="field-group connection-group" disabled={saving}>
            <legend>Провайдер и модель</legend>
            <NativeSelect label="Провайдер" value={provider} data={providerOptions} onChange={(event) => {
              const next = event.currentTarget.value;
              if (isProvider(next)) changeProvider(next);
            }} />
            <div className="connection-key-control">
              <NativeSelect label="API-ключ" value={keyId} data={keyOptions}
                onChange={(event) => updateDraft({ keyId: event.currentTarget.value })} />
              <Tooltip label={`Ключи ${providerConfig.label}`} events={{ hover: true, focus: true, touch: false }}>
                <ActionIcon ref={keyManagerTrigger} type="button" variant="default" size={44} aria-label={`Управлять ключами ${providerConfig.label}`}
                  aria-haspopup="dialog" onClick={openKeyManager}>
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
            <fieldset className="field-group connection-group" disabled={saving}>
              <legend>Лимиты токенов</legend>
              <div className="connection-fields">
                {numberField('contextTokens', 'Контекст', 'Сколько токенов можно передать модели.')}
                {numberField('responseTokens', 'Ответ', 'Сколько токенов модель может сгенерировать.')}
              </div>
            </fieldset>
            <fieldset className="field-group connection-group" disabled={saving}>
              <legend>Параметры генерации</legend>
              <p className="connection-hint">Пустые поля оставляют значения по умолчанию. Поддержка параметров зависит от модели.</p>
              <div className="connection-fields">
                {numberField('temperature', 'Температура', 'Управляет разбросом вариантов ответа.')}
                {numberField('topP', 'Top P', 'Ограничивает суммарную вероятность вариантов.')}
                {providerConfig.topK && numberField('topK', 'Top K', 'Сколько наиболее вероятных вариантов учитывать.')}
              </div>
            </fieldset>
          </div>
        </div>

        <div className="connection-actions">
          <div className="connection-action-status">
            {submission.status === 'error' && <p className="connection-error" role="alert">{submission.message}</p>}
            <output className="connection-hint">
              {submission.status === 'saved' || submission.status === 'deleted' ? submission.message : activePreset && `Активный пресет · ${activePreset.name}`}
            </output>
          </div>
          <Button type="submit" ms="auto" loading={saving && !deleteOpen} disabled={saving || loadingModels}>Сохранить пресет</Button>
        </div>
      </form>
      {keyManagerOpen && (
        <ProviderKeysDialog provider={provider} keys={providerKeys} onClose={closeKeyManager} />
      )}
      {deleteOpen && selectedPreset && (
        <Modal opened onClose={closePresetDelete} title="Удалить пресет?" returnFocus={false} transitionProps={{ transition: 'fade' }}
          closeButtonProps={{ 'aria-label': 'Закрыть', disabled: saving }} closeOnEscape={!saving} closeOnClickOutside={!saving}>
          <Stack gap="sm">
            <p className="connection-modal-copy">Пресет «{selectedPreset.name}» будет удалён.</p>
            {deleteError && <p className="connection-error" role="alert">{deleteError}</p>}
            <Group justify="flex-end">
              <Button data-autofocus variant="default" disabled={saving} onClick={closePresetDelete}>Отмена</Button>
              <Button color="red" loading={saving} onClick={() => perform({ kind: 'deletePreset' })}>Удалить пресет</Button>
            </Group>
          </Stack>
        </Modal>
      )}
    </>
  );
}
