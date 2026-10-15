import { DamageCompass, reticleGap } from "./combat-feedback.js";
import "./style.css";
import { WeaponPreview } from "./weapon-preview.js";
import { Game } from "./game.js";
import {
  WEAPONS,
  MAPS,
  SLOT_NAMES,
  DEFAULT_SETTINGS,
  weaponIcon,
  loadSaved,
  save,
} from "./data.js";
const $ = (id) => document.getElementById(id),
  show = (id, on) => $(id).classList.toggle("hidden", !on);
const damageCompass = new DamageCompass();
let feedbackClock = 0;
const damageArcs = Array.from({ length: 4 }, () => {
  const arc = document.createElement("div");
  arc.className = "damage-arc";
  arc.innerHTML =
    '<svg viewBox="-90 -90 180 180"><path d="M -24 -67 Q 0 -81 24 -67"/></svg>';
  document.getElementById("damage-directions").append(arc);
  return arc;
});
const savedSettings = loadSaved("rivals-settings", {});
const settings = { ...DEFAULT_SETTINGS };
for (const key of ["sensitivity", "fov", "volume"])
  if (Number.isFinite(savedSettings[key])) settings[key] = savedSettings[key];
settings.sensitivity = Math.max(0.3, Math.min(3, settings.sensitivity));
settings.fov = Math.max(70, Math.min(110, settings.fov));
settings.volume = Math.max(0, Math.min(100, settings.volume));
for (const key of ["showFps", "shake", "dynamicFov", "performance"])
  if (typeof savedSettings[key] === "boolean")
    settings[key] = savedSettings[key];
const storedLoadout = loadSaved("rivals-loadout", []),
  loadout = ["rifle", "pistol", "fists", "grenade"].map((id, i) =>
    WEAPONS[storedLoadout[i]]?.slot === i ? storedLoadout[i] : id,
  );
let mode = 1,
  difficulty = "regular",
  mapIndex = 0,
  slotIndex = 0,
  game,
  bannerTimeout,
  toastTimeout,
  hitTimeout,
  hurtTimeout,
  currentTab = "play",
  settingsFromPause = false;
function toast(message) {
  $("toast").textContent = message;
  show("toast", true);
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => show("toast", false), 5000);
}
function switchTab(tab) {
  currentTab = tab;
  for (const id of ["play", "loadout", "guide"]) show(id + "-tab", id === tab);
  document
    .querySelectorAll("[data-tab]")
    .forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  $("lobby").scrollTop = 0;
  if (tab === "loadout") renderLoadout();
}
function renderMini() {
  $("loadout-mini").innerHTML = loadout
    .map((id) => `<span title="${WEAPONS[id].name}">${weaponIcon(id)}</span>`)
    .join("");
}
function renderLoadout() {
  $("slot-tabs").innerHTML = SLOT_NAMES.map(
    (name, i) =>
      `<button class="slot-tab ${slotIndex === i ? "selected" : ""}" data-slot="${i}"><span>0${i + 1} / ${name}</span><small>${WEAPONS[loadout[i]].name}</small></button>`,
  ).join("");
  $("weapon-grid").innerHTML = Object.entries(WEAPONS)
    .filter(([, w]) => w.slot === slotIndex)
    .map(
      ([id, w]) =>
        `<button class="weapon-card ${loadout[slotIndex] === id ? "selected" : ""}" data-weapon="${id}">${loadout[slotIndex] === id ? '<span class="equipped-badge">✓ EQUIPPED</span>' : ""}${weaponIcon(id)}<strong>${w.name.toUpperCase()}</strong><small>${weaponLabel(w)}</small></button>`,
    )
    .join("");
  const id = loadout[slotIndex],
    w = WEAPONS[id];
  $("weapon-detail").innerHTML =
    `<span class="eyebrow">${SLOT_NAMES[slotIndex]} / EQUIPPED</span>${weaponIcon(id)}<h2>${w.name}</h2><p>${w.desc}</p>${["DAMAGE", "RANGE", "FIRE RATE"].map((name, i) => `<div class="stat-row"><span>${name}</span><span class="stat-bar">${Array.from({ length: 10 }, (_, n) => `<i class="${n < w.stats[i] ? "filled" : ""}"></i>`).join("")}</span></div>`).join("")}<div class="stat-row"><span>MAGAZINE</span><span>${Number.isFinite(w.mag) ? w.mag : "∞"}</span></div>`;
}
function renderHudSlots() {
  $("hud-slots").innerHTML = game.loadout
    .map(
      (id, i) =>
        `<div class="hud-slot ${game.slot === i ? "selected" : ""}"><span>${i + 1}</span>${weaponIcon(id)}<small>${WEAPONS[id].name.toUpperCase()}</small></div>`,
    )
    .join("");
}
function updateHud(g) {
  if (!g.player) return;
  const w = WEAPONS[g.loadout[g.slot]],
    a = g.ammunition[g.slot];
  $("health-value").textContent = Math.ceil(g.player.health);
  $("health-fill").style.width = g.player.health + "%";
  $("health-fill").style.background =
    g.player.health < 30 ? "#ff754f" : "#b7f9dc";
  $("weapon-name").textContent = w.name.toUpperCase();
  $("ammo-value").textContent = Number.isFinite(a.mag) ? a.mag : "∞";
  $("reserve-value").textContent =
    g.range || !Number.isFinite(a.reserve) ? "∞" : a.reserve;
  $("ammo-hint").textContent =
    w.type === "melee"
      ? w.doubleJump
        ? "DOUBLE JUMP ENABLED"
        : w.dash
          ? "RMB / F TO DASH"
          : w.deflect
            ? "RMB / F TO DEFLECT"
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
                : "R TO RELOAD";
  show("reload-indicator", g.reloadTime > 0);
  renderHudSlots();
  $("team-status").innerHTML = g.entities
    .filter((e) => e.team === 0)
    .map(
      (e) =>
        `<div class="team-member ${e.alive ? "" : "dead"}"><i></i>${e.name} <span>${e.alive ? Math.ceil(e.health) + " HP" : "ELIMINATED"}</span></div>`,
    )
    .join("");
  if (g.range) {
    const s = g.matchStats;
    $("range-stats").innerHTML =
      `<div><strong>${s.shots}</strong><span>SHOTS</span></div><div><strong>${Math.min(100, Math.round((s.hits / Math.max(1, s.shots)) * 100))}%</strong><span>ACCURACY</span></div><div><strong>${s.kills}</strong><span>ELIMINATIONS</span></div>`;
  }
}
const scope = document.createElement("div");
scope.id = "scope";
scope.className = "hidden";
$("hud").appendChild(scope);
const abilityStatus = document.createElement("div");
abilityStatus.id = "ability-status";
abilityStatus.className = "hidden";
$("hud").appendChild(abilityStatus);
const guardOverlay = document.createElement("div");
guardOverlay.id = "guard-overlay";
guardOverlay.className = "hidden";
$("hud").appendChild(guardOverlay);
const events = {
  toast,
  start() {
    show("flash-overlay", false);
    show("paint-overlay", false);
    show("lobby", false);
    show("hud", true);
    show("results", false);
    show("pause", false);
    $("hud-map").textContent = game.range
      ? "PRACTICE RANGE"
      : MAPS.find((m) => m.id === game.config.map).short;
    document.querySelector(".round-info small").textContent = game.range
      ? "FREE PRACTICE"
      : "FIRST TO 5";
    show("range-stats", game.range);
  },
  round(n, score, range) {
    $("round-label").textContent = range ? "PRACTICE" : "ROUND " + n;
    $("player-score").textContent = score[0];
    $("bot-score").textContent = score[1];
  },
  update: updateHud,
  banner(eyebrow, title, subtitle, duration) {
    clearTimeout(bannerTimeout);
    $("banner-eyebrow").textContent = eyebrow;
    $("banner-title").textContent = title;
    $("banner-subtitle").textContent = subtitle;
    $("banner-title").style.color =
      title.includes("LOST") || title.includes("ELIMINATED")
        ? "#ff9b83"
        : "#fff";
    show("round-banner", true);
    if (duration)
      bannerTimeout = setTimeout(
        () => show("round-banner", false),
        duration * 1000,
      );
  },
  tick(g) {
    const melee = WEAPONS[g.loadout[2]];
    const cooldown = melee.deflect ? g.deflectCooldown : g.dashCooldown;
    show("ability-status", !!(melee.dash || melee.deflect));
    if (melee.dash || melee.deflect) {
      const active = melee.deflect && g.deflectTime > 0;
      abilityStatus.classList.toggle("ready", cooldown <= 0);
      abilityStatus.classList.toggle("guarding", active);
      abilityStatus.innerHTML = `<kbd>F</kbd><span>${g.guardFlash > 0 ? "BULLET REFLECTED" : active ? "DEFLECTING" : melee.dash ? "SCYTHE DASH" : "KATANA DEFLECT"}</span><b>${active ? g.deflectTime.toFixed(1) + "s" : cooldown > 0 ? cooldown.toFixed(1) + "s" : "READY"}</b>`;
    }
    show("guard-overlay", g.deflectTime > 0);
    show("flash-overlay", g.blindTime > 0);
    $("flash-overlay").style.opacity = Math.min(1, (g.blindTime || 0) / 1.4);
    show("paint-overlay", g.paintTintTime > 0);
    $("paint-overlay").style.opacity = Math.min(0.7, g.paintTintTime || 0);
    const secs = Math.max(0, Math.ceil(g.roundTime));
    $("timer").textContent = g.range
      ? "∞"
      : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
    const scoped = g.aiming && g.loadout[g.slot] === "sniper";
    show("crosshair", g.player.alive && !scoped);
    const gap = reticleGap(
      WEAPONS[g.loadout[g.slot]],
      g.player.grounded,
      g.aiming,
      innerHeight,
      g.camera.fov,
    );
    $("crosshair").style.setProperty(
      "--reticle-gap",
      `${gap + Math.min(3, g.kick * 12)}px`,
    );
    const feedbackDt = Math.max(0, g.clock - feedbackClock);
    feedbackClock = g.clock;
    damageCompass.update(feedbackDt, g.player, g.yaw).forEach((slot, i) => {
      damageArcs[i].style.transform = `rotate(${slot.bearing}rad)`;
      damageArcs[i].style.opacity = g.player.alive
        ? Math.min(1, slot.life / 0.22) * slot.strength
        : 0;
    });
    show("scope", scoped);
    $("crosshair").style.transform = "translate(-50%,-50%)";
    show(
      "reload-indicator",
      g.reloadTime > 0 ||
        g.healTime > 0 ||
        g.bowCharge > 0 ||
        (g.loadout[g.slot] === "minigun" &&
          g.spinTime > 0 &&
          g.spinTime < 0.55),
    );
    const action =
      g.healTime > 0
        ? "HEALING " + g.healTime.toFixed(1) + "s"
        : g.bowCharge > 0
          ? "DRAW " + Math.round((g.bowCharge / 1.2) * 100) + "%"
          : g.loadout[g.slot] === "minigun" && g.spinTime < 0.55
            ? "SPINNING UP"
            : "RELOADING";
    $("reload-indicator").firstChild.textContent = action + " ";
  },
  fps(n) {
    $("fps-counter").textContent = n + " FPS";
    show("fps-counter", settings.showFps);
  },
  pause(on) {
    if (on) {
      damageCompass.clear();
      for (const arc of damageArcs) arc.style.opacity = 0;
      game?.audio.clearSpatial?.();
    }
    show("pause", on);
    if (on) {
      show("flash-overlay", false);
      show("paint-overlay", false);
    }
    show("settings", false);
  },
  lobby() {
    damageCompass.clear();
    for (const arc of damageArcs) arc.style.opacity = 0;
    game?.audio.clearSpatial?.();
    show("flash-overlay", false);
    show("paint-overlay", false);
    clearTimeout(bannerTimeout);
    show("hud", false);
    show("pause", false);
    show("settings", false);
    show("results", false);
    show("lobby", true);
    show("scope", false);
    switchTab("play");
  },
  hit(head) {
    clearTimeout(hitTimeout);
    $("hitmarker").style.color = head ? "#ffcb8f" : "white";
    $("hitmarker").classList.toggle("headshot", head);
    $("hitmarker").style.opacity = 1;
    hitTimeout = setTimeout(() => ($("hitmarker").style.opacity = 0), 160);
  },
  hurt(source, amount) {
    if (game.player) damageCompass.add(game.player, source, amount, game.yaw);
    clearTimeout(hurtTimeout);
    $("damage-vignette").style.opacity = 1;
    hurtTimeout = setTimeout(
      () => ($("damage-vignette").style.opacity = 0),
      280,
    );
  },
  kill(killer, victim, head) {
    const row = document.createElement("div");
    row.className = "kill-row";
    const b = document.createElement("b");
    b.textContent = killer;
    const i = document.createElement("i");
    i.textContent = head ? "HEADSHOT" : "ELIMINATED";
    const s = document.createElement("span");
    s.textContent = victim;
    row.append(b, i, s);
    $("kill-feed").prepend(row);
    if ($("kill-feed").children.length > 5) $("kill-feed").lastChild.remove();
    setTimeout(() => row.remove(), 6000);
  },
  feedClear() {
    damageCompass.clear();
    feedbackClock = game?.clock || 0;
    for (const arc of damageArcs) arc.style.opacity = 0;
    $("kill-feed").replaceChildren();
    $("damage-vignette").style.opacity = 0;
    $("hitmarker").style.opacity = 0;
  },
  results(g) {
    show("results", true);
    show("hud", false);
    clearTimeout(bannerTimeout);
    const win = g.score[0] > g.score[1],
      stats = g.matchStats,
      acc = Math.min(
        100,
        Math.round((stats.hits / Math.max(1, stats.shots)) * 100),
      );
    $("result-title").innerHTML =
      (win ? "VICTORY" : "NEXT TIME") + "<span>.</span>";
    $("result-eyebrow").textContent = win
      ? "THAT’S HOW IT’S DONE."
      : "THE GRIND CONTINUES.";
    $("result-score").innerHTML = `${g.score[0]} <span>—</span> ${g.score[1]}`;
    $("result-description").textContent =
      `${g.config.mode}v${g.config.mode} · ${g.config.difficulty.toUpperCase()} BOTS · ${MAPS.find((m) => m.id === g.config.map).name}`;
    $("result-stats").innerHTML =
      `<div><strong>${stats.kills}</strong><small>ELIMINATIONS</small></div><div><strong>${stats.deaths}</strong><small>DEATHS</small></div><div><strong>${acc}%</strong><small>ACCURACY</small></div>`;
    const history = loadSaved("rivals-history", []);
    save(
      "rivals-history",
      [
        {
          won: win,
          score: g.score,
          stats,
          date: new Date().toISOString(),
          difficulty: g.config.difficulty,
        },
        ...(Array.isArray(history) ? history : []),
      ].slice(0, 20),
    );
  },
};
try {
  game = new Game($("game-canvas"), settings, events);
  window.__arena = game;
} catch (error) {
  console.error(error);
  toast(
    "Your browser needs WebGL to run the arena. Try a desktop browser with hardware acceleration.",
  );
  $("play-button").disabled = true;
  $("range-button").disabled = true;
}
document
  .querySelectorAll("[data-tab]")
  .forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));
document.querySelector(".brand").addEventListener("click", (e) => {
  e.preventDefault();
  switchTab("play");
});
$("mode-options").addEventListener("click", (e) => {
  const b = e.target.closest("[data-mode]");
  if (!b) return;
  mode = +b.dataset.mode;
  $("mode-options")
    .querySelectorAll("button")
    .forEach((x) => x.classList.toggle("selected", x === b));
});
$("difficulty-options").addEventListener("click", (e) => {
  const b = e.target.closest("[data-difficulty]");
  if (!b) return;
  difficulty = b.dataset.difficulty;
  $("difficulty-options")
    .querySelectorAll("button")
    .forEach((x) => x.classList.toggle("selected", x === b));
  $("difficulty-hint").textContent = {
    rookie: "Learn the ropes",
    regular: "A fair fight",
    veteran: "No free shots",
    elite: "Bring your A-game",
  }[difficulty];
});
$("map-cycle").addEventListener("click", () => {
  mapIndex = (mapIndex + 1) % MAPS.length;
  $("map-name").textContent = MAPS[mapIndex].name;
  $("preview-name").textContent = MAPS[mapIndex].name.toUpperCase();
  game?.preview(MAPS[mapIndex].id);
});
let setupStep = 0,
  setupDraft = [],
  setupConfig = null,
  weaponPreview;
const pickNames = ["PRIMARY", "SECONDARY", "MELEE", "UTILITY"];
function weaponLabel(w) {
  return w.spin
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
}
function renderSetup() {
  $("setup-title").textContent =
    "Choose your " + pickNames[setupStep].toLowerCase();
  $("setup-steps").innerHTML = pickNames
    .map(
      (name, i) =>
        `<button data-setup-step="${i}" class="${i === setupStep ? "active" : i < setupStep ? "complete" : ""}" ${i > setupStep ? "disabled" : ""}><b>${i < setupStep ? "✓" : i + 1}</b><span>${name}<small>${WEAPONS[setupDraft[i]].name}</small></span></button>`,
    )
    .join("");
  $("setup-grid").innerHTML = Object.entries(WEAPONS)
    .filter(([, w]) => w.slot === setupStep)
    .map(
      ([id, w]) =>
        `<button class="setup-card ${id === setupDraft[setupStep] ? "selected" : ""}" data-pick-weapon="${id}" aria-pressed="${id === setupDraft[setupStep]}">${weaponIcon(id)}<strong>${w.name}</strong><small>${weaponLabel(w)}</small>${id === setupDraft[setupStep] ? '<b class="setup-check">✓</b>' : ""}</button>`,
    )
    .join("");
  const id = setupDraft[setupStep],
    w = WEAPONS[id];
  $("setup-weapon-name").textContent = w.name;
  $("setup-description").textContent = w.desc;
  $("setup-specs").innerHTML =
    `<span>${Number.isFinite(w.mag) ? w.mag + " CAPACITY" : "NO AMMO"}</span><span>${w.type === "heal" ? "70 / 25 HP" : w.damage + " DAMAGE"}</span>`;
  $("setup-back").disabled = setupStep === 0;
  $("setup-summary").textContent =
    `${setupStep + 1} / 4 · ${setupConfig.mode}v${setupConfig.mode} · ${MAPS.find((m) => m.id === setupConfig.map)?.short || "ARENA"}`;
  $("setup-next").textContent =
    setupStep === 3 ? "DEPLOY →" : "NEXT · " + pickNames[setupStep + 1] + " →";
  try {
    weaponPreview ||= new WeaponPreview($("setup-preview"));
    weaponPreview.show(id);
  } catch (error) {
    console.warn("Weapon preview unavailable", error);
  }
}
function openSetup(
  config = { map: MAPS[mapIndex].id, mode, difficulty, range: false },
) {
  if (!game) return;
  setupConfig = { ...config };
  setupDraft = [...loadout];
  setupStep = 0;
  show("match-setup", true);
  renderSetup();
  $("setup-next").focus();
}
function closeSetup() {
  show("match-setup", false);
  $(game.state === "results" ? "rematch-button" : "play-button").focus();
}
$("setup-grid").addEventListener("click", (e) => {
  const b = e.target.closest("[data-pick-weapon]");
  if (!b) return;
  setupDraft[setupStep] = b.dataset.pickWeapon;
  game.audio.play("switch");
  renderSetup();
  $("setup-grid").querySelector(".selected").focus();
});
$("setup-steps").addEventListener("click", (e) => {
  const b = e.target.closest("[data-setup-step]");
  if (b && !b.disabled) {
    setupStep = +b.dataset.setupStep;
    renderSetup();
  }
});
$("setup-back").addEventListener("click", () => {
  if (setupStep > 0) {
    setupStep--;
    renderSetup();
  }
});
$("setup-close").addEventListener("click", closeSetup);
$("setup-next").addEventListener("click", () => {
  if (setupStep < 3) {
    setupStep++;
    renderSetup();
    return;
  }
  loadout.splice(0, 4, ...setupDraft);
  save("rivals-loadout", loadout);
  renderMini();
  show("match-setup", false);
  game.start({ ...setupConfig, loadout: [...loadout] });
});
$("match-setup").addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.preventDefault();
    closeSetup();
  }
  if (e.key === "Tab") {
    const focusables = [
      ...$("match-setup").querySelectorAll("button:not(:disabled)"),
    ];
    const first = focusables[0],
      last = focusables.at(-1);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
});
function start(range = false) {
  if (!game) return;
  if (!("requestPointerLock" in $("game-canvas"))) {
    toast(
      "Playing requires a desktop mouse and keyboard. You can still explore the loadout and arenas here.",
    );
    return;
  }
  game.start({ map: MAPS[mapIndex].id, mode, difficulty, loadout, range });
}
$("play-button").addEventListener("click", () => openSetup());
$("range-button").addEventListener("click", () => start(true));
$("edit-loadout").addEventListener("click", () => switchTab("loadout"));
$("loadout-done").addEventListener("click", () => switchTab("play"));
$("slot-tabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-slot]");
  if (b) {
    slotIndex = +b.dataset.slot;
    renderLoadout();
  }
});
$("weapon-grid").addEventListener("click", (e) => {
  const b = e.target.closest("[data-weapon]");
  if (b) {
    loadout[slotIndex] = b.dataset.weapon;
    save("rivals-loadout", loadout);
    renderLoadout();
    renderMini();
    game?.audio.play("switch");
  }
});
$("resume-button").addEventListener("click", () => game.resume());
$("quit-button").addEventListener("click", () => game.quit());
$("results-lobby").addEventListener("click", () => game.quit());
$("rematch-button").addEventListener("click", () =>
  openSetup({ ...game.config, range: false }),
);
function syncSettings() {
  $("sensitivity").value = settings.sensitivity;
  $("sens-value").textContent = settings.sensitivity.toFixed(1) + "×";
  $("fov").value = settings.fov;
  $("fov-value").textContent = settings.fov + "°";
  $("volume").value = settings.volume;
  $("volume-value").textContent = settings.volume + "%";
  $("show-fps").checked = settings.showFps;
  $("screen-shake").checked = settings.shake;
  $("dynamic-fov").checked = settings.dynamicFov;
  $("performance-mode").checked = settings.performance;
}
function openSettings(paused) {
  settingsFromPause = paused;
  syncSettings();
  show("pause", false);
  show("settings", true);
}
function closeSettings() {
  show("settings", false);
  if (settingsFromPause) show("pause", true);
}
$("settings-open").addEventListener("click", () => openSettings(false));
$("pause-settings").addEventListener("click", () => openSettings(true));
$("settings-close").addEventListener("click", closeSettings);
$("settings-done").addEventListener("click", closeSettings);
for (const [id, key] of [
  ["sensitivity", "sensitivity"],
  ["fov", "fov"],
  ["volume", "volume"],
  ["show-fps", "showFps"],
  ["screen-shake", "shake"],
  ["dynamic-fov", "dynamicFov"],
  ["performance-mode", "performance"],
])
  $(id).addEventListener("input", () => {
    settings[key] = $(id).type === "checkbox" ? $(id).checked : +$(id).value;
    syncSettings();
    save("rivals-settings", settings);
    game?.setSettings(settings);
  });
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("match-setup").classList.contains("hidden")) {
    e.preventDefault();
    closeSetup();
    return;
  }
  if (e.key === "Escape" && !$("settings").classList.contains("hidden"))
    closeSettings();
});
renderMini();
syncSettings();

// Production builds cache their own assets; no remote APIs or third-party assets.
if (import.meta.env.PROD && "serviceWorker" in navigator)
  window.addEventListener("load", () =>
    navigator.serviceWorker
      .register("./sw.js")
      .catch((error) => console.warn("Offline caching unavailable:", error)),
  );
