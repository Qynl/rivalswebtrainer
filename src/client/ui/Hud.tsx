/**
 * The in-game HUD, as React.
 *
 * Every element here is written to by `hud.ts` through its id, exactly as it
 * was when this markup lived in index.html: the HUD is a DOM instrument panel
 * that changes sixty times a second, and React is the wrong tool for that. What
 * React owns is the component tree and mounting order — the ids are the
 * contract between the two, and they must not change.
 */

export function Hud(): React.JSX.Element {
  return (
    <div id="hud" className="hidden" aria-hidden="true">
      <div id="speedvignette" />
      <div id="ringvignette" />

      <div id="topbar">
        <div id="scorecard">
          <div className="side mine">
            <span className="tag">YOU</span>
            <span className="name" id="name-a">
              YOU
            </span>
            <span className="score" id="score-a">
              0
            </span>
          </div>
          <div className="centre">
            <span id="matchtimer">0:00</span>
            <span className="mode">FIRST TO 3</span>
          </div>
          <div className="side theirs">
            <span className="score" id="score-b">
              0
            </span>
            <span className="name" id="name-b">
              OPP
            </span>
            <span className="tag">ENEMY</span>
          </div>
        </div>
        <div className="ringline">
          <span id="ringlabel">RING HOLDS</span>
          <div id="ringbar">
            <i />
          </div>
        </div>
      </div>

      <div id="feed" />
      <div id="banner" />

      <div id="crosshair">
        <i className="ch top" />
        <i className="ch bottom" />
        <i className="ch left" />
        <i className="ch right" />
        <i className="ch dot" />
      </div>
      <div id="hitmarker">
        <i />
        <i />
        <i />
        <i />
      </div>
      <div id="hitdir">
        <i />
      </div>

      <div id="scope">
        <svg viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <defs>
            <mask id="scopeMask">
              <rect width="1000" height="1000" fill="white" />
              <circle cx="500" cy="500" r="392" fill="black" />
            </mask>
            <radialGradient id="scopeGlass" cx="0.42" cy="0.36" r="0.75">
              <stop offset="0" stopColor="#ffffff" stopOpacity="0.08" />
              <stop offset="0.55" stopColor="#0b1620" stopOpacity="0.04" />
              <stop offset="1" stopColor="#000000" stopOpacity="0.32" />
            </radialGradient>
          </defs>
          <rect width="1000" height="1000" fill="#05080b" mask="url(#scopeMask)" />
          <circle cx="500" cy="500" r="392" fill="url(#scopeGlass)" />
          <circle cx="500" cy="500" r="392" fill="none" stroke="#0b0f13" strokeWidth="18" />
          <circle cx="500" cy="500" r="401" fill="none" stroke="#e8e4d8" strokeOpacity="0.22" strokeWidth="2" />
          {/* duplex reticle */}
          <line x1="500" y1="120" x2="500" y2="404" stroke="#0a0d10" strokeWidth="3.2" />
          <line x1="500" y1="596" x2="500" y2="880" stroke="#0a0d10" strokeWidth="3.2" />
          <line x1="120" y1="500" x2="404" y2="500" stroke="#0a0d10" strokeWidth="3.2" />
          <line x1="596" y1="500" x2="880" y2="500" stroke="#0a0d10" strokeWidth="3.2" />
          <line x1="500" y1="120" x2="500" y2="404" stroke="#f2ede0" strokeWidth="1.2" />
          <line x1="500" y1="596" x2="500" y2="880" stroke="#f2ede0" strokeWidth="1.2" />
          <line x1="120" y1="500" x2="404" y2="500" stroke="#f2ede0" strokeWidth="1.2" />
          <line x1="596" y1="500" x2="880" y2="500" stroke="#f2ede0" strokeWidth="1.2" />
          {/* mil dots */}
          <g fill="#f2ede0" fillOpacity="0.8">
            <circle cx="500" cy="452" r="3" />
            <circle cx="500" cy="414" r="3" />
            <circle cx="500" cy="376" r="3" />
            <circle cx="500" cy="548" r="3" />
            <circle cx="500" cy="586" r="3" />
            <circle cx="500" cy="624" r="3" />
            <circle cx="452" cy="500" r="3" />
            <circle cx="414" cy="500" r="3" />
            <circle cx="376" cy="500" r="3" />
            <circle cx="548" cy="500" r="3" />
            <circle cx="586" cy="500" r="3" />
            <circle cx="624" cy="500" r="3" />
          </g>
          <circle cx="500" cy="500" r="2.6" fill="#d9483b" />
          <g id="scoperange" opacity="0.35">
            <line x1="500" y1="500" x2="500" y2="180" stroke="#d9483b" strokeWidth="1" strokeDasharray="5 16" />
          </g>
          {/* range ticks along the lower left, purely cosmetic */}
          <g stroke="#f2ede0" strokeOpacity="0.35" strokeWidth="1.5">
            <line x1="196" y1="620" x2="196" y2="640" />
            <line x1="176" y1="560" x2="176" y2="580" />
            <line x1="156" y1="500" x2="156" y2="520" />
            <line x1="196" y1="380" x2="196" y2="400" />
          </g>
        </svg>
      </div>

      <div id="weapon">
        <div id="slots">
          <div className="slot on" id="slot-rifle">
            <b>1</b>
            <span>RIFLE</span>
          </div>
          <div className="slot" id="slot-hook">
            <b>2</b>
            <span>GRAPNEL</span>
          </div>
        </div>
        <div id="ammo">
          <b id="ammoCount">1</b>
          <span id="weaponLabel">LANCE</span>
        </div>
        <div id="reloadArc">
          <svg viewBox="0 0 40 40">
            <circle cx="20" cy="20" r="16" className="track" />
            <circle cx="20" cy="20" r="16" className="fill" id="reloadCircle" />
          </svg>
          <span className="rlabel">CYCLE</span>
        </div>
      </div>

      <div id="vitals">
        <div id="speedread">
          <b id="speedval">0</b>
          <span>M/S</span>
        </div>
        <div id="chainread">
          <b id="chainval">0</b>
          <span>CHAIN</span>
        </div>
      </div>

      <div id="status">
        <div id="respawn" className="hidden">
          <b id="respawnval">2.6</b>
          <span>RESPAWNING</span>
        </div>
        <div id="protect" className="hidden">
          SPAWN SHIELD
        </div>
        <div id="ringwarn" className="hidden">
          OUTSIDE THE RING — MOVE IN
        </div>
        <div id="chainglow" className="hidden">
          CHAIN
        </div>
      </div>

      <div id="killbanner" className="hidden">
        <b id="killtext">KILL</b>
      </div>

      <div id="netinfo">
        <span id="ping">— MS</span>
        <span id="connection">LOCAL</span>
      </div>

      <div id="hint">
        1 RIFLE · 2 GRAPNEL · LMB THROW · HOLD TO SWING · SPACE REEL IN · C FEED OUT · E DASH
      </div>
    </div>
  );
}
