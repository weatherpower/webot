"""WeatherPower Level 2 radar: NEXRAD-resolution radar for every site, made on a PC and pushed to the cloud server.

For each radar site it finds the newest Level 2 volume on NOAA/Unidata's free real-time chunk feed, decodes it
with MetPy, and paints the lowest tilt of up to four products (reflectivity, velocity, correlation coefficient,
differential reflectivity) as a square palette PNG in Web Mercator, so the website drops it straight on the
map (site/radar.html). Sites render in parallel on all cores; changed files go to the server in one tar over ssh.

    python radar_l2.py --once --sites KSRX,KTLX     # one pass for a few sites (testing)
    python radar_l2.py --loop                       # every site, forever (run.cmd does this)

Needs: pip install metpy pillow. Uses the same ssh key and port as WeBot Studio.
"""
import argparse, io, json, math, os, subprocess, sys, tarfile, time, urllib.parse, urllib.request, xml.etree.ElementTree as ET
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import datetime, timezone
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
BUCKET = 'https://unidata-nexrad-level2-chunks.s3.amazonaws.com'   # NOAA/Unidata real-time Level 2 feed (free)
REMOTE = os.environ.get('WP_REMOTE', 'root@207.244.248.128')
REMOTE_PORT = os.environ.get('WP_SSH_PORT', '22022')
REMOTE_DIR = '/opt/weatherpower/data/radar-l2'
RANGE_M = 460_000.0
SIZE = int(os.environ.get('WP_L2_SIZE', '1400'))     # pixels per side (1400 ≈ 0.66 km/px; an i5 paints 200 sites in ~5 min)
CLEAR_AIR_EVERY = 15 * 60                              # clear-air sites (nothing much to see) repaint at most this often
KEEP = 6                                              # frames per site
WORKERS = max(2, min(8, os.cpu_count() or 4))   # each worker needs ~150 MB while painting
A = 6378137.0
CLEAR_AIR_VCPS = {31, 32, 35}                         # nothing to see in CC/ZDR; render ref + vel only
PRODUCTS = {'ref': b'REF', 'vel': b'VEL', 'cc': b'RHO', 'zdr': b'ZDR'}
MS_TO_KT = 1.943844
# Color ramps: (value, (r, g, b)) stops; below the first stop is transparent.
RAMPS = {
    'ref': [(5, (4, 233, 231)), (10, (1, 159, 244)), (15, (3, 0, 244)), (20, (2, 253, 2)), (25, (1, 197, 1)), (30, (0, 142, 0)), (35, (253, 248, 2)), (40, (229, 188, 0)), (45, (253, 149, 0)), (50, (253, 0, 0)), (55, (212, 0, 0)), (60, (188, 0, 0)), (65, (248, 0, 253)), (70, (152, 84, 198)), (75, (255, 255, 255))],
    'vel': [(-70, (16, 97, 16)), (-40, (0, 200, 0)), (-10, (150, 255, 150)), (0, (110, 110, 110)), (10, (255, 150, 150)), (40, (200, 0, 0)), (70, (100, 0, 0))],
    'cc': [(0.2, (0, 0, 0)), (0.5, (90, 90, 90)), (0.8, (0, 0, 200)), (0.9, (0, 200, 255)), (0.95, (0, 255, 0)), (0.98, (255, 255, 0)), (1.0, (255, 0, 0)), (1.05, (255, 255, 255))],
    'zdr': [(-2, (100, 100, 100)), (0, (0, 0, 160)), (1, (0, 200, 255)), (2, (0, 255, 0)), (3, (255, 255, 0)), (4, (255, 120, 0)), (6, (255, 0, 0)), (8, (255, 0, 255))],
}
# 63 palette colors per product (index 0 = transparent)
PALETTES = {}
for _name, _ramp in RAMPS.items():
    _xs = np.array([v for v, _ in _ramp], dtype=np.float32)
    _cols = np.array([c for _, c in _ramp], dtype=np.float32)
    _lv = np.linspace(_xs[0], _xs[-1], 63)
    _pal = [0, 0, 0] + [int(round(np.interp(l, _xs, _cols[:, ch]))) for l in _lv for ch in range(3)]
    PALETTES[_name] = (float(_xs[0]), float(_xs[-1]), _pal + [0] * (768 - len(_pal)))

def log(*a):
    line = datetime.now().strftime('%H:%M:%S') + ' ' + ' '.join(str(x) for x in a)
    print(line, flush=True)
    try:
        p = os.path.join(OUT, 'radar.log')
        if os.path.exists(p) and os.path.getsize(p) > 400_000:
            os.replace(p, p + '.old')
        with open(p, 'a', encoding='utf-8') as fh:
            fh.write(line + '\n')
    except OSError:
        pass

def s3_list(params):
    url = f"{BUCKET}/?list-type=2&" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=30) as r:
        root = ET.fromstring(r.read())
    ns = {'s': root.tag.split('}')[0].strip('{')}
    return ([k.text for k in root.findall('.//s:Key', ns)], [p.text for p in root.findall('.//s:CommonPrefixes/s:Prefix', ns)], root.findtext('s:NextContinuationToken', default='', namespaces=ns))

def all_sites():
    """Every radar site in the feed (the bucket's top-level folders)."""
    _, prefixes, _ = s3_list({'delimiter': '/', 'max-keys': '1000'})
    return sorted(p.strip('/') for p in prefixes if len(p.strip('/')) == 4)

def volume_chunks(site, vol):
    keys, _, _ = s3_list({'prefix': f"{site}/{vol}/", 'max-keys': '200'})
    return sorted(k.split('/')[2] for k in keys)

def newest_volume(site, hint):
    """(volume, chunk names). Volumes number 1..999 and wrap; the feed keeps a window of them, so the newest
    is the one whose successor is missing. With a hint we only look at that volume and the next."""
    if hint:
        best = None
        for v in (hint, str(int(hint) % 999 + 1)):
            names = volume_chunks(site, v)
            if names and (best is None or names[0] > best[1][0]):
                best = (v, names)
        if best:
            return best
    _, prefixes, _ = s3_list({'prefix': f"{site}/", 'delimiter': '/', 'max-keys': '1000'})
    vols = {int(p.split('/')[1]) for p in prefixes}
    if not vols:
        return None
    ends = [v for v in vols if (v % 999 + 1) not in vols] if len(vols) < 999 else list(vols)
    best = None
    for v in ends[:6]:
        names = volume_chunks(site, str(v))
        if names and (best is None or names[0] > best[1][0]):
            best = (str(v), names)
    return best

def download(site, vol, names):
    """The volume so far, as one file (chunks are cached; they never change)."""
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
    for old in os.listdir(os.path.join(OUT, '_cache', site)):
        if old != vol:
            d = os.path.join(OUT, '_cache', site, old)
            try:
                for fn in os.listdir(d):
                    os.remove(os.path.join(d, fn))
                os.rmdir(d)
            except OSError:
                pass   # another worker may be cleaning the same folder
    buf.seek(0)
    return buf

def stamp_of(name):
    d, t = name.split('-')[:2]
    return f"{d[:4]}-{d[4:6]}-{d[6:]}T{t[:2]}:{t[2:4]}:{t[4:]}Z"

def sweep_grid(sweep, prod):
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
    first, width = float(hdr0.first_gate), float(hdr0.gate_width)
    if width < 10:            # MetPy reports km; we work in meters
        first, width = first * 1000, width * 1000
    return az, data, first, width

def lowest_sweep(f, prod):
    # Volumes scan bottom-up: the first full sweep with the product is the lowest tilt that has it.
    for s in f.sweeps:
        if s and prod in s[0][4] and len(s) >= 300:
            return (s[0][0].el_angle, s)
    return None

def palette_image(vals, name):
    lo, hi, pal = PALETTES[name]
    idx = np.zeros(vals.shape, dtype=np.uint8)
    ok = np.isfinite(vals) & (vals >= lo)
    idx[ok] = 1 + np.rint((np.clip(vals[ok], lo, hi) - lo) / (hi - lo) * 62).astype(np.uint8)
    im = Image.fromarray(idx, 'P')
    im.putpalette(pal)
    return im

def render(f, lat0, lon0, size, products):
    k = 1 / math.cos(math.radians(lat0))
    H = RANGE_M * k
    X0 = math.radians(lon0) * A
    Y0 = math.log(math.tan(math.pi / 4 + math.radians(lat0) / 2)) * A
    px = (np.arange(size, dtype=np.float64) + 0.5) / size * 2 * H - H
    lon = np.degrees((X0 + px) / A)
    lat = np.degrees(2 * np.arctan(np.exp((Y0 - px) / A)) - math.pi / 2)
    la0, lo0 = math.radians(lat0), math.radians(lon0)
    # float32 everywhere and int32 indexes: a 2000x2000 picture is 16 MB per array, and workers run side by side.
    la = np.radians(lat).astype(np.float32)[:, None]
    dlo = (np.radians(lon) - lo0).astype(np.float32)[None, :]
    sla, cla = np.sin(la), np.cos(la)
    rng = (6371000.0 * 2 * np.arcsin(np.sqrt(np.sin((la - la0) / 2) ** 2 + math.cos(la0) * cla * np.sin(dlo / 2) ** 2))).astype(np.float32)
    az = ((np.degrees(np.arctan2(np.sin(dlo) * cla, math.cos(la0) * sla - math.sin(la0) * cla * np.cos(dlo))) + 360) % 360).astype(np.float32)
    del la, dlo, sla, cla
    bounds = [float(np.degrees((X0 - H) / A)), float(np.degrees(2 * math.atan(math.exp((Y0 - H) / A)) - math.pi / 2)),
              float(np.degrees((X0 + H) / A)), float(np.degrees(2 * math.atan(math.exp((Y0 + H) / A)) - math.pi / 2))]
    images, tilts = {}, {}
    for name in products:
        found = lowest_sweep(f, PRODUCTS[name])
        if not found:
            continue
        el, sweep = found
        g = sweep_grid(sweep, PRODUCTS[name])
        if not g:
            continue
        azs, data, first, width = g
        idx = (np.searchsorted(azs, az) % len(azs)).astype(np.int32)
        prev = ((idx - 1) % len(azs)).astype(np.int32)
        closer = np.abs((azs[idx] - az + 180) % 360 - 180) <= np.abs((azs[prev] - az + 180) % 360 - 180)
        ray = np.where(closer, idx, prev)
        del idx, prev, closer
        gate = np.floor((rng - first) / width).astype(np.int32)
        valid = (gate >= 0) & (gate < data.shape[1]) & (rng <= RANGE_M)
        vals = np.full(az.shape, np.nan, dtype=np.float32)
        vals[valid] = data[ray[valid], gate[valid]]
        del ray, gate, valid
        if name == 'vel':
            vals *= MS_TO_KT
        images[name] = palette_image(vals, name)
        tilts[name] = round(float(el), 1)
    return images, tilts, bounds

def site_latlon(f):
    for part in f.sweeps[0][0][1:4]:
        if hasattr(part, 'lat') and hasattr(part, 'lon'):
            return float(part.lat), float(part.lon)
    raise RuntimeError('No site position in the file')

def vcp_of(f):
    info = getattr(f, 'vcp_info', None)
    for attr in ('num', 'pattern_num', 'vcp'):
        v = getattr(info, attr, None)
        if isinstance(v, (int, np.integer)):
            return int(v)
    return None

def work(args):
    """One site, in a worker process: find the newest volume, paint it if its lowest tilts are in."""
    site, hint, seen, prev_vcp = args
    import warnings
    warnings.filterwarnings('ignore')
    from metpy.io import Level2File
    try:
        found = newest_volume(site, hint)
        if not found:
            return {'site': site, 'status': 'no volumes'}
        vol, names = found
        stamp = stamp_of(names[0])
        if stamp == seen:
            return {'site': site, 'vol': vol, 'status': 'same'}
        if prev_vcp in CLEAR_AIR_VCPS and seen and (datetime.now(timezone.utc) - datetime.fromisoformat(seen.replace('Z', '+00:00'))).total_seconds() < CLEAR_AIR_EVERY:
            return {'site': site, 'vol': vol, 'status': 'clear-air wait'}
        # Only the first chunks hold the lowest tilts we paint: fetch ~2 MB of a 5 MB volume, not all of it.
        f = None
        for limit in (12, 24, len(names)):
            f = Level2File(download(site, vol, names[:limit]))
            if lowest_sweep(f, b'REF') and lowest_sweep(f, b'VEL'):
                break
            if limit >= len(names):
                return {'site': site, 'vol': vol, 'status': 'not ready'}
        vcp = vcp_of(f)
        products = ['ref', 'vel'] if vcp in CLEAR_AIR_VCPS else list(PRODUCTS)
        lat0, lon0 = site_latlon(f)
        images, tilts, bounds = render(f, lat0, lon0, SIZE, products)
        sdir = os.path.join(OUT, site)
        os.makedirs(sdir, exist_ok=True)
        files = {}
        for name, im in images.items():
            fn = f"{site}_{stamp.replace(':', '').replace('-', '')}_{name}.png"
            im.save(os.path.join(sdir, fn), transparency=0, compress_level=6)
            files[name] = f"{site}/{fn}"
        return {'site': site, 'vol': vol, 'status': 'rendered', 'stamp': stamp, 'lat': lat0, 'lon': lon0, 'bounds': bounds, 'tilts': tilts, 'vcp': vcp, 'files': files}
    except Exception as e:
        return {'site': site, 'vol': hint, 'status': 'failed: ' + repr(e)[:160]}

def upload(new_files, index):
    """Changed PNGs + index.json in one tar over ssh; the server then drops frames the index no longer lists."""
    index['generatedAt'] = datetime.now(timezone.utc).isoformat()
    with open(os.path.join(OUT, 'index.json'), 'w') as fh:
        json.dump(index, fh)
    keep = sorted({os.path.basename(p) for s in index['sites'].values() for fr in s['frames'] for p in fr['files'].values()})
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode='w') as tar:
        for p in new_files:
            tar.add(os.path.join(OUT, p), arcname=p)
        tar.add(os.path.join(OUT, 'index.json'), arcname='index.json')
        k = ('\n'.join(keep) + '\n').encode()
        ti = tarfile.TarInfo('keep.txt'); ti.size = len(k)
        tar.addfile(ti, io.BytesIO(k))
    cmd = (f"mkdir -p {REMOTE_DIR} && cd {REMOTE_DIR} && tar -xf - && "
           "ls */*.png 2>/dev/null | xargs -r -n1 basename | sort > have.txt && sort keep.txt > k.txt && "
           "comm -23 have.txt k.txt | while read f; do rm -f */\"$f\"; done; rm -f have.txt k.txt keep.txt")
    r = subprocess.run(['ssh', '-p', REMOTE_PORT, '-o', 'BatchMode=yes', REMOTE, cmd], input=buf.getvalue(), capture_output=True, timeout=600)
    if r.returncode:
        raise RuntimeError(r.stderr.decode(errors='replace')[-200:])
    log('uploaded', len(new_files), 'files,', round(len(buf.getvalue()) / 1e6, 1), 'MB')

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--sites', default='all')
    ap.add_argument('--once', action='store_true')
    ap.add_argument('--loop', action='store_true')
    ap.add_argument('--every', type=int, default=30)
    ap.add_argument('--no-upload', action='store_true')
    ap.add_argument('--workers', type=int, default=WORKERS)
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    ipath, spath = os.path.join(OUT, 'index.json'), os.path.join(OUT, 'state.json')
    index = json.load(open(ipath)) if os.path.exists(ipath) else {'sites': {}}
    state = json.load(open(spath)) if os.path.exists(spath) else {'vols': {}, 'seen': {}}
    sites = all_sites() if args.sites == 'all' else [s.strip().upper() for s in args.sites.split(',') if s.strip()]
    log(len(sites), 'sites,', args.workers, 'workers, image', SIZE, 'px')
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        while True:
            t0 = time.time()
            new, counts = [], {}
            futures = [pool.submit(work, (s, state['vols'].get(s), state['seen'].get(s), index['sites'].get(s, {}).get('vcp'))) for s in sites]
            done_n = 0
            for fut in as_completed(futures):
                r = fut.result()
                done_n += 1
                if done_n % 50 == 0:
                    log(f'  {done_n}/{len(sites)} sites checked, {time.time() - t0:.0f}s')
                counts[r['status'].split(':')[0]] = counts.get(r['status'].split(':')[0], 0) + 1
                if r.get('vol'):
                    state['vols'][r['site']] = r['vol']
                if r['status'].startswith('failed'):
                    log(r['site'], r['status'])
                if r['status'] != 'rendered':
                    continue
                state['seen'][r['site']] = r['stamp']
                e = index['sites'].setdefault(r['site'], {'frames': []})
                e.update({'lat': r['lat'], 'lon': r['lon'], 'bounds': r['bounds'], 'tilts': r['tilts'], 'vcp': r['vcp']})
                e['frames'] = ([fr for fr in e['frames'] if fr['time'] != r['stamp']] + [{'time': r['stamp'], 'files': r['files']}])[-KEEP:]
                keep = {os.path.basename(p) for fr in e['frames'] for p in fr['files'].values()}
                sdir = os.path.join(OUT, r['site'])
                for fn in os.listdir(sdir):
                    if fn.endswith('.png') and fn not in keep:
                        os.remove(os.path.join(sdir, fn))
                new += list(r['files'].values())
            with open(spath, 'w') as fh:
                json.dump(state, fh)
            if new and not args.no_upload:
                try:
                    upload(new, index)
                except Exception as e:
                    log('upload failed:', repr(e)[:200])
            else:
                with open(ipath, 'w') as fh:
                    json.dump(index, fh)
            log(f"cycle {time.time() - t0:.0f}s:", counts)
            if not args.loop:
                break
            time.sleep(max(5, args.every - (time.time() - t0)))

if __name__ == '__main__':
    main()
