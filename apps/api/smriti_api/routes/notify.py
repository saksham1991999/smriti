"""Push registration and notification settings (TRD §5.1 "Notifications", §12)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Response

from smriti_api.core.deps import Client, CurrentUser, Services
from smriti_api.schemas import notify as n
from smriti_api.services import notify_settings

router = APIRouter(prefix="/v1", tags=["notifications"])


@router.post(
    "/devices",
    response_model=n.DeviceOut,
    summary="Register this device (X-Device-Id) with its Expo token or Web Push subscription",
)
async def register_device(
    body: n.DeviceRegister, services: Services, auth: CurrentUser, client: Client
) -> n.DeviceOut:
    return await notify_settings.register_device(services.db, auth, client.device_id, body)


@router.delete(
    "/devices/{device_id}",
    status_code=204,
    summary="Stop pushes to a device (sign-out on it)",
)
async def forget_device(device_id: uuid.UUID, services: Services, auth: CurrentUser) -> Response:
    await notify_settings.forget_device(services.db, auth, device_id)
    return Response(status_code=204)


@router.get(
    "/notifications/web-push-key",
    response_model=n.WebPushKey,
    summary="The VAPID application server key for pushManager.subscribe (null when off)",
)
async def web_push_key(services: Services) -> n.WebPushKey:
    ints = services.integrations
    return n.WebPushKey(public_key=ints.web_push_public_key if ints else None)


@router.get(
    "/notification-prefs",
    response_model=n.NotificationPrefs,
    summary="Reminder, quiet hours and per-kind switches (SET-03 to SET-05)",
)
async def get_prefs(services: Services, auth: CurrentUser) -> n.NotificationPrefs:
    return await notify_settings.get_prefs(services.db, auth)


@router.patch(
    "/notification-prefs",
    response_model=n.NotificationPrefs,
    summary="Change notification settings; adult-only switches are refused for minors",
)
async def patch_prefs(
    body: n.NotificationPrefsPatch, services: Services, auth: CurrentUser
) -> n.NotificationPrefs:
    return await notify_settings.patch_prefs(services.db, auth, body)


@router.post(
    "/notifications/opened",
    status_code=204,
    summary="An app open or a tapped push: resets the ignored count and auto-pause (R34)",
)
async def opened(body: n.NotificationOpened, services: Services, auth: CurrentUser) -> Response:
    await notify_settings.opened(services.db, auth, body.id)
    return Response(status_code=204)
