import React, { useRef, useState } from 'react';
import { Text, useInput } from 'ink';

export interface InputEditorProps {
  onSubmit: (text: string) => void;
}

export function InputEditor({ onSubmit }: InputEditorProps): React.ReactElement {
  const [text, setText] = useState('');
  const textRef = useRef('');

  useInput((input, key) => {
    if (key.return) {
      onSubmit(textRef.current);
      textRef.current = '';
      setText('');
      return;
    }
    if (key.backspace || key.delete) {
      textRef.current = textRef.current.slice(0, -1);
      setText(textRef.current);
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      textRef.current += input;
      setText(textRef.current);
    }
  });

  return <Text>{`> ${text}`}</Text>;
}
