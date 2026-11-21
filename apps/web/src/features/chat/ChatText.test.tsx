import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatText } from './ChatText';

test('colors direct speech across inline Markdown without removing the markup', () => {
  const html = renderToStaticMarkup(<ChatText>{'«Начало **реплики** и конец».\n\n— Другая реплика, — сказала Лина.'}</ChatText>);

  assert.match(html, /<strong><span class="chat-speech">реплики<\/span><\/strong>/);
  assert.match(html, /<span class="chat-speech"> и конец»<\/span>\./);
  assert.match(html, /<span class="chat-speech">— Другая реплика,<\/span> — сказала Лина\./);
});

test('keeps code and literal user HTML out of speech highlighting', () => {
  const html = renderToStaticMarkup(<ChatText user>{'`"Код"` и <custom>.\n\n*Действие.*\n\n> Цитата'}</ChatText>);

  assert.match(html, /<code>&quot;Код&quot;<\/code> и &lt;custom&gt;\./);
  assert.match(html, /<em>Действие\.<\/em>/);
  assert.match(html, /<blockquote>\s*<p>Цитата<\/p>/);
  assert.doesNotMatch(html, /class="chat-speech"|<custom>/);
});
