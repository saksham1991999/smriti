/**
 * Billing (docs/flows/me-money.md PAY), guardian consent (auth §6.9–6.10), devices and
 * notification preferences. Money and consent mutations send an `Idempotency-Key`.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { newIdempotencyKey, unwrap, type Schemas } from "./client";
import { invalidate, queryKeys, useApiClient } from "./react-core";
import type { paths } from "./schema";

/** A consent scope the guardian can withdraw. */
export type ConsentScope =
  paths["/v1/guardian/consents/{consent_id}/scopes/{scope}"]["delete"]["parameters"]["path"]["scope"];

const idem = () => ({ "Idempotency-Key": newIdempotencyKey() });

// ── Billing ───────────────────────────────────────────────────────────────────

export function useEntitlement() {
  const api = useApiClient();
  return useQuery({
    queryKey: queryKeys.entitlement(),
    queryFn: () => unwrap(api.GET("/v1/billing/entitlement"), api),
  });
}

/** Whether the ₹1 month is offered, with the server's prices (R38). Never assume it. */
export function useIntroEligibility(enabled = true) {
  const api = useApiClient();
  return useQuery({
    queryKey: queryKeys.introEligibility(),
    queryFn: () => unwrap(api.GET("/v1/billing/intro-eligibility"), api),
    enabled,
  });
}

export function useSubscription() {
  const api = useApiClient();
  return useQuery({
    queryKey: queryKeys.subscription(),
    queryFn: () => unwrap(api.GET("/v1/billing/subscription"), api),
  });
}

const billingKeys = () => [
  queryKeys.entitlement(),
  queryKeys.introEligibility(),
  queryKeys.subscription(),
  queryKeys.practiceLimits(),
  queryKeys.me(),
  queryKeys.syncState(),
];

/** Web: creates the Razorpay subscription for checkout (PAY-06). */
export function useCreateRazorpaySubscription() {
  const api = useApiClient();
  return useMutation({
    mutationFn: (body: Schemas["RazorpaySubscriptionRequest"]) =>
      unwrap(
        api.POST("/v1/billing/razorpay/subscription", { body, params: { header: idem() } }),
        api,
      ),
  });
}

/** Web: verifies the checkout signature; the entitlement turns Pro on success (PAY-08). */
export function useVerifyRazorpay() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Schemas["RazorpayVerifyRequest"]) =>
      unwrap(api.POST("/v1/billing/razorpay/verify", { body, params: { header: idem() } }), api),
    onSuccess: (entitlement) => {
      qc.setQueryData(queryKeys.entitlement(), entitlement);
      return invalidate(qc, ...billingKeys());
    },
  });
}

export function useCancelRazorpay() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Schemas["RazorpayCancelRequest"] = {}) =>
      unwrap(api.POST("/v1/billing/razorpay/cancel", { body, params: { header: idem() } }), api),
    onSuccess: (entitlement) => {
      qc.setQueryData(queryKeys.entitlement(), entitlement);
      return invalidate(qc, ...billingKeys());
    },
  });
}

/** Restore purchases (PAY-14): re-reads the store and Razorpay state for this account. */
export function useRestorePurchases() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(api.POST("/v1/billing/restore", { params: { header: idem() } }), api),
    onSuccess: () => invalidate(qc, ...billingKeys()),
  });
}

// ── Guardian consent ──────────────────────────────────────────────────────────

/** The signed-in learner's consents and scopes. */
export function useMyConsent() {
  const api = useApiClient();
  return useQuery({
    queryKey: queryKeys.myConsent(),
    queryFn: () => unwrap(api.GET("/v1/guardian/consent"), api),
  });
}

/**
 * A consent request by id (the teen's wait screen polls it) or by code (the guardian's page).
 * Pass `pollMs` to poll until it is decided.
 */
export function useConsentRequest(ref: string | undefined, pollMs?: number) {
  const api = useApiClient();
  return useQuery({
    queryKey: queryKeys.consentRequest(ref ?? ""),
    queryFn: () =>
      unwrap(
        api.GET("/v1/guardian/consent-requests/{ref}", { params: { path: { ref: ref ?? "" } } }),
        api,
      ),
    enabled: Boolean(ref),
    refetchInterval: (query) => {
      if (!pollMs) return false;
      const status = (query.state.data as { status?: string } | undefined)?.status;
      return status === undefined || status === "pending" ? pollMs : false;
    },
  });
}

export function useCreateConsentRequest() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Schemas["ConsentRequestCreate"]) =>
      unwrap(api.POST("/v1/guardian/consent-requests", { body, params: { header: idem() } }), api),
    onSuccess: () => invalidate(qc, queryKeys.myConsent()),
  });
}

/** The guardian agrees (with the scopes and the declaration). */
export function useConfirmConsent(code: string) {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Schemas["ConsentConfirm"]) =>
      unwrap(
        api.POST("/v1/guardian/consent-requests/{code}/confirm", {
          body,
          params: { path: { code }, header: idem() },
        }),
        api,
      ),
    onSuccess: () => invalidate(qc, queryKeys.consentRequest(code), queryKeys.learners()),
  });
}

export function useDeclineConsent(code: string) {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      unwrap(
        api.POST("/v1/guardian/consent-requests/{code}/decline", {
          params: { path: { code }, header: idem() },
        }),
        api,
      ),
    onSuccess: () => invalidate(qc, queryKeys.consentRequest(code)),
  });
}

/** Withdraws one scope (`social`, `community`, `voice`, `uploads`); `account` can't be withdrawn alone. */
export function useWithdrawConsentScope() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { consentId: string; scope: ConsentScope }) =>
      unwrap(
        api.DELETE("/v1/guardian/consents/{consent_id}/scopes/{scope}", {
          params: { path: { consent_id: input.consentId, scope: input.scope }, header: idem() },
        }),
        api,
      ),
    onSuccess: () => invalidate(qc, queryKeys.myConsent(), queryKeys.learners(), queryKeys.me()),
  });
}

/** A guardian's linked learners (SET-16). */
export function useLearners() {
  const api = useApiClient();
  return useQuery({
    queryKey: queryKeys.learners(),
    queryFn: () => unwrap(api.GET("/v1/guardian/learners"), api),
  });
}

// ── Devices and notifications ─────────────────────────────────────────────────

/** Registers this install's push token and permission state (call on open and on change). */
export function useRegisterDevice() {
  const api = useApiClient();
  return useMutation({
    mutationFn: (body: Schemas["DeviceRegister"]) => unwrap(api.POST("/v1/devices", { body }), api),
  });
}

/** Sign-out: stop pushes to this device. */
export function useUnregisterDevice() {
  const api = useApiClient();
  return useMutation({
    mutationFn: (deviceId: string) =>
      unwrap(
        api.DELETE("/v1/devices/{device_id}", { params: { path: { device_id: deviceId } } }),
        api,
      ),
  });
}

export function useNotificationPrefs() {
  const api = useApiClient();
  return useQuery({
    queryKey: queryKeys.notificationPrefs(),
    queryFn: () => unwrap(api.GET("/v1/notification-prefs"), api),
  });
}

export function usePatchNotificationPrefs() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Schemas["NotificationPrefsPatch"]) =>
      unwrap(api.PATCH("/v1/notification-prefs", { body }), api),
    onSuccess: (prefs) => qc.setQueryData(queryKeys.notificationPrefs(), prefs),
  });
}

/** The VAPID public key for Web Push. */
export function useWebPushKey(enabled = true) {
  const api = useApiClient();
  return useQuery({
    queryKey: queryKeys.webPushKey(),
    queryFn: () => unwrap(api.GET("/v1/notifications/web-push-key"), api),
    enabled,
    staleTime: Infinity,
  });
}

/** Reports a notification open (`notification_opened`, template id only). */
export function useNotificationOpened() {
  const api = useApiClient();
  return useMutation({
    mutationFn: (body: Schemas["NotificationOpened"]) =>
      unwrap(api.POST("/v1/notifications/opened", { body }), api),
  });
}
