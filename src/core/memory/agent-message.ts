import { randomUUID } from 'node:crypto';

export type MessageRole = 'user' | 'assistant' | 'tool';

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ImageContent {
  type: 'image';
  source: { type: 'base64'; mediaType: string; data: string };
}

export type ContentBlock = TextContent | ImageContent;

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface AgentMessage {
  id: string;
  role: MessageRole;
  content: string | ContentBlock[];
  toolCallId?: string;
  toolCalls?: ToolCall[];
  stopReason?: string;
  timestamp: number;
}

export function createMessage(
  role: MessageRole,
  content: string | ContentBlock[],
): AgentMessage {
  return {
    id: randomUUID(),
    role,
    content,
    timestamp: Date.now(),
  };
}
