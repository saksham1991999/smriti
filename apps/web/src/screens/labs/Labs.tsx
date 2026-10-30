/**
 * LAB-01 Labs hub and LAB-04 lab screen: the sim bundles from sims/ (built by sim-builder and
 * copied to /sims/ by scripts/copy-sims.mjs), each run in a sandboxed iframe through sim-bridge.
 */
import { useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { TaskProgress, TaskSpec, ParamValues } from "@smriti/sim-bridge";
import { Card, Chip, ChoiceChips, Icon, Illustration, PetLine, Text, TopBar } from "@smriti/ui-web";
import { useAppStore } from "@smriti/app-core/react";
import { useServices } from "../../boot/context";
import { SimFrame } from "../../components/SimFrame";
import { useI18n } from "../../lib/i18n";
import { LoadError, NotFound, RouteLoading } from "../../shell/States";

interface SimEntry {
  id: string;
  title: { en: string; hi: string };
  subject: string;
  aspect: string;
  params: Record<string, { default: number | string | boolean }>;
  tasks: TaskSpec[];
}

/** Lab cover art per sim: Agnes images from the illustration kit (none is drawn in code). */
const COVER: Record<string, string> = {
  "acid-base-titration": "lab-titration",
  "convex-lens-bench": "lab-optics",
  "ohms-law-circuit": "lab-circuit",
  "simple-pendulum": "scene-student-laptop",
};

function useSims() {
  const s = useServices();
  return useQuery({
    queryKey: ["sims", "index"],
    staleTime: Infinity,
    queryFn: async () => {
      const r = await s.fetch("/sims/index.json");
      if (!r.ok) throw new Error(`sims ${r.status}`);
      return ((await r.json()) as { sims: SimEntry[] }).sims;
    },
  });
}

const SUBJECTS = ["all", "phy", "chem"] as const;

export function LabsHub() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const sims = useSims();
  const pet = useAppStore((x) => x.pet);
  const [filter, setFilter] = useState<string>("all");
  if (sims.isError) return <LoadError onRetry={() => void sims.refetch()} />;
  if (sims.isPending) return <RouteLoading />;
  const shown = sims.data.filter((x) => filter === "all" || x.subject === filter);
  return (
    <div className="flex flex-col gap-4 px-4 pt-3 pb-6 md:px-8 md:pt-6" data-testid="lab-01">
      <Text variant="title" heading as="h1">
        {t("memory_labs:LAB-01.title")}
      </Text>
      {pet && <PetLine pet={{ species: pet.species as "cat" | "dog" }} petName={pet.name} text={t("memory_labs:LAB-01.pet")} />}
      <ChoiceChips
        label={t("memory_labs:LAB-01.title")}
        hideLabel
        options={SUBJECTS.map((v) => ({ value: v, label: v === "all" ? t("memory_labs:LAB-01.all") : v === "phy" ? t("memory_labs:WEB-04.subject_physics") : t("memory_labs:WEB-04.subject_chemistry") }))}
        value={[filter]}
        onChange={(v) => setFilter(v[0] ?? "all")}
        testID="lab-filter"
      />
      {shown.length === 0 && <Text tone="muted">{t("memory_labs:LAB-01.empty_filter")}</Text>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((sim) => (
          <Card key={sim.id} onPress={() => void navigate({ to: "/labs/$simId", params: { simId: sim.id } })} subject={sim.subject} tone="tint" testID={`lab-${sim.id}`}>
            <span className="flex flex-col gap-2">
              <Illustration name={COVER[sim.id] ?? "scene-student-laptop"} width={320} height={160} fit="contain" className="h-[140px] w-full" decorative />
              <Text variant="heading">{sim.title[locale]}</Text>
              <span className="flex flex-wrap gap-2">
                <Chip kind="status" tone="sunken" icon="Flask" label={t("memory_labs:LAB-04.tasks", { done: 0, total: sim.tasks.length })} />
                <Chip kind="status" tone="success" icon="WifiSlash" label={t("memory_labs:LAB-01.offline_chip")} />
              </span>
            </span>
          </Card>
        ))}
      </div>
      <Text variant="caption" tone="muted">
        {t("memory_labs:LAB-01.coming")}
      </Text>
    </div>
  );
}

export function LabScreen() {
  const { simId } = useParams({ strict: false }) as { simId: string };
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const s = useServices();
  const sims = useSims();
  const [progress, setProgress] = useState<Record<string, TaskProgress>>({});
  if (sims.isError) return <LoadError onRetry={() => void sims.refetch()} />;
  if (sims.isPending) return <RouteLoading />;
  const sim = sims.data.find((x) => x.id === simId);
  if (!sim) return <NotFound />;
  const params: ParamValues = Object.fromEntries(Object.entries(sim.params).map(([k, v]) => [k, v.default]));
  const done = Object.values(progress).filter((p) => p.status === "correct").length;
  return (
    <div className="flex flex-col gap-3 pb-6" data-subject={sim.subject} data-testid="lab-04">
      <TopBar title={sim.title[locale]} onBack={() => void navigate({ to: "/labs" })} />
      <div className="flex flex-col gap-3 px-4 md:px-8">
        <SimFrame
          simId={sim.id}
          title={sim.title[locale]}
          aspect={sim.aspect}
          params={params}
          tasks={sim.tasks}
          onTask={(p) => setProgress((x) => ({ ...x, [p.taskId]: p }))}
          onStatus={(st) => {
            if (st === "running") s.analytics.track("lab_opened", { lab_id: sim.id, kind: "sim", entry: "hub" });
          }}
        />
        <Text variant="heading" heading as="h2">
          {t("memory_labs:LAB-04.tasks", { done, total: sim.tasks.length })}
        </Text>
        <ol className="m-0 flex list-none flex-col gap-2 p-0">
          {sim.tasks.map((task) => {
            const p = progress[task.id];
            return (
              <li key={task.id} className="flex gap-2 rounded-md bg-subject-tint p-3" data-testid={`task-${task.id}`} data-status={p?.status ?? "pending"}>
                <Icon name={p?.status === "correct" ? "CheckCircle" : "Flask"} color={p?.status === "correct" ? "success" : "subjectText"} label={p?.status === "correct" ? t("memory_labs:LAB-04.right") : undefined} />
                <span className="flex flex-1 flex-col gap-1">
                  <Text>{task.prompt[locale]}</Text>
                  {p?.status === "wrong" && task.hint && p.tries >= 2 && (
                    <Text variant="caption" tone="muted">
                      {t("memory_labs:LAB-04.hint", { task_hint: task.hint[locale] })}
                    </Text>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
