import type { Preset } from './presets';

export type ActiveChatInstruction = { text: string | null };
export type InstructionPreset = Preset & { text: string };
export type InstructionSettings = { activePresetId: string | null; presets: InstructionPreset[] };

export const instructionTextLimit = 16_000;

export function readInstructionText(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length <= instructionTextLimit && value.isWellFormed()) {
    return value.trim() || undefined;
  }
}
