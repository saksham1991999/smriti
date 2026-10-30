import { useCallback } from "react";
import { useRouter } from "@tanstack/react-router";

/** Close or back: the previous page when there is one in this tab, else `fallback` (a path). */
export function useClose(fallback: string) {
  const router = useRouter();
  return useCallback(() => {
    if (router.history.canGoBack()) router.history.back();
    else router.history.push(fallback);
  }, [router, fallback]);
}
