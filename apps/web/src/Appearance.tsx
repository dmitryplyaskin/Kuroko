import { Menu, useComputedColorScheme, useMantineColorScheme, type MantineColorScheme } from '@mantine/core';
import { Check, ChevronDown, Monitor, Moon, Sun } from 'lucide-react';
import { accents, useAppearance, type AccentId } from './theme';

const modes = [
  { id: 'light', label: 'Светлая', Icon: Sun },
  { id: 'dark', label: 'Тёмная', Icon: Moon },
  { id: 'auto', label: 'Как в системе', Icon: Monitor },
] as const;

const accentIds = Object.keys(accents) as AccentId[];

export function ThemeMenu() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const { Icon } = modes.find((mode) => mode.id === colorScheme) ?? modes[2];

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
          {modes.map(({ id, label }) => <Menu.RadioItem key={id} value={id}>{label}</Menu.RadioItem>)}
        </Menu.RadioGroup>
      </Menu.Dropdown>
    </Menu>
  );
}

export function Appearance() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const activeScheme = useComputedColorScheme('light');
  const { accent, setAccent, theme } = useAppearance();

  return (
    <>
      <fieldset className="appearance-group">
        <legend>Тема</legend>
        <div className="mode-options">
          {modes.map(({ id, label, Icon }) => {
            const previews = id === 'auto' ? [theme.light, theme.dark] : [theme[id]];
            return (
              <label className="appearance-option mode-option" key={id}>
                <input type="radio" name="theme-mode" checked={colorScheme === id} onChange={() => setColorScheme(id)} />
                <span className="mode-preview" aria-hidden="true">
                  {previews.map(({ canvas, accent, control }) => (
                    <span key={canvas} style={{ backgroundColor: canvas }}>
                      <i style={{ backgroundColor: accent }} />
                      <i style={{ backgroundColor: control }} />
                    </span>
                  ))}
                </span>
                <span className="option-label"><Icon size={17} aria-hidden="true" />{label}</span>
                <Check className="option-check" size={17} aria-hidden="true" />
              </label>
            );
          })}
        </div>
      </fieldset>
      <fieldset className="appearance-group">
        <legend>Цвет акцента</legend>
        <div className="accent-options">
          {accentIds.map((id) => (
            <label className="appearance-option accent-option" key={id}>
              <input type="radio" name="theme-accent" checked={accent === id} onChange={() => setAccent(id)} />
              <span className="accent-swatch" style={{ backgroundColor: accents[id][activeScheme].accent }} aria-hidden="true" />
              <span>{accents[id].label}</span>
              <Check className="option-check" size={17} aria-hidden="true" />
            </label>
          ))}
        </div>
      </fieldset>
    </>
  );
}
