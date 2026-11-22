import { ActionIcon, Button, Switch, TextInput } from '@mantine/core';
import { toolIds, type ToolId } from '@kuroko/contracts/tools';
import { useUnit } from 'effector-react';
import { ChevronDown, Power, Search, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { useI18n } from '../../shared/i18n/i18n';
import { tools } from './catalog';
import { $toolSettings, toolSettingChanged, toolSettingsChangeFx, toolSettingsRetried } from './model';
import { PresetControls } from '../../shared/presets/PresetControls';
import './toolManager.css';

export default function ToolManager() {
  const { t, locale, number } = useI18n();
  const { settings, toggle, change, retry } = useUnit({
    settings: $toolSettings, toggle: toolSettingChanged, change: toolSettingsChangeFx, retry: toolSettingsRetried,
  });
  const [search, setSearch] = useState('');
  const searchInput = useRef<HTMLInputElement>(null);
  const query = search.trim().normalize('NFKC').toLocaleLowerCase(locale);
  const terms = query.split(/\s+/);
  const visible = query ? toolIds.filter((id) => {
    const tool = tools[id];
    const text = `${t(tool.label)} ${id} ${t(tool.description)}`.normalize('NFKC').toLocaleLowerCase(locale);
    return terms.every((term) => text.includes(term));
  }) : toolIds;
  const disabled = settings.status !== 'ready';

  function clearSearch() {
    setSearch('');
    searchInput.current?.focus();
  }

  return (
    <section className="tool-manager" aria-labelledby="tools-title">
      <header className="page-heading">
        <h1 id="tools-title" tabIndex={-1}>{t('tools.label')}</h1>
        <p>{t('tools.description')}</p>
      </header>
      <PresetControls presets={settings.presets} selectedId={settings.activePresetId} disabled={disabled}
        onAction={async (action) => Boolean(await change(action))} />
      {settings.status === 'loading' && <output className="tool-manager-status">{t('tools.loading')}</output>}
      {settings.error && (
        <div className="tool-manager-status">
          <p role="alert">{t(`error.${settings.error}`)}</p>
          {settings.status === 'loadError' && <Button variant="default" onClick={retry}>{t('common.retryLoad')}</Button>}
        </div>
      )}
      <div className="tool-manager-panel">
        <div className="tool-manager-toolbar">
          <TextInput ref={searchInput} type="search" className="tool-manager-search" value={search} aria-label={t('tools.search')}
            placeholder={t('tools.search')} onChange={(event) => setSearch(event.currentTarget.value)}
            leftSection={<Search size={16} aria-hidden="true" />}
            rightSection={search && <ActionIcon variant="subtle" color="gray" aria-label={t('tools.clearSearch')} onClick={clearSearch}>
              <X size={16} aria-hidden="true" />
            </ActionIcon>} />
          <div className="tool-manager-actions">
            <output className="tool-manager-count">{t('tools.enabledCount', {
              enabled: number.format(settings.enabled.length), total: number.format(toolIds.length),
            })}</output>
            <Button variant="default" disabled={disabled || !settings.enabled.length} leftSection={<Power size={16} aria-hidden="true" />}
              onClick={() => void change({ kind: 'clear' }).catch(() => {})}>{t('tools.disableAll')}</Button>
          </div>
        </div>
        {visible.length ? <ul className="tool-manager-list" aria-label={t('tools.label')}>
          {visible.map((id) => <ToolRow key={id} id={id} enabled={settings.enabled.includes(id)} disabled={disabled}
            onToggle={(enabled) => toggle({ id, enabled })} />)}
        </ul> : <div className="tool-manager-empty">
          <output>{t('tools.noResults')}</output>
          <Button variant="subtle" onClick={clearSearch}>{t('tools.clearSearch')}</Button>
        </div>}
      </div>
    </section>
  );
}

function ToolRow({ id, enabled, disabled, onToggle }: {
  id: ToolId;
  enabled: boolean;
  disabled: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  const { t } = useI18n();
  const { icon: Icon, label, description, parameters, example } = tools[id];
  const name = t(label);

  return <li className="tool-manager-row" data-enabled={enabled || undefined}>
    <details>
      <summary className="tool-manager-summary" aria-label={t('tools.detailsFor', { name })}>
        <span className="tool-manager-icon" aria-hidden="true"><Icon size={18} /></span>
        <span className="tool-manager-copy">
          <strong>{name}</strong>
          <span>{t(description)}</span>
        </span>
        <ChevronDown size={16} className="tool-manager-chevron" aria-hidden="true" />
      </summary>
      <div className="tool-manager-details">
        <div className="tool-manager-details-heading">
          <h2>{t('tools.parameters')}</h2>
          <code>{id}</code>
        </div>
        <dl>
          {parameters.map(({ name, description }) => (
            <div key={name}>
              <dt><code>{name}</code></dt>
              <dd>{t(description)}</dd>
            </div>
          ))}
        </dl>
        <pre aria-label={t('tools.example')}>{JSON.stringify(example, null, 2)}</pre>
      </div>
    </details>
    <Switch className="tool-manager-switch" aria-label={t('tools.toggle', { name })} checked={enabled}
      disabled={disabled} onChange={(event) => onToggle(event.currentTarget.checked)} />
  </li>;
}
