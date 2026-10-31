import { Text, useTheme } from '@smriti/ui-native';
import { StyleSheet, TextInput, View } from 'react-native';

/**
 * A labelled multi-line text field on tokens. ui-native has no text field yet (requested from its
 * owner); this stands in until it lands.
 */
export function NoteField({ label, value, onChangeText, maxLength, testID }: { label: string; value: string; onChangeText: (v: string) => void; maxLength: number; testID?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.gap}>
      <Text variant="label" tone="muted">
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={(v) => onChangeText(v.slice(0, maxLength))}
        accessibilityLabel={label}
        multiline
        maxLength={maxLength}
        placeholderTextColor={theme.colors.inkMuted}
        style={[styles.input, { color: theme.colors.ink, backgroundColor: theme.colors.surface, borderColor: theme.colors.line, borderRadius: theme.radius.md }]}
        testID={testID}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 6 },
  input: { minHeight: 96, padding: 12, borderWidth: 1, fontSize: 17, textAlignVertical: 'top' },
});
