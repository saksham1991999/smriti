"""Memory palaces (memory-labs §5.6, MEM-12 to MEM-18). Each change is the same ``palace_saved``
or ``palace_deleted`` event a device writes to its outbox (sync contract v1.5), applied through
the sync batch, so the online and offline paths give the same palace. Building a palace is Pro."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Path
from fastapi.responses import JSONResponse

from smriti_api.core.deps import Client, CurrentUser, IdempotencyKey, Services
from smriti_api.routes._idempotent import idempotent
from smriti_api.schemas import palaces as ps
from smriti_api.services import palaces

router = APIRouter(prefix="/v1/palaces", tags=["palaces"])

PalaceId = Annotated[uuid.UUID, Path()]
ItemId = Annotated[uuid.UUID, Path()]


@router.get("", response_model=ps.PalaceList, summary="My palaces (MEM-12)")
async def list_palaces(services: Services, auth: CurrentUser) -> ps.PalaceList:
    return await palaces.list_palaces(services.db, auth)


@router.get("/{palace_id}", response_model=ps.PalaceOut, summary="One palace")
async def get_palace(palace_id: PalaceId, services: Services, auth: CurrentUser) -> ps.PalaceOut:
    return await palaces.get_palace(services.db, auth, palace_id)


@router.post(
    "",
    response_model=ps.PalaceOut,
    status_code=201,
    summary="Build a palace from a template (MEM-13, Pro)",
)
async def create_palace(
    body: ps.PalaceCreate,
    services: Services,
    auth: CurrentUser,
    client: Client,
    key: IdempotencyKey,
) -> JSONResponse:
    return await idempotent(
        services,
        scope="palace_create",
        subject=auth.user_id,
        key=key,
        body=body,
        fn=lambda: palaces.create(services.db, auth, client, body, key),
        status=201,
    )


@router.patch(
    "/{palace_id}", response_model=ps.PalaceOut, summary="Rename, or change the rooms and walk"
)
async def update_palace(
    palace_id: PalaceId,
    body: ps.PalaceUpdate,
    services: Services,
    auth: CurrentUser,
    client: Client,
    key: IdempotencyKey,
) -> JSONResponse:
    return await idempotent(
        services,
        scope=f"palace_update:{palace_id}",
        subject=auth.user_id,
        key=key,
        body=body,
        fn=lambda: palaces.mutate(
            services.db,
            auth,
            client,
            palace_id,
            scope="update",
            key=key,
            op=lambda d: palaces.update(d, body, uuid.uuid4),
        ),
    )


@router.delete("/{palace_id}", response_model=ps.PalaceDeletedOut, summary="Delete a palace")
async def delete_palace(
    palace_id: PalaceId, services: Services, auth: CurrentUser, client: Client, key: IdempotencyKey
) -> JSONResponse:
    return await idempotent(
        services,
        scope=f"palace_delete:{palace_id}",
        subject=auth.user_id,
        key=key,
        body=None,
        fn=lambda: palaces.delete(services.db, auth, client, palace_id, key),
    )


@router.post(
    "/{palace_id}/items",
    response_model=ps.PalaceOut,
    summary="Add items to memorise, to the tray or along the walk (MEM-15)",
)
async def add_items(
    palace_id: PalaceId,
    body: ps.ItemsAdd,
    services: Services,
    auth: CurrentUser,
    client: Client,
    key: IdempotencyKey,
) -> JSONResponse:
    return await idempotent(
        services,
        scope=f"palace_items:{palace_id}",
        subject=auth.user_id,
        key=key,
        body=body,
        fn=lambda: palaces.mutate(
            services.db,
            auth,
            client,
            palace_id,
            scope="items",
            key=key,
            op=lambda d: palaces.add_items(d, body.items, body.auto_place, uuid.uuid4),
        ),
    )


@router.put(
    "/{palace_id}/items/{item_id}/place",
    response_model=ps.PalaceOut,
    summary="Put an item on a spot (an item already there swaps places) (MEM-14)",
)
async def place_item(
    palace_id: PalaceId,
    item_id: ItemId,
    body: ps.PlaceIn,
    services: Services,
    auth: CurrentUser,
    client: Client,
    key: IdempotencyKey,
) -> JSONResponse:
    return await idempotent(
        services,
        scope=f"palace_place:{palace_id}:{item_id}",
        subject=auth.user_id,
        key=key,
        body=body,
        fn=lambda: palaces.mutate(
            services.db,
            auth,
            client,
            palace_id,
            scope=f"place:{item_id}",
            key=key,
            op=lambda d: palaces.place(d, item_id, body.room_id, body.spot),
        ),
    )


@router.delete(
    "/{palace_id}/items/{item_id}/place",
    response_model=ps.PalaceOut,
    summary="Take an item off its spot, back to the tray",
)
async def unplace_item(
    palace_id: PalaceId,
    item_id: ItemId,
    services: Services,
    auth: CurrentUser,
    client: Client,
    key: IdempotencyKey,
) -> JSONResponse:
    return await idempotent(
        services,
        scope=f"palace_unplace:{palace_id}:{item_id}",
        subject=auth.user_id,
        key=key,
        body=None,
        fn=lambda: palaces.mutate(
            services.db,
            auth,
            client,
            palace_id,
            scope=f"unplace:{item_id}",
            key=key,
            op=lambda d: palaces.unplace(d, item_id),
        ),
    )


@router.patch(
    "/{palace_id}/items/{item_id}",
    response_model=ps.PalaceOut,
    summary="Change an item's label or link note (MEM-16)",
)
async def patch_item(
    palace_id: PalaceId,
    item_id: ItemId,
    body: ps.ItemPatch,
    services: Services,
    auth: CurrentUser,
    client: Client,
    key: IdempotencyKey,
) -> JSONResponse:
    return await idempotent(
        services,
        scope=f"palace_item:{palace_id}:{item_id}",
        subject=auth.user_id,
        key=key,
        body=body.model_dump(mode="json", exclude_unset=True),
        fn=lambda: palaces.mutate(
            services.db,
            auth,
            client,
            palace_id,
            scope=f"item:{item_id}",
            key=key,
            op=lambda d: palaces.patch_item(d, item_id, body),
        ),
    )


@router.delete(
    "/{palace_id}/items/{item_id}",
    response_model=ps.PalaceOut,
    summary="Remove an item (its review card goes too)",
)
async def remove_item(
    palace_id: PalaceId,
    item_id: ItemId,
    services: Services,
    auth: CurrentUser,
    client: Client,
    key: IdempotencyKey,
) -> JSONResponse:
    return await idempotent(
        services,
        scope=f"palace_remove:{palace_id}:{item_id}",
        subject=auth.user_id,
        key=key,
        body=None,
        fn=lambda: palaces.mutate(
            services.db,
            auth,
            client,
            palace_id,
            scope=f"remove:{item_id}",
            key=key,
            op=lambda d: palaces.remove_item(d, item_id),
        ),
    )
