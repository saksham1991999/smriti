import { Text, useTheme } from '@smriti/ui-native';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

/** A labelled text field on theme tokens (ui-native has no text field yet). */
export function Field({ label, hideLabel, error, style, ...input }: TextInputProps & { label: string; hideLabel?: boolean; error?: string | null }) {
  const theme = useTheme();
  return (
    <View style={styles.root}>
      {hideLabel ? null : <Text variant="label">{label}</Text>}
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={theme.colors.inkMuted}
        style={[styles.input, { backgroundColor: theme.colors.surfaceSunken, color: theme.colors.ink, borderRadius: theme.radius.md, borderColor: error ? theme.colors.error : theme.colors.line }, style]}
        {...input}
      />
      {error ? (
        <View accessibilityLiveRegion="polite">
          <Text variant="caption" tone="error">
            {error}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 6 },
  input: { minHeight: 52, paddingHorizontal: 16, fontSize: 17, borderWidth: 1 },
});
