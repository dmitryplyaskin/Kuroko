export type ChatImage = {
  src: string;
  alt: string;
  width: number;
  height: number;
} | { file: File };

export type Message = {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  reasoning?: string;
  time: number;
  image?: ChatImage;
  edited?: boolean;
};

export type ReplyPhase = 'reasoning' | 'answer';
