import * as THREE from "three";

export const OPERATOR_KITS = Object.freeze([
  Object.freeze({
    name: "striker",
    cloth: 0x35444c,
    armor: 0xadbfc5,
    stripe: 0x738e97,
  }),
  Object.freeze({
    name: "recon",
    cloth: 0x41484a,
    armor: 0xa3b0ae,
    stripe: 0x6f8981,
  }),
  Object.freeze({
    name: "sentinel",
    cloth: 0x49463f,
    armor: 0xb6b7a7,
    stripe: 0x8b8970,
  }),
]);
// Cosmetic identities, never classes/stats. Team colour is unchanged across kits.
export function operatorIdentity(name = "BOT") {
  let seed = 0;
  for (const c of name) seed = (seed * 31 + c.charCodeAt(0)) >>> 0;
  return {
    seed,
    kit: OPERATOR_KITS[seed % OPERATOR_KITS.length],
    callsign: String(seed % 100).padStart(2, "0"),
  };
}
const DIGITS = [
  "111101101101111",
  "010110010010111",
  "111001111100111",
  "111001111001111",
  "101101111001001",
  "111100111001111",
  "111100111101111",
  "111001001001001",
  "111101111101111",
  "111101111001111",
];
export function callsignTexture(number, team) {
  const width = 64,
    height = 32,
    bytes = new Uint8Array(width * height * 4);
  const ink = [216, 226, 216],
    base = team === 0 ? [27, 92, 95] : [122, 57, 37];
  const pixel = (x, y, rgb) => {
    const i = (y * width + x) * 4;
    bytes.set([...rgb, 255], i);
  };
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) pixel(x, y, base);
  const digits = String(number).replace(/\D/g, "").padStart(2, "0").slice(-2);
  for (let n = 0; n < 2; n++)
    for (let y = 0; y < 5; y++)
      for (let x = 0; x < 3; x++)
        if (DIGITS[Number(digits[n])][y * 3 + x] === "1")
          for (let dy = 0; dy < 4; dy++)
            for (let dx = 0; dx < 4; dx++)
              pixel(15 + n * 19 + x * 4 + dx, 6 + y * 4 + dy, ink);
  for (const x of [5, 58]) for (let y = 5; y < 27; y++) pixel(x, y, ink);
  const texture = new THREE.DataTexture(bytes, width, height);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  texture.name = "operator-callsign";
  return texture;
}
