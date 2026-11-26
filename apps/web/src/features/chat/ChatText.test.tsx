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

test('sets unique and local targets for footnotes and back references', () => {
  const text = 'Сноска [^1]. Повтор [^1]. [Ссылка](https://example.com)\n\n[^1]: Текст.';
  const html = renderToStaticMarkup(<><ChatText>{text}</ChatText><ChatText>{text}</ChatText></>);
  const ids = Array.from(html.matchAll(/\bid="([^"]+)"/g), (match) => match[1]);
  assert.equal(ids.length, 8);
  assert.equal(new Set(ids).size, 8);
  for (const message of html.split('<div class="chat-markdown">').slice(1)) {
    const localIds = Array.from(message.matchAll(/\bid="([^"]+)"/g), (match) => match[1]);
    const footnoteLinks = [...message.matchAll(/<a [^>]*href="#([^"]+)"[^>]*>/g)];
    assert.equal(footnoteLinks.length, 4);
    for (const [element, href] of footnoteLinks) {
      assert.ok(localIds.includes(href));
      assert.doesNotMatch(element, /target=/);
    }
    assert.match(message, /href="https:\/\/example.com" target="_blank"/);
    assert.match(message, /<li id="[^"]+" tabindex="-1">/);
  }
});
