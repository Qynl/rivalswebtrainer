import React, {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { multiplayer } from "./client.js";
import { WEAPONS, MAPS, SLOT_NAMES, loadSaved, save } from "../data.js";
import { ONLINE_MAPS } from "./protocol.js";
const mapName = (id) => MAPS.find((m) => m.id === id)?.name || id;
export function OnlineButton() {
  return (
    <button
      id="multiplayer-button"
      className="outline-button online-entry"
      onClick={() => multiplayer.open()}
    >
      <span className="online-dot" />
      MULTIPLAYER <small>LOBBIES · 1v1–3v3 ↗</small>
    </button>
  );
}
export function Multiplayer({ ready, playing, loadout }) {
  const s = useSyncExternalStore(
      multiplayer.subscribe,
      multiplayer.getSnapshot,
    ),
    [name, setName] = useState(() => loadSaved("rivals-online-name", "PLAYER")),
    [code, setCode] = useState(
      () =>
        new URLSearchParams(location.search).get("lobby")?.slice(0, 6) || "",
    ),
    [map, setMap] = useState("blockout"),
    [privateRoom, setPrivate] = useState(false),
    [copied, setCopied] = useState(false),
    panel = useRef(null),
    first = useRef(true);
  useEffect(() => {
    if (ready && first.current) {
      first.current = false;
      if (code) multiplayer.open();
    }
  }, [ready]);
  useEffect(() => {
    if (!s.open) return;
    const previous = document.activeElement;
    requestAnimationFrame(() =>
      panel.current?.querySelector("button,input,select")?.focus(),
    );
    const key = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        multiplayer.hide();
      }
      if (e.key === "Tab") {
        const items = [
          ...(panel.current?.querySelectorAll(
            "button:not([disabled]),input:not([disabled]),select:not([disabled])",
          ) || []),
        ];
        if (!items.length) return;
        const first = items[0],
          last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("keydown", key, true);
      previous?.focus?.();
    };
  }, [s.open]);
  const room = s.room,
    self = room?.players.find((p) => p.id === s.id),
    host = room?.host === s.id,
    connected = s.status === "connected",
    lobby = room?.phase === "lobby",
    send = (packet) => {
      multiplayer.patch({ error: "" });
      multiplayer.send(packet);
    },
    identity = () => {
      save("rivals-online-name", name);
      return { name, loadout };
    };
  const teams = [0, 1].map(
      (team) => room?.players.filter((p) => p.team === team) || [],
    ),
    canStart =
      room &&
      teams[0].length > 0 &&
      teams[0].length === teams[1].length &&
      room.players.every((p) => p.ready);
  async function copyInvite() {
    try {
      const url = new URL(location.href);
      url.search = "";
      url.searchParams.set("lobby", room.code);
      await navigator.clipboard.writeText(url.toString());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      multiplayer.patch({ error: `Copy this lobby code: ${room.code}` });
    }
  }
  return (
    <>
      {playing && connected && room && (
        <div
          className="network-status"
          title="Server round trip; interpolation adds a short jitter buffer"
        >
          <span className="online-dot" />
          {s.transport === "geckos" ? "GECKOS · UDP" : "ONLINE · WS"}
          <b className={s.ping > 180 ? "high-ping" : ""}>{s.ping} ms</b>
        </div>
      )}
      {s.open && (
        <div
          className="mp-overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) multiplayer.hide();
          }}
        >
          <section
            className="mp-panel"
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby="mp-title"
          >
            <header className="mp-heading">
              <div>
                <span className="mp-eyebrow">PLAY TOGETHER / ONLINE</span>
                <h2 id="mp-title">
                  {room ? "YOUR LOBBY" : "FIND YOUR RIVALS"}
                  <span>.</span>
                </h2>
              </div>
              <button
                className="icon-button"
                aria-label="Close multiplayer"
                onClick={() => multiplayer.hide()}
              >
                ×
              </button>
            </header>
            <div className="mp-connection">
              <span
                className={connected ? "online-dot" : "online-dot offline"}
              />
              {s.status === "connecting"
                ? "CONNECTING…"
                : connected
                  ? `${s.transport === "geckos" ? "GECKOS.IO / WEBRTC" : "WEBSOCKET / COMPATIBILITY"} · ${s.ping} MS`
                  : s.status === "error"
                    ? "SERVER UNAVAILABLE"
                    : "NOT CONNECTED"}
              {!connected && s.status !== "connecting" && (
                <button onClick={() => multiplayer.connect()}>RETRY ↗</button>
              )}
            </div>
            {s.error && (
              <div className="mp-error" role="alert">
                {s.error}
              </div>
            )}
            {!room ? (
              <>
                <div className="mp-identity">
                  <label htmlFor="online-name">PLAYER NAME</label>
                  <input
                    id="online-name"
                    maxLength={20}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="YOUR NAME"
                    autoComplete="nickname"
                  />
                </div>
                <div className="mp-split">
                  <section>
                    <h3>
                      <span>01 /</span> JOIN A LOBBY
                    </h3>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        send({ type: "join", code, ...identity() });
                      }}
                      className="mp-join"
                    >
                      <input
                        aria-label="Lobby code"
                        placeholder="6-DIGIT CODE"
                        maxLength={6}
                        value={code}
                        onChange={(e) =>
                          setCode(
                            e.target.value
                              .toUpperCase()
                              .replace(/[^A-F0-9]/g, ""),
                          )
                        }
                      />
                      <button
                        className="solid-button"
                        disabled={!connected || !ready || code.length !== 6}
                      >
                        JOIN ↗
                      </button>
                    </form>
                    <div className="mp-list-heading">
                      PUBLIC LOBBIES
                      <button
                        disabled={!connected}
                        onClick={() => send({ type: "list" })}
                        aria-label="Refresh lobbies"
                      >
                        ↻
                      </button>
                    </div>
                    <div className="mp-lobby-list">
                      {!s.rooms.length ? (
                        <p>
                          {connected
                            ? "No open lobbies yet. Create one and invite a friend."
                            : "Connect to see available lobbies."}
                        </p>
                      ) : (
                        s.rooms.map((r) => (
                          <button
                            className="mp-room-card"
                            key={r.code}
                            disabled={
                              !connected || !ready || r.players >= r.capacity
                            }
                            onClick={() =>
                              send({
                                type: "join",
                                code: r.code,
                                ...identity(),
                              })
                            }
                          >
                            <span>
                              <strong>{r.name}</strong>
                              <small>
                                {mapName(r.map)} · {r.code}
                              </small>
                            </span>
                            <b>
                              {r.players}/{r.capacity} ↗
                            </b>
                          </button>
                        ))
                      )}
                    </div>
                  </section>
                  <section>
                    <h3>
                      <span>02 /</span> HOST A MATCH
                    </h3>
                    <label htmlFor="online-map">MAP</label>
                    <select
                      id="online-map"
                      value={map}
                      onChange={(e) => setMap(e.target.value)}
                    >
                      {ONLINE_MAPS.map((id) => (
                        <option key={id} value={id}>
                          {mapName(id)}
                        </option>
                      ))}
                    </select>
                    <label className="mp-private">
                      <input
                        type="checkbox"
                        checked={privateRoom}
                        onChange={(e) => setPrivate(e.target.checked)}
                      />
                      PRIVATE · CODE ONLY
                    </label>
                    <p className="mp-detail">
                      1v1, 2v2 or 3v3. First to five rounds. Pick any loadout,
                      choose teams, then ready up.
                    </p>
                    <button
                      id="create-lobby"
                      className="solid-button"
                      disabled={!connected || !ready}
                      onClick={() =>
                        send({
                          type: "create",
                          map,
                          private: privateRoom,
                          ...identity(),
                        })
                      }
                    >
                      CREATE LOBBY ↗
                    </button>
                  </section>
                </div>
              </>
            ) : (
              <>
                <div className="mp-room-top">
                  <div>
                    <label>
                      INVITE CODE {room.private ? "· PRIVATE" : "· PUBLIC"}
                    </label>
                    <strong className="mp-code" data-testid="room-code">
                      {room.code}
                    </strong>
                  </div>
                  <button className="outline-button" onClick={copyInvite}>
                    {copied ? "COPIED ✓" : "COPY INVITE ↗"}
                  </button>
                  <button
                    className="mp-leave"
                    onClick={() => multiplayer.leave()}
                  >
                    LEAVE
                  </button>
                </div>
                <div className="mp-teams">
                  {teams.map((members, team) => (
                    <section className={"mp-team team-" + team} key={team}>
                      <h3>
                        TEAM {team === 0 ? "BLUE" : "RED"}
                        <small>{members.length}/3</small>
                      </h3>
                      {members.map((p) => (
                        <div className="mp-player" key={p.id}>
                          <span className="mp-player-mark">
                            {p.name.slice(0, 1).toUpperCase()}
                          </span>
                          <strong>
                            {p.name}
                            <small>
                              {p.id === s.id ? "YOU · " : ""}
                              {p.id === room.host ? "HOST" : "PLAYER"}
                            </small>
                          </strong>
                          <b className={p.ready ? "ready" : "not-ready"}>
                            {p.ready ? "READY" : "WAITING"}
                          </b>
                        </div>
                      ))}
                      {!members.length && (
                        <p className="mp-empty">Waiting for a rival…</p>
                      )}
                      {lobby && self?.team !== team && (
                        <button
                          className="outline-button"
                          disabled={members.length >= 3}
                          onClick={() => send({ type: "team", team })}
                        >
                          JOIN TEAM
                        </button>
                      )}
                    </section>
                  ))}
                </div>
                <div className="mp-loadout">
                  <label>YOUR LOADOUT</label>
                  <div>
                    {[0, 1, 2, 3].map((slot) => (
                      <label key={slot}>
                        {SLOT_NAMES[slot]}
                        <select
                          aria-label={`Online ${SLOT_NAMES[slot]}`}
                          value={self?.loadout[slot] || loadout[slot]}
                          disabled={!lobby}
                          onChange={(e) => {
                            const next = [...self.loadout];
                            next[slot] = e.target.value;
                            send({ type: "loadout", loadout: next });
                          }}
                        >
                          {Object.entries(WEAPONS)
                            .filter(([, w]) => w.slot === slot)
                            .map(([id, w]) => (
                              <option key={id} value={id}>
                                {w.name}
                              </option>
                            ))}
                        </select>
                      </label>
                    ))}
                  </div>
                </div>
                <footer className="mp-room-actions">
                  <label>
                    MAP
                    <select
                      aria-label="Lobby map"
                      value={room.map}
                      disabled={!host || !lobby}
                      onChange={(e) =>
                        send({ type: "map", map: e.target.value })
                      }
                    >
                      {ONLINE_MAPS.map((id) => (
                        <option key={id} value={id}>
                          {mapName(id)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {!lobby ? (
                    <div className="mp-match-state">
                      {room.phase === "finished"
                        ? "MATCH COMPLETE"
                        : "MATCH IN PROGRESS"}
                      {host && room.phase === "finished" && (
                        <button
                          className="solid-button"
                          onClick={() => send({ type: "return" })}
                        >
                          RETURN TO LOBBY ↗
                        </button>
                      )}
                    </div>
                  ) : host ? (
                    <button
                      id="start-online"
                      className="solid-button"
                      disabled={!canStart}
                      onClick={() => send({ type: "start" })}
                    >
                      {canStart
                        ? "START MATCH ↗"
                        : "WAITING FOR EQUAL TEAMS + READY"}
                    </button>
                  ) : (
                    <button
                      id="ready-online"
                      className={
                        self?.ready ? "outline-button" : "solid-button"
                      }
                      onClick={() =>
                        send({ type: "ready", ready: !self?.ready })
                      }
                    >
                      {self?.ready ? "READY ✓ · CANCEL" : "READY UP ↗"}
                    </button>
                  )}
                </footer>
              </>
            )}
            <p className="mp-footnote">
              Authoritative matches · Local movement prediction · Remote
              interpolation
              <br />
              WebRTC requires a UDP-capable server. Compatibility transport is
              automatic. Offline bots are always available.
            </p>
          </section>
        </div>
      )}
    </>
  );
}
