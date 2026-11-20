import { Activity, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { Tooltip } from '@mantine/core';
import { useLocalStorage, useMediaQuery } from '@mantine/hooks';
import { Feather, KeyRound, MessageSquare, PanelLeftClose, PanelLeftOpen, PanelsTopLeft, Settings } from 'lucide-react';
import type { User } from './api';
import { ThemeMenu } from './Appearance';
import { useChatSettings } from './chat/chatSettings';
import { Profile } from './Profile';
import { SceneCover, Scenes } from './Scenes';
import { SettingsPage } from './Settings';
import { Vault } from './Vault';

const Chat = lazy(() => import('./chat/Chat'));

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
  chat: { label: 'Чат', title: 'Тестовый чат', Icon: MessageSquare },
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
  const [chatVisited, setChatVisited] = useState(() => view === 'chat');
  const [settingsTab, setSettingsTab] = useState<string | null>('appearance');
  const chatSettings = useChatSettings(user.id, onSessionEnd);
  const [menuCollapsed, setMenuCollapsed] = useLocalStorage({
    key: 'kuroko-menu-collapsed', defaultValue: false, getInitialValueInEffect: false,
    deserialize: (value) => value === 'true',
  });
  const narrowLayout = useMediaQuery('(max-width: 740px)');
  const main = useRef<HTMLElement>(null);
  const menuLabel = menuCollapsed ? 'Развернуть меню' : 'Свернуть меню';
  const MenuIcon = menuCollapsed ? PanelLeftOpen : PanelLeftClose;

  useEffect(() => {
    const onHashChange = () => {
      const next = readView();
      if (next === 'chat') setChatVisited(true);
      setView(next);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    document.title = `${sections[view].title} · Kuroko`;
    if (view !== 'chat') main.current?.querySelector<HTMLHeadingElement>('h1:not([hidden] h1)')?.focus();
  }, [view]);

  return (
    <div className="workspace" data-menu-collapsed={menuCollapsed || undefined}>
      <button type="button" className="skip-link" onClick={() => main.current?.querySelector<HTMLHeadingElement>('h1:not([hidden] h1)')?.focus()}>
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
      <main className="workspace-content" data-chat={view === 'chat' || undefined} ref={main}>
        {view === 'scenes' && <Scenes />}
        {chatVisited && (
          <Activity mode={view === 'chat' ? 'visible' : 'hidden'}>
            <Suspense fallback={<output className="chat-loading">Загрузка чата…</output>}>
              <Chat username={user.username} active={view === 'chat'} settings={chatSettings.applied} />
            </Suspense>
          </Activity>
        )}
        {view === 'secrets' && <Vault user={user} onSessionEnd={onSessionEnd} />}
        {view === 'settings' && <SettingsPage tab={settingsTab} setTab={setSettingsTab} chatSettings={chatSettings} />}
      </main>
    </div>
  );
}
