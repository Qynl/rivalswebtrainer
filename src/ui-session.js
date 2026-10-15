import { BOW_DRAW_TIME } from "./combat-rules.js";
import { createStore } from "./ui-store.js";
import { loadEnvironment } from "./environment.js";
import { DEFAULT_SETTINGS, WEAPONS, MAPS, loadSaved, save } from "./data.js";
import {
  DamageCompass,
  HitConfirmation,
  reticleGap,
} from "./combat-feedback.js";
const saved = loadSaved("rivals-settings", {});
const settings = { ...DEFAULT_SETTINGS };
for (const [key, min, max] of [
  ["sensitivity", 0.3, 3],
  ["fov", 70, 110],
  ["volume", 0, 100],
])
  if (Number.isFinite(saved[key]))
    settings[key] = Math.max(min, Math.min(max, saved[key]));
for (const key of ["showFps", "shake", "dynamicFov", "performance"])
  if (typeof saved[key] === "boolean") settings[key] = saved[key];
const stored = loadSaved("rivals-loadout", []);
export const ui = createStore({
  ready: false,
  error: "",
  tab: "play",
  mode: 1,
  difficulty: "regular",
  mapIndex: 0,
  slotIndex: 0,
  loadout: ["rifle", "pistol", "fists", "grenade"].map((id, i) =>
    WEAPONS[stored[i]]?.slot === i ? stored[i] : id,
  ),
  settings,
  screen: "lobby",
  paused: false,
  settingsOpen: false,
  setup: null,
  step: 0,
  draft: [],
  toast: "",
  result: null,
});
export const hud = createStore({
  slots: [],
  team: [],
  feed: [],
  numbers: [],
  health: 150,
  score: [0, 0],
  marker: "",
  markerOpacity: 0,
  arcs: [],
  banner: null,
  fps: 0,
});
export let game;
const compass = new DamageCompass(),
  confirmation = new HitConfirmation();
let markerTimer,
  bannerTimer,
  toastTimer,
  hurtTimer,
  feedbackClock = 0,
  lastHud = -Infinity,
  feedId = 0;
export const weaponLabel = (w) =>
  w.spin
    ? "Spin-up automatic"
    : w.type === "bow"
      ? "Charge / double jump"
      : w.type === "heal"
        ? "Long / quick heal"
        : w.type === "launcher"
          ? "Arcing explosives"
          : w.type === "flame"
            ? "Cone / afterburn"
            : w.type === "flashbang"
              ? "Blinds opponents"
              : w.type === "auto"
                ? "Automatic"
                : w.type === "semi"
                  ? "Semi-automatic"
                  : w.dash
                    ? "Dash ability"
                    : w.deflect
                      ? "Bullet deflection"
                      : w.doubleJump
                        ? "Double jump"
                        : w.type === "melee"
                          ? "Melee"
                          : w.slot === 3
                            ? "Throwable utility"
                            : "Primary weapon";
export function toast(message) {
  clearTimeout(toastTimer);
  ui.set({ toast: message });
  toastTimer = setTimeout(() => ui.set({ toast: "" }), 5000);
}
function resetMarker() {
  clearTimeout(markerTimer);
  confirmation.clear();
  hud.set({ marker: "", markerOpacity: 0 }, true);
}
function hit(head = false, elimination = false) {
  if (confirmation.add(head, elimination, performance.now()) === false) return;
  hud.set(
    {
      marker: ["", "body", "head", "elimination"][confirmation.kind],
      markerOpacity: 1,
      markerPulse: (hud.get().markerPulse || 0) + 1,
    },
    true,
  );
  clearTimeout(markerTimer);
  markerTimer = setTimeout(
    resetMarker,
    Math.max(0, confirmation.until - performance.now()),
  );
}
function snapshot(g, force = false) {
  if (!g.player) return;
  if (!force && performance.now() - lastHud < 16) return;
  lastHud = performance.now();
  const p = g.player,
    w = WEAPONS[g.loadout[g.slot]],
    a = g.ammunition[g.slot],
    melee = WEAPONS[g.loadout[2]],
    secs = Math.max(0, Math.ceil(g.roundTime));
  const scoped = g.aiming && g.loadout[g.slot] === "sniper",
    dt = Math.max(0, g.clock - feedbackClock);
  feedbackClock = g.clock;
  const action =
    g.healTime > 0
      ? "HEALING " + g.healTime.toFixed(1) + "s"
      : g.bowCharge > 0
        ? "DRAW " + Math.round((g.bowCharge / BOW_DRAW_TIME) * 100) + "%"
        : w.spin && g.spinTime > 0 && g.spinTime < 0.55
          ? "SPINNING UP"
          : g.reloadTime > 0
            ? "RELOADING"
            : "";
  hud.set({
    health: Math.ceil(p.health),
    maxHealth: p.maxHealth || 150,
    slots: g.loadout,
    slot: g.slot,
    team: g.entities
      .filter((e) => e.team === p.team)
      .map((e) => ({
        name: e.name,
        health: Math.ceil(e.health),
        alive: e.alive,
      })),
    weapon: w.name.toUpperCase(),
    ammo: Number.isFinite(a.mag) ? a.mag : "∞",
    reserve: g.range || !Number.isFinite(a.reserve) ? "∞" : a.reserve,
    hint:
      w.type === "melee"
        ? w.doubleJump
          ? "DOUBLE JUMP ENABLED"
          : w.dash
            ? "RMB / F TO DASH"
            : w.deflect
              ? "RMB / F TO DEFLECT"
              : g.loadout[2] === "knife"
                ? "F QUICK STAB · REAR = 150"
                : "GET CLOSE"
        : g.reloadTime > 0
          ? "RELOADING"
          : a.mag === 0
            ? a.reserve > 0
              ? "R TO RELOAD"
              : "OUT OF AMMO"
            : w.type === "heal"
              ? "LMB HEAL · RMB QUICK HEAL"
              : w.type === "bow"
                ? "HOLD LMB · RELEASE TO FIRE"
                : w.slot === 3
                  ? "LMB TO THROW"
                  : "R TO RELOAD",
    timer: g.range
      ? "∞"
      : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`,
    bowDraw:
      w.type === "bow" ? Math.min(1, (g.bowCharge || 0) / BOW_DRAW_TIME) : null,
    scoped,
    crosshair: p.alive && !scoped,
    gap:
      reticleGap(w, p.grounded, g.aiming, innerHeight, g.camera.fov) +
      Math.min(3, g.kick * 12),
    arcs: compass.update(dt, p, g.yaw).map((s) => ({
      ...s,
      opacity: p.alive ? Math.min(1, s.life / 0.22) * s.strength : 0,
    })),
    ability:
      melee.dash || melee.deflect || g.loadout[2] === "knife"
        ? {
            name:
              g.guardFlash > 0
                ? "BULLET REFLECTED"
                : melee.deflect && g.deflectTime > 0
                  ? "DEFLECTING"
                  : melee.dash
                    ? "SCYTHE DASH"
                    : g.loadout[2] === "knife"
                      ? "KNIFE QUICK STAB"
                      : "KATANA DEFLECT",
            cooldown: melee.deflect
              ? g.deflectCooldown
              : melee.dash
                ? g.dashCooldown
                : g.knifeQuickCooldown || 0,
            active: melee.deflect && g.deflectTime > 0,
            time: g.deflectTime,
          }
        : null,
    guard: g.deflectTime > 0,
    flash: Math.min(1, (g.blindTime || 0) / 1.4),
    paint: Math.min(0.7, g.paintTintTime || 0),
    action,
    stats: { ...g.matchStats },
    range: g.range,
    map: g.range
      ? "PRACTICE RANGE"
      : MAPS.find((m) => m.id === g.config.map)?.short,
    numbers:
      g.damageNumbers?.project(
        g.camera,
        innerWidth,
        innerHeight,
        g.clock,
        g.world,
        g.hasLOS.bind(g),
        g.eye(p),
      ) || [],
    canSelect: g.state === "countdown",
    countdown: Math.max(0, Math.ceil(g.countdown || 0)),
  });
}
export const events = {
  deferWarmup: true,
  toast,
  start() {
    ui.set({
      screen: "game",
      paused: false,
      settingsOpen: false,
      result: null,
    });
    hud.set({ flash: 0, paint: 0 });
  },
  round(n, score, range) {
    if (game?.network) ui.set({ setup: null });
    hud.set({
      round: range ? "PRACTICE" : "ROUND " + n,
      score: [...score],
      range,
    });
  },
  update: (g) => snapshot(g, true),
  tick: (g) => snapshot(g),
  banner(eyebrow, title, subtitle, duration) {
    clearTimeout(bannerTimer);
    hud.set({ banner: { eyebrow, title, subtitle } });
    if (duration)
      bannerTimer = setTimeout(
        () => hud.set({ banner: null }),
        duration * 1000,
      );
  },
  fps: (n) => hud.set({ fps: n }),
  pause: (on) => {
    if (on) {
      compass.clear();
      game?.audio.clearSpatial?.();
    }
    ui.set({ paused: on, settingsOpen: false });
    if (on) hud.set({ flash: 0, paint: 0, arcs: [] });
  },
  lobby() {
    resetMarker();
    compass.clear();
    game?.audio.clearSpatial?.();
    clearTimeout(bannerTimer);
    ui.set({
      screen: "lobby",
      tab: "play",
      paused: false,
      settingsOpen: false,
      setup: null,
    });
    hud.set({
      flash: 0,
      paint: 0,
      banner: null,
      arcs: [],
      scoped: false,
      numbers: [],
    });
  },
  hit,
  confirmKill: (head) => hit(head, true),
  hurt(source, amount) {
    if (game.player) compass.add(game.player, source, amount, game.yaw);
    clearTimeout(hurtTimer);
    hud.set({ hurt: 1 });
    hurtTimer = setTimeout(() => hud.set({ hurt: 0 }), 280);
  },
  kill(killer, victim, head) {
    const id = ++feedId;
    hud.set({
      feed: [{ id, killer, victim, head }, ...hud.get().feed].slice(0, 5),
    });
    setTimeout(
      () => hud.set({ feed: hud.get().feed.filter((r) => r.id !== id) }),
      6000,
    );
  },
  feedClear() {
    compass.clear();
    feedbackClock = game?.clock || 0;
    hud.set({ feed: [], hurt: 0, arcs: [], numbers: [] });
    resetMarker();
  },
  results(g) {
    clearTimeout(bannerTimer);
    const team = g.network ? g.player.team : 0;
    const won = g.score[team] > g.score[1 - team],
      stats = { ...g.matchStats };
    ui.set({
      screen: "results",
      result: { won, score: [...g.score], stats, config: { ...g.config } },
      setup: null,
    });
    const history = loadSaved("rivals-history", []);
    save(
      "rivals-history",
      [
        {
          won,
          score: g.score,
          stats,
          date: new Date().toISOString(),
          difficulty: g.config.difficulty,
        },
        ...(Array.isArray(history) ? history : []),
      ].slice(0, 20),
    );
  },
  selectWeapons() {
    actions.openSetup({ ...game.config }, true);
  },
};
let bootPromise;
// Fast Refresh can remount the React effect: never duplicate the engine's
// pointer listeners or animation loop on the same persistent canvas.
export function boot(canvas) {
  return (bootPromise ||= initializeGame(canvas));
}
async function initializeGame(canvas) {
  try {
    const [{ Game }, environmentData] = await Promise.all([
      import("./game.js"),
      new URLSearchParams(location.search).has("rebuild-environment")
        ? Promise.resolve(null)
        : loadEnvironment(),
    ]);
    events.environmentData = environmentData;
    game = new Game(canvas, ui.get().settings, events);
    await game.prepare();
    window.__arena = game;
    performance.mark("arena-ready");
    ui.set({ ready: true });
  } catch (error) {
    console.error(error);
    ui.set({
      error:
        "WebGL initialization failed. Try a desktop browser with hardware acceleration.",
    });
    toast(
      "Your browser needs WebGL to run the arena. Try a desktop browser with hardware acceleration.",
    );
  }
}
export const actions = {
  tab: (tab) => ui.set({ tab }),
  map() {
    const mapIndex = (ui.get().mapIndex + 1) % MAPS.length;
    ui.set({ mapIndex });
    game?.preview(MAPS[mapIndex].id);
  },
  choose(id) {
    const s = ui.get();
    if (s.setup) {
      const draft = [...s.draft];
      draft[s.step] = id;
      ui.set({ draft });
    } else {
      const loadout = [...s.loadout];
      loadout[s.slotIndex] = id;
      ui.set({ loadout });
      save("rivals-loadout", loadout);
    }
    game?.audio.play("switch");
  },
  openSetup(config, round = false) {
    if (!game) return;
    const s = ui.get();
    ui.set({
      setup: config || {
        map: MAPS[s.mapIndex].id,
        mode: s.mode,
        difficulty: s.difficulty,
        range: false,
      },
      draft: [...(round ? game.loadout : s.loadout)],
      step: 0,
      roundSetup: round,
    });
  },
  closeSetup() {
    const round = ui.get().roundSetup;
    ui.set({ setup: null });
    if (round) game.finishSelection();
  },
  next() {
    const s = ui.get();
    if (s.step < 3) return ui.set({ step: s.step + 1 });
    const loadout = [...s.draft];
    save("rivals-loadout", loadout);
    ui.set({ loadout, setup: null });
    if (s.roundSetup) game.finishSelection(loadout);
    else game.start({ ...s.setup, loadout });
  },
  range() {
    const s = ui.get();
    if (!game) return;
    if (!("requestPointerLock" in game.canvas))
      return toast("Playing requires a desktop mouse and keyboard.");
    game.start({
      map: MAPS[s.mapIndex].id,
      mode: s.mode,
      difficulty: s.difficulty,
      range: true,
      loadout: [...s.loadout],
    });
  },
  setting(key, value) {
    const settings = { ...ui.get().settings, [key]: value };
    ui.set({ settings });
    save("rivals-settings", settings);
    game?.setSettings(settings);
  },
  settings(paused = false) {
    ui.set({ settingsOpen: true, settingsFromPause: paused, paused: false });
  },
  closeSettings() {
    ui.set({ settingsOpen: false, paused: !!ui.get().settingsFromPause });
  },
};

export async function startOnlineMatch(client, map, snapshot) {
  const engine = game;
  if (!engine) throw Error("Game is still loading");
  const { MultiplayerSession } = await import("./net/session.js");
  if (!client.connection || client.activeMatchId !== snapshot.matchId)
    throw Error("Match is no longer active");
  const session = new MultiplayerSession(engine, client, map, snapshot);
  ui.set({
    screen: "game",
    setup: null,
    paused: engine.state === "paused",
    result: null,
  });
  return session;
}

export function backToLobby() {
  game?.quit();
}
