import { CodedError, errorBody } from '@kuroko/contracts/errors';
import { hasTemplateSyntax } from '@kuroko/contracts/instructions';
import type { JsonValue } from '@kuroko/contracts/llm';
import { isPersonaId, type SavedPersona } from '@kuroko/contracts/personas';
import { resolveRealmContext } from '@kuroko/contracts/realmContext';
import { orderedRealmRecords, type RealmCharacter, type RealmStart, type SavedRealm } from '@kuroko/contracts/realms';
import wasmPath from 'minijinja-js/minijinja_js_bg.wasm' with { type: 'file' };
import { Environment, initSync, TemplateError } from 'minijinja-js/init';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

initSync(readFileSync(resolve(import.meta.dir, wasmPath)));

export class PromptTemplateError extends CodedError<'prompt_template_invalid'> {
  constructor(public readonly line?: number) {
    super('prompt_template_invalid');
  }

  get body() { return errorBody(this.code, this.line ? String(this.line) : undefined); }
}

type Context = { chat?: { title: string; gm_mode: boolean }; agent?: { name: string } };

function withEngine<T>(use: (engine: Environment) => T): T {
  const engine = new Environment();
  try {
    engine.syntax = { lineStatementPrefix: '@ ' };
    engine.undefinedBehavior = 'strict';
    engine.fuel = 50_000;
    return use(engine);
  } catch (error) {
    if (error instanceof TemplateError) throw new PromptTemplateError(error.line ?? undefined);
    throw error;
  } finally {
    engine.free();
  }
}

export function validatePromptTemplate(text: string) {
  if (hasTemplateSyntax(text)) withEngine((engine) => engine.addTemplate('prompt', text));
}

type WorldFields = Readonly<Record<string, unknown>>;
const worldFieldsPrototype = Object.freeze(Object.create(null) as object);

// MiniJinja reads objects with a custom prototype lazily. The empty prototype
// limits the fields the template can access to the properties defined here.
function worldFields(fields: Record<string, () => unknown>): WorldFields {
  const properties = Object.fromEntries(Object.entries(fields).map(([key, read]) => [key, { enumerable: true, get: read }]));
  return Object.create(worldFieldsPrototype, properties) as WorldFields;
}

function clamp(value: unknown, low: unknown, high: unknown) {
  if (typeof value !== 'number' || typeof low !== 'number' || typeof high !== 'number' || low > high) {
    throw new Error('clamp expects a number and an ordered numeric interval');
  }
  return Math.min(high, Math.max(low, value));
}

export function createPromptRenderer(
  findRealm: (userId: number, id: string) => SavedRealm | null,
  findPersona: (userId: number, id: string) => SavedPersona | undefined,
) {
  return (userId: number, context: Context, worldId?: string | null) => {
    const worlds = new Map<string, WorldFields>();
    const realms = new Map<string, SavedRealm>();
    const pending = new Set<() => unknown>();

    function memo<T>(read: () => T): () => T {
      let result: { value: T } | undefined;
      return () => {
        if (result) return result.value;
        if (pending.has(read) || pending.size >= 32) throw new PromptTemplateError();
        pending.add(read);
        try {
          result = { value: read() };
          return result.value;
        } finally {
          pending.delete(read);
        }
      };
    }

    function evaluate(text: string, vars: WorldFields | object, currentWorld: () => WorldFields | null) {
      return withEngine((engine) => {
        engine.addFunction('clamp', clamp);
        engine.addFunction('world', (id?: unknown, startId?: unknown, personaId?: unknown) => {
          if (id === undefined && startId === undefined && personaId === undefined) return currentWorld();
          if (typeof id !== 'string' || (startId !== undefined && typeof startId !== 'string') ||
            (personaId !== undefined && !isPersonaId(personaId))) {
            throw new Error('Expected a world reference');
          }
          const world = getWorld(id, startId, personaId);
          if (!world) throw new Error('World not found');
          return world;
        });
        const result = engine.renderStr(text, { ...context, vars });
        if (result.length > 64_000) throw new PromptTemplateError();
        return result;
      });
    }

    function getWorld(id?: string | null, startId?: string, personaId?: string): WorldFields | null {
      if (!id) return null;
      const key = JSON.stringify([id, startId, personaId]);
      const cached = worlds.get(key);
      if (cached) return cached;
      const saved = realms.get(id) ?? findRealm(userId, id);
      if (!saved) return null;
      realms.set(id, saved);
      const { realm } = saved;
      const start = realm.starts?.find((candidate) => candidate.id === startId);
      if (startId !== undefined && !start) throw new Error('World start not found');
      const persona = personaId === undefined ? undefined : findPersona(userId, personaId);
      if (personaId !== undefined && !persona) throw new Error('Persona not found');
      function readText(text = ''): string {
        return hasTemplateSyntax(text) ? evaluate(text, vars, () => world) : text;
      }
      function readValue(value: JsonValue): unknown {
        if (typeof value === 'string') return readText(value);
        if (Array.isArray(value)) return value.map(readValue);
        if (value === null || typeof value !== 'object') return value;
        return worldFields(Object.fromEntries(Object.entries(value).map(([key, child]) => [key, memo(() => readValue(child))])));
      }
      function entryFields(entry: RealmCharacter) {
        return worldFields({
          title: () => entry.title, content: memo(() => readText(entry.content)), summary: memo(() => readText(entry.summary)),
          id: () => entry.id, order: () => entry.order,
        });
      }
      const vars = worldFields(Object.fromEntries(realm.variables?.map(({ name, value }) => [name, memo(() => readValue(value))]) ?? []));
      const selected = resolveRealmContext(realm, start, persona);
      const player = selected.playerPersona;
      const playerPersona = player ? worldFields({ name: () => player.name ?? '', description: () => player.description }) : null;
      const base = memo(() => readText(realm.base));
      const scenario = memo(() => readText(start?.scenario));
      const entries = memo(() => selected.entries.map((entry) => worldFields(Object.fromEntries(
        Object.entries(entry).map(([field, value]) => [field, field === 'content' ? memo(() => readText(entry.content)) : () => value]),
      ))));
      function startFields(value: RealmStart) {
        const fields = memo(() => getWorld(id, value.id, personaId)!);
        return worldFields({
          id: () => value.id, title: () => value.title,
          ...Object.fromEntries(['scenario', 'greeting', 'entries', 'player_persona', 'context'].map((field) => [field, () => fields()[field]])),
        });
      }
      const world = worldFields({
        title: () => realm.title, id: () => saved.id, vars: () => vars, base, scenario, entries, player_persona: () => playerPersona,
        description: memo(() => readText(realm.description)), author_notes: memo(() => readText(realm.authorNotes)),
        greeting: memo(() => readText(start?.greeting)),
        characters: memo(() => orderedRealmRecords(realm.characters ?? []).map(({ record }) => entryFields(record))),
        lorebook: memo(() => orderedRealmRecords(realm.lorebook ?? []).map(({ record }) => entryFields(record))),
        sections: memo(() => realm.sections?.map(({ title, entries }) => ({
          title, entries: orderedRealmRecords(entries).map(({ record }) => entryFields(record)),
        })) ?? []),
        starts: memo(() => orderedRealmRecords(realm.starts ?? []).map(({ record }) => startFields(record))),
        context: memo(() => [
          realm.title, base(), scenario(), player ? ['Player persona', player.name, player.description].filter(Boolean).join('\n') : '',
          ...selected.entries.map(({ title, content }) => `${title}\n${readText(content)}`),
        ].filter((text) => text.trim()).join('\n\n')),
      });
      worlds.set(key, world);
      return world;
    }

    return (text: string) => {
      if (!hasTemplateSyntax(text)) return text;
      const world = getWorld(worldId);
      return evaluate(text, (world?.vars as WorldFields | undefined) ?? {}, () => world);
    };
  };
}
