"""
One day of New York taxi and ride-hail trips: Tuesday 16 June 2026, New York local time (TLC timestamps are local).

Sources (NYC TLC Trip Record Data, monthly Parquet):
  yellow  Yellow Taxi            tpep_pickup_datetime / tpep_dropoff_datetime
  green   Green (Boro) Taxi      lpep_pickup_datetime / lpep_dropoff_datetime
  hv      High-Volume FHV        pickup_datetime / dropoff_datetime   (Uber, Lyft)

Cleaning: zone IDs 1–263 only (264/265 = unknown / outside NYC), trip time 1 min – 4 h.
Pickups are counted when the pickup is on 16 June, drop-offs when the drop-off is on 16 June.

  python pipeline/a_taxi.py
Output  build/bins.parquet (mode, kind, bin = 10 minutes, zone, n) · build/sample.parquet (moving dots) · build/qa.json
"""
import json
from pathlib import Path

import duckdb
import requests

IN, B = Path("input"), Path("build")
IN.mkdir(exist_ok=True); B.mkdir(exist_ok=True)
DAY, NEXT = "2026-06-16", "2026-06-17"
BASE = "https://d37ci6vzurychx.cloudfront.net/trip-data/"
SRC = {"yellow": ("yellow_tripdata_2026-06.parquet", "tpep_pickup_datetime", "tpep_dropoff_datetime"),
       "green": ("green_tripdata_2026-06.parquet", "lpep_pickup_datetime", "lpep_dropoff_datetime"),
       "hv": ("fhvhv_tripdata_2026-06.parquet", "pickup_datetime", "dropoff_datetime")}
PER_DOT = 30                                    # one moving light = about 30 real trips


def get(name):
    f = IN / name
    if not f.exists() or f.stat().st_size < 1000:
        with requests.get(BASE + name, stream=True, timeout=(30, 1800), headers={"User-Agent": "30DMC26-NYC-Pulse"}) as r:
            r.raise_for_status()
            with open(f.with_suffix(".part"), "wb") as o:
                for c in r.iter_content(1 << 22): o.write(c)
        f.with_suffix(".part").rename(f)
    print(f"{name}: {f.stat().st_size / 1e6:,.0f} MB", flush=True)
    return f


con = duckdb.connect()
con.execute("SET memory_limit='5GB'; SET threads=4")
parts = []
for mode, (name, pu, do) in SRC.items():
    f = get(name)
    parts.append(f"""SELECT '{mode}' AS mode, CAST({pu} AS TIMESTAMP) AS pu, CAST({do} AS TIMESTAMP) AS dt,
        CAST(PULocationID AS INT) AS o, CAST(DOLocationID AS INT) AS d FROM read_parquet('{f}')
        WHERE {pu} >= TIMESTAMP '2026-06-15 18:00' AND {pu} < TIMESTAMP '{NEXT} 00:00'""")
con.execute("CREATE TABLE raw AS " + " UNION ALL ".join(parts))
con.execute(f"""CREATE TABLE t AS SELECT *, date_diff('second', pu, dt) / 60.0 AS dur FROM raw
    WHERE o BETWEEN 1 AND 263 AND d BETWEEN 1 AND 263 AND dt >= pu + INTERVAL 1 MINUTE AND dt <= pu + INTERVAL 4 HOUR""")

qa = {"day": DAY, "timezone": "America/New_York", "per_dot": PER_DOT, "modes": {}}
for mode in SRC:
    a = con.execute(f"SELECT count(*) FROM raw WHERE mode='{mode}' AND pu >= TIMESTAMP '{DAY}' AND pu < TIMESTAMP '{NEXT}'").fetchone()[0]
    k = con.execute(f"SELECT count(*), median(dur) FROM t WHERE mode='{mode}' AND pu >= TIMESTAMP '{DAY}' AND pu < TIMESTAMP '{NEXT}'").fetchone()
    qa["modes"][mode] = {"pickups_raw": a, "pickups_clean": k[0], "dropped": a - k[0], "median_trip_min": round(k[1], 1)}
    print(f"{mode}: {a:,} pickups on {DAY} · {k[0]:,} after cleaning · median trip {k[1]:.1f} min", flush=True)

con.execute(f"""COPY (
    SELECT mode, 'pu' AS kind, CAST(floor(date_diff('minute', TIMESTAMP '{DAY}', pu) / 10) AS INT) AS bin, o AS zone, count(*) AS n
      FROM t WHERE pu >= TIMESTAMP '{DAY}' AND pu < TIMESTAMP '{NEXT}' GROUP BY ALL
    UNION ALL
    SELECT mode, 'do', CAST(floor(date_diff('minute', TIMESTAMP '{DAY}', dt) / 10) AS INT), d, count(*)
      FROM t WHERE dt >= TIMESTAMP '{DAY}' AND dt < TIMESTAMP '{NEXT}' GROUP BY ALL
  ) TO '{B}/bins.parquet' (FORMAT PARQUET)""")
# moving dots: a reproducible random sample of real trips that start on the day (o ≠ d), drawn with their real start and duration
con.execute(f"""COPY (
    SELECT mode, o, d, round(date_diff('second', TIMESTAMP '{DAY}', pu) / 60.0, 2) AS t0, round(dur, 1) AS dur
      FROM t WHERE pu >= TIMESTAMP '{DAY}' AND pu < TIMESTAMP '{NEXT}' AND o <> d AND hash(o, d, pu, dt, mode) % {PER_DOT} = 0
  ) TO '{B}/sample.parquet' (FORMAT PARQUET)""")
n = con.execute(f"SELECT count(*) FROM read_parquet('{B}/sample.parquet')").fetchone()[0]
hourly = con.execute(f"""SELECT hour(pu) h, count(*) FROM t WHERE pu >= TIMESTAMP '{DAY}' AND pu < TIMESTAMP '{NEXT}' GROUP BY 1 ORDER BY 1""").fetchall()
qa["hourly_pickups"] = [int(x[1]) for x in hourly]
qa["dots"] = n
(B / "qa.json").write_text(json.dumps(qa, indent=1))
print(json.dumps(qa, indent=1))
