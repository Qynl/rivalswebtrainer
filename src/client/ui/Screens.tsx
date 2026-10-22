/**
 * Menus, results, pause, armory: the screens around the match.
 *
 * Same contract as the HUD — every id and class here is addressed by
 * `main.ts`, `hud.ts` and `armory.ts`, so this file is markup ownership rather
 * than state. React renders it once and the game drives it.
 */

export function Menu(): React.JSX.Element {
  return (
    <div id="menu" className="screen">
      <div className="menu-inner">
        <div className="brand">
          <p className="kicker">A 1V1 DUEL OVER THE VOID</p>
          <h1>
            GLINT <span>&amp;</span> GRAPPLE
          </h1>
          <p className="tag">ONE SHOT · ONE ROPE · FIRST TO THREE</p>
          <p className="blurb">
            A concrete ruin hanging in the sky. A single-shot rifle that gives your position away every time you aim.
            A rope that turns a fall into a flight.
          </p>
        </div>
        <div className="menu-actions">
          <label className="field">
            <span>CALLSIGN</span>
            <input id="callsign" maxLength={14} defaultValue="PLAYER" spellCheck={false} autoComplete="off" />
          </label>
          <div className="profile" id="profile">
            <div className="profile-level">
              <span className="tag" id="menu-level">
                LV 1
              </span>
              <div className="xpbar">
                <i id="menu-xp" />
              </div>
            </div>
            <div className="profile-coins">
              <span className="coin">◆</span>
              <b id="menu-coins">0</b>
            </div>
          </div>
          <button id="play-duel" className="primary">
            FIND DUEL
          </button>
          <button id="play-bot" className="secondary">
            PRACTICE VS SPECTER
          </button>
          <button id="armory-open" className="secondary ghost">
            ARMORY
          </button>
          <p id="menu-note" className="note">
            CLICK TO LOCK THE MOUSE · ESC FOR MENU
          </p>
        </div>
        <div className="menu-controls">
          <div>
            <kbd>WASD</kbd>
            <span>MOVE</span>
          </div>
          <div>
            <kbd>1</kbd>
            <span>RIFLE</span>
          </div>
          <div>
            <kbd>2</kbd>
            <span>GRAPNEL</span>
          </div>
          <div>
            <kbd>SPACE</kbd>
            <span>JUMP · REEL IN</span>
          </div>
          <div>
            <kbd>E</kbd>
            <span>DASH</span>
          </div>
          <div>
            <kbd>C</kbd>
            <span>SLIDE · FEED ROPE</span>
          </div>
          <div>
            <kbd>LMB</kbd>
            <span>FIRE · THROW HOOK</span>
          </div>
          <div>
            <kbd>RMB</kbd>
            <span>SCOPE</span>
          </div>
        </div>
        <div className="settings">
          <label>
            SENSITIVITY <input id="sens" type="range" min="0.4" max="3" step="0.05" defaultValue="1" />
          </label>
          <label>
            VOLUME <input id="vol" type="range" min="0" max="1" step="0.02" defaultValue="0.65" />
          </label>
        </div>
        <div className="foot">
          <span id="menu-status">OFFLINE</span>
          <span className="node">SERVER-AUTHORITATIVE · 60 TICK · PROCEDURAL AUDIO</span>
        </div>
      </div>
    </div>
  );
}

export function Results(): React.JSX.Element {
  return (
    <div id="results" className="screen hidden">
      <div className="panel">
        <p className="eyebrow" id="result-eyebrow">
          MATCH COMPLETE
        </p>
        <h2 id="result-title">VICTORY</h2>
        <p id="result-score" className="score-big">
          3 — 1
        </p>
        <p id="result-note" className="note" />
        <div className="reward" id="result-reward">
          <div>
            <span className="coin">◆</span>
            <b id="reward-coins">0</b>
            <span className="label">COINS</span>
          </div>
          <div>
            <b id="reward-xp">0</b>
            <span className="label">XP</span>
          </div>
          <div>
            <b id="reward-level">LV 1</b>
            <span className="label" id="reward-level-note">
              LEVEL
            </span>
          </div>
        </div>
        <div className="row">
          <button id="result-again" className="primary">
            PLAY AGAIN
          </button>
          <button id="result-armory" className="secondary ghost">
            ARMORY
          </button>
          <button id="result-menu" className="secondary">
            MENU
          </button>
        </div>
      </div>
    </div>
  );
}

export function Pause(): React.JSX.Element {
  return (
    <div id="pause" className="screen hidden">
      <div className="panel small">
        <p className="eyebrow">PAUSED</p>
        <h2>CEASEFIRE</h2>
        <p className="note">The match keeps running while you read this.</p>
        <div className="row">
          <button id="pause-resume" className="primary">
            RESUME
          </button>
          <button id="pause-quit" className="secondary">
            LEAVE MATCH
          </button>
        </div>
        <div className="settings">
          <label>
            SENSITIVITY <input id="sens2" type="range" min="0.4" max="3" step="0.05" defaultValue="1" />
          </label>
          <label>
            VOLUME <input id="vol2" type="range" min="0" max="1" step="0.02" defaultValue="0.65" />
          </label>
        </div>
      </div>
    </div>
  );
}

export function Armory(): React.JSX.Element {
  return (
    <div id="armory" className="screen hidden">
      <div className="armory-inner">
        <header className="armory-head">
          <div>
            <p className="eyebrow">ARMORY</p>
            <h2>COSMETICS</h2>
            <p className="note">
              Cosmetics only. Every rifle cycles at the same speed and every claw flies at the same speed.
            </p>
          </div>
          <div className="armory-purse">
            <div className="profile-coins">
              <span className="coin">◆</span>
              <b id="armory-coins">0</b>
            </div>
            <div className="xpbar big">
              <i id="armory-level-fill" />
            </div>
            <span className="purse-level">
              <b id="armory-level">LV 1</b>
              <span id="armory-level-sub">0 / 240 XP</span>
            </span>
          </div>
        </header>
        <nav className="armory-tabs">
          <button data-armory-tab="gun" className="on">
            RIFLE SKINS
          </button>
          <button data-armory-tab="grapple">GRAPNEL SKINS</button>
          <button data-armory-tab="effect">KILL EFFECTS</button>
        </nav>
        <div id="armory-grid" className="armory-grid" />
        <footer className="armory-foot">
          <p id="armory-note" className="note">
            EARN COINS BY WINNING DUELS. EVERY KILL PAYS.
          </p>
          <button id="armory-back" className="primary">
            BACK
          </button>
        </footer>
      </div>
    </div>
  );
}
