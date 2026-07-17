export type ChatTab = 'teach' | 'guide' | 'custom';

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};
