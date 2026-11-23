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
          <ChatMessage message={{ id: 1, role: 'assistant', text: 'Проверю хронологию.', reasoning: 'Записи за вчера.', time: 0 }} username="Пользователь"
            phase="subagent" activeSubagents={[{ id: 'a', name: 'Хронолог' }, { id: 'b' }]}
            expandedReasoning={new Set([undefined])} onToggleReasoning={noop} onEdit={noop} onDraftChange={noop}
            onCancelEdit={noop} onSaveEdit={noop} onDelete={noop} onPreview={noop} />
        </ModuleExtensionsProvider>
      </MantineProvider>
    </Provider>,
  );
  assert.match(html, /Проверю хронологию\./);
  assert.match(html, /Записи за вчера\./);
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
  const regenerated: number[] = [];
  const selectedVariants: number[] = [];
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
    return <output data-notice>{visible.at(-1)?.message}</output>;
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
    const [variant, selectVariant] = useState(1);
    const [expandedReasoning, setExpandedReasoning] = useState(() => new Set<string | undefined>());
    const message: Message = { id: 3, role: 'assistant', text: 'До 🎲После', time: 0, reasoningBlocks: [
      { text: 'Сначала брошу кубик.', textOffset: 0 },
      { text: 'Сравню выпавшее число.', textOffset: 'До 🎲'.length, afterToolCallId: 'dice-1' },
    ], toolCalls: [
      { id: 'legacy', name: 'test_echo', arguments: {}, result: 'OK' },
      { id: 'dice-1', name: 'roll_dice', arguments: {}, result: 4, textOffset: 'До 🎲'.length },
      { id: 'dice-2', name: 'roll_dice', arguments: {}, result: 6, textOffset: 'До 🎲'.length },
    ] };
    return <ChatMessage message={message} username="Пользователь" expandedReasoning={expandedReasoning}
      onToggleReasoning={(_, afterToolCallId, open) => setExpandedReasoning((current) => {
        const next = new Set(current);
        if (open) next.add(afterToolCallId);
        else next.delete(afterToolCallId);
        return next;
      })}
      editor={editing ? { texts: messageDraftTexts(message), canSave: false } : undefined} onEdit={() => setEditing(true)}
      onDraftChange={noop} onCancelEdit={() => setEditing(false)} onSaveEdit={noop}
      onRegenerate={(id) => regenerated.push(id)} variants={{ index: variant, total: 2 }} onSelectVariant={({ replyId, index }) => {
        assert.equal(replyId, message.id);
        selectedVariants.push(index);
        selectVariant(index);
      }} onDelete={noop} onPreview={noop} />;
  }

  try {
    await act(async () => {
      root.render(
        <Provider value={scope}>
          <MantineProvider>
            <ModuleExtensionsProvider registry={registry}>
              {texts.map((text, id) => (
                <ChatMessage key={id} message={{ id, text, time: 0, role: 'user' }} username="Пользователь"
                  onToggleReasoning={noop} onEdit={noop} onDraftChange={noop}
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
    assert.equal(toolbar?.lastElementChild?.className, 'chat-reply-variants');
    assert.deepEqual(Array.from(toolbar?.querySelectorAll('button') ?? [], (button) => button.getAttribute('aria-label')),
      ['Копировать текст', 'Редактировать', 'Перегенерировать', 'Удалить', 'Другие действия', 'Предыдущий вариант ответа', 'Следующий вариант ответа']);
    for (const id of [0, 1, 2]) assert.equal(articleFor(id).querySelector('button[aria-label="Перегенерировать"]'), null);
    await act(async () => buttonFor(3, 'Перегенерировать').click());
    assert.deepEqual(regenerated, [3]);
    const previous = buttonFor(3, 'Предыдущий вариант ответа');
    const next = buttonFor(3, 'Следующий вариант ответа');
    assert.equal(next.getAttribute('aria-disabled'), 'true');
    assert.equal(toolbar?.querySelector('output')?.textContent, 'Вариант 2 из 2');
    await act(async () => { previous.focus(); previous.click(); });
    assert.equal(document.activeElement, previous);
    assert.equal(previous.getAttribute('aria-disabled'), 'true');
    assert.equal(toolbar?.querySelector('output')?.textContent, 'Вариант 1 из 2');
    await act(async () => { previous.click(); next.click(); });
    assert.deepEqual(selectedVariants, [0, 1]);
    assert.equal(buttonFor(3, 'Другие действия').disabled, true);
    const [firstReasoning, secondReasoning] = articleFor(3).querySelectorAll<DOMButton>('.chat-reasoning-toggle');
    assert.ok(firstReasoning && secondReasoning);
    assert.equal(secondReasoning.textContent, 'Ход рассуждений');
    assert.equal(secondReasoning.getAttribute('aria-expanded'), 'false');
    const reasoningBody = document.getElementById(secondReasoning.getAttribute('aria-controls')!);
    assert.ok(reasoningBody?.hasAttribute('hidden'));
    await act(async () => secondReasoning.click());
    assert.equal(firstReasoning.getAttribute('aria-expanded'), 'false');
    assert.equal(secondReasoning.getAttribute('aria-expanded'), 'true');
    assert.equal(reasoningBody?.textContent, 'Сравню выпавшее число.');
    const blocks = articleFor(3).querySelector('.chat-message-blocks')?.children;
    assert.deepEqual(Array.from(blocks ?? [], ({ className }) => className), [
      'chat-reasoning', 'chat-tool-calls', 'chat-message-text', 'chat-tool-calls', 'chat-reasoning', 'chat-tool-calls', 'chat-message-text',
    ]);
    assert.equal(blocks?.[1]?.querySelector('summary code')?.textContent, 'test_echo');
    assert.equal(blocks?.[2]?.textContent, 'До 🎲');
    assert.equal(blocks?.[3]?.querySelector('summary code')?.textContent, 'roll_dice');
    assert.equal(blocks?.[4]?.querySelector('.chat-reasoning-toggle'), secondReasoning);
    assert.equal(blocks?.[5]?.querySelector('summary code')?.textContent, 'roll_dice');
    assert.equal(blocks?.[6]?.textContent, 'После');
    const tools = blocks?.[1]?.querySelector('details');
    assert.ok(tools);
    tools.setAttribute('open', '');
    await act(async () => buttonFor(3, 'Редактировать').click());
    assert.equal(blocks?.[1]?.querySelector('details[open]'), tools);
    assert.equal(blocks?.[2]?.querySelector<DOMTextarea>('textarea')?.value, 'До 🎲');
    assert.equal(blocks?.[3]?.querySelector('summary code')?.textContent, 'roll_dice');
    assert.equal(blocks?.[6]?.querySelector<DOMTextarea>('textarea')?.value, 'После');
    assert.equal(document.activeElement, blocks?.[2]?.querySelector('textarea'));
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
    assert.equal(document.querySelector('[data-notice]')?.textContent, 'Текст скопирован.');

    rejectCopy = true;
    await act(async () => buttonFor(0, 'Копировать текст').click());
    assert.deepEqual(copied, [texts[1]]);
    assert.equal(document.querySelector('[data-notice]')?.textContent, 'Не удалось скопировать текст.');

    await act(async () => notifications.clean());
    Object.defineProperty(window.navigator, 'clipboard', { value: undefined });
    await act(async () => buttonFor(0, 'Копировать текст').click());
    assert.equal(document.querySelector('[data-notice]')?.textContent, 'Не удалось скопировать текст.');

    assert.equal(buttonFor(2, 'Копировать текст').disabled, true);
    await act(async () => buttonFor(2, 'Другие действия').click());
    assert.deepEqual(menuItems().map((item) => item.textContent), ['Текст сообщения']);

    await act(async () => { await allSettled(localeChanged, { scope, params: 'en' }); });
    assert.equal(document.querySelector('[data-notice]')?.textContent, 'Could not copy the text.');
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
