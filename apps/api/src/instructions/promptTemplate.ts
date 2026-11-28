import { CodedError, errorBody } from '@kuroko/contracts/errors';
import { hasTemplateSyntax } from '@kuroko/contracts/instructions';
import type { JsonValue } from '@kuroko/contracts/llm';
import { isPersonaId, type PersonaForPrompt } from '@kuroko/contracts/personas';
import { resolvePlayerPersona, resolveRealmContext } from '@kuroko/contracts/realmContext';
import { orderedRealmRecords, type RealmCharacter, type RealmStart, type SavedRealm } from '@kuroko/contracts/realms';
import type { Variable } from '@kuroko/contracts/variables';
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
  findPersona: (userId: number, id: string) => PersonaForPrompt | undefined,
  findActivePersona: (userId: number) => PersonaForPrompt | undefined,
) {
  return (userId: number, context: Context, worldId?: string | null, currentStartId?: string) => {
    const worlds = new Map<string, WorldFields>();
    const realms = new Map<string, SavedRealm>();
    const pending = new Set<() => unknown>();
    const currentWorld = memo(() => getWorld(worldId, currentStartId, undefined, true));
    const readActivePersona = memo(() => {
      const source = findActivePersona(userId);
      return source ? personaTemplate(source, currentWorld).fields : null;
    });

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

    function evaluate(text: string, vars: WorldFields, currentWorld: () => WorldFields | null, readPersona = readActivePersona) {
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
        const persona = readPersona();
        const result = engine.renderStr(text, { ...context, vars, persona, user: persona?.name ?? '' });
        if (result.length > 64_000) throw new PromptTemplateError();
        return result;
      });
    }

    function templateVariables(variables: Variable[], readText: (text: string) => string) {
      function readValue(value: JsonValue): unknown {
        if (typeof value === 'string') return readText(value);
        if (Array.isArray(value)) return value.map(readValue);
        if (value === null || typeof value !== 'object') return value;
        return worldFields(Object.fromEntries(Object.entries(value).map(([key, child]) => [key, memo(() => readValue(child))])));
      }
      return worldFields(Object.fromEntries(variables.map(({ name, value }) => [name, memo(() => readValue(value))])));
    }

    function personaTemplate(source: PersonaForPrompt, currentWorld: () => WorldFields | null) {
      const readText = (text: string): string => {
        if (!hasTemplateSyntax(text)) return text;
        const world = currentWorld();
        return evaluate(text, (world?.vars as WorldFields | undefined) ?? {}, currentWorld, () => fields);
      };
      const description = memo(() => readText(source.description));
      const vars = templateVariables(source.variables, readText);
      const fields = worldFields({ id: () => source.id, name: () => source.name, description, vars: () => vars });
      return { fields, description };
    }

    function getWorld(id?: string | null, startId?: string, personaId?: string, allowMissingStart = false): WorldFields | null {
      if (!id) return null;
      const key = JSON.stringify([id, startId, personaId]);
      const cached = worlds.get(key);
      if (cached) return cached;
      const saved = realms.get(id) ?? findRealm(userId, id);
      if (!saved) return null;
      realms.set(id, saved);
      const { realm } = saved;
      const start = realm.starts?.find((candidate) => candidate.id === startId);
      if (startId !== undefined && !start) {
        if (allowMissingStart) return getWorld(id);
        throw new Error('World start not found');
      }
      const persona = personaId === undefined ? undefined : findPersona(userId, personaId);
      if (personaId !== undefined && !persona) throw new Error('Persona not found');
      const explicit = persona ? personaTemplate(persona, () => world) : undefined;
      function readText(text = ''): string {
        return hasTemplateSyntax(text) ? evaluate(text, vars, () => world, explicit ? () => explicit.fields : undefined) : text;
      }
      function entryFields(entry: RealmCharacter) {
        return worldFields({
          title: () => entry.title, content: memo(() => readText(entry.content)), summary: memo(() => readText(entry.summary)),
          id: () => entry.id, order: () => entry.order,
        });
      }
      const vars = templateVariables(realm.variables ?? [], readText);
      const selected = resolveRealmContext(realm, start, persona);
      const readPlayer = memo(() => persona && explicit ? resolvePlayerPersona(selected.playerRole, {
        name: persona.name,
        get description() { return explicit.description(); },
      }) : selected.playerPersona);
      const playerPersona = selected.playerPersona ? worldFields({
        name: () => selected.playerPersona?.name ?? '', description: () => readPlayer()?.description ?? '',
      }) : null;
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
        context: memo(() => {
          const player = readPlayer();
          return [
            realm.title, base(), scenario(), player ? ['Player persona', player.name, player.description].filter(Boolean).join('\n') : '',
            ...selected.entries.map(({ title, content }) => `${title}\n${readText(content)}`),
          ].filter((text) => text.trim()).join('\n\n');
        }),
      });
      worlds.set(key, world);
      return world;
    }

    return (text: string) => {
      if (!hasTemplateSyntax(text)) return text;
      const world = currentWorld();
      return evaluate(text, (world?.vars as WorldFields | undefined) ?? {}, currentWorld);
    };
  };
}
