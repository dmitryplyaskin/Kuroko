import { ActionIcon } from '@mantine/core';
import { useUnit } from 'effector-react';
import { Star } from 'lucide-react';
import { useI18n } from '../../shared/i18n/i18n';
import { $realmFavoritesPending, realmFavoriteRequested } from './model';
import classes from './Realms.module.css';

export function RealmFavoriteButton({ id, title, favorite, disabled }: {
  id: string;
  title: string;
  favorite: boolean;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [pending, toggle] = useUnit([$realmFavoritesPending, realmFavoriteRequested]);

  return (
    <ActionIcon type="button" className={classes['realms-favorite']} variant="subtle" size={44} loading={pending.has(id)} disabled={disabled}
      aria-pressed={favorite} aria-label={t('realms.favoriteFor', { title })}
      title={t(favorite ? 'realms.removeFavorite' : 'realms.addFavorite')} onClick={() => toggle({ id, favorite: !favorite })}>
      <Star size={19} fill={favorite ? 'currentColor' : 'none'} aria-hidden="true" />
    </ActionIcon>
  );
}
