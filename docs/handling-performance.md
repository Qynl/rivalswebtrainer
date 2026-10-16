# Weapon handling and presentation performance

This pass preserves the calmer 8/9.2 run speeds, 1.01-unit jump, short slides, stable mouse aim, authoritative damage/ammo and protocol-3 backend-free multiplayer. It changes presentation and removes unnecessary work, not weapon balance or hit registration.

## Handling across the arsenal

- First-person reloads now add weapon-family-specific cant, support-hand reach, wrist turn and a short magazine seating impulse. Tube-fed guns get a small repeated loading-hand motion, heavy weapons a wider reach, and the Revolver a different wrist posture. These are cosmetic motions, not per-shell inventory changes or new reload rules.
- Remote guns use the same `reloadPose` phases and `reloadHandling` profiles instead of a separate sine-wave magazine motion. Dual magazines, Revolver cylinder opening and bolt return are represented. Support-hand IK follows the reload reach and the gun's cosmetic cant.
- Cancelling or finishing a reload restores moving parts to their authored rest positions. Existing Bow limb orientation, ADS calibration, Sniper bolt cycle, quick Knife and G utility handling remain intact.
- Release, seat and ready sounds follow actual simulation progress. The old unconditional 240 ms reload callback is gone: switching/cancelling cannot leave that stale sound scheduled. Late first snapshots do not replay all earlier cues, and minor backwards snapshot corrections do not repeat a cue. Reload duration and reserve accounting are unchanged.

## Firing identity

Fifteen muzzle profiles distinguish compact pistols/SMGs, broad Shotgun blasts, a longer Sniper gas jet, warm Revolver flashes and muted cyan Paintball gas. Existing crown geometry is reused: profiles vary its width, depth, lifetime and colour rather than adding new per-shot meshes or lights. Shot-seeded variation and short decay replace unrelated per-frame rotation/flicker. Local and remote presentation share the helper; projectile and tracer origins are unchanged.

The same 48-instance casing pool now distinguishes shorter pistol cases, larger Sniper brass and red Shotgun hulls. Per-instance colour and size live in persistent buffers; cover/ramp collision and bounded lifetimes remain enabled. Revolver firing no longer ejects a case on every shot. No projectile, ammo, damage or self-launch rules change.

## Less main-thread churn

- `aimArm` owns a reusable workspace through a WeakMap keyed by the arm. Vectors, inverse quaternion and direction calculations are reused after warmup; standalone `solveTwoBone` still returns independent outputs unless explicitly given a workspace. Bone lengths/reach and elbow-side behaviour are preserved.
- Character hand targets also reuse two actor-owned vectors. The independent sinusoidal reload-hand offset is removed in favour of the actual weapon reload pose.
- The external UI store only publishes changed properties. The HUD additionally structurally shares small flat records and arrays, retaining references for unchanged team members, slots and stats. Equality is bounded by depth/record size, rejects non-plain records and handles array lengths; it is not an unbounded deep comparison. Real changes such as HP, hit-marker pulses, cooldowns, damage numbers and ammo still notify immediately.
- Controlled measurements: **600 identical store updates produced zero notifications**; the actual browser HUD similarly produced **zero notifications for 120 identical forced samples**. A warmed **2,000-pose arm test** rejects any vector/quaternion cloning while checking exact bone lengths. These establish removed work, not a hardware FPS or Internet-latency guarantee.

## Validation

New regressions cover all 17 gun reloads, part reset/cancellation, unchanged weapon stats, local/remote reload phase agreement, deterministic muzzle decay/expiry, persistent casing buffers, raised-cover collision, HUD sharing/immutability, clone-free IK, actual fixed-step reload completion/reserve accounting and timer-free mechanism audio. A new rendered-browser case checks all 17 guns, rest restoration, unchanged yaw/pitch and idle HUD notifications.

Final counts are recorded in the repository README after the broad regression run. Public PeerJS Cloud/NAT availability and independently hosted-site republishing are not established by local browser tests.

Completed checks: **502/502 unit tests**, **25/25 targeted browser scenarios**
(9.3 minutes), production build, formatting and whitespace checks. After removing
an unused legacy hand-pose calculation, all units/build were repeated, followed
by **3/3 clean-build browser checks** for firing, full-arsenal reload rendering and
adverse-network RTC movement. In that final RTC run, host/guest travel measured
**25.416 / 25.233 units**, with zero backward correction steps and both actions
acknowledged. The test deliberately disables rendering to isolate transport;
separate browser tests perform actual world/weapon renders. The real HUD test
also confirmed zero redundant updates and unchanged yaw/pitch. These are local
controlled regressions, not a GPU frame-rate or arbitrary-network guarantee.
