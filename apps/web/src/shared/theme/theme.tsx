import {
  Button, Checkbox, Input, MantineProvider, Menu, Modal, createTheme, defaultVariantColorsResolver,
  type CSSVariablesResolver, type VariantColorsResolver,
} from '@mantine/core';
import { useMemo, type ReactNode } from 'react';
import { useUnit } from 'effector-react';
import { $theme, type Palette } from './appearanceModel';
import classes from './theme.module.css';

function cssPalette(palette: Palette) {
  return {
    '--kr-canvas': palette.canvas,
    '--kr-surface': palette.surface,
    '--kr-sidebar': palette.sidebar,
    '--kr-hover': palette.hover,
    '--kr-text': palette.text,
    '--kr-muted': palette.muted,
    '--kr-border': palette.border,
    '--kr-control': palette.control,
    '--kr-danger': palette.danger,
    '--kr-accent': palette.accent,
    '--kr-accent-hover': palette.accentHover,
    '--kr-accent-text': palette.accentText,
    '--kr-accent-surface': palette.accentSurface,
    '--mantine-color-body': palette.canvas,
    '--mantine-color-text': palette.text,
    '--mantine-color-dimmed': palette.muted,
    '--mantine-color-error': palette.danger,
    '--mantine-primary-color-filled': palette.accent,
    '--mantine-primary-color-filled-hover': palette.accentHover,
  };
}

const variantColorResolver: VariantColorsResolver = (input) => {
  const fallback = defaultVariantColorsResolver(input);
  const danger = input.color === 'red';
  if (input.color && input.color !== input.theme.primaryColor && !danger) {
    return fallback;
  }
  const color = danger ? 'var(--kr-danger)' : 'var(--kr-accent)';
  switch (input.variant) {
    case 'filled':
      return {
        ...fallback,
        background: color,
        hover: danger ? 'color-mix(in srgb, var(--kr-danger) 88%, var(--kr-text))' : 'var(--kr-accent-hover)',
        color: danger ? 'var(--kr-canvas)' : 'var(--kr-accent-text)',
      };
    case 'subtle':
      return {
        ...fallback,
        hover: danger ? 'color-mix(in srgb, var(--kr-danger) 12%, var(--kr-surface))' : 'var(--kr-accent-surface)',
        color,
      };
    case 'default':
      return { background: 'var(--kr-surface)', hover: 'var(--kr-hover)', color: 'var(--kr-text)', border: '1px solid var(--kr-control)' };
    default:
      return fallback;
  }
};

const mantineTheme = createTheme({
  fontFamily: 'var(--kr-font-interface, system-ui)',
  defaultRadius: 'var(--kr-radius-control)',
  primaryShade: 8,
  respectReducedMotion: true,
  variantColorResolver,
  components: {
    Button: Button.extend({
      defaultProps: { variant: 'filled' },
      styles: { root: { minBlockSize: 42 } },
      classNames: { root: classes.button },
    }),
    Checkbox: Checkbox.extend({
      vars: () => ({ root: { '--checkbox-icon-color': 'var(--kr-accent-text)' } }),
      styles: { label: { fontWeight: 550 } },
      classNames: { input: classes.checkbox },
    }),
    Input: Input.extend({ classNames: { input: classes.input } }),
    InputWrapper: Input.Wrapper.extend({
      styles: {
        label: { marginBlockEnd: 5, fontWeight: 600 },
        description: { marginBlockEnd: 6 },
      },
    }),
    Menu: Menu.extend({
      styles: {
        dropdown: { backgroundColor: 'var(--kr-surface)', borderColor: 'var(--kr-border)' },
        item: { minBlockSize: 38 },
      },
    }),
    Modal: Modal.extend({
      defaultProps: { radius: 'var(--kr-radius-panel)', padding: 'lg', centered: true },
      styles: {
        content: { backgroundColor: 'var(--kr-surface)', overscrollBehavior: 'contain' },
        header: { backgroundColor: 'var(--kr-surface)' },
        title: { fontSize: '1.25rem', fontWeight: 650 },
      },
    }),
  },
});

export function KurokoThemeProvider({ children }: { children: ReactNode }) {
  const theme = useUnit($theme);
  const cssVariablesResolver = useMemo<CSSVariablesResolver>(() => () => ({
    variables: {
      '--kr-font-interface': theme.fonts.interface,
      '--kr-font-story': theme.fonts.story,
      '--kr-radius-control': `${theme.radii.control}px`,
      '--kr-radius-panel': `${theme.radii.panel}px`,
      '--kr-radius-cover': `${theme.radii.cover}px`,
    },
    light: cssPalette(theme.light),
    dark: cssPalette(theme.dark),
  }), [theme]);

  return (
    <MantineProvider theme={mantineTheme} cssVariablesResolver={cssVariablesResolver} defaultColorScheme="auto">
      {children}
    </MantineProvider>
  );
}
