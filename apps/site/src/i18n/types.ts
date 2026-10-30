import type { en } from "./en";

/** The shape of the English catalogue, with every leaf widened to string (arrays kept). */
export type Widen<T> = T extends string
  ? string
  : T extends readonly (infer U)[]
    ? readonly Widen<U>[]
    : { readonly [K in keyof T]: Widen<T[K]> };

export type Messages = Widen<typeof en>;
