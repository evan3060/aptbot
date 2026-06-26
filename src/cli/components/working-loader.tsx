import React from 'react';
import { Text } from 'ink';

export interface WorkingLoaderProps {
  isWorking: boolean;
}

export function WorkingLoader({ isWorking }: WorkingLoaderProps): React.ReactElement | null {
  if (!isWorking) return null;
  return <Text color="green">{'⠋ Working...'}</Text>;
}
