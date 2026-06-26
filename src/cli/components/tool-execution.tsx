import React from 'react';
import { Text } from 'ink';

export interface ToolExecutionProps {
  name: string;
  status: 'running' | 'success' | 'failed';
}

const STATUS_ICONS: Record<ToolExecutionProps['status'], string> = {
  running: '⏳',
  success: '✓',
  failed: '✗',
};

export function ToolExecution({ name, status }: ToolExecutionProps): React.ReactElement {
  const icon = STATUS_ICONS[status];
  return <Text>{`  ${icon} ${name} [${status}]`}</Text>;
}
