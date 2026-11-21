import { LanguageSelect } from '../shared/i18n/LanguageSelect';
import type { ReactNode } from 'react';
import { SceneCover } from '../shared/scene-cover/SceneCover';
import { ThemeMenu } from '../shared/theme/ThemeMenu';
import { Brand } from './Brand';
import './guest.css';

export function GuestLayout({ children }: { children: ReactNode }) {
  return (
    <div className="guest-layout">
      <header className="guest-header">
        <Brand />
        <div className="guest-preferences"><LanguageSelect compact /><ThemeMenu /></div>
      </header>
      <main className="guest-main">{children}</main>
      <SceneCover guest />
    </div>
  );
}
