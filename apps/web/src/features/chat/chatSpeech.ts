import type { Element, Root, RootContent, Text } from 'hast';

const inlineTags = new Set(['a', 'br', 'code', 'del', 'em', 'img', 'input', 'span', 'strong', 'sub', 'sup']);
const speech = /«[^«»\n]+»|“[^“”\n]+”|„[^„“”\n]+[“”]|"[^"\n]+"|^—[ \t\u00a0]+(?:(?![ \t\u00a0]—[ \t\u00a0])[^\n])+/gm;

type Replacements = Map<Text, (Text | Element)[]>;

function collectSpeech(parent: Root | Element, replacements: Replacements) {
  let text = '';
  let leaves: { node: Text; start: number }[] = [];

  function collectInline(node: RootContent) {
    if (node.type === 'text') {
      leaves.push({ node, start: text.length });
      text += node.value;
    } else if (node.type === 'element') {
      if (node.tagName === 'br') text += '\n';
      else if (node.tagName === 'code' || node.tagName === 'img') text += '\ufffc';
      else node.children.forEach(collectInline);
    }
  }

  function finishInline() {
    const ranges = Array.from(text.matchAll(speech), (match) => ({ start: match.index, end: match.index + match[0].length }));
    let index = 0;
    for (const { node, start } of leaves) {
      if (index >= ranges.length) break;
      const end = start + node.value.length;
      let cursor = start;
      const chunks: (Text | Element)[] = [];
      for (let range = ranges[index]; range && range.start < end; range = ranges[++index]) {
        if (range.end <= cursor) continue;
        const quotedStart = Math.max(cursor, range.start);
        const quotedEnd = Math.min(end, range.end);
        if (quotedStart > cursor) chunks.push({ type: 'text', value: text.slice(cursor, quotedStart) });
        chunks.push({
          type: 'element', tagName: 'span', properties: { className: ['chat-speech'] },
          children: [{ type: 'text', value: text.slice(quotedStart, quotedEnd) }],
        });
        cursor = quotedEnd;
        if (range.end > end) break;
      }
      if (chunks.length) {
        if (cursor < end) chunks.push({ type: 'text', value: text.slice(cursor, end) });
        replacements.set(node, chunks);
      }
    }
    text = '';
    leaves = [];
  }

  // Collect a whole inline run so quotes stay colored across bold, links and other markup.
  for (const node of parent.children) {
    if (node.type === 'element' && !inlineTags.has(node.tagName)) {
      finishInline();
      if (node.tagName !== 'pre') collectSpeech(node, replacements);
    } else {
      collectInline(node);
    }
  }
  finishInline();
}

function replaceText<T extends RootContent>(children: T[], replacements: Replacements): (T | Text | Element)[] {
  return children.flatMap<T | Text | Element>((node) => {
    if (node.type === 'element') node.children = replaceText(node.children, replacements);
    return node.type === 'text' ? replacements.get(node) ?? [node] : [node];
  });
}

export function rehypeChatSpeech() {
  return (tree: Root) => {
    const replacements: Replacements = new Map();
    collectSpeech(tree, replacements);
    if (replacements.size) tree.children = replaceText(tree.children, replacements);
  };
}
