'use strict';
// Sky, distant hills, and the city: a grid of blocks along a central avenue running to the vanishing point.

function cloudStrokes(cx, cy, w, h){
  var bumps = Math.max(3, Math.floor(w / 38)), ctrl = [[cx - w / 2, cy + h * 0.32]], i;
  for(i = 0; i < bumps; i++) ctrl.push([cx - w / 2 + (i + 0.5) * (w / bumps), cy - h * 0.5 * (0.55 + 0.45 * Math.sin(i * 1.8 + cx))]);
  ctrl.push([cx + w / 2, cy + h * 0.3]);
  var out = [ink(ctrl, { color: COLOR.ink2, width: 1.1, jitter: 1, samples: 6, alpha: 0.5 }),
    ink([[cx - w / 2, cy + h * 0.34], [cx, cy + h * 0.38], [cx + w / 2, cy + h * 0.3]], { color: COLOR.ink2, width: 0.9, jitter: 1.1, samples: 4, alpha: 0.35 })];
  for(i = 0; i < 4; i++){
    var yy = cy + h * (0.44 + i * 0.12), inset = w * (0.12 + i * 0.1);
    out.push(ink([[cx - w / 2 + inset, yy], [cx + w / 2 - inset * 0.8, yy + rand(-1, 1)]], { color: COLOR.ink2, width: 0.7, jitter: 0.8, curve: false, alpha: 0.2 }));
  }
  return out;
}

function buildSky(S){
  S.begin(false);
  for(var i = 0; i < 28; i++){
    var y = rand(18, 250), x = rand(-60, 1150), len = rand(70, 280);
    S.add(ink([[x, y], [x + len * 0.5, y + rand(-4, 4)], [x + len, y + rand(-2, 2)]], { color: COLOR.ink2, width: 0.7, alpha: rand(0.1, 0.24), jitter: 0.8, samples: 6 }));
  }
  [[170, 70, 150, 40], [470, 48, 120, 32], [820, 88, 170, 44], [1060, 150, 100, 30], [330, 150, 90, 26], [690, 180, 80, 22]].forEach(function(c){ S.add(cloudStrokes(c[0], c[1], c[2], c[3])); });
  [[700, 110, 8], [735, 128, 6], [585, 92, 5]].forEach(function(b){
    var x = b[0], y = b[1], s = b[2];
    S.add(ink([[x - s, y], [x - s * 0.4, y - s * 0.6], [x, y], [x + s * 0.4, y - s * 0.6], [x + s, y]], { color: COLOR.ink1, width: 1.1, jitter: 0.3, samples: 3, alpha: 0.65 }));
  });
}

// Rolling hills on the horizon (a nod to the reference), far layer first.
function buildHills(S){
  [{ amp: 42, alpha: 0.32, f1: 0.0042, f2: 0.011 }, { amp: 26, alpha: 0.48, f1: 0.0061, f2: 0.017 }].forEach(function(L){
    var s1 = rand(0, 9), s2 = rand(0, 9), curve = [], x;
    for(x = -20; x <= W + 20; x += 12){
      var h = L.amp * (0.5 + 0.5 * Math.sin(x * L.f1 + s1)) * (0.65 + 0.35 * Math.sin(x * L.f2 + s2)) + 3;
      curve.push([x, HORIZON_Y - h]);
    }
    S.begin(false);
    S.mask(curve.concat([[W + 20, HORIZON_Y + 1], [-20, HORIZON_Y + 1]]));
    S.add(ink(curve, { color: COLOR.ink2, width: 1, jitter: 0.8, curve: false, alpha: L.alpha }));
    for(var i = 1; i < curve.length; i++){
      if(Math.random() < 0.25) continue;
      var p = curve[i], len = Math.min(HORIZON_Y - p[1] - 1, rand(3, 14));
      if(len > 1) S.add(ink([[p[0] + rand(-4, 4), p[1] + 2], [p[0] + rand(-2, 5), p[1] + 2 + len]], { color: COLOR.ink2, width: 0.6, jitter: 0.3, curve: false, alpha: L.alpha * 0.7 }));
    }
  });
}

function cityRows(){
  var rows = [], z = 190;
  while(z < 5600){
    var depth = Math.max(45, z * 0.28);
    rows.push([z, z + depth]);
    z += depth + Math.max(16, z * 0.07);
  }
  return rows;
}

function heightFor(ri){
  if(ri <= 1) return rand(14, 34);
  if(ri <= 4) return Math.random() < 0.15 ? rand(90, 150) : rand(20, 70);
  if(ri <= 8) return Math.random() < 0.2 ? rand(110, 200) : rand(30, 90);
  return Math.random() < 0.18 ? rand(120, 220) : rand(40, 110);
}

function makeBuilding(x0, x1, z0, z1, ri){
  var h = heightFor(ri), w = Math.min(x1 - x0, z1 - z0), tiers = [{ h: h }];
  if(h > 45 && Math.random() < 0.55){
    var n = randInt(2, 4);
    tiers = [];
    for(var i = 0; i < n; i++) tiers.push({ h: h * (0.45 + 0.55 * (i + 1) / n), inset: i === 0 ? 0 : w * rand(0.08, 0.14) });
  }
  var hanging = ri <= 6 && Math.random() < 0.32;
  return { x0: x0, x1: x1, z0: z0, z1: z1, tiers: tiers, spire: h > 100 && Math.random() < 0.45 ? h * rand(0.18, 0.3) : 0,
    garden: hanging || (ri <= 6 && Math.random() < 0.55), hanging: hanging, awnings: Math.random() < 0.7, maxH: h };
}

function nearKey(x0, x1, z0){ return Math.hypot(x0 <= 0 && x1 >= 0 ? 0 : Math.min(Math.abs(x0), Math.abs(x1)), z0); }
function onScreen(x0, x1, z0, z1){
  var xs = [VP_X + FOCAL * x0 / z0, VP_X + FOCAL * x1 / z0, VP_X + FOCAL * x0 / z1, VP_X + FOCAL * x1 / z1];
  return Math.max.apply(null, xs) > -10 && Math.min.apply(null, xs) < W + 10;
}

function buildCity(S){
  var cam = CITY_CAM, rows = cityRows(), blocks = [], items = [];
  rows.forEach(function(row, ri){
    var bw = Math.max(36, row[0] * 0.3), sg = Math.max(14, row[0] * 0.06);
    [1, -1].forEach(function(side){
      for(var x = 16; x < 0.8 * row[1] + 40; x += bw + sg){
        var xa = side > 0 ? x : -(x + bw), xb = side > 0 ? x + bw : -x;
        if(onScreen(xa, xb, row[0], row[1])) blocks.push({ x0: xa, x1: xb, z0: row[0], z1: row[1], ri: ri, inner: x === 16, side: side });
      }
    });
  });

  blocks.forEach(function(bk){
    if(bk.ri === 2 && bk.inner && bk.side > 0){
      var lz = bk.z0 + 5, zig = { x0: bk.x0 + 6, x1: bk.x0 + 72, z0: lz, z1: lz + 80, tiers: [], spire: 0, garden: true, hanging: true, awnings: true, maxH: 54 };
      for(var t = 0; t < 5; t++) zig.tiers.push({ h: 12 + t * 10.5, inset: t === 0 ? 0 : 5 });
      items.push({ type: 'bld', b: zig, key: nearKey(zig.x0, zig.x1, zig.z0) });
      return;
    }
    if(bk.ri >= 1 && bk.ri <= 7 && !bk.inner && Math.random() < 0.16){
      var sp = Math.max(8, (bk.z1 - bk.z0) / 5);
      for(var tz = bk.z0 + sp * 0.5; tz < bk.z1; tz += sp){
        for(var tx = bk.x0 + sp * 0.5; tx < bk.x1; tx += sp){
          var px = tx + rand(-2, 2), pz = tz + rand(-2, 2), r = rand(3, 5) * (bk.z0 / 400 + 0.6);
          items.push({ type: 'tree', x: px, z: pz, r: r, ht: r * 1.9, key: Math.hypot(Math.abs(px), pz) });
        }
      }
      return;
    }
    var nx = bk.ri <= 3 ? randInt(2, 3) : randInt(1, 2), nz = bk.ri <= 4 ? randInt(1, 2) : 1;
    var alley = Math.max(2, (bk.x1 - bk.x0) * 0.04), cuts = [0], i;
    for(i = 1; i < nx; i++) cuts.push(i / nx + rand(-0.08, 0.08));
    cuts.push(1);
    for(var zi = 0; zi < nz; zi++){
      var za = lerp(bk.z0, bk.z1, zi / nz) + (zi ? alley : 0), zb = lerp(bk.z0, bk.z1, (zi + 1) / nz);
      for(i = 0; i < nx; i++){
        var xa = lerp(bk.x0, bk.x1, cuts[i]) + (i ? alley / 2 : 0), xb = lerp(bk.x0, bk.x1, cuts[i + 1]) - (i < nx - 1 ? alley / 2 : 0);
        var bld = makeBuilding(xa, xb, za, zb, bk.ri);
        if(bk.ri === 5 && bk.inner && bk.side < 0 && i === nx - 1 && zi === 0){ bld.tiers = [{ h: 120 }, { h: 175, inset: 5 }, { h: 215, inset: 4 }]; bld.spire = 55; bld.maxH = 215; }
        items.push({ type: 'bld', b: bld, key: nearKey(xa, xb, za) });
      }
    }
  });

  // Ground: curbs, avenue markings, crosswalks and cast shadows, all under the buildings.
  S.begin(false);
  blocks.forEach(function(bk){
    var ds = depthStyle(bk.z0), st = sty(ds, COLOR.ink1, 0.9, 0.55, 0.5);
    var c = [proj(cam, bk.x0, 0, bk.z0), proj(cam, bk.x1, 0, bk.z0), proj(cam, bk.x1, 0, bk.z1), proj(cam, bk.x0, 0, bk.z1)];
    for(var i = 0; i < 4; i++) S.add(inkLine(c[i], c[(i + 1) % 4], st));
  });
  for(var dz = 200; dz < 3200; dz += 12){
    var a = proj(cam, 0, 0, dz), b2 = proj(cam, 0, 0, dz + 5);
    if(dist(a, b2) < 1.2) break;
    S.add(ink([a, b2], sty(depthStyle(dz), COLOR.ink2, 0.8, 0.5, 0.2)));
  }
  rows.slice(0, 6).forEach(function(row){
    var zc = row[0] - Math.max(16, row[0] * 0.07) / 2, ds = depthStyle(zc), st = sty(ds, COLOR.ink2, 0.8, 0.45, 0.2);
    for(var x = -11; x <= 11; x += 2.2) S.add(ink([proj(cam, x, 0, zc - 2), proj(cam, x, 0, zc + 2)], st));
  });
  items.forEach(function(it){
    if(it.type !== 'bld') return;
    var b = it.b, s = FOCAL / b.z0;
    if(s < 0.25) return;
    var dx = b.maxH * 0.5, dzz = b.maxH * 0.2, pts = [];
    [[b.x0, b.z0], [b.x1, b.z0], [b.x1, b.z1], [b.x0, b.z1]].forEach(function(q){ pts.push(proj(cam, q[0], 0, q[1])); pts.push(proj(cam, q[0] + dx, 0, q[1] + dzz)); });
    S.add(hatchPoly(convexHull(pts), -8, clamp(1.6 + s, 2.2, 4.5), { alpha: 0.2 * depthStyle(b.z0).a, width: 0.6, max: 120 }));
  });

  // Buildings and park trees, far to near.
  items.sort(function(a, b){ return b.key - a.key; });
  items.forEach(function(it){
    if(it.type === 'bld') buildBuilding(S, cam, it.b);
    else parkTree(S, cam, it.x, it.z, it.r, it.ht);
  });

  // Street trees and lamps along the avenue, far to near (always in front of the facades beside them).
  var furn = [];
  for(var z = 205; z < 1300; z += 14){ furn.push({ t: 'tree', x: -14, z: z }); furn.push({ t: 'tree', x: 14, z: z + 7 }); }
  for(z = 212; z < 900; z += 28){ furn.push({ t: 'lamp', x: -15.5, z: z }); furn.push({ t: 'lamp', x: 15.5, z: z + 14 }); }
  furn.sort(function(a, b){ return b.z - a.z; });
  furn.forEach(function(f){
    var ds = depthStyle(f.z), s = FOCAL / f.z;
    if(f.t === 'tree') parkTree(S, cam, f.x, f.z, 2.3, 6.2);
    else {
      S.begin(true);
      var base = proj(cam, f.x, 0, f.z), top = proj(cam, f.x, 7, f.z), st = sty(ds, COLOR.ink1, 0.9, 0.75, 0.2);
      S.add(inkLine(base, top, st)).add(inkLine(top, [top[0] - Math.sign(f.x) * s * 1.2, top[1]], st));
      if(s > 2) S.add(ink(ellipsePoly(top[0] - Math.sign(f.x) * s * 1.2, top[1] + s * 0.35, s * 0.3, s * 0.3, 8).concat([[top[0] - Math.sign(f.x) * s * 0.9, top[1] + s * 0.35]]), st));
    }
  });
}
