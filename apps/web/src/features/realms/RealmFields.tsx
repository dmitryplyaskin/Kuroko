import { Accordion, ActionIcon, Button, Checkbox, TextInput } from '@mantine/core';
import { PromptTextarea } from '../../shared/prompt-templates/TemplateHelp';
import { resolveRealmContext } from '@kuroko/contracts/realmContext';
import {
  isRealmOrder, orderedRealmRecords, realmMaxOrder, realmSearchKey, type Realm, type RealmCharacter, type RealmEntry,
  type RealmSectionEntryRef, type RealmStart,
} from '@kuroko/contracts/realms';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '../../shared/i18n/i18n';
import { newRealmId } from './model';
import { AvatarEditor } from './RealmAvatar';
import { RecordLabel, RecordSearch, recordMatches, type RealmRecord } from './RealmRecords';
import classes from './Realms.module.css';

type ChangeRecords<T> = (items: T[], removed?: boolean) => void;

export function RecordEditor<T extends RealmRecord>({ items, addLabel, emptyLabel, invalidIndex, portrait = false, makeItem, onChange, fields }: {
  items: T[];
  addLabel: string;
  emptyLabel: string;
  invalidIndex?: number;
  portrait?: boolean;
  makeItem: () => T;
  onChange: ChangeRecords<T>;
  fields: (item: T, change: (patch: Partial<T>) => void) => ReactNode;
}) {
  const { t, number } = useI18n();
  const focusNew = useRef<string | null>(null);
  const group = useId();
  const invalidItem = invalidIndex === undefined ? undefined : items[invalidIndex]?.id;
  const [selection, setSelection] = useState<{ open: string[]; query: string; invalidItem?: string }>({
    open: invalidItem ? [invalidItem] : [], query: '', invalidItem,
  });
  if (selection.invalidItem !== invalidItem) {
    const open = invalidItem && !selection.open.includes(invalidItem) ? [...selection.open, invalidItem] : selection.open;
    setSelection({ open, query: invalidItem ? '' : selection.query, invalidItem });
  }
  const { open, query } = selection;
  const openIds = new Set(open);
  const setOpen = (ids: string[]) => setSelection((current) => ({ ...current, open: ids }));
  const search = realmSearchKey(query.trim());
  const ordered = orderedRealmRecords(items);
  const visible = ordered.map((position, index) => ({ ...position, index }))
    .filter(({ record }) => openIds.has(record.id) || recordMatches(record, search));

  useEffect(() => {
    const id = focusNew.current;
    if (id && open.includes(id)) {
      focusNew.current = null;
      document.getElementById(`${group}-${id}`)?.querySelector<HTMLInputElement>('input:not([type]), input[type=text]')?.focus();
    }
  }, [group, open]);

  function changeSearch(query: string) {
    const search = realmSearchKey(query.trim());
    const matching = new Set(items.filter((item) => recordMatches(item, search)).map(({ id }) => id));
    setSelection((current) => ({ ...current, query, open: current.open.filter((id) => matching.has(id)) }));
  }

  function add() {
    const item = { ...makeItem(), order: Math.min((ordered.at(-1)?.order ?? 0) + 1, realmMaxOrder) };
    focusNew.current = item.id;
    onChange([...items, item]);
    setSelection((current) => ({ ...current, open: [...current.open, item.id], query: '' }));
  }

  function move(index: number, step: -1 | 1) {
    const source = ordered[index];
    const target = ordered[index + step];
    if (search || !source || !target) return;
    const next = ordered.map(({ record, order }) => record.order === order ? record : { ...record, order });
    next[index] = { ...target.record, order: source.order };
    next[index + step] = { ...source.record, order: target.order };
    onChange(next);
  }

  return (
    <div className={classes['realms-record-editor']}>
      <div className={classes['realms-record-toolbar']}>
        {items.length > 0 && <RecordSearch value={query} onChange={changeSearch} />}
        <div className={classes['realms-actions']}>
          <Button type="button" variant="default" onClick={add} leftSection={<Plus size={16} aria-hidden="true" />}>{addLabel}</Button>
        </div>
      </div>
      {search && visible.length > 0 && items.length > 1 && <p className={classes['realms-muted']}>{t('realms.clearSearchToMove')}</p>}
      {visible.length === 0 ? <p className={classes['realms-muted']}>{items.length ? t('realms.noSectionResults') : emptyLabel}</p> : (
        <Accordion multiple className={classes['realms-records']} value={open} onChange={setOpen} transitionDuration={0}>
          {visible.map(({ record: item, order, index }) => {
            const expanded = openIds.has(item.id);
            const title = item.title.trim() || t('realms.untitled');
            const orderLabel = t('content' in item ? 'realms.contextOrder' : 'realms.listOrder');
            const change = (patch: Partial<T>) => onChange(items.map((record) => record.id === item.id ? { ...record, ...patch } : record));
            return (
            <Accordion.Item key={item.id} value={item.id}>
              <div className={classes['realms-record-summary']} data-open={expanded || undefined}>
                <Accordion.Control>
                  <span className={classes['realms-ordered-label']}>
                    <span className={classes['realms-order-number']} title={orderLabel} aria-hidden="true">{number.format(order)}</span>
                    <RecordLabel record={item} portrait={portrait} />
                  </span>
                </Accordion.Control>
                {items.length > 1 && <div className={classes['realms-move-actions']}>
                  <ActionIcon type="button" variant="default" size={36} disabled={Boolean(search) || index === 0}
                    aria-label={t('realms.moveUp', { title })} onClick={() => move(index, -1)}>
                    <ArrowUp size={16} aria-hidden="true" />
                  </ActionIcon>
                  <ActionIcon type="button" variant="default" size={36} disabled={Boolean(search) || index === ordered.length - 1}
                    aria-label={t('realms.moveDown', { title })} onClick={() => move(index, 1)}>
                    <ArrowDown size={16} aria-hidden="true" />
                  </ActionIcon>
                </div>}
              </div>
              <Accordion.Panel>
                {expanded && <div className={classes['realms-record-fields']} id={`${group}-${item.id}`}>
                  <TextInput key={order} className={classes['realms-order-field']} type="number" min={1} max={realmMaxOrder} step={1}
                    label={orderLabel} description={t('realms.orderHelp')} defaultValue={order}
                    onBlur={({ currentTarget }) => {
                      const next = currentTarget.valueAsNumber;
                      if (!isRealmOrder(next)) currentTarget.value = String(order);
                      else if (next !== order) change({ order: next } as Partial<T>);
                    }} onKeyDown={(event) => {
                      if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
                    }} />
                  {fields(item, change)}
                  <Button type="button" variant="subtle" color="red" className={classes['realms-remove-record']}
                    leftSection={<Trash2 size={16} aria-hidden="true" />}
                    onClick={() => { onChange(items.filter(({ id }) => id !== item.id), true); setOpen(open.filter((id) => id !== item.id)); }}>{t('common.delete')}</Button>
                </div>}
              </Accordion.Panel>
            </Accordion.Item>
            );
          })}
        </Accordion>
      )}
    </div>
  );
}

export function EntriesEditor({ entries, kind, invalidIndex, onChange }: {
  entries: RealmCharacter[];
  kind: 'character' | 'entry';
  invalidIndex?: number;
  onChange: ChangeRecords<RealmCharacter>;
}) {
  const { t } = useI18n();
  return (
    <RecordEditor<RealmCharacter> items={entries} portrait={kind === 'character'} addLabel={t(`realms.add.${kind}`)} emptyLabel={t('realms.empty.entries')}
      makeItem={() => ({ id: newRealmId(), title: '', content: '' })} invalidIndex={invalidIndex} onChange={onChange}
      fields={(entry, change) => (
        <>
          <TextInput label={t(`realms.title.${kind}`)} required value={entry.title}
            onChange={(event) => change({ title: event.currentTarget.value })} />
          {kind === 'character' && <>
            <AvatarEditor value={entry.avatar} characterId={entry.id} />
            <PromptTextarea scope="world" label={t('realms.characterSummary')} autosize minRows={5} maxRows={16} value={entry.summary ?? ''}
              onChange={(event) => change({ summary: event.currentTarget.value || undefined })} />
          </>}
          <PromptTextarea scope="world" label={t(kind === 'character' ? 'realms.characterContent' : 'realms.content')} required autosize
            minRows={kind === 'character' ? 12 : 6} maxRows={28} value={entry.content}
            onChange={(event) => change({ content: event.currentTarget.value })} />
        </>
      )} />
  );
}

function toggleId(ids: string[], id: string, checked: boolean) {
  return checked ? [...ids, id] : ids.filter((entry) => entry !== id);
}

function ReferencePicker({ label, entries, ids, onChange }: {
  label: string;
  entries: RealmEntry[];
  ids: string[];
  onChange: (ids: string[]) => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const selected = new Set(ids);
  const search = realmSearchKey(query.trim());
  const visible = orderedRealmRecords(entries).map(({ record }) => record).filter((entry) => recordMatches(entry, search));
  return entries.length > 0 && <fieldset className={classes['realms-reference-group']}>
    <legend>{label}</legend>
    {entries.length > 6 && <RecordSearch value={query} onChange={setQuery} label={t('realms.findInPart', { title: label })} />}
    <div className={classes['realms-reference-options']}>
      {visible.map((entry) => <Checkbox key={entry.id} label={entry.title.trim() || t('realms.untitled')}
        color="var(--kr-accent)" iconColor="var(--kr-accent-text)"
        checked={selected.has(entry.id)} onChange={(event) => onChange(toggleId(ids, entry.id, event.currentTarget.checked))} />)}
      {!visible.length && <p className={classes['realms-muted']}>{t('realms.noSectionResults')}</p>}
    </div>
  </fieldset>;
}

export function StartFields({ realm, start, onChange }: {
  realm: Realm;
  start: RealmStart;
  onChange: (patch: Partial<RealmStart>) => void;
}) {
  const { t, number } = useI18n();
  const characters = realm.characters ?? [];
  const lorebook = realm.lorebook ?? [];
  const sections = (realm.sections ?? []).filter((section) => section.entries.length);
  const refs = start.sectionEntries ?? [];
  const context = resolveRealmContext(realm, start);

  function changeSectionRefs(sectionId: string, ids: string[]) {
    const next: RealmSectionEntryRef[] = refs.filter((ref) => ref.sectionId !== sectionId);
    onChange({ sectionEntries: [...next, ...ids.map((entryId) => ({ sectionId, entryId }))] });
  }

  return (
    <>
      <TextInput label={t('realms.title.start')} required value={start.title}
        onChange={(event) => onChange({ title: event.currentTarget.value })} />
      <PromptTextarea scope="world" label={t('realms.scenario')} description={t('realms.scenarioHelp')} autosize minRows={3} maxRows={12}
        value={start.scenario ?? ''} onChange={(event) => onChange({ scenario: event.currentTarget.value || undefined })} />
      <PromptTextarea scope="world" label={t('realms.greeting')} description={t('realms.greetingHelp')} autosize minRows={3} maxRows={12}
        value={start.greeting ?? ''} onChange={(event) => onChange({ greeting: event.currentTarget.value || undefined })} />
      <div className={classes['realms-reference-picker']}>
        <h3>{t('realms.startContext')}</h3>
        {context.entries.length > 0 && <div className={classes['realms-context-order']}>
          <h4>{t('realms.contextQueue')}</h4>
          <ol aria-label={t('realms.contextQueue')}>
            {context.entries.map((entry) => (
              <li key={JSON.stringify([entry.source, entry.source === 'section' ? entry.sectionId : null, entry.id])}>
                <span className={classes['realms-order-number']}>{number.format(entry.order)}</span>
                <span>{entry.title || t('realms.untitled')}</span>
                <span className={classes['realms-muted']}>{entry.source === 'section' ? entry.sectionTitle
                  : t(entry.source === 'character' ? 'realms.part.characters' : 'realms.part.lorebook')}</span>
              </li>
            ))}
          </ol>
        </div>}
        {characters.length === 0 && lorebook.length === 0 && sections.length === 0 && <p className={classes['realms-muted']}>{t('realms.empty.context')}</p>}
        <ReferencePicker label={t('realms.part.characters')} entries={characters} ids={start.characterIds ?? []}
          onChange={(characterIds) => onChange({ characterIds })} />
        <ReferencePicker label={t('realms.part.lorebook')} entries={lorebook} ids={start.loreEntryIds ?? []}
          onChange={(loreEntryIds) => onChange({ loreEntryIds })} />
        {sections.map((section) => <ReferencePicker key={section.id} label={section.title} entries={section.entries}
          ids={refs.filter(({ sectionId }) => sectionId === section.id).map(({ entryId }) => entryId)}
          onChange={(ids) => changeSectionRefs(section.id, ids)} />)}
      </div>
    </>
  );
}
