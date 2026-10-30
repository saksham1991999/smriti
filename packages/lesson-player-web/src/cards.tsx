/** One renderer per teaching card type (content-format §7). Question cards render in questions.tsx. */
import { useState, type ReactNode } from "react";
import type { BundleCard, BundleSheet } from "@smriti/content-schema";
import { mathKey } from "@smriti/content-schema";
import { FormulaBox, Icon, Text, cx, focusRing } from "@smriti/ui-web";
import type { WidgetResponse } from "@smriti/lesson-core";
import { usePlayer } from "./context";
import { Media } from "./Media";
import { DisplayMath, InlineMath, RichText, safeSvg } from "./RichText";
import { InteractiveCardView } from "./widgets";

export type SimCardData = Extract<BundleCard, { type: "sim" }>;

/** What a host-rendered sim can do: report a task result (lesson-core checks the measurement). */
export interface SimHostApi {
  reportTask: (taskId: string, measurement: { value: number; unit: string | null }) => void;
}

export interface CardViewProps {
  card: BundleCard;
  locked: boolean;
  onWidget: (r: WidgetResponse) => void;
  /** Renders a live sim, or null when the sim cannot run here (the card then shows its fallback). */
  renderSim?: (card: SimCardData, api: SimHostApi) => ReactNode | null;
  simApi: SimHostApi;
  taskDone: boolean;
}

export const Title = ({ children }: { children: ReactNode }) => <h2 className="m-0 text-heading font-bold text-ink">{children}</h2>;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="m-0 text-label font-bold text-ink-muted">{title}</h3>
      {children}
    </section>
  );
}

function Bullets({ items, ordered }: { items: string[]; ordered?: boolean }) {
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag className={cx("m-0 flex flex-col gap-1.5 ps-5", ordered ? "list-decimal" : "list-disc")}>
      {items.map((s, i) => (
        <li key={i} className="text-body text-ink">
          <RichText as="span" text={s} />
        </li>
      ))}
    </Tag>
  );
}

export function CardView(props: CardViewProps) {
  const { card } = props;
  const { t, bundle } = usePlayer();
  switch (card.type) {
    case "story":
      return (
        <div className="flex flex-col gap-3">
          {card.media && <Media refId={card.media} />}
          {card.panels && (
            <div className="grid grid-cols-2 gap-2">
              {card.panels.map((p, i) => (
                <figure key={i} className="m-0 flex flex-col gap-1">
                  <Media refId={p.media} />
                  {p.caption && <figcaption className="text-caption text-ink-muted">{p.caption}</figcaption>}
                </figure>
              ))}
            </div>
          )}
          <Title>{card.title}</Title>
          <RichText text={card.body} />
        </div>
      );
    case "explainer":
      return (
        <div className="flex flex-col gap-3">
          <Media refId={card.media} />
          <Title>{card.title}</Title>
          <RichText text={card.body} />
          {card.highlights && card.highlights.length > 0 && (
            <dl className="m-0 flex flex-col gap-2">
              {card.highlights.map((h, i) => (
                <div key={i} className="rounded-md bg-subject-tint p-3">
                  <dt className="font-bold text-subject-text">
                    <RichText as="span" text={h.term} className="font-bold text-subject-text" />
                  </dt>
                  <dd className="m-0">
                    <RichText text={h.definition} />
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      );
    case "formula":
      return (
        <div className="flex flex-col gap-3">
          <Title>{card.title}</Title>
          <FormulaBox latex={card.latex} svg={safeSvg(bundle.math[mathKey.display(card.latex)]?.svg) ?? undefined} label={card.spoken ?? card.latex} />
          <Section title={t("learn:WEB-02.symbols")}>
            <dl className="m-0 flex flex-col gap-1.5">
              {card.symbols.map((s, i) => (
                <div key={i} className="flex items-baseline gap-2">
                  <dt className="min-w-12 shrink-0">
                    <InlineMath latex={s.symbol} />
                  </dt>
                  <dd className="m-0 text-body text-ink">
                    {s.meaning}
                    {s.unit ? <span className="text-ink-muted"> ({s.unit})</span> : null}
                  </dd>
                </div>
              ))}
            </dl>
          </Section>
          {card.conditions && (
            <Section title={t("learn:WEB-02.works_when")}>
              <RichText text={card.conditions} />
            </Section>
          )}
          {card.media && <Media refId={card.media} />}
        </div>
      );
    case "animation":
      return <AnimationCard card={card} />;
    case "interactive":
      return <InteractiveCardView card={card} locked={props.locked} onResponse={props.onWidget} />;
    case "sim":
      return <SimCardView {...props} card={card} />;
    case "model3d":
      return (
        <Fallback title={t("learn:WEB-02.model_fallback_title")} prompt={card.prompt} fallback={card.fallback}>
          <Bullets items={card.labels.map((l) => l.text)} />
        </Fallback>
      );
    case "pano360":
      return (
        <Fallback title={t("learn:WEB-02.pano_fallback_title")} prompt={card.prompt} fallback={card.fallback}>
          <dl className="m-0 flex flex-col gap-2">
            {card.hotspots.map((h) => (
              <div key={h.id} className="rounded-md bg-surface-sunken p-3">
                <dt className="font-bold text-ink">{h.title}</dt>
                <dd className="m-0">
                  <RichText text={h.body} />
                </dd>
              </div>
            ))}
          </dl>
        </Fallback>
      );
    case "derivation":
      return (
        <div className="flex flex-col gap-3">
          <Title>{card.title}</Title>
          <ol className="m-0 flex list-none flex-col gap-3 p-0">
            {card.steps.map((s, i) => (
              <li key={i} className="flex gap-3">
                <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-subject-tint text-label font-bold text-subject-text">
                  {i + 1}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <DisplayMath latex={s.latex} />
                  <RichText text={s.say} />
                  {s.why && (
                    <Text variant="caption" tone="muted">
                      {t("learn:WEB-02.why_step")}: {s.why}
                    </Text>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      );
    case "worked_example":
      return <WorkedExample card={card} />;
    case "memory_hook": {
      const m = bundle.mnemonics[card.mnemonic] as { text?: string; decodes_to?: string[] } | undefined;
      return (
        <div className="flex flex-col gap-3">
          {card.media && <Media refId={card.media} />}
          {m?.text && <p className="m-0 rounded-md bg-subject-tint p-4 text-title font-bold text-subject-text">{m.text}</p>}
          {m?.decodes_to && <Bullets items={m.decodes_to} />}
        </div>
      );
    }
    case "roleplay":
      return (
        <div className="flex flex-col gap-3">
          <Media refId={card.character.portrait} />
          <Title>
            {card.character.name} · {card.character.era}
          </Title>
          <RichText text={card.opening_line} className="italic" />
          <OnlineOnlyNote extra={t("learn:WEB-02.roleplay_unavailable")} />
        </div>
      );
    case "video":
      return <VideoCard card={card} />;
    case "experiment":
      return (
        <div className="flex flex-col gap-4">
          <Title>{card.title}</Title>
          {card.media && <Media refId={card.media} />}
          {card.adult_supervision && (
            <p className="m-0 flex items-center gap-2 rounded-md bg-warning-tint p-3 text-label font-bold text-warning-text">
              <Icon name="Warning" size={20} color="warningText" />
              {t("learn:WEB-02.adult_supervision")}
            </p>
          )}
          <Section title={t("learn:WEB-02.materials")}>
            <Bullets items={card.materials} />
          </Section>
          <Section title={t("learn:WEB-02.steps")}>
            <Bullets items={card.steps} ordered />
          </Section>
          <Section title={t("learn:WEB-02.safety")}>
            <Bullets items={card.safety} />
          </Section>
          <Section title={t("learn:WEB-02.why_it_works")}>
            <RichText text={card.why_it_works} />
          </Section>
        </div>
      );
    case "summary":
      return (
        <div className="flex flex-col gap-3">
          {card.media && <Media refId={card.media} />}
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {card.points.map((p, i) => (
              <li key={i} className="flex gap-3">
                <Icon name="CheckCircle" weight="fill" color="subjectStrong" size={24} />
                <RichText text={p} className="flex-1" />
              </li>
            ))}
          </ul>
        </div>
      );
    case "cheat_sheet_ref":
      return <CheatSheet sheet={bundle.sheets[card.sheet]} />;
    case "common_traps":
      return (
        <div className="flex flex-col gap-3">
          {card.title && <Title>{card.title}</Title>}
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {card.traps.map((tr, i) => (
              <li key={i} className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-md bg-error-tint p-3">
                  <Text variant="label" tone="error">
                    {t("learn:LES-10.traps.2")}
                  </Text>
                  <RichText text={tr.mistake} />
                </div>
                <div className="rounded-md bg-success-tint p-3">
                  <Text variant="label" tone="success">
                    {t("learn:LES-10.traps.3")}
                  </Text>
                  <RichText text={tr.correct} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      );
    case "question":
      return null;
  }
}

function AnimationCard({ card }: { card: Extract<BundleCard, { type: "animation" }> }) {
  const { t, bundle } = usePlayer();
  const anim = bundle.media[card.media];
  return (
    <div className="flex flex-col gap-3">
      <Title>{card.title}</Title>
      {/* Lottie playback arrives with anim-maker output; until then the poster and transcript teach. */}
      <Media refId={anim?.status === "ready" && anim.kind === "image" ? card.media : (card.poster ?? card.media)} />
      <RichText text={card.caption} />
      <details className="rounded-md bg-surface-sunken p-3">
        <summary className={cx("cursor-pointer text-label font-bold text-ink", focusRing)}>{t("learn:WEB-02.transcript")}</summary>
        <RichText text={card.transcript} className="mt-2" />
      </details>
    </div>
  );
}

function WorkedExample({ card }: { card: Extract<BundleCard, { type: "worked_example" }> }) {
  const { t } = usePlayer();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <Section title={t("learn:WEB-02.problem")}>
        <RichText text={card.problem} className="font-semibold" />
      </Section>
      {card.media && <Media refId={card.media} />}
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className={cx("self-start rounded-full bg-primary-tint px-4 py-2 text-label font-bold text-primary-text", focusRing)} data-testid="show-solution">
          {t("learn:WEB-02.show_solution")}
        </button>
      ) : (
        <>
          <Section title={t("learn:LES-02.sections.2")}>
            <Bullets items={card.solution_steps} ordered />
          </Section>
          <Section title={t("learn:WEB-02.answer")}>
            <RichText text={card.answer} className="font-bold" />
          </Section>
          {card.shortcut && (
            <Section title={t("learn:LES-02.sections.3")}>
              <RichText text={card.shortcut} />
            </Section>
          )}
          {card.common_trap && (
            <Section title={t("learn:LES-02.sections.4")}>
              <RichText text={card.common_trap} />
            </Section>
          )}
        </>
      )}
    </div>
  );
}

function Fallback({ title, prompt, fallback, children }: { title: string; prompt: string; fallback: { media?: string; body: string }; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3" data-testid="lab-fallback">
      <Title>
        <RichText as="span" text={prompt} className="text-heading font-bold" />
      </Title>
      {fallback.media && <Media refId={fallback.media} />}
      <p className="m-0 flex items-center gap-2 text-label text-ink-muted">
        <Icon name="Info" size={20} color="inkMuted" />
        {title}
      </p>
      <RichText text={fallback.body} />
      {children}
    </div>
  );
}

function SimCardView({ card, renderSim, simApi, taskDone }: CardViewProps & { card: SimCardData }) {
  const { t } = usePlayer();
  const live = renderSim?.(card, simApi) ?? null;
  return (
    <div className="flex flex-col gap-3">
      {card.title && <Title>{card.title}</Title>}
      {live ?? (
        <div className="flex flex-col gap-3" data-testid="lab-fallback">
          {card.fallback.media && <Media refId={card.fallback.media} />}
          <p className="m-0 flex items-center gap-2 text-label text-ink-muted">
            <Icon name="Flask" size={20} color="inkMuted" />
            {t("learn:WEB-02.lab_fallback_title")}
          </p>
          <RichText text={card.fallback.body} />
        </div>
      )}
      {card.tasks.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {card.tasks.map((task) => (
            <li key={task.id} className="flex gap-2 rounded-md bg-subject-tint p-3">
              <Icon name="Flask" size={20} color="subjectText" />
              <RichText text={task.prompt} className="flex-1" />
            </li>
          ))}
        </ul>
      )}
      {taskDone && (
        <div className="rounded-md bg-surface-sunken p-3" role="status">
          <RichText text={card.debrief} />
        </div>
      )}
    </div>
  );
}

function OnlineOnlyNote({ extra }: { extra?: string }) {
  const { t, online } = usePlayer();
  return (
    <div className="flex flex-col gap-1 rounded-md bg-surface-sunken p-3" data-testid="online-only">
      <p className="m-0 flex items-center gap-2 text-label font-bold text-ink">
        <Icon name={online ? "Info" : "WifiSlash"} size={20} />
        {online ? extra : t("learn:WEB-02.online_only_title")}
      </p>
      {!online && <Text variant="caption" tone="muted">{t("learn:WEB-02.online_only_body")}</Text>}
    </div>
  );
}

function VideoCard({ card }: { card: Extract<BundleCard, { type: "video" }> }) {
  const { t, online } = usePlayer();
  const [play, setPlay] = useState(false);
  const src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(card.youtube_id)}?start=${card.start_s}&end=${card.end_s}&rel=0&modestbranding=1`;
  return (
    <div className="flex flex-col gap-3">
      {card.title && <Title>{card.title}</Title>}
      {!online ? (
        <OnlineOnlyNote />
      ) : play ? (
        <div className="aspect-video overflow-hidden rounded-md bg-surface-sunken">
          <iframe title={card.title ?? t("learn:WEB-02.kind_video")} src={src} className="size-full" allow="encrypted-media; picture-in-picture" referrerPolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-presentation" />
        </div>
      ) : (
        <button type="button" onClick={() => setPlay(true)} className={cx("flex aspect-video items-center justify-center gap-2 rounded-md bg-surface-sunken text-label font-bold text-ink", focusRing)} data-testid="play-video">
          <Icon name="Play" size={32} weight="fill" />
          {t("learn:WEB-02.play_video")}
        </button>
      )}
    </div>
  );
}

function CheatSheet({ sheet }: { sheet: BundleSheet | undefined }) {
  const { t } = usePlayer();
  const s = sheet as
    | { title?: string; key_ideas?: string[]; formulas?: { name: string; latex: string }[]; traps?: { mistake: string; correct: string }[] }
    | undefined;
  if (!s) return <Media refId={null} />;
  return (
    <div className="flex flex-col gap-4">
      {s.title && <Title>{s.title}</Title>}
      {s.key_ideas && s.key_ideas.length > 0 && (
        <Section title={t("learn:LRN-07.sections.1")}>
          <Bullets items={s.key_ideas} />
        </Section>
      )}
      {s.formulas && s.formulas.length > 0 && (
        <Section title={t("learn:LRN-07.sections.2")}>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {s.formulas.map((f, i) => (
              <li key={i} className="rounded-md bg-subject-tint p-3">
                <Text variant="label">{f.name}</Text>
                <DisplayMath latex={f.latex} />
              </li>
            ))}
          </ul>
        </Section>
      )}
      {s.traps && s.traps.length > 0 && (
        <Section title={t("learn:LRN-07.sections.4")}>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {s.traps.map((tr, i) => (
              <li key={i} className="rounded-md bg-surface-sunken p-3">
                <RichText text={tr.mistake} className="text-error-text line-through decoration-1" />
                <RichText text={tr.correct} className="font-semibold" />
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
