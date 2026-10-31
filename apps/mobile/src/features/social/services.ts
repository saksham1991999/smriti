import type { components } from '@smriti/api-client';
import type { MessageKey } from '@smriti/i18n';

import { unwrap } from '../../services/api';
import type { SmritiApp } from '../../services/app';

type S = components['schemas'];
export type Gate = S['Gate'];
export type Overview = S['Overview'];
export type Person = S['Person'];
export type FriendRow = S['FriendRow'];
export type League = S['League'];
export type Duo = S['DuoOut'];
export type Squad = S['SquadOut'];
export type InboxItem = S['InboxItem'];
export type DuelState = S['DuelState'];
export type QueueState = S['QueueState'];
export type SharedDeck = S['SharedDeckRow'];

const key = (app: SmritiApp) => ({ 'Idempotency-Key': app.newId() });

/**
 * How a person is named (R31, amended). The server picks the kind for the viewer: adults by
 * display name, minors by nickname (pet name only to invite or QR friends), and nobody's real
 * name is shown to a minor's contacts. The app shows exactly what it is given.
 */
export function personName(p: Person, t: (k: MessageKey) => string): string {
  switch (p.name.kind) {
    case 'hidden':
      return t('tutor_social:SOC-08.hidden_row_blocked');
    case 'deleted':
      return t('tutor_social:SOC-07.deleted_account');
    default:
      return p.name.text?.trim() || t('tutor_social:SOC-08.hidden_row_blocked');
  }
}

export const species = (p: Person): 'cat' | 'dog' => (p.avatar?.species === 'dog' ? 'dog' : 'cat');

export const loadGate = (app: SmritiApp) => unwrap(app.api.GET('/v1/social/gate'));
export const loadOverview = (app: SmritiApp) => unwrap(app.api.GET('/v1/social/overview'));
export const loadFriends = (app: SmritiApp) => unwrap(app.api.GET('/v1/friends'));
export const loadInvite = (app: SmritiApp) => unwrap(app.api.GET('/v1/friends/invite'));

export async function acceptInvite(app: SmritiApp, code: string, via: 'link' | 'qr' = 'link'): Promise<FriendRow | 'invalid' | 'self' | 'already_friends'> {
  const peek = await unwrap(app.api.GET('/v1/friends/invite/{code}', { params: { path: { code } } })).catch(() => null);
  if (!peek || peek.state === 'invalid') return 'invalid';
  if (peek.state !== 'ok') return peek.state;
  return unwrap(app.api.POST('/v1/friends/invite/{code}/accept', { params: { path: { code } }, body: { via }, headers: key(app) }));
}

export async function searchHandle(app: SmritiApp, handle: string): Promise<Person | null> {
  const res = await app.api.GET('/v1/friends/search', { params: { query: { handle } } });
  return res.data ?? null;
}

export const requestFriend = (app: SmritiApp, userId: string, source: 'search' | 'league_row' | 'duel' | 'squad') =>
  unwrap(app.api.POST('/v1/friends/requests', { body: { user_id: userId, source }, headers: key(app) }));

export const loadInbox = (app: SmritiApp) => unwrap(app.api.GET('/v1/social/inbox'));
export const react = (app: SmritiApp, itemId: string, reaction: 'clap' | 'star' | 'strong' | 'smile') =>
  unwrap(app.api.POST('/v1/social/reactions', { body: { item_id: itemId, reaction }, headers: key(app) }));

/** SOC-22: preset cheers and nudges only, never free text (AGENTS rule 6, R31). */
export const CHEER_PRESETS = ['message_1', 'message_2', 'message_3', 'message_4', 'message_5', 'message_6'] as const;
export const NUDGE_PRESETS = ['nudge_1', 'nudge_2', 'nudge_3'] as const;

export async function sendCheer(app: SmritiApp, to: string, kind: 'cheer' | 'nudge', preset: string): Promise<'sent' | 'limit'> {
  const res = await app.api.POST('/v1/social/nudges', { body: { to_user_id: to, kind, preset_id: preset }, headers: key(app) });
  return res.error ? 'limit' : 'sent';
}

export const loadLeague = (app: SmritiApp) => unwrap(app.api.GET('/v1/leagues/current'));
export const joinLeague = (app: SmritiApp) => unwrap(app.api.POST('/v1/leagues/join', { headers: key(app) }));

export const loadDuos = (app: SmritiApp) => unwrap(app.api.GET('/v1/duos'));
export const inviteDuos = (app: SmritiApp, friendIds: string[]) => unwrap(app.api.POST('/v1/duos', { body: { friend_ids: friendIds }, headers: key(app) }));
export const acceptDuo = (app: SmritiApp, id: string) => unwrap(app.api.POST('/v1/duos/{duo_id}/accept', { params: { path: { duo_id: id } }, headers: key(app) }));
export const nudgeDuo = (app: SmritiApp, id: string, preset: string) => unwrap(app.api.POST('/v1/duos/{duo_id}/nudge', { params: { path: { duo_id: id } }, body: { preset_id: preset }, headers: key(app) }));

export const loadSquads = (app: SmritiApp) => unwrap(app.api.GET('/v1/squads'));
export const loadSquad = (app: SmritiApp, id: string) => unwrap(app.api.GET('/v1/squads/{squad_id}', { params: { path: { squad_id: id } } }));
export const createSquad = (app: SmritiApp, examOnly = true) => unwrap(app.api.POST('/v1/squads', { body: { squad_id: app.newId(), exam: examOnly ? app.examProfileId() : null }, headers: key(app) }));
export const previewSquad = (app: SmritiApp, code: string) => unwrap(app.api.GET('/v1/squads/join/{code}', { params: { path: { code } } }));
export const joinSquad = (app: SmritiApp, code: string) => unwrap(app.api.POST('/v1/squads/join/{code}', { params: { path: { code } }, body: { via: 'code' }, headers: key(app) }));
export const cheerSquad = (app: SmritiApp, id: string) => unwrap(app.api.POST('/v1/squads/{squad_id}/cheer', { params: { path: { squad_id: id } }, body: { preset_id: 'squad_message' }, headers: key(app) }));

export const startDuel = (app: SmritiApp, opts: { opponentId?: string; solo?: boolean }) =>
  unwrap(app.api.POST('/v1/duels', { body: { solo: opts.solo === true, opponent_id: opts.opponentId ?? null, exam_profile_id: app.examProfileId() }, headers: key(app) }));
export const findRandom = (app: SmritiApp) => unwrap(app.api.POST('/v1/duels/random', { body: { exam_profile_id: app.examProfileId() }, headers: key(app) }));
export const randomState = (app: SmritiApp) => unwrap(app.api.GET('/v1/duels/random'));
export const leaveRandom = (app: SmritiApp) => app.api.DELETE('/v1/duels/random', { headers: key(app) });
export const loadDuel = (app: SmritiApp, id: string) => unwrap(app.api.GET('/v1/duels/{duel_id}', { params: { path: { duel_id: id } } }));
export const answerDuel = (app: SmritiApp, id: string, questionId: string, optionIds: string[], clientMs: number) =>
  unwrap(app.api.POST('/v1/duels/{duel_id}/answers', { params: { path: { duel_id: id } }, body: { question_id: questionId, option_ids: optionIds, client_ms: clientMs }, headers: key(app) }));
export const leaveDuel = (app: SmritiApp, id: string) => app.api.POST('/v1/duels/{duel_id}/leave', { params: { path: { duel_id: id } }, headers: key(app) });

export const loadSharedDecks = (app: SmritiApp, scope: 'friends' | 'exam') => unwrap(app.api.GET('/v1/shared-decks', { params: { query: { scope, exam: app.examProfileId() } } }));
export const copyDeck = (app: SmritiApp, code: string) => unwrap(app.api.POST('/v1/shared-decks/{code}/copy', { params: { path: { code } }, headers: key(app) }));
export const markHelpful = (app: SmritiApp, code: string) => unwrap(app.api.PUT('/v1/shared-decks/{code}/helpful', { params: { path: { code } }, body: { on: true }, headers: key(app) }));

export const acceptRequest = (app: SmritiApp, userId: string) => unwrap(app.api.POST('/v1/friends/requests/{user_id}/accept', { params: { path: { user_id: userId } }, headers: key(app) }));
export const declineRequest = (app: SmritiApp, userId: string) => app.api.POST('/v1/friends/requests/{user_id}/decline', { params: { path: { user_id: userId } }, headers: key(app) });
export const markInboxSeen = (app: SmritiApp) => app.api.POST('/v1/social/inbox/seen', { headers: key(app) });
export const acceptDuel = (app: SmritiApp, id: string) => unwrap(app.api.POST('/v1/duels/{duel_id}/accept', { params: { path: { duel_id: id } }, headers: key(app) }));
export const declineDuel = (app: SmritiApp, id: string) => app.api.POST('/v1/duels/{duel_id}/decline', { params: { path: { duel_id: id } }, headers: key(app) });

/** The full invite link from the API's path (`/f/{code}`), on the variant's link domain. */
export function inviteLink(app: SmritiApp, path: string): string {
  const origin = new URL(app.deps.variant.deepLinkPrefix).origin;
  return `${origin}${path.startsWith('/') ? path : `/${path}`}`;
}
