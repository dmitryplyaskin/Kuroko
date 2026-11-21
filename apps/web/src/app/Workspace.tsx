import { Activity, useCallback, useEffect, useMemo, useRef } from 'react';
import { Tooltip } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type { User } from '@kuroko/contracts/auth';
import { useUnit } from 'effector-react';
import { ModuleIcon } from '../modules/ModuleIcon';
import { ModuleExtensionsProvider } from '../modules/ModuleExtensions';
import { ModuleView } from '../modules/ModuleView';
import type { ModuleRegistry, RegisteredScreen } from '../modules/registry';
import { SettingsNavigationProvider } from '../modules/settingsNavigation';
import { Profile } from './account/Profile';
import { Brand } from './Brand';
import { $menuCollapsed, menuToggled, type WorkspaceModel } from './workspaceModel';
import './workspace.css';

function Screen({ entry, active }: { entry: RegisteredScreen; active: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const focusHeading = useCallback(() => {
    container.current?.querySelector<HTMLHeadingElement>('h1')?.focus({
      preventScroll: entry.layout === 'viewport',
    });
  }, [entry.layout]);

  const view = <ModuleView entry={entry} onReady={focusHeading} />;
  return (
    <div ref={container} className="workspace-screen" hidden={!active}>
      {entry.retainAfterVisit ? <Activity mode={active ? 'visible' : 'hidden'}>{view}</Activity> : view}
    </div>
  );
}

export function Workspace({ user, registry, model }: {
  user: User;
  registry: ModuleRegistry;
  model: WorkspaceModel;
}) {
  const [screen, retainedScreens, selectedKey, selectTab, menuCollapsed, toggleMenu] = useUnit([
    model.$screen, model.$retainedScreens, model.$settingsTab, model.settingsTabChanged, $menuCollapsed, menuToggled,
  ]);
  const settings = useMemo(() => ({ tabs: registry.settingsTabs, selectedKey, selectTab }),
    [registry, selectedKey, selectTab]);
  const narrowLayout = useMediaQuery('(max-width: 740px)');
  const main = useRef<HTMLElement>(null);
  const menuLabel = menuCollapsed ? 'Развернуть меню' : 'Свернуть меню';
  const MenuIcon = menuCollapsed ? PanelLeftOpen : PanelLeftClose;

  useEffect(() => {
    document.title = `${screen.title ?? screen.label} · Kuroko`;
  }, [screen]);

  function focusContent() {
    const heading = main.current?.querySelector<HTMLHeadingElement>('h1:not([hidden] h1)');
    (heading ?? main.current)?.focus();
  }

  return (
    <div className="workspace" data-menu-collapsed={menuCollapsed || undefined}>
      <button type="button" className="skip-link" onClick={focusContent}>К содержимому</button>
      <aside className="workspace-sidebar">
        <div className="workspace-sidebar-header">
          <Brand />
          <button type="button" className="icon-button menu-toggle" aria-expanded={!menuCollapsed}
            aria-controls="workspace-menu" aria-label={menuLabel} title={menuLabel}
            onClick={toggleMenu}>
            <MenuIcon size={16} aria-hidden="true" />
          </button>
        </div>
        <nav id="workspace-menu" className="workspace-nav" aria-label="Рабочее пространство">
          {registry.screens.map(({ id, icon, label, route }) => (
            <Tooltip key={id} label={label} disabled={!menuCollapsed} interactive openDelay={150}
              position={narrowLayout ? 'bottom' : 'right'} events={{ hover: true, focus: true, touch: false }}>
              <a href={route} aria-label={label} aria-current={screen.id === id ? 'page' : undefined}>
                <ModuleIcon name={icon ?? 'panels'} size={18} />
                <span className="workspace-nav-label">{label}</span>
              </a>
            </Tooltip>
          ))}
        </nav>
        <Profile user={user} />
      </aside>
      <main className="workspace-content page-container" data-size="wide" data-layout={screen.layout} ref={main} tabIndex={-1}>
        <ModuleExtensionsProvider registry={registry}>
          <SettingsNavigationProvider value={settings}>
            {registry.screens.map((entry) => {
              const active = entry.id === screen.id;
              return (active || retainedScreens.has(entry.id)) && <Screen key={entry.id} entry={entry} active={active} />;
            })}
          </SettingsNavigationProvider>
        </ModuleExtensionsProvider>
      </main>
    </div>
  );
}
