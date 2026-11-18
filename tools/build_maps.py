# Build maps.json for the JV GBA navigation bot from the SoulGold source tree.
import json, re, struct, base64, os, sys
SG = sys.argv[1]; OUT = sys.argv[2]
J = lambda p: json.load(open(os.path.join(SG, p)))
# behaviours enum
mb = {}; n = 0
for line in open(os.path.join(SG, 'include/constants/metatile_behaviors.h')):
    m = re.match(r'\s*(MB_\w+)\s*(?:=\s*(0x[0-9A-Fa-f]+|\d+))?\s*,', line)
    if m:
        if m.group(2): n = int(m.group(2), 0)
        mb[m.group(1)] = n; n += 1
inv = {v: k for k, v in mb.items()}
# tile classes (low nibble); elevation goes in the high nibble
WALK, WALL, WATER, JS, JN, JE, JW, DOOR, AS, AN, AE, AW, ICE, STEP = range(14)
def cls(b):
    name = inv.get(b, '')
    if name in ('MB_JUMP_SOUTH',): return JS
    if name in ('MB_JUMP_NORTH',): return JN
    if name in ('MB_JUMP_EAST',): return JE
    if name in ('MB_JUMP_WEST',): return JW
    if name.startswith('MB_JUMP_') or name.startswith('MB_IMPASSABLE') or name in ('MB_SECRET_BASE_WALL', 'MB_WATERFALL', 'MB_CRACKED_FLOOR_HOLE', 'MB_MT_PYRE_HOLE'): return WALL
    if name in ('MB_SOUTH_ARROW_WARP', 'MB_WATER_SOUTH_ARROW_WARP'): return AS
    if name == 'MB_NORTH_ARROW_WARP': return AN
    if name in ('MB_EAST_ARROW_WARP', 'MB_UP_RIGHT_STAIR_WARP', 'MB_DOWN_RIGHT_STAIR_WARP'): return AE
    if name in ('MB_WEST_ARROW_WARP', 'MB_UP_LEFT_STAIR_WARP', 'MB_DOWN_LEFT_STAIR_WARP'): return AW
    if 'DOOR' in name: return DOOR
    if name in ('MB_LADDER', 'MB_UP_ESCALATOR', 'MB_DOWN_ESCALATOR', 'MB_DEEP_SOUTH_WARP', 'MB_LAVARIDGE_GYM_B1F_WARP', 'MB_LAVARIDGE_GYM_1F_WARP', 'MB_AQUA_HIDEOUT_WARP', 'MB_MOSSDEEP_GYM_WARP', 'MB_BATTLE_PYRAMID_WARP'): return STEP
    if 'WATER' in name and name not in ('MB_SHALLOW_WATER',) or 'CURRENT' in name or name == 'MB_NO_SURFACING': return WATER
    if 'ICE' in name and 'THIN' not in name: return ICE
    return WALK
# tileset label -> attributes file
hdr = open(os.path.join(SG, 'src/data/tilesets/headers.h')).read()
mt = open(os.path.join(SG, 'src/data/tilesets/metatiles.h')).read()
ts2attr = dict(re.findall(r'const struct Tileset (\w+)\s*=\s*\{.*?\.metatileAttributes\s*=\s*(\w+)', hdr, re.S))
attr2file = dict(re.findall(r'const u16 (\w+)\[\]\s*=\s*INCBIN_U16\("([^"]+)"\)', mt))
cache = {}
def attrs(ts):
    if ts in cache: return cache[ts]
    a = ts2attr.get(ts); f = attr2file.get(a)
    if not f or not os.path.exists(os.path.join(SG, f)):
        cache[ts] = []; return []
    d = open(os.path.join(SG, f), 'rb').read()
    cache[ts] = [x & 0xFF for x in struct.unpack('<%dH' % (len(d) // 2), d)]
    return cache[ts]
layouts = {l['id']: l for l in J('data/layouts/layouts.json')['layouts'] if 'id' in l}
groups = J('data/maps/map_groups.json')
maps = []; idx = {}
for gi, gname in enumerate(groups['group_order']):
    for ni, mname in enumerate(groups[gname]):
        idx[mname] = len(maps); maps.append((gi, ni, mname))
byconst = {}
for i, (g, n, name) in enumerate(maps):
    try: byconst[J(f'data/maps/{name}/map.json')['id']] = i
    except Exception: pass
out = []; missing = set()
for i, (g, n, name) in enumerate(maps):
    try: m = J(f'data/maps/{name}/map.json')
    except Exception: out.append(None); continue
    lay = layouts.get(m['layout'])
    if not lay: out.append(None); continue
    w, h = lay['width'], lay['height']
    raw = open(os.path.join(SG, lay['blockdata_filepath']), 'rb').read()
    raw = (raw[:w * h * 2] + b'\xff\x0f' * (w * h))[:w * h * 2]
    grid = struct.unpack('<%dH' % (w * h), raw)
    pa, sa = attrs(lay['primary_tileset']), attrs(lay['secondary_tileset'])
    if not pa: missing.add(lay['primary_tileset'])
    tiles = bytearray(w * h)
    for k, v in enumerate(grid):
        mid, col, elev = v & 0x7FF, (v >> 11) & 1, v >> 12
        b = (pa[mid] if mid < 1024 and mid < len(pa) else (sa[mid - 1024] if 0 <= mid - 1024 < len(sa) else 0))
        c = cls(b)
        if c in (DOOR, AS, AN, AE, AW, STEP): c = WALK
        if col and c not in (JS, JN, JE, JW): c = WALL
        tiles[k] = (elev << 4) | c
    conns = []
    for c in (m.get('connections') or []):
        if c['direction'] in ('up', 'down', 'left', 'right') and c['map'] in byconst:
            conns.append([c['direction'][0], c['offset'], byconst[c['map']]])
    warps = []
    for wv in (m.get('warp_events') or []):
        x, y = wv['x'], wv['y']
        v = grid[y * w + x] if 0 <= x < w and 0 <= y < h else 0x0800
        mid, col = v & 0x7FF, (v >> 11) & 1
        b = (pa[mid] if mid < 1024 and mid < len(pa) else (sa[mid - 1024] if 0 <= mid - 1024 < len(sa) else 0))
        nm = inv.get(b, '')
        # how the warp fires: a<dir> = stand on it and press dir; d = walk into it (blocked tile);
        # s = step onto it; n = arrival point only
        if nm in ('MB_SOUTH_ARROW_WARP', 'MB_WATER_SOUTH_ARROW_WARP'): mode = 'aD'
        elif nm == 'MB_NORTH_ARROW_WARP': mode = 'aU'
        elif nm in ('MB_EAST_ARROW_WARP', 'MB_UP_RIGHT_STAIR_WARP', 'MB_DOWN_RIGHT_STAIR_WARP'): mode = 'aR'
        elif nm in ('MB_WEST_ARROW_WARP', 'MB_UP_LEFT_STAIR_WARP', 'MB_DOWN_LEFT_STAIR_WARP'): mode = 'aL'
        elif col: mode = 'd'
        elif 'DOOR' in nm or nm in ('MB_LADDER', 'MB_UP_ESCALATOR', 'MB_DOWN_ESCALATOR', 'MB_DEEP_SOUTH_WARP', 'MB_MT_PYRE_HOLE', 'MB_AQUA_HIDEOUT_WARP', 'MB_CAVE', 'MB_LAVARIDGE_GYM_B1F_WARP', 'MB_LAVARIDGE_GYM_1F_WARP', 'MB_MOSSDEEP_GYM_WARP', 'MB_BATTLE_PYRAMID_WARP', 'MB_UNUSED_C8'): mode = 's'
        else: mode = 'n'
        did = str(wv['dest_warp_id'])
        warps.append([x, y, byconst.get(wv['dest_map'], -1), int(did, 0) if re.fullmatch(r'\d+|0x[0-9a-fA-F]+', did) else 0, mode])
    objs = [[o['x'], o['y']] for o in (m.get('object_events') or []) if 'x' in o]
    out.append({'n': name, 'g': g, 'm': n, 'w': w, 'h': h, 't': base64.b64encode(bytes(tiles)).decode(),
                'c': conns, 'wp': warps, 'o': objs, 'ty': m.get('map_type', '')})
json.dump(out, open(OUT, 'w'), separators=(',', ':'))
print('maps', len(out), 'ok', sum(1 for x in out if x), 'missing tilesets', missing, 'size', os.path.getsize(OUT))
