# NYC Pulse — Where does New York's heart beat?

**#30DayMapChallenge 2026 · Day 10 · Prompting only** · live map: https://barisparlatangiller.github.io/30DMC26-D10-PromptingOnly-NYC-Pulse/

One Tuesday in New York, **16 June 2026**, replayed over 24 hours: every Yellow taxi, Green taxi and Uber/Lyft trip, and every
subway entry. Colour always means time of day (night indigo → dawn pink → day amber → evening magenta). 1.08 million 3D buildings
glow with the trips of their own taxi zone; moving lights follow sampled real trips along modelled street routes; beating hearts mark where trips are
densest (the whole city, each borough, the subway) and leave a trail through the day.

Made **only by prompting** an AI (Claude): every prompt is in [PROMPTS.md](PROMPTS.md).

## Data
| Layer | Source | Time |
|---|---|---|
| Car trips | NYC TLC Trip Record Data: Yellow, Green, High-Volume FHV (monthly Parquet, June 2026) | pickup / drop-off, local time |
| Taxi zones | NYC TLC Taxi Zone shapefile | context |
| Subway entries | MTA Subway Hourly Ridership (data.ny.gov 5wq4-mkjj) | hourly, local time |
| Buildings | NYC OpenData Building Footprints (5zhs-2jue), roof height | current footprints, context |
| Roads | OpenStreetMap via Geofabrik (ODbL) | current network, context |

## Method
- Pickups counted in the 10 minutes they start on 16 June, drop-offs in the 10 minutes they end. Removed: zones 264/265, trips < 1 min or > 4 h.
- **Hearts** = where trips are densest at that moment: Gaussian kernel density (σ = 1 km) of pickups + drop-offs at the taxi-zone
  centres, peak found as a soft maximum. City heart: all zones; borough hearts: Brooklyn, Queens, the Bronx; subway heart: station entries.
  A trip-weighted mean was tried first and fell into the East River (most trips start outside Manhattan), so the density peak is used.
- Moving lights = a reproducible 1-in-60 sample of real trips with real start time and duration. TLC records only start and end
  zones, so each follows the fastest route on the OpenStreetMap drive network between the zone centres (road-class speeds,
  `pipeline/e_routes.py`): a modelled route, not the real one.
- Every fact in the map is computed from the same data (`pipeline/c_web.py`).

## Limits
Taxi and ride-hail trips are not all traffic or all people. Building footprints are a current snapshot. The animation replays
measured data; it is not a forecast.

## Files
`pipeline/` a_taxi (DuckDB) · b_subway · c_web (layers, facts, GeoPackage) · d_buildings (tippecanoe) · video.mjs ·
`docs/data/nyc_pulse_2026-06-16.gpkg` for QGIS: taxi_zones_day, hourly_pulse, taxi/subway heart points, heart_trails, subway_stations.

Data © NYC Taxi & Limousine Commission, © MTA, NYC OpenData (DoITT) · basemap © CARTO, © OpenStreetMap contributors.
Barış Parlatangiller, built with Claude.
