export interface AttachedFile {
  name: string;
  size: string;
  content?: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string; // e.g. "14:21"
  modelUsed?: string; // e.g. "GPT-4o"
  agentName?: string; // e.g. "通用智能体"
  files?: AttachedFile[];
}

export interface Session {
  id: string;
  title: string;
  agentId: string;
  messages: Message[];
  createdAt: number;
}

export interface Agent {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  iconName: string; // lucide icon identifier
  isCustom: boolean;
  predefinedPrompts?: { label: string; text: string; icon: string }[];
}

export interface ModelOption {
  id: string;
  name: string;
  backendModel: string;
}
