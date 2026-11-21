import { Activity, lazy, Suspense, useEffect, useRef } from 'react';
import { Tooltip } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { MessageSquare, PanelLeftClose, PanelLeftOpen, PanelsTopLeft, Settings } from 'lucide-react';
import type { User } from '@kuroko/contracts/auth';
import { useUnit } from 'effector-react';
import { $appliedChatSettings } from '../features/chat-settings/model';
import { $chatVisited, $menuCollapsed, $workspaceView, menuToggled, type WorkspaceView } from './workspaceModel';
import { Profile } from '../features/auth/Profile';
import { Scenes } from '../features/scenes/Scenes';
import { SettingsPage } from '../features/settings/Settings';
import { Brand } from './Brand';
import './workspace.css';

const Chat = lazy(() => import('../features/chat/Chat'));

const sections = {
  scenes: { label: 'Сцены', title: 'Сцены', Icon: PanelsTopLeft },
  chat: { label: 'Чат', title: 'Тестовый чат', Icon: MessageSquare },
  settings: { label: 'Настройки', title: 'Настройки', Icon: Settings },
} as const;

export function Workspace({ user }: { user: User }) {
  const [view, chatVisited, menuCollapsed, toggleMenu, chatSettings] = useUnit([
    $workspaceView, $chatVisited, $menuCollapsed, menuToggled, $appliedChatSettings,
  ]);
  const narrowLayout = useMediaQuery('(max-width: 740px)');
  const main = useRef<HTMLElement>(null);
  const menuLabel = menuCollapsed ? 'Развернуть меню' : 'Свернуть меню';
  const MenuIcon = menuCollapsed ? PanelLeftOpen : PanelLeftClose;

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
            onClick={toggleMenu}>
            <MenuIcon size={16} aria-hidden="true" />
          </button>
        </div>
        <nav id="workspace-menu" className="workspace-nav" aria-label="Рабочее пространство">
          {(Object.keys(sections) as WorkspaceView[]).map((id) => {
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
        <Profile user={user} />
      </aside>
      <main className="workspace-content page-container" data-size="wide" data-chat={view === 'chat' || undefined} ref={main}>
        {view === 'scenes' && <Scenes />}
        {chatVisited && (
          <Activity mode={view === 'chat' ? 'visible' : 'hidden'}>
            <Suspense fallback={<output className="chat-loading">Загрузка чата…</output>}>
              <Chat username={user.username} active={view === 'chat'} settings={chatSettings} />
            </Suspense>
          </Activity>
        )}
        {view === 'settings' && <SettingsPage />}
      </main>
    </div>
  );
}
