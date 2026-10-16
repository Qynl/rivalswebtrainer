# Multiplayer — static-site, browser-hosted matches

## Play: no backend deployment or configuration

1. Open the updated HTTPS game site and choose **Multiplayer**.
2. Enter your name, select a map, and choose **Create lobby**.
3. **Copy invite link**, or share the six-character invite code.
4. Friends open the link (the join code is filled in), then click **Join**.
5. Pick teams and four weapons. Everyone readies up; the host starts an equal **1v1, 2v2 or 3v3** match. First to five rounds wins.

No account, API URL, port forwarding, Node server deployment, or manual WebRTC offer/answer copying is required. The normal client **never requests `/api/health` or `/api/live`**. This works with static hosting, including the user's `somerandomshooter.freebuff.app` deployment, once its frontend is republished with this update. A Git push alone does not prove that an independently published site has updated.

**Keep the host's game tab open and active.** The host browser runs the match. Closing it, leaving the room or a running authority worker failing ends guests' connections; there is no host migration. Worker startup failures fall back to main-thread authority. Background-tab throttling, sleeping a device, or a slow host can affect everyone. Escape pauses only your own input, not the shared match.

Online maps: **Concrete Arena, Foundry and Courtyard**. Online opponents are real people, not bots. All five maps, the full weapon roster, and bot/range training remain available offline. Multiplayer itself needs an Internet connection.

After joining a match, click **Back to the arena** to capture the mouse: a network message cannot grant browser pointer-lock permission. **M** can open the weapon picker during the five-second countdown. A picker already open may finish after FIGHT while everyone else continues; it does not refresh unchanged ammo or health. Finished matches can return to the lobby for rematches.

## What runs where

- **PeerJS 1.5.5** uses its default, publicly hosted PeerJS Cloud service for discovery/signaling. The host automatically registers a random six-hex-character ID under the game's protocol-specific namespace. The invite code addresses that peer. Public global lobby discovery is not offered or faked.
- **Game traffic uses actual WebRTC data channels between browsers.** The host runs the same validated `LobbyService`, `Match`, headless `Game`, and map collision code as the optional dedicated server. Health, ammo, damage, teams, loadouts, rounds and scores are authoritative in that host browser.
- PeerJS supplies its default STUN/TURN configuration. Connections may be direct or relayed depending on the network. **Hosted discovery and relay are third-party services, not infrastructure we operate or guarantee.** Firewalls, restrictive NAT, provider outages/limits, or unavailable relay capacity can prevent a connection. No server setup is needed from the player, but this is not literally infrastructure-free or guaranteed zero-lag multiplayer.
- This is **PeerJS, not Geckos**. Geckos' server needs Node/native networking and cannot satisfy the requested static-only deployment without provisioning a backend. The existing Geckos implementation remains an optional alternative, not a hidden requirement.

### Simulation, prediction and limits

The host targets **120 fixed simulation steps/second**, **20 Hz snapshots**, and **30 Hz client input**, with immediate discrete action edges. Match authority now runs in a **Web Worker**, away from WebGL/shader compilation and the React UI. Worker-restricted browsers retain a main-thread compatibility path; no backend setup is introduced. Browser scheduling and device performance still apply.

New browser peers negotiate a second **unordered, zero-retransmission RTC data channel** for compact binary snapshots and replaceable movement input. Lobby messages, confirmed combat events and unacknowledged action edges stay on reliable ordered control. Old positions no longer wait for retransmission of earlier state. A typical six-player snapshot measured **4,195 JSON bytes versus 587 binary bytes (86% less)**, excluding transport headers and projectiles; this is a sample state-frame comparison, not an Internet throughput/FPS benchmark.

The realtime queue is capped at 32 KiB; obsolete state is dropped rather than accumulated. Unsupported channels fall back to reliable JSON. If state delivery stalls while reliable control remains connected, the guest requests reliable state recovery without leaving the match. Both paths keep input validation and the same authoritative simulation. Snapshot match nonces and monotonic times reject old, duplicate or reordered frames.

Browser peers adapt their interpolation buffer within **55–120 ms** using arrival jitter and a smoothed remote clock; extrapolation remains capped at 50 ms. Legacy server mode retains its 75 ms buffer. Local movement prediction and bounded hitscan rewind remain enabled. Firing presentation is predicted immediately without granting ammo, projectiles or damage; authoritative shot echoes are deduplicated. Slow devices and Internet latency still impose limits.

Room revisions, membership epochs and match nonces prevent stale match messages from reviving a left room. Guests cannot create or replace the host's single room. LobbyService validates names, inputs, weapon choices, team sizes, readiness, host permissions and request rates. Guest payload sizes, simultaneous/pending connections, and queues are bounded. Stale controls neutralize after 200 ms; heartbeats detect lost connections. Failed joins restore a local lobby so a player can retry or create a match.

This is a casual invite system, **not ranked/cheat-proof play**: the host controls the authority and can modify it. Codes are convenient addresses, not passwords or identity verification. No accounts, persistent rooms, matchmaking backend or automatic host migration are included.

The browser authority creates collision/physics state, not a second visible renderer. Detailed local/remote weapon models, utility meshes, white Sniper scope glints, Knife backstabs and the offline visual improvements are preserved. PeerJS/authority code loads when Multiplayer opens rather than delaying offline startup.

## Optional legacy dedicated-server mode

Only use this section if you deliberately want to operate your own server. **It is not needed to play the default multiplayer.** Add `?network=server` to select the old Geckos/WebSocket client. Invite links created in that mode preserve the selection. Remove it to return to static-site P2P.

For local development, `npm ci && npm run dev -- --port 5173` still starts Vite and the optional compatibility server. Production static hosting only needs the output of `npm run build`; it does not need that server.

For a dedicated same-origin deployment:

```sh
npm ci
npm run build
ORIGINS=https://game.example.com PORT=3001 npm start
```

`npm start` serves `dist` and `/api` on `0.0.0.0:3001`. Use HTTPS, exact `ORIGINS`, WebSocket Upgrade forwarding, and public-service request/connection limits. Geckos additionally needs a working optional `@geckos.io/server`/`node-datachannel` native installation and exposed UDP 10000–10100; a TCP reverse proxy alone is insufficient. `GECKOS=0` selects WebSocket only, and `ICE_SERVERS` optionally supplies the native server's ICE configuration.

The sandbox's native Geckos binary is unavailable, so its legacy browser regression uses the real WebSocket fallback; native Geckos Internet UDP remains unverified. Dedicated mode alone supports its server-local public-room list and lobby host ownership migration. Both modes now use compact binary snapshots when their realtime transport is available. Rooms are in-memory and do not survive a server restart.

If `/api/health` returns HTML in this explicitly selected mode, the error explains that the backend is missing and tells the player to remove `network=server` for default browser-hosted multiplayer. That HTML/API problem does not apply to normal static-site play. Offline service workers never cache API/signaling responses.

## Bigger, actually elevated Arena

Concrete Arena is now **40 × 50** (2,000 m²), up from 30 × 38 (1,140 m²): **75.4% more floor area**, at unchanged character scale and movement speed. Walls stay 14 high, not a taller box.

Two **5 × 20** upper galleries add **200 m² of playable space at y=3.2**, with four access ramps, a clear ground-level gap before the original rear ramp banks, low upper cover, coping, expansion bands and preserved mirrored fairness. These are long combat lanes, not just the tips of small ramps. The rear decks are also lowered to 3.2. All spawn-to-spawn routes, both rear summits, and six sampled gallery destinations are physically traversed in regression tests, checking head clearance and valid support on every step. Bots can path to and fight from the upper floor.

A server stress replay exposed a one-frame capsule/cover-corner overlap during an ascending jump. Horizontal collision now uses the same strict geometric epsilon as occupancy checks rather than letting the last four centimetres pass through the side. The regression preserves upward velocity instead of cancelling the jump or teleporting the body upward.

## Flamethrower

- A sustained, advecting **three-sheet shader core** connects to the actual nozzle, rather than emitting isolated orange balls on damage ticks. Blue ignition, bright yellow hot gas, irregular orange tongues, scrolling turbulence and detached wisps are separate visual layers.
- Both plume and wisps use **two persistent instanced draw groups**, seven bounded emitters and a **192-wisp pool**; firing does not create a new mesh/material per frame. Camera movement updates the nozzle/aim attachment between damage ticks. A near-wall muzzle check prevents the nozzle projecting the plume through cover.
- The nozzle heats and cools, its vent rings/glow, pilot flame and valve animate, and pressure produces a restrained viewmodel vibration without moving the user's look pitch. Local muzzle light flickers continuously instead of strobing like a rifle.
- A single looping filtered-noise voice crossfades with the trigger, rather than starting a separate roar at every damage tick. Pause, quit and spatial-audio cleanup stop the loop.
- The damage cone is tightened from `.88` to `.98` forward-dot so it better matches the visible jet. Ammo, reload, direct damage and afterburn remain server-owned online.

## Validation

```sh
npm test
npm run build
npm run test:browser
```

`tests/peer-multiplayer.spec.js` serves the production build from a **static-only HTTP server with `/api` deliberately forbidden**. A test-only local PeerServer substitutes for public discovery, allowing deterministic real browser-to-browser RTC data-channel testing without depending on external signaling availability. `peer` is a development dependency only; no local signaling server or endpoint configuration is shipped as a player requirement.

The test exercises real invitations, loadout/readiness, match startup, replicated snapshots, movement/fire/utility input, leaving/rejoining and host-close behavior, and asserts zero API requests. A second case covers a prefilled invite link and recovery from an unavailable code. Unit tests cover guest permissions, backpressure, room-code assignment and cancellation. Existing dedicated-server and offline-reload regressions remain separate.

These are local browser/network regressions, **not a test of the public PeerJS provider, Internet-wide NAT traversal, or a claim that the published Freebuff site has already updated**. No networked FPS can guarantee zero latency.

Initial invite-flow validation (before the responsiveness/feedback pass below): **344/344 unit tests**, **16/16 targeted browser regressions**, and the production build passed. The browser set includes both real P2P cases, legacy server compatibility, disconnected production reload, Knife/Sniper animation checks, G utilities and explosive trickshots. Public PeerJS Cloud/Internet relay reachability was not validated from this restricted sandbox.


## Countdown/HUD and presentation fixes

- Countdown completion follows the **authoritative match phase**, not whether the local game is paused. A joining player awaiting mouse capture now clears “1” and sees the transition to FIGHT. The HUD timer, health and ammo continue to receive authoritative updates while the local render/input is paused.
- Online round setup no longer constructs five throwaway offline bots before replacing them with the actual human players. Only actual opponents receive visible character rigs.
- The local multiplayer gun now receives its missing shot presentation: recoil, flash, casing ejection and sound. Your own confirmed tracers are no longer discarded; wall impacts, hit flinches and elimination audio are replicated. Hit markers and damage numbers remain confirmation-only.
- Current operator/gun changes are detailed in [player models and gun feedback](player-gun-feedback.md).

`tests/peer-multiplayer.spec.js` now additionally checks a paused joining browser with **no manual render/simulation ticks**: the worker advances the match, countdown clears, and the HUD timer advances. It verifies actual unordered/zero-retransmission data-channel properties, injected 20% incoming state loss and delayed/reordered frames, monotonically accepted snapshots, and automatic reliable recovery after state delivery is deliberately stalled. These are controlled local regressions, not an Internet-wide lag/availability guarantee.


Latest feedback/responsiveness validation: **385/385 unit tests**, production build and whitespace checks passed. **21 distinct browser scenarios** passed across broad and targeted clean-build runs, including a real six-client 3v3 RTC test (one browser with six independent network clients, not six GPU renderers). The initial broad run's sidearm picker was interrupted by a development reload while source changes were still being made; it passed on the clean rerun. Public cloud signaling/NAT reachability and a Freebuff republish remain unverified.
