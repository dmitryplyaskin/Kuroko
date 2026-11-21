import { Menu, useMantineColorScheme, type MantineColorScheme } from '@mantine/core';
import { ChevronDown } from 'lucide-react';
import { themeModes } from './themeModes';

export function ThemeMenu() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const { Icon } = themeModes.find((mode) => mode.id === colorScheme) ?? themeModes[2];

  return (
    <Menu position="bottom-end" width={174} shadow="sm">
      <Menu.Target>
        <button className="theme-trigger" type="button" aria-label="Выбрать тему">
          <Icon size={18} aria-hidden="true" />
          <ChevronDown size={13} aria-hidden="true" />
        </button>
      </Menu.Target>
      <Menu.Dropdown aria-label="Тема">
        <Menu.RadioGroup value={colorScheme} onChange={(value) => setColorScheme(value as MantineColorScheme)}>
          {themeModes.map(({ id, label }) => <Menu.RadioItem key={id} value={id}>{label}</Menu.RadioItem>)}
        </Menu.RadioGroup>
      </Menu.Dropdown>
    </Menu>
  );
}
