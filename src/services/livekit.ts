/**
 * LiveKit access-token minting — dependency-free (node:crypto only).
 *
 * LiveAvatar LITE mode is "bring your own WebRTC": the bridge owns a LiveKit room and mints the
 * tokens. A LiveKit access token is just a JWT (HS256) signed with the LiveKit API secret,
 * carrying a `video` grant, so the LiveKit server SDK is not needed.
 *
 * Two tokens per avatar session: a VIEWER token for the browser and a WORKER token handed to
 * LiveAvatar so its avatar worker can join the same room and publish.
 */
import { createHmac, randomUUID } from "node:crypto";

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface VideoGrant {
  room: string;
  roomJoin?: boolean;
  canPublish?: boolean;
  canSubscribe?: boolean;
  canPublishData?: boolean;
}

export interface MintOptions {
  apiKey: string;
  apiSecret: string;
  identity: string;
  grant: VideoGrant;
  ttlSeconds?: number;
  name?: string;
}

/** Mint a LiveKit access token (JWT, HS256) for a room + identity. */
export function mintLiveKitToken(opts: MintOptions): string {
  const now = Math.floor(Date.now() / 1000);
  const ttl = opts.ttlSeconds ?? 60 * 60; // 1h default
  const header = { alg: "HS256", typ: "JWT" };
  const payload: Record<string, unknown> = {
    iss: opts.apiKey,
    sub: opts.identity,
    nbf: now - 5,
    exp: now + ttl,
    jti: randomUUID(),
    video: {
      room: opts.grant.room,
      roomJoin: opts.grant.roomJoin ?? true,
      canPublish: opts.grant.canPublish ?? true,
      canSubscribe: opts.grant.canSubscribe ?? true,
      canPublishData: opts.grant.canPublishData ?? true,
    },
  };
  if (opts.name) payload.name = opts.name;

  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = b64url(createHmac("sha256", opts.apiSecret).update(signingInput).digest());
  return `${signingInput}.${sig}`;
}

/** Generate a fresh room name for a session. */
export function newRoomName(prefix = "avatar"): string {
  return `${prefix}-${randomUUID()}`;
}
