# Knife, Sniper and remote weapon animation pass

The requested initial push was verified first at `f5e89fa`, before changing animations.

## Knife

- F now uses an independent reverse-grip overhand drive, rather than the previous forward poke. The blade points down and forward at contact. A normal left-click against a visible nearby rear-facing target selects this pose too; ordinary front/side slashes still alternate directions.
- The drive reaches contact at the existing **105 ms** melee hit check. Lift, strike, withdrawal and reset are separate phases; the hand/knife rotate around a real grip pivot. The support hand braces independently. Screenshot inspection caught the sleeve flipping with the dagger; wrist/forearm counter-rotation now keeps the forearm extending back toward the camera.
- Stabs do not draw a misleading sweeping slash arc. Cached quick models reset the rig and sleeve on reuse.
- Animation never grants rear damage: front/side remains **40**, rear **150**, validated at impact using the original facing/LOS/range rule. F retains the current gun and ammo. Normal rear poses can change if the opponent turns before impact; the server remains damage authority.
- Remote humans receive the stab style; Knife bots select the rear pose using their current target's facing.

## Sniper and remote handling

- An opponent holding Sniper ADS shows a **white core/halo/star scope glint** at the front objective lens. This is a directional forward cone, not an omnidirectional lamp. It is depth tested, so opaque cover blocks it.
- No glint in the local viewmodel or for hip fire, death, reload, quick utility, quick melee, healing or guard. The glow has a restrained pulse and distance-scaled size. No external texture download or point light is involved.
- ADS and Knife pose use spare bits in the existing player flags. Protocol/grammar and ordinary **587-byte 3v3 snapshots** are unchanged.
- Sniper has a separately pivoted bolt handle: lift, pull, push, lock. The firing interval and ADS visibility rules are unchanged. The firing hand follows the cycle.
- Third-person slides and magazines now animate; remote reload time reaches the actor rig. Remote shot ages are derived from server shot/snapshot times and advanced locally, rather than comparing unrelated client/server clocks.

## Validation

- Core animation changes: **325/325 Node tests passed**, including eight new grip, impact, damage, packet, glint visibility and bolt scenarios.
- **12/12 targeted Chromium checks passed** in 2.9 minutes: actual reverse-grip render and projected grip bounds, real white-glint framebuffer pixels and opaque-cover occlusion, online ADS round-trip through two clients, all five G utilities, smoke, Bow and explosive-to-F/26-weapon regressions.
- Production build passed. Existing shared UI-chunk warning remains.
- Follow-up retained remote Flamethrower heat feedback while using nonzero network shot ages; combined animation/health unit suite: **334/334 passed**.
- The first glint framebuffer check caught an insufficiently visible core at test resolution; the procedural white core/size was tuned and the full targeted set rerun successfully.
- Actual contact screenshot inspected, including the corrected sleeve direction. Browser tests use software WebGL, not a hardware-FPS guarantee.

Final combined validation after the connection/startup changes: **334/334 Node tests**, **14/14 targeted browser checks (3.5 minutes)**, and production build passed. This includes the HTML-health fallback/retry and disconnected production reload as well as the animation checks above.
