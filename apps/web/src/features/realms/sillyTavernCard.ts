import { realmRequestByteLimit, realmSpecVersion, type Realm, type RealmStart } from '@kuroko/contracts/realms';
import { newRealmId } from './model';

export type ImportLabels = {
  start: string;
  alternateStart: (number: number) => string;
};

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
}

function text(value: unknown) {
  if (typeof value === 'string' && value.trim()) return value.toWellFormed();
}

export function convertSillyTavernCard(value: unknown, labels: ImportLabels): Realm | undefined {
  const card = record(value);
  if (!card) return;
  const wrapped = card.spec === 'chara_card_v2' || card.spec === 'chara_card_v3';
  const data = wrapped ? record(card.data) : card;
  if (!data || (!wrapped && ('spec' in card || 'specVersion' in card ||
    !['description', 'personality', 'scenario', 'first_mes', 'mes_example'].some((key) => typeof data[key] === 'string')))) return;
  const name = text(data.name)?.trim();
  if (!name) return;

  const characterId = newRealmId();
  const content = [text(data.description), text(data.personality), text(data.mes_example)].filter(Boolean).join('\n\n');
  const scenario = text(data.scenario);
  const greeting = text(data.first_mes);
  const alternateGreetings: unknown[] = Array.isArray(data.alternate_greetings) ? data.alternate_greetings : [];
  const starts = [greeting, ...alternateGreetings.map(text)].flatMap<RealmStart>((message, index) => {
    if (!message) return [];
    return [{
      id: newRealmId(), title: index === 0 ? labels.start : labels.alternateStart(index),
      scenario, greeting: message, characterIds: [characterId],
    }];
  });
  if (!starts.length && scenario) starts.push({ id: newRealmId(), title: labels.start, scenario, characterIds: [characterId] });
  const tags: unknown[] = Array.isArray(data.tags) ? data.tags : [];

  return {
    specVersion: realmSpecVersion, id: newRealmId(), title: name, base: '-',
    author: text(data.creator), version: text(data.character_version), authorNotes: text(data.creator_notes),
    tags: [...new Set(tags.flatMap((tag) => text(tag)?.trim() || []))],
    characters: [{ id: characterId, title: name, content: content || name }],
    starts,
  };
}

const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];

export function isPng(bytes: Uint8Array) {
  return pngSignature.every((byte, index) => bytes[index] === byte);
}

export function readSillyTavernPng(bytes: Uint8Array, labels: ImportLabels) {
  if (!isPng(bytes)) return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks = new Map<string, Uint8Array>();
  for (let offset = pngSignature.length; offset + 12 <= bytes.length; ) {
    const size = view.getUint32(offset);
    const type = view.getUint32(offset + 4);
    const end = offset + 8 + size;
    if (end + 4 > bytes.length || (offset === pngSignature.length && (type !== 0x49484452 || size !== 13))) return;
    if (type === 0x49454e44) { // IEND
      if (size !== 0) return;
      for (const key of ['ccv3', 'chara']) {
        const data = chunks.get(key);
        if (!data) continue;
        const realm = convertSillyTavernCard(decodeCardChunk(data), labels);
        if (realm) return realm;
      }
      return;
    }
    if (type === 0x74455874) { // tEXt
      const start = offset + 8;
      const keyword = bytes.subarray(start, Math.min(start + 6, end));
      const separator = keyword.indexOf(0);
      if (separator !== -1) {
        const key = String.fromCharCode(...keyword.subarray(0, separator)).toLowerCase();
        if ((key === 'ccv3' || key === 'chara') && !chunks.has(key)) chunks.set(key, bytes.subarray(start + separator + 1, end));
      }
    }
    offset = end + 4;
  }
}

function decodeCardChunk(bytes: Uint8Array): unknown {
  if (bytes.length > Math.ceil(realmRequestByteLimit / 3) * 4) return;
  try {
    const decoded = atob(new TextDecoder().decode(bytes));
    const json = new Uint8Array(decoded.length);
    for (let index = 0; index < json.length; index++) json[index] = decoded.charCodeAt(index);
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(json));
  } catch {
    return undefined;
  }
}
