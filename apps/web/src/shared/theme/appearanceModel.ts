import type { MessageKey } from '../i18n/i18n';
import { createBrowserPreference } from '../browser/preferences';

type Accent = { accent: string; accentHover: string; accentText: string; accentSurface: string };
export type Palette = Accent & {
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
    label: 'appearance.pine',
    light: { accent: '#205a48', accentHover: '#174837', accentText: '#ffffff', accentSurface: '#e0ece5' },
    dark: { accent: '#a3d9bf', accentHover: '#bce8d2', accentText: '#142b21', accentSurface: '#283c34' },
  },
  ink: {
    label: 'appearance.ink',
    light: { accent: '#375b83', accentHover: '#29486d', accentText: '#ffffff', accentSurface: '#e3ebf4' },
    dark: { accent: '#a8c8ed', accentHover: '#c2dbf6', accentText: '#172a43', accentSurface: '#28384d' },
  },
  orchid: {
    label: 'appearance.orchid',
    light: { accent: '#6d4a79', accentHover: '#583860', accentText: '#ffffff', accentSurface: '#eee5f1' },
    dark: { accent: '#d4b4e0', accentHover: '#e7caef', accentText: '#302035', accentSurface: '#42314b' },
  },
} as const satisfies Record<string, { label: MessageKey; light: Accent; dark: Accent }>;

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

const accent = createBrowserPreference<AccentId>(
  'kuroko-accent-v1',
  defaultAccent,
  (value) => value && Object.hasOwn(accents, value) ? value as AccentId : defaultAccent,
  String,
);

export const $accent = accent.$value;
export const accentChanged = accent.changed;
export const $theme = $accent.map(resolveTheme);
