import { ActionIcon, Button, FileButton, Modal, NativeSelect, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { defaultRealmFilters, realmPageSize, realmSearchMaxLength, realmSorts, type RealmFilters,
  type RealmSort, type RealmSummary } from '@kuroko/contracts/realms';
import { useUnit } from 'effector-react';
import { MessageSquare, Plus, Search, SlidersHorizontal, Star, Upload } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { ActiveSession } from '../../platform/session/model';
import { useI18n } from '../../shared/i18n/i18n';
import { LibraryPagination, LibraryViewSwitch } from '../../shared/library/LibraryControls';
import { LibraryItem } from '../../shared/library/LibraryItem';
import library from '../../shared/library/Library.module.css';
import { $chatLocked, realmChatCreateRequested } from '../chat/model';
import { $realmFavoriteError, $realmList, listRealmsFx } from './model';
import { $realmImport, realmImportConflictClosed, realmImportCopyRequested, realmImportPicked } from './libraryModel';
import { realmLibraryView } from './module';
import { RealmAvatar } from './RealmAvatar';
import { RealmFavoriteButton } from './RealmFavoriteButton';
import { advancedRealmFilterCount, RealmFiltersPanel } from './RealmFiltersPanel';
import classes from './Realms.module.css';

export type LibraryCriteria = { q: string; sort: RealmSort; offset: number; filters: RealmFilters };

export function RealmLibrary({ session, criteria, onCriteria, onOpen, onCreate }: {
  session: ActiveSession;
  criteria: LibraryCriteria;
  onCriteria: (criteria: LibraryCriteria) => void;
  onOpen: (id: string) => void;
  onCreate: () => void;
}) {
  const { t, number } = useI18n();
  const { state, list, importState, pick, saveCopy, closeCopy, favoriteError, chatLocked, createChat } = useUnit({
    state: $realmList, list: listRealmsFx, importState: $realmImport, pick: realmImportPicked,
    saveCopy: realmImportCopyRequested, closeCopy: realmImportConflictClosed, favoriteError: $realmFavoriteError,
    chatLocked: $chatLocked, createChat: realmChatCreateRequested,
  });
  const { pending: importing, issue: importIssue, copy } = importState;
  const [view, changeView] = useUnit([realmLibraryView.$value, realmLibraryView.changed]);
  const [retry, setRetry] = useState(0);
  const resetFile = useRef<() => void>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const panelId = useId();
  const { q, sort, offset, filters } = criteria;
  const [query] = useDebouncedValue(q.trim(), 220);
  const searching = query !== q.trim();
  const filterCount = advancedRealmFilterCount(filters);
  const narrowed = Boolean(query || filterCount || filters.favorites);
  const filterLabel = filterCount ? t('library.filtersCount', { count: number.format(filterCount) }) : t('library.filters');
  const favoritesLabel = t('realms.favorites');

  useEffect(() => {
    if (searching) return;
    const controller = new AbortController();
    void list({ session, signal: controller.signal, query: { q: query, sort, offset, limit: realmPageSize, filters } }).catch(() => {});
    return () => controller.abort();
  }, [list, session, searching, query, sort, offset, filters, retry]);

  const matching = state?.params.session === session && state.params.query.q === query &&
    state.params.query.sort === sort && state.params.query.offset === offset && state.params.query.filters === filters && !searching ? state : null;
  const data = matching && matching.status !== 'error' ? matching.data : undefined;

  useEffect(() => {
    if (matching?.status === 'ready' && offset > 0 && offset >= matching.data.total) {
      onCriteria({ ...criteria, offset: Math.floor(Math.max(0, matching.data.total - 1) / realmPageSize) * realmPageSize });
    }
  }, [criteria, matching, offset, onCriteria]);

  function changeFilters(filters: RealmFilters) {
    onCriteria({ ...criteria, filters, offset: 0 });
  }

  function pickFile(file: File | null) {
    if (!file) return;
    resetFile.current?.();
    pick({ file, labels: {
      start: t('realms.importStart'),
      alternateStart: (index) => t('realms.importAlternateStart', { number: number.format(index) }),
    } });
  }

  const error = importIssue && <p className={[classes['realms-error'], classes['realms-save-error']].join(' ')} role="alert">
    {t(`error.${importIssue.code}`)} {importIssue.field && <code>{importIssue.field}</code>}
  </p>;

  return (
    <>
      <header className={['page-heading', library['library-heading']].join(' ')}>
        <h1 tabIndex={-1}>{t('realms.label')}</h1>
        <div className={[classes['realms-actions'], classes['realms-heading-actions']].join(' ')}>
          <FileButton accept=".json,application/json,.png,image/png" resetRef={resetFile} onChange={pickFile}>
            {(props) => <Button {...props} variant="default" loading={importing && !copy}
              leftSection={<Upload size={16} aria-hidden="true" />}>{t('realms.import')}</Button>}
          </FileButton>
          <Button onClick={onCreate} disabled={importing} leftSection={<Plus size={16} aria-hidden="true" />}>{t('realms.create')}</Button>
        </div>
      </header>
      {!copy && error}
      {favoriteError && data?.items.some(({ id }) => id === favoriteError.id) && <p className={[classes['realms-error'], classes['realms-save-error']].join(' ')} role="alert">{t(`error.${favoriteError.code}`)}</p>}
      <div className={library['library-panel']}>
        <div className={library['library-toolbar']}>
          <TextInput type="search" aria-label={t('realms.search')} placeholder={t('realms.searchPlaceholder')}
            maxLength={realmSearchMaxLength} value={q} leftSection={<Search size={16} aria-hidden="true" />}
            onChange={(event) => onCriteria({ ...criteria, q: event.currentTarget.value, offset: 0 })} />
          <div className={library['library-toolbar-options']}>
            <NativeSelect aria-label={t('realms.sort')} value={sort}
              data={realmSorts.map((value) => ({ value, label: t(`realms.sort.${value}`) }))}
              onChange={(event) => onCriteria({ ...criteria, sort: event.currentTarget.value as RealmSort, offset: 0 })} />
            <ActionIcon type="button" variant="default" size={40} className={library['library-filter-toggle']} aria-label={filterLabel} title={filterLabel}
              aria-expanded={filtersOpen} aria-controls={panelId} data-selected={filtersOpen || filterCount > 0 || undefined}
              onClick={() => setFiltersOpen((open) => !open)}>
              <SlidersHorizontal size={18} aria-hidden="true" />
            </ActionIcon>
            <ActionIcon type="button" variant="default" size={40} className={library['library-filter-toggle']} aria-label={favoritesLabel} title={favoritesLabel}
              aria-pressed={filters.favorites} data-selected={filters.favorites || undefined}
              onClick={() => changeFilters({ ...filters, favorites: !filters.favorites })}>
              <Star size={18} fill={filters.favorites ? 'currentColor' : 'none'} aria-hidden="true" />
            </ActionIcon>
          </div>
          <LibraryViewSwitch view={view} onChange={changeView} />
        </div>
        <div id={panelId} hidden={!filtersOpen}>
          {filtersOpen && <RealmFiltersPanel filters={filters} onChange={changeFilters} />}
        </div>
        <div className={library['library-results']} aria-busy={!matching || matching.status === 'loading'}>
          {(!matching || (matching.status === 'loading' && !data)) && <output className={library['library-message']}>{t('realms.loading')}</output>}
          {matching?.status === 'error' && <div className={[library['library-message'], library['library-state']].join(' ')}>
            <p role="alert">{t(`error.${matching.code}`)}</p>
            <Button variant="default" onClick={() => setRetry((value) => value + 1)}>{t('common.retryLoad')}</Button>
          </div>}
          {data?.total === 0 && <div className={[library['library-message'], library['library-state']].join(' ')}>
            <h2>{t(query || filterCount ? 'realms.noResults' : filters.favorites ? 'realms.noFavorites' : 'realms.empty')}</h2>
            {narrowed ? <Button variant="default" onClick={() => onCriteria({ ...criteria, q: '', offset: 0, filters: defaultRealmFilters })}>
              {t(filterCount || filters.favorites ? 'realms.resetSearch' : 'realms.clearSearch')}
            </Button>
              : <p>{t('realms.description')}</p>}
          </div>}
          {data && data.items.length > 0 && (
            <>
              <ul className={library['library-list']} data-view={view} aria-label={t('realms.label')}>
                {data.items.map((item) => <RealmLibraryItem key={item.id} item={item} disabled={importing}
                  chatLocked={chatLocked} onOpen={() => onOpen(item.id)} onChat={() => {
                    createChat(item.id);
                    window.location.hash = '#chat';
                  }} />)}
              </ul>
              <LibraryPagination label={t('realms.pagination')} offset={offset} visible={data.items.length} total={data.total}
                pageSize={realmPageSize} onPage={(next) => onCriteria({ ...criteria, offset: next })} />
            </>
          )}
        </div>
      </div>
      <Modal opened={copy !== undefined} onClose={closeCopy} title={t('realms.importConflictTitle')}
        closeButtonProps={{ 'aria-label': t('common.close') }} closeOnEscape={!importing} closeOnClickOutside={!importing} withCloseButton={!importing}>
        <p>{t('realms.importConflictBody', { title: copy?.title ?? '' })}</p>
        {error}
        <div className={classes['realms-modal-actions']}>
          <Button variant="default" data-autofocus disabled={importing} onClick={closeCopy}>{t('common.cancel')}</Button>
          <Button loading={importing} onClick={saveCopy}>{t('realms.importCopy')}</Button>
        </div>
      </Modal>
    </>
  );
}

function RealmLibraryItem({ item, disabled, chatLocked, onOpen, onChat }: {
  item: RealmSummary;
  disabled: boolean;
  chatLocked: boolean;
  onOpen: () => void;
  onChat: () => void;
}) {
  const { t, number, locale } = useI18n();
  const modified = new Date(item.updatedAt);
  return <LibraryItem title={item.title} excerpt={item.excerpt} tags={item.tags} disabled={disabled} onOpen={onOpen}
    avatar={<RealmAvatar src={item.hasAvatar ? `/api/realms/${encodeURIComponent(item.id)}/avatar` : undefined} kind="realm" lazy />}
    metadata={<>
      <span className={library['library-item-counts']}>
        <span>{t('realms.part.characters')} {number.format(item.characters)}</span>
        <span>{t('realms.part.starts')} {number.format(item.starts)}</span>
      </span>
      <time dateTime={modified.toISOString()}>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(modified)}</time>
    </>}
    actions={<>
      <ActionIcon type="button" variant="subtle" size={44} className={classes['realms-start-chat']}
        disabled={disabled || chatLocked} aria-label={t('realms.startChatNamed', { title: item.title })}
        title={t('realms.startChat')} onClick={onChat}>
        <MessageSquare size={19} aria-hidden="true" />
      </ActionIcon>
      <RealmFavoriteButton id={item.id} title={item.title} favorite={Boolean(item.favorite)} disabled={disabled} />
    </>} />;
}
