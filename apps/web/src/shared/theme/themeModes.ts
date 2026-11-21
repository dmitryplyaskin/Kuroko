import { Monitor, Moon, Sun } from 'lucide-react';

export const themeModes = [
  { id: 'light', label: 'appearance.light', Icon: Sun },
  { id: 'dark', label: 'appearance.dark', Icon: Moon },
  { id: 'auto', label: 'appearance.auto', Icon: Monitor },
] as const;
