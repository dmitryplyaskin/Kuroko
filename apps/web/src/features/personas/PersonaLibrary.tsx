import { ActionIcon, Button, NativeSelect, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { defaultPersonaQuery, personaPageSize, personaSearchLimit, personaSorts, personaVariableFilters,
  type PersonaListQuery } from '@kuroko/contracts/personas';
import { useUnit } from 'effector-react';
import { Check, Play, Plus, Search, SlidersHorizontal, Star, UserRound } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import type { ActiveSession } from '../../platform/session/model';
import { useI18n } from '../../shared/i18n/i18n';
import { LibraryPagination, LibraryViewSwitch } from '../../shared/library/LibraryControls';
import { LibraryAvatar, LibraryFavoriteButton, LibraryItem } from '../../shared/library/LibraryItem';
import library from '../../shared/library/Library.module.css';
import { personaCreated, personaOpened } from './editorModel';
import {
  $personaCriteria, $personaFavorite, $personaList, listPersonasFx, personaCriteriaChanged, personaFavoriteChanged, personaPageChanged,
} from './libraryModel';
import { personaLibraryView } from './module';
import { personaPath } from './requests';
import { $personaSelection, personaSelectionOpened, personaSelectionRequested } from './selectionModel';
import classes from './Personas.module.css';

export function PersonaLibrary({ session }: { session: ActiveSession }) {
  const { t, number, plural } = useI18n();
  const { criteria, change, page, state, load, create, open, favorite, setFavorite } = useUnit({
    criteria: $personaCriteria, change: personaCriteriaChanged, page: personaPageChanged, state: $personaList,
    load: listPersonasFx, create: personaCreated, open: personaOpened, favorite: $personaFavorite, setFavorite: personaFavoriteChanged,
  });
  const [view, changeView] = useUnit([personaLibraryView.$value, personaLibraryView.changed]);
  const [selection, readSelection, selectPersona] = useUnit([$personaSelection, personaSelectionOpened, personaSelectionRequested]);
  const [debounced] = useDebouncedValue(criteria.q, 220);
  const [retry, setRetry] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const panelId = useId();
  const searching = criteria.q !== debounced;

  useEffect(() => {
    readSelection();
    window.addEventListener('focus', readSelection);
    return () => window.removeEventListener('focus', readSelection);
  }, [readSelection, session]);

  useEffect(() => {
    if (searching) return;
    const controller = new AbortController();
    void load({ session, signal: controller.signal, query: criteria }).catch(() => {});
    return () => controller.abort();
  }, [session, criteria, load, retry, searching]);

  const matching = state?.request.session === session && state.request.query === criteria && !searching ? state : null;
  const data = matching?.status === 'error' ? undefined : matching?.data;
  const hasVariableFilter = criteria.variables !== 'any';
  const narrowed = Boolean(criteria.q.trim() || criteria.favorites || hasVariableFilter);
  const filterLabel = hasVariableFilter ? t('library.filtersCount', { count: number.format(1) }) : t('library.filters');

  return <>
    <header className={`page-heading ${library['library-heading']}`}>
      <h1 tabIndex={-1}>{t('personas.label')}</h1>
      <Button leftSection={<Plus size={16} aria-hidden="true" />} onClick={create}>{t('personas.create')}</Button>
    </header>
    <div className={library['library-panel']}>
      <div className={library['library-toolbar']}>
        <TextInput type="search" aria-label={t('personas.search')} placeholder={t('personas.searchPlaceholder')}
          leftSection={<Search size={16} aria-hidden="true" />} maxLength={personaSearchLimit} value={criteria.q}
          onChange={(event) => change({ q: event.currentTarget.value })} />
        <div className={library['library-toolbar-options']}>
          <NativeSelect aria-label={t('personas.sort')} value={criteria.sort}
            data={personaSorts.map((value) => ({ value, label: t(`personas.sort.${value}`) }))}
            onChange={(event) => change({ sort: event.currentTarget.value as PersonaListQuery['sort'] })} />
          <ActionIcon type="button" variant="default" size={40} className={library['library-filter-toggle']}
            aria-label={filterLabel} title={filterLabel} aria-expanded={filtersOpen} aria-controls={panelId}
            data-selected={filtersOpen || hasVariableFilter || undefined} onClick={() => setFiltersOpen((value) => !value)}>
            <SlidersHorizontal size={18} aria-hidden="true" />
          </ActionIcon>
          <ActionIcon type="button" variant="default" size={40} className={library['library-filter-toggle']}
            aria-label={t('personas.favorites')} title={t('personas.favorites')} aria-pressed={criteria.favorites}
            data-selected={criteria.favorites || undefined} onClick={() => change({ favorites: !criteria.favorites })}>
            <Star size={18} fill={criteria.favorites ? 'currentColor' : 'none'} aria-hidden="true" />
          </ActionIcon>
        </div>
        <LibraryViewSwitch view={view} onChange={changeView} />
      </div>
      <div id={panelId} hidden={!filtersOpen}>
        <div className={library['library-filters-panel']}>
          <NativeSelect className={classes.variableFilter} label={t('personas.filterVariables')} value={criteria.variables}
            data={personaVariableFilters.map((value) => ({ value, label: t(`personas.filter.${value}`) }))}
            onChange={(event) => change({ variables: event.currentTarget.value as PersonaListQuery['variables'] })} />
        </div>
      </div>
      {favorite.error && <p className={library['library-message']} role="alert">{t(`error.${favorite.error}`)}</p>}
      {selection.error && <div className={`${library['library-message']} ${library['library-state']}`}>
        <p className={classes.error} role="alert">{t(`error.${selection.error}`)}</p>
        <Button variant="default" onClick={readSelection}>{t('common.retryLoad')}</Button>
      </div>}
      <div className={library['library-results']} aria-busy={!matching || matching.status === 'loading'}>
        {(!matching || (matching.status === 'loading' && !data)) && <output className={library['library-message']}>{t('personas.loading')}</output>}
        {matching?.status === 'error' && <div className={`${library['library-message']} ${library['library-state']}`}>
          <p className={classes.error} role="alert">{t(`error.${matching.error}`)}</p>
          <Button variant="default" onClick={() => setRetry((value) => value + 1)}>{t('common.retryLoad')}</Button>
        </div>}
        {data?.total === 0 && <div className={`${library['library-message']} ${library['library-state']}`}>
          <h2>{t(narrowed ? 'personas.noResults' : 'personas.empty')}</h2>
          {narrowed ? <Button variant="default" onClick={() => change(defaultPersonaQuery)}>{t('personas.resetSearch')}</Button>
            : <p>{t('personas.emptyHelp')}</p>}
        </div>}
        {data && data.items.length > 0 && <>
          <ul className={library['library-list']} data-view={view} aria-label={t('personas.label')}>
            {data.items.map(({ id, revision, name, excerpt, hasAvatar, variableCount, favorite: starred }) => {
              const active = selection.id === id;
              return <LibraryItem key={id} title={name} excerpt={excerpt} openLabel={t('personas.openNamed', { name })} onOpen={() => open(id)}
                avatar={<LibraryAvatar lazy placeholder={<UserRound size={20} />}
                  src={hasAvatar ? `/api${personaPath(id)}/avatar?v=${revision}` : undefined} />}
                metadata={<>
                  {active && <span className={classes.activeIndicator}>{t('personas.active')}</span>}
                  <span>{t(`personas.variableCount.${plural.select(variableCount)}`, { count: number.format(variableCount) })}</span>
                </>}
                actions={<>
                  <ActionIcon type="button" variant="subtle" size={44} className={classes.personaAction} aria-pressed={active}
                    aria-label={t('personas.selectNamed', { name })} title={t(active ? 'personas.clearSelection' : 'personas.select')}
                    loading={selection.savingId === id} disabled={selection.id === undefined || Boolean(selection.pending && selection.savingId !== id)}
                    onClick={() => selectPersona(id)}>
                    {active ? <Check size={19} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
                  </ActionIcon>
                  <LibraryFavoriteButton favorite={starred} pending={favorite.pendingId === id}
                    disabled={matching?.status !== 'ready' || (favorite.pendingId !== undefined && favorite.pendingId !== id)}
                    label={t('personas.favoriteNamed', { name })} title={t(starred ? 'library.removeFavorite' : 'library.addFavorite')}
                    onClick={() => setFavorite({ id, favorite: !starred })} />
                </>} />;
            })}
          </ul>
          <LibraryPagination label={t('personas.pagination')} offset={data.offset} visible={data.items.length}
            total={data.total} pageSize={personaPageSize} onPage={page} />
        </>}
      </div>
    </div>
  </>;
}
