/**
 * AI-07 as a page (web): a free student who opens a Pro tool's own route sees what the tool does
 * and [See Pro] → PAY-01 with the tool as the source. Under-13s never see a price (R15): they get
 * "Ask a grown-up" instead. The ₹1 line shows only when the server says the offer applies.
 */
import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAppStore } from "@smriti/app-core/react";
import { Button, Illustration, ProChip, Text } from "@smriti/ui-web";
import { useServices } from "../../../boot/context";
import { useI18n } from "../../../lib/i18n";
import { useOnline } from "../../../lib/network";
import { usePriceValues } from "../../../lib/pricing";
import { useIntroEligible } from "../../../lib/pro";
import { Page } from "./Page";
import { usePet } from "./pet";

export type ProTool = "feynman" | "voice";

const ART: Record<ProTool, string> = { feynman: "scene-student-laptop", voice: "scene-voice-tutor" };

export function ProTeaser({ tool, onClose }: { tool: ProTool; onClose: () => void }) {
  const { t } = useI18n();
  const s = useServices();
  const navigate = useNavigate();
  const online = useOnline();
  const eligible = useIntroEligible();
  const prices = usePriceValues();
  const pet = usePet();
  const band = useAppStore((x) => x.profile?.age_band ?? null);
  const under13 = band === "u10" || band === "10_12";
  const petName = pet?.name ?? t("tutor_social:AI-13.pet_fallback");
  useEffect(() => {
    s.analytics.track("pro_teaser_shown", { feature: tool });
  }, [s, tool]);

  const title = tool === "voice" ? t("tutor_social:AI-07.voice_title", { pet_name: petName }) : t("tutor_social:AI-07.feynman_title");
  const body = tool === "voice" ? t("tutor_social:AI-07.voice_body") : t("tutor_social:AI-07.feynman_body");
  const alt = tool === "voice" ? t("tutor_social:AI-07.voice_alt", { pet_name: petName }) : t("tutor_social:AI-07.feynman_alt", { pet_name: petName });
  return (
    <Page onBack={onClose} backIcon="X" testID="ai-07">
      <div className="mx-auto flex w-full max-w-[520px] flex-1 flex-col justify-center gap-4 pb-8">
        <div className="overflow-hidden rounded-card-large bg-primary-tint">
          <Illustration name={ART[tool]} alt={alt} className="aspect-[3/2] w-full" fit="cover" />
        </div>
        <Text variant="title" heading as="h1">
          {title}
        </Text>
        <Text>{body}</Text>
        {!under13 && eligible && (
          <Text variant="caption" tone="muted">
            {t("tutor_social:AI-07.price_line", prices)}
          </Text>
        )}
        <div className="flex flex-col gap-2">
          {under13 ? (
            <ProChip askGrownUp className="self-start" />
          ) : (
            <Button
              label={t("tutor_social:AI-07.primary")}
              disabled={!online}
              onPress={() => {
                s.analytics.track("pro_teaser_cta_tapped", { feature: tool });
                void navigate({ to: "/pro", search: { source: `tutor_${tool}` } });
              }}
              testID="ai-07-see-pro"
            />
          )}
          <Button label={t("tutor_social:AI-07.secondary")} variant="ghost" onPress={onClose} testID="ai-07-not-now" />
        </div>
      </div>
    </Page>
  );
}
