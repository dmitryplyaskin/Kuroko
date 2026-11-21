import { ActionIcon, Autocomplete, Button, Group, Modal, NativeSelect, NumberInput, Stack, TextInput, Tooltip } from '@mantine/core';
import { ChevronDown, KeyRound } from 'lucide-react';
import { useRef, useState, type SubmitEvent } from 'react';
import {
  connectionNameLimit, connectionParameterRanges, isModelId, isOptionalConnectionNumber, isProvider, providers,
} from '@kuroko/contracts/connectionSettings';
import { numericValue, type NumericField } from './connectionDraft';
import { ProviderKeysDialog } from './ProviderKeysDialog';
import { useConnectionSettings } from './useConnectionSettings';
import './connectionSettings.css';

const providerOptions = Object.entries(providers).map(([value, { label }]) => ({ value, label }));
const formatter = new Intl.NumberFormat('ru');

export default function ConnectionSettings({ account, onSessionEnd }: { account: number; onSessionEnd: () => void }) {
  const {
    load, retry, presetId, selectedPreset, activePreset, draft, keyId, providerKeys, submission, deleteError,
    catalog, selectPreset, copyPreset, updateDraft, save, removePreset, loadModels, onKeyAdded, onKeyRemoved, clearDeleteError,
  } = useConnectionSettings(account, onSessionEnd);
  const [keyManagerOpen, setKeyManagerOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const keyManagerTrigger = useRef<HTMLButtonElement>(null);
  const presetName = useRef<HTMLInputElement>(null);
  const presetSelect = useRef<HTMLSelectElement>(null);
  const presetDelete = useRef<HTMLButtonElement>(null);

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
  const saving = submission.status === 'pending';
  const loadingModels = catalog.status === 'loading';
  const keyOptions = [{ value: '', label: providerKeys.length ? 'Без ключа' : 'Нет сохранённых ключей' },
    ...providerKeys.map(({ id, name }) => ({ value: id, label: name }))];
  const presetOptions = [{ value: '', label: 'Новый пресет' }, ...load.data.presets.map(({ id, name }) => ({ value: id, label: name }))];

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await save() === 'name') presetName.current?.focus();
  }

  async function confirmPresetDelete() {
    if (!await removePreset()) return;
    setDeleteOpen(false);
    requestAnimationFrame(() => presetSelect.current?.focus());
  }

  function closePresetDelete() {
    setDeleteOpen(false);
    requestAnimationFrame(() => presetDelete.current?.focus());
  }

  function closeKeyManager() {
    setKeyManagerOpen(false);
    requestAnimationFrame(() => keyManagerTrigger.current?.focus());
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
              <Button ref={presetDelete} type="button" variant="subtle" color="red" onClick={() => {
                clearDeleteError();
                setDeleteOpen(true);
              }}>Удалить пресет</Button>
            </Group>
          )}
        </fieldset>
        <div className="connection-columns">
          <fieldset className="field-group connection-group" disabled={saving}>
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
                <ActionIcon ref={keyManagerTrigger} type="button" variant="default" size={44} aria-label={`Управлять ключами ${providerConfig.label}`}
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
              {submission.status === 'saved' ? submission.message : activePreset && `Активный пресет · ${activePreset.name}`}
            </output>
          </div>
          <Button type="submit" ms="auto" loading={saving && !deleteOpen} disabled={saving || loadingModels}>Сохранить пресет</Button>
        </div>
      </form>
      {keyManagerOpen && (
        <ProviderKeysDialog account={account} provider={provider} keys={providerKeys} onSessionEnd={onSessionEnd}
          onClose={closeKeyManager}
          onAdd={(key) => {
            onKeyAdded(key);
            closeKeyManager();
          }}
          onRemove={onKeyRemoved} />
      )}
      {deleteOpen && selectedPreset && (
        <Modal opened onClose={closePresetDelete} title="Удалить пресет?" returnFocus={false} transitionProps={{ transition: 'fade' }}
          closeButtonProps={{ 'aria-label': 'Закрыть', disabled: saving }} closeOnEscape={!saving} closeOnClickOutside={!saving}>
          <Stack gap="sm">
            <p className="connection-modal-copy">Пресет «{selectedPreset.name}» будет удалён.</p>
            {deleteError && <p className="connection-error" role="alert">{deleteError}</p>}
            <Group justify="flex-end">
              <Button data-autofocus variant="default" disabled={saving} onClick={closePresetDelete}>Отмена</Button>
              <Button color="red" loading={saving} onClick={confirmPresetDelete}>Удалить пресет</Button>
            </Group>
          </Stack>
        </Modal>
      )}
    </>
  );
}
