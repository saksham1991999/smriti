/**
 * AUTH-27 on the teen's side: a guardian asked (SET-18 "Link a teen") to link this account. The
 * teen confirms ([Yes, link] opens the consent request the guardian answers in AUTH-20) or says it
 * isn't their parent (nothing is linked). Requests come from `GET /v1/me/link-requests`.
 */
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { newIdempotencyKey, unwrap } from "@smriti/api-client";
import { useAppStore } from "@smriti/app-core/react";
import { Banner, Button, Illustration, Text, TopBar } from "@smriti/ui-web";
import { useServices } from "../../boot/context";
import { CONSENT_NOTICE_VERSION } from "../../lib/guardian";
import { useI18n } from "../../lib/i18n";
import { useOnline } from "../../lib/network";
import { toast } from "../../lib/toast";
import { LoadError, RouteLoading } from "../../shell/States";

export function useLinkRequests(enabled = true) {
  const s = useServices();
  const userId = useAppStore((x) => x.session.userId);
  return useQuery({
    queryKey: ["guardian", "link-requests", userId],
    enabled: enabled && !!userId && !s.fakeApi,
    retry: false,
    staleTime: 15_000,
    queryFn: () => unwrap(s.client.GET("/v1/me/link-requests"), s.client),
  });
}

export function LinkRequest() {
  const s = useServices();
  const { t } = useI18n();
  const navigate = useNavigate();
  const online = useOnline();
  const queryClient = useQueryClient();
  const q = useLinkRequests();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const back = () => void navigate({ to: "/me/settings" });

  if (q.isPending && q.fetchStatus !== "idle") return <RouteLoading />;
  if (q.isError) return <LoadError onRetry={() => void q.refetch()} />;
  const req = (q.data ?? []).find((r) => r.status === "pending" && Date.parse(r.expires_at) > Date.now()) ?? null;

  const decide = async (accept: boolean) => {
    if (!req || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const params = { path: { request_id: req.id }, header: { "Idempotency-Key": newIdempotencyKey() } };
      if (accept) {
        await unwrap(s.client.POST("/v1/me/link-requests/{request_id}/accept", { params, body: { notice_version: CONSENT_NOTICE_VERSION, platform: "web" } }), s.client);
        s.analytics.track("guardian_consent_requested", { channel: "link", gate: "features", scopes: req.scopes });
      } else {
        await unwrap(s.client.POST("/v1/me/link-requests/{request_id}/decline", { params }), s.client);
        s.analytics.track("guardian_consent_decided", { channel: "link", decision: "declined" });
        toast.show(t("auth:AUTH-27.no_result"));
      }
      await queryClient.invalidateQueries({ queryKey: ["guardian"] });
      back();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col bg-bg" data-testid="auth-27">
      <TopBar onBack={back} />
      <main id="main" className="mx-auto flex w-full max-w-[560px] flex-col gap-4 px-4 pb-8">
        <Illustration name="scene-grown-up-first" decorative fit="cover" className="aspect-[3/2] w-full rounded-card-large" />
        {req ? (
          <>
            <Text variant="title" heading as="h1">
              {t("auth:AUTH-27.title", { parent_first_name: req.parent_first_name ?? "" })}
            </Text>
            <Text>{t("auth:AUTH-27.body")}</Text>
            {!online && <Banner tone="offline" icon="WifiSlash" text={t("auth:AUTH-27.offline")} />}
            {failed && <Banner tone="warning" icon="WarningCircle" text={t("auth:AUTH-27.failed")} testID="auth-27-failed" />}
            <Button label={t("auth:AUTH-27.yes")} onPress={() => void decide(true)} disabled={busy || !online} testID="link-yes" />
            <Button variant="ghost" label={t("auth:AUTH-27.no")} onPress={() => void decide(false)} disabled={busy || !online} testID="link-no" />
          </>
        ) : (
          <Text tone="muted" testID="auth-27-none">
            {t("auth:AUTH-27.no_result")}
          </Text>
        )}
      </main>
    </div>
  );
}
