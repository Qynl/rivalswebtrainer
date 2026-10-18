export const CONTROL_DEFINITIONS = [
  ["moveForward", "Move forward"],
  ["moveLeft", "Move left"],
  ["moveBackward", "Move backward"],
  ["moveRight", "Move right"],
  ["jump", "Jump / double jump"],
  ["slide", "Slide"],
  ["quickMelee", "Quick melee ability"],
  ["quickUtility", "Quick utility"],
  ["reload", "Reload"],
  ["inspect", "Inspect weapon"],
  ["slot1", "Equip primary"],
  ["slot2", "Equip secondary"],
  ["slot3", "Equip melee"],
  ["slot4", "Equip utility"],
];

export const DEFAULT_CONTROLS = Object.freeze({
  moveForward: ["KeyW"],
  moveLeft: ["KeyA"],
  moveBackward: ["KeyS"],
  moveRight: ["KeyD"],
  jump: ["Space"],
  slide: ["KeyC", "ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight"],
  quickMelee: ["KeyF"],
  quickUtility: ["KeyG"],
  reload: ["KeyR"],
  inspect: ["KeyT"],
  slot1: ["Digit1"],
  slot2: ["Digit2"],
  slot3: ["Digit3"],
  slot4: ["Digit4"],
});

const ACTION_IDS = CONTROL_DEFINITIONS.map(([id]) => id),
  RESERVED_CODES = new Set([
    "Escape",
    "Tab",
    "KeyM",
    ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
  ]),
  SAFE_CODE = /^(?:Key[A-Z]|Digit[0-9]|Numpad[0-9]|Arrow(?:Up|Down|Left|Right)|Space|Shift(?:Left|Right)|Control(?:Left|Right)|Alt(?:Left|Right)|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|Enter|CapsLock)$/;

export function isBindableCode(code) {
  return typeof code === "string" && SAFE_CODE.test(code) && !RESERVED_CODES.has(code);
}

export function getControlCodes(controls, action) {
  const value = controls?.[action];
  return Array.isArray(value)
    ? value.filter((code) => typeof code === "string")
    : typeof value === "string"
      ? [value]
      : [];
}

export function sanitizeControls(value) {
  const controls = {};
  const used = new Set();
  for (const action of ACTION_IDS) {
    const fallback = DEFAULT_CONTROLS[action],
      raw = Array.isArray(value?.[action])
        ? value[action]
        : typeof value?.[action] === "string"
          ? [value[action]]
          : fallback,
      limit = action === "slide" ? 5 : 1;
    let codes = raw.filter(
      (code) => isBindableCode(code) && !used.has(code),
    );
    if (codes.length === 0) {
      codes = fallback.filter((code) => !used.has(code));
      if (codes.length === 0) {
        const replacement = Array.from({ length: 10 }, (_, i) => `Numpad${i}`).find(
          (code) => !used.has(code),
        );
        if (replacement) codes = [replacement];
      }
    }
    codes = codes.slice(0, limit);
    controls[action] = codes;
    codes.forEach((code) => used.add(code));
  }
  return controls;
}

export function rebindControl(value, action, code) {
  if (!ACTION_IDS.includes(action))
    return { ok: false, error: "Unknown control action." };
  if (!isBindableCode(code))
    return { ok: false, error: "That key is reserved by the browser or game." };
  const controls = sanitizeControls(value),
    currentCodes = getControlCodes(controls, action),
    previousCode = currentCodes[0];
  if (currentCodes[0] === code) return { ok: true, controls, swapped: false };
  if (currentCodes.includes(code)) {
    controls[action] = [code];
    return { ok: true, controls, swapped: false };
  }
  const otherAction = ACTION_IDS.find(
    (candidate) =>
      candidate !== action && getControlCodes(controls, candidate).includes(code),
  );
  controls[action] = [code];
  if (otherAction) {
    const otherCodes = getControlCodes(controls, otherAction).filter(
      (candidate) => candidate !== code,
    );
    if (previousCode) otherCodes.unshift(previousCode);
    controls[otherAction] = otherCodes;
  }
  return {
    ok: true,
    controls: sanitizeControls(controls),
    swapped: !!otherAction,
  };
}

export function formatKeyCode(code) {
  if (code === "Space") return "SPACE";
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return `NUM ${code.slice(6)}`;
  if (code.startsWith("Shift")) return "SHIFT";
  if (code.startsWith("Control")) return "CTRL";
  if (code.startsWith("Alt")) return "ALT";
  if (code.startsWith("Arrow"))
    return { ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→" }[code];
  return {
    Backquote: "`",
    Minus: "-",
    Equal: "=",
    BracketLeft: "[",
    BracketRight: "]",
    Backslash: "\\",
    Semicolon: ";",
    Quote: "'",
    Comma: ",",
    Period: ".",
    Slash: "/",
    Enter: "ENTER",
    CapsLock: "CAPS",
  }[code] || code;
}

export function formatControl(controls, action) {
  return [...new Set(getControlCodes(controls, action).map(formatKeyCode))].join(" / ") || "—";
}
