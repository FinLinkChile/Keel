import { TextInput, View, type TextInputProps } from 'react-native';

import { Text } from './Text';
import { colors, fonts } from './theme';

// missing: the proforma did not print it. error: the form cannot be built without it.
export type FieldNotice = { tone: 'missing' | 'error'; text: string };

type Props = Pick<TextInputProps, 'value' | 'onChangeText' | 'placeholder' | 'keyboardType' | 'autoCapitalize'> & {
  label: string;
  // Figures and codes are set in mono
  mono?: boolean;
  notice?: FieldNotice;
  // Drawn on a surface (a card), so the input is raised above it
  raised?: boolean;
};

// A labelled text input. The notice sits under it in words, and its colour follows the meaning:
// yellow when it is the importer's turn to fill it, red when it blocks the order.
export function Field({ label, mono = false, notice, raised = false, ...input }: Props) {
  const ink = notice ? (notice.tone === 'error' ? colors.danger : colors.yourTurn) : undefined;
  return (
    <View style={{ gap: 6 }}>
      <Text size={14} weight={600}>
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        autoCorrect={false}
        placeholderTextColor={colors.textFaint}
        selectionColor={colors.accent}
        {...input}
        style={{
          height: 52,
          borderRadius: 16,
          paddingHorizontal: 16,
          backgroundColor: raised ? colors.surfaceRaised : colors.surface,
          borderWidth: 1,
          borderColor: ink ?? (raised ? colors.surfaceRaised : colors.surface),
          color: colors.text,
          fontSize: 16,
          fontFamily: mono ? fonts.mono[400] : fonts.sans[500],
        }}
      />
      {notice ? (
        <Text size={13} style={{ color: ink }}>
          {notice.text}
        </Text>
      ) : null}
    </View>
  );
}
