import { Button, NativeSelect, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { realmPageSize, realmSearchMaxLength, realmSorts, type RealmSort, type RealmSummary } from '@kuroko/contracts/realms';
import { useUnit } from 'effector-react';
import { ChevronLeft, ChevronRight, Plus, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ActiveSession } from '../../platform/session/model';
import { useI18n } from '../../shared/i18n/i18n';
import { $realmList, listRealmsFx } from './model';
import { RealmAvatar } from './RealmAvatar';

export type LibraryCriteria = { q: string; sort: RealmSort; offset: number };

export function RealmLibrary({ session, criteria, onCriteria, onOpen, onCreate }: {
  session: ActiveSession;
  criteria: LibraryCriteria;
  onCriteria: (criteria: LibraryCriteria) => void;
  onOpen: (id: string) => void;
  onCreate: () => void;
}) {
  const { t, number } = useI18n();
  const [state, list] = useUnit([$realmList, listRealmsFx]);
  const [retry, setRetry] = useState(0);
  const { q, sort, offset } = criteria;
  const [query] = useDebouncedValue(q.trim(), 220);
  const searching = query !== q.trim();

  useEffect(() => {
    if (searching) return;
    const controller = new AbortController();
    void list({ session, signal: controller.signal, query: { q: query, sort, offset, limit: realmPageSize } }).catch(() => {});
    return () => controller.abort();
  }, [list, session, searching, query, sort, offset, retry]);

  const matching = state?.params.session === session && state.params.query.q === query &&
    state.params.query.sort === sort && state.params.query.offset === offset && !searching ? state : null;
  const data = matching?.status === 'ready' ? matching.data : null;

  useEffect(() => {
    if (data && offset > 0 && offset >= data.total) {
      onCriteria({ q, sort, offset: Math.floor(Math.max(0, data.total - 1) / realmPageSize) * realmPageSize });
    }
  }, [data, offset, onCriteria, q, sort]);

  return (
    <>
      <header className="page-heading realms-heading">
        <h1 tabIndex={-1}>{t('realms.label')}</h1>
        <Button className="realms-heading-actions" onClick={onCreate}
          leftSection={<Plus size={16} aria-hidden="true" />}>{t('realms.create')}</Button>
      </header>
      <div className="realms-library">
        <div className="realms-toolbar">
          <TextInput type="search" aria-label={t('realms.search')} placeholder={t('realms.search')}
            maxLength={realmSearchMaxLength} value={q} leftSection={<Search size={16} aria-hidden="true" />}
            onChange={(event) => onCriteria({ q: event.currentTarget.value, sort, offset: 0 })} />
          <NativeSelect aria-label={t('realms.sort')} value={sort}
            data={realmSorts.map((value) => ({ value, label: t(`realms.sort.${value}`) }))}
            onChange={(event) => onCriteria({ q, sort: event.currentTarget.value as RealmSort, offset: 0 })} />
        </div>
        <div className="realms-results" aria-busy={!matching || matching.status === 'loading'}>
          {(!matching || matching.status === 'loading') && <output className="realms-message">{t('realms.loading')}</output>}
          {matching?.status === 'error' && <div className="realms-message realms-state">
            <p role="alert">{t(`error.${matching.code}`)}</p>
            <Button variant="default" onClick={() => setRetry((value) => value + 1)}>{t('common.retryLoad')}</Button>
          </div>}
          {data?.total === 0 && <div className="realms-message realms-state">
            <h2>{t(query ? 'realms.noResults' : 'realms.empty')}</h2>
            {query ? <Button variant="default" onClick={() => onCriteria({ q: '', sort, offset: 0 })}>{t('realms.clearSearch')}</Button>
              : <p>{t('realms.description')}</p>}
          </div>}
          {data && data.items.length > 0 && (
            <>
              <ul className="realms-list" aria-label={t('realms.label')}>
                {data.items.map((item) => <RealmRow key={item.id} item={item} onOpen={() => onOpen(item.id)} />)}
              </ul>
              {data.total > realmPageSize && <nav className="realms-pagination" aria-label={t('realms.pagination')}>
                <Button variant="default" disabled={offset === 0} leftSection={<ChevronLeft size={16} aria-hidden="true" />}
                  onClick={() => onCriteria({ q, sort, offset: Math.max(0, offset - realmPageSize) })}>{t('realms.previous')}</Button>
                <p>{t('realms.range', {
                  start: number.format(offset + 1), end: number.format(offset + data.items.length), total: number.format(data.total),
                })}</p>
                <Button variant="default" disabled={offset + realmPageSize >= data.total}
                  rightSection={<ChevronRight size={16} aria-hidden="true" />}
                  onClick={() => onCriteria({ q, sort, offset: offset + realmPageSize })}>{t('realms.next')}</Button>
              </nav>}
            </>
          )}
        </div>
      </div>
    </>
  );
}

function RealmRow({ item, onOpen }: { item: RealmSummary; onOpen: () => void }) {
  const { t, number, locale } = useI18n();
  const modified = new Date(item.updatedAt);
  return (
    <li>
      <button type="button" className="realms-row" onClick={onOpen}>
        <RealmAvatar src={item.hasAvatar ? `/api/realms/${encodeURIComponent(item.id)}/avatar` : undefined} kind="realm" />
        <span className="realms-row-copy">
          <strong>{item.title}</strong>
          <span className="realms-row-excerpt">{item.excerpt}</span>
        </span>
        <span className="realms-row-meta">
          <span>{t('realms.contents', { characters: number.format(item.characters), starts: number.format(item.starts) })}</span>
          <time dateTime={modified.toISOString()}>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(modified)}</time>
        </span>
        <ChevronRight size={16} aria-hidden="true" />
      </button>
    </li>
  );
}
