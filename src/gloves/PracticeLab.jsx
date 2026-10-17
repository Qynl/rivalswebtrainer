import React, { useState } from "react";
import { GLOVE_ROSTER } from "./catalog.js";
import {
  PRACTICE_MODES,
  configurePractice,
  resetPractice,
} from "./practice.js";
export function PracticeLab({ game, stats }) {
  const [options, setOptions] = useState(() => ({
    ...game.practiceOptions,
    glove: game.loadout[0],
  }));
  const change = (key, value) =>
    setOptions((old) => ({ ...old, [key]: value }));
  return (
    <section className="slap-practice-lab" aria-label="Practice lab">
      <header>
        <span className="slap-kicker">PRACTICE LAB</span>
        <small>R to reset instantly</small>
      </header>
      <div className="slap-lab-stats">
        <span>
          <b>{Math.round(stats?.damage || 0)}</b>DAMAGE
        </span>
        <span>
          <b>{stats?.contacts || 0}</b>SLAPS LANDED
        </span>
        <span>
          <b>
            {(stats?.peak || 0).toFixed(1)}
            <small> m/s</small>
          </b>
          PEAK LAUNCH
        </span>
      </div>
      <div className="slap-lab-fields">
        <label>
          Your glove
          <select
            aria-label="Training glove"
            value={options.glove}
            onChange={(e) => change("glove", e.target.value)}
          >
            {GLOVE_ROSTER.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Behaviour
          <select
            aria-label="Practice behaviour"
            value={options.mode}
            onChange={(e) => change("mode", e.target.value)}
          >
            {Object.entries(PRACTICE_MODES).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Targets
          <select
            aria-label="Practice target count"
            value={options.count}
            onChange={(e) => change("count", +e.target.value)}
          >
            {[1, 3, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {options.mode === "sparring" && (
          <label>
            Opponent glove
            <select
              aria-label="Opponent glove"
              value={options.opponent}
              onChange={(e) => change("opponent", e.target.value)}
            >
              {GLOVE_ROSTER.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <p>
        Sandbox setup borrows any glove. No unlocks or saved rewards. Fighting
        opponents use real damage and respawn you after a knockout.
      </p>
      <div className="slap-lab-buttons">
        <button onClick={() => configurePractice(game, options)}>
          Apply sandbox setup
        </button>
        <button onClick={() => resetPractice(game)}>
          Reset targets & health
        </button>
      </div>
    </section>
  );
}
