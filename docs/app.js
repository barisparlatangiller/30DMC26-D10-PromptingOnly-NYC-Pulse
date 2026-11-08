/* NYC Pulse · #30DayMapChallenge 2026 · Day 10 · Prompting only
   One Tuesday in New York (16 June 2026), replayed: car trips (Yellow, Green, Uber/Lyft) and subway entries.
   Colour always means time of day. Buildings glow with the trips of their own taxi zone. */
const NB = 144, NZ = 263, MODES = ["yellow", "green", "hv"], GROUP = { taxi: ["yellow", "green"], hv: ["hv"] };
const HC = [[0, "#5145e8"], [240, "#2f6bf2"], [320, "#7a5cf5"], [375, "#f06bb6"], [480, "#ff7a7a"], [600, "#ffb83a"], [780, "#ffd25a"],
  [960, "#ff9640"], [1110, "#f0468f"], [1175, "#d94fd0"], [1290, "#8d5cf6"], [1440, "#5145e8"]];
const ICE = [150, 225, 255], BASE = [34, 40, 58];
const LANDMARKS = [
  ["One World Trade Center", -74.0134, 40.7127, 560], ["Empire State Building", -73.9857, 40.7484, 470], ["Chrysler Building", -73.9755, 40.7516, 350],
  ["Times Square", -73.9855, 40.7580, 240], ["Central Park", -73.9665, 40.7812, 160], ["Brooklyn Bridge", -73.9969, 40.7061, 150], ["Statue of Liberty", -74.0445, 40.6892, 160],
  ["JFK Airport", -73.7781, 40.6413, 160], ["LaGuardia Airport", -73.8740, 40.7769, 160], ["Barclays Center", -73.9754, 40.6826, 150],
  ["Yankee Stadium", -73.9262, 40.8296, 150], ["Coney Island", -73.9707, 40.5755, 150]];
const CAM = [ // minute of day → camera; interpolated with a smooth spline
  [0, -73.986, 40.733, 11.05, 56, -26], [210, -73.935, 40.712, 11.0, 48, -12], [400, -73.984, 40.748, 12.05, 62, -34],
  [560, -73.978, 40.752, 12.35, 64, -52], [760, -73.915, 40.722, 11.05, 50, -22], [960, -73.982, 40.754, 12.2, 63, 6],
  [1110, -73.986, 40.745, 12.45, 65, 22], [1260, -73.962, 40.716, 11.7, 60, 42], [1440, -73.986, 40.733, 11.05, 56, 334]];

const $ = s => document.querySelector(s);
const fmt = n => Math.round(n).toLocaleString("en-US");
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const HCR = HC.map(([m, h]) => [m, hex(h)]);
const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const rgb = c => `rgb(${c.map(Math.round).join(",")})`;
function hourColor(m) {
  m = ((m % 1440) + 1440) % 1440;
  for (let i = 1; i < HCR.length; i++) if (m <= HCR[i][0]) {
    const [m0, c0] = HCR[i - 1], [m1, c1] = HCR[i], k = (m - m0) / (m1 - m0);
    return mix(c0, c1, k * k * (3 - 2 * k));
  }
  return HCR[0][1];
}
const partOfDay = m => m < 300 ? "night" : m < 600 ? "morning" : m < 960 ? "day" : m < 1200 ? "evening" : "night";
const smooth = k => k * k * (3 - 2 * k);

const S = { t: 0, playing: true, speed: 1, modes: new Set(MODES), layers: new Set(["dots", "marks", "subway", "cine"]), phase: 0, manual: false,
  sel: null, lastBuild: -99, lastFact: null };
window.S = S;

// ── data ──
async function load() {
  const j = u => fetch(u).then(r => r.json());
  const [zones, pulse, dots, sub, stats, routes] = await Promise.all([j("data/zones.geojson?v=2"), j("data/pulse.json?v=2"), j("data/dots.json?v=2"),
    j("data/subway.json?v=2"), j("data/stats.json?v=2"), j("data/routes.json?v=2").catch(() => ({}))]);
  Object.assign(S, { zones, pulse, dotsRaw: dots, sub, stats, routes });
  S.cen = new Float64Array(2 * (NZ + 1)); S.zname = []; S.zboro = [];
  for (const f of zones.features) { const p = f.properties; S.cen[2 * p.id] = p.lon; S.cen[2 * p.id + 1] = p.lat; S.zname[p.id] = p.zone; S.zboro[p.id] = p.borough; }
  // subway: hourly → per 10-minute bin, smooth
  const ns = sub.stations.length; S.subBin = new Float32Array(NB * ns);
  for (let b = 0; b < NB; b++) { const f = Math.max(0, Math.min(23, (b + 0.5) / 6 - 0.5)), h0 = Math.floor(f), h1 = Math.min(23, h0 + 1), k = smooth(f - h0);
    for (let s = 0; s < ns; s++) S.subBin[b * ns + s] = (sub.h[h0][s] * (1 - k) + sub.h[h1][s] * k) / 6; }
  S.subTot = sub.h.map(r => r.reduce((a, b) => a + b, 0));
  S.ZP = []; for (let z = 1; z <= NZ; z++) S.ZP.push([S.cen[2 * z], S.cen[2 * z + 1]]);
  S.ZK = kernel(S.ZP); S.SP = sub.stations.map(s => [s[2], s[3]]); S.SK = kernel(S.SP);
  S.SB = Array.from({ length: NB }, (_, b) => S.subBin.subarray(b * ns, (b + 1) * ns));
  S.subHeart = smoothSeries(S.SB.map(w => peak(w, S.SK, S.SP)));
  S.boroIdx = Object.fromEntries(["Brooklyn", "Queens", "Bronx"].map(b => [b, S.ZP.map((_, i) => i).filter(i => S.zboro[i + 1] === b)]));
  $("#perDot").textContent = stats.per_dot;
}

// "heart" = where trips are densest: Gaussian kernel density (σ = 1 km) at the zone centres, peak as a soft maximum
function kernel(P) { const n = P.length, K = new Float32Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const dx = (P[i][0] - P[j][0]) * 84.3, dy = (P[i][1] - P[j][1]) * 111.2; K[i * n + j] = Math.exp(-(dx * dx + dy * dy) / 2); } return K; }
function peak(w, K, P, idx) {
  const n = P.length, I = idx || P.map((_, i) => i), D = new Float32Array(I.length); let mx = 1e-9;
  I.forEach((i, a) => { let s = 0; for (let j = 0; j < n; j++) s += w[j] * K[i * n + j]; D[a] = s; if (s > mx) mx = s; });
  let x = 0, y = 0, q = 0; I.forEach((i, a) => { const v = Math.pow(D[a] / mx, 10); x += v * P[i][0]; y += v * P[i][1]; q += v; }); return [x / q, y / q];
}
function smoothSeries(A, sig = 1.5) { return A.map((_, b) => { let x = 0, y = 0, w = 0;
  for (let d = -4; d <= 4; d++) { const j = Math.max(0, Math.min(A.length - 1, b + d)), k = Math.exp(-(d * d) / (2 * sig * sig)); x += k * A[j][0]; y += k * A[j][1]; w += k; } return [x / w, y / w]; }); }

function combine() {                                    // selected modes → smoothed arrays, hearts, scales
  const pu = new Float32Array(NB * NZ), du = new Float32Array(NB * NZ);
  for (const m of S.modes) { const a = S.pulse.modes[m].pu, b = S.pulse.modes[m].do; for (let i = 0; i < a.length; i++) { pu[i] += a[i]; du[i] += b[i]; } }
  const sm = a => { const o = new Float32Array(a.length); for (let b = 0; b < NB; b++) for (let z = 0; z < NZ; z++) {
    const p = a[Math.max(0, b - 1) * NZ + z], c = a[b * NZ + z], n = a[Math.min(NB - 1, b + 1) * NZ + z]; o[b * NZ + z] = 0.25 * p + 0.5 * c + 0.25 * n; } return o; };
  S.PU = sm(pu); S.DO = sm(du);
  const all = []; for (let i = 0; i < S.PU.length; i++) all.push(S.PU[i] + S.DO[i]);
  all.sort((a, b) => a - b); S.vmax = Math.max(1, all[Math.floor(all.length * 0.997)]);
  S.binTot = []; const W = [];
  for (let b = 0; b < NB; b++) { const w = new Float32Array(NZ); let p = 0;
    for (let z = 0; z < NZ; z++) { w[z] = S.PU[b * NZ + z] + S.DO[b * NZ + z]; p += S.PU[b * NZ + z]; } W.push(w); S.binTot.push(p); }
  S.heart = smoothSeries(W.map(w => peak(w, S.ZK, S.ZP)));
  S.boroHeart = Object.fromEntries(Object.entries(S.boroIdx).map(([b, I]) => [b, smoothSeries(W.map(w => peak(w, S.ZK, S.ZP, I)))]));
  S.boroTot = Object.fromEntries(Object.entries(S.boroIdx).map(([b, I]) => [b, W.map(w => I.reduce((a, i) => a + w[i], 0))]));
  S.rateMax = Math.max(...S.binTot);
  S.hourly = Array.from({ length: 24 }, (_, h) => S.binTot.slice(h * 6, h * 6 + 6).reduce((a, b) => a + b, 0));
  const mi = new Set([...S.modes].map(m => MODES.indexOf(m)));
  S.dots = S.dotsAll.filter(d => mi.has(d.m));
  bars(); S.lastBuild = -99;
}

function prepDots() {                                  // each dot ≈ 60 real trips: real start and duration, modelled fastest street route
  S.dotsAll = [];
  for (const [m, o, d, t0, dur] of S.dotsRaw) {
    const r = S.routes[`${o}-${d}`]; let path;
    if (r && r.length >= 4) {
      path = []; for (let i = 0; i < r.length; i += 2) path.push([r[i], r[i + 1], 6]);
    } else {                                              // no street route (islands, unknown): a low arc between the zone centres
      const x0 = S.cen[2 * o], y0 = S.cen[2 * o + 1], x1 = S.cen[2 * d], y1 = S.cen[2 * d + 1]; if (!x0 || !x1) continue;
      const dist = Math.hypot((x1 - x0) * 84000, (y1 - y0) * 111000), hgt = Math.min(900, 80 + dist * 0.12);
      path = []; for (let i = 0; i <= 12; i++) { const s = i / 12, b = Math.sin(Math.PI * s); path.push([x0 + (x1 - x0) * s, y0 + (y1 - y0) * s, 20 + hgt * b]); }
    }
    const cum = [0]; for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot((path[i][0] - path[i - 1][0]) * 84.3, (path[i][1] - path[i - 1][1]) * 111.2));
    const L = cum[cum.length - 1] || 1, ts = cum.map(c => t0 + dur * c / L);
    const c = hourColor(t0);
    S.dotsAll.push({ m, path, ts, c: [...mix(c, [255, 255, 255], 0.2).map(Math.round), 220] });
  }
}

// ── state at time t ──
function at(t) {
  const f = Math.max(0, Math.min(NB - 1, t / 10 - 0.5)), b0 = Math.floor(f), b1 = Math.min(NB - 1, b0 + 1), k = f - b0;
  const pu = new Float32Array(NZ + 1), du = new Float32Array(NZ + 1);
  for (let z = 0; z < NZ; z++) { pu[z + 1] = S.PU[b0 * NZ + z] * (1 - k) + S.PU[b1 * NZ + z] * k; du[z + 1] = S.DO[b0 * NZ + z] * (1 - k) + S.DO[b1 * NZ + z] * k; }
  const lerp2 = (A) => [A[b0][0] * (1 - k) + A[b1][0] * k, A[b0][1] * (1 - k) + A[b1][1] * k];
  const ns = S.sub.stations.length, sv = new Float32Array(ns);
  for (let s = 0; s < ns; s++) sv[s] = S.subBin[b0 * ns + s] * (1 - k) + S.subBin[b1 * ns + s] * k;
  const boro = Object.fromEntries(Object.keys(S.boroHeart).map(b => [b, { p: lerp2(S.boroHeart[b]), n: S.boroTot[b][b0] * (1 - k) + S.boroTot[b][b1] * k }]));
  return { f, b0, k, pu, du, heart: lerp2(S.heart), sheart: lerp2(S.subHeart), boro, sv, rate: (S.binTot[b0] * (1 - k) + S.binTot[b1] * k) / 10 };
}
const vOf = (st, z) => Math.pow(Math.log1p(st.pu[z] + st.du[z]) / Math.log1p(S.vmax), 1.25);

// ── map ──
let map, overlay;
function initMap() {
  const proto = new pmtiles.Protocol(); maplibregl.addProtocol("pmtiles", proto.tile);
  map = S.map = new maplibregl.Map({ container: "map", style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
    center: [CAM[0][1], CAM[0][2]], zoom: CAM[0][3], pitch: CAM[0][4], bearing: CAM[0][5], maxPitch: 75, minZoom: 9, antialias: true, attributionControl: false });
  map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: "NYC TLC · MTA · NYC OpenData · © CARTO · © OpenStreetMap" }), "bottom-left");
  overlay = new deck.MapboxOverlay({ interleaved: false, layers: [] });
  map.addControl(overlay);
  const stop = () => { if (S.layers.has("cine") && !S.manual) { S.layers.delete("cine"); syncChips(); } };
  for (const ev of ["dragstart", "rotatestart", "pitchstart", "zoomstart"]) map.on(ev, e => e.originalEvent && stop());
}

function styleBase() {
  for (const l of map.getStyle().layers) {
    const id = l.id;
    try {
      if (/building/.test(id)) map.setLayoutProperty(id, "visibility", "none");
      else if (l.type === "background") map.setPaintProperty(id, "background-color", "#070a12");
      else if (/water/.test(id) && l.type === "fill") map.setPaintProperty(id, "fill-color", "#0a1830");
      else if (l.type === "fill") map.setPaintProperty(id, "fill-color", "#080c15");
      else if (l.type === "line" && /road|bridge|tunnel|rail/.test(id)) { map.setPaintProperty(id, "line-color", "#1c2539"); }
      else if (l.type === "line" && /water/.test(id)) map.setPaintProperty(id, "line-color", "#0c1426");
      else if (l.type === "symbol" && !/place_(city|town|suburb)/.test(id)) map.setLayoutProperty(id, "visibility", "none");
      else if (l.type === "symbol") { map.setPaintProperty(id, "text-color", "#39425a"); map.setPaintProperty(id, "text-halo-color", "#03050a"); }
    } catch (e) {}
  }
}

function addLayers() {
  if (map.getLayer("bld")) return true;
  try {
    styleBase();
    const sym = map.getStyle().layers.find(l => l.type === "symbol" && l.layout?.visibility !== "none")?.id;
    map.addSource("zones", { type: "geojson", data: S.zones, promoteId: "id" });
    map.addLayer({ id: "zf", type: "fill", source: "zones", paint: { "fill-color": "#000", "fill-opacity": 0 } }, sym);
    map.addLayer({ id: "zl", type: "line", source: "zones", paint: { "line-color": "#2a3550", "line-width": 0.4, "line-opacity": 0.5 } }, sym);
    map.addSource("bld", { type: "vector", url: "pmtiles://" + new URL("data/buildings.pmtiles", location.href).href, attribution: "NYC OpenData Building Footprints" });
    map.addLayer({ id: "bld", type: "fill-extrusion", source: "bld", "source-layer": "b", minzoom: 10.9,
      paint: { "fill-extrusion-height": ["get", "h"], "fill-extrusion-base": 0, "fill-extrusion-color": "#1a2030", "fill-extrusion-opacity": 0.97, "fill-extrusion-color-transition": { duration: 0 },
        "fill-extrusion-vertical-gradient": true } }, sym);
    map.on("click", "zf", e => { S.sel = e.features[0].properties.id; zonePanel(); });
    map.on("mousemove", "zf", () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", "zf", () => (map.getCanvas().style.cursor = ""));
    return true;
  } catch (e) { console.warn(e); return false; }
}

function paintZones(st, hc) {                                     // buildings: one uniform colour that breathes with the heartbeat
  const bt = st.beat || 0;
  map.setPaintProperty("bld", "fill-extrusion-color", rgb(mix(mix(BASE, hc, 0.07), [255, 255, 255], 0.02 + 0.06 * bt)));
}

// ── deck layers ──
const ADD = { blend: true, blendColorOperation: "add", blendColorSrcFactor: "src-alpha", blendColorDstFactor: "one",
  blendAlphaOperation: "add", blendAlphaSrcFactor: "one", blendAlphaDstFactor: "one-minus-src-alpha", depthCompare: "always" };
const ALT = 160;                                                  // the hearts hover just above street level
function beat(phase, bpm) { const x = (phase * bpm / 60) % 1; return Math.exp(-(((x - 0.02) / 0.05) ** 2)) + 0.55 * Math.exp(-(((x - 0.2) / 0.06) ** 2)); }

function deckLayers(st, hc) {
  const L = [], t = S.t, hcA = a => [...hc.map(Math.round), a];
  const hot = mix(hc, [255, 244, 230], 0.35);
  L.push(new deck.GeoJsonLayer({ id: "zlight", data: S.zones, filled: true, stroked: false, extruded: false,
    getFillColor: f => { const v = vOf(st, f.properties.id); const c = v < 0.7 ? hc : mix(hc, hot, (v - 0.7) / 0.3); return [...c.map(Math.round), Math.round(255 * 0.7 * Math.pow(v, 2.6))]; },
    parameters: ADD, updateTriggers: { getFillColor: t } }));
  const zl = []; for (let z = 1; z <= NZ; z++) zl.push(z);
  if (S.layers.has("subway")) {
    L.push(new deck.ScatterplotLayer({ id: "sub", data: S.sub.stations.map((s, i) => [s[2], s[3], st.sv[i]]).filter(d => d[2] > 2),
      getPosition: d => [d[0], d[1], 15], getRadius: d => 18 + Math.sqrt(d[2]) * 9, radiusUnits: "meters", getFillColor: [...ICE, 70],
      stroked: true, getLineColor: [...ICE, 160], lineWidthMinPixels: 0.6, parameters: ADD, updateTriggers: { getRadius: t } }));
  }
  if (S.layers.has("marks")) {
    L.push(new deck.ScatterplotLayer({ id: "pu", data: zl, getPosition: z => [S.cen[2 * z], S.cen[2 * z + 1], 20],
      getRadius: z => Math.sqrt(st.pu[z] * 6) * 8, radiusUnits: "meters", getFillColor: z => hcA(Math.round(25 + 95 * vOf(st, z))), parameters: ADD, updateTriggers: { getRadius: t, getFillColor: t } }));
    L.push(new deck.ScatterplotLayer({ id: "do", data: zl, getPosition: z => [S.cen[2 * z], S.cen[2 * z + 1], 22], filled: false, stroked: true,
      getRadius: z => Math.sqrt(st.du[z] * 6) * 8 + 25, radiusUnits: "meters", getLineColor: z => hcA(Math.round(30 + 110 * vOf(st, z))), lineWidthMinPixels: 1, parameters: ADD,
      updateTriggers: { getRadius: t, getLineColor: t } }));
    const top = zl.map(z => [z, st.pu[z] + st.du[z]]).sort((a, b) => b[1] - a[1]).slice(0, 6);
    for (let k = 0; k < 3; k++) {
      const ph = (S.phase * 0.55 + k / 3) % 1;
      L.push(new deck.ScatterplotLayer({ id: "ring" + k, data: top, getPosition: d => [S.cen[2 * d[0]], S.cen[2 * d[0] + 1], 25], filled: false, stroked: true,
        getRadius: d => (Math.sqrt(d[1] * 6) * 8) * (1 + ph * 2.6), radiusUnits: "meters", getLineColor: hcA(Math.round(210 * (1 - ph) ** 1.6)),
        lineWidthMinPixels: 2, parameters: ADD, updateTriggers: { getRadius: [t, ph], getLineColor: [t, ph] } }));
    }
  }
  if (S.layers.has("dots")) {
    L.push(new deck.TripsLayer({ id: "dots", data: S.dots, getPath: d => d.path, getTimestamps: d => d.ts, getColor: d => d.c,
      currentTime: t, trailLength: 7, fadeTrail: true, widthMinPixels: 2, capRounded: true, jointRounded: true, opacity: 0.9, parameters: ADD }));
  }
  // hearts: where trips are densest now — the city (all car trips), each borough, and the subway. Low above the ground, no parallax.
  const upto = Math.floor(st.f), bt = st.beat;
  const trailOf = (series, cur, z) => { const a = series.slice(0, upto + 1).map(p => [p[0], p[1], z]); a.push([cur[0], cur[1], z]); return a; };
  const segs = (a, colFn) => { const o = []; for (let i = 1; i < a.length; i++) o.push([a[i - 1], a[i], colFn(i)]); return o; };
  const ct = trailOf(S.heart, st.heart, 70);
  const cseg = segs(ct, i => [...hourColor(Math.min(i, st.f) * 10 + 5).map(Math.round), 255]);
  L.push(new deck.LineLayer({ id: "trailGlow", data: cseg, getSourcePosition: d => d[0], getTargetPosition: d => d[1], getColor: d => [d[2][0], d[2][1], d[2][2], 60],
    getWidth: 14, widthUnits: "pixels", parameters: ADD, updateTriggers: { getSourcePosition: t, getTargetPosition: t, getColor: t } }));
  L.push(new deck.LineLayer({ id: "trail", data: cseg, getSourcePosition: d => d[0], getTargetPosition: d => d[1], getColor: d => d[2],
    getWidth: 3.5, widthUnits: "pixels", parameters: ADD, updateTriggers: { getSourcePosition: t, getTargetPosition: t, getColor: t } }));
  const orbs = [{ p: st.heart, c: hc, s: 1, label: "CITY HEART" }];
  const bmax = Math.max(...Object.values(S.boroTot).flat());
  const bseg = [];
  for (const [b, o] of Object.entries(st.boro)) {
    orbs.push({ p: o.p, c: mix(hc, [255, 255, 255], 0.25), s: 0.42 + 0.3 * Math.sqrt(o.n / bmax), label: b.toUpperCase() });
    bseg.push(...segs(trailOf(S.boroHeart[b], o.p, 60), () => [...mix(hc, [255, 255, 255], 0.25).map(Math.round), 150]));
  }
  if (S.layers.has("subway")) {
    bseg.push(...segs(trailOf(S.subHeart, st.sheart, 60), () => [...ICE, 170]));
    orbs.push({ p: st.sheart, c: ICE, s: 0.8, label: "SUBWAY HEART" });
  }
  L.push(new deck.LineLayer({ id: "btrail", data: bseg, getSourcePosition: d => d[0], getTargetPosition: d => d[1], getColor: d => d[2],
    getWidth: 2, widthUnits: "pixels", parameters: ADD, updateTriggers: { getSourcePosition: t, getTargetPosition: t, getColor: t } }));
  L.push(new deck.ScatterplotLayer({ id: "halo", data: orbs, getPosition: d => [d.p[0], d.p[1], 3], filled: false, stroked: true, radiusUnits: "meters",
    getRadius: d => d.s * (260 + 160 * bt), getLineColor: d => [...d.c.map(Math.round), 170], lineWidthMinPixels: 1.5, parameters: ADD,
    updateTriggers: { getPosition: t, getRadius: [t, bt], getLineColor: t } }));
  L.push(new deck.LineLayer({ id: "beam", data: orbs, getSourcePosition: d => [d.p[0], d.p[1], 0], getTargetPosition: d => [d.p[0], d.p[1], ALT],
    getColor: d => [...d.c.map(Math.round), 150], getWidth: 2, widthUnits: "pixels", parameters: ADD, updateTriggers: { getSourcePosition: t, getTargetPosition: t, getColor: t } }));
  for (const [r, a] of [[3.2, 26], [1.9, 60], [1.15, 140]]) {
    L.push(new deck.ScatterplotLayer({ id: "orb" + r, data: orbs, getPosition: d => [d.p[0], d.p[1], ALT], billboard: true, radiusUnits: "pixels",
      getRadius: d => d.s * (9 + 9 * bt) * r, getFillColor: d => [...d.c.map(Math.round), a], parameters: ADD,
      updateTriggers: { getPosition: t, getRadius: [t, bt], getFillColor: t } }));
  }
  L.push(new deck.ScatterplotLayer({ id: "core", data: orbs, getPosition: d => [d.p[0], d.p[1], ALT], billboard: true, radiusUnits: "pixels",
    getRadius: d => d.s * (5 + 3 * bt), getFillColor: [255, 255, 255, 255], parameters: { depthCompare: "always" }, updateTriggers: { getPosition: t, getRadius: [t, bt] } }));
  L.push(new deck.TextLayer({ id: "hl", data: orbs, getPosition: d => [d.p[0], d.p[1], ALT], getText: d => d.label, getSize: d => d.s === 1 ? 12.5 : 10.5,
    getColor: [235, 240, 250, 230], getPixelOffset: d => [0, -24 - 14 * d.s], fontFamily: "Inter, sans-serif", fontWeight: 700, characterSet: "auto", outlineWidth: 2,
    outlineColor: [3, 5, 10, 220], fontSettings: { sdf: true }, billboard: true, parameters: { depthCompare: "always" }, updateTriggers: { getPosition: t } }));
  // landmarks
  const shown = [];                                                  // landmarks: hide labels that would overlap on screen
  for (const d of [...LANDMARKS].sort((a, b) => b[3] - a[3])) {
    const p = map.project([d[1], d[2]]); const w = d[0].length * 7;
    if (shown.every(q => Math.abs(q.p.x - p.x) > (w + q.w) / 2 + 8 || Math.abs(q.p.y - p.y) > 26)) shown.push({ d, p, w });
  }
  const LM = shown.map(q => q.d);
  L.push(new deck.LineLayer({ id: "lmL", data: LM, getSourcePosition: d => [d[1], d[2], 0], getTargetPosition: d => [d[1], d[2], d[3]],
    getColor: [220, 228, 245, 90], getWidth: 1, widthUnits: "pixels" }));
  L.push(new deck.TextLayer({ id: "lmT", data: LM, getPosition: d => [d[1], d[2], d[3]], getText: d => d[0], getSize: 11.5, getColor: [225, 232, 248, 230],
    getPixelOffset: [0, -8], getTextAnchor: "middle", getAlignmentBaseline: "bottom", fontFamily: "Inter, sans-serif", fontWeight: 600, characterSet: "auto",
    outlineWidth: 2.5, outlineColor: [3, 5, 10, 230], fontSettings: { sdf: true }, billboard: true, parameters: { depthCompare: "always" },
 }));
  return L;
}

// ── UI ──
function bars() {
  const mx = Math.max(...S.hourly), smx = Math.max(...S.subTot);
  $("#bars").innerHTML = S.hourly.map((v, h) => `<i data-h="${h}" style="height:${4 + 50 * v / mx}px;background:${rgb(hourColor(h * 60 + 30))};color:${rgb(hourColor(h * 60 + 30))}"></i>`).join("") +
    `<svg viewBox="0 0 240 54" preserveAspectRatio="none"><polyline fill="none" stroke="rgb(${ICE})" stroke-width="1.4" stroke-opacity=".9" vector-effect="non-scaling-stroke"
      points="${S.subTot.map((v, h) => `${h * 10 + 5},${54 - 50 * v / smx}`).join(" ")}"/></svg>`;
  $("#bars").querySelectorAll("i").forEach(el => el.onclick = () => setT(+el.dataset.h * 60 + 30, true));
}
const nearest = p => { let best = 1, bd = 1e9; for (let z = 1; z <= NZ; z++) { const d = (S.cen[2 * z] - p[0]) ** 2 + (S.cen[2 * z + 1] - p[1]) ** 2; if (d < bd) { bd = d; best = z; } } return S.zname[best]; };
let lastUI = -1;
function ui(st, hc) {
  const c = rgb(hc); document.documentElement.style.setProperty("--hc", c);
  const mm = Math.floor(S.t) % 1440; $("#clk").textContent = `${String(Math.floor(mm / 60)).padStart(2, "0")}:${String(mm % 60).padStart(2, "0")}`;
  $("#t").value = mm;
  $("#hb").style.transform = `scale(${(1 + 0.32 * st.beat).toFixed(3)})`;
  if (Math.floor(S.t / 2) === lastUI) return;
  $("#pr").textContent = fmt(st.rate); lastUI = Math.floor(S.t / 2);
  $("#part").textContent = partOfDay(mm);
  $("#nTaxi").textContent = fmt(st.rate * 60); $("#nSub").textContent = fmt(st.sv.reduce((a, b) => a + b, 0) * 6);
  const h = Math.floor(mm / 60); $("#bars").querySelectorAll("i").forEach((el, i) => el.classList.toggle("on", i === h));
  const sn = p => { let bi = 0, bd = 1e9; S.SP.forEach((q, i) => { const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2; if (d < bd) { bd = d; bi = i; } }); return S.sub.stations[bi][0].replace(/ \(.*\)$/, ""); };
  $("#heartTxt").innerHTML = `<span class="hl">Hearts = where trips are densest right now</span>City: <b>${nearest(st.heart)}</b> · Brooklyn: <b>${nearest(st.boro.Brooklyn.p)}</b> · Queens: <b>${nearest(st.boro.Queens.p)}</b> · Bronx: <b>${nearest(st.boro.Bronx.p)}</b>` +
    (S.layers.has("subway") ? ` · Subway: <b>${sn(st.sheart)}</b>` : "");
  const fact = S.stats.facts.filter(f => mm >= f[0] && mm < f[0] + 75).pop();
  if ((fact && fact[1]) !== S.lastFact) { S.lastFact = fact && fact[1]; const el = $("#fact");
    el.classList.remove("show"); if (fact) setTimeout(() => { $("#factT").textContent = fact[1]; el.classList.add("show"); }, 250); }
  if (S.sel) zoneMarker();
}
function zonePanel() {
  const z = S.sel; if (!z) return $("#zone").classList.add("hidden");
  $("#zone").classList.remove("hidden"); $("#zn").textContent = S.zname[z]; $("#zb").textContent = S.zboro[z];
  const pu = [], du = []; for (let b = 0; b < NB; b++) { pu.push(S.PU[b * NZ + z - 1] * 6); du.push(S.DO[b * NZ + z - 1] * 6); }
  const mx = Math.max(...pu, ...du, 1), X = b => b / (NB - 1) * 300, Y = v => 86 - v / mx * 78;
  const stops = HC.map(([m, h]) => `<stop offset="${m / 1440}" stop-color="${h}"/>`).join("");
  $("#spark").innerHTML = `<defs><linearGradient id="dg" x1="0" x2="1">${stops}</linearGradient></defs>
    <path d="M0,86 ${pu.map((v, b) => `L${X(b)},${Y(v)}`).join(" ")} L300,86Z" fill="url(#dg)" opacity=".75"/>
    <path d="${du.map((v, b) => `${b ? "L" : "M"}${X(b)},${Y(v)}`).join(" ")}" fill="none" stroke="#fff" stroke-width="1.3" stroke-dasharray="3 2" opacity=".85"/>
    <line id="zm" x1="0" x2="0" y1="0" y2="90" stroke="#fff" stroke-width="1"/>`;
  const sum = (a, h0, h1) => a.slice(h0 * 6, h1 * 6).reduce((x, y) => x + y, 0) / 6;
  const peak = pu.map((v, i) => v + du[i]).reduce((bi, v, i, a) => v > a[bi] ? i : bi, 0);
  $("#zk").innerHTML = `<span><b>${fmt(sum(pu, 0, 24))}</b>pickups</span><span><b>${fmt(sum(du, 0, 24))}</b>drop-offs</span><span><b>${String(Math.floor(peak / 6)).padStart(2, "0")}:${peak % 6}0</b>busiest</span>
    <span><b>${fmt(sum(du, 7, 10))}</b>arrive 7–10</span><span><b>${fmt(sum(pu, 17, 20))}</b>leave 17–20</span><span style="color:#8892a8">filled: pickups · dashed: drop-offs</span>`;
  zoneMarker();
}
function zoneMarker() { const el = document.getElementById("zm"); if (el) { const x = (S.t % 1440) / 1440 * 300; el.setAttribute("x1", x); el.setAttribute("x2", x); } }

function syncChips() {
  document.querySelectorAll("[data-mode]").forEach(b => b.classList.toggle("on", GROUP[b.dataset.mode].every(m => S.modes.has(m))));
  document.querySelectorAll("[data-layer]").forEach(b => b.classList.toggle("on", S.layers.has(b.dataset.layer)));
}
function setT(t, jump) { S.t = ((t % 1440) + 1440) % 1440; if (jump) S.lastBuild = -99; }

// ── camera ──
function cam(t) {
  t = ((t % 1440) + 1440) % 1440;
  let i = CAM.findIndex(c => c[0] > t); if (i < 1) i = 1;
  const P = j => CAM[Math.max(0, Math.min(CAM.length - 1, j))], a = P(i - 1), b = P(i), p0 = P(i - 2), p3 = P(i + 1);
  const k = (t - a[0]) / (b[0] - a[0]);
  const cr = (q0, q1, q2, q3) => { const k2 = k * k, k3 = k2 * k; return 0.5 * (2 * q1 + (-q0 + q2) * k + (2 * q0 - 5 * q1 + 4 * q2 - q3) * k2 + (-q0 + 3 * q1 - 3 * q2 + q3) * k3); };
  const v = [1, 2, 3, 4, 5].map(n => cr(p0[n], a[n], b[n], p3[n]));
  return { center: [v[0], v[1]], zoom: v[2], pitch: v[3], bearing: v[4] };
}

// ── loop ──
function frame(st) {
  const hc = hourColor(S.t);
  st.bpm = 46 + 74 * st.rate / (S.rateMax / 10); st.beat = beat(S.phase, st.bpm);
  paintZones(st, hc);
  overlay.setProps({ layers: deckLayers(st, hc) });
  ui(st, hc);
}
S.render = () => { const st = at(S.t); frame(st); return st; };
let last = performance.now();
function tick(now) {
  const dt = Math.min(100, now - last); last = now;
  if (!S.manual) {
    S.phase += dt / 1000;
    if (S.playing) setT(S.t + dt / 1000 * 20 * S.speed);
    if (S.layers.has("cine") && S.playing) map.jumpTo(cam(S.t));
    S.render();
  }
  requestAnimationFrame(tick);
}

async function main() {
  initMap();
  await load(); prepDots(); combine();
  $("#ramp").style.background = $("#grad").style.background = `linear-gradient(90deg, ${HC.map(([m, h]) => `${h} ${(m / 14.4).toFixed(1)}%`).join(", ")})`;
  await document.fonts.ready;
  const go = () => { if (!addLayers()) return false; S.ready = true; requestAnimationFrame(tick); return true; };
  if (map.isStyleLoaded() && go()) {} else { map.once("load", () => go()); const p = setInterval(() => { if (S.ready) return clearInterval(p); if (map.style?._loaded && go()) clearInterval(p); }, 300); }
  $("#play").onclick = () => { S.playing = !S.playing; $("#play").textContent = S.playing ? "❚❚" : "▶"; };
  $("#t").oninput = e => { setT(+e.target.value, true); };
  $("#spd").onclick = () => { S.speed = S.speed === 1 ? 2 : S.speed === 2 ? 4 : S.speed === 4 ? 0.5 : 1; $("#spd").textContent = S.speed + "×"; };
  document.querySelectorAll("[data-mode]").forEach(b => b.onclick = () => {
    const g = GROUP[b.dataset.mode], on = g.every(m => S.modes.has(m));
    if (on) { if (S.modes.size > g.length) g.forEach(m => S.modes.delete(m)); } else g.forEach(m => S.modes.add(m)); syncChips(); combine(); zonePanel(); });
  document.querySelectorAll("[data-layer]").forEach(b => b.onclick = () => {
    const l = b.dataset.layer; S.layers.has(l) ? S.layers.delete(l) : S.layers.add(l); syncChips(); lastUI = -1; });
  $("#zx").onclick = () => { S.sel = null; zonePanel(); };
  $("#about-b").onclick = () => $("#about").classList.remove("hidden"); $("#ax").onclick = () => $("#about").classList.add("hidden");
  document.addEventListener("keydown", e => { if (e.code === "Space" && e.target.tagName !== "INPUT") { e.preventDefault(); $("#play").click(); } });
}
main();
