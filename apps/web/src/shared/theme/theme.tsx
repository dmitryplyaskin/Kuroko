import {
  Button, Checkbox, Input, MantineProvider, Menu, Modal, createTheme, defaultVariantColorsResolver,
  type CSSVariablesResolver, type VariantColorsResolver,
} from '@mantine/core';
import { useLocalStorage } from '@mantine/hooks';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import classes from './theme.module.css';

type Accent = { accent: string; accentHover: string; accentText: string; accentSurface: string };
type Palette = Accent & {
  canvas: string; surface: string; sidebar: string; hover: string; text: string; muted: string;
  border: string; control: string; danger: string;
};

export type ThemeDefinition = {
  version: 1;
  light: Palette;
  dark: Palette;
  fonts: { interface: string; story: string };
  radii: { control: number; panel: number; cover: number };
};

export const accents = {
  pine: {
    label: 'Хвойный',
    light: { accent: '#205a48', accentHover: '#174837', accentText: '#ffffff', accentSurface: '#e0ece5' },
    dark: { accent: '#a3d9bf', accentHover: '#bce8d2', accentText: '#142b21', accentSurface: '#283c34' },
  },
  ink: {
    label: 'Чернильный',
    light: { accent: '#375b83', accentHover: '#29486d', accentText: '#ffffff', accentSurface: '#e3ebf4' },
    dark: { accent: '#a8c8ed', accentHover: '#c2dbf6', accentText: '#172a43', accentSurface: '#28384d' },
  },
  orchid: {
    label: 'Сливовый',
    light: { accent: '#6d4a79', accentHover: '#583860', accentText: '#ffffff', accentSurface: '#eee5f1' },
    dark: { accent: '#d4b4e0', accentHover: '#e7caef', accentText: '#302035', accentSurface: '#42314b' },
  },
} as const satisfies Record<string, { label: string; light: Accent; dark: Accent }>;

export type AccentId = keyof typeof accents;
const defaultAccent: AccentId = 'pine';

const defaultTheme: ThemeDefinition = {
  version: 1,
  fonts: {
    interface: '"Onest Variable", "Segoe UI", system-ui, sans-serif',
    story: '"Literata Variable", Georgia, serif',
  },
  radii: { control: 10, panel: 16, cover: 22 },
  light: {
    canvas: '#f4f6f3', surface: '#fcfdfa', sidebar: '#eef2ee', hover: '#e8ede9', text: '#192420',
    muted: '#53635c', border: '#dbe3dd', control: '#7c8c82', danger: '#a32d3b',
    ...accents.pine.light,
  },
  dark: {
    canvas: '#141a18', surface: '#1c2421', sidebar: '#111715', hover: '#26302c', text: '#e8efea',
    muted: '#abbab2', border: '#303d37', control: '#73877c', danger: '#ffa8b1',
    ...accents.pine.dark,
  },
};

function resolveTheme(accent: AccentId): ThemeDefinition {
  return {
    ...defaultTheme,
    light: { ...defaultTheme.light, ...accents[accent].light },
    dark: { ...defaultTheme.dark, ...accents[accent].dark },
  };
}

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

type Appearance = { accent: AccentId; setAccent: (accent: AccentId) => void; theme: ThemeDefinition };
const AppearanceContext = createContext<Appearance | null>(null);

export function useAppearance() {
  const appearance = useContext(AppearanceContext);
  if (!appearance) {
    throw new Error('Appearance settings require KurokoThemeProvider');
  }
  return appearance;
}

export function KurokoThemeProvider({ children }: { children: ReactNode }) {
  const [accent, setAccent] = useLocalStorage<AccentId>({
    key: 'kuroko-accent-v1', defaultValue: defaultAccent, getInitialValueInEffect: false,
    deserialize: (value) => value && Object.hasOwn(accents, value) ? value as AccentId : defaultAccent,
    serialize: (value) => value,
  });
  const theme = useMemo(() => resolveTheme(accent), [accent]);
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
      <AppearanceContext.Provider value={{ accent, setAccent, theme }}>
        {children}
      </AppearanceContext.Provider>
    </MantineProvider>
  );
}
