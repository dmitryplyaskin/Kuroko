import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MantineProvider } from '@mantine/core';
import { notifications, useNotifications } from '@mantine/notifications';
import { Window, type HTMLButtonElement as DOMButton } from 'happy-dom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { corePlugin } from '../../core';
import type { WebModule } from '../../modules/contracts';
import { ModuleExtensionsProvider } from '../../modules/ModuleExtensions';
import { createModuleRegistry } from '../../modules/registry';
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

  function NoticeOutput() {
    const { notifications: visible } = useNotifications();
    return <output>{visible.at(-1)?.message}</output>;
  }

  const testModule = {
    id: 'test.message-menu',
    contributions: [{ kind: 'chat.message.actions', id: 'test.receive-text', label: 'Передать текст', order: 5,
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
        <MantineProvider>
          <ModuleExtensionsProvider registry={registry}>
            {texts.map((text, id) => (
              <ChatMessage key={id} message={{ id, text, time: 0, role: 'user' }} username="Пользователь"
                reasoningOpen={false} onToggleReasoning={noop} onEdit={noop} onDraftChange={noop}
                onCancelEdit={noop} onSaveEdit={noop} onDelete={noop} onPreview={noop} />
            ))}
          </ModuleExtensionsProvider>
          <NoticeOutput />
        </MantineProvider>,
      );
    });
    await act(async () => buttonFor(1).click());
    assert.deepEqual(menuItems().map((item) => item.textContent), ['Редактировать', 'Передать текст', 'Копировать текст', 'Удалить']);
    await clickItem('Передать текст');
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
    assert.deepEqual(menuItems().map((item) => item.textContent), ['Редактировать', 'Передать текст', 'Удалить']);
  } finally {
    await act(async () => { root.unmount(); notifications.clean(); });
    await window.happyDOM.close();
    for (const [key, descriptor] of originalGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
