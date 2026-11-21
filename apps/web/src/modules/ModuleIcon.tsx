import { MessageSquare, Palette, PanelsTopLeft, Plug, Settings, Wrench } from 'lucide-react';
import type { ModuleIconName } from './contracts';

const icons = {
  panels: PanelsTopLeft,
  message: MessageSquare,
  settings: Settings,
  palette: Palette,
  plug: Plug,
  tools: Wrench,
};

export function ModuleIcon({ name, size }: { name: ModuleIconName; size: number }) {
  const Icon = icons[name];
  return <Icon size={size} aria-hidden="true" />;
}
