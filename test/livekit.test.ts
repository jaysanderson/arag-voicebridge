import { createHmac } from "node:crypto";
import { mintLiveKitToken, newRoomName } from "../src/services/livekit.ts";
import { describe, expect, it } from "./_expect.ts";

interface DecodedJwt {
  header: Record<string, unknown>;
  payload: Record<string, any>;
  signature: string;
  signingInput: string;
}

function decodeJwt(token: string): DecodedJwt {
  const [h, p, s] = token.split(".");
  const json = (seg: string) => JSON.parse(Buffer.from(seg, "base64url").toString("utf8"));
  return { header: json(h!), payload: json(p!), signature: s!, signingInput: `${h}.${p}` };
}

describe("mintLiveKitToken", () => {
  const base = {
    apiKey: "APIxxxx",
    apiSecret: "secretsecretsecret",
    identity: "viewer-1",
    grant: { room: "room-42" },
  };

  it("produces a verifiable HS256 JWT with the LiveKit video grant", () => {
    const tok = mintLiveKitToken(base);
    const { header, payload, signature, signingInput } = decodeJwt(tok);
    expect(header.alg).toBe("HS256");
    expect(payload.iss).toBe("APIxxxx");
    expect(payload.sub).toBe("viewer-1");
    expect(payload.video.room).toBe("room-42");
    expect(payload.video.roomJoin).toBe(true);
    // signature must verify with the secret
    const expected = createHmac("sha256", base.apiSecret).update(signingInput).digest("base64url");
    expect(signature).toBe(expected);
  });

  it("sets exp in the future and honours ttl", () => {
    const { payload } = decodeJwt(mintLiveKitToken({ ...base, ttlSeconds: 120 }));
    const now = Math.floor(Date.now() / 1000);
    expect(payload.exp).toBeGreaterThan(now);
    expect(payload.exp).toBeLessThanOrEqual(now + 121);
  });

  it("can restrict publish/subscribe", () => {
    const { payload } = decodeJwt(
      mintLiveKitToken({ ...base, grant: { room: "r", canPublish: false, canSubscribe: true } }),
    );
    expect(payload.video.canPublish).toBe(false);
    expect(payload.video.canSubscribe).toBe(true);
  });
});

describe("newRoomName", () => {
  it("is unique and prefixed", () => {
    const a = newRoomName("progress");
    const b = newRoomName("progress");
    expect(a.startsWith("progress-")).toBe(true);
    expect(a).not.toBe(b);
  });
});
