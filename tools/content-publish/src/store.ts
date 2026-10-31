/**
 * Where published files go. The publisher only talks to this interface: a local folder for
 * development and CI, or Cloudflare R2 through its S3 API for staging and production.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { PublishError } from "./errors.js";

/** content: bundles, manifests, patches, seed packs, history. assets: media files by sha256. */
export type Bucket = "content" | "assets";

export interface PutOptions {
  contentType: string;
  /** Immutable files (hash-named) get a year-long cache; manifests a short one. */
  immutable: boolean;
}

export interface ObjectStore {
  /** "local" for a folder; anything else is a remote target fixtures may never reach. */
  readonly kind: "local" | "r2" | "memory";
  readonly description: string;
  put(bucket: Bucket, key: string, body: Uint8Array, options: PutOptions): Promise<void>;
  get(bucket: Bucket, key: string): Promise<Uint8Array | null>;
  exists(bucket: Bucket, key: string): Promise<boolean>;
}

export const CACHE_IMMUTABLE = "public, max-age=31536000, immutable";
export const CACHE_SHORT = "public, max-age=60";

/** Writes `{root}/{key}` for content and `{root}/{key}` for assets too (keys start with assets/). */
export class LocalDirStore implements ObjectStore {
  readonly kind = "local" as const;
  constructor(readonly root: string) {}

  get description(): string {
    return `local folder ${this.root}`;
  }

  private path(key: string): string {
    if (key.includes("..") || key.startsWith("/")) throw new PublishError("bad_key", key);
    return join(this.root, key);
  }

  async put(_bucket: Bucket, key: string, body: Uint8Array): Promise<void> {
    const p = this.path(key);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }

  async get(_bucket: Bucket, key: string): Promise<Uint8Array | null> {
    const p = this.path(key);
    return existsSync(p) ? readFileSync(p) : null;
  }

  async exists(_bucket: Bucket, key: string): Promise<boolean> {
    return existsSync(this.path(key));
  }
}

/** In-memory store for tests. */
export class MemoryStore implements ObjectStore {
  readonly kind = "memory" as const;
  readonly description = "memory";
  readonly objects = new Map<string, { body: Uint8Array; options: PutOptions }>();

  async put(bucket: Bucket, key: string, body: Uint8Array, options: PutOptions): Promise<void> {
    this.objects.set(`${bucket}/${key}`, { body, options });
  }
  async get(bucket: Bucket, key: string): Promise<Uint8Array | null> {
    return this.objects.get(`${bucket}/${key}`)?.body ?? null;
  }
  async exists(bucket: Bucket, key: string): Promise<boolean> {
    return this.objects.has(`${bucket}/${key}`);
  }
}

/** The part of the S3 client the store uses, so tests can pass a fake. */
export interface S3Like {
  send(command: PutObjectCommand | GetObjectCommand | HeadObjectCommand): Promise<unknown>;
}

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  contentBucket: string;
  assetsBucket: string;
}

export const R2_ENV = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_CONTENT",
  "R2_BUCKET_ASSETS",
] as const;

/** Read the R2 settings from the environment; names are in .env.example, values in CI secrets. */
export function r2ConfigFromEnv(env: NodeJS.ProcessEnv = process.env): R2Config {
  const missing = R2_ENV.filter((k) => !env[k]);
  if (missing.length) throw new PublishError("r2_env", `missing ${missing.join(", ")}`);
  return {
    accountId: env.R2_ACCOUNT_ID as string,
    accessKeyId: env.R2_ACCESS_KEY_ID as string,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY as string,
    contentBucket: env.R2_BUCKET_CONTENT as string,
    assetsBucket: env.R2_BUCKET_ASSETS as string,
  };
}

export class R2Store implements ObjectStore {
  readonly kind = "r2" as const;
  private readonly client: S3Like;

  constructor(
    readonly config: R2Config,
    client?: S3Like,
  ) {
    this.client =
      client ??
      new S3Client({
        region: "auto",
        endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      });
  }

  get description(): string {
    return `R2 buckets ${this.config.contentBucket} and ${this.config.assetsBucket}`;
  }

  private bucket(b: Bucket): string {
    return b === "content" ? this.config.contentBucket : this.config.assetsBucket;
  }

  async put(bucket: Bucket, key: string, body: Uint8Array, options: PutOptions): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket(bucket),
        Key: key,
        Body: body,
        ContentType: options.contentType,
        CacheControl: options.immutable ? CACHE_IMMUTABLE : CACHE_SHORT,
      }),
    );
  }

  async get(bucket: Bucket, key: string): Promise<Uint8Array | null> {
    try {
      const res = (await this.client.send(new GetObjectCommand({ Bucket: this.bucket(bucket), Key: key }))) as {
        Body?: { transformToByteArray(): Promise<Uint8Array> };
      };
      return res.Body ? await res.Body.transformToByteArray() : null;
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  }

  async exists(bucket: Bucket, key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket(bucket), Key: key }));
      return true;
    } catch (e) {
      if (isNotFound(e)) return false;
      throw e;
    }
  }
}

function isNotFound(e: unknown): boolean {
  const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
  return err.name === "NoSuchKey" || err.name === "NotFound" || err.$metadata?.httpStatusCode === 404;
}
