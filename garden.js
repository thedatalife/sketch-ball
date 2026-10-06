'use strict';
// The viewer's garden terrace in the foreground: paving, balustrade, hedges, planters, fountain, lamps, trees.

var G = GARDEN_CAM;
function gs(z){ return FOCAL / z; }
function gp(x, y, z){ return proj(G, x, y, z); }

function simpleBox(S, b, o){
  o = o || {};
  var faces = visibleFaces(G, b), st = { color: COLOR.ink1, width: o.width || 1.2, alpha: o.alpha || 0.8, jitter: o.jitter || 0.6, curve: false };
  faces.forEach(function(f){ S.mask(faceQuad(G, b, f)); });
  var seen = {};
  faces.forEach(function(f){
    var d = FACE_DEF[f];
    for(var i = 0; i < 4; i++){
      var a = d[i], c = d[(i + 1) % 4], ka = a.join(''), kc = c.join(''), key = ka < kc ? ka + kc : kc + ka;
      if(seen[key]) continue;
      seen[key] = 1;
      var wa = boxCorner(b, a), wc = boxCorner(b, c);
      S.add(inkLine(gp(wa[0], wa[1], wa[2]), gp(wc[0], wc[1], wc[2]), st));
    }
  });
  if(o.shade !== false){
    if(faces.indexOf('right') >= 0) S.add(hatchPoly(faceQuad(G, b, 'right'), HATCH_A, 3.2, { alpha: 0.28 }));
    S.add(hatchPoly(faceQuad(G, b, 'front'), HATCH_B, o.frontSpacing || 6, { alpha: 0.14 }));
  }
  return faces;
}

// Scatter leaves across a projected face (bilinear), darker on shaded faces.
function leafFace(S, b, f, density, alpha, size){
  var fn = faceFn(b, f), q = faceQuad(G, b, f), bb = polyBBox(q);
  var n = Math.round(clamp((bb[2] - bb[0]) * (bb[3] - bb[1]) * density, 10, 1400));
  for(var i = 0; i < n; i++){
    var p = fp(G, fn, Math.random(), Math.random());
    S.add(leafMark(p[0], p[1], rand(size * 0.6, size), rand(0, Math.PI * 2), COLOR.ink1, alpha * rand(0.6, 1.1)));
  }
}

function groundEllipse(cx, cz, r, n){
  var pts = [];
  for(var i = 0; i < n; i++){ var a = i / n * Math.PI * 2; pts.push(gp(cx + Math.cos(a) * r, 0, cz + Math.sin(a) * r)); }
  return pts;
}

function buildGardenFloor(S){
  S.begin(false);
  S.mask([[-5, 558.5], [W + 5, 558.5], [W + 5, H + 5], [-5, H + 5]]);
  S.cur.items[S.cur.items.length - 1].floor = true;
  var st = { color: COLOR.ink1, width: 1, alpha: 0.55, jitter: 0.5 }, thin = { color: COLOR.ink2, width: 0.7, alpha: 0.38, jitter: 0.4 }, x, z;
  for(x = -6; x <= 6.01; x += 1.5) S.add(inkLine(gp(x, 0, 15.5), gp(x, 0, 28), Math.abs(x) > 5.9 ? st : thin));
  for(z = 16; z < 28; z += 1.2) S.add(inkLine(gp(-6, 0, z), gp(6, 0, z), thin));
  S.add(inkLine(gp(-6.3, 0, 15.5), gp(-6.3, 0, 28), st)).add(inkLine(gp(6.3, 0, 15.5), gp(6.3, 0, 28), st));
  S.add(ink(groundEllipse(0, 23, 3, 40).concat([groundEllipse(0, 23, 3, 40)[0]]), st));
  S.add(hatchPoly(groundEllipse(1.2, 24, 2.8, 24), -8, 3.5, { alpha: 0.18 }));
  for(z = 15.8; z < 28; z += 0.45){
    var s = gs(z);
    for(x = -21; x < 21; x += rand(0.35, 0.7)){
      if(Math.abs(x) < 6.6 || Math.random() < 0.45) continue;
      var p = gp(x, 0, z), h = rand(0.08, 0.16) * s;
      S.add(ink([[p[0], p[1]], [p[0] + rand(-0.3, 0.1) * h, p[1] - h]], { color: COLOR.ink2, width: 0.7, alpha: rand(0.25, 0.45), jitter: 0.2, curve: false }));
      if(Math.random() < 0.5) S.add(ink([[p[0] + 2, p[1]], [p[0] + 2 + rand(0, 0.35) * h, p[1] - h * 0.8]], { color: COLOR.ink2, width: 0.6, alpha: rand(0.2, 0.38), jitter: 0.2, curve: false }));
    }
  }
  [[-11.8, 16.7], [12.2, 17.2]].forEach(function(t){ S.add(hatchPoly(groundEllipse(t[0] + 1.6, t[1] + 0.8, 3, 24), -8, 3.2, { alpha: 0.22 })); });
}

function baluster(S, x, z){
  var prof = [[0.4, 0.07], [0.46, 0.1], [0.58, 0.05], [0.74, 0.11], [0.88, 0.06], [0.95, 0.08]];
  var L = prof.map(function(p){ return gp(x - p[1], p[0], z); }), R = prof.map(function(p){ return gp(x + p[1], p[0], z); });
  S.mask(L.concat(R.slice().reverse()));
  var st = { color: COLOR.ink1, width: 0.9, alpha: 0.75, jitter: 0.3, samples: 3 };
  S.add(ink(L, st)).add(ink(R, st));
  S.add(ink([R[1], R[2], R[3]], { color: COLOR.ink2, width: 0.6, alpha: 0.4, jitter: 0.2, curve: false }));
}

function buildBalustrade(S){
  S.begin(false);
  var z0 = 28, z1 = 28.6, x;
  simpleBox(S, { x0: -26, x1: 26, y0: 0, y1: 0.4, z0: z0, z1: z1 }, { frontSpacing: 4 });
  for(x = -21; x <= 21; x += 0.5) if(Math.abs((x + 20) % 4) > 0.3) baluster(S, x, z0 + 0.3);
  simpleBox(S, { x0: -26, x1: 26, y0: 0.95, y1: 1.12, z0: z0 - 0.05, z1: z1 + 0.05 }, { frontSpacing: 4 });
  for(x = -20; x <= 20; x += 4){
    S.begin(false);
    simpleBox(S, { x0: x - 0.28, x1: x + 0.28, y0: 0, y1: 1.3, z0: z0 - 0.08, z1: z1 + 0.08 }, { width: 1.3 });
    var c = gp(x, 1.5, z0 + 0.3), r = 0.19 * gs(z0);
    S.mask(ellipsePoly(c[0], c[1], r, r, 16));
    S.add(ink(ellipsePoly(c[0], c[1], r, r, 16).concat([[c[0] + r, c[1]]]), { color: COLOR.ink1, width: 1, alpha: 0.8, jitter: 0.3, curve: false }));
    S.add(hatchEllipse(c[0] + r * 0.2, c[1] + r * 0.2, r * 0.7, r * 0.7, HATCH_A, 2.2, { alpha: 0.3, width: 0.6 }));
  }
}

function buildHedge(S, x0, x1, z0, z1){
  S.begin(false);
  var b = { x0: x0, x1: x1, y0: 0, y1: 1.1, z0: z0, z1: z1 };
  var faces = simpleBox(S, b, { width: 1, alpha: 0.55, jitter: 1.4, shade: false });
  faces.forEach(function(f){
    var shaded = f === 'right';
    leafFace(S, b, f, f === 'top' ? 0.05 : shaded ? 0.09 : 0.065, f === 'top' ? 0.5 : shaded ? 0.8 : 0.65, 5);
  });
  if(faces.indexOf('right') >= 0) S.add(hatchPoly(faceQuad(G, b, 'right'), HATCH_A, 3.5, { alpha: 0.18 }));
}

function buildPlanter(S, x0, x1, z0, z1){
  S.begin(false);
  var b = { x0: x0, x1: x1, y0: 0, y1: 0.55, z0: z0, z1: z1 };
  simpleBox(S, b, { width: 1.1, frontSpacing: 3.5 });
  for(var i = 0; i < 26; i++){
    var x = rand(x0 + 0.1, x1 - 0.1), z = rand(z0 + 0.1, z1 - 0.1), s = gs(z);
    var base = gp(x, 0.55, z), top = gp(x, 0.55 + rand(0.25, 0.6), z), fl = rand(0.07, 0.11) * s;
    S.add(ink([base, top], { color: COLOR.ink2, width: 0.7, alpha: 0.5, jitter: 0.3, curve: false }));
    var pts = [];
    for(var k = 0; k <= 10; k++){ var a = k / 10 * Math.PI * 2, rr = k % 2 ? fl * 0.35 : fl; pts.push([top[0] + Math.cos(a) * rr, top[1] + Math.sin(a) * rr * 0.9]); }
    S.add(ink(pts, { color: COLOR.ink1, width: 0.9, alpha: 0.75, jitter: 0.3, curve: false }));
    if(Math.random() < 0.6) S.add(leafMark(base[0] + (top[0] - base[0]) * 0.5, lerp(base[1], top[1], 0.5), fl * 0.8, rand(-2.6, -0.5), COLOR.ink2, 0.55));
  }
}

function buildGardenLamp(S, x, z){
  S.begin(false);
  var s = gs(z), st = { color: COLOR.ink1, width: 1.2, alpha: 0.85, jitter: 0.3 };
  var b0 = gp(x, 0, z), t0 = gp(x, 3.2, z), w = 0.05 * s;
  S.mask([[b0[0] - w * 2, b0[1]], [b0[0] + w * 2, b0[1]], [t0[0] + w, t0[1]], [t0[0] - w, t0[1]]]);
  S.add(inkLine([b0[0] - w * 1.5, b0[1]], [t0[0] - w * 0.6, t0[1]], st)).add(inkLine([b0[0] + w * 1.5, b0[1]], [t0[0] + w * 0.6, t0[1]], st));
  var lw = 0.16 * s, lh = 0.4 * s, top = [t0[0], t0[1] - lh];
  var cage = [[t0[0] - lw * 0.7, t0[1]], [t0[0] + lw * 0.7, t0[1]], [top[0] + lw, top[1]], [top[0] - lw, top[1]]];
  S.mask(cage);
  S.add(ink(cage.concat([cage[0]]), st));
  S.add(inkLine([top[0], top[1]], [top[0], top[1] + lh], { color: COLOR.ink2, width: 0.7, alpha: 0.5, jitter: 0.2 }));
  S.add(ink([[top[0] - lw * 1.2, top[1]], [top[0], top[1] - lw * 0.9], [top[0] + lw * 1.2, top[1]]], { color: COLOR.ink1, width: 1.1, alpha: 0.85, jitter: 0.2, curve: false }));
}

// A cylinder seen from above: rim ellipse, front half of the base, silhouette sides.
function cylinder(S, cx, cz, r, y0, y1, st){
  var top = [], bot = [], n = 36;
  for(var i = 0; i < n; i++){
    var a = i / n * Math.PI * 2, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    top.push(gp(x, y1, z));
    bot.push({ p: gp(x, y0, z), front: Math.sin(a) < 0.05 });
  }
  var hull = convexHull(top.concat(bot.map(function(b){ return b.p; })));
  S.mask(hull);
  S.add(ink(top.concat([top[0]]), st));
  var front = [];
  for(i = n / 2; i <= n; i++) front.push(bot[i % n].p);
  S.add(ink(front, st));
  var lt = gp(cx - r, y1, cz), lb = gp(cx - r, y0, cz), rt = gp(cx + r, y1, cz), rb = gp(cx + r, y0, cz);
  S.add(inkLine(lt, lb, st)).add(inkLine(rt, rb, st));
  var side = [], i0 = Math.round(n * 0.62);
  for(i = i0; i <= n; i++) side.push(top[i % n]);
  for(i = n; i >= i0; i--) side.push(bot[i % n].p);
  S.add(hatchPoly(convexHull(side), HATCH_A, 3, { alpha: 0.24 }));
  return top;
}

function buildFountain(S){
  var cx = 0, cz = 23, st = { color: COLOR.ink1, width: 1.3, alpha: 0.85, jitter: 0.4, samples: 3 };
  S.begin(false);
  cylinder(S, cx, cz, 2.35, 0, 0.16, st);
  cylinder(S, cx, cz, 1.95, 0.16, 0.72, st);
  var water = [];
  for(var i = 0; i < 32; i++){ var a = i / 32 * Math.PI * 2; water.push(gp(cx + Math.cos(a) * 1.78, 0.62, cz + Math.sin(a) * 1.78)); }
  S.add(ink(water.concat([water[0]]), { color: COLOR.ink2, width: 0.9, alpha: 0.55, jitter: 0.4, curve: false }));
  S.add(hatchPoly(water, HATCH_A, 4, { alpha: 0.2 }));
  [0.5, 0.8, 1.15, 1.45].forEach(function(r){
    var arc = [], a0 = rand(0, 1);
    for(var k = 0; k <= 18; k++){ var a = a0 + k / 18 * Math.PI * 1.4; arc.push(gp(cx + Math.cos(a) * r, 0.63, cz + Math.sin(a) * r)); }
    S.add(ink(arc, { color: COLOR.ink2, width: 0.6, alpha: 0.3, jitter: 0.3, curve: false }));
  });

  S.begin(false);
  var prof = [[0.62, 0.34], [0.8, 0.2], [1.05, 0.12], [1.35, 0.26], [1.62, 0.13], [1.88, 0.2]];
  var L = prof.map(function(p){ return gp(cx - p[1], p[0], cz); }), R = prof.map(function(p){ return gp(cx + p[1], p[0], cz); });
  S.mask(L.concat(R.slice().reverse()));
  S.add(ink(L, st)).add(ink(R, st));
  S.add(hatchPoly(convexHull([R[1], R[2], R[3], R[4], gp(cx + 0.05, 1.4, cz), gp(cx + 0.05, 0.8, cz)]), HATCH_A, 2.6, { alpha: 0.3 }));
  [1, 4].forEach(function(k){ S.add(inkLine([L[k][0] - 2, L[k][1]], [R[k][0] + 2, R[k][1]], { color: COLOR.ink2, width: 0.8, alpha: 0.55, jitter: 0.2 })); });

  S.begin(false);
  var upper = cylinder(S, cx, cz, 0.95, 1.88, 2.12, st);
  var sp0 = gp(cx, 2.12, cz), sp1 = gp(cx, 2.55, cz), fr = 0.09 * gs(cz);
  S.add(inkLine(sp0, sp1, st));
  S.add(ink(ellipsePoly(sp1[0], sp1[1] - fr, fr, fr, 10).concat([[sp1[0] + fr, sp1[1] - fr]]), st));

  S.begin(false);
  var jet = { color: COLOR.ink2, width: 0.8, alpha: 0.55, jitter: 0.25, curve: false };
  for(i = 0; i < 14; i++){
    var ang = i / 14 * Math.PI * 2 + rand(-0.1, 0.1), vh = rand(0.85, 1.0), vv = rand(0.85, 1.05), pts = [];
    for(var t = 0; t <= 1.75; t += 0.08){
      var y = 2.6 + vv * t - 1.2 * t * t;
      if(y < 0.62) break;
      pts.push(gp(cx + Math.cos(ang) * vh * t, y, cz + Math.sin(ang) * vh * t));
    }
    if(pts.length > 2){
      S.add(ink(pts, jet));
      var e = pts[pts.length - 1];
      S.add(ink([[e[0] - 3, e[1] - 2], [e[0] - 5, e[1] - 6]], jet)).add(ink([[e[0] + 3, e[1] - 2], [e[0] + 5, e[1] - 5]], jet));
    }
  }
  for(i = 18; i < 36; i += 2){
    var p = upper[i], drop = gp(cx + Math.cos(i / 36 * Math.PI * 2) * 1.05, 0.64, cz + Math.sin(i / 36 * Math.PI * 2) * 1.05);
    S.add(ink([p, [p[0] + rand(-1.5, 1.5), lerp(p[1], drop[1], 0.5)], drop], { color: COLOR.ink2, width: 0.65, alpha: 0.42, jitter: 0.5, samples: 4 }));
  }
}

function buildGardenTree(S, x, z, cr, sway){
  var s = gs(z), base = gp(x, 0, z), cc = gp(x + 0.2, 9.4, z);
  var T = buildTree(S, {
    base: base, top: gp(x + rand(-0.3, 0.3), 4.2, z), cx: cc[0], cy: cc[1], rx: cr * s * 1.05, ry: cr * s * 0.92,
    D: 0.22 * s, attractors: 900, reach: 6, kill: 1.0, baseR: 0.3 * s, tipR: 0.55, twig: 6, clumpR: 0.8 * s, spacing: 0.72, density: 0.05,
    leafMin: 0.09 * s, leafMax: 0.16 * s, mergeable: false, alpha: 1, width: 1, scale: s, cam: G
  });
  sway.push({ items: T.items, pivot: base, heightRef: base[1] - (cc[1] - cr * s * 0.92), tree: T });
}

// Returns sway groups for the engine plus walker specs in garden-world coordinates.
function buildGarden(S){
  var sway = [];
  buildBalustrade(S);
  buildGardenFloor(S);
  buildPlanter(S, -5.6, -4.4, 25.5, 27.5);
  buildPlanter(S, 4.4, 5.6, 25.5, 27.5);
  buildGardenLamp(S, -4.2, 26.5);
  buildGardenLamp(S, 4.2, 26.5);
  buildHedge(S, -10.5, -6.9, 18.6, 26.8);
  buildHedge(S, 6.9, 10.5, 18.6, 26.8);
  buildFountain(S);
  buildGardenLamp(S, -4.2, 21);
  buildGardenLamp(S, 4.2, 21);
  buildPlanter(S, -5.6, -4.4, 16.4, 18.4);
  buildPlanter(S, 4.4, 5.6, 16.4, 18.4);
  buildGardenTree(S, 12.2, 17.2, 4.0, sway);
  buildGardenTree(S, -11.8, 16.7, 4.2, sway);
  return {
    sway: sway,
    walkers: [
      { cam: G, axis: 'x', fixed: 20.2, a: -4.6, b: 4.6, h: 1.75 },
      { cam: G, axis: 'z', fixed: -3.4, a: 19.4, b: 27.2, h: 1.7 },
      { cam: G, axis: 'z', fixed: 3.5, a: 19.4, b: 27.2, h: 1.8 }
    ]
  };
}
