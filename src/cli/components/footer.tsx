import React from 'react';
import { Text } from 'ink';

export interface FooterProps {
  model: string;
}

export function Footer({ model }: FooterProps): React.ReactElement {
  return <Text dimColor>{`Model: ${model}`}</Text>;
}
