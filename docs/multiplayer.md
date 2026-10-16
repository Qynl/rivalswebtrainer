# Multiplayer, larger Arena and Flamethrower

## Playing

```sh
npm ci
npm run dev -- --port 5173
```

Development now starts **both Vite and the match server**. Open the game on port **5173**, choose **Multiplayer**, enter a name, and create a public/private lobby. Friends on the **same deployed origin** can use the public browser or a six-character invite code/link. Pick teams and four weapons, ready up, then let the host start an equal **1v1, 2v2 or 3v3**. First to five rounds wins.

Online maps: **Concrete Arena, Foundry and Courtyard**. All five maps, all 26 weapons, and offline bot/range sessions remain available offline. Online players are actual humans, not replacement bots. There is no global matchmaking service shared across unrelated deployments.

After a server-started match opens, click **Back to the arena** to capture the mouse. A server message is not a browser user gesture; online startup therefore does not attempt a permission-sensitive automatic pointer capture. Escape only releases/pauses your own input: the online match continues.

**M** works during the five-second online countdown. A picker opened then may finish after FIGHT; the server keeps that player stationary while everyone else continues. It does not refresh an unchanged slot's ammo or reset health. You cannot open a new picker after FIGHT.

Hosts can return a finished match to its lobby for another round of team/loadout selection. Host ownership migrates when someone leaves. A team losing all its members forfeits the match. Disconnected players do not remain shootable server-side.

## Network design

- `@geckos.io/client` and optional `@geckos.io/server` **3.1.0** use WebRTC data channels. Lobby/control/combat events use geckos reliability; snapshots use **unreliable raw binary** messages, so old position updates do not hold newer ones behind retransmission.
- A **same-origin WebSocket** path at `/api/live` automatically takes over if native WebRTC is unavailable or UDP negotiation fails. The preview exposes HTTP/TCP, not public UDP ports, so this is the working preview transport. The UI says which transport is active; it never labels WebSocket traffic as UDP.
- WebRTC negotiation has a four-second bound, and HTTP/WebSocket attempts also time out. Offline training never requires the multiplayer service.
- Server simulation: **120 fixed steps/second**, absolute snapshots at **20 Hz**, client input at **30 Hz**, plus immediate discrete input edges. Press/release/slot/jump/slide/ability/reload actions carry monotonic IDs and are redundantly resent until acknowledged. A quick click survives a lost press-state packet without bypassing fire-rate checks.
- Ordinary 3v3 position/state frames are **587 bytes**, including the match nonce. Names and identity arrive with reliable match setup, not every frame. Positions remain float32; angles, velocity, health and timers use bounded fixed-point fields. Frame lengths, versions, player indices and loadouts are checked on decode. Projectile/zone records are bounded.
- Local controls predict movement and presentation immediately. Confirmed state corrects that prediction smoothly; large errors snap back. Remote players use a **75 ms interpolation buffer**, shortest-arc yaw and at most **50 ms extrapolation** during a missing update.
- The server measures RTT with its own nonce challenge. Hitscan queries can rewind recent enemy positions by half that RTT plus the interpolation delay, **capped at 180 ms**. Live health stays authoritative; historical positions are restored even if a ray query throws. This is bounded lag compensation, not a complete rollback implementation.
- Rooms have monotonically increasing revisions, memberships have epochs, and matches have independent nonces. Reordered reliable messages cannot resurrect a left lobby or apply a previous match's frames to the next match.
- Stale controls neutralize after **200 ms**. Heartbeats detect lost connections; slow WebSocket consumers have a bounded send buffer. Names, loadouts, map/team choices and input numbers are validated; rooms, connections, teams, payloads, projectile counts and message rates are capped. Arbitrary client position, health, damage and score fields have no effect.

### Authority and rendering

`server/match.js` reuses the actual `Game` movement, firing, melee, reload, projectile, ability and collision methods in headless contexts. Each human has their own timers/ammunition. Damage and rounds belong to the room; the client does not submit hits or kills. The server does not create viewmodels, particles, lighting or decorative payload meshes.

`server/world.js` uses the same authored Arena/court definitions and the same concrete/window/ramp primitives (including rounded line-of-fire geometry). `src/elevation-layout.js` owns the new upper-level pieces for both sides. A browser regression compares all collision records and 300 line-of-fire rays across the three online maps to catch drift.

Slot switching shares the offline reset path, so a bow charge, heal or Katana guard cannot leak into another weapon; ordered actions in one packet use the newly equipped slot. Authoritative explosive-jump impulses are delivered reliably, applied once, bound to their round, and age-adjusted for gravity on the predicting client.

Remote players render the actual held weapon/utility, articulated poses, firing cues and spatial sound. Grenade, bottle, smoke and flash payloads retain their detailed meshes, tumble, release timing, and server-confirmed fire/smoke zones. Rockets and arrows also share the offline cylindrical payload/arrowhead models instead of online placeholder spheres. Hit numbers and eliminations are confirmed by server events, not a client ray guess.

## Hosting

For a same-origin production site/API:

```sh
npm ci
npm run build
ORIGINS=https://game.example.com PORT=3001 npm start
```

`npm start` serves `dist` and the API on `0.0.0.0:3001`. Put it behind HTTPS and configure reverse-proxy connection/request rate limits for a public deployment. Forward WebSocket Upgrade headers and the `/.wrtc/` signalling paths through your reverse proxy, without rewriting their paths. `ORIGINS` accepts a comma-separated list of exact allowed site origins. Its default permits local development and Arena preview hosts, **not arbitrary production domains**.

For geckos/WebRTC:

1. Install optional dependencies successfully: `npm ls @geckos.io/server node-datachannel` must show both packages. `node-datachannel` needs its platform-native binary (or a supported native build environment). An optional install can exit successfully while omitting the native server; check it rather than assuming it installed.
2. Expose **UDP 10000–10100** from the actual game server. A TCP-only reverse proxy is not enough. Use an Internet-reachable server/interface and correct NAT/firewall/container port mappings.
3. Native geckos is enabled automatically when available. Set `GECKOS=0` to deliberately run WebSocket only. `GET /api/health` reports the actual capabilities.
4. Where NAT traversal is required, configure ICE servers, for example `ICE_SERVERS='[{"urls":"stun:stun.example.com:3478"}]'`. Native geckos consumes these on the server. Reachability still depends on the hosting network; not every proxy/NAT can carry WebRTC.

The sandbox could not download the native release binary from GitHub's release-asset host. **End-to-end browser testing here uses WebSocket.** The geckos channel API boundary is covered by a mock-native adapter test; real Internet UDP delivery has **not** been validated here. A UDP-capable deployment is required to validate that path end to end. No public server has been provisioned.

The service keeps lobbies in memory. Restarting it ends current rooms; multiple independent instances do not share rooms. This is not an account system, ranked matchmaking, a production anti-cheat guarantee or an automatically scaled hosting service.

Production service workers cache game assets for offline training, but explicitly **do not cache `/api/` or `/.wrtc/` responses**. Online play still requires a connection. `npm run preview` is an asset-preview server; run `npm run server` alongside it if using that command for online testing.

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

Commands:

```sh
npm test
npm run build
npm run test:browser
node scripts/network-audit.mjs
```

A separate seeded 30-second simulated 3v3 regression introduces **25% input/snapshot loss, 0–150 ms one-way delivery jitter, duplicated packets and reordering**, checking finite/occupiable authority, bounded interpolation history and idempotent jump edges. This is a synthetic resilience test, not an observed Internet latency result.

The deterministic server audit runs three **simulated one-minute 3v3 fights**, not a one-hour wall-clock soak. It checks finite/occupiable live bodies on every step, frame sizes, and server step timing. This is neither a GPU FPS benchmark nor a real Internet latency measurement. Final counts and the actual work interval are recorded in `multiplayer-hour-progress.md` after validation.

No networked FPS can promise zero lag: RTT, jitter, packet loss, server load, the client's GPU and browser pointer-lock behavior still matter.

### Secondary roster update

Protocol negotiation is now version **2**. Client, server health and development-server reuse check share the same constant. New weapon IDs append to the old roster rather than renumbering old weapons. A spare player-flags bit carries the active dual-pistol barrel, so a standard 3v3 binary frame remains 587 bytes. Deploy client and server together; an older client receives the existing version-mismatch/reload message. All six secondary choices use the same server-side ammunition, timing, damage and loadout validation as primaries.

## HTML returned instead of multiplayer JSON

If `/api/health` returns `<!doctype html>` with HTTP 200, it is reaching an HTML page/SPA fallback instead of the match API. The client now explains that routing/hosting problem instead of exposing `Unexpected token '<'`. It sends `Accept: application/json`, avoids the cache, and RETRY reconnects normally once routing is restored.

- **Development:** `npm run dev` starts Vite and the match server. Open port 5173.
- **Built preview:** `npm run build && npm run preview` now starts **both** the built frontend (4173 by default) and match server (3001). Previously preview started only Vite and relied on a separately running backend.
- **Deployment:** use the Node `npm start` service described above, or forward `/api/*` and WebSocket Upgrade requests to it. Do not rewrite API routes to `index.html`. A static-only host supports offline training, not a live multiplayer server. Keep `ORIGINS` configured for the actual production origin.
- A working `/api/health` returns JSON containing `protocol`, `websocket`, and `geckos`. Unknown `/api` routes now return JSON 404s, including when the same Node process serves the production SPA.

Validation: standalone preview was started without any separate dev/backend process; proxied health returned JSON and `/api/live` completed a real WebSocket `hello` handshake. A browser test simulates the exact HTTP-200 HTML response, verifies the useful error, restores the API, and reconnects via RETRY. This does not provision a backend for an unrelated static site: that site's URL/configuration is needed to diagnose its routing.

Final combined validation: **334/334 unit tests** and **14/14 targeted browser regressions** passed, including HTML-error recovery, two actual online clients, production offline reload and animation regressions. The 5173 live-preview health endpoint was rechecked and returns valid JSON. The user's separate URL, if any, was not supplied or independently diagnosed.
