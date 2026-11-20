import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Tooltip } from '@mantine/core';
import { useLocalStorage, useMediaQuery } from '@mantine/hooks';
import { Feather, KeyRound, PanelLeftClose, PanelLeftOpen, PanelsTopLeft, Settings } from 'lucide-react';
import type { User } from './api';
import { Appearance, ThemeMenu } from './Appearance';
import { Profile } from './Profile';
import { SceneCover, Scenes } from './Scenes';
import { Vault } from './Vault';

export function Brand() {
  return (
    <div className="brand">
      <span aria-hidden="true"><Feather size={19} strokeWidth={1.8} /></span>
      Kuroko
    </div>
  );
}

export function GuestLayout({ children }: { children: ReactNode }) {
  return (
    <div className="guest-layout">
      <header className="guest-header"><Brand /><ThemeMenu /></header>
      <main className="guest-main">{children}</main>
      <SceneCover guest />
    </div>
  );
}

const sections = {
  scenes: { label: 'Сцены', title: 'Сцены', Icon: PanelsTopLeft },
  secrets: { label: 'Секреты', title: 'Мои секреты', Icon: KeyRound },
  settings: { label: 'Настройки', title: 'Настройки', Icon: Settings },
} as const;

type View = keyof typeof sections;

function readView(): View {
  const view = window.location.hash.slice(1);
  if (view === 'appearance') return 'settings';
  return Object.hasOwn(sections, view) ? view as View : 'scenes';
}

export function Workspace({ user, onSessionEnd }: { user: User; onSessionEnd: (notice?: string) => void }) {
  const [view, setView] = useState(readView);
  const [menuCollapsed, setMenuCollapsed] = useLocalStorage({
    key: 'kuroko-menu-collapsed', defaultValue: false, getInitialValueInEffect: false,
    deserialize: (value) => value === 'true',
  });
  const narrowLayout = useMediaQuery('(max-width: 740px)');
  const main = useRef<HTMLElement>(null);
  const menuLabel = menuCollapsed ? 'Развернуть меню' : 'Свернуть меню';
  const MenuIcon = menuCollapsed ? PanelLeftOpen : PanelLeftClose;

  useEffect(() => {
    const onHashChange = () => setView(readView());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    document.title = `${sections[view].title} · Kuroko`;
    main.current?.querySelector('h1')?.focus();
  }, [view]);

  return (
    <div className="workspace" data-menu-collapsed={menuCollapsed || undefined}>
      <button type="button" className="skip-link" onClick={() => main.current?.querySelector('h1')?.focus()}>
        К содержимому
      </button>
      <aside className="workspace-sidebar">
        <div className="workspace-sidebar-header">
          <Brand />
          <button type="button" className="icon-button menu-toggle" aria-expanded={!menuCollapsed}
            aria-controls="workspace-menu" aria-label={menuLabel} title={menuLabel}
            onClick={() => setMenuCollapsed((collapsed) => !collapsed)}>
            <MenuIcon size={16} aria-hidden="true" />
          </button>
        </div>
        <nav id="workspace-menu" className="workspace-nav" aria-label="Рабочее пространство">
          {(Object.keys(sections) as View[]).map((id) => {
            const { Icon, label } = sections[id];
            return (
              <Tooltip key={id} label={label} disabled={!menuCollapsed} interactive openDelay={150}
                position={narrowLayout ? 'bottom' : 'right'} events={{ hover: true, focus: true, touch: false }}>
                <a href={`#${id}`} aria-label={label} aria-current={view === id ? 'page' : undefined}>
                  <Icon size={18} aria-hidden="true" />
                  <span className="workspace-nav-label">{label}</span>
                </a>
              </Tooltip>
            );
          })}
        </nav>
        <Profile user={user} onSessionEnd={onSessionEnd} />
      </aside>
      <main className="workspace-content" ref={main}>
        {view === 'scenes' && <Scenes />}
        {view === 'secrets' && <Vault user={user} onSessionEnd={onSessionEnd} />}
        {view === 'settings' && <Appearance />}
      </main>
    </div>
  );
}
