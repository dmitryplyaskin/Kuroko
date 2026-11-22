import { useI18n } from '../../shared/i18n/i18n';
import { ActionIcon, Autocomplete, Button, Group, Modal, NativeSelect, NumberInput, Stack, TextInput, Tooltip } from '@mantine/core';
import { ChevronDown, KeyRound } from 'lucide-react';
import { useUnit } from 'effector-react';
import { useCallback, useEffect, useRef, type SubmitEvent } from 'react';
import {
  connectionNameLimit, connectionParameterRanges, customUrlLimit, isModelId, isOptionalConnectionNumber, isProvider, providers, readCustomBaseUrl,
} from '@kuroko/contracts/connectionSettings';
import { numericValue, type NumericField } from './connectionDraft';
import { ProviderKeysDialog } from './ProviderKeysDialog';
import {
  $connectionLoad, $connectionSelection, $keyManagerOpen, $keySubmission, $presetDeleteError, $presetDeleteOpen,
  $presetPending, $presetSubmission,
  connectionActionRequested, connectionDraftChanged, connectionEndpointsRequested, connectionModelsRequested, connectionTabClosed,
  connectionProviderChanged, connectionRetryRequested, keyManagerClosed, keyManagerOpened, presetCopyRequested,
  presetDeleteClosed, presetDeleteOpened, presetSelected,
} from './model';
import { $modelCatalog, $openRouterEndpoints } from './modelCatalog';
import './connectionSettings.css';

const providerOptions = Object.entries(providers).map(([value, { label }]) => ({ value, label }));

export default function ConnectionSettings() {
  const { t, number, decimalSeparator } = useI18n();
  const {
    load, retry, selection, submission, deleteError, saving, catalog, selectPreset, copyPreset, updateDraft, changeProvider,
    perform, loadModels, endpoints, loadEndpoints, keySubmission, closeTab, keyManagerOpen, deleteOpen, openKeyManager,
    dismissKeyManager, openDelete, dismissDelete,
  } = useUnit({
    load: $connectionLoad, retry: connectionRetryRequested, selection: $connectionSelection, submission: $presetSubmission,
    deleteError: $presetDeleteError, saving: $presetPending, catalog: $modelCatalog, selectPreset: presetSelected,
    copyPreset: presetCopyRequested, updateDraft: connectionDraftChanged, changeProvider: connectionProviderChanged,
    perform: connectionActionRequested, loadModels: connectionModelsRequested, keySubmission: $keySubmission,
    endpoints: $openRouterEndpoints, loadEndpoints: connectionEndpointsRequested,
    closeTab: connectionTabClosed, keyManagerOpen: $keyManagerOpen, deleteOpen: $presetDeleteOpen,
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

  useEffect(() => closeTab, [closeTab]);

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
        <p role="alert">{t(`error.${load.code}`)}</p>
        <Button variant="default" onClick={retry}>{t('common.retryLoad')}</Button>
      </div>
    );
  }
  if (load.status === 'loading') return <output>{t('connection.loading')}</output>;

  const { provider } = draft;
  const providerConfig = providers[provider];
  const providerLabel = provider === 'custom' ? t('connection.custom') : providerConfig.label;
  const ranges = connectionParameterRanges(provider);
  const models = catalog.status === 'ready' ? catalog.models : [];
  const model = models.find(({ id }) => id === draft.model.trim());
  const modelLimits = [
    model?.contextLimit && t('connection.contextLimit', { count: number.format(model.contextLimit) }),
    model?.inputLimit && t('connection.inputLimit', { count: number.format(model.inputLimit) }),
    model?.outputLimit && t('connection.outputLimit', { count: number.format(model.outputLimit) }),
  ].filter(Boolean).join(' · ');
  const loadingModels = catalog.status === 'loading';
  const loadingEndpoints = endpoints.status === 'loading';
  const routes = endpoints.status === 'ready' ? endpoints.endpoints : [];
  const routeOptions = [{ value: '', label: t('connection.openrouterAutomatic') },
    ...routes.map(({ tag, name }) => ({ value: tag, label: `${name} (${tag})` }))];
  if (draft.openrouterProvider && !routes.some(({ tag }) => tag === draft.openrouterProvider)) {
    routeOptions.push({ value: draft.openrouterProvider, label: draft.openrouterProvider });
  }
  const keyOptions = [{ value: '', label: providerKeys.length ? t('connection.noKey') : t('connection.noSavedKeys') },
    ...providerKeys.map(({ id, name }) => ({ value: id, label: name }))];
  const presetOptions = [{ value: '', label: t('connection.newPreset') }, ...load.data.presets.map(({ id, name }) => ({ value: id, label: name }))];

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
    const error = invalid ? t(integer ? 'error.number_integer_min' : 'error.number_range', {
      min: number.format(min), max: number.format(max),
    }) : undefined;
    return <NumberInput label={label} description={description} value={draft[field]} placeholder={t('connection.defaultValue')}
      min={min} max={max} step={integer ? 1 : 0.05} allowDecimal={!integer} allowNegative={false} clampBehavior="none" hideControls
      decimalSeparator={decimalSeparator} allowedDecimalSeparators={[',', '.']}
      error={error} onChange={(value) => updateDraft({ [field]: value })} />;
  }

  return (
    <>
      <form className="connection-form" onSubmit={submit}>
        <fieldset className="field-group connection-group connection-preset" disabled={saving}>
          <legend>{t('connection.presets')}</legend>
          <div className="connection-preset-fields">
            <NativeSelect ref={presetSelect} label={t('connection.preset')} value={presetId} data={presetOptions}
              onChange={(event) => selectPreset(event.currentTarget.value)} />
            <TextInput ref={presetName} label={t('connection.presetName')} value={draft.name} required maxLength={connectionNameLimit}
              onChange={(event) => updateDraft({ name: event.currentTarget.value })} />
          </div>
          {selectedPreset && (
            <Group gap="xs">
              <Button type="button" variant="default" onClick={() => {
                copyPreset();
                presetName.current?.focus();
              }}>{t('connection.copyPreset')}</Button>
              <Button ref={presetDelete} type="button" variant="subtle" color="red" onClick={openDelete}>{t('connection.deletePreset')}</Button>
            </Group>
          )}
        </fieldset>
        <div className="connection-columns">
          <fieldset className="field-group connection-group" disabled={saving}>
            <legend>{t('connection.providerAndModel')}</legend>
            <NativeSelect label={t('connection.provider')} value={provider}
              data={providerOptions.map((option) => option.value === 'custom' ? { ...option, label: t('connection.custom') } : option)} onChange={(event) => {
              const next = event.currentTarget.value;
              if (isProvider(next)) changeProvider(next);
            }} />
            {provider === 'custom' && (
              <TextInput type="url" required label={t('connection.baseUrl')} description={t('connection.baseUrlHint')}
                placeholder="https://example.com/v1" value={draft.baseUrl} maxLength={customUrlLimit} spellCheck={false}
                error={draft.baseUrl && !readCustomBaseUrl(draft.baseUrl) ? t('error.custom_api_url_invalid') : undefined}
                onChange={(event) => updateDraft({ baseUrl: event.currentTarget.value })} />
            )}
            <div className="connection-key-control">
              <NativeSelect label={t('common.apiKey')} value={keyId} data={keyOptions}
                onChange={(event) => updateDraft({ keyId: event.currentTarget.value })} />
              <Tooltip label={t('connection.providerKeys', { provider: providerLabel })} events={{ hover: true, focus: true, touch: false }}>
                <ActionIcon ref={keyManagerTrigger} type="button" variant="default" size={44} aria-label={t('connection.manageKeys', { provider: providerLabel })}
                  aria-haspopup="dialog" onClick={openKeyManager}>
                  <KeyRound size={19} aria-hidden="true" />
                </ActionIcon>
              </Tooltip>
            </div>
            <Autocomplete label={t('common.model')} required description={models.length
              ? t('connection.modelListHint') : t('connection.modelIdHint')}
              maxLength={256} autoComplete="off" spellCheck={false} value={draft.model}
              data={models.map(({ id }) => id)} limit={60} rightSectionPointerEvents="none"
              rightSection={models.length ? <ChevronDown size={15} aria-hidden="true" /> : undefined}
              error={Boolean(draft.model.trim()) && !isModelId(draft.model.trim()) ? t('error.model_id_invalid') : undefined}
              onChange={(value) => updateDraft({ model: value })} />
            {modelLimits && <p className="connection-hint">{t('connection.modelLimits', { limits: modelLimits })}</p>}
            <div className="connection-catalog">
              <Button type="button" variant="default" loading={loadingModels} onClick={loadModels}>
                {models.length ? t('connection.refreshModels') : t('connection.loadModels')}
              </Button>
              {catalog.status === 'error' && <p className="connection-error" role="alert">{t(`error.${catalog.code}`)}</p>}
              <output className="connection-hint">
                {loadingModels && t('connection.loadingModels')}
                {catalog.status === 'ready' && (models.length
                  ? t('connection.modelsFound', { count: number.format(models.length) })
                  : t('connection.noModels'))}
              </output>
            </div>
            {provider === 'openrouter' && (
              <div className="connection-group">
                <NativeSelect label={t('connection.openrouterProvider')} value={draft.openrouterProvider} data={routeOptions}
                  onChange={(event) => updateDraft({ openrouterProvider: event.currentTarget.value })} />
                <div className="connection-catalog">
                  <Button type="button" variant="default" loading={loadingEndpoints} onClick={loadEndpoints}>
                    {t('connection.loadOpenrouterProviders')}
                  </Button>
                  {endpoints.status === 'error' && <p className="connection-error" role="alert">{t(`error.${endpoints.code}`)}</p>}
                  <output className="connection-hint">
                    {loadingEndpoints && t('common.loading')}
                    {endpoints.status === 'ready' && !routes.length && t('connection.noOpenrouterProviders')}
                  </output>
                </div>
              </div>
            )}
          </fieldset>

          <div className="connection-parameters">
            <fieldset className="field-group connection-group" disabled={saving}>
              <legend>{t('connection.tokenLimits')}</legend>
              <div className="connection-fields">
                {numberField('contextTokens', t('connection.context'), t('connection.contextHint'))}
                {numberField('responseTokens', t('connection.response'), t('connection.responseHint'))}
              </div>
            </fieldset>
            <fieldset className="field-group connection-group" disabled={saving}>
              <legend>{t('connection.generation')}</legend>
              <p className="connection-hint">{t('connection.generationHint')}</p>
              <div className="connection-fields">
                {numberField('temperature', t('connection.temperature'), t('connection.temperatureHint'))}
                {numberField('topP', t('connection.topP'), t('connection.topPHint'))}
                {providerConfig.topK && numberField('topK', t('connection.topK'), t('connection.topKHint'))}
              </div>
            </fieldset>
          </div>
        </div>

        <div className="connection-actions">
          <div className="connection-action-status">
            {submission.status === 'error' && <p className="connection-error" role="alert">{t(`error.${submission.code}`)}</p>}
            <output className="connection-hint">
              {submission.status === 'saved' || submission.status === 'deleted'
                ? t(submission.status === 'saved' ? 'connection.presetSaved' : 'connection.presetDeleted')
                : activePreset && t('connection.activePreset', { name: activePreset.name })}
            </output>
          </div>
          <Button type="submit" ms="auto" loading={saving && !deleteOpen} disabled={saving || loadingModels || loadingEndpoints}>{t('connection.savePreset')}</Button>
        </div>
      </form>
      {keyManagerOpen && (
        <ProviderKeysDialog provider={provider} keys={providerKeys} onClose={closeKeyManager} />
      )}
      {deleteOpen && selectedPreset && (
        <Modal opened onClose={closePresetDelete} title={t('connection.confirmPresetDelete')} returnFocus={false} transitionProps={{ transition: 'fade' }}
          closeButtonProps={{ 'aria-label': t('common.close'), disabled: saving }} closeOnEscape={!saving} closeOnClickOutside={!saving}>
          <Stack gap="sm">
            <p className="connection-modal-copy">{t('connection.presetDeleteWarning', { name: selectedPreset.name })}</p>
            {deleteError && <p className="connection-error" role="alert">{t(`error.${deleteError}`)}</p>}
            <Group justify="flex-end">
              <Button data-autofocus variant="default" disabled={saving} onClick={closePresetDelete}>{t('common.cancel')}</Button>
              <Button color="red" loading={saving} onClick={() => perform({ kind: 'deletePreset' })}>{t('connection.deletePreset')}</Button>
            </Group>
          </Stack>
        </Modal>
      )}
    </>
  );
}
