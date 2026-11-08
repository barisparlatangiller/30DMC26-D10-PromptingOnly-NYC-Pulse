"""
3D buildings that glow with the pulse of their taxi zone.

NYC Building Footprints (NYC OpenData 5zhs-2jue, DoITT): 1.08 million footprints with roof height. Each building gets the
taxi zone its centre lies in, so the map can colour it by that zone's trips at every moment of the day.

  python pipeline/d_buildings.py      (needs tippecanoe)
Output  docs/data/buildings.pmtiles  (layer b: h = roof height in m, z = taxi zone, lm = landmark name or empty)
"""
import subprocess
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import requests
import shapely

IN, B, W = Path("input"), Path("build"), Path("docs/data")
URL = "https://data.cityofnewyork.us/api/views/5zhs-2jue/rows.csv?accessType=DOWNLOAD"
LANDMARKS = {"1015862": "Empire State Building", "1088469": "One World Trade Center", "1036156": "Chrysler Building",
             "1076262": "30 Rockefeller Plaza", "1087167": "Woolworth Building", "1087186": "New York Times Building"}

f = IN / "buildings.csv"
if not f.exists() or f.stat().st_size < 1000:
    with requests.get(URL, stream=True, timeout=(30, 3600), headers={"User-Agent": "30DMC26-NYC-Pulse"}) as r:
        r.raise_for_status()
        with open(f.with_suffix(".part"), "wb") as o:
            for c in r.iter_content(1 << 22): o.write(c)
    f.with_suffix(".part").rename(f)
print(f"buildings.csv: {f.stat().st_size / 1e6:,.0f} MB", flush=True)

t = pd.read_csv(f, dtype=str)
t.columns = [c.lower() for c in t.columns]
gcol = next(c for c in t.columns if "geom" in c)
hcol = next(c for c in t.columns if "height" in c and "roof" in c)
print("columns:", list(t.columns), flush=True)
t = t[t[gcol].notna()]
geom = shapely.from_wkt(t[gcol].values)
g = gpd.GeoDataFrame({"bin": t["bin"].values, "h": pd.to_numeric(t[hcol], errors="coerce").fillna(0).values * 0.3048},
                     geometry=geom, crs=4326)
g = g[(g.h > 2) & g.geometry.notna() & ~g.geometry.is_empty]
print(f"{len(g):,} buildings with height", flush=True)

z = gpd.read_file(next((IN / "taxi_zones").rglob("*.shp"))).to_crs(4326)[["LocationID", "geometry"]]
z["LocationID"] = z.LocationID.astype(int)
pt = gpd.GeoDataFrame(geometry=g.representative_point(), crs=4326)
j = gpd.sjoin(pt, z, how="left", predicate="within")
j = j[~j.index.duplicated()]
g["z"] = j.LocationID.reindex(g.index).fillna(0).astype(int).values
g["lm"] = g["bin"].map(LANDMARKS).fillna("")
g["h"] = g.h.round(1)
print(f"in a taxi zone: {(g.z > 0).mean():.1%} · landmarks found: {sorted(set(g.lm) - {''})}", flush=True)

out = B / "buildings.geojsonl"
g[["h", "z", "lm", "geometry"]].to_file(out, driver="GeoJSONSeq", COORDINATE_PRECISION=6)
W.mkdir(parents=True, exist_ok=True)
subprocess.run(["tippecanoe", "-o", str(W / "buildings.pmtiles"), "--force", "-l", "b", "-Z11", "-z15", "-P", "-q",
                "--drop-smallest-as-needed", "--simplification=2", "--maximum-tile-bytes=1500000",
                "-y", "h", "-y", "z", "-y", "lm", str(out)], check=True)
print(f"buildings.pmtiles: {(W / 'buildings.pmtiles').stat().st_size / 1e6:.1f} MB")
