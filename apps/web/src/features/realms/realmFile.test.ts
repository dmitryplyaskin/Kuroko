import { readRealm } from '@kuroko/contracts/realms';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crc32 } from 'node:zlib';
import { readRealmFile } from './realmFile';
import { readSillyTavernPng, type ImportLabels } from './sillyTavernCard';

const labels: ImportLabels = { start: 'Start', alternateStart: (number) => `Start ${number + 1}` };
const data = {
  name: 'Лина', description: 'Механик', personality: 'Любопытная', mes_example: 'Привет!',
  scenario: 'На станции', first_mes: 'Заходи!', alternate_greetings: ['', 'Ты слышал сигнал?'],
  creator: 'Автор', creator_notes: 'Заметки', character_version: '1.0', tags: ['космос', 'космос'],
  character_book: { entries: [{ content: 'Запись лора' }] }, system_prompt: 'Системный промпт',
};

test('imports a SillyTavern JSON as a valid realm with linked starts and leaves lore and prompt instructions out', async () => {
  const card = { spec: 'chara_card_v2', spec_version: '2.0', data };
  const result = await readRealmFile(new File([JSON.stringify(card)], 'lina.json'), labels);
  assert.equal(result.source, 'sillytavern');
  const { realm } = result;
  assert.deepEqual(readRealm(realm), { realm });
  assert.equal(realm.title, 'Лина');
  assert.equal(realm.base, '-');
  assert.equal(realm.characters?.[0]?.content, 'Механик\n\nЛюбопытная\n\nПривет!');
  assert.deepEqual(realm.starts?.map(({ greeting, scenario, characterIds }) => ({ greeting, scenario, characterIds })), [
    { greeting: 'Заходи!', scenario: 'На станции', characterIds: [realm.characters?.[0]?.id] },
    { greeting: 'Ты слышал сигнал?', scenario: 'На станции', characterIds: [realm.characters?.[0]?.id] },
  ]);
  assert.deepEqual(realm.tags, ['космос']);
  assert.equal(realm.author, 'Автор');
  assert.equal(realm.authorNotes, 'Заметки');
  assert.equal(realm.version, '1.0');
  assert.equal(realm.lorebook, undefined);
  assert.ok(!JSON.stringify(realm).includes(data.system_prompt));
});

test('keeps native Realm imports and recognizes flat SillyTavern cards with a scenario-only start', async () => {
  const native = { specVersion: '0.1.0', id: 'r1', title: 'Kuroko', base: 'World' };
  assert.deepEqual(await readRealmFile(new File([JSON.stringify(native)], 'realm.json'), labels), { source: 'kuroko', realm: native });
  const flat = { name: 'Лина', scenario: 'На станции' };
  const { realm } = await readRealmFile(new File([JSON.stringify(flat)], 'flat.json'), labels);
  assert.deepEqual(readRealm(realm), { realm });
  assert.equal(realm.starts?.[0]?.scenario, flat.scenario);
  assert.equal(realm.starts?.[0]?.greeting, undefined);
});

const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');

function pngWithCard(ccv3: string) {
  const v2 = { spec: 'chara_card_v2', spec_version: '2.0', data };
  const metadata = (key: string, value: string) => {
    const payload = Buffer.from(`tEXt${key}\0${value}`);
    const length = Buffer.alloc(4);
    const checksum = Buffer.alloc(4);
    length.writeUInt32BE(payload.length - 4);
    checksum.writeUInt32BE(crc32(payload));
    return Buffer.concat([length, payload, checksum]);
  };
  return Buffer.concat([image.subarray(0, -12), metadata('chara', Buffer.from(JSON.stringify(v2)).toString('base64')),
    metadata('ccv3', ccv3), image.subarray(-12)]);
}

test('reads UTF-8 card metadata from PNG, prefers ccv3 and falls back to chara when needed', async () => {
  const v3 = { spec: 'chara_card_v3', spec_version: '3.0', data: { ...data, name: 'Серафима' } };
  const bytes = pngWithCard(Buffer.from(JSON.stringify(v3)).toString('base64'));
  assert.equal(readSillyTavernPng(bytes, labels)?.title, 'Серафима');
  assert.equal(readSillyTavernPng(pngWithCard('not base64!'), labels)?.title, 'Лина');
  assert.equal(readSillyTavernPng(bytes.subarray(0, -1), labels), undefined);
  await assert.rejects(readRealmFile(new File([image], 'plain.png'), labels), { code: 'realm_file_png_card' });
});
