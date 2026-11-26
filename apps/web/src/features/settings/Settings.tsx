import { useI18n } from '../../shared/i18n/i18n';
import { Tabs } from '@mantine/core';
import { useEffect } from 'react';
import { ModuleIcon } from '../../modules/ModuleIcon';
import { ModuleView } from '../../modules/ModuleView';
import { takeReloadedSettingsTab, useSettingsNavigation } from '../../modules/settingsNavigation';
import classes from './Settings.module.css';

export default function SettingsPage() {
  const { t } = useI18n();
  const { tabs, selectedKey, selectTab } = useSettingsNavigation();
  const description = tabs.find(({ key }) => key === selectedKey)?.description;

  useEffect(() => {
    const key = takeReloadedSettingsTab();
    if (key) selectTab(key);
  }, [selectTab]);

  return (
    <>
      <header className="page-heading">
        <h1 tabIndex={-1}>{t('settings.label')}</h1>
        {description && <p>{t(description)}</p>}
      </header>
      <Tabs value={selectedKey} onChange={(key) => {
          if (key !== null) selectTab(key);
        }} keepMounted={false} color="var(--kr-accent)"
        classNames={{ list: classes.list, tab: classes.tab }} styles={{ panel: { paddingBlockStart: 26 } }}>
        <Tabs.List aria-label={t('settings.tabs')}>
          {tabs.map(({ id, key, label, icon }) => (
            <Tabs.Tab key={id} value={key} leftSection={icon && <ModuleIcon name={icon} size={17} />}>{t(label)}</Tabs.Tab>
          ))}
        </Tabs.List>
        {tabs.map((tab) => (
          <Tabs.Panel key={tab.id} value={tab.key}><ModuleView entry={tab} /></Tabs.Panel>
        ))}
      </Tabs>
    </>
  );
}
