import type { RoomCardContract } from "@smriti/tokens/ui";
import { useUI } from "../provider";
import { cx, focusRing } from "../util";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { Illustration } from "./Illustration";

export interface RoomCardProps extends RoomCardContract {
  className?: string;
}

/**
 * A memory-palace card (MEM-12): the first room's image as a 3:2 banner, the name in heading, the meta line,
 * a Due marker (warning, Clock and the word), then [Walk] secondary and [Quiz me] primary small.
 * The banner and title open the palace (onPress); the two buttons are separate controls after it.
 */
export function RoomCard({ name, image, imageAlt, meta, due, onWalk, onQuiz, onPress, testID, className }: RoomCardProps) {
  const { t } = useUI();
  const head = (
    <>
      <span className="relative block aspect-[3/2] w-full overflow-hidden bg-surface-sunken">
        <Illustration name={image} alt={imageAlt} decorative={!imageAlt} fit="cover" className="absolute inset-0 size-full" />
        {due && (
          <span className="absolute end-3 top-3 inline-flex h-7 items-center gap-1 rounded-full bg-warning px-2.5 text-label font-bold text-on-warning">
            <Icon name="Clock" size={16} weight="bold" />
            {t("palace.due")}
          </span>
        )}
      </span>
      <span className="flex flex-col gap-1 px-4 pt-3">
        <span className="text-heading text-ink">{name}</span>
        {meta && <span className="text-label text-ink-muted">{meta}</span>}
      </span>
    </>
  );
  return (
    <article data-testid={testID} aria-label={name} className={cx("flex flex-col overflow-hidden rounded-card-large bg-surface shadow-card", className)}>
      {onPress ? (
        <button type="button" onClick={onPress} className={cx("flex flex-col text-start", focusRing, "cursor-pointer focus-visible:-outline-offset-[3px]")}>
          {head}
        </button>
      ) : (
        <div className="flex flex-col">{head}</div>
      )}
      {(onWalk || onQuiz) && (
        <div className="flex flex-wrap gap-2 px-4 pb-4 pt-3">
          {onWalk && <Button label={t("palace.walk")} variant="secondary" size="sm" onPress={onWalk} testID={testID ? `${testID}-walk` : undefined} />}
          {onQuiz && <Button label={t("palace.quiz")} variant="primary" size="sm" onPress={onQuiz} testID={testID ? `${testID}-quiz` : undefined} />}
        </div>
      )}
      {!onWalk && !onQuiz && <div className="pb-4" />}
    </article>
  );
}
