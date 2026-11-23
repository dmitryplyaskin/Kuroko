import { Bot, Globe, MessageSquare, Palette, PanelsTopLeft, Plug, Settings, Wrench } from 'lucide-react';
import type { ModuleIconName } from './contracts';

const icons = {
  panels: PanelsTopLeft,
  globe: Globe,
  message: MessageSquare,
  settings: Settings,
  palette: Palette,
  plug: Plug,
  tools: Wrench,
  agents: Bot,
};

export function ModuleIcon({ name, size }: { name: ModuleIconName; size: number }) {
  const Icon = icons[name];
  return <Icon size={size} aria-hidden="true" />;
}
