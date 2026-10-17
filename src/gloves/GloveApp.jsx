import React, {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ui, hud, game, boot, actions, toast } from "../ui-session.js";
import { MAPS } from "../data.js";
import {
  GLOVES,
  GLOVE_ROSTER,
  gloveCategory,
  gloveLoadout,
} from "./catalog.js";
import { progression } from "./progression.js";
import { Multiplayer, OnlineButton } from "../net/Multiplayer.jsx";
import { multiplayer } from "../net/client.js";
import "./gloves.css";
const useStore = (store) =>
  useSyncExternalStore(store.subscribe, store.getSnapshot || store.get);
function Hand({ glove, className = "" }) {
  return (
    <svg
      className={`glove-symbol ${className}`}
      viewBox="0 0 100 115"
      fill="none"
      aria-hidden="true"
    >
      <g
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinejoin="round"
      >
        <path d="M28 58V26Q28 19 34 19Q40 19 40 26V48V15Q40 8 47 8Q54 8 54 15V48V20Q54 13 61 13Q68 13 68 20V51V31Q68 25 74 25Q80 25 80 31V70Q80 86 68 94V105H38V91Q30 86 24 78L11 60Q7 54 12 50Q17 46 22 51L30 61" />
      </g>
      <path d="M43 100H67M40 86H69" stroke="#162431" strokeWidth="4" />
      <text
        x="55"
        y="72"
        textAnchor="middle"
        fontSize="22"
        fontWeight="900"
        fill="#162431"
      >
        {{
          diamond: "◆",
          extended: "↕",
          snow: "❄",
          pull: "↶",
          flash: "ϟ",
          spring: "≋",
          swapper: "⇄",
          bull: "▰",
          dual: "Ⅱ",
          brick: "▦",
          acrobat: "↻",
          dice: "⚄",
          ghost: "◉",
          thanos: "⌛",
          stun: "ϟ",
          za_hando: "◎",
          magnet: "∩",
          anchor: "⚓",
          space: "✧",
          boomerang: "↶",
          speedrun: "»",
          golden: "♛",
          reverse: "⇆",
        }[glove.key] || "✦"}
      </text>
    </svg>
  );
}
function Preview({ id }) {
  const ref = useRef(null),
    preview = useRef(null),
    current = useRef(id);
  current.current = id;
  useEffect(() => {
    let gone = false;
    import("../weapon-preview.js").then(({ WeaponPreview }) => {
      if (gone || !ref.current) return;
      preview.current = new WeaponPreview(ref.current);
      preview.current.show(current.current);
    });
    return () => {
      gone = true;
      const p = preview.current;
      if (p) {
        p.dispose();
        preview.current = null;
      }
    };
  }, []);
  useEffect(() => {
    preview.current?.show(id);
  }, [id]);
  return (
    <canvas
      ref={ref}
      className="glove-preview"
      tabIndex={0}
      aria-description="Drag to rotate the model, or focus it and use the left and right arrow keys."
      aria-label="Original three-dimensional glove model"
    />
  );
}
function Settings({ s }) {
  return (
    <div className="slap-modal-back">
      <section className="slap-modal">
        <span className="slap-kicker">MAKE IT FEEL RIGHT</span>
        <h2>Settings</h2>
        {[
          ["sensitivity", "Mouse sensitivity", 0.3, 3, 0.1],
          ["fov", "Field of view", 70, 110, 1],
          ["volume", "Volume", 0, 100, 1],
        ].map(([key, label, min, max, step]) => (
          <label className="slap-setting" key={key}>
            {label}
            <b>{s.settings[key]}</b>
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={s.settings[key]}
              onChange={(e) => actions.setting(key, +e.target.value)}
            />
          </label>
        ))}
        {[
          ["invertMouseY", "Invert mouse Y"],
          ["shake", "Weapon sway / impact motion"],
          ["dynamicFov", "Dynamic field of view"],
          ["performance", "Performance mode"],
          ["showFps", "Show FPS"],
        ].map(([key, label]) => (
          <label className="slap-toggle" key={key}>
            {label}
            <input
              type="checkbox"
              checked={s.settings[key]}
              onChange={(e) => actions.setting(key, e.target.checked)}
            />
          </label>
        ))}
        <button
          className="slap-primary"
          onClick={() => actions.closeSettings()}
        >
          Done
        </button>
      </section>
    </div>
  );
}
function MatchHUD({ h, profile }) {
  const glove = GLOVES[game?.loadout[0]] || GLOVES[profile.selected],
    status = h.gloveStatus;
  return (
    <div className="slap-hud">
      <header className="slap-match-header">
        <span>
          {h.map} <small>{h.round}</small>
        </span>
        <div className="slap-score">
          <b>{h.score?.[0] || 0}</b>
          <i>FIRST TO 5</i>
          <b>{h.score?.[1] || 0}</b>
        </div>
        <span>
          {h.timer}
          <small>{profile.slaps.toLocaleString()} SLAPS</small>
        </span>
      </header>
      <div className={`slap-crosshair ${h.marker ? "confirmed" : ""}`}>
        <i />
        <i />
        <i />
        <i />
      </div>
      {h.marker && (
        <div className="slap-confirm" key={h.markerPulse}>
          {h.marker === "elimination"
            ? "ELIMINATED"
            : h.gloveRoll
              ? `ROLLED ${h.gloveRoll}`
              : "SLAP!"}
          <small>CONFIRMED HIT</small>
        </div>
      )}
      {h.numbers?.map((n) => (
        <span
          className="slap-number"
          key={n.id}
          style={{
            left: n.x,
            top: n.y,
            opacity: n.opacity,
            transform: `translate(-50%,-50%) scale(${n.scale || 1})`,
          }}
        >
          {n.text || n.amount}
        </span>
      ))}
      {h.banner && (
        <div className="slap-banner">
          <small>{h.banner.eyebrow}</small>
          <strong>{h.banner.title}</strong>
          <p>{h.banner.subtitle}</p>
        </div>
      )}
      {status && (
        <div className={`slap-status ${status === "CHILLED" ? "chilled" : ""}`}>
          {status}
          <small>
            {status === "RAGDOLL"
              ? "Recovering · Movement returns automatically"
              : status === "STONE FORM"
                ? "Protected · Cannot move or slap"
                : {
                    CHILLED: "Movement & jump reduced",
                    HIDDEN: "Slapping reveals you · Still vulnerable",
                    POWERUP: "Protected · Enhanced slap power",
                    REFLECTING: "Incoming slaps return to the attacker",
                    "ZERO-G": "Low gravity · Air steering active",
                  }[status] || ""}
          </small>
        </div>
      )}
      {h.gloveWaypoint && (
        <div
          className="slap-waypoint"
          style={{ left: h.gloveWaypoint.x, top: h.gloveWaypoint.y }}
        >
          ⌖
          <small>
            {glove.key === "thanos" ? "RETURN POINT" : "DOCK"} ·{" "}
            {h.gloveWaypoint.remaining}s
          </small>
        </div>
      )}
      {glove.key === "thanos" && h.gloveMarked && (
        <div className="slap-return-hint">POINT MARKED · E TO RETURN</div>
      )}
      {h.gloveNotice && (
        <div className="glove-cast-notice">{h.gloveNotice}</div>
      )}
      <aside className="slap-feed">
        {h.feed?.slice(-4).map((f, i) => (
          <div key={f.id || i}>
            {f.killer || f.source} <span>✦</span> {f.victim}
          </div>
        ))}
      </aside>
      <footer className="slap-match-footer">
        <div className="slap-health">
          <small>HEALTH</small>
          <strong>
            {h.health}
            <span>/ 150</span>
          </strong>
          <div>
            <i style={{ width: `${h.health / 1.5}%` }} />
          </div>
          <p>
            {h.team?.map((t) => (
              <span key={t.name} className={!t.alive ? "out" : ""}>
                {t.name} {t.alive ? "●" : "×"}{" "}
              </span>
            ))}
          </p>
        </div>
        <div className="slap-equipped" style={{ "--glove": glove.color }}>
          <Hand glove={glove} />
          <section>
            <small>EQUIPPED GLOVE</small>
            <h3>{glove.name}</h3>
            <p>{glove.ability}</p>
          </section>
          <div className="slap-ability">
            <kbd>{glove.activation === "active" ? "E" : "∞"}</kbd>
            <span>
              {glove.activation === "passive"
                ? "PASSIVE"
                : h.gloveCooldown > 0
                  ? `${h.gloveCooldown.toFixed(1)}s`
                  : "READY"}
            </span>
          </div>
        </div>
      </footer>
      <div className="slap-game-controls">
        LMB <b>SLAP</b> · E / RMB <b>ABILITY</b> · C / SHIFT <b>SLIDE</b> ·
        SPACE <b>JUMP</b> · V <b>VIEW</b> · WHEEL <b>ZOOM</b> ·{" "}
        {h.canSelect ? "M GLOVE · " : ""}ESC <b>PAUSE</b>
      </div>
      {h.hurt > 0 && <div className="slap-hurt" />}
      {h.fps > 0 && game?.settings.showFps && (
        <span className="slap-fps">{h.fps} FPS</span>
      )}
    </div>
  );
}
export function GloveApp() {
  const s = useStore(ui),
    h = useStore(hud),
    profile = useStore(progression),
    canvas = useRef(null),
    [tab, setTab] = useState("play"),
    [inspect, setInspect] = useState(profile.selected),
    [mode, setMode] = useState(1),
    [map, setMap] = useState(0),
    [difficulty, setDifficulty] = useState("regular"),
    [query, setQuery] = useState(""),
    [ownership, setOwnership] = useState("all"),
    [category, setCategory] = useState("all"),
    [sort, setSort] = useState("cost");
  const previousSlaps = useRef(profile.slaps);
  useEffect(() => {
    const unlocked = GLOVE_ROSTER.filter(
      (g) => g.cost > previousSlaps.current && g.cost <= profile.slaps,
    );
    previousSlaps.current = profile.slaps;
    if (unlocked.length)
      toast(
        `GLOVE UNLOCKED · ${unlocked.map((g) => g.name).join(", ")} · Open Gloves to equip.`,
      );
  }, [profile.slaps]);
  const visibleGloves = GLOVE_ROSTER.filter(
    (g) =>
      (ownership === "all" ||
        (ownership === "unlocked"
          ? g.cost <= profile.slaps
          : g.cost > profile.slaps)) &&
      (category === "all" || gloveCategory(g) === category) &&
      `${g.name} ${g.ability} ${g.description}`
        .toLowerCase()
        .includes(query.toLowerCase().trim()),
  ).sort((a, b) =>
    sort === "name" ? a.name.localeCompare(b.name) : a.cost - b.cost,
  );
  const selected = GLOVES[profile.selected],
    glove = GLOVES[inspect] || selected,
    playing = s.screen === "game",
    next = progression.next();
  useEffect(() => {
    multiplayer.glovesMode = true;
    const a = requestAnimationFrame(() =>
      requestAnimationFrame(() => boot(canvas.current)),
    );
    return () => cancelAnimationFrame(a);
  }, []);
  useEffect(() => {
    ui.set({ loadout: gloveLoadout(profile.selected) });
  }, [profile.selected]);
  const start = (range = false) => {
    if (!game || !s.ready) return;
    game.start({
      map: MAPS[map].id,
      mode,
      difficulty,
      range,
      loadout: gloveLoadout(profile.selected),
    });
  };
  const pick = (id) => {
    setInspect(id);
    game?.audio.play("switch");
  };
  const equip = () => {
    if (progression.select(inspect) && s.setup) {
      game.finishSelection(gloveLoadout(inspect));
      ui.set({ setup: null });
    }
  };
  return (
    <div className="slap-app">
      <canvas id="game-canvas" ref={canvas} />
      {(!playing || s.paused || s.setup) && (
        <div className="slap-scene-shade" />
      )}
      {!playing && s.screen !== "results" && (
        <main className="slap-shell">
          <header className="slap-nav">
            <a href="#" className="slap-brand" aria-label="Slap Arena home">
              <span>✦</span> SLAP<span>ARENA</span>
              <small>ROUND-BASED GLOVE COMBAT</small>
            </a>
            <nav>
              <button
                className={tab === "play" ? "active" : ""}
                onClick={() => setTab("play")}
              >
                Play
              </button>
              <button
                className={tab === "gloves" ? "active" : ""}
                onClick={() => setTab("gloves")}
              >
                Gloves <small>{GLOVE_ROSTER.length}</small>
              </button>
              <button onClick={() => actions.settings()}>Settings</button>
            </nav>
            <div className="slap-wallet">
              <span>✦</span>
              <strong>{profile.slaps.toLocaleString()}</strong>
              <small>SLAPS</small>
            </div>
          </header>
          <div className="slap-body">
            <section className="slap-intro">
              <span className="slap-kicker">
                <i /> NO GUNS. NO AMMO. JUST HANDS.
              </span>
              <h1>
                {tab === "play" ? (
                  <>
                    Talk is cheap.
                    <br />
                    <em>Throw hands.</em>
                  </>
                ) : (
                  <>
                    Find your
                    <br />
                    <em>upper hand.</em>
                  </>
                )}
              </h1>
              <p>
                {tab === "play"
                  ? "Get close. Land the slap. Send them flying. Glove-only duels and team rounds with real knockback, ragdolls, and abilities worth mastering."
                  : "Every confirmed slap counts. Reach a milestone to permanently unlock another glove—no spending your total, no loot boxes."}
              </p>
              <div className="slap-tags">
                <span>150 HEALTH</span>
                <span>FIRST TO 5</span>
                <span>OFFLINE + ONLINE</span>
              </div>
              {tab === "play" ? (
                <>
                  <div className="slap-match-options">
                    <label>
                      TEAM SIZE
                      <div>
                        {[1, 2, 3].map((n) => (
                          <button
                            key={n}
                            className={mode === n ? "active" : ""}
                            onClick={() => setMode(n)}
                          >
                            {n}v{n}
                          </button>
                        ))}
                      </div>
                    </label>
                    <label>
                      ARENA
                      <select
                        aria-label="Arena"
                        value={map}
                        onChange={(e) => {
                          setMap(+e.target.value);
                          game?.preview(MAPS[+e.target.value].id);
                        }}
                      >
                        {MAPS.map((m, i) => (
                          <option key={m.id} value={i}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      BOTS
                      <select
                        aria-label="Bot difficulty"
                        value={difficulty}
                        onChange={(e) => setDifficulty(e.target.value)}
                      >
                        <option value="easy">Casual</option>
                        <option value="regular">Rival</option>
                        <option value="elite">Sweaty</option>
                      </select>
                    </label>
                  </div>
                  <button
                    id="play-button"
                    className="slap-primary slap-play"
                    disabled={!s.ready}
                    onClick={() => start()}
                  >
                    {s.error
                      ? "WEBGL UNAVAILABLE"
                      : s.ready
                        ? "ENTER THE ARENA"
                        : "PREPARING ARENA…"}{" "}
                    <span>↗</span>
                  </button>
                  <div className="slap-secondary">
                    <OnlineButton />
                    <button
                      id="range-button"
                      disabled={!s.ready}
                      onClick={() => start(true)}
                    >
                      Practice ↗
                    </button>
                  </div>
                  <small className="slap-local-note">
                    Play with bots instantly. Multiplayer uses browser-hosted
                    rooms.
                  </small>
                </>
              ) : (
                <div className="slap-progression">
                  <small>NEXT MILESTONE</small>
                  <strong>
                    {next
                      ? `${next.name} · ${next.cost} slaps`
                      : "Collection complete"}
                  </strong>
                  <div>
                    <i
                      style={{
                        width: `${next ? Math.min(100, (profile.slaps / next.cost) * 100) : 100}%`,
                      }}
                    />
                  </div>
                  <p>
                    {next
                      ? `${next.cost - profile.slaps} earned slaps to go`
                      : "Every glove is unlocked."}
                  </p>
                </div>
              )}
              <div className="slap-controls">
                <span>
                  <kbd>W A S D</kbd> Move
                </span>
                <span>
                  <kbd>V / WHEEL</kbd> View / zoom
                </span>
                <span>
                  <kbd>LMB</kbd> Slap
                </span>
                <span>
                  <kbd>E</kbd> Ability
                </span>
                <span>
                  <kbd>C / SHIFT</kbd> Slide
                </span>
                <span>
                  <kbd>SPACE</kbd> Jump
                </span>
              </div>
            </section>
            <section
              className="slap-showcase"
              style={{ "--glove": glove.color }}
            >
              <div className="slap-showcase-top">
                <span>
                  {tab === "play" ? "YOUR SIGNATURE GLOVE" : "THE COLLECTION"}
                </span>
                <b>
                  {
                    Object.values(GLOVES).filter((g) => g.cost <= profile.slaps)
                      .length
                  }{" "}
                  / {GLOVE_ROSTER.length} UNLOCKED
                </b>
              </div>
              <div className="slap-model-stage">
                <div className="slap-orbit" />
                <span className="glove-preview-hint">
                  DRAG TO EXPLORE · ORIGINAL 3D MODEL
                </span>
                <span className="slap-model-name">{glove.name}</span>
                <Preview id={inspect} />
                <span className="slap-model-label">
                  ORIGINAL 3D GLOVE · {glove.activation.toUpperCase()}
                </span>
              </div>
              <div className="slap-glove-details">
                <div>
                  <span className="slap-kicker">{glove.ability}</span>
                  <h2>
                    {glove.name}
                    <span>
                      {glove.cost === 0 ? "STARTER" : `${glove.cost} SLAPS`}
                    </span>
                  </h2>
                </div>
                <p>{glove.description}</p>
                <div className="slap-glove-stats">
                  <span>
                    DAMAGE <b>{glove.damage}</b>
                  </span>
                  <span>
                    REACH <b>{glove.range}m</b>
                  </span>
                  <span>
                    RECOVERY <b>{glove.interval}s</b>
                  </span>
                </div>
                {profile.slaps < glove.cost ? (
                  <button className="slap-equip locked" disabled>
                    ⌑ {glove.cost - profile.slaps} more slaps to unlock
                  </button>
                ) : (
                  <button
                    className={`slap-equip ${profile.selected === inspect ? "equipped" : ""}`}
                    onClick={equip}
                  >
                    {profile.selected === inspect
                      ? "✓ EQUIPPED"
                      : "EQUIP GLOVE →"}
                  </button>
                )}
              </div>
            </section>
          </div>
          <section className="slap-collection">
            <header>
              <span>CHOOSE YOUR HAND</span>
              <small>Abilities change the fight. Not just the color.</small>
              <button
                onClick={() => setTab(tab === "play" ? "gloves" : "play")}
              >
                {tab === "play" ? "VIEW PROGRESSION ↗" : "BACK TO PLAY ↗"}
              </button>
            </header>
            <div className="slap-collection-tools">
              <label className="slap-search">
                ⌕{" "}
                <input
                  aria-label="Search gloves"
                  placeholder="Search gloves, abilities, playstyles…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <div
                className="slap-ownership"
                role="group"
                aria-label="Collection availability"
              >
                {[
                  ["all", "All gloves"],
                  ["unlocked", "Unlocked"],
                  ["locked", "Locked"],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    aria-pressed={ownership === id}
                    className={ownership === id ? "active" : ""}
                    onClick={() => setOwnership(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <select
                aria-label="Glove playstyle"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="all">Every playstyle</option>
                {["Power", "Mobility", "Control", "Defense"].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <select
                aria-label="Sort gloves"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
              >
                <option value="cost">Slaps · low to high</option>
                <option value="name">Name · A–Z</option>
              </select>
            </div>
            <div className="slap-collection-meta">
              <span>
                {visibleGloves.length} / {GLOVE_ROSTER.length} GLOVES
              </span>
              <span>
                {next
                  ? `NEXT UNLOCK: ${next.name.toUpperCase()} · ${next.cost - profile.slaps} SLAPS TO GO`
                  : "COLLECTION COMPLETE"}
              </span>
            </div>
            <div className="slap-glove-grid">
              {visibleGloves.map((g) => (
                <button
                  key={g.id}
                  aria-label={`${g.name} glove${profile.slaps < g.cost ? " locked" : ""}`}
                  className={`${inspect === g.id ? "selected" : ""} ${profile.slaps < g.cost ? "locked" : ""}`}
                  style={{ "--glove": g.color }}
                  onClick={() => pick(g.id)}
                >
                  <span className="slap-card-state">
                    {profile.selected === g.id
                      ? "EQUIPPED"
                      : profile.slaps < g.cost
                        ? "LOCKED"
                        : "UNLOCKED"}
                  </span>
                  <Hand glove={g} />
                  <strong>{g.name}</strong>
                  <small>{g.cost === 0 ? "FREE" : `${g.cost} SLAPS`}</small>
                  <i>{g.ability}</i>
                  <div className="slap-unlock-meter" aria-hidden="true">
                    <span
                      style={{
                        width: `${g.cost ? Math.min(100, (profile.slaps / g.cost) * 100) : 100}%`,
                      }}
                    />
                  </div>
                </button>
              ))}
            </div>
            {!visibleGloves.length && (
              <div className="slap-empty">
                No gloves match.{" "}
                <button
                  onClick={() => {
                    setQuery("");
                    setCategory("all");
                    setOwnership("all");
                  }}
                >
                  Clear filters
                </button>
              </div>
            )}
          </section>
          <footer className="slap-footer">
            <span>
              SLAP ARENA <i> / </i> SKILL OVER FIREPOWER.
            </span>
            <span>
              Fan-made · Slap Battles-inspired · Original models & arena tuning
            </span>
          </footer>
        </main>
      )}
      {playing && <MatchHUD h={h} profile={profile} />}
      {playing && s.paused && !s.settingsOpen && (
        <div className="slap-modal-back">
          <section className="slap-modal">
            <span className="slap-kicker">TAKE A BREATHER</span>
            <h2>Paused.</h2>
            <p>
              {game?.network
                ? "Your online match continues while this menu is open."
                : "Your offline match is paused."}
            </p>
            <button
              id="resume-button"
              className="slap-primary"
              onClick={() => game.resume()}
            >
              Back to the fight ↗
            </button>
            <button
              className="slap-outline"
              onClick={() => actions.settings(true)}
            >
              Settings
            </button>
            <button className="slap-outline" onClick={() => game.quit()}>
              Leave arena
            </button>
          </section>
        </div>
      )}
      {s.setup && (
        <div className="slap-modal-back">
          <section className="slap-modal">
            <span className="slap-kicker">NEXT ROUND · CHOOSE ONE GLOVE</span>
            <h2>Switch your style.</h2>
            <div className="slap-round-gloves">
              {GLOVE_ROSTER.map((g) => (
                <button
                  disabled={g.cost > profile.slaps}
                  className={inspect === g.id ? "active" : ""}
                  key={g.id}
                  onClick={() => pick(g.id)}
                >
                  {g.name}
                  <small>
                    {g.cost > profile.slaps ? `${g.cost} SLAPS` : g.ability}
                  </small>
                </button>
              ))}
            </div>
            <button
              className="slap-primary"
              onClick={equip}
              disabled={glove.cost > profile.slaps}
            >
              Fight with {glove.name} ↗
            </button>
            <button
              className="slap-outline"
              onClick={() => {
                game.finishSelection();
                ui.set({ setup: null });
              }}
            >
              Keep current glove
            </button>
          </section>
        </div>
      )}
      {s.screen === "results" && (
        <div className="slap-modal-back">
          <section className="slap-modal slap-results">
            <span className="slap-kicker">MATCH COMPLETE</span>
            <h2>{s.result?.won ? "HANDS DOWN." : "RUN IT BACK."}</h2>
            <strong>{s.result?.score.join(" — ")}</strong>
            <div className="slap-result-stats">
              <span>
                <b>{s.result?.stats.slaps ?? s.result?.stats.hits ?? 0}</b>SLAPS
                EARNED
              </span>
              <span>
                <b>{s.result?.stats.kills || 0}</b>ELIMINATIONS
              </span>
              <span>
                <b>{profile.slaps}</b>TOTAL SLAPS
              </span>
            </div>
            <p>
              Confirmed hits and Dual bonus slaps are already saved to your
              progression.
            </p>
            <button
              id="rematch-button"
              className="slap-primary"
              onClick={() =>
                game.network
                  ? game.network.returnToLobby()
                  : game.start({
                      ...game.config,
                      loadout: gloveLoadout(profile.selected),
                      capture: true,
                      range: false,
                    })
              }
            >
              {game?.network ? "Return to online lobby ↗" : "Play again ↗"}
            </button>

            <button
              className="slap-outline"
              onClick={() => {
                game.quit();
                setTab("gloves");
              }}
            >
              Back to gloves ↗
            </button>
          </section>
        </div>
      )}
      {s.settingsOpen && <Settings s={s} />}
      {s.toast && (
        <div className="slap-toast" role="status">
          {s.toast}
        </div>
      )}
      <Multiplayer
        ready={s.ready}
        playing={playing}
        loadout={gloveLoadout(profile.selected)}
        gloves
        profile={profile}
      />
    </div>
  );
}
