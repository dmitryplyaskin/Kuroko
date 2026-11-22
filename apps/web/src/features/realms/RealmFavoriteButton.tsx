import { ActionIcon } from '@mantine/core';
import { useUnit } from 'effector-react';
import { Star } from 'lucide-react';
import { useState } from 'react';
import type { ActiveSession } from '../../platform/session/model';
import { errorCode, type ErrorCode } from '../../shared/http/api';
import { useI18n } from '../../shared/i18n/i18n';
import { setRealmFavoriteFx } from './model';

export function RealmFavoriteButton({ session, id, title, favorite, disabled, onChanged, onError }: {
  session: ActiveSession;
  id: string;
  title: string;
  favorite: boolean;
  disabled?: boolean;
  onChanged?: (favorite: boolean) => void;
  onError: (error: ErrorCode | null) => void;
}) {
  const { t } = useI18n();
  const setFavorite = useUnit(setRealmFavoriteFx);
  const [pending, setPending] = useState(false);

  async function toggle() {
    if (pending) return;
    onError(null);
    setPending(true);
    try {
      const result = await setFavorite({ session, id, favorite: !favorite });
      if (!session.signal.aborted) onChanged?.(result.favorite);
    } catch (error) {
      if (!session.signal.aborted) onError(errorCode(error));
    } finally {
      if (!session.signal.aborted) setPending(false);
    }
  }

  return (
    <ActionIcon type="button" className="realms-favorite" variant="subtle" size={44} loading={pending} disabled={disabled}
      aria-pressed={favorite} aria-label={t('realms.favoriteFor', { title })}
      title={t(favorite ? 'realms.removeFavorite' : 'realms.addFavorite')} onClick={() => void toggle()}>
      <Star size={19} fill={favorite ? 'currentColor' : 'none'} aria-hidden="true" />
    </ActionIcon>
  );
}
