import { Button, MultiSelect, NativeSelect, Select } from '@mantine/core';
import { defaultRealmFilters, realmStartsFilters, type RealmFilterOption, type RealmFilters } from '@kuroko/contracts/realms';
import { useUnit } from 'effector-react';
import { useEffect } from 'react';
import { useI18n } from '../../shared/i18n/i18n';
import { $realmFilterOptions, realmFiltersClosed, realmFiltersOpened, realmFiltersRetried } from './model';
import classes from './Realms.module.css';

export function advancedRealmFilterCount({ author, tags, starts }: RealmFilters) {
  return Number(Boolean(author)) + tags.length + Number(starts !== 'any');
}

function keepSelected(options: RealmFilterOption[], selected: readonly string[]) {
  return [...options, ...selected.filter((value) => value && !options.some((option) => option.value === value))
    .map((value) => ({ value, label: value }))];
}

export function RealmFiltersPanel({ filters, onChange }: {
  filters: RealmFilters;
  onChange: (filters: RealmFilters) => void;
}) {
  const { t } = useI18n();
  const [state, open, close, retry] = useUnit([$realmFilterOptions, realmFiltersOpened, realmFiltersClosed, realmFiltersRetried]);
  const options = state?.status === 'ready' ? state.data : undefined;

  useEffect(() => {
    open();
    return close;
  }, [open, close]);

  return (
    <div className={classes['realms-filters-panel']}>
      <div className={classes['realms-filter-fields']}>
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
      {state?.status === 'error' && <div className={classes['realms-filter-error']}>
        <p role="alert">{t(`error.${state.code}`)}</p>
        <Button type="button" variant="default" onClick={retry}>{t('common.retryLoad')}</Button>
      </div>}
      {advancedRealmFilterCount(filters) > 0 && <div className={classes['realms-actions']}>
        <Button type="button" variant="subtle" onClick={() => onChange({ ...defaultRealmFilters, favorites: filters.favorites })}>
          {t('realms.clearFilters')}
        </Button>
      </div>}
    </div>
  );
}
