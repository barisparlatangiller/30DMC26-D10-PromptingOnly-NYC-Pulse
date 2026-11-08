"""
Subway entries on the same day: MTA Subway Hourly Ridership (data.ny.gov 5wq4-mkjj), 16 June 2026, all payment and fare
classes summed per station complex and hour. Timestamps are local New York time.

  python pipeline/b_subway.py
Output  build/subway.parquet (station complex, lat, lon, hour, entries)
"""
from pathlib import Path

import pandas as pd
import requests

B = Path("build"); B.mkdir(exist_ok=True)
URL = "https://data.ny.gov/resource/5wq4-mkjj.json"
q = {"$select": "station_complex_id, station_complex, borough, latitude, longitude, date_extract_hh(transit_timestamp) AS h, sum(ridership) AS r",
     "$where": "transit_timestamp >= '2026-06-16T00:00:00' AND transit_timestamp < '2026-06-17T00:00:00' AND transit_mode = 'subway'",
     "$group": "station_complex_id, station_complex, borough, latitude, longitude, h", "$limit": 50000}
r = requests.get(URL, params=q, timeout=300, headers={"User-Agent": "30DMC26-NYC-Pulse"}); r.raise_for_status()
s = pd.DataFrame(r.json())
for c in ("latitude", "longitude", "r"): s[c] = s[c].astype(float)
s["h"] = s.h.astype(int)
s = s.groupby(["station_complex_id", "station_complex", "borough", "h"], as_index=False).agg(lat=("latitude", "mean"), lon=("longitude", "mean"), r=("r", "sum"))
s.to_parquet(B / "subway.parquet")
print(f"subway: {s.station_complex_id.nunique()} station complexes · {s.r.sum():,.0f} entries on 2026-06-16")
print(s.groupby("h").r.sum().round().astype(int).to_dict())
print(s.groupby("station_complex").r.sum().sort_values().tail(5).round().astype(int).to_dict())
