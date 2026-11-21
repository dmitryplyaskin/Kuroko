import cover from '../../assets/last-train.webp';
import './sceneCover.css';

export function SceneCover({ guest = false }: { guest?: boolean }) {
  return (
    <figure className={guest ? 'scene-cover guest-cover' : 'scene-cover'}>
      <img
        src={cover}
        width={1440}
        height={960}
        alt="Пустая железнодорожная платформа в тумане"
        loading={guest ? 'lazy' : 'eager'}
        fetchPriority="high"
      />
      <figcaption>
        <span>Пример сцены</span>
        <strong>Последний поезд</strong>
      </figcaption>
    </figure>
  );
}
