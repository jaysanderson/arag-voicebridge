/** Run the mock ARAG server standalone: `node src/arag/mock/cli.ts` (MOCK_PORT, MOCK_SEED=calls|docs). */

import { SAMPLE_CALL_TRANSCRIPT, SAMPLE_DOCS } from "./fixtures.ts";
import { startMockArag } from "./server.ts";

const seedKind = process.env.MOCK_SEED ?? "";
const seed =
  seedKind === "docs"
    ? Object.entries(SAMPLE_DOCS).map(([k, text]) => ({ title: `${k}.txt`, filename: `${k}.txt`, text }))
    : seedKind === "calls"
      ? [
          {
            title: "Billing complaint - double-charged premium",
            filename: "call-0001.mp3",
            contentType: "audio/mpeg",
            transcript: SAMPLE_CALL_TRANSCRIPT,
            metadata: { agent_name: "Maria Gonzales", queue: "Billing", duration_sec: 66 },
          },
        ]
      : [];
if (!process.env.MOCK_PORT) process.env.MOCK_PORT = "8790";
const s = await startMockArag({ seed, apiKey: process.env.MOCK_API_KEY ?? "mock-api-key" });
console.log(
  JSON.stringify({
    msg: "mock ARAG listening",
    url: s.url,
    kbId: s.kbId,
    apiKey: s.apiKey,
    seeded: seed.length,
  }),
);
