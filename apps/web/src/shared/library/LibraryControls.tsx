import { Button, SegmentedControl } from '@mantine/core';
import { ChevronLeft, ChevronRight, LayoutGrid, List } from 'lucide-react';
import { useI18n } from '../i18n/i18n';
import type { LibraryView } from './viewPreference';
import classes from './Library.module.css';

export function LibraryViewSwitch({ view, onChange }: { view: LibraryView; onChange: (view: LibraryView) => void }) {
  const { t } = useI18n();
  return <div className={classes['library-view-options']}>
    <SegmentedControl<LibraryView> aria-label={t('library.view')} value={view} onChange={onChange}
      data={[
        { value: 'list', label: <span className={classes['library-view-label']}><List size={16} aria-hidden="true" />{t('library.view.list')}</span> },
        { value: 'grid', label: <span className={classes['library-view-label']}><LayoutGrid size={16} aria-hidden="true" />{t('library.view.grid')}</span> },
      ]} />
  </div>;
}

export function LibraryPagination({ label, offset, visible, total, pageSize, onPage }: {
  label: string;
  offset: number;
  visible: number;
  total: number;
  pageSize: number;
  onPage: (offset: number) => void;
}) {
  const { t, number } = useI18n();
  if (total <= pageSize) return null;
  return <nav className={classes['library-pagination']} aria-label={label}>
    <Button variant="default" disabled={offset === 0} leftSection={<ChevronLeft size={16} aria-hidden="true" />}
      onClick={() => onPage(Math.max(0, offset - pageSize))}>{t('library.previous')}</Button>
    <p>{t('library.range', {
      start: number.format(offset + 1), end: number.format(offset + visible), total: number.format(total),
    })}</p>
    <Button variant="default" disabled={offset + pageSize >= total} rightSection={<ChevronRight size={16} aria-hidden="true" />}
      onClick={() => onPage(offset + pageSize)}>{t('library.next')}</Button>
  </nav>;
}
