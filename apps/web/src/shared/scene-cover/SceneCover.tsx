import { useI18n } from '../i18n/i18n';
import cover from '../../assets/last-train.webp';
import './sceneCover.css';

export function SceneCover({ guest = false }: { guest?: boolean }) {
  const { t } = useI18n();
  return (
    <figure className={guest ? 'scene-cover guest-cover' : 'scene-cover'}>
      <img
        src={cover}
        width={1440}
        height={960}
        alt={t('scenes.coverAlt')}
        loading={guest ? 'lazy' : 'eager'}
        fetchPriority="high"
      />
      <figcaption>
        <span>{t('scenes.sample')}</span>
        <strong>{t('scenes.lastTrain')}</strong>
      </figcaption>
    </figure>
  );
}
