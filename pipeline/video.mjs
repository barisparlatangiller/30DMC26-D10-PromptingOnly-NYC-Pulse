// 12 s LinkedIn video (1080×1350, 24 fps): 24 hours of New York in one continuous orbit, rendered frame by frame from the live map.
//   0.0–1.6 s  night, the camera sinks towards Midtown, title
//   1.6–9.6 s  the whole day 01:00 → 23:59 while the camera circles Manhattan; clock, live counts, the hearts beat
//   9.6–12  s  the city settles into night, the closing card
// Rendered in shards (GitHub Actions matrix):  SHARD=i NSHARD=n node pipeline/video.mjs  → media/frames/f####.png
// Then:  JOIN=1 node pipeline/video.mjs  → media/day10_nyc_pulse_12s.mp4 + cover.jpg      THUMB_ONLY=1 → media/thumb_full.jpg
import { chromium } from "playwright";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import http from "node:http";
import path from "node:path";

const OUT = "media", FR = "media/frames", FPS = 24;
const OPEN = 38, SWEEP = 192, END = 58, N = OPEN + SWEEP + END;          // 288 frames = 12.0 s
fs.mkdirSync(FR, { recursive: true });

// ── the plan: time of day and camera for every frame ──
const ease = k => k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
const lerp = (a, b, k) => a + (b - a) * k;
const C0 = [-73.978, 40.738];                                              // orbit centre: between Midtown and Downtown
function planAt(n) {
  const sec = n / FPS;
  let t, card = 0, title = 1;
  if (n < OPEN) t = lerp(0, 60, n / OPEN);
  else if (n < OPEN + SWEEP) t = lerp(60, 1439, ease((n - OPEN) / (SWEEP - 1)));
  else { t = 1439.5; card = Math.min(1, (n - OPEN - SWEEP) / 12); }
  // one continuous orbit: 200° over the 12 s, a slow sink at the start, closer at the morning and evening peaks
  const k = n / (N - 1);
  const bearing = lerp(-58, 142, k);
  const sink = ease(Math.min(1, n / OPEN));
  const peak = Math.exp(-(((t - 520) / 170) ** 2)) * 0.45 + Math.exp(-(((t - 1080) / 190) ** 2)) * 0.55;
  const zoom = lerp(10.55, 11.35, sink) + 0.75 * peak - (card ? 0.25 * ease(card) : 0);
  const pitch = lerp(38, 60, sink) + 4 * peak;
  const center = [C0[0] + 0.012 * Math.sin(k * Math.PI), C0[1] + 0.006 * Math.cos(k * Math.PI * 1.3)];
  return { n, t, phase: sec, cam: { center, zoom, pitch, bearing }, card, title, open: Math.min(1, n / 10) };
}

if (process.env.JOIN) {                                                    // encode the frames from all shards
  const have = fs.readdirSync(FR).filter(f => f.endsWith(".png")).length;
  if (have !== N) { console.error(`expected ${N} frames, found ${have}`); process.exit(1); }
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", `${FR}/f%04d.png`,
    "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", `${OUT}/day10_nyc_pulse_12s.mp4`]);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", `${FR}/f${String(OPEN + Math.round(SWEEP * 0.74)).padStart(4, "0")}.png`, "-q:v", "2", `${OUT}/cover.jpg`]);
  console.log(`${N} frames, ${(N / FPS).toFixed(1)} s, ${(fs.statSync(`${OUT}/day10_nyc_pulse_12s.mp4`).size / 1e6).toFixed(2)} MB`);
  process.exit(0);
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".geojson": "application/geo+json" };
http.createServer((req, res) => {                                   // static server with HTTP Range (PMTiles)
  const u = decodeURIComponent(new globalThis.URL(req.url, "http://x").pathname);
  const f = path.join("docs", u.endsWith("/") ? u + "index.html" : u);
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  const size = fs.statSync(f).size, type = TYPES[path.extname(f)] || "application/octet-stream";
  const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || "");
  if (m) { const a = +m[1], b = m[2] ? Math.min(+m[2], size - 1) : size - 1;
    res.writeHead(206, { "Content-Type": type, "Content-Length": b - a + 1, "Content-Range": `bytes ${a}-${b}/${size}`, "Accept-Ranges": "bytes" });
    fs.createReadStream(f, { start: a, end: b }).pipe(res);
  } else { res.writeHead(200, { "Content-Type": type, "Content-Length": size, "Accept-Ranges": "bytes" }); fs.createReadStream(f).pipe(res); }
}).listen(8000);

const URL = "http://localhost:8000/";
const ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-dev-shm-usage"];
const ready = p => p.waitForFunction(() => window.S && S.ready && S.map.getLayer("bld"), null, { timeout: 240000 });
const settle = p => p.evaluate(() => new Promise(r => { let done = false; const fin = () => { if (!done) { done = true; setTimeout(r, 30); } };
  S.map.once("idle", fin); S.map.triggerRepaint(); setTimeout(fin, 6000); }));
let br = await chromium.launch({ args: ARGS });

if (process.env.THUMB_ONLY) {                                              // hub thumbnail: the desktop page at 18:10
  const p = await br.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto(URL, { waitUntil: "networkidle" }); await ready(p);
  await p.evaluate(() => { S.manual = true; S.t = 1090; S.phase = 0.3; S.map.jumpTo({ center: [-73.984, 40.748], zoom: 12.3, pitch: 62, bearing: -30 }); S.render(); });
  await settle(p); await p.evaluate(() => S.render()); await p.waitForTimeout(1500);
  await p.screenshot({ path: `${OUT}/thumb_full.jpg`, type: "jpeg", quality: 90, timeout: 240000 });
  await br.close(); process.exit(0);
}

const CSS = `
  .card, .ctl, .legend, .time, .zone, .about, .fact, .maplibregl-ctrl-bottom-left, .maplibregl-ctrl-bottom-right { display: none !important; }
  body::after { content: ""; position: absolute; inset: 0; z-index: 5; pointer-events: none;
    background: linear-gradient(180deg, rgba(5,7,14,.92) 0%, rgba(5,7,14,.55) 22%, rgba(5,7,14,0) 40%, rgba(5,7,14,0) 66%, rgba(5,7,14,.8) 100%); }
  .v { position: absolute; z-index: 6; left: 54px; right: 54px; font-family: Inter; color: #eef1f8; }
  .v.top { top: 50px; }
  .v .eb { font-size: 19px; letter-spacing: .18em; text-transform: uppercase; color: #9aa3bb; font-weight: 600; }
  .v h1 { font-size: 112px; font-weight: 800; letter-spacing: -.045em; margin: 4px 0 0; line-height: .92;
    background: linear-gradient(90deg, #fff 25%, var(--hc)); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .v .q { font-size: 30px; color: #c3cadd; margin-top: 12px; }
  .v.clock { top: 300px; display: flex; align-items: center; gap: 20px; }
  .v.clock b { font-family: "JetBrains Mono"; font-size: 96px; font-weight: 700; color: var(--hc); text-shadow: 0 0 40px var(--hc); letter-spacing: -.02em; }
  .v.clock span { font-size: 25px; color: #c3cadd; line-height: 1.3; } .v.clock span i { font-style: normal; color: #fff; font-weight: 700; }
  .v.bot { bottom: 52px; }
  .v .row { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  .v .row b { display: block; font-size: 52px; font-weight: 800; font-variant-numeric: tabular-nums; letter-spacing: -.02em; }
  .v .row span { font-size: 20px; color: #9aa3bb; }
  .v .ramp { height: 8px; border-radius: 4px; margin-top: 22px; position: relative; }
  .v .ramp i { position: absolute; top: -8px; width: 4px; height: 24px; border-radius: 2px; background: #fff; box-shadow: 0 0 14px #fff; }
  .v .ticks { display: flex; justify-content: space-between; font: 600 15px "JetBrains Mono"; color: #7d869d; margin-top: 8px; }
  .card2 { position: absolute; z-index: 7; left: 60px; right: 60px; bottom: 70px; background: rgba(8,11,20,.84); border: 1px solid rgba(255,255,255,.12);
    border-radius: 28px; padding: 42px 46px; backdrop-filter: blur(18px); font-family: Inter; color: #eef1f8; opacity: 0; transform: translateY(var(--dy, 40px)); }
  .card2 h2 { font-size: 58px; margin: 0 0 22px; letter-spacing: -.035em; line-height: 1.0; }
  .card2 .stat { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 22px; }
  .card2 .stat b { display: block; font-size: 46px; font-weight: 800; letter-spacing: -.03em; color: var(--hc); } .card2 .stat span { font-size: 19px; color: #a9b1c6; }
  .card2 li { font-size: 25px; line-height: 1.38; color: #d0d6e6; margin: 0 0 8px; }
  .card2 .url { margin-top: 20px; font-size: 25px; font-weight: 700; color: #fff; }
  .card2 .att { margin-top: 8px; font-size: 15px; color: #7c869e; }
`;
async function openPage() {
  const page = await br.newPage({ viewport: { width: 1080, height: 1350 } });
  page.on("console", m => m.type() === "error" && console.log("console:", m.text()));
  await page.goto(URL, { waitUntil: "networkidle" }); await ready(page);
  await page.addStyleTag({ content: CSS });
  await page.evaluate(() => {
    S.manual = true;
    const st = S.stats, tot = Object.values(st.trips).reduce((a, b) => a + b, 0);
    document.body.insertAdjacentHTML("beforeend", `<div class="v top" id="vtop"><div class="eb">#30DayMapChallenge · Day 10 · Prompting only</div>
      <h1>NYC Pulse</h1><div class="q">Where does New York's heart beat? One Tuesday, 24 hours.</div></div>
      <div class="v clock" id="vclk"><b id="vc">00:00</b><span>Tue 16 June 2026<br><i id="vp">night</i></span></div>
      <div class="v bot" id="vbot"><div class="row"><div><b id="vt">0</b><span>car trips starting / hour</span></div><div><b id="vs">0</b><span>subway entries / hour</span></div></div>
      <div class="ramp" id="vr"><i id="vi"></i></div><div class="ticks"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div></div>
      <div class="card2" id="c2"><h2>New York in one day</h2>
        <div class="stat"><div><b>${(tot / 1000).toFixed(0)}k</b><span>car trips</span></div><div><b>${(st.subway_entries / 1e6).toFixed(1)}M</b><span>subway entries</span></div><div><b>1.08M</b><span>3D buildings</span></div></div>
        <ul><li>Quietest at 03:00, busiest at 08:40: <b>9×</b> more trips a minute.</li>
        <li>The city heart stays in <b>Midtown</b> almost all day.</li><li>Uber and Lyft carry <b>84%</b> of car trips.</li></ul>
        <div class="url">Play the day yourself → barisparlatangiller.github.io</div>
        <div class="att">NYC TLC trip records · MTA ridership · NYC OpenData buildings · © CARTO, © OpenStreetMap · made only by prompting Claude</div></div>`);
    document.getElementById("vr").style.background = document.getElementById("ramp").style.background;
    S.map.resize();
  });
  return page;
}

const SHARD = +(process.env.SHARD || 0), NSHARD = +(process.env.NSHARD || 1);
const mine = []; for (let n = 0; n < N; n++) if (n % NSHARD === SHARD) mine.push(planAt(n));
let page = await openPage(), done = 0;
for (const fr of mine) {
  if (done > 0 && done % 24 === 0) { await br.close(); br = await chromium.launch({ args: ARGS }); page = await openPage(); }
  await page.evaluate(fr => {
    S.t = fr.t; S.phase = fr.phase; S.map.jumpTo(fr.cam);
    const st = S.render(), mm = Math.min(1439, Math.floor(fr.t));
    document.getElementById("vc").textContent = `${String(Math.floor(mm / 60)).padStart(2, "0")}:${String(mm % 60).padStart(2, "0")}`;
    document.getElementById("vp").textContent = mm < 300 ? "night" : mm < 600 ? "morning rush" : mm < 960 ? "day" : mm < 1200 ? "evening rush" : "night";
    document.getElementById("vt").textContent = Math.round(st.rate * 60).toLocaleString("en-US");
    document.getElementById("vs").textContent = Math.round(st.sv.reduce((a, b) => a + b, 0) * 6).toLocaleString("en-US");
    document.getElementById("vi").style.left = `calc(${(fr.t / 1440 * 100).toFixed(2)}% - 2px)`;
    const c = fr.card, e = c * c * (3 - 2 * c);
    document.getElementById("vtop").style.opacity = fr.open;
    for (const id of ["vclk", "vbot"]) document.getElementById(id).style.opacity = fr.open * (1 - e);
    const c2 = document.getElementById("c2"); c2.style.opacity = e; c2.style.setProperty("--dy", `${(1 - e) * 40}px`);
  }, fr);
  await page.evaluate(() => new Promise(r => { S.map.once("idle", () => setTimeout(r, 20)); S.map.triggerRepaint(); setTimeout(r, 2200); }));
  await page.screenshot({ path: `${FR}/f${String(fr.n).padStart(4, "0")}.png`, timeout: 240000 }); done++;
  if (done % 6 === 0) console.log(`shard ${SHARD}: ${done}/${mine.length}`, new Date().toISOString());
}
await br.close();
console.log(`shard ${SHARD} done: ${done} frames`);
process.exit(0);
