/**
 * The JS side of the home-screen widgets (G-5): the payload the app hands the native widgets,
 * the view rules the Swift and Kotlin ports follow, and the native bridge.
 */
import { widgetSnapshot, type KeyValueStore, type WidgetSnapshotInput } from '@smriti/app-core';
import { createI18n } from '@smriti/i18n';

import {
  NativeWidgetBridge,
  WIDGET_IMAGES,
  WIDGET_KEY,
  buildWidgetPayload,
  petImage,
  plantImage,
  widgetTimeline,
  widgetView,
  type SmritiWidgetNativeModule,
  type WidgetLocalizer,
} from '../src/platform/widget';
import { createTestApp } from './harness';

const TZ = 'Asia/Kolkata';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** 2026-10-30 09:00 IST. */
const MORNING = Date.parse('2026-10-30T03:30:00Z');
const at = (base: number, hours: number) => base + hours * HOUR;

function input(over: Partial<WidgetSnapshotInput> = {}): WidgetSnapshotInput {
  return {
    now: MORNING,
    timeZone: TZ,
    locale: 'en',
    themePref: 'system',
    signedIn: true,
    isUnder10: false,
    streak: 12,
    goalProgress: 0.4,
    freezeHeld: false,
    restDayToday: false,
    lastActivityDay: '2026-10-29',
    plant: { species: 'tulsi', skin: null, stage: 'sapling', health: 'thriving' },
    pet: { species: 'cat', name: 'Miko', state: 'happy', outfit: null },
    healthByMissedDays: { droopy: 1, dry: 2, wilted: 4, dormant: 7 },
    dueCards: 5,
    planItems: [
      { title: 'Kinematics', subject_family: 'physics', minutes: 6, deep_link: '/lesson/phy-kinematics' },
      { title: 'Reviews', subject_family: 'memory', minutes: 4, deep_link: '/memory' },
    ],
    exam: { name: 'JEE Main', target_date: '2027-01-21', date_precision: 'day' },
    quietStart: '22:00',
    quietEnd: '07:00',
    eveningHour: null,
    ...over,
  };
}

function localizer(locale: 'en' | 'hi' = 'en'): WidgetLocalizer {
  const i18n = createI18n({ locale, brand: 'Smriti' });
  return { t: (key, values) => i18n.t(key, values), scheme: 'smriti-jee', goalMinutes: 10 };
}

const payloadFor = (over: Partial<WidgetSnapshotInput> = {}, locale: 'en' | 'hi' = 'en') =>
  buildWidgetPayload(widgetSnapshot({ ...input(over), locale }), localizer(locale));

describe('widget images', () => {
  it('uses the sapling health art and the healthy art for other stages', () => {
    expect(plantImage('sapling', 'dry')).toBe('plant-sapling-dry');
    expect(plantImage('sapling', 'thriving')).toBe('plant-sapling');
    expect(plantImage('tree', 'wilted')).toBe('plant-tree');
    expect(petImage('dog', 'missing_you')).toBe('dog-worried');
    expect(petImage('cat', 'content')).toBe('cat-base');
  });

  it('lists only seed-pack illustrations that exist, with an Agnes licence', () => {
    const meta = require('../assets/illustrations/illustrations.json') as Record<string, { licence: string; source: string }>;
    expect(WIDGET_IMAGES.length).toBe(17);
    for (const name of WIDGET_IMAGES) {
      expect(meta[name]).toBeDefined();
      expect(meta[name]!.licence).toBe('owned');
      expect(meta[name]!.source).toBe('agnes');
    }
  });
});

describe('buildWidgetPayload', () => {
  it('localises every string and links into the app', () => {
    const p = payloadFor();
    expect(p.payload_version).toBe(1);
    expect(p.text.streak).toBe('12 day streak');
    expect(p.text.morning).toBe('Today: 10 min');
    expect(p.text.progress).toBe('4/10 min');
    expect(p.text.progress_new_day).toBe('0/10 min');
    expect(p.text.review).toBe('Review 5');
    expect(p.text.pet_label).toBe('Miko · Happy');
    expect(p.text.stale).toBe('Open Smriti to update');
    expect(p.text.countdown).toBe('83 days to JEE Main');
    expect(p.text.items).toEqual(['Kinematics · 6 min', 'Reviews · 4 min']);
    expect(p.links).toMatchObject({
      garden: 'smriti-jee://me',
      rescue: 'smriti-jee://memory',
      review: 'smriti-jee://memory',
      home: 'smriti-jee://learn',
      items: ['smriti-jee://lesson/phy-kinematics', 'smriti-jee://memory'],
    });
    expect(p.images.plant).toEqual({
      thriving: 'plant-sapling',
      droopy: 'plant-sapling-droopy',
      dry: 'plant-sapling-dry',
      wilted: 'plant-sapling-wilted',
      dormant: 'plant-sapling-dormant',
    });
    expect(p.images.pet).toBe('cat-base');
    // Every image the payload can name is one the plugin copies.
    for (const name of [...Object.values(p.images.plant), p.images.pet, p.images.placeholder]) expect(WIDGET_IMAGES).toContain(name);
  });

  it('writes Hindi when the app is in Hindi', () => {
    const p = payloadFor({}, 'hi');
    expect(p.text.streak).toBe('12 दिन की स्ट्रीक');
    expect(p.text.review).toBe('5 रिव्यू');
    expect(p.text.countdown).toContain('JEE Main');
  });

  it('gives under-10s the gentle states: Play opens Home, no plant below droopy, pet never below sleepy', () => {
    const p = payloadFor({ isUnder10: true, pet: { species: 'dog', name: 'Bholu', state: 'missing_you', outfit: null } });
    expect(p.text.review).toBe('Play');
    expect(p.links.review).toBe('smriti-jee://learn');
    expect(p.snapshot.pet?.state).toBe('sleepy');
    expect(p.images.pet).toBe('dog-sleepy');
    expect(new Set(Object.values(p.images.plant))).toEqual(new Set(['plant-sapling', 'plant-sapling-droopy']));
    const resting = payloadFor({ isUnder10: true, pet: { species: 'cat', name: null, state: 'resting', outfit: null } });
    expect(resting.images.pet).toBe('cat-sleepy');
  });

  it('shows the month when the exam date is only a month', () => {
    const p = payloadFor({ exam: { name: 'UPSC CSE', target_date: '2027-05-01', date_precision: 'month' } });
    expect(p.text.countdown).toBe('UPSC CSE in May 2027');
  });
});

describe('widgetView', () => {
  it('shows the morning line, the progress and the review pill on the day it was written', () => {
    const v = widgetView(payloadFor(), at(MORNING, 0.5));
    expect(v).toMatchObject({ stale: false, newDay: false, line: 'morning', lineText: 'Today: 10 min', lineLink: 'smriti-jee://me' });
    expect(v.progressText).toBe('4/10 min');
    expect(v.pill).toEqual({ text: 'Review 5', link: 'smriti-jee://memory' });
    expect(v.plan.header).toBe('Today');
    expect(v.plan.rows).toHaveLength(2);
    expect(v.countdown).toBe('83 days to JEE Main');
  });

  it('switches to the evening rescue at the evening hour (3 h before quiet hours)', () => {
    const v = widgetView(payloadFor(), at(MORNING, 10)); // 19:00 IST
    expect(v.line).toBe('evening');
    expect(v.lineLink).toBe('smriti-jee://memory');
    expect(v.pill).toEqual({ text: '2-min rescue', link: 'smriti-jee://memory' });
  });

  it('says watered once the goal is met, and the plan shows Done', () => {
    const v = widgetView(payloadFor({ goalProgress: 1 }), at(MORNING, 10));
    expect(v.line).toBe('watered');
    expect(v.progressText).toBe('Goal met!');
    expect(v.plan.done).toBe(true);
  });

  it('keeps the rest day line ahead of everything else', () => {
    expect(widgetView(payloadFor({ restDayToday: true }), at(MORNING, 10)).line).toBe('rest_day');
  });

  it('resets progress and predicts health on a new day', () => {
    // Written 29 Oct with the last lesson on 27 Oct; seen 31 Oct: 3 missed days → dry.
    const p = payloadFor({ now: MORNING - DAY, lastActivityDay: '2026-10-27' });
    const v = widgetView(p, at(MORNING, 24));
    expect(v.newDay).toBe(true);
    expect(v.health).toBe('dry');
    expect(v.plantImage).toBe('plant-sapling-dry');
    expect(v.progress).toBe(0);
    expect(v.progressText).toBe('0/10 min');
    expect(v.line).toBe('not_yet');
    expect(v.plan).toEqual({ header: 'Plan today\'s study', rows: [], done: false });
    expect(v.pill.text).toBe('All caught up');
  });

  it('stops an under-10 plant at droopy and keeps Play as the action', () => {
    const p = payloadFor({ isUnder10: true, now: MORNING - DAY, lastActivityDay: '2026-10-20' });
    const v = widgetView(p, at(MORNING, 10));
    expect(v.health).toBe('droopy');
    expect(v.line).toBe('evening');
    expect(v.lineLink).toBe('smriti-jee://me');
    expect(v.pill).toEqual({ text: 'Play', link: 'smriti-jee://learn' });
  });

  it('hides numbers except the streak after 72 hours', () => {
    const v = widgetView(payloadFor(), MORNING + 73 * HOUR);
    expect(v.stale).toBe(true);
    expect(v.lineText).toBe('Open Smriti to update');
    expect(v.progressText).toBeNull();
    expect(v.countdown).toBeNull();
    expect(v.plan.rows).toEqual([]);
    expect(v.pill).toEqual({ text: 'Reviews waiting', link: 'smriti-jee://memory' });
  });
});

describe('widgetTimeline', () => {
  it('redraws at 12:00, the evening hour and midnight, local time', () => {
    const t = widgetTimeline(payloadFor(), MORNING);
    expect(t.map((ms) => new Date(ms).toISOString())).toEqual([
      '2026-10-30T03:30:00.000Z',
      '2026-10-30T06:30:00.000Z',
      '2026-10-30T13:30:00.000Z',
      '2026-10-30T18:30:00.000Z',
    ]);
    expect(widgetTimeline(payloadFor(), at(MORNING, 11))).toHaveLength(2);
  });
});

describe('NativeWidgetBridge', () => {
  function memoryKv(): KeyValueStore & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return {
      data,
      get: async (k: string) => data.get(k) ?? null,
      set: async (k: string, v: string) => {
        data.set(k, v);
      },
      delete: async (k: string) => {
        data.delete(k);
      },
    };
  }

  it('keeps the key-value copy and hands the localised payload to the native module', async () => {
    const kv = memoryKv();
    const native: SmritiWidgetNativeModule & { json: string[]; cleared: number } = {
      json: [],
      cleared: 0,
      async setPayload(json) {
        this.json.push(json);
      },
      async clear() {
        this.cleared += 1;
      },
    };
    const bridge = new NativeWidgetBridge(kv, () => localizer('en'), native);
    const snapshot = widgetSnapshot(input());
    await bridge.write(snapshot);
    expect(JSON.parse(kv.data.get(WIDGET_KEY)!)).toEqual(snapshot);
    expect(await bridge.read()).toEqual(snapshot);
    expect(native.json).toHaveLength(1);
    const sent = JSON.parse(native.json[0]!);
    expect(sent.text.streak).toBe('12 day streak');
    expect(sent.snapshot).toEqual(snapshot);
    await bridge.clear();
    expect(native.cleared).toBe(1);
  });

  it('works without the native module (web, tests, Expo Go)', async () => {
    const kv = memoryKv();
    const bridge = new NativeWidgetBridge(kv, () => localizer('en'), null);
    await bridge.write(widgetSnapshot(input()));
    expect(kv.data.has(WIDGET_KEY)).toBe(true);
    await bridge.clear();
    expect(kv.data.has(WIDGET_KEY)).toBe(false);
  });
});

describe('SmritiApp.writeWidget', () => {
  const card = (ref: string, dueAt: string) => ({
    card_ref: ref,
    deck_id: null,
    state: 2 as const,
    due_at: dueAt,
    stability: 3,
    difficulty: 5,
    elapsed_days: 3,
    scheduled_days: 3,
    learning_steps: 0,
    reps: 3,
    lapses: 0,
    last_review_at: '2026-10-27T04:30:00.000Z',
    suspended: false,
    flags: 0,
    buried_until: null,
    updated_at: '2026-10-27T04:30:00.000Z',
  });

  it("writes the pet state, today's due cards and plan, and clears on sign-out", async () => {
    const { app } = createTestApp({ variant: 'all' });
    await app.boot();
    await app.ensureSession();
    await app.chooseLocale('en');
    await app.answerGoal(['jee-main-2027'], null);
    await app.nameBuddy('cat', 'Miko');
    await app.plantSeed();
    app.store.setState({ pet: { species: 'cat', name: 'Miko', mood: 40, energy: 40, state: 'sleepy' } });
    await app.deps.stores.storage.srs_cards.putMany([
      card('c1', '2026-10-30T02:00:00.000Z'),
      card('c2', '2026-10-30T17:00:00.000Z'), // 22:30 IST, still today
      card('c3', '2026-10-31T05:00:00.000Z'), // tomorrow
    ]);

    await app.writeWidget();
    const snapshot = (await app.widget.read())!;
    expect(snapshot.pet?.state).toBe('sleepy');
    expect(snapshot.due_cards).toBe(2);
    expect(snapshot.plan_items[0]).toEqual({ title: 'Review 2 cards', subject_family: 'memory', minutes: 1, deep_link: '/memory' });
    expect(snapshot.plan_items[1]?.deep_link).toMatch(/^\/lesson\//);
    expect(snapshot.plan_items[1]?.title).toMatch(/^Learn /);
    expect(snapshot.exam).toBeNull();

    await app.signOut();
    expect(await app.deps.stores.kv.get(WIDGET_KEY)).toBeNull();
  });
});
