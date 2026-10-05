"""WeatherPower Level 2 radar: NEXRAD-resolution radar images, made on a PC and pushed to the cloud server.

For each radar site it finds the newest Level 2 volume on NOAA's public feed (noaa-nexrad-level2 on AWS,
free, no key), decodes it with MetPy, and paints the lowest tilt of four products (reflectivity, velocity,
correlation coefficient, differential reflectivity) as a square PNG in Web Mercator, so the website drops
it straight on the map (site/radar.html). Then it copies the PNGs and an index.json to the server over scp.

    python radar_l2.py --once --sites KSRX           # one pass, for testing
    python radar_l2.py --loop --sites KSRX,KSHV,KTLX  # keep going (run.cmd does this)

Needs: pip install metpy pillow. Uses the same ssh key and port as WeBot Studio.
"""
import argparse, io, json, math, os, re, subprocess, sys, time, urllib.request, xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
BUCKET = 'https://unidata-nexrad-level2-chunks.s3.amazonaws.com'   # NOAA/Unidata real-time Level 2 feed (free)
REMOTE = os.environ.get('WP_REMOTE', 'root@207.244.248.128')
REMOTE_PORT = os.environ.get('WP_SSH_PORT', '22022')
REMOTE_DIR = '/opt/weatherpower/data/radar-l2'
RANGE_M = 460_000.0           # how far out we paint (full Level 2 range)
SIZE = int(os.environ.get('WP_L2_SIZE', '2400'))   # image pixels per side (2400 ≈ 0.38 km/px)
KEEP = 6                      # frames per site kept for the loop
A = 6378137.0                 # Web Mercator radius

# Color tables: (value, (r, g, b)) stops, linear between. Below the first stop is transparent.
RAMPS = {
    'ref': [(5, (4, 233, 231)), (10, (1, 159, 244)), (15, (3, 0, 244)), (20, (2, 253, 2)), (25, (1, 197, 1)), (30, (0, 142, 0)), (35, (253, 248, 2)), (40, (229, 188, 0)), (45, (253, 149, 0)), (50, (253, 0, 0)), (55, (212, 0, 0)), (60, (188, 0, 0)), (65, (248, 0, 253)), (70, (152, 84, 198)), (75, (255, 255, 255))],
    'vel': [(-70, (16, 97, 16)), (-40, (0, 200, 0)), (-10, (150, 255, 150)), (0, (110, 110, 110)), (10, (255, 150, 150)), (40, (200, 0, 0)), (70, (100, 0, 0))],
    'cc': [(0.2, (0, 0, 0)), (0.5, (90, 90, 90)), (0.8, (0, 0, 200)), (0.9, (0, 200, 255)), (0.95, (0, 255, 0)), (0.98, (255, 255, 0)), (1.0, (255, 0, 0)), (1.05, (255, 255, 255))],
    'zdr': [(-2, (100, 100, 100)), (0, (0, 0, 160)), (1, (0, 200, 255)), (2, (0, 255, 0)), (3, (255, 255, 0)), (4, (255, 120, 0)), (6, (255, 0, 0)), (8, (255, 0, 255))],
}
PRODUCTS = {'ref': b'REF', 'vel': b'VEL', 'cc': b'RHO', 'zdr': b'ZDR'}
MS_TO_KT = 1.943844

def log(*a):
    print(datetime.now().strftime('%H:%M:%S'), *a, flush=True)

def list_keys(prefix):
    keys, token = [], ''
    while True:
        url = f"{BUCKET}/?list-type=2&prefix={prefix}&max-keys=1000" + (f"&continuation-token={urllib.parse.quote(token)}" if token else '')
        with urllib.request.urlopen(url, timeout=30) as r:
            root = ET.fromstring(r.read())
        ns = {'s': root.tag.split('}')[0].strip('{')}
        keys += [k.text for k in root.findall('.//s:Key', ns)]
        token = root.findtext('s:NextContinuationToken', default='', namespaces=ns)
        if not token:
            return keys

# The real-time feed is in chunks: <site>/<volume 1..999>/<YYYYMMDD-HHMMSS>-<nnn>-<S|I|E>. A volume's chunks
# concatenated in order are a normal Level 2 file, and the lowest tilts arrive first, so we can paint a volume
# about a minute after it starts instead of waiting five for it to finish.
VOLS = {}   # site -> current volume number (so we only list one or two prefixes a minute, not the whole site)
def newest_volume(site):
    if site not in VOLS:
        t = time.time()
        keys = list_keys(f"{site}/")
        if not keys:
            return None
        VOLS[site] = max(keys, key=lambda k: k.split('/')[2]).split('/')[1]
        log(site, 'scanned', len(keys), 'chunks in', round(time.time() - t, 1), 's; current volume', VOLS[site])
    best = None
    for v in (VOLS[site], str(int(VOLS[site]) % 999 + 1)):
        names = sorted(k.split('/')[2] for k in list_keys(f"{site}/{v}/"))
        if names and (best is None or names[0] > best[1][0]):
            best = (v, names)
    if best:
        VOLS[site] = best[0]
    return best

def download(site, vol, names):
    """The volume so far, as one file (chunks are cached: they never change)."""
    cdir = os.path.join(OUT, '_cache', site, vol)
    os.makedirs(cdir, exist_ok=True)
    buf = io.BytesIO()
    for n in names:
        p = os.path.join(cdir, n)
        if not os.path.exists(p):
            with urllib.request.urlopen(f"{BUCKET}/{site}/{vol}/{n}", timeout=60) as r, open(p, 'wb') as fh:
                fh.write(r.read())
        with open(p, 'rb') as fh:
            buf.write(fh.read())
    # old volumes' chunks are not needed any more
    for old in os.listdir(os.path.join(OUT, '_cache', site)):
        if old != vol:
            d = os.path.join(OUT, '_cache', site, old)
            for fn in os.listdir(d):
                os.remove(os.path.join(d, fn))
            os.rmdir(d)
    buf.seek(0)
    return buf

def stamp_of(name):
    d, t = name.split('-')[:2]
    return f"{d[:4]}-{d[4:6]}-{d[6:]}T{t[:2]}:{t[2:4]}:{t[4:]}Z"

def sweep_grid(sweep, prod):
    """One sweep's product as (azimuths sorted, 2-D data [ray, gate], first_gate_m, gate_width_m)."""
    rays = [r for r in sweep if prod in r[4]]
    if not rays:
        return None
    rays.sort(key=lambda r: r[0].az_angle)
    hdr0 = rays[0][4][prod][0]
    ng = max(r[4][prod][0].num_gates for r in rays)
    data = np.full((len(rays), ng), np.nan, dtype=np.float32)
    for i, r in enumerate(rays):
        d = np.ma.filled(np.asarray(r[4][prod][1], dtype=np.float32), np.nan)
        data[i, :d.size] = d
    az = np.array([r[0].az_angle for r in rays], dtype=np.float32)
    # MetPy reports gate spacing in km (0.25 for super-res); we work in meters.
    first, width = float(hdr0.first_gate), float(hdr0.gate_width)
    if width < 10:
        first, width = first * 1000, width * 1000
    return az, data, first, width

def lowest_sweep(f, prod):
    # Volumes scan bottom-up, so the first sweep with the product is the lowest tilt that has it
    # (the long-range surveillance cut for reflectivity, the Doppler cut for velocity).
    for s in f.sweeps:
        if s and prod in s[0][4] and len(s) >= 300:
            return (s[0][0].el_angle, s)
    return None

def colorize(vals, ramp):
    xs = np.array([v for v, _ in ramp], dtype=np.float32)
    cols = np.array([c for _, c in ramp], dtype=np.float32)
    rgba = np.zeros(vals.shape + (4,), dtype=np.uint8)
    ok = np.isfinite(vals) & (vals >= xs[0])
    v = np.clip(vals[ok], xs[0], xs[-1])
    for ch in range(3):
        rgba[..., ch][ok] = np.interp(v, xs, cols[:, ch]).astype(np.uint8)
    rgba[..., 3][ok] = 255
    return rgba

def render(f, lat0, lon0, size):
    """Inverse-map every output pixel (Web Mercator square around the site) to (azimuth, range) and sample."""
    k = 1 / math.cos(math.radians(lat0))
    H = RANGE_M * k
    X0 = math.radians(lon0) * A
    Y0 = math.log(math.tan(math.pi / 4 + math.radians(lat0) / 2)) * A
    px = (np.arange(size, dtype=np.float64) + 0.5) / size * 2 * H - H
    X = X0 + px[None, :]
    Y = Y0 - px[:, None]
    lon = np.degrees(X / A)
    lat = np.degrees(2 * np.arctan(np.exp(Y / A)) - math.pi / 2)
    la0, lo0 = math.radians(lat0), math.radians(lon0)
    la, lo = np.radians(lat), np.radians(lon)
    dlo = lo - lo0
    rng = 6371000.0 * 2 * np.arcsin(np.sqrt(np.sin((la - la0) / 2) ** 2 + math.cos(la0) * np.cos(la) * np.sin(dlo / 2) ** 2))
    az = (np.degrees(np.arctan2(np.sin(dlo) * np.cos(la), math.cos(la0) * np.sin(la) - math.sin(la0) * np.cos(la) * np.cos(dlo))) + 360) % 360
    bounds = [float(np.degrees((X0 - H) / A)), float(np.degrees(2 * math.atan(math.exp((Y0 - H) / A)) - math.pi / 2)),
              float(np.degrees((X0 + H) / A)), float(np.degrees(2 * math.atan(math.exp((Y0 + H) / A)) - math.pi / 2))]
    images, tilts = {}, {}
    for name, prod in PRODUCTS.items():
        found = lowest_sweep(f, prod)
        if not found:
            continue
        el, sweep = found
        g = sweep_grid(sweep, prod)
        if not g:
            continue
        azs, data, first, width = g
        # nearest ray by azimuth (with wrap-around), nearest gate by range
        idx = np.searchsorted(azs, az) % len(azs)
        prev = (idx - 1) % len(azs)
        d1 = np.abs((azs[idx] - az + 180) % 360 - 180)
        d2 = np.abs((azs[prev] - az + 180) % 360 - 180)
        ray = np.where(d1 <= d2, idx, prev)
        gate = np.floor((rng - first) / width).astype(np.int64)
        valid = (gate >= 0) & (gate < data.shape[1]) & (rng <= RANGE_M)
        vals = np.full(az.shape, np.nan, dtype=np.float32)
        vals[valid] = data[ray[valid], gate[valid]]
        if name == 'vel':
            vals = vals * MS_TO_KT
        images[name] = Image.fromarray(colorize(vals, RAMPS[name]), 'RGBA')
        tilts[name] = round(float(el), 1)
    return images, tilts, bounds

def site_latlon(f):
    ray = f.sweeps[0][0]
    for part in ray[1:4]:
        if hasattr(part, 'lat') and hasattr(part, 'lon'):
            return float(part.lat), float(part.lon)
    raise RuntimeError('No site position in the file')

def process(site, vol, names, index):
    from metpy.io import Level2File
    t0 = time.time()
    f = Level2File(download(site, vol, names))
    if not (lowest_sweep(f, b'REF') and lowest_sweep(f, b'VEL')):
        return None   # the lowest tilts haven't all arrived yet; try again next minute
    lat0, lon0 = site_latlon(f)
    stamp = stamp_of(names[0])
    images, tilts, bounds = render(f, lat0, lon0, SIZE)
    sdir = os.path.join(OUT, site)
    os.makedirs(sdir, exist_ok=True)
    files = {}
    for name, im in images.items():
        fn = f"{site}_{stamp.replace(':', '').replace('-', '')}_{name}.png"
        im.save(os.path.join(sdir, fn), optimize=True)
        files[name] = f"{site}/{fn}"
    entry = index['sites'].setdefault(site, {'lat': lat0, 'lon': lon0, 'bounds': bounds, 'frames': []})
    entry.update({'lat': lat0, 'lon': lon0, 'bounds': bounds, 'tilts': tilts})
    entry['frames'] = [fr for fr in entry['frames'] if fr['time'] != stamp] + [{'time': stamp, 'files': files}]
    entry['frames'] = entry['frames'][-KEEP:]
    keep = {os.path.basename(p) for fr in entry['frames'] for p in fr['files'].values()}
    for fn in os.listdir(sdir):
        if fn.endswith('.png') and fn not in keep:
            os.remove(os.path.join(sdir, fn))
    log(f"{site} {stamp} rendered {list(files)} tilts {tilts} in {time.time() - t0:.1f}s")
    return list(files.values())

def upload(new_files, index):
    if not new_files:
        return
    index['generatedAt'] = datetime.now(timezone.utc).isoformat()
    with open(os.path.join(OUT, 'index.json'), 'w') as fh:
        json.dump(index, fh)
    sites = sorted({p.split('/')[0] for p in new_files})
    ssh = ['ssh', '-p', REMOTE_PORT, '-o', 'BatchMode=yes', REMOTE]
    subprocess.run(ssh + [' '.join(f"mkdir -p {REMOTE_DIR}/{s};" for s in sites)], check=False, timeout=60)
    for s in sites:
        paths = [os.path.join(OUT, p) for p in new_files if p.startswith(s + '/')]
        subprocess.run(['scp', '-P', REMOTE_PORT, '-o', 'BatchMode=yes', '-q', *paths, f"{REMOTE}:{REMOTE_DIR}/{s}/"], check=False, timeout=300)
    subprocess.run(['scp', '-P', REMOTE_PORT, '-o', 'BatchMode=yes', '-q', os.path.join(OUT, 'index.json'), f"{REMOTE}:{REMOTE_DIR}/index.json"], check=False, timeout=60)
    # keep the server tidy: only the frames the index knows about
    keep = ' '.join(sorted({os.path.basename(p) for s in index['sites'].values() for fr in s['frames'] for p in fr['files'].values()}))
    subprocess.run(ssh + [f"cd {REMOTE_DIR} && for f in */*.png; do case \" {keep} \" in *\" $(basename $f) \"*) ;; *) rm -f \"$f\";; esac; done"], check=False, timeout=60)
    log('uploaded', len(new_files), 'files')

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--sites', default='KSRX,KSHV,KTLX,KFWS,KLZK')
    ap.add_argument('--once', action='store_true')
    ap.add_argument('--loop', action='store_true')
    ap.add_argument('--every', type=int, default=60)
    ap.add_argument('--no-upload', action='store_true')
    args = ap.parse_args()
    sites = [s.strip().upper() for s in args.sites.split(',') if s.strip()]
    os.makedirs(OUT, exist_ok=True)
    ipath = os.path.join(OUT, 'index.json')
    index = json.load(open(ipath)) if os.path.exists(ipath) else {'sites': {}}
    seen = {s: (index['sites'].get(s, {}).get('frames') or [{}])[-1].get('time') for s in sites}
    while True:
        new = []
        for site in sites:
            try:
                found = newest_volume(site)
                if not found:
                    log(site, 'no volumes found'); continue
                vol, names = found
                stamp = stamp_of(names[0])
                if seen.get(site) == stamp:
                    continue
                made = process(site, vol, names, index)
                if made is None:
                    continue
                new += made
                seen[site] = stamp
            except Exception as e:
                log(site, 'failed:', repr(e)[:200])
        if new and not args.no_upload:
            try:
                upload(new, index)
            except Exception as e:
                log('upload failed:', repr(e)[:200])
        elif new:
            with open(ipath, 'w') as fh:
                json.dump(index, fh)
        if not args.loop:
            break
        time.sleep(args.every)

if __name__ == '__main__':
    main()
