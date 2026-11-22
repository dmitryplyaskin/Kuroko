import { Button, FileButton, Modal } from '@mantine/core';
import { Globe, ImagePlus, UserRound, ZoomIn } from 'lucide-react';
import { useRef, useState } from 'react';
import { useI18n } from '../../shared/i18n/i18n';
import { avatarFormats, toRealmAvatar } from './realmAvatarFile';

type AvatarKind = 'realm' | 'character';

export function RealmAvatar({ src, kind, lazy }: { src?: string; kind: AvatarKind; lazy?: boolean }) {
  const [failed, setFailed] = useState<string>();
  const Icon = kind === 'realm' ? Globe : UserRound;
  return (
    <span className="realms-avatar" aria-hidden="true">
      {src && src !== failed ? <img src={src} alt="" loading={lazy ? 'lazy' : undefined} decoding="async"
        onError={() => setFailed(src)} /> : <Icon size={20} />}
    </span>
  );
}

export function PreviewableRealmAvatar({ src, kind }: { src?: string; kind: AvatarKind }) {
  const { t } = useI18n();
  const [opened, setOpened] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!src) return <RealmAvatar kind={kind} />;
  const label = t(`realms.previewAvatar.${kind}`);

  return <>
    <button type="button" className="realms-avatar-trigger" aria-label={label} aria-haspopup="dialog" title={label}
      onClick={() => { setFailed(false); setOpened(true); }}>
      <RealmAvatar src={src} kind={kind} />
      <span className="realms-avatar-zoom" aria-hidden="true"><ZoomIn size={16} /></span>
    </button>
    <Modal opened={opened} onClose={() => setOpened(false)} title={t(`realms.avatar.${kind}`)} centered size="xl"
      closeButtonProps={{ 'aria-label': t('common.close') }}>
      {failed ? <p className="realms-error" role="alert">{t('realms.avatarPreviewError')}</p>
        : <img className="realms-avatar-preview" src={src} alt={t(`realms.avatar.${kind}`)} onError={() => setFailed(true)} />}
    </Modal>
  </>;
}

export function AvatarEditor({ value, kind, onChange, onPending }: {
  value?: string;
  kind: AvatarKind;
  onChange: (value?: string) => void;
  onPending: (pending: boolean) => void;
}) {
  const { t } = useI18n();
  const reset = useRef<() => void>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function choose(file: File | null) {
    if (!file || busy) return;
    reset.current?.();
    setFailed(false);
    setBusy(true);
    onPending(true);
    try {
      onChange(await toRealmAvatar(file));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
      onPending(false);
    }
  }

  return (
    <div className="realms-avatar-field">
      <div className="realms-avatar-editor">
        <PreviewableRealmAvatar src={value} kind={kind} />
        <div className="realms-avatar-caption">
          <strong>{t(`realms.avatar.${kind}`)}</strong>
          <span>{t('realms.avatarFormats')}</span>
        </div>
        <div className="realms-actions">
          {value && <Button type="button" variant="subtle" onClick={() => { setFailed(false); onChange(undefined); }}>
            {t('realms.removeAvatar')}
          </Button>}
          <FileButton accept={avatarFormats} onChange={(file) => void choose(file)} resetRef={reset}>
            {(props) => <Button {...props} type="button" variant="default" loading={busy}
              leftSection={<ImagePlus size={16} aria-hidden="true" />}>
              {t(value ? 'realms.changeAvatar' : 'realms.uploadAvatar')}
            </Button>}
          </FileButton>
        </div>
      </div>
      {failed && <p className="realms-error" role="alert">{t('realms.avatarError')}</p>}
    </div>
  );
}
