import { Button, MultiSelect, NativeSelect, Select } from '@mantine/core';
import { defaultRealmFilters, realmStartsFilters, type RealmFilterOption, type RealmFilterOptions, type RealmFilters } from '@kuroko/contracts/realms';
import { useUnit } from 'effector-react';
import { useEffect, useState } from 'react';
import type { ActiveSession } from '../../platform/session/model';
import { errorCode, type ErrorCode } from '../../shared/http/api';
import { useI18n } from '../../shared/i18n/i18n';
import { loadRealmFiltersFx } from './model';

export function advancedRealmFilterCount({ author, tags, starts }: RealmFilters) {
  return Number(Boolean(author)) + tags.length + Number(starts !== 'any');
}

function keepSelected(options: RealmFilterOption[], selected: readonly string[]) {
  return [...options, ...selected.filter((value) => value && !options.some((option) => option.value === value))
    .map((value) => ({ value, label: value }))];
}

export function RealmFiltersPanel({ session, filters, onChange }: {
  session: ActiveSession;
  filters: RealmFilters;
  onChange: (filters: RealmFilters) => void;
}) {
  const { t } = useI18n();
  const load = useUnit(loadRealmFiltersFx);
  const [options, setOptions] = useState<RealmFilterOptions | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    void load({ session, signal }).then((result) => {
      if (!signal.aborted && !session.signal.aborted) setOptions(result);
    }, (issue: unknown) => {
      if (!signal.aborted && !session.signal.aborted) setError(errorCode(issue));
    });
    return () => controller.abort();
  }, [load, retry, session]);

  return (
    <div className="realms-filters-panel">
      <div className="realms-filter-fields">
        <MultiSelect label={t('realms.tags')} data={keepSelected(options?.tags ?? [], filters.tags)} value={[...filters.tags]}
          searchable clearable clearButtonProps={{ 'aria-label': t('realms.clearTags') }}
          placeholder={filters.tags.length ? undefined : t('realms.anyTags')}
          nothingFoundMessage={t('realms.noFilterOptions')} disabled={!options}
          onChange={(tags) => onChange({ ...filters, tags })} />
        <Select label={t('realms.author')} data={keepSelected(options?.authors ?? [], [filters.author])} value={filters.author || null}
          searchable clearable clearButtonProps={{ 'aria-label': t('realms.clearAuthor') }}
          placeholder={t('realms.anyAuthor')} nothingFoundMessage={t('realms.noFilterOptions')}
          disabled={!options} onChange={(author) => onChange({ ...filters, author: author ?? '' })} />
        <NativeSelect label={t('realms.part.starts')} value={filters.starts}
          data={realmStartsFilters.map((value) => ({ value, label: t(`realms.filterStarts.${value}`) }))}
          onChange={(event) => {
            const starts = realmStartsFilters.find((value) => value === event.currentTarget.value);
            if (starts) onChange({ ...filters, starts });
          }} />
      </div>
      {error && <div className="realms-filter-error">
        <p role="alert">{t(`error.${error}`)}</p>
        <Button type="button" variant="default" onClick={() => { setError(null); setRetry((value) => value + 1); }}>{t('common.retryLoad')}</Button>
      </div>}
      {advancedRealmFilterCount(filters) > 0 && <div className="realms-actions">
        <Button type="button" variant="subtle" onClick={() => onChange({ ...defaultRealmFilters, favorites: filters.favorites })}>
          {t('realms.clearFilters')}
        </Button>
      </div>}
    </div>
  );
}
