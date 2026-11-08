"""
Street routes for the moving dots.

TLC trip records give only the start and end taxi zone, never the route. So each sampled trip is drawn along the fastest route on
today's OpenStreetMap drive network between its two zone centres (speeds by road class). It is a modelled route, not the real one.

  python pipeline/e_routes.py        (needs osmium-tool)
Output  docs/data/routes.json   {"o-d": [lon, lat, lon, lat, …]}  for every zone pair in the dot sample
"""
import json, os, subprocess
from pathlib import Path

import geopandas as gpd
import numpy as np
import osmium
import pandas as pd
import requests
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra
from scipy.spatial import cKDTree
from shapely.geometry import LineString

IN, B, W = Path("input"), Path("build"), Path("docs/data")
PBF = IN / "new-york-latest.osm.pbf"
BBOX = "-74.28,40.48,-73.68,40.93"
KMH = {"motorway": 75, "motorway_link": 45, "trunk": 60, "trunk_link": 40, "primary": 40, "primary_link": 30, "secondary": 35,
       "secondary_link": 28, "tertiary": 30, "tertiary_link": 25, "unclassified": 25, "residential": 22, "living_street": 10, "service": 12}

nyc = Path(os.environ.get("ROADS_FILE", B / "nyc_roads.osm.pbf"))
if not nyc.exists() and not PBF.exists():
    with requests.get("https://download.geofabrik.de/north-america/us/new-york-latest.osm.pbf", stream=True, timeout=(30, 1800)) as r:
        r.raise_for_status()
        with open(PBF.with_suffix(".part"), "wb") as o:
            for c in r.iter_content(1 << 22): o.write(c)
    PBF.with_suffix(".part").rename(PBF)
if not nyc.exists():
  subprocess.run(["osmium", "extract", "-b", BBOX, str(PBF), "-o", str(B / "nyc.osm.pbf"), "--overwrite"], check=True)
  subprocess.run(["osmium", "tags-filter", str(B / "nyc.osm.pbf"), "w/highway=" + ",".join(KMH), "-o", str(nyc), "--overwrite"], check=True)


class Roads(osmium.SimpleHandler):
    def __init__(self):
        super().__init__(); self.a, self.b, self.w, self.xy = [], [], [], {}

    def way(self, w):
        hw = w.tags.get("highway")
        if hw not in KMH or w.tags.get("area") == "yes" or w.tags.get("access") in ("private", "no"): return
        if hw == "service" and w.tags.get("service") in ("parking_aisle", "driveway", "drive-through"): return
        ow = w.tags.get("oneway", "yes" if hw in ("motorway", "motorway_link") or w.tags.get("junction") == "roundabout" else "no")
        try: pts = [(n.ref, n.lon, n.lat) for n in w.nodes]
        except osmium.InvalidLocationError: return
        v = KMH[hw] / 3.6
        for (i, x0, y0), (j, x1, y1) in zip(pts, pts[1:]):
            d = np.hypot((x1 - x0) * 84300, (y1 - y0) * 111200)
            self.xy[i] = (x0, y0); self.xy[j] = (x1, y1)
            if ow != "-1": self.a.append(i); self.b.append(j); self.w.append(d / v)
            if ow in ("no", "-1", "false", "0"): self.a.append(j); self.b.append(i); self.w.append(d / v)


h = Roads(); h.apply_file(str(nyc), locations=True, idx="flex_mem")
ids = np.fromiter(h.xy.keys(), dtype=np.int64); pos = {k: n for n, k in enumerate(ids)}
XY = np.array([h.xy[k] for k in ids])
e = pd.DataFrame({"a": [pos[k] for k in h.a], "b": [pos[k] for k in h.b], "w": h.w}).groupby(["a", "b"], as_index=False).w.min()
G = csr_matrix((e.w.values, (e.a.values, e.b.values)), shape=(len(ids), len(ids)))
print(f"road graph: {len(ids):,} nodes, {len(e):,} edges", flush=True)

# zone centres → nearest node of the largest connected part of the network (drop tiny islands of the graph)
from scipy.sparse.csgraph import connected_components
nc, lab = connected_components(G, directed=True, connection="strong")
main = np.flatnonzero(lab == np.bincount(lab).argmax())
z = json.loads((W / "zones.geojson").read_text())
cen = {f["properties"]["id"]: (f["properties"]["lon"], f["properties"]["lat"]) for f in z["features"]}
tree = cKDTree(XY[main] * [84.3, 111.2])
snap = {k: int(main[tree.query(np.array(v) * [84.3, 111.2])[1]]) for k, v in cen.items()}
dist_ok = {k: tree.query(np.array(v) * [84.3, 111.2])[0] < 1.5 for k, v in cen.items()}     # within 1.5 km of a road

s = pd.read_parquet(B / "sample.parquet")
pairs = s.groupby(["o", "d"]).size().reset_index()[["o", "d"]]
pairs = pairs[pairs.o.map(dist_ok) & pairs.d.map(dist_ok)]
print(f"zone pairs to route: {len(pairs):,}", flush=True)
routes, km = {}, []
origins = sorted(pairs.o.unique())
for c in range(0, len(origins), 16):
    chunk = origins[c:c + 16]
    _, pred = dijkstra(G, directed=True, indices=[snap[o] for o in chunk], return_predecessors=True)
    for r, o in enumerate(chunk):
        for d in pairs.d[pairs.o == o]:
            t = snap[d]; path = [t]
            while path[-1] != snap[o] and pred[r, path[-1]] >= 0: path.append(pred[r, path[-1]])
            if path[-1] != snap[o]: continue
            pts = [cen[o]] + [tuple(XY[i]) for i in reversed(path)] + [cen[d]]
            ln = LineString(pts).simplify(0.00012)
            routes[f"{o}-{d}"] = [round(v, 5) for p in ln.coords for v in p]
            km.append(LineString(pts).length * 95)
    print(f"  origins {min(c + 16, len(origins))}/{len(origins)} · routes {len(routes):,}", flush=True)
(W / "routes.json").write_text(json.dumps(routes, separators=(",", ":")))
print(f"routes: {len(routes):,} of {len(pairs):,} pairs · median {np.median(km):.1f} km · {(W / 'routes.json').stat().st_size / 1e6:.1f} MB")
