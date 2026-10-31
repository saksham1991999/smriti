/**
 * FAKE API, dev and test only (see ./server.ts). The Phase 2 and 3 endpoints the app's later
 * screens call, shaped as apps/api answers them: parent mode (`/v1/guardian/*`, `/v1/me/limits`,
 * `/v1/me/time-requests`), social, speech, voice, Feynman, insights and live mocks.
 *
 * Every number comes from the users' own events or from what a test or demo put here. Nothing is
 * invented: a learner with no activity gets zeros and empty lists, as from the real API.
 */
import type { HttpResponse, SyncStateResponse } from '@smriti/app-core';

import { AiFakes } from './ai';
import { InsightsFakes } from './insights';
import { LiveFakes } from './live';
import { ParentFakes } from './parent';
import { SocialFakes } from './social';
import type { FakeUser } from './server';

export interface FeatureRequest {
  method: string;
  path: string;
  url: URL;
  body: Record<string, unknown>;
  user: FakeUser;
}

export interface FeatureContext {
  clock: () => number;
  user: (id: string) => FakeUser | null;
  users: () => Iterable<FakeUser>;
  /** The flags `/v1/config` serves (the API reads the same ones). */
  flags: () => Record<string, unknown>;
  state: (user: FakeUser) => SyncStateResponse;
}

export interface FeatureModule {
  route(req: FeatureRequest): HttpResponse | null | Promise<HttpResponse | null>;
}

export class FeatureFakes {
  readonly parent: ParentFakes;
  readonly social: SocialFakes;
  readonly ai: AiFakes;
  readonly insights: InsightsFakes;
  readonly live: LiveFakes;
  private readonly modules: FeatureModule[];

  constructor(readonly ctx: FeatureContext) {
    this.parent = new ParentFakes(ctx);
    this.social = new SocialFakes(ctx);
    this.ai = new AiFakes(ctx);
    this.insights = new InsightsFakes(ctx);
    this.live = new LiveFakes(ctx);
    this.modules = [this.parent, this.social, this.ai, this.insights, this.live];
  }

  /** Adds a module (later features register theirs here). */
  use(module: FeatureModule): void {
    this.modules.push(module);
  }

  async route(req: FeatureRequest): Promise<HttpResponse | null> {
    for (const m of this.modules) {
      const res = await m.route(req);
      if (res) return res;
    }
    return null;
  }
}
