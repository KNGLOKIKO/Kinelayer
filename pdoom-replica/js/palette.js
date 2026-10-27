/* palette.ts 的逐字移植 —— 九个颜色一个不少，这是整支片子的视觉宪法。 */
const hexToLinear = (hex) => {
  const n = parseInt(hex.replace('#', ''), 16);
  const srgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  return srgb.map((v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
};

// The whole video lives in a restrained palette: ink, bone, and one signal colour.
// One rare accent (acid) — used exactly once, briefly.
const HEX = {
  ink: '#0A0A0B',     // background black (slightly warm)
  ink2: '#151517',    // raised black (panels, paper-in-the-dark)
  graphite: '#5E5B57',// dim lines, secondary text
  ash: '#9C978F',     // mid grey
  bone: '#EEE9DF',    // paper white, primary text
  signal: '#FF4D12',  // hazard orange: the spark, the fuse, the counter
  ember: '#FF8A3D',   // hotter, lighter orange for cores/highlights
  blood: '#C21D0B',   // deep red-orange for shadows of signal
  acid: '#D8FF3C',    // acid: only for one moment
};

const LIN = Object.fromEntries(Object.entries(HEX).map(([k, v]) => [k, hexToLinear(v)]));

function rgba(key, a = 1) {
  const hex = HEX[key] ?? key;
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

window.PD_PAL = { HEX, LIN, rgba };
