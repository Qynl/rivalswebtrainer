import React, { memo, useSyncExternalStore } from "react";
import { hud, ui } from "./ui-session.js";
import { WEAPONS, weaponIcon } from "./data.js";
export const Icon = memo(function Icon({ id }) {
  return (
    <span
      className="weapon-icon-wrap"
      dangerouslySetInnerHTML={{ __html: weaponIcon(id) }}
    />
  );
});
const Slots = memo(function Slots({ slots, slot }) {
  return (
    <div id="hud-slots">
      {slots.map((id, i) => (
        <div key={i} className={"hud-slot " + (slot === i ? "selected" : "")}>
          <span>{i + 1}</span>
          <Icon id={id} />
          <small>{WEAPONS[id].name.toUpperCase()}</small>
        </div>
      ))}
    </div>
  );
});
export function Hud() {
  const h = useSyncExternalStore(hud.subscribe, hud.get),
    s = useSyncExternalStore(ui.subscribe, ui.get),
    a = h.ability,
    u = h.utility,
    b = h.banner;
  const marker = h.marker || "",
    stats = h.stats || {},
    accuracy = Math.min(
      100,
      Math.round(((stats.hits || 0) / Math.max(1, stats.shots || 0)) * 100),
    );
  return (
    <>
      <div
        id="flash-overlay"
        className={h.flash && !s.paused ? "" : "hidden"}
        aria-hidden="true"
        style={{ opacity: h.flash || 0 }}
      />
      <div
        id="paint-overlay"
        className={h.paint && !s.paused ? "" : "hidden"}
        aria-hidden="true"
        style={{ opacity: h.paint || 0 }}
      />
      <div
        id="smoke-overlay"
        aria-hidden="true"
        className={
          h.smoke > 0 && s.screen === "game" && !s.paused ? "" : "hidden"
        }
        style={{ opacity: h.smoke || 0 }}
      />
      <div id="hud" className={s.screen === "game" ? "" : "hidden"}>
        <div className="hud-top">
          <div className="hud-brand">
            R<span>OFFLINE ARENA</span>
          </div>
          <div className="scoreboard">
            <div className="team-score friendly">
              <small>YOUR TEAM</small>
              <strong id="player-score">{h.score[0]}</strong>
            </div>
            <div className="round-info">
              <span id="round-label">{h.round || "ROUND 1"}</span>
              <strong id="timer">{h.timer || "1:30"}</strong>
              <small>{h.range ? "FREE PRACTICE" : "FIRST TO 5"}</small>
            </div>
            <div className="team-score enemy">
              <small>RIVALS</small>
              <strong id="bot-score">{h.score[1]}</strong>
            </div>
          </div>
          <div className="hud-right">
            <span id="hud-map">{h.map}</span>
            <span
              id="fps-counter"
              className={s.settings.showFps ? "" : "hidden"}
            >
              {h.fps} FPS
            </span>
          </div>
        </div>
        <div id="team-status">
          {h.team.map((e, i) => (
            <div key={i} className={"team-member " + (e.alive ? "" : "dead")}>
              <i />
              {e.name} <span>{e.alive ? e.health + " HP" : "ELIMINATED"}</span>
            </div>
          ))}
        </div>
        <div id="kill-feed">
          {h.feed.map((r) => (
            <div key={r.id} className="kill-row">
              <b>{r.killer}</b>
              <i>{r.head ? "HEADSHOT" : "ELIMINATED"}</i>
              <span>{r.victim}</span>
            </div>
          ))}
        </div>
        <div
          id="crosshair"
          className={h.crosshair ? "" : "hidden"}
          style={{
            "--reticle-gap": (h.gap || 4) + "px",
            transform: "translate(-50%,-50%)",
          }}
        >
          <i />
          <i />
          <i />
          <i />
          <b />
        </div>
        <div
          id="hitmarker"
          aria-hidden="true"
          data-confirmation={marker}
          className={
            marker === "head"
              ? "headshot"
              : marker === "elimination"
                ? "elimination"
                : ""
          }
          style={{
            opacity: h.markerOpacity,
            transition: h.markerOpacity ? "none" : "opacity 80ms",
            color:
              marker === "elimination"
                ? "#b5f5d8"
                : marker === "head"
                  ? "#ffcb8f"
                  : "white",
          }}
        >
          <svg key={h.markerPulse || 0} viewBox="-20 -20 40 40">
            <path d="M -14 -14 L -7 -7 M 14 -14 L 7 -7 M -14 14 L -7 7 M 14 14 L 7 7" />
          </svg>
        </div>
        {h.bowDraw !== null && h.bowDraw !== undefined && (
          <div
            id="bow-draw"
            className={h.bowDraw >= 1 ? "full" : ""}
            aria-label="Bow draw"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(h.bowDraw * 100)}
          >
            <i style={{ transform: `scaleX(${h.bowDraw})` }} />
          </div>
        )}
        <div id="damage-vignette" style={{ opacity: h.hurt || 0 }} />
        <div id="damage-directions" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="damage-arc"
              style={{
                transform: `rotate(${h.arcs[i]?.bearing || 0}rad)`,
                opacity: h.arcs[i]?.opacity || 0,
              }}
            >
              <svg viewBox="-90 -90 180 180">
                <path d="M -24 -67 Q 0 -81 24 -67" />
              </svg>
            </div>
          ))}
        </div>
        <div id="damage-numbers" aria-hidden="true">
          {h.numbers.map((n) => (
            <span
              key={n.id}
              className={
                "damage-number " +
                (n.backstab ? "backstab" : n.head ? "headshot" : "")
              }
              style={{
                left: n.x,
                top: n.y,
                opacity: n.opacity,
                transform: `translate(-50%,-100%) scale(${n.scale})`,
              }}
            >
              {n.backstab ? "BACKSTAB " : ""}
              {n.amount}
            </span>
          ))}
        </div>
        <div id="round-banner" className={b ? "" : "hidden"}>
          <span id="banner-eyebrow">{b?.eyebrow}</span>
          <h2
            id="banner-title"
            style={{
              color:
                b?.title.includes("LOST") || b?.title.includes("ELIMINATED")
                  ? "#ff9b83"
                  : "#fff",
            }}
          >
            {b?.title}
          </h2>
          <p id="banner-subtitle">{b?.subtitle}</p>
        </div>
        <div id="reload-indicator" className={h.action ? "" : "hidden"}>
          {h.action || "RELOADING"}
          <span className="action-track">
            <i
              style={{
                transform: `scaleX(${Math.max(0, Math.min(1, h.actionProgress || 0))})`,
              }}
            />
          </span>
        </div>
        <div className="hud-bottom">
          <div className="health-block">
            <span className="health-icon">+</span>
            <strong id="health-value">{h.health}</strong>
            <div>
              <small>HEALTH</small>
              <div className="health-track">
                <i
                  id="health-fill"
                  style={{
                    width:
                      Math.max(
                        0,
                        Math.min(100, (h.health / (h.maxHealth || 150)) * 100),
                      ) + "%",
                    background: h.health < 45 ? "#ff754f" : "#b7f9dc",
                  }}
                />
              </div>
            </div>
          </div>
          <Slots slots={h.slots} slot={h.slot} />
          <div className="ammo-block">
            <span id="weapon-name">{h.weapon}</span>
            <div>
              <strong id="ammo-value" className={h.ammoState || ""}>
                {h.ammo}
              </strong>
              <span>
                / <b id="reserve-value">{h.reserve}</b>
              </span>
            </div>
            <small id="ammo-hint">{h.hint}</small>
          </div>
        </div>
        <div className="hud-controls">
          WASD MOVE <i>·</i> C / SHIFT SLIDE <i>·</i> SPACE JUMP <i>·</i> RMB
          AIM <i>·</i> F ABILITY <i>·</i> G UTILITY <i>·</i> ESC PAUSE
        </div>
        <div id="round-loadout-hint" className={h.canSelect ? "" : "hidden"}>
          <kbd>M</kbd> CHANGE WEAPONS · {h.countdown}s
        </div>
        <div id="range-stats" className={h.range ? "" : "hidden"}>
          {[
            ["SHOTS", stats.shots || 0],
            ["ACCURACY", accuracy + "%"],
            ["ELIMINATIONS", stats.kills || 0],
          ].map(([k, v]) => (
            <div key={k}>
              <strong>{v}</strong>
              <span>{k}</span>
            </div>
          ))}
        </div>
        <div
          id="scope"
          className={h.scoped ? "" : "hidden"}
          data-shot-pulse={h.shotPulse || 0}
          style={{
            transform: `scale(${1 + (s.settings.shake ? (h.shotPulse || 0) * 0.025 : 0)})`,
            boxShadow: `inset 0 0 ${35 + (h.shotPulse || 0) * 65}px #080d15`,
          }}
        />
        <div className="quick-actions">
          <div
            id="ability-status"
            className={
              !a
                ? "hidden"
                : (a.cooldown <= 0 ? "ready " : "") +
                  (a.active ? "guarding" : "")
            }
          >
            {a && (
              <>
                <kbd>F</kbd>
                <span>{a.name}</span>
                <b>
                  {a.active
                    ? a.time.toFixed(1) + "s"
                    : a.cooldown > 0
                      ? a.cooldown.toFixed(1) + "s"
                      : "READY"}
                </b>
              </>
            )}
          </div>
          <div
            id="utility-status"
            className={
              !u
                ? "hidden"
                : "quick-utility " +
                  (u.active
                    ? "active"
                    : u.empty
                      ? "empty"
                      : u.cooldown > 0
                        ? "recovering"
                        : "ready")
            }
          >
            {u && (
              <>
                <kbd>G</kbd>
                <span>{u.name}</span>
                <b>
                  {u.active
                    ? u.healing
                      ? "HEALING"
                      : "THROWING"
                    : u.empty
                      ? "EMPTY"
                      : u.cooldown > 0
                        ? u.cooldown.toFixed(1) + "s"
                        : u.count + " LEFT"}
                </b>
              </>
            )}
          </div>
        </div>
        <div id="guard-overlay" className={h.guard ? "" : "hidden"} />
      </div>
    </>
  );
}
