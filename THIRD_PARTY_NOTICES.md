# Third-party notices

VoiceBridge has **zero runtime dependencies**: the service is the Node standard library plus the
vendored ARAG platform. Two vendored files ship inside this repository.

## @elevenlabs/client 1.14.0 — MIT

`public/vendor/elevenlabs-client.js` is the pinned browser bundle of
[`@elevenlabs/client@1.14.0`](https://www.npmjs.com/package/@elevenlabs/client) (`dist/lib.iife.js`,
which also bundles `livekit-client@2.16.1`), downloaded once with `bun` from the corporate registry
and committed so the browser never fetches code from a CDN at runtime. A three-line ESM export
footer was appended so the console can `import { Conversation }` from it; nothing else was changed.

To re-vendor after a version bump: download the package with `bun add @elevenlabs/client@<version>`
in a scratch directory, copy `dist/lib.iife.js`, re-append the export footer, and update this file.

```
MIT License

Copyright (c) 2025 ElevenLabs

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## ARAG platform — Apache-2.0

`vendor/arag-platform/` is a synced copy of the shared ARAG platform library (Apache-2.0, see
`vendor/arag-platform/LICENSE`). Never edit it in place: change the platform repository and re-run
`make sync-platform TARGET=../arag-voice` from there.

## Documentation CDNs

The API reference pages (`/api/v1/docs`, `/api/v1/swagger`) load Redoc and Swagger UI from
jsDelivr at view time. They are documentation surfaces only — the console and admin panel work
fully offline.
