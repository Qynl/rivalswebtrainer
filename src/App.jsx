import { Multiplayer } from "./net/Multiplayer.jsx";
import React, { useEffect, useSyncExternalStore } from "react";
import { Layout } from "./ui-layout.jsx";
import { Icon } from "./ui-hud.jsx";
import { ui, game, actions, boot, weaponLabel } from "./ui-session.js";
import { MAPS, WEAPONS, SLOT_NAMES } from "./data.js";
import {
  findPersonalBest,
  getTrainingDrill,
  getTrainingTrend,
  TRAINING_DRILLS,
} from "./training.js";
import { getTrainingAnalyticsRows } from "./training-analytics.js";
import { CONTROL_DEFINITIONS, formatControl } from "./controls.js";
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
      const state = ui.get();
      if (state.rebinding) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.code === "Escape") actions.cancelRebind();
        else actions.rebind(state.rebinding, e.code);
        return;
      }
      if (e.key === "Escape") {
        if (state.setup) {
          e.preventDefault();
          actions.closeSetup();
        } else if (state.settingsOpen) actions.closeSettings();
        else if (state.drillResult) {
          e.preventDefault();
          actions.leaveTraining();
        }
      }
    };
    const blur = () => {
      if (ui.get().rebinding) actions.cancelRebind();
    };
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", blur);
    };
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
  useEffect(() => {
    if (s.drillResult) document.getElementById("drill-again")?.focus();
  }, [!!s.drillResult]);
  cls("lobby", s.screen === "lobby", "screen");
  cls("pause", s.paused, "overlay");
  cls("settings", s.settingsOpen, "overlay");
  cls("results", s.screen === "results", "overlay");
  cls("drill-results", !!s.drillResult, "overlay");
  cls("match-setup", !!s.setup, "overlay");
  cls("toast", !!s.toast);
  content.toast = s.toast;
  cls("startup-status", !s.ready);
  content["startup-status"] = s.error || "PREPARING ARENA · LOCAL ASSETS";
  for (const tab of ["play", "training", "loadout", "guide"]) {
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
  click("training-edit-loadout", () => actions.tab("loadout"));
  click("loadout-done", () => actions.doneLoadout());
  click("training-reset", () => {
    if (window.confirm("Clear all local training records on this device?"))
      actions.clearTrainingHistory();
  });
  click("training-export", () => actions.exportTrainingHistory());
  click("training-import", () =>
    document.getElementById("training-import-file")?.click(),
  );
  bind["training-import-file"] = {
    onChange: async (event) => {
      const input = event.currentTarget,
        file = input.files?.[0];
      if (file) await actions.importTrainingHistory(file);
      input.value = "";
    },
  };
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
  content["training-loadout"] = s.loadout
    .map((id) => WEAPONS[id].name)
    .join(" · ");
  content["training-drills"] = TRAINING_DRILLS.map((drill) => {
    const best = findPersonalBest(s.trainingHistory, drill.id, s.loadout),
      trend = getTrainingTrend(s.trainingHistory, drill.id, s.loadout),
      minimum = trend.count ? Math.min(...trend.scores) : 0,
      maximum = trend.count ? Math.max(...trend.scores) : 1,
      span = Math.max(1, maximum - minimum),
      points = trend.scores
        .map((score, i) => {
          const x = trend.count > 1 ? (i / (trend.count - 1)) * 100 : 50,
            y = 28 - ((score - minimum) / span) * 22;
          return `${x},${y}`;
        })
        .join(" "),
      trendNote =
        trend.delta === null
          ? `Need ${Math.max(0, 3 - trend.count)} more run${3 - trend.count === 1 ? "" : "s"} for a trend.`
          : `${trend.delta >= 0 ? "+" : ""}${trend.delta} vs. oldest of last ${trend.count}.`;
    return (
      <article className="training-card" data-drill-card={drill.id} key={drill.id}>
        <div className="training-card-top">
          <span>{drill.category}</span>
          <small>{drill.duration} SEC</small>
        </div>
        <h2>{drill.title}</h2>
        <p>{drill.description}</p>
        <div className="training-focus">
          <span>COACHING NOTE</span>
          <small>{drill.coaching}</small>
        </div>
        <div className="training-record">
          <span>PERSONAL BEST · THIS LOADOUT</span>
          <strong>
            {best ? `${best.score} ${drill.scoreLabel}` : "NO RUN YET"}
          </strong>
        </div>
        <div className="training-trend" data-training-trend={drill.id}>
          <div>
            <span>{`LAST ${trend.count} RUN${trend.count === 1 ? "" : "S"}`}</span>
            <strong>
              {trend.average === null
                ? "SET A BASELINE"
                : `${trend.average} ${drill.scoreLabel} AVG`}
            </strong>
            <small>{trendNote}</small>
          </div>
          <svg
            viewBox="0 0 100 32"
            role="img"
            aria-label={
              trend.count
                ? `Recent ${drill.scoreLabel.toLowerCase()} scores: ${trend.scores.join(", ")}`
                : "No completed runs yet"
            }
          >
            {trend.count > 1 ? <polyline points={points} /> : null}
            {trend.count === 1 ? (
              <circle cx="50" cy="17" r="3" />
            ) : null}
          </svg>
        </div>
        <button
          className="primary-button training-start"
          id={`start-drill-${drill.id}`}
          data-start-drill={drill.id}
          aria-label={`Start ${drill.title} training drill`}
          disabled={!s.ready}
          onClick={() => actions.startDrill(drill.id)}
        >
          START DRILL <span aria-hidden="true">↗</span>
        </button>
      </article>
    );
  });
  content["training-history"] = s.trainingHistory.length ? (
    s.trainingHistory.slice(0, 6).map((run, i) => {
      const drill = getTrainingDrill(run.drillId),
        primary = WEAPONS[run.loadout[0]]?.name || run.loadout[0],
        date = new Date(run.endedAt).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        });
      return (
        <div className="training-history-row" data-training-run={i} key={`${run.endedAt}-${i}`}>
          <div>
            <strong>{drill?.title || "Training drill"}</strong>
            <small>{date} · {primary} · {run.accuracy}% accuracy</small>
          </div>
          <b>{run.score} {run.scoreLabel}</b>
        </div>
      );
    })
  ) : (
    <p className="training-empty">No sessions yet. Pick a drill and set a baseline.</p>
  );
  bind["training-reset"].disabled = !s.trainingHistory.length;
  bind["training-export"].disabled = !s.trainingHistory.length;
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
  click("drill-again", () => {
    const run = ui.get().drillResult;
    if (run) actions.startDrill(run.drillId, run.loadout, run.map);
  });
  click("drill-lobby", actions.leaveTraining);
  click("rematch-button", () =>
    game.network
      ? game.network.returnToLobby()
      : actions.openSetup({ ...game.config, range: false }),
  );
  for (const [id, paused] of [
    ["settings-open", false],
    ["pause-settings", true],
  ])
    click(id, () => actions.settings(paused));
  click("settings-close", actions.closeSettings);
  click("settings-done", actions.closeSettings);
  click("controls-reset", actions.resetControls);
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
  content["control-bindings"] = CONTROL_DEFINITIONS.map(([action, label]) => (
    <div className="control-binding-row" key={action} data-control-action={action}>
      <span>{label}</span>
      <button
        type="button"
        className={s.rebinding === action ? "control-binding capture" : "control-binding"}
        data-rebind={action}
        aria-label={`${label}: ${s.rebinding === action ? "press a key" : formatControl(s.controls, action)}`}
        aria-pressed={s.rebinding === action}
        onClick={() => actions.beginRebind(action)}
      >
        {s.rebinding === action ? "PRESS A KEY · ESC CANCELS" : formatControl(s.controls, action)}
      </button>
    </div>
  ));
  content["control-rebind-status"] = s.rebinding
    ? `Press a key to set ${CONTROL_DEFINITIONS.find(([id]) => id === s.rebinding)?.[1] || "this control"}. Escape cancels.`
    : "Select a binding, then press a key. Duplicate keys swap; browser shortcuts stay reserved.";
  const kbd = (action) => <kbd>{formatControl(s.controls, action)}</kbd>;
  content["guide-movement-controls"] = (
    <>
      <dt>{kbd("moveForward")} {kbd("moveLeft")} {kbd("moveBackward")} {kbd("moveRight")}</dt>
      <dd>Move (forward / left / back / right)</dd>
      <dt>{kbd("jump")}</dt>
      <dd>Jump / double jump with Fists or Bow</dd>
      <dt>{kbd("slide")}</dt>
      <dd>Slide while moving; jump to cancel</dd>
    </>
  );
  content["guide-combat-controls"] = (
    <>
      <dt><kbd>LMB</kbd> / <kbd>RMB</kbd></dt>
      <dd>Fire / aim or melee ability</dd>
      <dt>{kbd("quickMelee")}</dt>
      <dd>Quick melee ability / Knife stab</dd>
      <dt>{kbd("quickUtility")}</dt>
      <dd>Quick utility / quick Medkit heal — keeps your weapon</dd>
      <dt>{kbd("slot1")} {kbd("slot2")} {kbd("slot3")} {kbd("slot4")}</dt>
      <dd>Equip a loadout slot</dd>
      <dt>{kbd("reload")}</dt>
      <dd>Reload</dd>
      <dt>{kbd("inspect")}</dt>
      <dd>Inspect weapon</dd>
      <dt><kbd>ESC</kbd></dt>
      <dd>Pause / release mouse</dd>
    </>
  );
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
  if (s.drillResult) {
    const run = s.drillResult,
      drill = getTrainingDrill(run.drillId);
    content["drill-result-eyebrow"] = run.personalBest
      ? "NEW PERSONAL BEST"
      : "DRILL COMPLETE";
    content["drill-result-title"] = drill?.title || "Training drill";
    content["drill-result-score"] = run.score;
    content["drill-result-score-label"] = run.scoreLabel;
    content["drill-result-best"] = run.personalBest
      ? "A new best for this exact loadout."
      : `Personal best: ${run.previousBest ?? run.score} ${run.scoreLabel}`;
    content["drill-result-coaching"] =
      drill?.coaching || "Run it again and keep building consistency.";
    content["drill-result-metrics"] = [
      ["SHOTS", run.shots],
      ["HITS", run.hits],
      ["ACCURACY", run.accuracy + "%"],
      ["HEAD TAGS", run.headshots],
      ["ELIMINATIONS", run.kills],
    ].map(([label, value]) => (
      <div key={label}>
        <strong>{value}</strong>
        <small>{label}</small>
      </div>
    ));
    const analyticsRows = getTrainingAnalyticsRows(run.analytics);
    content["drill-result-analytics"] = analyticsRows.length ? (
      analyticsRows.map((row) => (
        <div className="drill-weapon-row" key={row.weaponId}>
          <strong className="drill-weapon-name">
            {WEAPONS[row.weaponId]?.name || row.weaponId}
          </strong>
          <span>
            <b>{row.actions}</b>
            <small>{row.actionLabel}</small>
          </span>
          <span>
            <b>{row.hitActions}/{row.headHitActions}</b>
            <small>HIT / HEAD EVENTS</small>
          </span>
          <span>
            <b>{row.directContacts}/{row.headContacts}</b>
            <small>DIRECT / HEAD CONTACTS</small>
          </span>
          <span>
            <b>{row.splashContacts}/{row.areaTicks}</b>
            <small>SPLASH / AREA</small>
          </span>
          <span>
            <b>{row.aimedActions}/{row.movingActions}</b>
            <small>ADS / MOVING</small>
          </span>
          <span>
            <b>
              {row.averageDistance === null ? "—" : row.averageDistance.toFixed(1)} / {Math.round(row.damage)}
            </b>
            <small>AVG RANGE (U) / DMG</small>
          </span>
        </div>
      ))
    ) : (
      <p className="drill-analytics-empty">No per-weapon event detail was recorded for this run.</p>
    );
  }
  return (
    <>
      <Layout bind={bind} content={content} />
      <Multiplayer
        ready={s.ready}
        playing={s.screen === "game"}
        loadout={s.loadout}
      />
    </>
  );
}
