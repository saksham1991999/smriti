export type Severity = "error" | "warning";

export interface Finding {
  severity: Severity;
  /** Stable machine code, for example "ref_unknown_concept". */
  code: string;
  /** Path relative to the content root. */
  file: string;
  /** JSON pointer inside the file, when known. */
  path?: string;
  /** The content id the finding is about (card, question, concept...). */
  id?: string;
  message: string;
}

export class Findings {
  readonly items: Finding[] = [];

  error(code: string, file: string, message: string, extra: Partial<Finding> = {}): void {
    this.items.push({ severity: "error", code, file, message, ...extra });
  }

  warn(code: string, file: string, message: string, extra: Partial<Finding> = {}): void {
    this.items.push({ severity: "warning", code, file, message, ...extra });
  }

  get errorCount(): number {
    return this.items.filter((f) => f.severity === "error").length;
  }

  get warningCount(): number {
    return this.items.filter((f) => f.severity === "warning").length;
  }

  sorted(): Finding[] {
    return [...this.items].sort(
      (a, b) =>
        (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1) ||
        a.file.localeCompare(b.file) ||
        a.code.localeCompare(b.code) ||
        (a.path ?? "").localeCompare(b.path ?? ""),
    );
  }
}
