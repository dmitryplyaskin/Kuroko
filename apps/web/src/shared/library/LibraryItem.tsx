import { ActionIcon } from '@mantine/core';
import { ChevronRight, Star } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import classes from './Library.module.css';

export function LibraryAvatar({ src, placeholder, lazy, className }: {
  src?: string;
  placeholder: ReactNode;
  lazy?: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState<string>();
  return <span className={className ? `${classes['library-avatar']} ${className}` : classes['library-avatar']} aria-hidden="true">
    {src && src !== failed ? <img src={src} alt="" loading={lazy ? 'lazy' : undefined} decoding="async"
      onError={() => setFailed(src)} /> : placeholder}
  </span>;
}

export function LibraryItem({ title, excerpt, avatar, metadata, tags, favorite, openLabel, disabled, onOpen }: {
  title: string;
  excerpt: string;
  avatar: ReactNode;
  metadata: ReactNode;
  tags?: string[];
  favorite: ReactNode;
  openLabel?: string;
  disabled?: boolean;
  onOpen: () => void;
}) {
  const detailsId = useId();
  const metadataId = useId();
  const describedBy = excerpt ? `${detailsId} ${metadataId}` : metadataId;
  return <li>
    <button type="button" className={classes['library-item']} disabled={disabled} onClick={onOpen}
      aria-label={openLabel} aria-describedby={openLabel ? describedBy : undefined}>
      {avatar}
      <span className={classes['library-item-copy']}>
        <strong dir="auto">{title}</strong>
        {excerpt && <span className={classes['library-item-excerpt']} id={detailsId} dir="auto">{excerpt}</span>}
        {Boolean(tags?.length) && <span className={classes['library-item-tags']}>
          {tags?.map((tag) => <span key={tag}>{tag}</span>)}
        </span>}
      </span>
      <span className={classes['library-item-meta']} id={metadataId}>{metadata}</span>
      <ChevronRight size={16} aria-hidden="true" />
    </button>
    {favorite}
  </li>;
}

export function LibraryFavoriteButton({ favorite, label, title, pending, disabled, onClick }: {
  favorite: boolean;
  label: string;
  title: string;
  pending?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return <ActionIcon type="button" className={classes['library-favorite']} variant="subtle" size={44} loading={pending}
    disabled={disabled} aria-pressed={favorite} aria-label={label} title={title} onClick={onClick}>
    <Star size={19} fill={favorite ? 'currentColor' : 'none'} aria-hidden="true" />
  </ActionIcon>;
}
