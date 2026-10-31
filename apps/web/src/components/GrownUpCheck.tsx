/**
 * PAY-03 grown-up check: before a learner under 18 checks out, ask whether a parent or guardian
 * is paying. Under-13s (R15) never see a price, so they get the no-price body and the way into
 * Parent mode instead of checkout. "Send to my parent" (PAY-17 link) waits for its server token,
 * so it is not offered on the web yet. No verification happens here; the bank verifies the payer.
 */
import { Dialog } from "@smriti/ui-web";
import { useServices } from "../boot/context";
import { useI18n } from "../lib/i18n";
import { usePriceValues } from "../lib/pricing";

export function GrownUpCheck(p: {
  open: boolean;
  /** Under-13: no price, and "yes" opens Parent mode. */
  child: boolean;
  eligible: boolean;
  onYes: () => void;
  onClose: () => void;
}) {
  const s = useServices();
  const { t } = useI18n();
  const pv = usePriceValues();
  const body = p.child
    ? t("me_money:WEB-09.grown_up_body_no_price")
    : p.eligible
      ? t("me_money:PAY-03.body", pv)
      : t("me_money:PAY-03.body_not_eligible", pv);
  return (
    <Dialog
      open={p.open}
      onOpenChange={(o) => !o && p.onClose()}
      title={t("me_money:PAY-03.title")}
      description={body}
      confirm={{
        label: p.child ? t("me_money:WEB-09.grown_up_open_parent") : t("me_money:PAY-03.yes"),
        onPress: () => {
          s.analytics.track("grownup_check_answered", { answer: "parent_here" });
          p.onYes();
        },
      }}
      cancel={{ label: t("me_money:PAY-03.not_now"), onPress: p.onClose }}
      testID="pay-03"
    />
  );
}
