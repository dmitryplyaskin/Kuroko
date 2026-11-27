import { Button, FileButton, Modal } from '@mantine/core';
import { Globe, ImagePlus, UserRound, ZoomIn } from 'lucide-react';
import { useRef, useState } from 'react';
import { useUnit } from 'effector-react';
import { useI18n } from '../../shared/i18n/i18n';
import { LibraryAvatar } from '../../shared/library/LibraryItem';
import { $realmAvatarOperation, realmAvatarRemoved, realmAvatarSelected } from './model';
import { avatarFormats } from '../../shared/avatar/avatarFile';
import classes from './Realms.module.css';

type AvatarKind = 'realm' | 'character';

export function RealmAvatar({ src, kind, lazy }: { src?: string; kind: AvatarKind; lazy?: boolean }) {
  const Icon = kind === 'realm' ? Globe : UserRound;
  return <LibraryAvatar src={src} placeholder={<Icon size={20} />} lazy={lazy} className={classes['realms-avatar']} />;
}

export function PreviewableRealmAvatar({ src, kind }: { src?: string; kind: AvatarKind }) {
  const { t } = useI18n();
  const [opened, setOpened] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!src) return <RealmAvatar kind={kind} />;
  const label = t(`realms.previewAvatar.${kind}`);

  return <>
    <button type="button" className={classes['realms-avatar-trigger']} aria-label={label} aria-haspopup="dialog" title={label}
      onClick={() => { setFailed(false); setOpened(true); }}>
      <RealmAvatar src={src} kind={kind} />
      <span className={classes['realms-avatar-zoom']} aria-hidden="true"><ZoomIn size={16} /></span>
    </button>
    <Modal opened={opened} onClose={() => setOpened(false)} title={t(`realms.avatar.${kind}`)} centered size="xl"
      closeButtonProps={{ 'aria-label': t('common.close') }}>
      {failed ? <p className={classes['realms-error']} role="alert">{t('realms.avatarPreviewError')}</p>
        : <img className={classes['realms-avatar-preview']} src={src} alt={t(`realms.avatar.${kind}`)} onError={() => setFailed(true)} />}
    </Modal>
  </>;
}

export function AvatarEditor({ value, characterId }: { value?: string; characterId?: string }) {
  const { t } = useI18n();
  const reset = useRef<() => void>(null);
  const [operation, select, remove] = useUnit([$realmAvatarOperation, realmAvatarSelected, realmAvatarRemoved]);
  const kind = characterId === undefined ? 'realm' : 'character';
  const busy = operation?.status === 'processing' && operation.request.characterId === characterId;
  const failed = operation?.status === 'error' && operation.characterId === characterId;

  function choose(file: File | null) {
    if (!file) return;
    reset.current?.();
    select({ file, characterId });
  }

  return (
    <div className={classes['realms-avatar-field']}>
      <div className={classes['realms-avatar-editor']}>
        <PreviewableRealmAvatar src={value} kind={kind} />
        <div className={classes['realms-avatar-caption']}>
          <strong>{t(`realms.avatar.${kind}`)}</strong>
          <span>{t('realms.avatarFormats')}</span>
        </div>
        <div className={classes['realms-actions']}>
          {value && <Button type="button" variant="subtle" onClick={() => remove(characterId)}>
            {t('realms.removeAvatar')}
          </Button>}
          <FileButton accept={avatarFormats} onChange={choose} resetRef={reset}>
            {(props) => <Button {...props} type="button" variant="default" loading={busy}
              leftSection={<ImagePlus size={16} aria-hidden="true" />}>
              {t(value ? 'realms.changeAvatar' : 'realms.uploadAvatar')}
            </Button>}
          </FileButton>
        </div>
      </div>
      {failed && <p className={classes['realms-error']} role="alert">{t('realms.avatarError')}</p>}
    </div>
  );
}
