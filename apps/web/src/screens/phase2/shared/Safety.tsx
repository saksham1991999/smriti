/**
 * AI-08 inside a Pro tool: a calm refusal, or crisis support with the helplines the server sends
 * (owner config `safety.helplines`, verified against official sources; never numbers in code).
 */
import { Button, Card, Icon, PetLine, Text } from "@smriti/ui-web";
import { useI18n } from "../../../lib/i18n";
import { usePet } from "./pet";

export interface SafetyInfo {
  kind: "crisis" | "refusal";
  helplines: unknown;
}

interface Helpline {
  name: string;
  description: string | null;
  number: string;
}

/** Whatever shape the config uses, keep only rows with a name and a number. */
export function helplinesFrom(value: unknown): Helpline[] {
  if (!Array.isArray(value)) return [];
  const out: Helpline[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name : null;
    const number = typeof r.number === "string" ? r.number : typeof r.phone === "string" ? r.phone : null;
    if (!name || !number) continue;
    out.push({ name, number, description: typeof r.description === "string" ? r.description : typeof r.label === "string" ? r.label : null });
  }
  return out;
}

export function SafetyCard({ info, topicTitle, onBack }: { info: SafetyInfo; topicTitle: string; onBack: () => void }) {
  const { t } = useI18n();
  const pet = usePet();
  const petName = pet?.name ?? t("tutor_social:AI-13.pet_fallback");
  if (info.kind === "refusal") {
    return (
      <div className="flex flex-col gap-4" data-testid="ai-08-refusal">
        {pet ? <PetLine pet={{ species: pet.species, mood: "curious" }} petName={pet.name} text={t("tutor_social:AI-08.refusal")} /> : <Text>{t("tutor_social:AI-08.refusal")}</Text>}
        {topicTitle && <Button label={t("tutor_social:AI-08.chip", { topic_title: topicTitle })} variant="secondary" onPress={onBack} className="self-start" />}
      </div>
    );
  }
  const lines = helplinesFrom(info.helplines);
  return (
    <Card tone="surface" outlined testID="ai-08-crisis">
      <div className="flex flex-col gap-4" role="alert">
        <Text variant="title" as="h2">
          {t("tutor_social:AI-08.crisis_title")}
        </Text>
        <Text>{t("tutor_social:AI-08.crisis_body")}</Text>
        {lines.length > 0 && (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {lines.map((h) => (
              <li key={h.name + h.number} className="flex items-center gap-3 rounded-card bg-surface-sunken p-3">
                <div className="min-w-0 flex-1">
                  <Text variant="label">{h.name}</Text>
                  {h.description && (
                    <Text variant="caption" tone="muted">
                      {h.description}
                    </Text>
                  )}
                </div>
                <a href={`tel:${h.number.replace(/[^\d+]/g, "")}`} className="inline-flex min-h-touch items-center rounded-button bg-primary px-4 text-label text-on-primary">
                  {t("tutor_social:AI-08.call_button", { helpline_name: h.name })}
                </a>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-col gap-1">
          <Text variant="label">{t("tutor_social:AI-08.trusted_person")}</Text>
          {(["tutor_social:AI-08.trusted_list.1", "tutor_social:AI-08.trusted_list.2", "tutor_social:AI-08.trusted_list.3"] as const).map((k) => (
            <span key={k} className="inline-flex items-center gap-2 text-body">
              <Icon name="UserCircle" size={20} />
              {t(k)}
            </span>
          ))}
        </div>
        <Button label={t("tutor_social:AI-08.keep_talking", { pet_name: petName })} variant="ghost" onPress={onBack} />
      </div>
    </Card>
  );
}
