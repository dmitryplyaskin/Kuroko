import { useComputedColorScheme, useMantineColorScheme } from '@mantine/core';
import { Check } from 'lucide-react';
import { useUnit } from 'effector-react';
import { $accent, $theme, accentChanged, accents, type AccentId } from '../../shared/theme/appearanceModel';
import { themeModes } from '../../shared/theme/themeModes';
import './appearance.css';

const accentIds = Object.keys(accents) as AccentId[];

export function Appearance() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const activeScheme = useComputedColorScheme('light');
  const [accent, setAccent, theme] = useUnit([$accent, accentChanged, $theme]);

  return (
    <>
      <fieldset className="field-group">
        <legend>Тема</legend>
        <div className="mode-options">
          {themeModes.map(({ id, label, Icon }) => {
            const previews = id === 'auto' ? [theme.light, theme.dark] : [theme[id]];
            return (
              <label className="choice-option mode-option" key={id}>
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
      <fieldset className="field-group">
        <legend>Цвет акцента</legend>
        <div className="accent-options">
          {accentIds.map((id) => (
            <label className="choice-option accent-option" key={id}>
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
