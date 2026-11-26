import type { Preset } from './presets';
import type { LlmMessage } from './llm';

export type ActiveChatInstruction = { text: string | null; messages?: LlmMessage[] };
export type InstructionDraft = { text: string; worldId?: string | null };
export type InstructionPreset = Preset & InstructionDraft & { worldTitle?: string };
export type InstructionSettings = { activePresetId: string | null; presets: InstructionPreset[] };

export const instructionTextLimit = 16_000;

export function hasTemplateSyntax(text: string): boolean {
  return /\{[{%#]|^[\t ]*@ /m.test(text);
}

export function readInstructionText(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length <= instructionTextLimit && value.isWellFormed()) {
    const text = value.trim();
    if (text) return hasTemplateSyntax(value) ? value : text;
  }
}

export function isWorldBinding(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || (typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value));
}
