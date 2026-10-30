import { useId, type InputHTMLAttributes } from "react";
import { Text } from "@smriti/ui-web";

/** A labelled text input on the sunken surface (DESIGN.md §5 inputs), with helper or error text. */
export function TextField({
  label,
  helper,
  error,
  testID,
  className,
  ...input
}: { label: string; helper?: string; error?: string | null; testID?: string; className?: string } & Omit<InputHTMLAttributes<HTMLInputElement>, "className">) {
  const id = useId();
  const note = `${id}-note`;
  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ""}`}>
      <label htmlFor={id} className="text-label text-ink-muted">
        {label}
      </label>
      <input
        id={id}
        data-testid={testID}
        aria-invalid={error ? true : undefined}
        aria-describedby={helper || error ? note : undefined}
        className={`h-14 w-full rounded-md bg-surface-sunken px-4 text-heading text-ink outline-none placeholder:text-ink-muted focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-primary ${error ? "ring-2 ring-inset ring-error" : ""}`}
        {...input}
      />
      {(error || helper) && (
        <Text variant="caption" tone={error ? "error" : "muted"} id={note}>
          {error ?? helper}
        </Text>
      )}
    </div>
  );
}
