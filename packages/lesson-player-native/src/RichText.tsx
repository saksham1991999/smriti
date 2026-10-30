/**
 * Text with maths. Bundles carry MathJax SVG for every `$...$` and `$$...$$` segment under
 * `bundle.math` (content-publish renders it at build time), so the device never typesets.
 */
import { splitMath, type TypedBundle } from "@smriti/content-schema";
import { Text, useTheme } from "@smriti/ui-native";
import type { TextVariant, TextTone } from "@smriti/tokens/ui";
import { Fragment } from "react";
import { StyleSheet, View } from "react-native";
import { SvgXml } from "react-native-svg";

import { usePlayer } from "./context";

/** Pixels per ex at a font size (MathJax's ex is about half the em). */
const exPx = (fontSize: number) => fontSize * 0.5;

/** Strips anything that is not drawing (scripts, event handlers, external refs) from build SVG. */
export function safeSvg(svg: string): string {
  return svg
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son[a-z]+="[^"]*"/gi, "")
    .replace(/\s(?:xlink:)?href="(?!#)[^"]*"/gi, "");
}

export function MathSvg({ tex, bundle, fontSize, color, display }: { tex: string; bundle: TypedBundle; fontSize: number; color: string; display: boolean }) {
  const key = display ? `$$${tex}$$` : `$${tex}$`;
  const m = bundle.math[key] ?? bundle.math[display ? `$${tex}$` : `$$${tex}$$`];
  if (!m) {
    // Not rendered at build time: show the TeX source rather than nothing.
    return <Text variant="body">{tex}</Text>;
  }
  const w = Number(m.width_ex) * exPx(fontSize);
  const h = Number(m.height_ex) * exPx(fontSize);
  const svg = safeSvg(m.svg).replace(/currentColor/g, color);
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={m.tex ?? tex} style={display ? styles.display : styles.inline}>
      <SvgXml xml={svg} width={w} height={h} color={color} />
    </View>
  );
}

export interface RichTextProps {
  text: string;
  variant?: TextVariant;
  tone?: TextTone;
  testID?: string;
}

/** Paragraph text with inline and display maths from `bundle.math`. */
export function RichText({ text, variant = "body", tone = "ink", testID }: RichTextProps) {
  const { bundle } = usePlayer();
  const theme = useTheme();
  const segments = splitMath(text);
  const fontSize = variant === "title" ? 22 : variant === "heading" ? 19 : 17;
  const color = theme.colors.ink;
  if (!segments.some((s) => s.kind === "math")) {
    return (
      <Text variant={variant} tone={tone} testID={testID}>
        {text}
      </Text>
    );
  }
  return (
    <View style={styles.flow} testID={testID}>
      {segments.map((s, i) =>
        s.kind === "text" ? (
          <Fragment key={i}>
            {s.value.split(/(\s+)/).filter(Boolean).map((w, j) => (
              <Text key={j} variant={variant} tone={tone}>
                {w}
              </Text>
            ))}
          </Fragment>
        ) : (
          <MathSvg key={i} tex={s.value} bundle={bundle} fontSize={fontSize} color={color} display={s.display} />
        ),
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
  inline: { justifyContent: "center", marginHorizontal: 2 },
  display: { width: "100%", alignItems: "center", marginVertical: 8 },
});
