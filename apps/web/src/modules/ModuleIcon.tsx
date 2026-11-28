import { Bot, Globe, House, MessageSquare, NotebookText, Palette, PanelsTopLeft, Plug, Settings, UserRound, Wrench } from 'lucide-react';
import type { ModuleIconName } from './contracts';

const icons = {
  panels: PanelsTopLeft,
  home: House,
  globe: Globe,
  message: MessageSquare,
  settings: Settings,
  palette: Palette,
  plug: Plug,
  tools: Wrench,
  agents: Bot,
  instructions: NotebookText,
  personas: UserRound,
};

export function ModuleIcon({ name, size }: { name: ModuleIconName; size: number }) {
  const Icon = icons[name];
  return <Icon size={size} aria-hidden="true" />;
}
