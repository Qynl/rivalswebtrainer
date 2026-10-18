import { OnlineButton } from "./net/Multiplayer.jsx";
import React from "react";
import { Hud } from "./ui-hud.jsx";
// Declarative layout retained from the original UI; content and handlers are React-owned.
export function Layout({ bind, content }) {
  return (
    <>
      {" "}
      <canvas id="game-canvas" aria-label="3D arena" {...bind["game-canvas"]} />
      <div id="lobby" className="screen" {...bind["lobby"]}>
        <header className="topbar">
          <a
            className="brand"
            href="#"
            aria-label="Rivals home"
            {...bind["brand"]}
          >
            <span className="brand-mark">{"R"}</span>
            <span>
              {"RIVALS"}
              <span className="brand-sub">{"OFFLINE + ONLINE"}</span>
            </span>
          </a>
          <nav>
            <button
              className="nav-item active"
              data-tab="play"
              {...bind["tab-play"]}
            >
              {"PLAY"}
            </button>
            <button
              className="nav-item"
              data-tab="training"
              aria-controls="training-tab"
              {...bind["tab-training"]}
            >
              {"TRAIN"}
            </button>
            <button
              className="nav-item"
              data-tab="loadout"
              {...bind["tab-loadout"]}
            >
              {"\n            LOADOUT "}
              <span className="nav-dot"></span>
            </button>
            <button
              className="nav-item"
              data-tab="guide"
              {...bind["tab-guide"]}
            >
              {"FIELD GUIDE"}
            </button>
          </nav>
          <div className="top-right">
            <span className="offline-status">
              <i></i>
              {" ALL SYSTEMS LOCAL"}
            </span>
            <button
              className="icon-button"
              id="settings-open"
              title="Settings"
              aria-label="Settings"
              {...bind["settings-open"]}
            >
              {"\n            \u2699"}
            </button>
            <span className="avatar">
              {"YOU"}
              <span></span>
            </span>
          </div>
        </header>
        <main id="play-tab" className="tab-content" {...bind["play-tab"]}>
          <div className="eyebrow">
            <span className="live-dot"></span>
            {" YOUR ARENA. YOUR RULES.\n        "}
          </div>
          <h1>
            {"LOCK IN."}
            <br />
            {"JUST "}
            <span>{"RIVALS."}</span>
          </h1>
          <p className="hero-description">
            {"Train offline. Challenge friends online."}
            <br />
            {"Sharp aim. Clean movement. Your arena.\n        "}
          </p>
          <div className="hero-tags">
            <span>
              <i className="tag-icon">{"\u25c9"}</i>
              {" OFFLINE BOTS + ONLINE LOBBIES"}
            </span>
            <span>
              <i className="tag-icon">{"\u2301"}</i>
              {" SKILL-BASED BOTS"}
            </span>
            <span>
              <i className="tag-icon">{"\u2197"}</i>
              {" ALL WEAPONS UNLOCKED"}
            </span>
          </div>
          <div className="arena-label">
            <span className="label-line"></span>
            <div>
              <small>{"ARENA PREVIEW"}</small>
              <strong id="preview-name" {...bind["preview-name"]}>
                {content["preview-name"]}
              </strong>
              <span>{"Reference-style block arena \u00b7 Angled cover"}</span>
            </div>
          </div>
          <div className="match-panel">
            <div className="panel-heading">
              <span className="section-number">{"01 /"}</span>
              <h2>{"BUILD YOUR MATCH"}</h2>
              <span className="local-badge">{"LOCAL SESSION"}</span>
            </div>
            <div className="match-options">
              <div className="option-block">
                <label>{"GAME MODE"}</label>
                <div
                  className="segmented"
                  id="mode-options"
                  {...bind["mode-options"]}
                >
                  <button
                    className="selected"
                    data-mode="1"
                    {...bind["mode-1"]}
                  >
                    {"\n                  1v1 "}
                    <small>{"DUEL"}</small>
                  </button>
                  <button data-mode="2" {...bind["mode-2"]}>
                    {"2v2 "}
                    <small>{"TEAMS"}</small>
                  </button>
                  <button data-mode="3" {...bind["mode-3"]}>
                    {"3v3 "}
                    <small>{"TEAMS"}</small>
                  </button>
                </div>
              </div>
              <div className="option-block difficulty">
                <label>
                  {"BOT DIFFICULTY\n                "}
                  <span id="difficulty-hint" {...bind["difficulty-hint"]}>
                    {content["difficulty-hint"]}
                  </span>
                </label>
                <div
                  className="segmented"
                  id="difficulty-options"
                  {...bind["difficulty-options"]}
                >
                  <button
                    data-difficulty="rookie"
                    {...bind["difficulty-rookie"]}
                  >
                    {"ROOKIE"}
                  </button>
                  <button
                    className="selected"
                    data-difficulty="regular"
                    {...bind["difficulty-regular"]}
                  >
                    {"\n                  REGULAR"}
                  </button>
                  <button
                    data-difficulty="veteran"
                    {...bind["difficulty-veteran"]}
                  >
                    {"VETERAN"}
                  </button>
                  <button data-difficulty="elite" {...bind["difficulty-elite"]}>
                    {"ELITE"}
                  </button>
                </div>
              </div>
              <div className="option-block map-selector">
                <label>{"ARENA"}</label>
                <button id="map-cycle" {...bind["map-cycle"]}>
                  <span className="map-icon">{"\u25a6"}</span>
                  <span id="map-name" {...bind["map-name"]}>
                    {content["map-name"]}
                  </span>
                  <span className="map-arrows">{"\u2039 \u00a0 \u203a"}</span>
                </button>
              </div>
              <button
                className="play-button"
                id="play-button"
                {...bind["play-button"]}
              >
                <span>
                  {"ENTER ARENA"}
                  <small>{"FIRST TO 5 WINS"}</small>
                </span>
                <span className="play-arrow">{"\u2197"}</span>
              </button>
            </div>
          </div>
          <div className="lower-row">
            <button
              className="range-card"
              id="range-button"
              {...bind["range-button"]}
            >
              <span className="range-symbol">{"\u25ce"}</span>
              <span>
                <strong>{"WARM UP IN THE RANGE"}</strong>
                <small>{"No stakes. Just you and your aim."}</small>
              </span>
              <span className="card-arrow">{"\u2197"}</span>
            </button>
            <OnlineButton />

            <div className="loadout-summary">
              <span className="mini-label">{"YOUR LOADOUT"}</span>
              <div id="loadout-mini" {...bind["loadout-mini"]}>
                {content["loadout-mini"]}
              </div>
              <button
                className="text-button"
                id="edit-loadout"
                {...bind["edit-loadout"]}
              >
                {"CUSTOMIZE \u2197"}
              </button>
            </div>
          </div>
        </main>
        <main
          id="training-tab"
          className="tab-content hidden"
          {...bind["training-tab"]}
        >
          <div className="training-intro">
            <div className="eyebrow">{"PRACTICE WITH A PURPOSE."}</div>
            <h1 className="page-title">
              {"TRAIN WITH "}
              <span>{"PURPOSE."}</span>
            </h1>
            <p className="hero-description">
              {"Short, focused drills. Honest results. Progress saved on this device."}
            </p>
            <p className="training-instructions">
              {"Desktop mouse and keyboard required. Start captures the mouse; Escape pauses and lets you leave early."}
            </p>
          </div>
          <section className="training-loadout" aria-label="Drill loadout">
            <div>
              <span className="mini-label">{"CURRENT LOADOUT"}</span>
              <strong id="training-loadout">{content["training-loadout"]}</strong>
              <small>{"Personal bests are compared only with this exact loadout."}</small>
            </div>
            <button
              className="text-button"
              id="training-edit-loadout"
              {...bind["training-edit-loadout"]}
            >
              {"CHANGE LOADOUT ↗"}
            </button>
          </section>
          <section
            className="training-grid"
            id="training-drills"
            aria-label="Available training drills"
          >
            {content["training-drills"]}
          </section>
          <section className="training-history-panel" aria-labelledby="training-history-title">
            <header>
              <div>
                <span className="section-number">{"YOUR RECENT RUNS"}</span>
                <h2 id="training-history-title">{"Progress, not guesswork."}</h2>
              </div>
              <div className="training-data-actions">
                <button
                  className="text-button"
                  id="training-export"
                  {...bind["training-export"]}
                >
                  {"EXPORT"}
                </button>
                <button
                  className="text-button"
                  id="training-import"
                  aria-controls="training-import-file"
                  {...bind["training-import"]}
                >
                  {"IMPORT"}
                </button>
                <input
                  id="training-import-file"
                  type="file"
                  accept="application/json,.json"
                  hidden
                  {...bind["training-import-file"]}
                />
                <button
                  className="text-button"
                  id="training-reset"
                  {...bind["training-reset"]}
                >
                  {"CLEAR"}
                </button>
              </div>
            </header>
            <div id="training-history">{content["training-history"]}</div>
          </section>
          <p className="training-privacy">
            {"Runs stay in this browser's local storage. Export and import are manual; nothing is uploaded."}
          </p>
        </main>
        <main
          id="loadout-tab"
          className="tab-content hidden"
          {...bind["loadout-tab"]}
        >
          <div className="eyebrow">{"THE RIGHT TOOLS. YOUR PLAYSTYLE."}</div>
          <h1 className="page-title">
            {"MAKE IT "}
            <span>{"YOURS."}</span>
          </h1>
          <p className="hero-description">
            {
              "\n          Four slots. Endless ways to win. Everything unlocked.\n        "
            }
          </p>
          <div className="loadout-workbench">
            <div className="slot-tabs" id="slot-tabs" {...bind["slot-tabs"]}>
              {content["slot-tabs"]}
            </div>
            <div
              className="weapon-grid"
              id="weapon-grid"
              {...bind["weapon-grid"]}
            >
              {content["weapon-grid"]}
            </div>
            <aside
              className="weapon-detail"
              id="weapon-detail"
              {...bind["weapon-detail"]}
            >
              {content["weapon-detail"]}
            </aside>
          </div>
          <div className="loadout-bottom">
            <span>{"Loadout saved automatically, locally."}</span>
            <button
              className="solid-button"
              id="loadout-done"
              {...bind["loadout-done"]}
            >
              {"\n            READY TO PLAY \u2197\n          "}
            </button>
          </div>
        </main>
        <main
          id="guide-tab"
          className="tab-content hidden"
          {...bind["guide-tab"]}
        >
          <div className="eyebrow">{"MOVE SMART. HIT HARD."}</div>
          <h1 className="page-title">
            {"KNOW YOUR "}
            <span>{"GAME."}</span>
          </h1>
          <section className="guide-start-card" aria-labelledby="guide-start-title">
            <div>
              <span className="section-number">START HERE · NO ACCOUNT NEEDED</span>
              <h2 id="guide-start-title">Build a practice loop.</h2>
              <p>Set up your keys, warm up without a timer, then try one short drill. Your results stay in this browser.</p>
            </div>
            <div className="guide-start-actions">
              <button className="outline-button" id="guide-open-settings" {...bind["guide-open-settings"]}>SET UP CONTROLS</button>
              <button className="outline-button" id="guide-open-range" {...bind["guide-open-range"]}>WARM UP IN RANGE</button>
              <button className="solid-button" id="guide-open-training" {...bind["guide-open-training"]}>OPEN TRAINING</button>
            </div>
          </section>
          <div className="guide-grid">
            <section>
              <span className="section-number">{"01 / MOVEMENT"}</span>
              <h2>{"Keep them guessing."}</h2>
              <p>
                {
                  "\n              Auto-sprint is always on. Chain slides and jumps to stay\n              unpredictable. Equip Fists or Bow for a second jump in midair. Use\n              ramps to launch uphill slide jumps. Air movement steers in any\n              direction, including backwards.\n            "
                }
              </p>
              <dl>{content["guide-movement-controls"]}</dl>
            </section>
            <section>
              <span className="section-number">{"02 / COMBAT"}</span>
              <h2>{"Make every shot count."}</h2>
              <p>
                {
                  "\n              Aim for the head. Use cover when reloading. Your secondary is\n              faster than waiting for a fresh magazine.\n            "
                }
              </p>
              <dl>{content["guide-combat-controls"]}</dl>
            </section>
            <section>
              <span className="section-number">{"03 / THE DUEL"}</span>
              <h2>{"First to five."}</h2>
              <p>
                {
                  "\n              Eliminate the opposing team to win a round. Every round starts\n              with full health and fresh ammunition. If time runs out, the team\n              with more remaining health wins.\n            "
                }
              </p>
              <div className="guide-note">
                {"\n              BOTS THAT FIGHT BACK"}
                <span>
                  {
                    "Higher difficulties react faster, aim more precisely, and use\n                aggressive movement. Bots still need line of sight to\n                fire."
                  }
                </span>
              </div>
              <div className="guide-note">
                {"\n              PRACTICE MAKES PROGRESS"}
                <span>
                  {
                    "The range tracks shots, hits, accuracy and eliminations. Your\n                best match results stay on this device."
                  }
                </span>
              </div>
            </section>
          </div>
        </main>
        <footer>
          <span>
            <i className="live-dot"></i>
            {" NO CONNECTION REQUIRED"}
          </span>
          <span>
            {
              "Independent fan-made trainer. Not affiliated with Roblox or Nosniy\n          Games."
            }
          </span>
          <span>
            {"v1.0 "}
            <span className="footer-divider">{"/"}</span>
            {" BUILT FOR THE GRIND"}
          </span>
        </footer>
      </div>
      <Hud />
      <div id="pause" className="overlay hidden" {...bind["pause"]}>
        <div className="modal">
          <span className="eyebrow">{"TAKE A BREATHER"}</span>
          <h2>
            {"MATCH PAUSED"}
            <span>{"."}</span>
          </h2>
          <p>{"Pick up right where you left off."}</p>
          <button
            className="solid-button"
            id="resume-button"
            {...bind["resume-button"]}
          >
            {"\n          BACK TO THE ARENA \u2197"}
          </button>
          <button
            className="outline-button"
            id="pause-settings"
            {...bind["pause-settings"]}
          >
            {"SETTINGS"}
          </button>
          <button
            className="text-button"
            id="quit-button"
            {...bind["quit-button"]}
          >
            {"LEAVE MATCH"}
          </button>
        </div>
      </div>
      <div
        id="match-setup"
        className="overlay hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="setup-title"
        {...bind["match-setup"]}
      >
        <section className="setup-modal">
          <header className="setup-header">
            <div>
              <span className="eyebrow">{"BEFORE THE DUEL"}</span>
              <h2 id="setup-title" {...bind["setup-title"]}>
                {content["setup-title"]}
              </h2>
            </div>
            <button
              id="setup-close"
              className="icon-button"
              aria-label="Cancel loadout selection"
              {...bind["setup-close"]}
            >
              {"\n            \u2715\n          "}
            </button>
          </header>
          <nav
            id="setup-steps"
            aria-label="Loadout steps"
            {...bind["setup-steps"]}
          >
            {content["setup-steps"]}
          </nav>
          <div className="setup-body">
            <div id="setup-grid" className="setup-grid" {...bind["setup-grid"]}>
              {content["setup-grid"]}
            </div>
            <aside className="setup-detail">
              <canvas
                id="setup-preview"
                aria-label="Selected weapon 3D preview"
                {...bind["setup-preview"]}
              />
              <h3 id="setup-weapon-name" {...bind["setup-weapon-name"]}>
                {content["setup-weapon-name"]}
              </h3>
              <p id="setup-description" {...bind["setup-description"]}>
                {content["setup-description"]}
              </p>
              <div id="setup-specs" {...bind["setup-specs"]}>
                {content["setup-specs"]}
              </div>
            </aside>
          </div>
          <footer className="setup-footer">
            <button
              id="setup-back"
              className="outline-button"
              {...bind["setup-back"]}
            >
              {"BACK"}
            </button>
            <span id="setup-summary" {...bind["setup-summary"]}>
              {content["setup-summary"]}
            </span>
            <button
              id="setup-next"
              className="primary-button"
              {...bind["setup-next"]}
            >
              {content["setup-next"]}
            </button>
          </footer>
        </section>
      </div>
      <div id="results" className="overlay hidden" {...bind["results"]}>
        <div className="modal results-modal">
          <span
            className="eyebrow"
            id="result-eyebrow"
            {...bind["result-eyebrow"]}
          >
            {content["result-eyebrow"]}
          </span>
          <h2 id="result-title" {...bind["result-title"]}>
            {content["result-title"]}
          </h2>
          <div
            className="result-score"
            id="result-score"
            {...bind["result-score"]}
          >
            {content["result-score"]}
          </div>
          <p id="result-description" {...bind["result-description"]}>
            {content["result-description"]}
          </p>
          <div id="result-stats" {...bind["result-stats"]}>
            {content["result-stats"]}
          </div>
          <button
            className="solid-button"
            id="rematch-button"
            {...bind["rematch-button"]}
          >
            {"RUN IT BACK \u2197"}
          </button>
          <button
            className="outline-button"
            id="results-lobby"
            {...bind["results-lobby"]}
          >
            {"\n          BACK TO LOBBY\n        "}
          </button>
        </div>
      </div>
      <div
        id="drill-results"
        className="overlay hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drill-result-title"
        {...bind["drill-results"]}
      >
        <div className="modal drill-result-modal">
          <span className="eyebrow" id="drill-result-eyebrow">
            {content["drill-result-eyebrow"]}
          </span>
          <h2 id="drill-result-title">{content["drill-result-title"]}</h2>
          <div className="drill-result-score">
            <strong id="drill-result-score">{content["drill-result-score"]}</strong>
            <span id="drill-result-score-label">
              {content["drill-result-score-label"]}
            </span>
          </div>
          <p className="drill-result-best" id="drill-result-best">
            {content["drill-result-best"]}
          </p>
          <div className="drill-result-metrics" id="drill-result-metrics">
            {content["drill-result-metrics"]}
          </div>
          <section className="drill-weapon-breakdown" aria-labelledby="drill-weapon-title">
            <h3 id="drill-weapon-title">WEAPON BREAKDOWN</h3>
            <div id="drill-result-analytics">
              {content["drill-result-analytics"]}
            </div>
            <p>
              Hit events count each shot/attack once when it connects; ADS/movement hit counts use that same per-action rule. Pellet contacts, splash hits, and ongoing area ticks stay separate; range is in original trainer units.
            </p>
          </section>
          <p className="drill-result-coaching" id="drill-result-coaching">
            {content["drill-result-coaching"]}
          </p>
          <button
            className="solid-button"
            id="drill-again"
            {...bind["drill-again"]}
          >
            {"RUN IT BACK ↗"}
          </button>
          <button
            className="outline-button"
            id="drill-lobby"
            {...bind["drill-lobby"]}
          >
            {"BACK TO TRAINING"}
          </button>
        </div>
      </div>
      <div id="settings" className="overlay hidden" {...bind["settings"]}>
        <div className="modal settings-modal">
          <div className="modal-heading">
            <h2>
              {"SETTINGS"}
              <span>{"."}</span>
            </h2>
            <button
              className="icon-button"
              id="settings-close"
              aria-label="Close settings"
              {...bind["settings-close"]}
            >
              {"\n            \u00d7\n          "}
            </button>
          </div>
          <label>
            {"Mouse sensitivity "}
            <output id="sens-value" {...bind["sens-value"]}>
              {content["sens-value"]}
            </output>
            <input
              id="sensitivity"
              type="range"
              min="0.3"
              max="3"
              step="0.1"
              {...bind["sensitivity"]}
            />
          </label>
          <label>
            {"Field of view "}
            <output id="fov-value" {...bind["fov-value"]}>
              {content["fov-value"]}
            </output>
            <input
              id="fov"
              type="range"
              min="70"
              max="110"
              step="1"
              {...bind["fov"]}
            />
          </label>
          <label>
            {"Sound volume "}
            <output id="volume-value" {...bind["volume-value"]}>
              {content["volume-value"]}
            </output>
            <input
              id="volume"
              type="range"
              min="0"
              max="100"
              step="5"
              {...bind["volume"]}
            />
          </label>
          <label className="toggle-label">
            {"Show FPS counter"}
            <input id="show-fps" type="checkbox" {...bind["show-fps"]} />
          </label>
          <label className="toggle-label">
            {"Screen shake"}
            <input
              id="screen-shake"
              type="checkbox"
              {...bind["screen-shake"]}
            />
          </label>
          <label className="toggle-label">
            {"Speed-based field of view"}
            <input id="dynamic-fov" type="checkbox" {...bind["dynamic-fov"]} />
          </label>
          <label className="toggle-label">
            {"Performance mode "}
            <input
              id="performance-mode"
              type="checkbox"
              {...bind["performance-mode"]}
            />
          </label>
          <section className="control-settings" aria-labelledby="control-settings-title">
            <div className="control-settings-heading">
              <h3 id="control-settings-title">KEY BINDINGS</h3>
              <button className="text-button" id="controls-reset" type="button" {...bind["controls-reset"]}>
                RESET
              </button>
            </div>
            <div id="control-bindings">{content["control-bindings"]}</div>
            <p id="control-rebind-status" role="status" aria-live="polite">
              {content["control-rebind-status"]}
            </p>
          </section>
          <div className="settings-note">
            {
              "\n          Settings are saved on this device. Headphones recommended.\n        "
            }
          </div>
          <button
            className="solid-button"
            id="settings-done"
            {...bind["settings-done"]}
          >
            {"LOOKS GOOD \u2197"}
          </button>
        </div>
      </div>
      <div id="toast" className="hidden" role="status" aria-live="polite" {...bind["toast"]}>
        {content["toast"]}
      </div>{" "}
      <div id="startup-status" role="status" {...bind["startup-status"]}>
        {content["startup-status"]}
      </div>
    </>
  );
}
