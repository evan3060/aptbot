import React from 'react';
import { Text } from 'ink';

export interface AssistantMessageProps {
  text: string;
  isStreaming?: boolean;
}

export function AssistantMessage({ text, isStreaming }: AssistantMessageProps): React.ReactElement {
  const suffix = isStreaming ? '▋' : '';
  return <Text>{`Assistant: ${text}${suffix}`}</Text>;
}
