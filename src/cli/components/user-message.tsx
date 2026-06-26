import React from 'react';
import { Text } from 'ink';

export interface UserMessageProps {
  text: string;
}

export function UserMessage({ text }: UserMessageProps): React.ReactElement {
  return <Text>{`You: ${text}`}</Text>;
}
