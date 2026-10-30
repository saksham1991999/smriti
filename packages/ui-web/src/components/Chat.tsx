import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { ChatBubbleContract, ChatInputContract } from "@smriti/tokens/ui";
import { useUI } from "../provider";
import { cx, focusRing, pressable } from "../util";
import { Icon } from "./Icon";
import { PetAvatar } from "./Illustration";

export interface ChatBubbleProps extends ChatBubbleContract {
  className?: string;
  /** Rich body (KaTeX, Formula box, generated image). Used instead of `text`. */
  children?: ReactNode;
  /** Citations slot, under the body (sources, PYQ citation chips). */
  citations?: ReactNode;
  /** Action row slot under a finished answer (thumbs, save as flashcard, read aloud). */
  actions?: ReactNode;
}

function ThinkingDots() {
  return (
    <span aria-hidden className="inline-flex gap-1">
      {[0, 1, 2].map((i) => (
        <span key={i} className="size-2 rounded-full bg-ink-muted motion-safe:animate-[sm-dot_1.2s_ease-in-out_infinite]" style={{ animationDelay: `${i * 160}ms` }} />
      ))}
    </span>
  );
}

/**
 * One message in the tutor chat (AI-02). Student: right, primaryTint, 6 px corner bottom right.
 * Tutor: left, nearly full width, surfaceRaised, the pet avatar and an "AI" label above, the AI line under
 * a finished answer. System: a centred caption. A streamed answer is announced once, when it completes.
 */
export function ChatBubble({ role, text, authorName, avatar, streaming, stopped, showAiLabel, live = true, children, citations, actions, testID, className }: ChatBubbleProps) {
  const { t } = useUI();
  const [announce, setAnnounce] = useState("");
  const wasStreaming = useRef(streaming);
  useEffect(() => {
    if (wasStreaming.current && !streaming && live && text) setAnnounce(text);
    wasStreaming.current = streaming;
  }, [streaming, live, text]);
  const hasBody = Boolean(text) || Boolean(children);

  if (role === "system") {
    return (
      <p data-testid={testID} data-role="system" className={cx("m-0 self-center px-4 text-center text-caption text-ink-muted", className)}>
        {text ?? children}
      </p>
    );
  }

  if (role === "student") {
    return (
      <div data-testid={testID} data-role="student" className={cx("flex justify-end", className)}>
        <div className="max-w-[85%] rounded-[20px] rounded-br-[6px] bg-primary-tint px-4 py-2.5 text-body text-ink">
          <span className="sr-only">{t("chat.fromStudent", { text: "" })}</span>
          {text ?? children}
        </div>
      </div>
    );
  }

  const aiLine = (showAiLabel ?? true) && !streaming && hasBody;
  return (
    <div data-testid={testID} data-role="tutor" className={cx("flex w-[calc(100%-16px)] flex-col gap-1.5", className)}>
      {(avatar || authorName) && (
        <div className="flex items-center gap-2">
          {avatar && <PetAvatar species={avatar.species} mood={avatar.mood} size={24} />}
          {authorName && <span className="text-label font-bold text-ink">{authorName}</span>}
          <span className="rounded-full bg-surface-sunken px-2 text-caption font-bold text-ink-muted" title={t("chat.aiLabel")}>
            {t("chat.ai")}
          </span>
        </div>
      )}
      <div aria-busy={streaming || undefined} className="rounded-[20px] rounded-tl-[6px] bg-surface-raised px-4 py-3 text-body text-ink shadow-card">
        {streaming && !hasBody ? (
          <span className="inline-flex items-center gap-2 text-label text-ink-muted">
            <ThinkingDots />
            {t("chat.thinking", { name: authorName ?? "" })}
          </span>
        ) : (
          <div className="flex flex-col gap-2 [&_.katex-display]:my-1">{text ?? children}</div>
        )}
        {stopped && <p className="m-0 mt-1.5 text-caption text-ink-muted">{t("chat.stopped")}</p>}
        {citations && (
          <div className="mt-2.5 flex flex-col gap-1.5 border-t border-line pt-2.5">
            <span className="text-caption text-ink-muted">{t("chat.sources")}</span>
            <div className="flex flex-wrap gap-2">{citations}</div>
          </div>
        )}
      </div>
      {aiLine && <p className="m-0 text-caption text-ink-muted">{t("chat.aiLabel")}</p>}
      {actions && !streaming && <div className="flex flex-wrap items-center gap-1">{actions}</div>}
      <span aria-live="polite" className="sr-only">
        {announce ? t("chat.fromTutor", { name: authorName ?? "", text: announce }) : ""}
      </span>
    </div>
  );
}

export interface ChatInputProps extends ChatInputContract {
  className?: string;
  /** Left slot: camera or attach button (48 px). */
  attach?: ReactNode;
  /** Right slot before Send: the mic button. */
  trailing?: ReactNode;
}

const LINE = 24; // body line height
const PAD_Y = 12;

/** The pinned input row (AI-02): attach slot, a field that grows to 5 lines, Send (Stop while streaming). Enter sends, Shift+Enter adds a line. */
export function ChatInput({ value, onChange, onSend, label, placeholder, maxLength, maxLines = 5, disabled, streaming, onStop, attach, trailing, testID, className }: ChatInputProps) {
  const { t } = useUI();
  const ref = useRef<HTMLTextAreaElement>(null);
  const counterId = useId();
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, LINE * maxLines + PAD_Y * 2)}px`;
  }, [value, maxLines]);
  const remaining = maxLength === undefined ? null : maxLength - value.length;
  const showCounter = remaining !== null && maxLength !== undefined && remaining <= Math.ceil(maxLength * 0.2);
  const canSend = !disabled && value.trim().length > 0 && (remaining === null || remaining >= 0);
  const send = () => {
    if (canSend) onSend();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!streaming) send();
    }
  };
  return (
    <div data-testid={testID} className={cx("flex flex-col gap-1 border-t border-line bg-surface px-3 py-2", className)}>
      <div className="flex items-end gap-2">
        {attach}
        <textarea
          ref={ref}
          rows={1}
          value={value}
          aria-label={label}
          aria-describedby={showCounter ? counterId : undefined}
          placeholder={placeholder}
          maxLength={maxLength}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          className={cx("min-h-12 min-w-0 flex-1 resize-none rounded-md bg-surface-sunken px-4 py-3 text-body text-ink placeholder:text-ink-muted", focusRing, disabled && "opacity-60")}
          style={{ lineHeight: `${LINE}px` }}
        />
        {trailing}
        {streaming ? (
          <button type="button" aria-label={t("chat.stop")} onClick={onStop} className={cx("grid size-12 shrink-0 place-items-center rounded-full bg-surface-raised text-ink shadow-card", focusRing, pressable)}>
            <Icon name="Stop" weight="fill" />
          </button>
        ) : (
          <button
            type="button"
            aria-label={t("chat.send")}
            disabled={!canSend}
            onClick={send}
            className={cx("grid size-12 shrink-0 place-items-center rounded-full", canSend ? cx("bg-primary text-on-primary", pressable) : "bg-surface-sunken text-ink-disabled", focusRing)}
          >
            <Icon name="PaperPlaneRight" weight="fill" />
          </button>
        )}
      </div>
      {showCounter && remaining !== null && (
        <span id={counterId} aria-live="polite" className={cx("px-1 text-end text-caption tabular-nums", remaining <= 0 ? "text-error-text" : "text-ink-muted")}>
          {t("chat.charsLeft", { n: Math.max(0, remaining) })}
        </span>
      )}
    </div>
  );
}
