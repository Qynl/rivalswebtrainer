import { useEffect, useRef, useState } from 'react';
import type { Dispatch, JSX, SetStateAction } from 'react';
import { GameCanvas, type FrameMetrics, type GameCanvasHandle, type GameSettings } from './game/GameCanvas';
import type { ArenaMode } from './game/arena/ArenaConfig';
import type { MovementSnapshot } from './game/movement/MovementTypes';

const INITIAL_SNAPSHOT: MovementSnapshot = {
  position: { x: 0, y: 0, z: -8.3 },
  velocity: { x: 0, y: 0, z: 0 },
  horizontalSpeed: 0,
  grounded: true,
  state: 'grounded',
  sprinting: false,
  sliding: false,
  slideElapsed: 0,
  slideRemaining: 0.68,
  jumpElapsed: 0,
  coyoteRemaining: 0,
  jumpBufferRemaining: 0,
  groundNormal: { x: 0, y: 1, z: 0 },
  lastCollision: null,
  justLanded: false,
  simulationTime: 0,
};

const INITIAL_METRICS: FrameMetrics = {
  frameTimeMs: 0,
  fps: 0,
  simulationSteps: 0,
  recordingSamples: 0,
};

function format(value: number, digits = 2): string {
  return value.toFixed(digits);
}

function formatState(state: MovementSnapshot['state']): string {
  return state.toUpperCase();
}

function App(): JSX.Element {
  const canvasRef = useRef<GameCanvasHandle>(null);
  const [mode, setMode] = useState<ArenaMode>('arena');
  const [settings, setSettings] = useState<GameSettings>({
    fov: 96,
    sensitivity: 1,
    autoSprint: false,
  });
  const [snapshot, setSnapshot] = useState(INITIAL_SNAPSHOT);
  const [metrics, setMetrics] = useState(INITIAL_METRICS);
  const [debug, setDebug] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  const [pointerLocked, setPointerLocked] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingSamples, setRecordingSamples] = useState(0);
  const [ready, setReady] = useState(false);
  const [initializationError, setInitializationError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code === 'F3') {
        event.preventDefault();
        setDebug((value) => !value);
      }
      if (event.code === 'F2') {
        event.preventDefault();
        setSettingsOpen((value) => !value);
        setPaused(true);
        canvasRef.current?.exitPointerLock();
      }
      if (event.code === 'Escape' && hasStarted) {
        setPaused(true);
        setSettingsOpen(false);
      }
      if (event.code === 'F9' && hasStarted) {
        setPaused(false);
        setSettingsOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hasStarted]);

  const handlePointerLock = (locked: boolean): void => {
    setPointerLocked(locked);
    if (locked) {
      setHasStarted(true);
      setPaused(false);
      setSettingsOpen(false);
    } else if (hasStarted) {
      setPaused(true);
    }
  };

  const enterGame = (): void => {
    setPaused(false);
    canvasRef.current?.requestPointerLock();
  };

  const openSettings = (): void => {
    setSettingsOpen(true);
    setPaused(true);
    canvasRef.current?.exitPointerLock();
  };

  const chooseMode = (nextMode: ArenaMode): void => {
    if (nextMode === mode) return;
    setMode(nextMode);
    setPaused(false);
    setSettingsOpen(false);
    canvasRef.current?.exitPointerLock();
  };

  return (
    <main className="app-shell">
      <GameCanvas
        ref={canvasRef}
        mode={mode}
        settings={settings}
        paused={paused}
        onPointerLockChange={handlePointerLock}
        onTelemetry={(nextSnapshot, nextMetrics) => {
          setSnapshot(nextSnapshot);
          setMetrics(nextMetrics);
        }}
        onRecordingChange={(isRecording, count) => {
          setRecording(isRecording);
          setRecordingSamples(count);
        }}
        onReady={() => setReady(true)}
        onError={(message) => setInitializationError(message)}
      />

      <div className="reticle" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <i />
      </div>

      <header className="topbar hud-layer">
        <div className="brand-lockup">
          <div className="brand-mark">R</div>
          <div>
            <div className="eyebrow">RESEARCH BUILD / 01</div>
            <h1>RIVALS <span>//</span> MOVEMENT REPLICATION</h1>
          </div>
        </div>
        <div className="topbar-actions">
          <div className="mode-switcher" role="group" aria-label="Training environment">
            <button className={mode === 'arena' ? 'active' : ''} onClick={() => chooseMode('arena')}>
              <span className="button-dot arena-dot" /> Arena
            </button>
            <button className={mode === 'lab' ? 'active' : ''} onClick={() => chooseMode('lab')}>
              <span className="button-dot lab-dot" /> Movement Lab
            </button>
          </div>
          <button className={`hud-button ${debug ? 'selected' : ''}`} onClick={() => setDebug((value) => !value)}>
            F3&nbsp; Debug
          </button>
          <button className="hud-button" onClick={openSettings}>Settings</button>
        </div>
      </header>

      <div className="status-strip hud-layer">
        <span className="live-pip" />
        <span>{mode === 'arena' ? 'ARENA BLOCKOUT' : 'CALIBRATION SPACE'}</span>
        <b>·</b>
        <span>{pointerLocked ? 'INPUT LIVE' : paused ? 'PAUSED' : 'CLICK TO CAPTURE'}</span>
        {recording && <span className="recording-badge"><span className="record-dot" /> REC {recordingSamples}</span>}
      </div>

      <section className="bottom-left-hud hud-layer">
        <div className="hud-card control-card">
          <div className="card-kicker">MOVEMENT PRIMER</div>
          <div className="key-row"><kbd>W A S D</kbd><span>move</span><kbd>SHIFT</kbd><span>sprint</span></div>
          <div className="key-row"><kbd>SPACE</kbd><span>jump</span><kbd>C / CTRL</kbd><span>slide</span></div>
          <div className="card-divider" />
          <div className="micro-note"><span className="cyan-line" /> Slide → jump preserves the testable momentum chain.</div>
        </div>
      </section>

      <section className="bottom-right-hud hud-layer">
        <div className="hud-card telemetry-card">
          <div className="telemetry-top"><span className="card-kicker">LIVE TELEMETRY</span><span className="state-chip">{formatState(snapshot.state)}</span></div>
          <div className="speed-readout"><strong>{format(snapshot.horizontalSpeed, 1)}</strong><span>u/s<br />HORIZONTAL</span></div>
          <div className="telemetry-bars"><span className={snapshot.grounded ? 'on' : ''} /> <span className={snapshot.sprinting ? 'on sprint' : ''} /> <span className={snapshot.sliding ? 'on slide' : ''} /></div>
          <div className="telemetry-labels"><span>GROUND</span><span>SPRINT</span><span>SLIDE</span></div>
        </div>
      </section>

      {debug && (
        <aside className="debug-panel hud-layer" aria-live="polite">
          <div className="debug-header"><span className="card-kicker">PHYSICS DEBUG</span><span className="debug-key">F3</span></div>
          <div className="debug-grid">
            <span>STATE</span><strong>{formatState(snapshot.state)}</strong>
            <span>GROUNDED</span><strong className={snapshot.grounded ? 'good' : 'warning-text'}>{snapshot.grounded ? 'YES' : 'NO'}</strong>
            <span>POSITION</span><strong>{format(snapshot.position.x)}, {format(snapshot.position.y)}, {format(snapshot.position.z)}</strong>
            <span>VELOCITY</span><strong>{format(snapshot.velocity.x)}, {format(snapshot.velocity.y)}, {format(snapshot.velocity.z)}</strong>
            <span>H SPEED</span><strong>{format(snapshot.horizontalSpeed, 3)} u/s</strong>
            <span>GROUND NORMAL</span><strong>{format(snapshot.groundNormal.x)}, {format(snapshot.groundNormal.y)}, {format(snapshot.groundNormal.z)}</strong>
            <span>SLIDE TIMER</span><strong>{format(snapshot.slideElapsed, 3)} / {format(snapshot.slideRemaining, 3)}s</strong>
            <span>JUMP ELAPSED</span><strong>{format(snapshot.jumpElapsed, 3)}s</strong>
            <span>COLLISION</span><strong>{snapshot.lastCollision ?? '—'}</strong>
            <span>SIM TIME</span><strong>{format(snapshot.simulationTime, 2)}s</strong>
          </div>
          <div className="debug-footer"><span>FRAME {format(metrics.frameTimeMs, 1)}ms</span><span>{format(metrics.fps, 0)} FPS</span><span>STEP {metrics.simulationSteps}</span></div>
        </aside>
      )}

      {!ready && !initializationError && (
        <div className="capture-overlay hud-layer">
          <div className="capture-panel loading-panel">
            <div className="capture-icon"><span className="loading-spinner" /></div>
            <div className="eyebrow">INITIALIZING FIXED-STEP SANDBOX</div>
            <h2>Building the blockout.</h2>
            <p>Preparing the original modular Arena reconstruction, collision surfaces, and calibration stations.</p>
            <div className="loading-track"><span /></div>
          </div>
        </div>
      )}

      {ready && !hasStarted && (
        <div className="capture-overlay hud-layer">
          <div className="capture-panel">
            <div className="capture-icon"><span className="crosshair-ring" /></div>
            <div className="eyebrow">FIXED-STEP MOVEMENT SANDBOX</div>
            <h2>Enter the arena.</h2>
            <p>Click to capture the mouse and run the evidence-driven movement test. No weapons. No bots. Just momentum, collision, ramps, and repeatable drills.</p>
            <button className="primary-button" onClick={enterGame}>Click to play <span>↗</span></button>
            <div className="capture-meta"><span>FOV {settings.fov}°</span><span>120 Hz SIM</span><span>ESC releases mouse</span></div>
          </div>
        </div>
      )}

      {initializationError && (
        <div className="capture-overlay hud-layer">
          <div className="capture-panel error-panel">
            <div className="capture-icon error-icon">!</div>
            <div className="eyebrow">INITIALIZATION ERROR</div>
            <h2>WebGL needs attention.</h2>
            <p>{initializationError}</p>
            <div className="settings-note"><span className="note-icon">i</span><span>Try a current desktop browser with hardware acceleration enabled, then reload this page.</span></div>
          </div>
        </div>
      )}

      {paused && hasStarted && !initializationError && (
        <div className="pause-overlay hud-layer">
          <div className="pause-panel">
            <div className="eyebrow">SIMULATION PAUSED</div>
            <h2>{settingsOpen ? 'Tune the test.' : 'Keep the motion honest.'}</h2>
            {!settingsOpen && <p>Pointer lock is released. Resume when you are ready to run the same movement sequence again.</p>}
            {settingsOpen ? (
              <SettingsPanel
                settings={settings}
                setSettings={setSettings}
                onClose={() => { setSettingsOpen(false); setPaused(false); enterGame(); }}
              />
            ) : (
              <div className="pause-actions">
                <button className="primary-button" onClick={enterGame}>Resume movement <span>↗</span></button>
                <button className="secondary-button" onClick={openSettings}>Open settings</button>
              </div>
            )}
            {!settingsOpen && <div className="pause-footnote">F3 toggles physics telemetry · R records a sequence · F9 resets to the last recording start</div>}
          </div>
        </div>
      )}
    </main>
  );
}

function SettingsPanel({
  settings,
  setSettings,
  onClose,
}: {
  settings: GameSettings;
  setSettings: Dispatch<SetStateAction<GameSettings>>;
  onClose: () => void;
}): JSX.Element {
  return (
    <div className="settings-panel">
      <label className="setting-row">
        <span><b>Field of view</b><small>Reference-style duel framing; change to taste.</small></span>
        <output>{settings.fov}°</output>
        <input
          type="range" min="80" max="112" step="1" value={settings.fov}
          onChange={(event) => setSettings((current) => ({ ...current, fov: Number(event.target.value) }))}
        />
      </label>
      <label className="setting-row">
        <span><b>Mouse sensitivity</b><small>Relative multiplier; one variable at a time.</small></span>
        <output>{settings.sensitivity.toFixed(2)}×</output>
        <input
          type="range" min="0.45" max="2" step="0.05" value={settings.sensitivity}
          onChange={(event) => setSettings((current) => ({ ...current, sensitivity: Number(event.target.value) }))}
        />
      </label>
      <label className="toggle-row">
        <span><b>Auto sprint</b><small>Forward input activates sprint without holding Shift.</small></span>
        <input
          type="checkbox" checked={settings.autoSprint}
          onChange={(event) => setSettings((current) => ({ ...current, autoSprint: event.target.checked }))}
        />
        <span className="toggle-ui" />
      </label>
      <div className="settings-note"><span className="note-icon">i</span><span>Movement constants stay in <code>MovementConfig.ts</code>. The research report marks every estimate separately from observed behavior.</span></div>
      <button className="primary-button compact" onClick={onClose}>Apply and resume <span>↗</span></button>
    </div>
  );
}

export default App;
