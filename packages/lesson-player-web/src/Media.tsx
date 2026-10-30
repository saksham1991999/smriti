import { Icon, Text, cx } from "@smriti/ui-web";
import { contentUrl, usePlayer } from "./context";

/**
 * A bundle image by media ref (bundle.media). Only published Agnes images are shown; a ref that is
 * not ready yet shows a neutral tile with a caption instead of any stand-in art (AGENTS.md rule 2).
 */
export function Media({ refId, className, fit = "contain" }: { refId: string | null | undefined; className?: string; fit?: "contain" | "cover" }) {
  const { bundle, contentBaseUrl, t } = usePlayer();
  if (!refId) return null;
  const m = bundle.media[refId];
  if (m && m.status === "ready" && m.url && (m.kind === "image" || m.mime?.startsWith("image/"))) {
    return (
      <div className={cx("overflow-hidden rounded-md bg-subject-tint", className)}>
        <img
          src={contentUrl(contentBaseUrl, m.url)}
          alt={m.decorative ? "" : (m.alt ?? "")}
          width={m.width ?? undefined}
          height={m.height ?? undefined}
          loading="lazy"
          decoding="async"
          className={cx("mx-auto block h-auto max-h-64 w-full", fit === "cover" ? "object-cover" : "object-contain")}
        />
      </div>
    );
  }
  return (
    <div className={cx("flex min-h-24 items-center justify-center gap-2 rounded-md bg-surface-sunken p-4", className)} data-testid="media-missing">
      <Icon name="Info" size={20} color="inkMuted" />
      <Text variant="caption" tone="muted">
        {t("learn:WEB-02.media_missing")}
      </Text>
    </div>
  );
}
