import { TextInput } from '@mantine/core';
import { realmSearchKey, realmSearchMaxLength, type RealmCharacter, type RealmStart } from '@kuroko/contracts/realms';
import { Search } from 'lucide-react';
import { useI18n } from '../../shared/i18n/i18n';
import { RealmAvatar } from './RealmAvatar';
import classes from './Realms.module.css';

export type RealmRecord = RealmCharacter | RealmStart;

export function recordMatches(record: RealmRecord, search: string) {
  if (!search) return true;
  const content = 'content' in record ? [record.summary, record.content] : [record.scenario, record.greeting];
  return [record.title, ...content].some((value) => value && realmSearchKey(value).includes(search));
}

export function RecordSearch({ value, onChange, label }: { value: string; onChange: (value: string) => void; label?: string }) {
  const { t } = useI18n();
  const placeholder = t('realms.searchSection');
  return <TextInput type="search" aria-label={label ?? placeholder} placeholder={placeholder}
    maxLength={realmSearchMaxLength} value={value} leftSection={<Search size={16} aria-hidden="true" />}
    onChange={(event) => onChange(event.currentTarget.value)} />;
}

export function RecordLabel({ record, portrait }: { record: RealmRecord; portrait: boolean }) {
  const { t } = useI18n();
  const excerpt = 'content' in record ? record.summary || record.content : record.greeting || record.scenario;
  return (
    <span className={classes['realms-record-label']}>
      {portrait && <RealmAvatar src={'content' in record ? record.avatar : undefined} kind="character" />}
      <span className={classes['realms-record-label-text']}>
        <strong>{record.title.trim() || t('realms.untitled')}</strong>
        {excerpt?.trim() && <span aria-hidden="true">{excerpt.trim()}</span>}
      </span>
    </span>
  );
}
