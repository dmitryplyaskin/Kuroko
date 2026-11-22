import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MantineProvider } from '@mantine/core';
import { notifications, useNotifications } from '@mantine/notifications';
import { allSettled, fork } from 'effector';
import { Provider } from 'effector-react';
import { Window, type HTMLButtonElement as DOMButton, type HTMLTextAreaElement as DOMTextarea } from 'happy-dom';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { corePlugin } from '../../core';
import type { WebModule } from '../../modules/contracts';
import { ModuleExtensionsProvider } from '../../modules/ModuleExtensions';
import { createModuleRegistry } from '../../modules/registry';
import { localeChanged } from '../../shared/i18n/i18n';
import { ChatMessage } from './ChatMessage';
import { messageDraftTexts, type Message } from './message';

test('shows subagent activity in the current reply alongside existing text', () => {
  const registry = createModuleRegistry(corePlugin);
  const noop = () => {};
  const html = renderToStaticMarkup(
    <Provider value={fork()}>
      <MantineProvider>
        <ModuleExtensionsProvider registry={registry}>
          <ChatMessage message={{ id: 1, role: 'assistant', text: 'Проверю хронологию.', time: 0 }} username="Пользователь"
            phase="subagent" activeSubagents={[{ id: 'a', name: 'Хронолог' }, { id: 'b' }]}
            reasoningOpen={false} onToggleReasoning={noop} onEdit={noop} onDraftChange={noop}
            onCancelEdit={noop} onSaveEdit={noop} onDelete={noop} onPreview={noop} />
        </ModuleExtensionsProvider>
      </MantineProvider>
    </Provider>,
  );
  assert.match(html, /Проверю хронологию\./);
  assert.match(html, /<p class="chat-tool-call chat-subagent-progress">.*Субагент работает…<\/p>/);
  assert.match(html, /Субагент Хронолог работает…/);
  assert.equal([...html.matchAll(/chat-subagent-spinner/g)].length, 2);
});

test('runs toolbar and registered menu actions for the selected message and keeps tools in place while editing', async () => {
  const window = new Window();
  const { document } = window;
  const copied: string[] = [];
  const received: string[] = [];
  const deleted: number[] = [];
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

  function articleFor(id: number) {
    const article = container.querySelectorAll('article')[id];
    assert.ok(article);
    return article;
  }

  function buttonFor(id: number, label: string) {
    const button = articleFor(id).querySelector<DOMButton>(`button[aria-label="${label}"]`);
    assert.ok(button, label);
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

  function EditableReply() {
    const [editing, setEditing] = useState(false);
    const message: Message = { id: 3, role: 'assistant', text: 'До 🎲После', time: 0, toolCalls: [
      { id: 'legacy', name: 'test_echo', arguments: {}, result: 'OK' },
      { id: 'dice-1', name: 'roll_dice', arguments: {}, result: 4, textOffset: 'До 🎲'.length },
      { id: 'dice-2', name: 'roll_dice', arguments: {}, result: 6, textOffset: 'До 🎲'.length },
    ] };
    return <ChatMessage message={message} username="Пользователь" reasoningOpen={false} onToggleReasoning={noop}
      editor={editing ? { texts: messageDraftTexts(message), canSave: false } : undefined} onEdit={() => setEditing(true)}
      onDraftChange={noop} onCancelEdit={() => setEditing(false)} onSaveEdit={noop} onDelete={noop} onPreview={noop} />;
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
                  onCancelEdit={noop} onSaveEdit={noop} onDelete={(message) => deleted.push(message.id)} onPreview={noop} />
              ))}
              <ModuleExtensionsProvider registry={createModuleRegistry(corePlugin)}><EditableReply /></ModuleExtensionsProvider>
            </ModuleExtensionsProvider>
            <NoticeOutput />
          </MantineProvider>
        </Provider>,
      );
    });
    const toolbar = articleFor(3).querySelector('.chat-message-actions');
    assert.equal(toolbar?.previousElementSibling?.className, 'chat-message-content');
    assert.deepEqual(Array.from(toolbar?.querySelectorAll('button') ?? [], (button) => button.getAttribute('aria-label')),
      ['Копировать текст', 'Редактировать', 'Перегенерировать', 'Удалить', 'Другие действия']);
    assert.equal(buttonFor(3, 'Перегенерировать').disabled, true);
    assert.equal(buttonFor(3, 'Другие действия').disabled, true);
    const blocks = articleFor(3).querySelector('.chat-message-blocks')?.children;
    assert.equal(blocks?.length, 4);
    assert.equal(blocks[0]?.querySelector('summary code')?.textContent, 'test_echo');
    assert.equal(blocks[1]?.textContent, 'До 🎲');
    assert.deepEqual(Array.from(blocks[2]?.querySelectorAll('summary code') ?? [], (name) => name.textContent), ['roll_dice', 'roll_dice']);
    assert.equal(blocks[3]?.textContent, 'После');
    const tools = blocks[0]?.querySelector('details');
    assert.ok(tools);
    tools.setAttribute('open', '');
    await act(async () => buttonFor(3, 'Редактировать').click());
    assert.equal(blocks[0]?.querySelector('details[open]'), tools);
    assert.equal(blocks[1]?.querySelector<DOMTextarea>('textarea')?.value, 'До 🎲');
    assert.equal(blocks[2]?.querySelector('summary code')?.textContent, 'roll_dice');
    assert.equal(blocks[3]?.querySelector<DOMTextarea>('textarea')?.value, 'После');
    assert.equal(document.activeElement, blocks[1]?.querySelector('textarea'));
    await act(async () => articleFor(3).querySelector<DOMButton>('form button[type="button"]')?.click());
    assert.equal(document.activeElement, buttonFor(3, 'Редактировать'));
    assert.equal(articleFor(3).querySelector('textarea'), null);

    await act(async () => buttonFor(1, 'Другие действия').click());
    assert.deepEqual(menuItems().map((item) => item.textContent), ['Текст сообщения']);
    await clickItem('Текст сообщения');
    assert.deepEqual(received, [texts[1]]);

    await act(async () => buttonFor(1, 'Удалить').click());
    assert.deepEqual(deleted, [1]);

    await act(async () => buttonFor(1, 'Копировать текст').click());
    assert.deepEqual(copied, [texts[1]]);
    assert.equal(document.querySelector('output')?.textContent, 'Текст скопирован.');

    rejectCopy = true;
    await act(async () => buttonFor(0, 'Копировать текст').click());
    assert.deepEqual(copied, [texts[1]]);
    assert.equal(document.querySelector('output')?.textContent, 'Не удалось скопировать текст.');

    await act(async () => notifications.clean());
    Object.defineProperty(window.navigator, 'clipboard', { value: undefined });
    await act(async () => buttonFor(0, 'Копировать текст').click());
    assert.equal(document.querySelector('output')?.textContent, 'Не удалось скопировать текст.');

    assert.equal(buttonFor(2, 'Копировать текст').disabled, true);
    await act(async () => buttonFor(2, 'Другие действия').click());
    assert.deepEqual(menuItems().map((item) => item.textContent), ['Текст сообщения']);

    await act(async () => { await allSettled(localeChanged, { scope, params: 'en' }); });
    assert.equal(document.querySelector('output')?.textContent, 'Could not copy the text.');
    assert.deepEqual(menuItems().map((item) => item.textContent), ['Message text']);
  } finally {
    await act(async () => { root.unmount(); notifications.clean(); });
    await window.happyDOM.close();
    for (const [key, descriptor] of originalGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
