import { View, type StyleProp, type ViewStyle } from "react-native";
import { SvgXml } from "react-native-svg";
import type { FormulaBoxContract } from "@smriti/tokens/ui";
import { useSubject, useTheme, useUI } from "../theme";
import { Button } from "./Button";
import { Chip } from "./Chips";
import { Text } from "./Text";

export interface FormulaBoxProps extends FormulaBoxContract {
  style?: StyleProp<ViewStyle>;
  /** Height of the typeset formula; width follows the SVG's aspect ratio. */
  formulaHeight?: number;
}

/**
 * Subject tint, the formula from the content bundle's pre-rendered KaTeX SVG (native has no KaTeX
 * runtime; never fake maths as plain text, DESIGN.md §3), tappable symbols and "Add to formula vault".
 */
export function FormulaBox({ svg, subject, label, symbols, onSymbolPress, inVault, onAddToVault, formulaHeight = 48, testID, style }: FormulaBoxProps) {
  const theme = useTheme();
  const { t } = useUI();
  const s = useSubject(subject);
  return (
    <View testID={testID} style={[{ gap: 12, borderRadius: theme.radius.md, backgroundColor: s.tint, padding: 18 }, style]}>
      <View accessible accessibilityRole="image" accessibilityLabel={label} style={{ alignItems: "center", minHeight: formulaHeight }}>
        {svg ? (
          <SvgXml xml={svg} height={formulaHeight} width="100%" color={theme.colors.ink} />
        ) : (
          <Text variant="label" tone="muted">
            {t("formula.loading")}
          </Text>
        )}
      </View>
      {symbols && symbols.length > 0 && (
        <View style={{ gap: 8 }}>
          <Text variant="caption" tone="muted">
            {t("formula.symbols")}
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {symbols.map((sym) => (
              <Chip key={sym.id} kind="filter" label={sym.label} onPress={onSymbolPress ? () => onSymbolPress(sym.id) : undefined} />
            ))}
          </View>
        </View>
      )}
      {onAddToVault && (
        <Button
          size="sm"
          variant={inVault ? "ghost" : "secondary"}
          icon={inVault ? "CheckCircle" : "Plus"}
          label={inVault ? t("formula.inVault") : t("formula.addToVault")}
          onPress={inVault ? undefined : onAddToVault}
        />
      )}
    </View>
  );
}
