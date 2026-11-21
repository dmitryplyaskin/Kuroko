import { Tabs } from '@mantine/core';
import { MessageSquare, Palette, Plug } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { Appearance } from './Appearance';
import './settings.css';
import type { useChatSettings } from '../chat-settings/useChatSettings';

const ChatPreferences = lazy(() => import('../chat-settings/ChatPreferences'));
const ConnectionSettings = lazy(() => import('../connection/ConnectionSettings'));

const descriptions: Record<string, string> = {
  appearance: 'Тема и цвет акцента сохраняются в этом браузере.',
  chat: 'Настройки чата применяются после сохранения.',
  connection: 'Сохраняйте провайдера, модель и параметры генерации в пресеты.',
};

export function SettingsPage({ account, onSessionEnd, chatSettings, tab, setTab }: {
  account: number;
  onSessionEnd: () => void;
  chatSettings: ReturnType<typeof useChatSettings>;
  tab: string | null;
  setTab: (tab: string | null) => void;
}) {
  return (
    <div className="page-container">
      <header className="page-heading">
        <h1 tabIndex={-1}>Настройки</h1>
        <p>{descriptions[tab ?? 'appearance']}</p>
      </header>
      <Tabs value={tab} onChange={setTab} keepMounted={false} color="var(--kr-accent)" className="settings-tabs">
        <Tabs.List aria-label="Разделы настроек">
          <Tabs.Tab value="appearance" leftSection={<Palette size={17} aria-hidden="true" />}>Внешний вид</Tabs.Tab>
          <Tabs.Tab value="chat" leftSection={<MessageSquare size={17} aria-hidden="true" />}>Чат</Tabs.Tab>
          <Tabs.Tab value="connection" leftSection={<Plug size={17} aria-hidden="true" />}>Подключение</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="appearance"><Appearance /></Tabs.Panel>
        <Tabs.Panel value="chat">
          <Suspense fallback={<output>Загрузка настроек чата…</output>}>
            <ChatPreferences accountSettings={chatSettings} />
          </Suspense>
        </Tabs.Panel>
        <Tabs.Panel value="connection">
          <Suspense fallback={<output>Загружаем настройки подключения…</output>}>
            <ConnectionSettings account={account} onSessionEnd={onSessionEnd} />
          </Suspense>
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}
