import { Button, FileButton, Modal } from '@mantine/core';
import { readRealmAvatar } from '@kuroko/contracts/realms';
import { Globe, ImagePlus, UserRound, ZoomIn } from 'lucide-react';
import { useRef, useState } from 'react';
import { useI18n } from '../../shared/i18n/i18n';

type AvatarKind = 'realm' | 'character';
const formats = 'image/jpeg,image/png,image/webp';

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
      onChange(await toAvatar(file));
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
          <FileButton accept={formats} onChange={(file) => void choose(file)} resetRef={reset}>
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

async function toAvatar(file: File) {
  if ((file.type && !formats.split(',').includes(file.type)) || file.size > 20 * 1024 * 1024) {
    throw new Error('Invalid avatar file');
  }
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not resize avatar');
    const longestSide = Math.max(bitmap.width, bitmap.height);
    const sizes = new Set([Math.min(longestSide, 512), Math.min(longestSide, 384), Math.min(longestSide, 256)]);
    for (const size of sizes) {
      const scale = size / longestSide;
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.8, 0.65, 0.48]) {
        const avatar = canvas.toDataURL('image/webp', quality);
        if (readRealmAvatar(avatar)) return avatar;
      }
    }
    const avatar = canvas.toDataURL('image/jpeg', 0.65);
    if (readRealmAvatar(avatar)) return avatar;
    throw new Error('Could not encode avatar');
  } finally {
    bitmap.close();
  }
}
