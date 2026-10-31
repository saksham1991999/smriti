/**
 * AUTH-08 merge notice: the guest's progress was added to the account they already had, with the
 * server's numbers (`account_merges.stats`). Rows with zero are hidden. A merge still running
 * shows the pending variant and a toast follows when it finishes.
 */
import { useEffect } from "react";
import { useAppStore } from "@smriti/app-core/react";
import { Button, Dialog, Icon, Illustration, Text, type IconName } from "@smriti/ui-web";
import { useServices } from "../../boot/context";
import { readMerge } from "../../lib/auth";
import { useI18n } from "../../lib/i18n";
import { mergeResult, useMergeNotice, type MergeStats } from "../../lib/merge";
import { toast } from "../../lib/toast";

function Row({ icon, label, value }: { icon: IconName; label: string; value?: string }) {
  return (
    <li className="flex min-h-10 items-center gap-3">
      <Icon name={icon} color="primary" />
      <Text variant="label" className="flex-1">
        {label}
      </Text>
      {value && (
        <Text variant="label" className="tabular-nums">
          {value}
        </Text>
      )}
    </li>
  );
}

function Rows({ stats, petName }: { stats: MergeStats; petName: string }) {
  const { t } = useI18n();
  return (
    <ul
      className="m-0 flex list-none flex-col gap-1 rounded-card bg-surface-sunken p-4"
      data-testid="merge-rows"
    >
      {stats.lessonsAdded > 0 && (
        <Row
          icon="BookBookmark"
          label={t("auth:AUTH-08.lessons_row.1")}
          value={t("auth:AUTH-08.lessons_row.2", { n: stats.lessonsAdded })}
        />
      )}
      {stats.xpAdded > 0 && (
        <Row
          icon="Lightning"
          label={t("auth:AUTH-08.xp_row.1")}
          value={t("auth:AUTH-08.xp_row.2", { n: stats.xpAdded })}
        />
      )}
      {stats.streakAfter > 0 && (
        <Row
          icon="Plant"
          label={t("auth:AUTH-08.streak_row.1")}
          value={t("auth:AUTH-08.streak_row.2", { n: stats.streakAfter })}
        />
      )}
      {petName && stats.petKept === "guest" && (
        <Row
          icon="Smiley"
          label={t("auth:AUTH-08.buddy_row_guest_pet_moved", { guest_pet: petName })}
        />
      )}
      {petName && stats.petKept !== "guest" && (
        <Row
          icon="Smiley"
          label={t("auth:AUTH-08.buddy_row_account_pet_kept", { account_pet: petName })}
        />
      )}
    </ul>
  );
}

export function MergeNotice() {
  const s = useServices();
  const { t } = useI18n();
  const result = useMergeNotice((x) => x.result);
  const close = useMergeNotice((x) => x.close);
  const pet = useAppStore((x) => x.pet);

  // Pending: keep asking; when it lands, refresh the state and say so.
  const pendingId = useMergeNotice((x) => x.pendingId);
  useEffect(() => {
    if (!pendingId) return;
    let stop = false;
    let tries = 0;
    const tick = async () => {
      if (stop || tries++ > 40) return;
      const st = await readMerge(s, pendingId);
      if (stop) return;
      if (st?.status === "done") {
        await s.refreshState(true);
        const ui = useMergeNotice.getState();
        if (ui.result?.mergeId === pendingId) ui.show(mergeResult(pendingId, st));
        else toast.show(t("auth:WEB-07.merge_done_toast"), { icon: "CloudCheck" });
        ui.settle();
        return;
      }
      if (st?.status === "failed") {
        useMergeNotice.getState().settle();
        return;
      }
      setTimeout(() => void tick(), 3000);
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [pendingId, s, t]);

  if (!result) return null;
  const done = result.status === "done" && result.stats;
  const streak = result.stats?.streakAfter ?? 0;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      title={done ? t("auth:AUTH-08.title") : t("auth:AUTH-08.pending_title")}
      description={
        done
          ? streak > 0
            ? t("auth:AUTH-08.line", { streak })
            : t("auth:AUTH-08.line_no_streak")
          : t("auth:AUTH-08.pending_line")
      }
      testID="auth-08"
    >
      <div className="flex flex-col gap-4">
        <Illustration
          name={pet?.species === "dog" ? "dog-celebrate" : "cat-celebrate"}
          width={160}
          height={160}
          className="mx-auto"
          decorative
        />
        {done && result.stats && <Rows stats={result.stats} petName={pet?.name ?? ""} />}
        <Button label={t("auth:AUTH-08.great")} onPress={close} testID="auth-08-great" />
      </div>
    </Dialog>
  );
}
