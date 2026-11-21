export type ChatColorScheme = 'light' | 'dark';

export const chatColorRoles = ['text', 'speech', 'emphasis', 'quote'] as const;
export type ChatColor = typeof chatColorRoles[number];
type ChatColors = Partial<Record<ChatColor, string>>;

export type ChatSettings = {
  fontSize: number;
  width: number;
  userSide: 'left' | 'right';
  colors: Record<ChatColorScheme, ChatColors>;
};

export type ChatSettingsResponse = { settings: ChatSettings | null };

export const chatFontSize = { min: 12, max: 26, step: 1 };
export const chatWidth = { min: 480, max: 1440, step: 16 };
export const defaultChatSettings: ChatSettings = { fontSize: 16, width: 928, userSide: 'right', colors: { light: {}, dark: {} } };

export function isChatColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[a-f\d]{6}$/i.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readColors(value: unknown): ChatColors | undefined {
  if (!isRecord(value)) return undefined;
  const colors: ChatColors = {};
  for (const role of chatColorRoles) {
    if (!Object.hasOwn(value, role)) continue;
    const color = value[role];
    if (!isChatColor(color)) return undefined;
    colors[role] = color.toLowerCase();
  }
  return colors;
}

function isSliderValue(value: unknown, { min, max, step }: typeof chatWidth): value is number {
  return typeof value === 'number' && value >= min && value <= max && (value - min) % step === 0;
}

export function readChatSettings(value: unknown): ChatSettings | undefined {
  if (!isRecord(value)) return undefined;
  const { fontSize, width, userSide, colors } = value;
  if (!isSliderValue(fontSize, chatFontSize) || !isSliderValue(width, chatWidth) ||
    (userSide !== 'left' && userSide !== 'right') || !isRecord(colors)) return undefined;
  const light = readColors(colors.light);
  const dark = readColors(colors.dark);
  if (!light || !dark) return undefined;

  return { fontSize, width, userSide, colors: { light, dark } };
}

export function sameChatSettings(first: ChatSettings, second: ChatSettings) {
  return first.fontSize === second.fontSize && first.width === second.width && first.userSide === second.userSide &&
    chatColorRoles.every((role) => first.colors.light[role] === second.colors.light[role] && first.colors.dark[role] === second.colors.dark[role]);
}
