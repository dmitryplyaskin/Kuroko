import { LanguageSelect } from '../../shared/i18n/LanguageSelect';
import { useI18n } from '../../shared/i18n/i18n';
import { useComputedColorScheme, useMantineColorScheme } from '@mantine/core';
import { Check } from 'lucide-react';
import { useUnit } from 'effector-react';
import { $accent, $theme, accentChanged, accents, type AccentId } from '../../shared/theme/appearanceModel';
import { themeModes } from '../../shared/theme/themeModes';
import classes from './Appearance.module.css';

const accentIds = Object.keys(accents) as AccentId[];

export default function Appearance() {
  const { t } = useI18n();
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const activeScheme = useComputedColorScheme('light');
  const [accent, setAccent, theme] = useUnit([$accent, accentChanged, $theme]);

  return (
    <>
      <LanguageSelect />
      <fieldset className="field-group">
        <legend>{t('appearance.theme')}</legend>
        <div className={classes['mode-options']}>
          {themeModes.map(({ id, label, Icon }) => {
            const previews = id === 'auto' ? [theme.light, theme.dark] : [theme[id]];
            return (
              <label className={`choice-option ${classes['mode-option']}`} key={id}>
                <input type="radio" name="theme-mode" checked={colorScheme === id} onChange={() => setColorScheme(id)} />
                <span className={classes['mode-preview']} aria-hidden="true">
                  {previews.map(({ canvas, accent, control }) => (
                    <span key={canvas} style={{ backgroundColor: canvas }}>
                      <i style={{ backgroundColor: accent }} />
                      <i style={{ backgroundColor: control }} />
                    </span>
                  ))}
                </span>
                <span className="option-label"><Icon size={17} aria-hidden="true" />{t(label)}</span>
                <Check className="option-check" size={17} aria-hidden="true" />
              </label>
            );
          })}
        </div>
      </fieldset>
      <fieldset className="field-group">
        <legend>{t('appearance.accent')}</legend>
        <div className={classes['accent-options']}>
          {accentIds.map((id) => (
            <label className={`choice-option ${classes['accent-option']}`} key={id}>
              <input type="radio" name="theme-accent" checked={accent === id} onChange={() => setAccent(id)} />
              <span className={classes['accent-swatch']} style={{ backgroundColor: accents[id][activeScheme].accent }} aria-hidden="true" />
              <span>{t(accents[id].label)}</span>
              <Check className="option-check" size={17} aria-hidden="true" />
            </label>
          ))}
        </div>
      </fieldset>
    </>
  );
}
