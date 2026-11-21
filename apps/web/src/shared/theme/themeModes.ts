import { Monitor, Moon, Sun } from 'lucide-react';

export const themeModes = [
  { id: 'light', label: 'Светлая', Icon: Sun },
  { id: 'dark', label: 'Тёмная', Icon: Moon },
  { id: 'auto', label: 'Как в системе', Icon: Monitor },
] as const;
