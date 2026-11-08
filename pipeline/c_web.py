"""
Web layers and a QGIS GeoPackage.

  heart of the hour = trip-weighted mean position of the taxi-zone centres (pickups + drop-offs in that hour);
                      for the subway, entry-weighted mean position of the station complexes.
  It is a weighted centre of these trips, not where people are, and not "the" centre of New York.

  python pipeline/c_web.py
Output  docs/data/zones.geojson · pulse.json · dots.json · subway.json · stats.json · build/nyc_pulse_2026-06-16.gpkg
"""
import io, json, zipfile
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import requests
from shapely.geometry import LineString, Point

IN, B, W = Path("input"), Path("build"), Path("docs/data")
W.mkdir(parents=True, exist_ok=True)
NB, NZ = 144, 263
MODES = ["yellow", "green", "hv"]

f = IN / "taxi_zones.zip"
if not f.exists():
    r = requests.get("https://d37ci6vzurychx.cloudfront.net/misc/taxi_zones.zip", timeout=300); r.raise_for_status(); f.write_bytes(r.content)
z = gpd.read_file(f"zip://{f}").to_crs(2263)
z["LocationID"] = z.LocationID.astype(int)
z = z.dissolve("LocationID", aggfunc="first").reset_index()                     # a few IDs come in two pieces
z = z[z.LocationID <= NZ].sort_values("LocationID")
big = z.geometry.apply(lambda g: max(g.geoms, key=lambda p: p.area) if g.geom_type == "MultiPolygon" else g)
z["cx"] = big.centroid.x; z["cy"] = big.centroid.y
cen = gpd.GeoSeries(gpd.points_from_xy(z.cx, z.cy), crs=2263).to_crs(4326)
z["lon"] = cen.x.round(5).values; z["lat"] = cen.y.round(5).values

b = pd.read_parquet(B / "bins.parquet")
b = b[(b.bin >= 0) & (b.bin < NB)]
arr = {m: {k: np.zeros((NB, NZ), dtype=np.int32) for k in ("pu", "do")} for m in MODES}
for (m, k), g in b.groupby(["mode", "kind"]):
    np.add.at(arr[m][k], (g.bin.values, g.zone.values - 1), g.n.values)

# web: zones
w = z.to_crs(4326)
w["geometry"] = w.simplify(0.00015)
tot = sum(arr[m][k] for m in MODES for k in ("pu", "do"))
w["day"] = tot.sum(0)[w.LocationID.values - 1]
w[["LocationID", "zone", "borough", "lon", "lat", "geometry"]].rename(columns={"LocationID": "id"}).to_file(W / "zones.geojson", driver="GeoJSON", COORDINATE_PRECISION=5)

pulse = {"bins": NB, "zones": NZ, "modes": {m: {k: arr[m][k].ravel().tolist() for k in ("pu", "do")} for m in MODES}}
(W / "pulse.json").write_text(json.dumps(pulse, separators=(",", ":")))

s = pd.read_parquet(B / "sample.parquet")
s["m"] = s["mode"].map({m: i for i, m in enumerate(MODES)})
s = s.sort_values("t0")
(W / "dots.json").write_text(json.dumps(s[["m", "o", "d", "t0", "dur"]].values.round(2).tolist(), separators=(",", ":")))

sub = pd.read_parquet(B / "subway.parquet")
st = sub.groupby("station_complex_id").agg(name=("station_complex", "first"), boro=("borough", "first"), lat=("lat", "mean"), lon=("lon", "mean")).reset_index()
st["k"] = range(len(st))
mat = np.zeros((24, len(st)), dtype=np.int32)
kk = sub.merge(st[["station_complex_id", "k"]], on="station_complex_id")
np.add.at(mat, (kk.h.values, kk.k.values), kk.r.round().astype(int).values)
(W / "subway.json").write_text(json.dumps({"stations": st[["name", "boro", "lon", "lat"]].round(5).values.tolist(), "h": mat.tolist()}, separators=(",", ":")))

# hearts (all modes) for stats and the GeoPackage
xy = np.c_[z.cx.values, z.cy.values]
hourly = tot.reshape(24, 6, NZ).sum(1)
hx = (hourly @ xy) / hourly.sum(1, keepdims=True)
sp = gpd.GeoSeries(gpd.points_from_xy(st.lon, st.lat), crs=4326).to_crs(2263)
sxy = np.c_[sp.x.values, sp.y.values]
sh = (mat @ sxy) / np.maximum(mat.sum(1, keepdims=True), 1)
to4326 = lambda p: gpd.GeoSeries(gpd.points_from_xy(p[:, 0], p[:, 1]), crs=2263).to_crs(4326)
heart = gpd.GeoDataFrame({"hour": range(24), "trips": hourly.sum(1)}, geometry=gpd.points_from_xy(hx[:, 0], hx[:, 1]), crs=2263)
sheart = gpd.GeoDataFrame({"hour": range(24), "entries": mat.sum(1)}, geometry=gpd.points_from_xy(sh[:, 0], sh[:, 1]), crs=2263)
trail = gpd.GeoDataFrame({"layer": ["taxi heart", "subway heart"]}, geometry=[LineString(hx), LineString(sh)], crs=2263)

zz = z[["LocationID", "zone", "borough", "geometry"]].copy()
zz["pickups"] = sum(arr[m]["pu"] for m in MODES).sum(0)[zz.LocationID - 1]
zz["dropoffs"] = sum(arr[m]["do"] for m in MODES).sum(0)[zz.LocationID - 1]
zz["peak_hour"] = hourly.argmax(0)[zz.LocationID - 1]
long = pd.DataFrame([(h, zid, m, k, int(arr[m][k].reshape(24, 6, NZ).sum(1)[h, zid - 1]))
                     for m in MODES for k in ("pu", "do") for h in range(24) for zid in range(1, NZ + 1)], columns=["hour", "LocationID", "mode", "kind", "trips"])
long = long[long.trips > 0]
gp = B / "nyc_pulse_2026-06-16.gpkg"
gp.unlink(missing_ok=True)
zz.to_file(gp, layer="taxi_zones_day")
zz.merge(long.pivot_table(index=["LocationID", "hour"], columns="kind", values="trips", aggfunc="sum").reset_index(), on="LocationID").to_file(gp, layer="hourly_pulse")
heart.to_file(gp, layer="taxi_heart_points"); sheart.to_file(gp, layer="subway_heart_points"); trail.to_file(gp, layer="heart_trails")
gpd.GeoDataFrame(st, geometry=gpd.points_from_xy(st.lon, st.lat), crs=4326).to_file(gp, layer="subway_stations")

qa = json.loads((B / "qa.json").read_text())
names = dict(zip(z.LocationID, z.zone))
H4 = to4326(hx); S4 = to4326(sh)
stats = {"day": "2026-06-16", "weekday": "Tuesday", "timezone": "America/New_York",
         "trips": {m: int(arr[m]["pu"].sum()) for m in MODES}, "dropoffs": {m: int(arr[m]["do"].sum()) for m in MODES},
         "subway_entries": int(mat.sum()), "per_dot": qa["per_dot"], "dots": len(s), "qa": qa["modes"],
         "peak_hour_taxi": int(hourly.sum(1).argmax()), "peak_hour_subway": int(mat.sum(1).argmax()),
         "top_zones": [[names[i + 1], int(v)] for i, v in sorted(enumerate(tot.sum(0)), key=lambda x: -x[1])[:8]],
         "heart": [[round(H4.x[i], 5), round(H4.y[i], 5)] for i in range(24)],
         "subway_heart": [[round(S4.x[i], 5), round(S4.y[i], 5)] for i in range(24)],
         "heart_path_km": round(float(np.linalg.norm(np.diff(hx, axis=0), axis=1).sum() * 0.0003048), 1)}
nearest = lambda p: names[int(np.argmin(((xy - p) ** 2).sum(1))) + 1]
stats["heart_zone_by_hour"] = [nearest(hx[h]) for h in range(24)]
stats["subway_heart_zone_by_hour"] = [nearest(sh[h]) for h in range(24)]
(W / "stats.json").write_text(json.dumps(stats, indent=1, ensure_ascii=False))
print(json.dumps({k: v for k, v in stats.items() if k not in ("heart", "subway_heart")}, indent=1, ensure_ascii=False))

# ── interesting facts, computed from the data; each appears in the simulation at the moment it is about ──
boro = dict(zip(z.LocationID, z.borough))
pu_all = sum(arr[m]["pu"] for m in MODES); do_all = sum(arr[m]["do"] for m in MODES)
per_bin = pu_all.sum(1)
qb, bb = int(per_bin.argmin()), int(per_bin.argmax())
hm = lambda b10: f"{b10 // 6:02d}:{b10 % 6 * 10:02d}"
cars = {m: int(arr[m]["pu"].sum()) for m in MODES}; allc = sum(cars.values())
air = [1, 132, 138]
air_share = (pu_all[:, [a - 1 for a in air]].sum() + do_all[:, [a - 1 for a in air]].sum()) / (pu_all.sum() + do_all.sum())
man = np.array([boro[i + 1] == "Manhattan" for i in range(NZ)])
hr = lambda a, h0, h1: a.reshape(24, 6, NZ)[h0:h1].sum((0, 1))
m_in, m_out = hr(do_all, 7, 10)[man].sum(), hr(pu_all, 7, 10)[man].sum()
e_in, e_out = hr(do_all, 17, 20)[man].sum(), hr(pu_all, 17, 20)[man].sum()
east = int(np.argmax(hx[:, 0]))
topz = int(tot.sum(0).argmax()); topz_peak = int(tot.reshape(24, 6, NZ).sum(1)[:, topz].argmax())
night = int(hr(pu_all + do_all, 0, 4).argmax())
sub_day = mat.sum(0); ts = int(sub_day.argmax())
ratio8 = mat[8].sum() / max(1, hourly[8].sum() / 2)
facts = [
  [int(qb * 10), f"The quietest 10 minutes: {hm(qb)}. Only {per_bin[qb] / 10:,.0f} car trips a minute start across the whole city."],
  [int(east * 60), f"At {east:02d}:00 the taxi heart drifts furthest east, to {stats['heart_zone_by_hour'][east]}: in the small hours, airport runs weigh more."],
  [60, f"After midnight the busiest zone is {names[night + 1]} ({boro[night + 1]})."],
  [7 * 60 + 30, f"Morning rush, 7–10: {m_in:,.0f} car trips end in Manhattan, {m_out:,.0f} start there."],
  [8 * 60 + 20, f"At 8:00, about {ratio8:,.0f} people enter the subway for every car trip that starts."],
  [int(bb * 10), f"The busiest 10 minutes: {hm(bb)}, with {per_bin[bb] / 10:,.0f} car trips starting every minute."],
  [12 * 60, f"Uber and Lyft carry {cars['hv'] / allc:.0%} of the day's {allc:,} car trips; yellow cabs {cars['yellow'] / allc:.0%}."],
  [14 * 60, f"{air_share:.0%} of all pickups and drop-offs are at JFK, LaGuardia or Newark."],
  [int(topz_peak * 60), f"{names[topz + 1]} is the day's busiest zone, peaking at {topz_peak:02d}:00."],
  [int(mat[:, ts].argmax() * 60), f"The busiest subway station: {st.name[ts]}, {sub_day[ts]:,} entries; most at {int(mat[:, ts].argmax()):02d}:00."],
  [17 * 60 + 30, f"Evening rush, 17–20: {e_out:,.0f} car trips leave Manhattan, {e_in:,.0f} arrive."],
  [22 * 60, f"Over the day the taxi heart travels {stats['heart_path_km']} km, without leaving the city's middle."],
]
stats["facts"] = sorted(facts, key=lambda x: x[0])
(W / "stats.json").write_text(json.dumps(stats, indent=1, ensure_ascii=False))
import shutil; shutil.copy(gp, W / gp.name)
for t_, s_ in stats["facts"]: print(f"{t_ // 60:02d}:{t_ % 60:02d}  {s_}")
