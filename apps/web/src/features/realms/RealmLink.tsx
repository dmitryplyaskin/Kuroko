import { UnstyledButton } from '@mantine/core';
import { useI18n } from '../../shared/i18n/i18n';
import classes from './RealmLink.module.css';

export function RealmLink({ title, disabled, onClick, className }: {
  title: string; disabled: boolean; onClick: () => void; className?: string;
}) {
  const { t } = useI18n();
  return <UnstyledButton type="button" className={className ? `${classes.link} ${className}` : classes.link}
    disabled={disabled} onClick={onClick}>
    {t('realms.reference', { title })}
  </UnstyledButton>;
}
