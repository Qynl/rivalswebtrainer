import React from "react";
import { GLOVES } from "./catalog.js";
export function Scoreboard({ rows, team = 0, score, round }) {
  return (
    <section className="slap-scoreboard" aria-label="Match scoreboard">
      <header>
        <div>
          <span className="slap-kicker">MATCH ROSTER</span>
          <h2>{round}</h2>
        </div>
        <strong>
          {score?.[0] || 0}
          <small>FIRST TO 5</small>
          {score?.[1] || 0}
        </strong>
      </header>
      {[team, 1 - team].map((side) => (
        <div className={`slap-roster-team team-${side}`} key={side}>
          <h3>
            {side === team ? "YOUR TEAM" : "RIVALS"}
            <small>
              {rows.filter((p) => p.team === side && p.alive).length} STANDING
            </small>
          </h3>
          <table>
            <thead>
              <tr>
                <th>PLAYER</th>
                <th>GLOVE</th>
                <th>K / D</th>
                <th>SLAPS</th>
              </tr>
            </thead>
            <tbody>
              {rows
                .filter((p) => p.team === side)
                .map((p) => (
                  <tr
                    key={p.id}
                    className={`${p.self ? "self" : ""} ${p.alive ? "" : "eliminated"}`}
                  >
                    <td>
                      <span
                        className={`slap-roster-dot ${p.alive ? "alive" : "out"}`}
                      />
                      <b>{p.name}</b>
                      {p.self && p.name !== "YOU" && <small>YOU</small>}
                      <em>
                        {p.alive
                          ? p.health === null
                            ? "IN PLAY"
                            : `${p.health} HP`
                          : "ELIMINATED"}
                      </em>
                    </td>
                    <td style={{ color: GLOVES[p.glove]?.color }}>
                      {GLOVES[p.glove]?.name || "Glove"}
                    </td>
                    <td>
                      {p.kills} / {p.deaths}
                    </td>
                    <td>{p.slaps}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ))}
      <footer>
        Hold TAB to view · Match continues · Slaps are confirmed, not estimated
      </footer>
    </section>
  );
}
