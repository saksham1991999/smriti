import { create } from "zustand";
import type { IconName } from "@smriti/ui-web";

export interface ToastMessage {
  id: number;
  message: string;
  tone?: "default" | "error";
  icon?: IconName;
}

interface ToastStore {
  current: ToastMessage | null;
  show(message: string, opts?: Omit<ToastMessage, "id" | "message">): void;
  dismiss(): void;
}

let seq = 0;

/** One toast at a time, shown by the root layout (screens call `toast.show`). */
export const useToast = create<ToastStore>((set) => ({
  current: null,
  show(message, opts) {
    set({ current: { id: ++seq, message, ...opts } });
  },
  dismiss() {
    set({ current: null });
  },
}));

export const toast = {
  show: (message: string, opts?: Omit<ToastMessage, "id" | "message">) => useToast.getState().show(message, opts),
};
