import React, { useEffect, useSyncExternalStore } from "react";
import { Layout } from "./ui-layout.jsx";
import { Icon } from "./ui-hud.jsx";
import { ui, game, actions, boot, weaponLabel } from "./ui-session.js";
import { MAPS, WEAPONS, SLOT_NAMES } from "./data.js";
let preview;
const picks = ["PRIMARY", "SECONDARY", "MELEE", "UTILITY"];
export function App() {
  const s = useSyncExternalStore(ui.subscribe, ui.get),
    bind = {},
    content = {};
  const cls = (id, on, base = "") => {
    bind[id] = { ...bind[id], className: base + (on ? "" : " hidden") };
  };
  const click = (id, onClick) => {
    bind[id] = { ...bind[id], onClick };
  };
  useEffect(() => {
    let cancelled = false;
    const frame = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (!cancelled) boot(document.getElementById("game-canvas"));
      }),
    );
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, []);
  useEffect(() => {
    const key = (e) => {
      if (e.key === "Escape") {
        if (ui.get().setup) {
          e.preventDefault();
          actions.closeSetup();
        } else if (ui.get().settingsOpen) actions.closeSettings();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const selected = s.setup ? s.draft[s.step] : s.loadout[s.slotIndex],
    w = WEAPONS[selected];
  useEffect(() => {
    let cancelled = false;
    if (s.setup)
      import("./weapon-preview.js").then(({ WeaponPreview }) => {
        if (cancelled) return;
        try {
          preview ||= new WeaponPreview(
            document.getElementById("setup-preview"),
          );
          preview.show(selected);
        } catch (error) {
          console.warn("Weapon preview unavailable", error);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [!!s.setup, selected]);
  useEffect(() => {
    if (s.setup) document.getElementById("setup-next")?.focus();
  }, [!!s.setup, s.step]);
  cls("lobby", s.screen === "lobby", "screen");
  cls("pause", s.paused, "overlay");
  cls("settings", s.settingsOpen, "overlay");
  cls("results", s.screen === "results", "overlay");
  cls("match-setup", !!s.setup, "overlay");
  cls("toast", !!s.toast);
  content.toast = s.toast;
  cls("startup-status", !s.ready);
  content["startup-status"] = s.error || "PREPARING ARENA · LOCAL ASSETS";
  for (const tab of ["play", "loadout", "guide"]) {
    cls(tab + "-tab", s.tab === tab, "tab-content");
    click("tab-" + tab, () => actions.tab(tab));
    bind["tab-" + tab].className =
      "nav-item " + (s.tab === tab ? "active" : "");
  }
  click("brand", (e) => {
    e.preventDefault();
    actions.tab("play");
  });
  click("edit-loadout", () => actions.tab("loadout"));
  click("loadout-done", () => actions.tab("play"));
  for (const mode of [1, 2, 3]) {
    click("mode-" + mode, () => ui.set({ mode }));
    bind["mode-" + mode].className = s.mode === mode ? "selected" : "";
  }
  for (const difficulty of ["rookie", "regular", "veteran", "elite"]) {
    click("difficulty-" + difficulty, () => ui.set({ difficulty }));
    bind["difficulty-" + difficulty].className =
      s.difficulty === difficulty ? "selected" : "";
  }
  content["difficulty-hint"] = {
    rookie: "Learn the ropes",
    regular: "A fair fight",
    veteran: "No free shots",
    elite: "Bring your A-game",
  }[s.difficulty];
  content["map-name"] = MAPS[s.mapIndex].name;
  content["preview-name"] = MAPS[s.mapIndex].name.toUpperCase();
  click("map-cycle", actions.map);
  click("play-button", () => actions.openSetup());
  click("range-button", actions.range);
  bind["play-button"].disabled = bind["range-button"].disabled = !s.ready;
  content["loadout-mini"] = s.loadout.map((id) => (
    <span key={id} title={WEAPONS[id].name}>
      <Icon id={id} />
    </span>
  ));
  content["slot-tabs"] = SLOT_NAMES.map((name, i) => (
    <button
      key={name}
      className={"slot-tab " + (s.slotIndex === i ? "selected" : "")}
      data-slot={i}
      onClick={() => ui.set({ slotIndex: i })}
    >
      <span>
        0{i + 1} / {name}
      </span>
      <small>{WEAPONS[s.loadout[i]].name}</small>
    </button>
  ));
  content["weapon-grid"] = Object.entries(WEAPONS)
    .filter(([, w]) => w.slot === s.slotIndex)
    .map(([id, w]) => (
      <button
        key={id}
        data-weapon={id}
        className={
          "weapon-card " + (s.loadout[s.slotIndex] === id ? "selected" : "")
        }
        onClick={() => actions.choose(id)}
      >
        {s.loadout[s.slotIndex] === id && (
          <span className="equipped-badge">✓ EQUIPPED</span>
        )}
        <Icon id={id} />
        <strong>{w.name.toUpperCase()}</strong>
        <small>{weaponLabel(w)}</small>
      </button>
    ));
  const detail = WEAPONS[s.loadout[s.slotIndex]];
  content["weapon-detail"] = (
    <>
      <span className="eyebrow">{SLOT_NAMES[s.slotIndex]} / EQUIPPED</span>
      <Icon id={s.loadout[s.slotIndex]} />
      <h2>{detail.name}</h2>
      <p>{detail.desc}</p>
      {["DAMAGE", "RANGE", "FIRE RATE"].map((name, i) => (
        <div key={name} className="stat-row">
          <span>{name}</span>
          <span className="stat-bar">
            {Array.from({ length: 10 }, (_, n) => (
              <i key={n} className={n < detail.stats[i] ? "filled" : ""} />
            ))}
          </span>
        </div>
      ))}
      <div className="stat-row">
        <span>MAGAZINE</span>
        <span>{Number.isFinite(detail.mag) ? detail.mag : "∞"}</span>
      </div>
    </>
  );
  if (s.setup) {
    content["setup-title"] = "Choose your " + picks[s.step].toLowerCase();
    content["setup-steps"] = picks.map((name, i) => (
      <button
        key={name}
        data-setup-step={i}
        disabled={i > s.step}
        className={i === s.step ? "active" : i < s.step ? "complete" : ""}
        onClick={() => ui.set({ step: i })}
      >
        <b>{i < s.step ? "✓" : i + 1}</b>
        <span>
          {name}
          <small>{WEAPONS[s.draft[i]].name}</small>
        </span>
      </button>
    ));
    content["setup-grid"] = Object.entries(WEAPONS)
      .filter(([, w]) => w.slot === s.step)
      .map(([id, w]) => (
        <button
          key={id}
          className={"setup-card " + (id === selected ? "selected" : "")}
          data-pick-weapon={id}
          aria-pressed={id === selected}
          onClick={() => actions.choose(id)}
        >
          <Icon id={id} />
          <strong>{w.name}</strong>
          <small>{weaponLabel(w)}</small>
          {id === selected && <b className="setup-check">✓</b>}
        </button>
      ));
    content["setup-weapon-name"] = w.name;
    content["setup-description"] = w.desc;
    content["setup-specs"] = (
      <>
        <span>{Number.isFinite(w.mag) ? w.mag + " CAPACITY" : "NO AMMO"}</span>
        <span>{w.type === "heal" ? "70 / 25 HP" : w.damage + " DAMAGE"}</span>
      </>
    );
    content["setup-summary"] =
      `${s.step + 1} / 4 · ${s.setup.mode}v${s.setup.mode} · ${MAPS.find((m) => m.id === s.setup.map)?.short || "ARENA"}${s.roundSetup ? " · OPPONENTS START AFTER 5s" : ""}`;
    content["setup-next"] =
      s.step === 3 ? "DEPLOY →" : "NEXT · " + picks[s.step + 1] + " →";
  }
  click("setup-next", actions.next);
  click("setup-close", actions.closeSetup);
  click("setup-back", () => ui.set({ step: Math.max(0, s.step - 1) }));
  bind["setup-back"].disabled = s.step === 0;
  bind["match-setup"].onKeyDown = (e) => {
    if (e.key === "Tab") {
      const buttons = [
          ...e.currentTarget.querySelectorAll("button:not(:disabled)"),
        ],
        first = buttons[0],
        last = buttons.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  click("resume-button", () => game.resume());
  click("quit-button", () => game.quit());
  click("results-lobby", () => game.quit());
  click("rematch-button", () =>
    actions.openSetup({ ...game.config, range: false }),
  );
  for (const [id, paused] of [
    ["settings-open", false],
    ["pause-settings", true],
  ])
    click(id, () => actions.settings(paused));
  click("settings-close", actions.closeSettings);
  click("settings-done", actions.closeSettings);
  for (const [id, key] of [
    ["sensitivity", "sensitivity"],
    ["fov", "fov"],
    ["volume", "volume"],
    ["show-fps", "showFps"],
    ["screen-shake", "shake"],
    ["dynamic-fov", "dynamicFov"],
    ["performance-mode", "performance"],
  ]) {
    const value = s.settings[key];
    bind[id] = {
      ...bind[id],
      ...(typeof value === "boolean" ? { checked: value } : { value }),
      onChange: (e) =>
        actions.setting(
          key,
          e.target.type === "checkbox" ? e.target.checked : +e.target.value,
        ),
    };
  }
  content["sens-value"] = s.settings.sensitivity.toFixed(1) + "×";
  content["fov-value"] = s.settings.fov + "°";
  content["volume-value"] = s.settings.volume + "%";
  if (s.result) {
    const r = s.result;
    content["result-eyebrow"] = r.won
      ? "THAT’S HOW IT’S DONE."
      : "THE GRIND CONTINUES.";
    content["result-title"] = (
      <>
        {r.won ? "VICTORY" : "NEXT TIME"}
        <span>.</span>
      </>
    );
    content["result-score"] = (
      <>
        {r.score[0]} <span>—</span> {r.score[1]}
      </>
    );
    content["result-description"] =
      `${r.config.mode}v${r.config.mode} · ${r.config.difficulty.toUpperCase()} BOTS · ${MAPS.find((m) => m.id === r.config.map).name}`;
    content["result-stats"] = [
      ["ELIMINATIONS", r.stats.kills],
      ["DEATHS", r.stats.deaths],
      [
        "ACCURACY",
        Math.min(
          100,
          Math.round((r.stats.hits / Math.max(1, r.stats.shots)) * 100),
        ) + "%",
      ],
    ].map(([k, v]) => (
      <div key={k}>
        <strong>{v}</strong>
        <small>{k}</small>
      </div>
    ));
  }
  return <Layout bind={bind} content={content} />;
}
