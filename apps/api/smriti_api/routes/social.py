"""Social (docs/flows/tutor-social.md Part B): the gate, friends, the inbox, cheers and nudges,
reactions, report and block, Duos and squads. Every route runs the social gate (B4): guests get
``login_required``, little learners ``social_not_available``, minors without the guardian's
``social`` scope ``guardian_consent_required``. There is no free text between students (B2)."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Path, Query, Response

from smriti_api.core.deps import CurrentUser, Services
from smriti_api.schemas import social as so
from smriti_api.services import shared_decks, social_duos, social_friends, social_squads

router = APIRouter(prefix="/v1", tags=["social"])

UserId = Annotated[uuid.UUID, Path()]
Code = Annotated[str, Path(min_length=4, max_length=40, pattern=r"^[A-Za-z0-9_-]+$")]


@router.get("/social/gate", response_model=so.Gate, summary="Which SOC-02 state applies (B4)")
async def gate(services: Services, auth: CurrentUser) -> so.Gate:
    return await social_friends.gate_view(services.db, auth)


@router.get("/social/overview", response_model=so.Overview, summary="SOC-01 in one call")
async def overview(services: Services, auth: CurrentUser) -> so.Overview:
    return await shared_decks.overview(services.db, auth)


@router.get("/social/me", response_model=so.Me, summary="My social profile (SOC-03, SET-11)")
async def me(services: Services, auth: CurrentUser) -> so.Me:
    return await social_friends.me(services.db, auth)


@router.post("/social/me/first-visit", response_model=so.Me, summary="SOC-03 was shown")
async def first_visit(services: Services, auth: CurrentUser) -> so.Me:
    return await social_friends.me(services.db, auth, first_visit_done=True)


@router.get("/social/handles/{handle}", response_model=so.HandleCheck, summary="Is a username free")
async def check_handle(
    handle: Annotated[str, Path(min_length=1, max_length=40)], services: Services, auth: CurrentUser
) -> so.HandleCheck:
    return await social_friends.check_handle(services.db, auth, handle)


@router.put(
    "/social/me/handle", response_model=so.Me, summary="Pick or change the username (adults)"
)
async def set_handle(body: so.HandleIn, services: Services, auth: CurrentUser) -> so.Me:
    return await social_friends.set_handle(services.db, auth, body)


@router.put("/social/me/privacy", response_model=so.Me, summary="Discoverable, presence, boards")
async def set_privacy(body: so.PrivacyIn, services: Services, auth: CurrentUser) -> so.Me:
    return await social_friends.set_privacy(services.db, auth, body)


# --- friends ----------------------------------------------------------------------------------


@router.get("/friends", response_model=list[so.FriendRow], summary="My friends (SOC-04)")
async def friends(services: Services, auth: CurrentUser) -> list[so.FriendRow]:
    return await social_friends.friends(services.db, auth)


@router.get("/friends/search", response_model=so.Person, summary="Find an adult by exact username")
async def search(
    services: Services,
    auth: CurrentUser,
    handle: Annotated[str, Query(min_length=3, max_length=20)],
) -> so.Person:
    return await social_friends.by_handle(services.db, auth, handle)


@router.get("/friends/invite", response_model=so.Invite, summary="My invite link and QR code")
async def invite(services: Services, auth: CurrentUser) -> so.Invite:
    return await social_friends.invite(services.db, auth)


@router.get(
    "/friends/invite/{code}", response_model=so.InvitePreview, summary="Who an invite link is from"
)
async def invite_preview(code: Code, services: Services, auth: CurrentUser) -> so.InvitePreview:
    return await social_friends.invite_preview(services.db, auth, code)


@router.post(
    "/friends/invite/{code}/accept",
    response_model=so.FriendRow,
    summary="Add a friend from an invite link or QR code",
)
async def accept_invite(
    code: Code, body: so.InviteAccept, services: Services, auth: CurrentUser
) -> so.FriendRow:
    return await social_friends.accept_invite(services.db, auth, code, body)


@router.post("/friends/requests", response_model=so.RequestOut, summary="Send a friend request")
async def request(body: so.FriendRequestIn, services: Services, auth: CurrentUser) -> so.RequestOut:
    return await social_friends.request(services.db, auth, body)


@router.post(
    "/friends/requests/{user_id}/accept", response_model=so.RequestOut, summary="Accept a request"
)
async def accept_request(user_id: UserId, services: Services, auth: CurrentUser) -> so.RequestOut:
    out = await social_friends.answer_request(services.db, auth, user_id, True)
    assert out is not None
    return out


@router.post("/friends/requests/{user_id}/decline", status_code=204, summary="Decline a request")
async def decline_request(user_id: UserId, services: Services, auth: CurrentUser) -> Response:
    await social_friends.answer_request(services.db, auth, user_id, False)
    return Response(status_code=204)


@router.delete("/friends/{user_id}", status_code=204, summary="Remove a friend (silent)")
async def remove_friend(user_id: UserId, services: Services, auth: CurrentUser) -> Response:
    await social_friends.remove_friend(services.db, auth, user_id)
    return Response(status_code=204)


@router.get("/social/people/{user_id}", response_model=so.MiniProfile, summary="Mini profile")
async def profile(user_id: UserId, services: Services, auth: CurrentUser) -> so.MiniProfile:
    return await social_friends.profile(services.db, auth, user_id)


@router.get("/social/inbox", response_model=so.Inbox, summary="Requests, invites, cheers (SOC-06)")
async def inbox(services: Services, auth: CurrentUser) -> so.Inbox:
    return await social_friends.inbox(services.db, auth)


@router.post("/social/inbox/seen", status_code=204, summary="Mark the inbox read")
async def inbox_seen(services: Services, auth: CurrentUser) -> Response:
    await social_friends.inbox_seen(services.db, auth)
    return Response(status_code=204)


@router.post("/social/nudges", response_model=so.Sent, summary="Send a preset cheer or nudge")
async def nudge(body: so.NudgeIn, services: Services, auth: CurrentUser) -> so.Sent:
    return await social_friends.nudge(services.db, auth, body)


@router.get("/social/feed", response_model=list[so.FeedItem], summary="Friend activity (SOC-01)")
async def feed(services: Services, auth: CurrentUser) -> list[so.FeedItem]:
    return await social_friends.feed(services.db, auth)


@router.post("/social/reactions", status_code=204, summary="React to a friend's activity")
async def react(body: so.ReactionIn, services: Services, auth: CurrentUser) -> Response:
    await social_friends.react(services.db, auth, body)
    return Response(status_code=204)


@router.delete("/social/reactions/{item_id}", status_code=204, summary="Take a reaction back")
async def unreact(
    item_id: Annotated[uuid.UUID, Path()], services: Services, auth: CurrentUser
) -> Response:
    await social_friends.unreact(services.db, auth, item_id)
    return Response(status_code=204)


@router.post(
    "/social/reports", response_model=so.ReportOut, status_code=201, summary="Report (SOC-23)"
)
async def report(body: so.ReportIn, services: Services, auth: CurrentUser) -> so.ReportOut:
    return await social_friends.report(services.db, auth, body)


@router.get("/social/blocks", response_model=list[so.Person], summary="People I blocked (SET-11)")
async def blocks(services: Services, auth: CurrentUser) -> list[so.Person]:
    return await social_friends.blocks(services.db, auth)


@router.post("/social/blocks", status_code=204, summary="Block someone (they aren't told)")
async def block(body: so.BlockIn, services: Services, auth: CurrentUser) -> Response:
    await social_friends.block(services.db, auth, body.user_id)
    return Response(status_code=204)


@router.delete("/social/blocks/{user_id}", status_code=204, summary="Unblock")
async def unblock(user_id: UserId, services: Services, auth: CurrentUser) -> Response:
    await social_friends.unblock(services.db, auth, user_id)
    return Response(status_code=204)


# --- Duos -------------------------------------------------------------------------------------

DuoId = Annotated[uuid.UUID, Path()]


@router.get("/duos", response_model=list[so.DuoOut], summary="My Duos (SOC-11)")
async def duos(services: Services, auth: CurrentUser) -> list[so.DuoOut]:
    return await social_duos.list_duos(services.db, auth)


@router.post("/duos", response_model=so.DuoInviteResult, summary="Invite friends to a Duo")
async def duo_invite(
    body: so.DuoInvite, services: Services, auth: CurrentUser
) -> so.DuoInviteResult:
    return await social_duos.invite(services.db, auth, body)


@router.post("/duos/{duo_id}/accept", response_model=so.DuoOut, summary="Accept a Duo")
async def duo_accept(duo_id: DuoId, services: Services, auth: CurrentUser) -> so.DuoOut:
    out = await social_duos.respond(services.db, auth, duo_id, True)
    assert out is not None
    return out


@router.post("/duos/{duo_id}/decline", status_code=204, summary="Decline a Duo")
async def duo_decline(duo_id: DuoId, services: Services, auth: CurrentUser) -> Response:
    await social_duos.respond(services.db, auth, duo_id, False)
    return Response(status_code=204)


@router.delete("/duos/{duo_id}", status_code=204, summary="End a Duo")
async def duo_end(duo_id: DuoId, services: Services, auth: CurrentUser) -> Response:
    await social_duos.end(services.db, auth, duo_id)
    return Response(status_code=204)


@router.post("/duos/{duo_id}/nudge", response_model=so.Sent, summary="Nudge a Duo partner")
async def duo_nudge(
    duo_id: DuoId, body: so.DuoNudgeIn, services: Services, auth: CurrentUser
) -> so.Sent:
    return await social_duos.nudge(services.db, auth, duo_id, body.preset_id)


# --- squads -----------------------------------------------------------------------------------

SquadId = Annotated[uuid.UUID, Path()]


@router.get("/squads", response_model=list[so.SquadOut], summary="My squads (SOC-12)")
async def squads(services: Services, auth: CurrentUser) -> list[so.SquadOut]:
    return await social_squads.list_squads(services.db, auth)


@router.post("/squads", response_model=so.SquadOut, status_code=201, summary="Create a squad")
async def squad_create(body: so.SquadCreate, services: Services, auth: CurrentUser) -> so.SquadOut:
    return await social_squads.create(services.db, auth, body)


@router.get("/squads/join/{code}", response_model=so.SquadPreview, summary="A squad invite")
async def squad_preview(code: Code, services: Services, auth: CurrentUser) -> so.SquadPreview:
    return await social_squads.preview(services.db, auth, code)


@router.post("/squads/join/{code}", response_model=so.SquadOut, summary="Join a squad")
async def squad_join(
    code: Code, body: so.SquadJoin, services: Services, auth: CurrentUser
) -> so.SquadOut:
    return await social_squads.join(services.db, auth, code, body)


@router.get("/squads/{squad_id}", response_model=so.SquadOut, summary="A squad (SOC-13)")
async def squad(squad_id: SquadId, services: Services, auth: CurrentUser) -> so.SquadOut:
    return await social_squads.get(services.db, auth, squad_id)


@router.delete(
    "/squads/{squad_id}/members/{user_id}", status_code=204, summary="Leave, or remove a member"
)
async def squad_remove(
    squad_id: SquadId, user_id: UserId, services: Services, auth: CurrentUser
) -> Response:
    await social_squads.remove_member(services.db, auth, squad_id, user_id)
    return Response(status_code=204)


@router.post("/squads/{squad_id}/code", response_model=so.SquadOut, summary="A new invite code")
async def squad_new_code(squad_id: SquadId, services: Services, auth: CurrentUser) -> so.SquadOut:
    return await social_squads.new_code(services.db, auth, squad_id)


@router.post("/squads/{squad_id}/cheer", response_model=so.Sent, summary="Cheer the squad")
async def squad_cheer(
    squad_id: SquadId, body: so.SquadCheerIn, services: Services, auth: CurrentUser
) -> so.Sent:
    return await social_squads.cheer(services.db, auth, squad_id, body.preset_id)
