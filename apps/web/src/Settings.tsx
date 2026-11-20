import { Tabs } from '@mantine/core';
import { MessageSquare, Palette } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { Appearance } from './Appearance';
import type { useChatSettings } from './chat/chatSettings';

const ChatPreferences = lazy(() => import('./chat/ChatPreferences'));

export function SettingsPage({ chatSettings, tab, setTab }: {
  chatSettings: ReturnType<typeof useChatSettings>;
  tab: string | null;
  setTab: (tab: string | null) => void;
}) {
  return (
    <div className="page-container">
      <header className="page-heading">
        <h1 tabIndex={-1}>Настройки</h1>
        <p>{tab === 'chat' ? 'Настройки чата применяются после сохранения.' : 'Тема и цвет акцента сохраняются в этом браузере.'}</p>
      </header>
      <Tabs value={tab} onChange={setTab} keepMounted={false} color="var(--kr-accent)" className="settings-tabs">
        <Tabs.List aria-label="Разделы настроек">
          <Tabs.Tab value="appearance" leftSection={<Palette size={17} aria-hidden="true" />}>Внешний вид</Tabs.Tab>
          <Tabs.Tab value="chat" leftSection={<MessageSquare size={17} aria-hidden="true" />}>Чат</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="appearance"><Appearance /></Tabs.Panel>
        <Tabs.Panel value="chat">
          <Suspense fallback={<output>Загрузка настроек чата…</output>}>
            <ChatPreferences accountSettings={chatSettings} />
          </Suspense>
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}
