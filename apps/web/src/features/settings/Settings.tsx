import { Tabs } from '@mantine/core';
import { ModuleIcon } from '../../modules/ModuleIcon';
import { ModuleView } from '../../modules/ModuleView';
import { useSettingsNavigation } from '../../modules/settingsNavigation';
import classes from './Settings.module.css';

export default function SettingsPage() {
  const { tabs, selectedKey, selectTab } = useSettingsNavigation();
  const description = tabs.find(({ key }) => key === selectedKey)?.description;

  return (
    <div className="page-container">
      <header className="page-heading">
        <h1 tabIndex={-1}>Настройки</h1>
        {description && <p>{description}</p>}
      </header>
      <Tabs value={selectedKey} onChange={(key) => {
          if (key !== null) selectTab(key);
        }} keepMounted={false} color="var(--kr-accent)"
        classNames={{ list: classes.list, tab: classes.tab }} styles={{ panel: { paddingBlockStart: 26 } }}>
        <Tabs.List aria-label="Разделы настроек">
          {tabs.map(({ id, key, label, icon }) => (
            <Tabs.Tab key={id} value={key} leftSection={icon && <ModuleIcon name={icon} size={17} />}>{label}</Tabs.Tab>
          ))}
        </Tabs.List>
        {tabs.map((tab) => (
          <Tabs.Panel key={tab.id} value={tab.key}><ModuleView entry={tab} /></Tabs.Panel>
        ))}
      </Tabs>
    </div>
  );
}
