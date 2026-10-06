'use strict';
// Click to demolish: blow a jagged hole in the clicked facade, fling the ink that was there as debris,
// and draw the wrecked interior behind it in perspective.

var blasts = [], particles = [];

function pointInPoly(x, y, poly){
  var inside = false;
  for(var i = 0, j = poly.length - 1; i < poly.length; j = i++){
    var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Sutherland-Hodgman against an axis-aligned rectangle in face-plane coordinates.
function clipPolyToRect(poly, a0, b0, a1, b1){
  var out = poly;
  [[0, a0, 1], [0, a1, -1], [1, b0, 1], [1, b1, -1]].forEach(function(e){
    var ax = e[0], lim = e[1], sg = e[2], inp = out;
    out = [];
    for(var i = 0; i < inp.length; i++){
      var p = inp[i], q = inp[(i + 1) % inp.length], pin = (p[ax] - lim) * sg >= 0, qin = (q[ax] - lim) * sg >= 0;
      if(pin) out.push(p);
      if(pin !== qin){ var t = (lim - p[ax]) / (q[ax] - p[ax]); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
    }
  });
  return out;
}

// Subdivide polygon edges so an outline bends smoothly with the cursor field like the ink around it.
function densify(poly, step){
  var out = [];
  for(var i = 0; i < poly.length; i++){
    var a = poly[i], b = poly[(i + 1) % poly.length], n = Math.max(1, Math.ceil(dist(a, b) / step));
    for(var k = 0; k < n; k++) out.push([lerp(a[0], b[0], k / n), lerp(a[1], b[1], k / n)]);
  }
  return out;
}

// A face as a plane: w(a, b, d) with a along the face, b up the wall (or deeper along z on a roof), d into the building.
function faceFrame(bx, f){
  if(f === 'front') return { A0: bx.x0, A1: bx.x1, B0: bx.y0, B1: bx.y1, D: bx.z1 - bx.z0, w: function(a, b, d){ return [a, b, bx.z0 + d]; } };
  if(f === 'right') return { A0: bx.z0, A1: bx.z1, B0: bx.y0, B1: bx.y1, D: bx.x1 - bx.x0, w: function(a, b, d){ return [bx.x1 - d, b, a]; } };
  if(f === 'left') return { A0: bx.z0, A1: bx.z1, B0: bx.y0, B1: bx.y1, D: bx.x1 - bx.x0, w: function(a, b, d){ return [bx.x0 + d, b, a]; } };
  return { roof: true, A0: bx.x0, A1: bx.x1, B0: bx.z0, B1: bx.z1, D: bx.y1 - bx.y0, w: function(a, b, d){ return [a, bx.y1 - d, b]; } };
}

// Screen point -> face-plane coordinates, by intersecting the view ray with the face's plane.
function unproject(cam, bx, f, sx, sy){
  var dx = sx - VP_X, dy = sy - HORIZON_Y, z;
  if(f === 'front'){ z = bx.z0; return [dx * z / FOCAL, cam.eye - dy * z / FOCAL]; }
  if(f === 'right' || f === 'left'){
    if(Math.abs(dx) < 1e-6) return null;
    z = FOCAL * (f === 'right' ? bx.x1 : bx.x0) / dx;
    return [z, cam.eye - dy * z / FOCAL];
  }
  if(Math.abs(dy) < 1e-6) return null;
  z = FOCAL * (cam.eye - bx.y1) / dy;
  return [dx * z / FOCAL, z];
}

// Front-most thing under the cursor: a tree ({ tree }), a building face ({ g, hit }), something else solid (the
// terrace, a lamp: { blocked: g }), or null for open sky and street. A tree is judged at its nearest layer, against
// where its limbs and clumps actually are right now (swaying, or falling), so its own masks are skipped as occluders.
function hitTest(sx, sy){
  var seen = new Set();
  for(var gi = groups.length - 1; gi >= 0; gi--){
    var g = groups[gi], bb = g.bb, k;
    if(bb && (sx < bb[0] || sx > bb[2] || sy < bb[1] || sy > bb[3])) continue;
    if(g.trees) for(k = 0; k < g.trees.length; k++){
      var T = g.trees[k];
      if(seen.has(T)) continue;
      seen.add(T);
      var th = treeHit(T, sx, sy);
      if(th) return { tree: th };
    }
    for(k = 0; k < g.hits.length; k++) if(pointInPoly(sx, sy, g.hits[k].quad)) return { g: g, hit: g.hits[k] };
    for(k = 0; k < g.masks.length; k++) if(!g.masks[k].tree && pointInPoly(sx, sy, g.masks[k].pts)) return { blocked: g, mask: g.masks[k] };
  }
  return null;
}

function jagLine(a, b, st, amp){
  var n = clamp(Math.round(dist(a, b) / 6), 2, 18), pts = [];
  for(var i = 0; i <= n; i++){
    var t = i / n, j = (i && i < n) ? rand(-amp, amp) : 0, dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    pts.push([a[0] + dx * t - dy / L * j, a[1] + dy * t + dx / L * j]);
  }
  return ink(pts, st);
}

function chunk(cx, cy, size, st){
  var n = randInt(3, 6), a0 = rand(0, 6.28), pts = [];
  for(var i = 0; i <= n; i++){ var a = a0 + i / n * Math.PI * 2, r = size * rand(0.55, 1); pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.8]); }
  pts[n] = pts[0];
  return ink(pts, st);
}

function wallInterior(cam, bx, fr, poly, P, ds, s){
  var out = [], W = function(a, b, d){ var w = fr.w(a, b, d); return proj(cam, w[0], w[1], w[2]); };
  var pa0 = Infinity, pa1 = -Infinity, pb0 = Infinity, pb1 = -Infinity, a, y;
  poly.forEach(function(q){ pa0 = Math.min(pa0, q[0]); pa1 = Math.max(pa1, q[0]); pb0 = Math.min(pb0, q[1]); pb1 = Math.max(pb1, q[1]); });
  var aa = Math.max(fr.A0, pa0 - 3), ab = Math.min(fr.A1, pa1 + 3), ya = Math.max(fr.B0, pb0 - 4), yb = Math.min(fr.B1, pb1 + 4);
  var D = Math.max(2, Math.min(fr.D - 0.5, 16)), span = Math.max(0.1, ab - aa);
  var dark = sty(ds, COLOR.ink3, 1.1, 0.85, 0.5), mid = sty(ds, COLOR.ink1, 1.15, 0.85, 0.6), light = sty(ds, COLOR.ink2, 0.75, 0.55, 0.4);
  var hull = convexHull(poly.map(function(q){ return W(q[0], q[1], 0); }));
  out = out.concat(hatchPoly(hull, HATCH_A, clamp(2.2 + s * 0.6, 2.6, 5), { alpha: 0.3 * ds.a, width: 0.65, color: COLOR.ink3 }));
  out = out.concat(hatchPoly(hull, HATCH_B, clamp(3 + s * 0.7, 3.4, 6.5), { alpha: 0.2 * ds.a, width: 0.55, color: COLOR.ink3 }));
  for(a = Math.ceil(aa / 6) * 6; a <= ab; a += 6) out.push(inkLine(W(a, ya, D), W(a, yb, D), light));
  var base = fr.B0 + (fr.B0 === 0 ? 4.8 : 0);
  for(y = base; y <= yb; y += 3.6){
    if(y < ya) continue;
    var drop = Math.random() < 0.3 ? rand(0.8, 2.6) : 0;
    out.push(jagLine(W(aa, y, 0.3), W(ab, y - drop, 0.3), mid, 1.4));
    out.push(inkLine(W(aa, y - 0.35, 0.3), W(ab, y - 0.35 - drop, 0.3), light));
    for(a = aa; a <= ab; a += 2.4) out.push(inkLine(W(a, y - drop * (a - aa) / span, 0.3), W(a, y, rand(D * 0.45, D)), light));
    out.push(inkLine(W(aa, y, D), W(ab, y, D), light));
    for(a = Math.ceil(aa / 4) * 4 + 1; a < ab - 1.5; a += 4){
      if(Math.random() < 0.45) continue;
      var q = [W(a, y + 0.9, D), W(a + 1.4, y + 0.9, D), W(a + 1.4, y + 2.8, D), W(a, y + 2.8, D)];
      out.push(ink(q.concat([q[0]]), light));
    }
    for(a = Math.ceil(aa / 6) * 6; a <= ab; a += 6){
      [5, 11].forEach(function(d){
        if(d >= D) return;
        var top = y + 3.6 * (Math.random() < 0.35 ? rand(0.3, 0.7) : 1), lean = Math.random() < 0.3 ? rand(-0.9, 0.9) : 0;
        out.push(inkLine(W(a, y, d), W(a + lean, top, d), mid));
      });
    }
  }
  var yf = Math.max(fr.B0, base + Math.floor((pb0 - base) / 3.6) * 3.6);
  for(var i = 0; i < 26; i++){
    var c = W(rand(pa0, pa1), yf, rand(0.4, D * 0.5));
    out.push(chunk(c[0], c[1], clamp(rand(0.25, 0.7) * s, 1.2, 10), mid));
  }
  poly.forEach(function(q, idx){
    if(idx % 2 || Math.random() < 0.35) return;
    var vx = P[0] - q[0], vy = P[1] - q[1], L = Math.hypot(vx, vy) || 1, len = rand(0.6, 1.8);
    var m = [q[0] + vx / L * len * 0.5 + rand(-0.2, 0.2), q[1] + vy / L * len * 0.5];
    out.push(ink([W(q[0], q[1], 0.05), W(m[0], m[1], 0.25), W(q[0] + vx / L * len, q[1] + vy / L * len - rand(0, 0.7), 0.45)], dark));
  });
  return out;
}

function roofInterior(cam, bx, fr, poly, P, ds, s){
  var out = [], W = function(a, b, d){ var w = fr.w(a, b, d); return proj(cam, w[0], w[1], w[2]); };
  var mid = sty(ds, COLOR.ink1, 0.85, 0.65, 0.6), light = sty(ds, COLOR.ink2, 0.65, 0.45, 0.4);
  var hull = convexHull(poly.map(function(q){ return W(q[0], q[1], 0); }));
  out = out.concat(hatchPoly(hull, HATCH_A, clamp(1.3 + s * 0.4, 1.7, 3.4), { alpha: 0.45 * ds.a, width: 0.7, color: COLOR.ink3 }));
  out = out.concat(hatchPoly(hull, HATCH_B, clamp(1.8 + s * 0.5, 2.2, 4.2), { alpha: 0.32 * ds.a, width: 0.6, color: COLOR.ink3 }));
  for(var k = 1; k <= 4; k++){
    var d = 3.6 * k;
    if(d >= fr.D) break;
    var ring = poly.map(function(q){ return W(P[0] + (q[0] - P[0]) * (1 + 0.14 * k), P[1] + (q[1] - P[1]) * (1 + 0.14 * k), d); });
    out.push(ink(ring.concat([ring[0]]), k === 1 ? mid : light));
    for(var i = 0; i < 10; i++){ var c = W(P[0] + rand(-1, 1) * 2, P[1] + rand(-1, 1) * 2, d); out.push(chunk(c[0], c[1], clamp(rand(0.25, 0.6) * s, 1, 8), light)); }
  }
  poly.forEach(function(q, idx){ if(idx % 3 === 0) out.push(inkLine(W(q[0], q[1], 0), W(q[0], q[1], Math.min(fr.D, 14)), light)); });
  return out;
}

// Cracks and soot on the surviving facade (erased with it by any hole), and a rubble heap on the ground
// or terrace in front of the blasted tier (drawn over everything in the group).
function scarring(cam, fr, poly, P, R, ds, s, base){
  var scars = [], rubble = [], W = function(a, b, d){ var w = fr.w(a, b, d); return proj(cam, w[0], w[1], w[2]); };
  var crack = sty(ds, COLOR.ink3, 0.8, 0.7, 0.3), soot = sty(ds, COLOR.ink3, 0.6, 0.35, 0.2), i;
  poly.forEach(function(q, idx){
    if(idx % 2 === 0 || Math.random() < 0.3) return;
    var ang = Math.atan2(q[1] - P[1], q[0] - P[0]), a = q[0], b = q[1], pts = [W(a, b, 0)], steps = randInt(3, 6), len = R * rand(0.5, 1.3) / steps;
    for(var k = 0; k < steps; k++){
      ang += rand(-0.6, 0.6);
      a = clamp(a + Math.cos(ang) * len, fr.A0, fr.A1);
      b = clamp(b + Math.sin(ang) * len, fr.B0, fr.B1);
      pts.push(W(a, b, 0));
    }
    scars.push(ink(pts, crack));
  });
  for(i = 0; i < 40; i++){
    var ang = rand(0, Math.PI * 2), r0 = R * rand(1.0, 1.35), r1 = r0 + R * rand(0.08, 0.3);
    scars.push(ink([W(clamp(P[0] + Math.cos(ang) * r0, fr.A0, fr.A1), clamp(P[1] + Math.sin(ang) * r0, fr.B0, fr.B1), 0),
      W(clamp(P[0] + Math.cos(ang) * r1, fr.A0, fr.A1), clamp(P[1] + Math.sin(ang) * r1, fr.B0, fr.B1), 0)], soot));
  }
  if(base != null){
    var pa0 = Infinity, pa1 = -Infinity, heap = [], n = 10;
    poly.forEach(function(q){ pa0 = Math.min(pa0, q[0]); pa1 = Math.max(pa1, q[0]); });
    for(i = 0; i <= n; i++) heap.push(W(lerp(pa0 - 1.5, pa1 + 1.5, i / n), base + Math.sin(i / n * Math.PI) * rand(0.6, 1.4), -rand(0.6, 1.2)));
    rubble.push(ink(heap, sty(ds, COLOR.ink1, 0.9, 0.7, 0.8)));
    var gs2 = FOCAL / Math.max(1, fr.w(P[0], base, -2)[2]);
    for(i = 0; i < 34; i++){
      var c = W(rand(pa0 - 2, pa1 + 2), base + rand(0, 0.8), -rand(0.3, 3));
      rubble.push(chunk(c[0], c[1], clamp(rand(0.25, 0.8) * gs2, 1.2, 12), sty(ds, COLOR.ink1, 0.8, 0.6, 0.4)));
    }
  }
  return { scars: scars, rubble: rubble };
}

// Everything painted after group gi near `region`: debris flying behind it must be hidden by it.
function occluderPath(gi, region){
  var p = new Path2D(), any = false;
  for(var k = gi + 1; k < groups.length; k++){
    var g = groups[k];
    if(!g.bb || !boxesOverlap(g.bb, region)) continue;
    g.masks.forEach(function(m){ if(boxesOverlap(m.bb, region)){ tracePoly(p, m, !m.live); p.closePath(); any = true; } });  // a falling piece where it is now
  }
  return any ? p : null;
}

function explode(g, hit, sx, sy){
  var cam = hit.cam, bx = hit.box, f = hit.face, fr = faceFrame(bx, f), P = unproject(cam, bx, f, sx, sy);
  if(!P || !isFinite(P[0]) || !isFinite(P[1])) return;
  var prev = g.holes || [], grow = null, poly = [], i;
  // Clicking inside an existing crater on this face grows it. The new outline is the old one (star-shaped
  // around its centre) pushed outward, so it always contains the old opening and can replace it outright.
  for(i = 0; i < prev.length; i++){ if(prev[i].box === bx && prev[i].face === f && pointInPoly(sx, sy, prev[i].pts)){ grow = prev[i]; break; } }
  if(grow) P = grow.P;
  var wp = fr.w(P[0], P[1], 0), z = Math.max(1, wp[2]), s = FOCAL / z, ds = depthStyle(z), R = grow ? Math.min(grow.R * 1.35, grow.R0 * 2.6) : clamp(72 / s, 2.6, 18);
  if(grow) poly = grow.plane.map(function(q){ var k = rand(1.18, 1.5); return [P[0] + (q[0] - P[0]) * k, P[1] + (q[1] - P[1]) * k]; });
  else for(i = 0; i < 22; i++){
    var ang = i / 22 * Math.PI * 2 + rand(-0.08, 0.08), r = R * (i % 2 ? rand(0.5, 0.78) : rand(0.85, 1.2));
    poly.push([P[0] + Math.cos(ang) * r, P[1] + Math.sin(ang) * r]);
  }
  poly = clipPolyToRect(poly, fr.A0 + 0.3, fr.B0 + 0.3, fr.A1 - 0.3, fr.B1 - 0.3);
  if(poly.length < 3) return;
  var scr = densify(poly.map(function(q){ var w = fr.w(q[0], q[1], 0); return proj(cam, w[0], w[1], w[2]); }), 4);
  var hole = { pts: scr, len: 0, hole: true, color: '', width: 0, alpha: 1, box: bx, face: f, P: P, R: R, R0: grow ? grow.R0 : R, plane: poly };
  initItem(hole);
  var base = fr.roof ? null : fr.B0, now = performance.now() / 1000;
  var inter = fr.roof ? roofInterior(cam, bx, fr, poly, P, ds, s) : wallInterior(cam, bx, fr, poly, P, ds, s);
  var sc = scarring(cam, fr, poly, P, R, ds, s, base);
  var groundY = fr.roof ? sy + 40 : proj(cam, 0, base, fr.w(P[0], base, -1.5)[2])[1];
  var B = { items: inter, c: [sx, sy], bb: null, occ: occluderPath(groups.indexOf(g), [sx - 420, sy - 320, sx + 420, H]) };
  spawnDebris(g, hole, prev, [sx, sy], s, groundY, B);

  // The new opening replaces the crater it grew from and any wreckage it fully covers, so repeat clicks don't pile up.
  var gone = new Set();
  if(grow){ gone.add(grow); grow.interior.forEach(function(it){ gone.add(it); }); prev = prev.filter(function(h){ return h !== grow; }); }
  function covered(it){ for(var k = 0; k < it.pts.length; k++) if(!pointInPoly(it.pts[k][0], it.pts[k][1], scr)) return false; return true; }
  function keep(it){ if(covered(it)){ gone.add(it); return false; } return true; }
  prev.forEach(function(h){ h.interior = h.interior.filter(keep); h.buckets = bucketize(h.interior); });
  g.scars = (g.scars || []).filter(keep);
  if(gone.size) g.items = g.items.filter(function(it){ return !gone.has(it); });

  var bb = hole.bb;
  inter.concat(sc.scars, sc.rubble).forEach(function(it){ initItem(it); g.items.push(it); bb = unionBox(bb, it.bb); });
  g.items.push(hole);
  hole.interior = inter;
  hole.buckets = bucketize(inter);
  g.holes = prev.concat([hole]);
  g.scars = g.scars.concat(sc.scars);
  g.rubble = (g.rubble || []).concat(sc.rubble);
  g.scarBuckets = bucketize(g.scars);
  g.rubbleBuckets = bucketize(g.rubble);
  g.bb = unionBox(g.bb, pad(bb, 30));

  inter.forEach(function(it){
    var p = it.pts, cx = 0, cy = 0, D = 1;
    for(var j = 0; j < p.length; j++){ cx += p[j][0]; cy += p[j][1]; D = Math.max(D, Math.hypot(p[j][0] - sx, p[j][1] - sy)); }
    it.animX = new Float32Array(p.length); it.animY = new Float32Array(p.length);
    it.b0 = now + Math.hypot(cx / p.length - sx, cy / p.length - sy) / 900 + rand(0, 0.05);
    it.beta = rand(10, 13); it.omega = it.beta * rand(1.1, 1.3);
    it.tDone = Math.log(Math.max(1.01, D * (1 - REVEAL.g0) / 0.25)) / it.beta;
  });
  B.bb = pad(unionBox(bb, [sx, sy, sx, sy]), 24);
  blasts.push(B);
  blastImpulse(sx, sy, Math.min(260, R * s * 2.6));
  patchCache(pad(bb, 32));
}

// The shockwave: shove nearby ink (hole outlines included) outward; the cursor-field springs relax it back.
function blastImpulse(sx, sy, R){
  groups.forEach(function(g){
    var gb = g.bb;
    if(gb && (sx + R < gb[0] || sx - R > gb[2] || sy + R < gb[1] || sy - R > gb[3])) return;
    g.items.forEach(function(it){
      var b = it.bb;
      if(!it.dispX || it.live || !b || b[2] < sx - R || b[0] > sx + R || b[3] < sy - R || b[1] > sy + R) return;
      var p = it.pts, any = false;
      for(var i = 0; i < p.length; i++){
        var dx = p[i][0] - sx, dy = p[i][1] - sy, d = Math.hypot(dx, dy);
        if(d >= R || d < 0.001) continue;
        var f = 1 - d / R, push = 24 * f * f;
        it.dispX[i] += dx / d * push; it.dispY[i] += dy / d * push; any = true;
      }
      if(any) it.moving = true;
    });
  });
}

// The facade ink inside the new hole (not already blown out by an earlier one) becomes flying debris,
// joined by masonry chunks and dust.
function spawnDebris(g, hole, prev, c, s, groundY, B){
  var hb = hole.bb, k = clamp(s / 2.5, 0.5, 1.6), n = 0, i;
  function goneAlready(x, y){ for(var j = 0; j < prev.length; j++) if(pointInPoly(x, y, prev[j].pts)) return true; return false; }
  function inHole(x, y){ return pointInPoly(x, y, hole.pts) && !goneAlready(x, y); }
  function fling(x, y, extra){
    var dx = x - c[0], dy = y - c[1], L = Math.hypot(dx, dy);
    if(L < 0.5){ var a = rand(0, 6.28); dx = Math.cos(a); dy = Math.sin(a); L = 1; }
    var sp = rand(120, 520) * k * (extra || 1);
    return [dx / L * sp + rand(-40, 40), dy / L * sp - rand(60, 280) * k];
  }
  function body(kind, pts, x, y, st, extra){
    var v = fling(x, y, extra);
    particles.push({ blast: B, kind: kind, pts: pts, x: x, y: y, vx: v[0], vy: v[1], rot: kind === 'chunk' ? rand(0, 6) : 0, vr: rand(-8, 8),
      color: st.color, width: st.width, alpha: st.alpha, age: 0, life: rand(1.3, 2.5), ground: groundY + rand(-4, 7), g: 900 * k, bounce: 0 });
  }
  // A run of ink inside the hole shatters into short shards.
  function emit(run, st){
    var piece = [run[0]], acc = 0, cut = rand(5, 12);
    for(var j = 1; j < run.length && n < 320; j++){
      piece.push(run[j]);
      acc += dist(run[j - 1], run[j]);
      if(acc >= cut || j === run.length - 1){
        if(piece.length >= 2){
          var cx = 0, cy = 0;
          piece.forEach(function(p){ cx += p[0]; cy += p[1]; });
          cx /= piece.length; cy /= piece.length;
          body('frag', piece.map(function(p){ return [p[0] - cx, p[1] - cy]; }), cx, cy, st);
          n++;
        }
        piece = [run[j]]; acc = 0; cut = rand(5, 12);
      }
    }
  }
  // Sample every segment finely: strokes often cross the hole with both vertices outside it.
  for(i = 0; i < g.strokes.length && n < 320; i++){
    var st = g.strokes[i], b = st.bb;
    if(!b || b[2] < hb[0] || b[0] > hb[2] || b[3] < hb[1] || b[1] > hb[3]) continue;
    var run = [], p = st.pts;
    for(var s0 = 0; s0 < p.length - 1; s0++){
      var steps = Math.max(1, Math.ceil(dist(p[s0], p[s0 + 1]) / 3));
      for(var t = 0; t < steps; t++){
        var q = [lerp(p[s0][0], p[s0 + 1][0], t / steps), lerp(p[s0][1], p[s0 + 1][1], t / steps)];
        if(inHole(q[0], q[1])) run.push(q); else { if(run.length > 1) emit(run, st); run = []; }
      }
    }
    var last = p[p.length - 1];
    if(inHole(last[0], last[1])) run.push(last);
    if(run.length > 1) emit(run, st);
  }
  var nc = clamp(Math.round((hb[2] - hb[0]) / 2.5), 12, 60), chunkSt = { color: COLOR.ink1, width: clamp(0.5 + s * 0.25, 0.7, 1.6), alpha: 0.85 };
  for(i = 0; i < nc; i++){
    var x = rand(hb[0], hb[2]), y = rand(hb[1], hb[3]);
    if(!inHole(x, y)) continue;
    var size = clamp(rand(0.3, 1.1) * s, 1.5, 14), pts = [], m = randInt(4, 6);
    for(var j = 0; j < m; j++){ var a = j / m * Math.PI * 2 + rand(-0.3, 0.3), r = size * rand(0.5, 1); pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
    body('chunk', pts, x, y, chunkSt, 1.2);
  }
  var R = Math.max(hb[2] - hb[0], hb[3] - hb[1]) / 2;
  for(i = 0; i < 12; i++) particles.push({ blast: B, kind: 'dust', x: c[0] + rand(-R, R) * 0.6, y: c[1] + rand(-R, R) * 0.6, vx: rand(-30, 30), vy: rand(-45, -10), r: rand(0.25, 0.5) * R, grow: rand(0.6, 1.2) * R, age: 0, life: rand(1.2, 2.2) });
  particles.push({ blast: B, kind: 'ring', x: c[0], y: c[1], r: R * 2.2, age: 0, life: 0.35 });
}

// Interior strokes burst out from the blast point on the same damped spring as the reveal.
// Returns the screen boxes that must be redrawn this frame.
function updateBlasts(){
  var now = performance.now() / 1000, rects = [];
  for(var i = blasts.length - 1; i >= 0; i--){
    var B = blasts[i], alive = false;
    B.items.forEach(function(it){
      if(it.settled) return;
      var tau = now - it.b0, p = it.pts, ax = it.animX, ay = it.animY;
      if(tau >= it.tDone){ ax.fill(0); ay.fill(0); it.settled = true; return; }
      alive = true;
      var kk = (1 - REVEAL.g0) * (tau < 0 ? 1 : Math.exp(-it.beta * tau) * Math.cos(it.omega * tau));
      for(var j = 0; j < p.length; j++){ ax[j] = (B.c[0] - p[j][0]) * kk; ay[j] = (B.c[1] - p[j][1]) * kk; }
    });
    rects.push(B.bb);
    if(!alive) blasts.splice(i, 1);
  }
  return rects;
}

var scratch = document.createElement('canvas');
scratch.width = W * dpr; scratch.height = H * dpr;
var sctx = scratch.getContext('2d');
sctx.scale(dpr, dpr);

// A leaf falls at a slow terminal speed, swinging side to side and rocking as it goes, then lies still and fades.
function stepLeaf(p, dt){
  if(p.landed) return;
  p.ph += p.fw * dt;
  p.vx += (-p.vx * p.drag + Math.cos(p.ph) * p.flut) * dt;
  p.vy += (p.g - p.vy * p.drag - Math.abs(Math.sin(p.ph)) * p.flut * 0.35) * dt;
  p.x += p.vx * dt; p.y += p.vy * dt;
  p.rot = p.rot0 + Math.sin(p.ph) * 0.9;
  if(p.y >= p.ground){ p.y = p.ground; p.landed = true; p.life = Math.min(p.life, p.age + rand(2.5, 5)); }
}

function stepParticle(p, dt){
  if(p.kind === 'ring') return;
  if(p.kind === 'leaf'){ stepLeaf(p, dt); return; }
  if(p.kind === 'dust'){ p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= Math.pow(0.4, dt); return; }
  p.vy += p.g * dt;
  p.vx *= Math.pow(0.55, dt);
  p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
  if(p.y > p.ground){
    p.y = p.ground;
    if(p.bounce < 2 && Math.abs(p.vy) > 60){ p.vy = -p.vy * 0.32; p.vx *= 0.6; p.vr *= 0.5; p.bounce++; }
    else { p.vy = 0; p.vx *= Math.pow(0.02, dt); p.vr = 0; }
  }
}

function particleBox(p){
  if(p.kind === 'ring'){ var rr = p.r + 6; return [p.x - rr, p.y - rr, p.x + rr, p.y + rr]; }
  if(p.kind === 'dust'){ var rd = p.r + p.grow + 2; return [p.x - rd, p.y - rd, p.x + rd, p.y + rd]; }
  if(p.kind === 'leaf'){ var rl = p.size + 3; return [p.x - rl, p.y - rl, p.x + rl, p.y + rl]; }
  var e = 2;
  p.pts.forEach(function(q){ e = Math.max(e, Math.abs(q[0]), Math.abs(q[1])); });
  e = e * 1.42 + 3;
  return [p.x - e, p.y - e, p.x + e, p.y + e];
}

function drawParticle(ctx, p){
  var fade = 1 - p.age / p.life;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if(p.kind === 'ring'){
    ctx.globalAlpha = 0.35 * fade; ctx.strokeStyle = COLOR.ink1; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(p.x, p.y, 4 + p.r * (1 - Math.exp(-10 * p.age)), 0, Math.PI * 2); ctx.stroke();
    return;
  }
  if(p.kind === 'dust'){
    var r = p.r + p.grow * (1 - Math.exp(-2.2 * p.age));
    ctx.globalAlpha = 0.22 * fade; ctx.strokeStyle = COLOR.ink2; ctx.lineWidth = 0.8;
    ctx.beginPath();
    for(var k = 0; k < 3; k++){ var a0 = k * 2.1 + p.age; ctx.moveTo(p.x + Math.cos(a0) * r, p.y + Math.sin(a0) * r * 0.8); ctx.arc(p.x, p.y, r * (0.8 + k * 0.12), a0, a0 + 1.6); }
    ctx.stroke();
    return;
  }
  if(p.kind === 'leaf'){
    var dx = Math.cos(p.rot) * p.size, dy = Math.sin(p.rot) * p.size, w = 0.3, x0 = p.x - dx / 2, y0 = p.y - dy / 2;
    ctx.globalAlpha = p.alpha * clamp((p.life - p.age) / 1.5, 0, 1); ctx.strokeStyle = p.color; ctx.lineWidth = p.width;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(x0 + dx * 0.45 - dy * w * 1.4, y0 + dy * 0.45 + dx * w * 1.4, x0 + dx, y0 + dy);
    ctx.quadraticCurveTo(x0 + dx * 0.45 + dy * w * 1.4, y0 + dy * 0.45 - dx * w * 1.4, x0, y0);
    ctx.lineTo(x0 + dx * 0.7, y0 + dy * 0.7);
    ctx.stroke();
    return;
  }
  var ca = Math.cos(p.rot), sa = Math.sin(p.rot);
  ctx.globalAlpha = p.alpha * Math.min(1, fade * 1.6); ctx.strokeStyle = p.color; ctx.lineWidth = p.width;
  ctx.beginPath();
  for(var j = 0; j < p.pts.length; j++){
    var q = p.pts[j], X = p.x + q[0] * ca - q[1] * sa, Y = p.y + q[0] * sa + q[1] * ca;
    if(j) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
  }
  if(p.kind === 'chunk') ctx.closePath();
  ctx.stroke();
}

// Debris is drawn per blast into a scratch layer, then anything nearer than the blasted building is cut out of it.
function renderParticles(dt){
  var byBlast = new Map();
  for(var i = particles.length - 1; i >= 0; i--){
    var p = particles[i];
    p.age += dt;
    if(p.age >= p.life){ particles.splice(i, 1); continue; }
    stepParticle(p, dt);
    if(!byBlast.has(p.blast)) byBlast.set(p.blast, []);
    byBlast.get(p.blast).push(p);
  }
  byBlast.forEach(function(list, B){
    if(!B.occ){ list.forEach(function(q){ drawParticle(fctx, q); }); return; }
    var bb = null;
    list.forEach(function(q){ bb = unionBox(bb, particleBox(q)); });
    var x0 = Math.max(0, Math.floor(bb[0])), y0 = Math.max(0, Math.floor(bb[1])), x1 = Math.min(W, Math.ceil(bb[2])), y1 = Math.min(H, Math.ceil(bb[3]));
    if(x1 <= x0 || y1 <= y0) return;
    sctx.clearRect(x0, y0, x1 - x0, y1 - y0);
    list.forEach(function(q){ drawParticle(sctx, q); });
    sctx.save();
    sctx.globalCompositeOperation = 'destination-out';
    sctx.globalAlpha = 1;
    sctx.fill(B.occ);
    sctx.restore();
    fctx.globalAlpha = 1;
    fctx.drawImage(scratch, x0 * dpr, y0 * dpr, (x1 - x0) * dpr, (y1 - y0) * dpr, x0, y0, x1 - x0, y1 - y0);
    sctx.clearRect(x0, y0, x1 - x0, y1 - y0);  // leave the scratch layer clean for its next user
  });
  fctx.globalAlpha = 1;
  sctx.globalAlpha = 1;
}
