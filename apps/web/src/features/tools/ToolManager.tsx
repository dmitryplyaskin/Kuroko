import { Button, Switch } from '@mantine/core';
import { toolIds } from '@kuroko/contracts/tools';
import { useUnit } from 'effector-react';
import { useI18n } from '../../shared/i18n/i18n';
import { tools } from './catalog';
import { $toolSettings, toolSettingChanged, toolSettingsRetried } from './model';
import './toolManager.css';

export default function ToolManager() {
  const { t } = useI18n();
  const { settings, toggle, retry } = useUnit({ settings: $toolSettings, toggle: toolSettingChanged, retry: toolSettingsRetried });
  return (
    <section className="page-container tool-manager" aria-labelledby="tools-title">
      <header className="page-heading">
        <h1 id="tools-title" tabIndex={-1}>{t('tools.label')}</h1>
        <p>{t('tools.description')}</p>
      </header>
      {settings.status === 'loading' && <output className="tool-manager-status">{t('tools.loading')}</output>}
      {settings.error && (
        <div className="tool-manager-status">
          <p role="alert">{t(`error.${settings.error}`)}</p>
          {settings.status === 'loadError' && <Button variant="default" onClick={retry}>{t('common.retryLoad')}</Button>}
        </div>
      )}
      <div className="tool-manager-list">
        {toolIds.map((id) => {
          const tool = tools[id];
          return (
            <article className="tool-manager-card" key={id} aria-labelledby={`tool-${id}`}>
              <header>
                <div>
                  <h2 id={`tool-${id}`}>{t(tool.label)}</h2>
                  <code>{id}</code>
                </div>
                <Switch aria-label={t('tools.toggle', { name: t(tool.label) })} checked={settings.enabled.includes(id)}
                  disabled={settings.status !== 'ready'} onChange={(event) => toggle({ id, enabled: event.currentTarget.checked })} />
              </header>
              <p>{t(tool.description)}</p>
              <details>
                <summary>{t('tools.parameters')}</summary>
                <dl>
                  {tool.parameters.map(({ name, description }) => (
                    <div key={name}>
                      <dt><code>{name}</code></dt>
                      <dd>{t(description)}</dd>
                    </div>
                  ))}
                </dl>
                <pre aria-label={t('tools.example')}>{JSON.stringify(tool.example, null, 2)}</pre>
              </details>
            </article>
          );
        })}
      </div>
    </section>
  );
}
