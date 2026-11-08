# PROMPTS — NYC Pulse (Day 10, Prompting only)

The theme asks for a map made only by prompting. These are the human prompts, verbatim (Turkish, as written), followed by
what the AI did with each. No code or design was written by hand.

## 1 · The brief (from the project table)
> 10 · 10.11.2026 · Salı · Prompting only · New York City · NYC PULSE — Where Does New York's Heart Beat?
> New York'un seçilen bir gününde 24 saat boyunca taksi hareketliliği hangi bölgelerde yoğunlaşıyor? Saatlik yolculuk
> yoğunluğu, en aktif bölgeler ve hareketliliğin ağırlıklı merkezi nasıl değişiyor? Şehrin kalbi gün boyunca nerelere kayıyor?
> … New York tam ekran gece haritası; 00:00–23:00 zaman kaydırıcısı ve otomatik 24 saat oynatma; saatlik pickup/dropoff
> katmanları; hareketliliğe göre parlayan taksi bölgeleri; en yoğun bölgelerde animasyonlu nabız halkaları; saatlik ağırlıklı
> kalp noktası; kalbin 24 saatlik hareket izi; çok merkezli yoğunluk görünümü; bölgeye tıkla → saatlik yolculuk sayıları, gün
> içi eğri, zirve saat; sabah/akşam karşılaştırması; saat bazında renk ve ışık değişimleri; sinematik kamera geçişleri …

> icindeki klasorlerdeki tum dosylari incele ve tablodan aldigim fikre gore day10 icin devam edelim. bu sefer color coding cok
> onemli ve 1 günü kapsamai cok onemli. interaktif bir harita olabilri simulasyon olacak ve en sonunda da video yapmalisin en
> iyi acidan … hepsindenönce neye ihtiyacin var ve sen projenin yönetiicisin ne yapardin hepsini o sekilde yapmalisin, görtsel
> acidan cok one cikmasini istedigim bir proje gunu bu, kurallarada uymalisin

**AI:** read the data pack (README, downloader), checked that June 2026 TLC files and same-day MTA data are published, chose
Tuesday 16 June 2026 (from the pack), proposed the plan and asked three questions.

## 2 · Decisions (answers to the AI's questions)
> Yellow+Green+Uber/Lyft · Saatin rengi (gece indigo → şafak pembe → öğle amber → akşam magenta) · Metro: evet, karşılaştırma katmanı

## 3 · Additions
> tüm izinleri verdim. sorunsuz calisacak seilde projeyi tamamlamani istiyorum. yeni fikirlerin olursa ekle ve ayrica
> interesting factlerde olabilir belki ve ayrica new york haritasi uzerinde yapiyorsun degil mi 3 boyutlu olmasini isitoyurm
> binalarda beki kalp atislarindan renklenebilirler. ve bir kac tane landmarki da gösterebilirisn …

> ve tabi ki her sey smooth olamli gorösel grafik dilinde bunu unutma

**AI:** added 1.08 million 3D building footprints joined to taxi zones so each building glows with its zone's trips; landmarks
with light lines; a beating heart whose rate follows trips per minute; data-driven "did you know" facts that appear at the
right time of day; smooth 10-minute interpolation, temporal smoothing and a spline camera.

## 4 · Review
> video bittiktiken sonra taxi heart subway heart anlamadim ne oldugun ve sanki sacma sekilde deniz yuzeinde falan, acaba
> koordinatlari uygun mi birbirilerine tai heart mesela manhattanda daha cok olmasi gerekmez mi willimsburg gibi duruyor burda
> teknik hatalar olabilir mi ? . bunu proje bittikten sorna tekrarn kontrol et, dogru oldugunu dusunuyorsa birak ama degilse
> guncellemeleri yapmani istiyorum. simdi sen kendi basian birakiyorum, buna göre hatalar olursa kendin duzeltmelisin benim icin
> proje bitmis olmali en osn halinde

**AI:** checked the coordinates (correct) and found the real cause: the heart was a trip-weighted *mean*. With 55–70 % of trips
outside Manhattan, the mean fell between Manhattan and Queens, on the East River; floating 620 m up added parallax. Replaced it with
the *density peak* (where trips are densest), added borough hearts for Brooklyn, Queens and the Bronx, lowered the hearts to street
level with a ground halo, and explained them in the legend.

## 5 · Routes
> acaba moving tripleri,in hepsini gidilen rotaya gore en kisa yollari kullanarak gidilmesini hesaplasak böyle ucuyor gibi olmasi
> tuhaf degil mi sence ? yada moving trips nedir mesela, analizlerin hepsi ayni kalsa sadece yollari takip ederek gitse mantikli
> olur mu ve cok uzun surer mi ?

**AI:** agreed: the arcs looked like flights. Added `pipeline/e_routes.py`: the OpenStreetMap drive network of New York, fastest
routes (road-class speeds) between the zone centres of every sampled trip. All analyses stay the same; only the drawing changes,
and the map says it is a modelled route.

## 6 · Simplify
> green taxiler nedir onu da anlayamadim bazi noktalarda tuhaflasiyor gibi hisediyorum anlamsizlasiyor, tüm cizgilerin hepsini en
> kisa yollar uzerinden yapsak nasil olur mesela digleri gibi ve butuncul bakildiiginda daha one cikabilir mesela

**AI:** merged the yellow and green toggles into "Taxis" (green Boro Taxis are 0.2 % of the day's trips); every moving light now
follows a street route, and the sample was doubled (1 light ≈ 30 trips) so the main arteries read as streams of light.

## 7 · What the AI built (summary)
- `pipeline/a_taxi.py`: DuckDB over three monthly Parquet files → 10-minute pickups/drop-offs per zone, a 1-in-60 trip sample.
- `pipeline/b_subway.py`: MTA hourly entries per station complex (SoQL aggregation).
- `pipeline/c_web.py`: web layers, hearts, facts, QGIS GeoPackage.
- `pipeline/d_buildings.py`: building footprints → zone join → vector tiles (PMTiles).
- `docs/`: MapLibre GL + deck.gl simulation. `pipeline/video.mjs`: the LinkedIn video, rendered frame by frame in GitHub Actions.
