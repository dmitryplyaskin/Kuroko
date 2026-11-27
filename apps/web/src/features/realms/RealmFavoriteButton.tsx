import { useUnit } from 'effector-react';
import { useI18n } from '../../shared/i18n/i18n';
import { LibraryFavoriteButton } from '../../shared/library/LibraryItem';
import { $realmFavoritesPending, realmFavoriteRequested } from './model';

export function RealmFavoriteButton({ id, title, favorite, disabled }: {
  id: string;
  title: string;
  favorite: boolean;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [pending, toggle] = useUnit([$realmFavoritesPending, realmFavoriteRequested]);

  return <LibraryFavoriteButton favorite={favorite} pending={pending.has(id)} disabled={disabled}
    label={t('realms.favoriteFor', { title })} title={t(favorite ? 'library.removeFavorite' : 'library.addFavorite')}
    onClick={() => toggle({ id, favorite: !favorite })} />;
}
