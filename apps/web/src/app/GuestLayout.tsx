import type { ReactNode } from 'react';
import { SceneCover } from '../features/scenes/SceneCover';
import { ThemeMenu } from '../shared/theme/ThemeMenu';
import { Brand } from './Brand';
import './guest.css';

export function GuestLayout({ children }: { children: ReactNode }) {
  return (
    <div className="guest-layout">
      <header className="guest-header"><Brand /><ThemeMenu /></header>
      <main className="guest-main">{children}</main>
      <SceneCover guest />
    </div>
  );
}
