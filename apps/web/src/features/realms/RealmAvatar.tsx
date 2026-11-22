import { Button, FileButton } from '@mantine/core';
import { readRealmAvatar } from '@kuroko/contracts/realms';
import { Globe, ImagePlus, UserRound } from 'lucide-react';
import { useRef, useState } from 'react';
import { useI18n } from '../../shared/i18n/i18n';

type AvatarKind = 'realm' | 'character';
const formats = 'image/jpeg,image/png,image/webp';

export function RealmAvatar({ src, kind }: { src?: string; kind: AvatarKind }) {
  const [failed, setFailed] = useState<string>();
  const Icon = kind === 'realm' ? Globe : UserRound;
  return (
    <span className="realms-avatar" aria-hidden="true">
      {src && src !== failed ? <img src={src} alt="" decoding="async" onError={() => setFailed(src)} /> : <Icon size={20} />}
    </span>
  );
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
        <RealmAvatar src={value} kind={kind} />
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
    canvas.width = canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not resize avatar');
    const side = Math.min(bitmap.width, bitmap.height);
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.8, 0.65, 0.48]) {
      const avatar = canvas.toDataURL('image/webp', quality);
      if (readRealmAvatar(avatar)) return avatar;
    }
    const avatar = canvas.toDataURL('image/jpeg', 0.65);
    if (readRealmAvatar(avatar)) return avatar;
    throw new Error('Could not encode avatar');
  } finally {
    bitmap.close();
  }
}
