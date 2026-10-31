/**
 * FAKE API, dev and test only: the social endpoints (tutor-social B1 to B12) as apps/api answers
 * them, for SOC-01 to SOC-22 on the dev build and in tests. People are real fake users (made by
 * sign-in or `FakeApiServer.addLearner`), their week XP comes from their own synced lessons, and
 * duel questions are the ones a test or demo hands over from the device's content bundles. There
 * are never bots: a random duel with no one else waiting stays "waiting" and then times out.
 */
import { defaultFlags } from '@smriti/config';
import { activityByDay, localDate, type HttpResponse, type WireEvent } from '@smriti/app-core';
import type { components } from '@smriti/api-client';

import type { FeatureContext, FeatureModule, FeatureRequest } from './features';
import { json, raw, type FakeUser } from './server';

type S = components['schemas'];
type Feature = NonNullable<S['Gate']['features']>[number];
const ALL_FEATURES: Feature[] = ['friends', 'search', 'league', 'squad', 'duo', 'random_duel', 'friend_duel', 'cheer', 'share_deck'];
const TZ = 'Asia/Kolkata';
const DAY = 86_400_000;

/** A duel question as the server holds it: the public body plus the key it never sends. */
export interface FakeDuelQuestion {
  id: string;
  body: Record<string, unknown>;
  correct: string[];
}

export interface FakeSharedDeck {
  code: string;
  title: string;
  ownerId: string;
  cards: { front: string; back: string }[];
  topicId: string | null;
  exam: string | null;
  helpful: Set<string>;
}

interface FakeDuelPlayer {
  userId: string;
  role: 'challenger' | 'opponent';
  answers: Map<number, { qid: string; correct: boolean; points: number }>;
  left: boolean;
}

interface FakeDuel {
  id: string;
  mode: 'live' | 'async' | 'solo';
  relation: 'friend' | 'random' | 'solo';
  status: S['DuelState']['status'];
  exam: string;
  players: FakeDuelPlayer[];
  questions: FakeDuelQuestion[];
  seconds: number;
  index: number;
  openedAt: number;
  createdAt: number;
  events: number;
  winner: string | null;
}

interface FakeInbox {
  id: string;
  to: string;
  from: string;
  kind: S['InboxItem']['kind'];
  preset: string | null;
  at: number;
  seen: boolean;
}

const flag = (k: string, fallback: number): number => {
  try {
    const v = (defaultFlags.get as (key: string) => unknown)(k);
    return typeof v === 'number' ? v : fallback;
  } catch {
    return fallback;
  }
};

export class SocialFakes implements FeatureModule {
  /** user → friend → since (ms). */
  readonly friends = new Map<string, Map<string, number>>();
  readonly requests: { from: string; to: string; at: number }[] = [];
  readonly inbox: FakeInbox[] = [];
  readonly duos: { id: string; a: string; b: string; status: 'invited' | 'active' | 'ended'; at: number }[] = [];
  readonly squads: { id: string; name: string; code: string; exam: string | null; members: { userId: string; role: 'owner' | 'admin' | 'member' }[] }[] = [];
  readonly duels = new Map<string, FakeDuel>();
  readonly queue = new Map<string, { at: number; duelId: string | null }>();
  readonly decks: FakeSharedDeck[] = [];
  /** Minors whose guardian said yes to social features (stands in for SET-18 consent). */
  readonly consent = new Set<string>();
  readonly joinedLeague = new Set<string>();
  readonly handles = new Map<string, string>();
  /** Duel questions; a test or demo fills these from the device's bundles. */
  questions: FakeDuelQuestion[] = [];
  /** Cheers per friend per day; null (the owner hasn't set one) means no cap in the fake. */
  cheerLimit: number | null = null;
  private readonly invites = new Map<string, string>();
  private readonly cheers = new Map<string, number>();
  private seq = 0;

  constructor(private readonly ctx: FeatureContext) {}

  // ── Test and demo hooks ──────────────────────────────────────────────────────────

  befriend(a: string, b: string): void {
    const now = this.ctx.clock();
    this.friendsOf(a).set(b, now);
    this.friendsOf(b).set(a, now);
  }

  /** The invite code a user's SOC-04 shows (made on first ask, as the API does). */
  inviteCodeFor(userId: string): string {
    const u = this.ctx.user(userId);
    return u ? this.invite(u).code : '';
  }

  /** `from` sends a preset cheer or nudge to `to`, as the SOC-22 sheet does. */
  cheer(from: string, to: string, kind: 'cheer' | 'nudge', preset: string): void {
    this.inbox.push({ id: this.id('in'), to, from, kind, preset, at: this.ctx.clock(), seen: false });
  }

  /** `userId` answers the current duel question, as their own app would. */
  answerAs(userId: string, duelId: string, optionIds: string[], ms = 3000): boolean | null {
    const d = this.duels.get(duelId);
    if (!d) return null;
    this.advance(d);
    const q = d.questions[d.index];
    const p = d.players.find((x) => x.userId === userId);
    if (!q || !p || d.status !== 'live') return null;
    return this.record(d, p, q, optionIds, ms).correct;
  }

  acceptDuelAs(userId: string, duelId: string): void {
    const d = this.duels.get(duelId);
    if (d && d.status === 'pending' && d.players.some((p) => p.userId === userId && p.role === 'opponent')) this.goLive(d);
  }

  /** The key of the duel's current question (tests answer right or wrong on purpose). */
  currentKey(duelId: string): string[] | null {
    const d = this.duels.get(duelId);
    return d ? (d.questions[d.index]?.correct ?? null) : null;
  }

  // ── Routing ──────────────────────────────────────────────────────────────────────

  route(req: FeatureRequest): HttpResponse | null {
    const { method: m, path: p, user: u, body } = req;
    if (!/^\/v1\/(social|friends|duos|squads|duels|leagues|shared-decks)\b/.test(p)) return null;
    if (m === 'GET' && p === '/v1/social/gate') return json(200, this.gate(u));
    const gate = this.gate(u);
    if (gate.state !== 'ok') return json(403, { code: 'social_unavailable', gate: gate.state });

    if (m === 'GET' && p === '/v1/social/overview') return json(200, this.overview(u));
    if (m === 'GET' && p === '/v1/friends') return json(200, this.friendRows(u));
    if (m === 'GET' && p === '/v1/friends/invite') return json(200, this.invite(u));
    let r: RegExpExecArray | null;
    if ((r = /^\/v1\/friends\/invite\/([^/]+)$/.exec(p)) && m === 'GET') return json(200, this.preview(u, r[1]!));
    if ((r = /^\/v1\/friends\/invite\/([^/]+)\/accept$/.exec(p)) && m === 'POST') {
      const pv = this.preview(u, r[1]!);
      if (pv.state !== 'ok') return json(409, { code: pv.state });
      const inviter = this.invites.get(r[1]!)!;
      this.befriend(u.id, inviter);
      return json(200, this.friendRow(u, inviter));
    }
    if (m === 'GET' && p === '/v1/friends/search') {
      const id = this.handles.get((req.url.searchParams.get('handle') ?? '').toLowerCase().replace(/^@/, ''));
      return id && id !== u.id ? json(200, this.person(u, id)) : json(404, { code: 'not_found' });
    }
    if (m === 'POST' && p === '/v1/friends/requests') {
      const to = String(body.user_id ?? '');
      if (this.friendsOf(u.id).has(to)) return json(200, { user_id: to, status: 'accepted' });
      if (!this.requests.some((q) => q.from === u.id && q.to === to)) this.requests.push({ from: u.id, to, at: this.ctx.clock() });
      return json(200, { user_id: to, status: 'pending' });
    }
    if ((r = /^\/v1\/friends\/requests\/([^/]+)\/(accept|decline)$/.exec(p)) && m === 'POST') {
      const i = this.requests.findIndex((q) => q.from === r![1] && q.to === u.id);
      if (i < 0) return json(404, { code: 'not_found' });
      this.requests.splice(i, 1);
      if (r[2] === 'decline') return raw(204, '', 'text/plain');
      this.befriend(u.id, r[1]!);
      return json(200, { user_id: r[1], status: 'accepted' });
    }
    if ((r = /^\/v1\/friends\/([^/]+)$/.exec(p)) && m === 'DELETE') {
      this.friendsOf(u.id).delete(r[1]!);
      this.friendsOf(r[1]!).delete(u.id);
      return raw(204, '', 'text/plain');
    }

    if (m === 'GET' && p === '/v1/social/inbox') return json(200, this.inboxFor(u));
    if (m === 'POST' && p === '/v1/social/inbox/seen') {
      for (const i of this.inbox) if (i.to === u.id) i.seen = true;
      return raw(204, '', 'text/plain');
    }
    if (m === 'POST' && p === '/v1/social/reactions') return raw(204, '', 'text/plain');
    if (m === 'POST' && p === '/v1/social/nudges') return this.sendCheer(u, String(body.to_user_id ?? ''), body.kind === 'nudge' ? 'nudge' : 'cheer', String(body.preset_id ?? ''));

    if (m === 'GET' && p === '/v1/leagues/current') return json(200, this.league(u));
    if (m === 'POST' && p === '/v1/leagues/join') {
      this.joinedLeague.add(u.id);
      return json(200, this.league(u));
    }

    if (m === 'GET' && p === '/v1/duos') return json(200, this.duosFor(u));
    if (m === 'POST' && p === '/v1/duos') return json(200, this.inviteDuos(u, (body.friend_ids as string[] | undefined) ?? []));
    if ((r = /^\/v1\/duos\/([^/]+)\/(accept|decline|nudge)$/.exec(p)) && m === 'POST') {
      const duo = this.duos.find((d) => d.id === r![1] && (d.a === u.id || d.b === u.id));
      if (!duo) return json(404, { code: 'not_found' });
      if (r[2] === 'nudge') return this.sendCheer(u, duo.a === u.id ? duo.b : duo.a, 'nudge', String(body.preset_id ?? ''));
      if (r[2] === 'decline') {
        duo.status = 'ended';
        return raw(204, '', 'text/plain');
      }
      duo.status = 'active';
      duo.at = this.ctx.clock();
      return json(200, this.duoOut(u, duo));
    }

    if (m === 'GET' && p === '/v1/squads') return json(200, this.squads.filter((s) => s.members.some((x) => x.userId === u.id)).map((s) => this.squadOut(u, s)));
    if (m === 'POST' && p === '/v1/squads') {
      const n = this.squads.length + 1;
      const fallback = defaultFlags.get('social.squad_name_fallback') as { en: string } | null;
      const s = { id: String(body.squad_id ?? this.id('sq')), name: `${fallback?.en ?? 'Squad'} ${n}`, code: `SQ${1000 + n}`, exam: (body.exam as string | null) ?? null, members: [{ userId: u.id, role: 'owner' as const }] };
      this.squads.push(s);
      return json(201, this.squadOut(u, s));
    }
    if ((r = /^\/v1\/squads\/join\/([^/]+)$/.exec(p))) {
      const s = this.squads.find((x) => x.code === r![1]!.toUpperCase());
      if (!s) return json(404, { code: 'not_found' });
      if (m === 'GET') return json(200, { id: s.id, name: s.name, crest_id: null, member_count: s.members.length, max_members: flag('social.squad_max_members', 20), already_member: s.members.some((x) => x.userId === u.id) });
      if (!s.members.some((x) => x.userId === u.id)) s.members.push({ userId: u.id, role: 'member' });
      return json(200, this.squadOut(u, s));
    }
    if ((r = /^\/v1\/squads\/([^/]+)(\/cheer)?$/.exec(p))) {
      const s = this.squads.find((x) => x.id === r![1] && x.members.some((y) => y.userId === u.id));
      if (!s) return json(404, { code: 'not_found' });
      if (m === 'GET' && !r[2]) return json(200, this.squadOut(u, s));
      if (m === 'POST' && r[2]) {
        for (const x of s.members) if (x.userId !== u.id) this.cheer(u.id, x.userId, 'cheer', String(body.preset_id ?? 'squad_message'));
        return json(200, { sent: true, queued_push: false });
      }
    }

    if (p.startsWith('/v1/duels')) return this.duelRoute(req);

    if (m === 'GET' && p === '/v1/shared-decks') {
      const scope = req.url.searchParams.get('scope');
      const exam = req.url.searchParams.get('exam');
      const rows = this.decks.filter((d) => d.ownerId !== u.id && (scope === 'friends' ? this.friendsOf(u.id).has(d.ownerId) : !exam || d.exam === exam));
      return json(200, rows.map((d) => this.deckRow(u, d)));
    }
    if ((r = /^\/v1\/shared-decks\/([^/]+)\/(copy|helpful)$/.exec(p))) {
      const d = this.decks.find((x) => x.code === r![1]);
      if (!d) return json(404, { code: 'not_found' });
      if (r[2] === 'helpful') {
        if (body.on === false) d.helpful.delete(u.id);
        else d.helpful.add(u.id);
        return json(200, this.deckRow(u, d));
      }
      return json(201, { deck_id: this.id('deck'), title: d.title, cards: d.cards.map((c) => ({ id: this.id('card'), ...c })) });
    }
    return null;
  }

  // ── People and the gate (R31, R46) ───────────────────────────────────────────────

  private band(u: FakeUser) {
    return this.ctx.state(u).profile?.age_band ?? null;
  }

  gate(u: FakeUser): S['Gate'] {
    const band = this.band(u);
    const base = { first_visit: false };
    if (u.isAnonymous) return { ...base, state: 'guest', features: [] };
    if (!band) return { ...base, state: 'age_unknown', features: [] };
    if (band === 'u10') return { ...base, state: 'little_learner', features: [] };
    if (band !== '18p' && !this.consent.has(u.id)) return { ...base, state: 'minor_no_consent', features: [] };
    // Under 13s get friends, friend duels and cheers only (R46).
    const features = band === '10_12' ? ALL_FEATURES.filter((f) => f === 'friends' || f === 'friend_duel' || f === 'cheer') : ALL_FEATURES;
    return { ...base, state: 'ok', features };
  }

  /** R31 amended: adults by display name; minors by a nickname, never their real name. */
  person(viewer: FakeUser, id: string): S['Person'] {
    const u = this.ctx.user(id);
    if (!u) return { user_id: null, is_self: false, can_add_friend: false, name: { kind: 'deleted', text: null }, avatar: null };
    const pet = this.ctx.state(u).pet;
    const self = u.id === viewer.id;
    const adult = this.band(u) === '18p';
    const fallback = defaultFlags.get('social.nickname_fallback') as { en: string } | null;
    const name: S['Name'] = adult ? { kind: 'display_name', text: u.displayName } : { kind: 'nickname', text: `${fallback?.en ?? 'Learner'} ${this.nick(u.id)}` };
    return { user_id: u.id, is_self: self, can_add_friend: !self && !this.friendsOf(viewer.id).has(u.id), name, avatar: { species: pet?.species ?? null, outfit_ids: [] } };
  }

  private nick(id: string): number {
    return [...id].reduce((s, c) => (s * 31 + c.charCodeAt(0)) % 90, 7) + 10;
  }

  private friendsOf(id: string): Map<string, number> {
    let m = this.friends.get(id);
    if (!m) this.friends.set(id, (m = new Map()));
    return m;
  }

  private today(u: FakeUser): boolean {
    return this.ctx.state(u).streak?.today_qualified === true || this.lessonsOn(u, localDate(this.ctx.clock(), TZ)) > 0;
  }

  private lessonsOn(u: FakeUser, day: string): number {
    return u.events.filter((e) => e.type === 'lesson_completed' && localDate(e.occurred_at, TZ) === day).length;
  }

  private friendRow(viewer: FakeUser, id: string): S['FriendRow'] {
    const u = this.ctx.user(id);
    const duo = this.duos.find((d) => d.status === 'active' && ((d.a === viewer.id && d.b === id) || (d.b === viewer.id && d.a === id)));
    const since = this.friendsOf(viewer.id).get(id);
    return { person: this.person(viewer, id), since: since ? new Date(since).toISOString() : null, streak: u ? (this.ctx.state(u).streak?.current ?? 0) : 0, studied_today: u ? this.today(u) : false, duo_id: duo?.id ?? null };
  }

  private friendRows(u: FakeUser): S['FriendRow'][] {
    return [...this.friendsOf(u.id).keys()].map((id) => this.friendRow(u, id));
  }

  private invite(u: FakeUser): S['Invite'] {
    let code = [...this.invites.entries()].find(([, id]) => id === u.id)?.[0];
    if (!code) {
      code = `F${(this.invites.size + 1).toString(36).toUpperCase()}${u.id.slice(-4).toUpperCase()}`;
      this.invites.set(code, u.id);
    }
    return { code, path: `/f/${code}` };
  }

  private preview(u: FakeUser, code: string): S['InvitePreview'] {
    const inviter = this.invites.get(code.toUpperCase());
    if (!inviter) return { state: 'invalid', inviter: null };
    if (inviter === u.id) return { state: 'self', inviter: null };
    if (this.friendsOf(u.id).has(inviter)) return { state: 'already_friends', inviter: this.person(u, inviter) };
    return { state: 'ok', inviter: this.person(u, inviter) };
  }

  // ── Inbox, cheers ───────────────────────────────────────────────────────────────

  private inboxFor(u: FakeUser): S['Inbox'] {
    const items: S['InboxItem'][] = [];
    for (const q of this.requests.filter((x) => x.to === u.id)) items.push({ id: q.from, kind: 'friend_request', sender: this.person(u, q.from), unread: true, created_at: new Date(q.at).toISOString(), preset_id: null });
    for (const d of this.duos.filter((x) => x.b === u.id && x.status === 'invited')) items.push({ id: d.id, kind: 'duo_invite', sender: this.person(u, d.a), unread: true, created_at: new Date(d.at).toISOString(), preset_id: null });
    for (const d of this.duels.values()) {
      const me = d.players.find((p) => p.userId === u.id);
      const them = d.players.find((p) => p.userId !== u.id);
      if (d.status === 'pending' && me?.role === 'opponent' && them) items.push({ id: d.id, kind: 'duel_challenge', sender: this.person(u, them.userId), unread: true, created_at: new Date(d.createdAt).toISOString(), preset_id: null });
    }
    for (const i of this.inbox.filter((x) => x.to === u.id)) items.push({ id: i.id, kind: i.kind, sender: this.person(u, i.from), unread: !i.seen, created_at: new Date(i.at).toISOString(), preset_id: i.preset });
    items.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return { items, unread: items.filter((i) => i.unread).length };
  }

  private sendCheer(u: FakeUser, to: string, kind: 'cheer' | 'nudge', preset: string): HttpResponse {
    if (!this.friendsOf(u.id).has(to) && !this.squads.some((s) => s.members.some((m) => m.userId === u.id) && s.members.some((m) => m.userId === to))) return json(403, { code: 'not_friends' });
    const key = `${u.id}:${to}:${kind}:${localDate(this.ctx.clock(), TZ)}`;
    const n = this.cheers.get(key) ?? 0;
    if (this.cheerLimit !== null && n >= this.cheerLimit) return json(429, { code: 'limit' });
    this.cheers.set(key, n + 1);
    this.cheer(u.id, to, kind, preset);
    return json(200, { sent: true, queued_push: false });
  }

  // ── League (Monday to Sunday, IST) ────────────────────────────────────────────────

  private weekStart(): string {
    const today = localDate(this.ctx.clock(), TZ);
    const d = new Date(`${today}T00:00:00Z`);
    const back = (d.getUTCDay() + 6) % 7;
    return new Date(d.getTime() - back * DAY).toISOString().slice(0, 10);
  }

  weekXp(u: FakeUser): number {
    const start = this.weekStart();
    return (u.events.filter((e) => e.type === 'lesson_completed') as WireEvent<'lesson_completed'>[]).filter((e) => localDate(e.occurred_at, TZ) >= start).reduce((s, e) => s + (e.payload.xp ?? 0), 0);
  }

  private league(u: FakeUser): S['League'] {
    const tiers = defaultFlags.get('league.tier_names') as { en: string; hi: string }[];
    const week_start = this.weekStart();
    const closes = new Date(new Date(`${week_start}T23:59:00+05:30`).getTime() + 6 * DAY).toISOString();
    const promote = flag('league.promote_count', 7);
    const demote = flag('league.demote_count', 5);
    const base = { tier: 1, tier_name: tiers[0] ?? { en: '', hi: '' }, week_start, closes_at: closes, updated_at: new Date(this.ctx.clock()).toISOString(), promote_count: promote, demote_count: demote, my_xp: this.weekXp(u), best_week: null };
    const adult = this.band(u) === '18p';
    if (!adult && !this.joinedLeague.has(u.id)) return { ...base, state: 'join_available', rows: [], my_rank: null };
    if (base.my_xp === 0) return { ...base, state: 'not_joined', rows: [], my_rank: null };
    // One cohort: everyone in the same age group (adults with adults, teens with teens) with XP this week.
    const cohort = [...this.allUsers()].filter((x) => !x.isAnonymous && (this.band(x) === '18p') === adult && (adult || this.joinedLeague.has(x.id)) && this.weekXp(x) > 0);
    cohort.sort((a, b) => this.weekXp(b) - this.weekXp(a));
    const n = cohort.length;
    const rows = cohort.map((x, i) => {
      const rank = i + 1;
      const zone: S['LeagueRow']['zone'] = rank <= promote ? 'promote' : rank > Math.max(promote, n - demote) ? 'demote' : 'safe';
      return { person: this.person(u, x.id), rank, xp: this.weekXp(x), zone };
    });
    return { ...base, state: 'in_cohort', rows, my_rank: rows.find((r) => r.person.is_self)?.rank ?? null };
  }

  private allUsers(): FakeUser[] {
    return [...this.ctx.users()];
  }

  // ── Duos ──────────────────────────────────────────────────────────────────────────

  private duosFor(u: FakeUser): S['DuoOut'][] {
    return this.duos.filter((d) => d.status !== 'ended' && (d.a === u.id || d.b === u.id)).map((d) => this.duoOut(u, d));
  }

  private duoOut(u: FakeUser, d: (typeof this.duos)[number]): S['DuoOut'] {
    const partnerId = d.a === u.id ? d.b : d.a;
    const partner = this.ctx.user(partnerId);
    const meToday = this.today(u);
    const theyToday = partner ? this.today(partner) : false;
    const shared = d.status === 'active' && partner ? this.sharedStreak(u, partner, d.at) : 0;
    return { id: d.id, status: d.status, partner: this.person(u, partnerId), shared_streak: shared, best_streak: shared, me_today: meToday, partner_today: theyToday, invited_by_me: d.a === u.id, started_at: d.status === 'active' ? new Date(d.at).toISOString() : null };
  }

  /** Consecutive days, ending today or yesterday, on which both studied since the Duo began. */
  private sharedStreak(a: FakeUser, b: FakeUser, since: number): number {
    const days = (u: FakeUser) => new Set([...activityByDay(u.events.map((e) => ({ type: e.type, occurred_at: e.occurred_at })), TZ).keys()]);
    const da = days(a);
    const db = days(b);
    const start = localDate(since, TZ);
    let day = localDate(this.ctx.clock(), TZ);
    if (!(da.has(day) && db.has(day))) day = localDate(Date.parse(`${day}T12:00:00+05:30`) - DAY, TZ);
    let n = 0;
    while (day >= start && da.has(day) && db.has(day)) {
      n++;
      day = localDate(Date.parse(`${day}T12:00:00+05:30`) - DAY, TZ);
    }
    return n;
  }

  private inviteDuos(u: FakeUser, ids: string[]): S['DuoInviteResult'] {
    const max = flag('social.duo_max_partners', 5);
    const invited: S['DuoOut'][] = [];
    const failed: Record<string, string>[] = [];
    for (const id of ids) {
      const used = this.duos.filter((d) => d.status !== 'ended' && (d.a === u.id || d.b === u.id)).length;
      if (!this.friendsOf(u.id).has(id)) failed.push({ user_id: id, reason: 'not_friends' });
      else if (used >= max) failed.push({ user_id: id, reason: 'slots_full' });
      else if (this.duos.some((d) => d.status !== 'ended' && ((d.a === u.id && d.b === id) || (d.b === u.id && d.a === id)))) failed.push({ user_id: id, reason: 'exists' });
      else {
        const duo = { id: this.id('duo'), a: u.id, b: id, status: 'invited' as const, at: this.ctx.clock() };
        this.duos.push(duo);
        invited.push(this.duoOut(u, duo));
      }
    }
    return { invited, failed, max, used: this.duos.filter((d) => d.status !== 'ended' && (d.a === u.id || d.b === u.id)).length };
  }

  // ── Squads ────────────────────────────────────────────────────────────────────────

  private squadOut(u: FakeUser, s: (typeof this.squads)[number]): S['SquadOut'] {
    const me = s.members.find((m) => m.userId === u.id);
    return {
      id: s.id,
      name: s.name,
      crest_id: null,
      exam_profile_id: s.exam,
      invite_code: s.code,
      max_members: flag('social.squad_max_members', 20),
      member_count: s.members.length,
      my_role: me?.role ?? null,
      // No squad quest is configured in the fake (game.squad_quests is owner content).
      quest: null,
      members: s.members.map((m) => {
        const x = this.ctx.user(m.userId);
        return { person: this.person(u, m.userId), role: m.role, studied_today: x ? this.today(x) : false, week_xp: x ? this.weekXp(x) : 0 };
      }),
    };
  }

  // ── Duels ─────────────────────────────────────────────────────────────────────────

  private duelRoute(req: FeatureRequest): HttpResponse | null {
    const { method: m, path: p, user: u, body } = req;
    if (p === '/v1/duels/random') {
      if (m === 'DELETE') {
        this.queue.delete(u.id);
        return raw(204, '', 'text/plain');
      }
      if (m === 'POST' && !this.queue.has(u.id)) {
        const other = [...this.queue.entries()].find(([id, q]) => id !== u.id && !q.duelId && this.sameGroup(u, id));
        this.queue.set(u.id, { at: this.ctx.clock(), duelId: null });
        if (other) {
          const d = this.newDuel(other[0], u.id, 'random', String(body.exam_profile_id ?? ''));
          this.goLive(d);
          this.queue.set(other[0], { at: other[1].at, duelId: d.id });
          this.queue.set(u.id, { at: this.ctx.clock(), duelId: d.id });
        }
      }
      return json(200, this.queueState(u));
    }
    if (m === 'POST' && p === '/v1/duels') {
      if (!this.questions.length) return json(409, { code: 'no_questions' });
      if (body.solo === true) {
        const d = this.newDuel(u.id, null, 'solo', String(body.exam_profile_id ?? ''));
        this.goLive(d);
        return json(201, this.duelState(u, d));
      }
      const opp = String(body.opponent_id ?? '');
      if (!this.friendsOf(u.id).has(opp)) return json(403, { code: 'not_friends' });
      return json(201, this.duelState(u, this.newDuel(u.id, opp, 'friend', String(body.exam_profile_id ?? ''))));
    }
    if (m === 'GET' && p === '/v1/duels') return json(200, []);
    const r = /^\/v1\/duels\/([^/]+)(?:\/(accept|decline|answers|leave|async|events))?$/.exec(p);
    const d = r ? this.duels.get(r[1]!) : undefined;
    const me = d?.players.find((x) => x.userId === u.id);
    if (!r || !d || !me) return r ? json(404, { code: 'not_found' }) : null;
    this.advance(d);
    const action = r[2];
    if (!action && m === 'GET') return json(200, this.duelState(u, d));
    if (action === 'accept' && m === 'POST') {
      if (d.status === 'pending' && me.role === 'opponent') this.goLive(d);
      return json(200, this.duelState(u, d));
    }
    if (action === 'decline' && m === 'POST') {
      if (d.status === 'pending') d.status = 'declined';
      return raw(204, '', 'text/plain');
    }
    if (action === 'leave' && m === 'POST') {
      if (d.status === 'live' || d.status === 'pending') {
        me.left = true;
        d.status = d.status === 'pending' ? 'declined' : 'abandoned';
        d.winner = d.players.find((x) => x.userId !== u.id)?.userId ?? null;
        d.events++;
      }
      this.queue.delete(u.id);
      return json(200, this.duelState(u, d));
    }
    if (action === 'answers' && m === 'POST') {
      const q = d.questions[d.index];
      if (d.status !== 'live' || !q || q.id !== body.question_id) return json(409, { code: 'not_current' });
      if (me.answers.has(d.index)) return json(409, { code: 'already_answered' });
      const index = d.index;
      const a = this.record(d, me, q, (body.option_ids as string[] | null) ?? [], Number(body.client_ms ?? 0));
      return json(200, { correct: a.correct, points: a.points, index, key: { option_ids: q.correct }, duel: this.duelState(u, d) });
    }
    return null;
  }

  private sameGroup(u: FakeUser, otherId: string): boolean {
    const o = this.ctx.user(otherId);
    return Boolean(o) && (this.band(u) === '18p') === (this.band(o!) === '18p');
  }

  private queueState(u: FakeUser): S['QueueState'] {
    const q = this.queue.get(u.id);
    if (!q) return { state: 'idle', timed_out: false };
    const d = q.duelId ? this.duels.get(q.duelId) : undefined;
    if (d) return { state: 'matched', timed_out: false, duel: this.duelState(u, d), enqueued_at: new Date(q.at).toISOString() };
    const timeout = flag('duel.match_timeout_seconds', 10) * 1000;
    return { state: 'waiting', timed_out: this.ctx.clock() - q.at >= timeout, enqueued_at: new Date(q.at).toISOString() };
  }

  private newDuel(challenger: string, opponent: string | null, relation: FakeDuel['relation'], exam: string): FakeDuel {
    const count = Math.min(flag('duel.question_count', 10), this.questions.length);
    const d: FakeDuel = {
      id: this.id('duel'),
      mode: relation === 'solo' ? 'solo' : 'live',
      relation,
      status: 'pending',
      exam,
      players: [{ userId: challenger, role: 'challenger', answers: new Map(), left: false }, ...(opponent ? [{ userId: opponent, role: 'opponent' as const, answers: new Map(), left: false }] : [])],
      questions: this.questions.slice(0, count),
      seconds: flag('duel.question_seconds', 20),
      index: 0,
      openedAt: this.ctx.clock(),
      createdAt: this.ctx.clock(),
      events: 1,
      winner: null,
    };
    this.duels.set(d.id, d);
    return d;
  }

  private goLive(d: FakeDuel): void {
    d.status = 'live';
    d.index = 0;
    d.openedAt = this.ctx.clock();
    d.events++;
  }

  private record(d: FakeDuel, p: FakeDuelPlayer, q: FakeDuelQuestion, optionIds: string[], ms: number) {
    const correct = optionIds.length === q.correct.length && optionIds.every((o) => q.correct.includes(o));
    const max = flag('duel.speed_bonus_max', 5);
    const total = d.seconds * 1000;
    const bonus = max > 0 ? Math.round((max * Math.max(0, total - Math.max(0, ms))) / total) : 0;
    const a = { qid: q.id, correct, points: correct ? 1 + bonus : 0 };
    p.answers.set(d.index, a);
    d.events++;
    this.advance(d);
    return a;
  }

  /** The server's lazy clock: a question closes when everyone still in has answered or its time is up. */
  private advance(d: FakeDuel): void {
    if (d.status !== 'live') return;
    const now = this.ctx.clock();
    const ms = d.seconds * 1000;
    for (;;) {
      if (d.index >= d.questions.length) break;
      const all = d.players.every((p) => p.left || p.answers.has(d.index));
      const expired = now >= d.openedAt + ms;
      if (!all && !expired) break;
      d.openedAt = all ? Math.min(now, d.openedAt + ms) : d.openedAt + ms;
      d.index++;
      d.events++;
    }
    if (d.index >= d.questions.length) {
      d.status = 'finished';
      const scores = d.players.map((p) => ({ id: p.userId, s: this.score(p) }));
      if (scores.length === 2) d.winner = scores[0]!.s === scores[1]!.s ? null : scores[0]!.s > scores[1]!.s ? scores[0]!.id : scores[1]!.id;
    }
  }

  private score(p: FakeDuelPlayer): number {
    return [...p.answers.values()].reduce((s, a) => s + a.points, 0);
  }

  private duelState(u: FakeUser, d: FakeDuel): S['DuelState'] {
    const me = d.players.find((p) => p.userId === u.id)!;
    const done = d.status === 'finished' || d.status === 'abandoned';
    const q = d.questions[d.index];
    const live = d.status === 'live' && q;
    const winner: S['DuelResult']['winner'] = d.relation === 'solo' ? 'none' : d.winner === null ? (d.status === 'finished' ? 'draw' : 'none') : d.winner === u.id ? 'me' : 'them';
    const played = me.answers.size > 0;
    const xp = done && played ? flag('xp.duel_play', 5) + (winner === 'me' && d.relation !== 'solo' ? flag('xp.duel_win', 20) : 0) : 0;
    return {
      id: d.id,
      mode: d.mode,
      relation: d.relation,
      status: d.status,
      exam_profile_id: d.exam,
      subject_id: null,
      code: null,
      expires_at: null,
      invite_timed_out: false,
      start_at: d.status === 'pending' ? null : new Date(d.createdAt).toISOString(),
      server_time: new Date(this.ctx.clock()).toISOString(),
      last_event_id: d.events,
      question_count: d.questions.length,
      question_seconds: d.seconds,
      players: d.players.map((p) => ({
        is_me: p.userId === u.id,
        person: this.person(u, p.userId),
        role: p.role,
        score: this.score(p),
        correct: [...p.answers.values()].filter((a) => a.correct).length,
        answered_current: p.answers.has(d.index),
        finished: done || p.answers.size >= d.questions.length,
        away: p.left,
      })),
      current: live ? { index: d.index, question_id: q.id, body: q.body, opens_at: new Date(d.openedAt).toISOString(), closes_at: new Date(d.openedAt + d.seconds * 1000).toISOString(), answered: me.answers.has(d.index) } : null,
      my_answers: [...me.answers.entries()].map(([index, a]) => ({ index, question_id: a.qid, correct: a.correct, points: a.points, key: null })),
      result: done
        ? { winner, xp_earned: xp, not_counted: false, abandoned_by_me: d.status === 'abandoned' && me.left, abandoned_by_them: d.status === 'abandoned' && !me.left }
        : null,
      rematch: null,
    };
  }

  // ── Shared decks ──────────────────────────────────────────────────────────────────

  private deckRow(u: FakeUser, d: FakeSharedDeck): S['SharedDeckRow'] {
    return { code: d.code, title: d.title, card_count: d.cards.length, helpful: d.helpful.size, i_found_helpful: d.helpful.has(u.id), shared_by: this.friendsOf(u.id).has(d.ownerId) ? 'friend' : 'student', topic_id: d.topicId };
  }

  private overview(u: FakeUser): S['Overview'] {
    const state = this.ctx.state(u);
    const friends = this.friendRows(u);
    return {
      gate: this.gate(u),
      inbox_unread: this.inboxFor(u).unread,
      league: this.league(u),
      friends_today: friends,
      duos: this.duosFor(u),
      squads: this.squads.filter((s) => s.members.some((m) => m.userId === u.id)).map((s) => this.squadOut(u, s)),
      me: { xp_week: this.weekXp(u), streak: state.streak?.current ?? 0 },
    };
  }

  private id(prefix: string): string {
    return `${prefix}-${(++this.seq).toString().padStart(4, '0')}`;
  }
}
