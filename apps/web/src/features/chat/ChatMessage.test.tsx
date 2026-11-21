import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MantineProvider } from '@mantine/core';
import { notifications, useNotifications } from '@mantine/notifications';
import { allSettled, fork } from 'effector';
import { Provider } from 'effector-react';
import { Window, type HTMLButtonElement as DOMButton } from 'happy-dom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { corePlugin } from '../../core';
import type { WebModule } from '../../modules/contracts';
import { ModuleExtensionsProvider } from '../../modules/ModuleExtensions';
import { createModuleRegistry } from '../../modules/registry';
import { localeChanged } from '../../shared/i18n/i18n';
import { ChatMessage } from './ChatMessage';

test('dispatches registered menu actions for the selected message', async () => {
  const window = new Window();
  const { document } = window;
  const copied: string[] = [];
  const received: string[] = [];
  let rejectCopy = false;
  const globals = {
    window, document, navigator: window.navigator,
    HTMLElement: window.HTMLElement, Element: window.Element, Node: window.Node,
    ResizeObserver: window.ResizeObserver, getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const originalGlobals = Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: {
      async writeText(text: string) {
        if (rejectCopy) throw new Error('Permission denied');
        copied.push(text);
      },
    },
  });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container as unknown as HTMLElement);
  const scope = fork();

  function NoticeOutput() {
    const { notifications: visible } = useNotifications();
    return <output>{visible.at(-1)?.message}</output>;
  }

  const testModule = {
    id: 'test.message-menu',
    contributions: [{ kind: 'chat.message.actions', id: 'test.receive-text', label: 'chat.messageText', order: 5,
      run: ({ text }) => { received.push(text); },
    }],
  } satisfies WebModule;
  const registry = createModuleRegistry(corePlugin, [testModule]);
  const texts = ['Первое сообщение', '**Выбранное** сообщение\n\nВторая строка', ''];
  const noop = () => {};

  function buttonFor(id: number) {
    const button = container.querySelectorAll<DOMButton>('article button[aria-haspopup="menu"]')[id];
    assert.ok(button);
    return button;
  }

  function menuItems() {
    const visibleMenu = document.querySelector('[role="menu"]:not([hidden])');
    assert.ok(visibleMenu);
    return [...visibleMenu.querySelectorAll<DOMButton>('[role="menuitem"]')];
  }

  async function clickItem(label: string) {
    const item = menuItems().find((item) => item.textContent === label);
    assert.ok(item, label);
    await act(async () => item.click());
  }

  try {
    await act(async () => {
      root.render(
        <Provider value={scope}>
          <MantineProvider>
            <ModuleExtensionsProvider registry={registry}>
              {texts.map((text, id) => (
                <ChatMessage key={id} message={{ id, text, time: 0, role: 'user' }} username="Пользователь"
                  reasoningOpen={false} onToggleReasoning={noop} onEdit={noop} onDraftChange={noop}
                  onCancelEdit={noop} onSaveEdit={noop} onDelete={noop} onPreview={noop} />
              ))}
              <ChatMessage message={{ id: 3, role: 'assistant', text: 'До 🎲После', time: 0, toolCalls: [
                { id: 'dice-1', name: 'roll_dice', arguments: {}, result: 4, textOffset: 'До 🎲'.length },
                { id: 'dice-2', name: 'roll_dice', arguments: {}, result: 6, textOffset: 'До 🎲'.length },
              ] }} username="Пользователь" reasoningOpen={false} onToggleReasoning={noop} onEdit={noop}
                onDraftChange={noop} onCancelEdit={noop} onSaveEdit={noop} onDelete={noop} onPreview={noop} />
            </ModuleExtensionsProvider>
            <NoticeOutput />
          </MantineProvider>
        </Provider>,
      );
    });
    const blocks = container.querySelector('.chat-message-blocks')?.children;
    assert.equal(blocks?.length, 3);
    assert.equal(blocks[0]?.textContent, 'До 🎲');
    assert.deepEqual(Array.from(blocks[1]?.querySelectorAll('summary code') ?? [], (name) => name.textContent), ['roll_dice', 'roll_dice']);
    assert.equal(blocks[2]?.textContent, 'После');
    await act(async () => buttonFor(1).click());
    assert.deepEqual(menuItems().map((item) => item.textContent), ['Редактировать', 'Текст сообщения', 'Копировать текст', 'Удалить']);
    await clickItem('Текст сообщения');
    assert.deepEqual(received, [texts[1]]);

    await act(async () => buttonFor(1).click());
    await clickItem('Копировать текст');
    assert.deepEqual(copied, [texts[1]]);
    assert.equal(document.querySelector('output')?.textContent, 'Текст скопирован.');

    rejectCopy = true;
    await act(async () => buttonFor(0).click());
    await clickItem('Копировать текст');
    assert.deepEqual(copied, [texts[1]]);
    assert.equal(document.querySelector('output')?.textContent, 'Не удалось скопировать текст.');

    await act(async () => notifications.clean());
    Object.defineProperty(window.navigator, 'clipboard', { value: undefined });
    await act(async () => buttonFor(0).click());
    await clickItem('Копировать текст');
    assert.equal(document.querySelector('output')?.textContent, 'Не удалось скопировать текст.');

    await act(async () => buttonFor(2).click());
    assert.deepEqual(menuItems().map((item) => item.textContent), ['Редактировать', 'Текст сообщения', 'Удалить']);

    await act(async () => { await allSettled(localeChanged, { scope, params: 'en' }); });
    assert.equal(document.querySelector('output')?.textContent, 'Could not copy the text.');
    assert.deepEqual(menuItems().map((item) => item.textContent), ['Edit', 'Message text', 'Delete']);
  } finally {
    await act(async () => { root.unmount(); notifications.clean(); });
    await window.happyDOM.close();
    for (const [key, descriptor] of originalGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
