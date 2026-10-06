'use strict';
// Shared primitives: hand-drawn ink strokes, leaves, hatching, geometry, cursor field math.

var W = 1200, H = 760, HORIZON_Y = 300, VP_X = 600, FOCAL = 800;
var HATCH_A = 45, HATCH_B = 135;
var COLOR = { paper: '#efe5cd', paperShadow: '#d6c49a', ink1: '#3d4a86', ink2: '#57649c', ink3: '#2a3466' };

function rand(a, b){ return a + Math.random() * (b - a); }
function randInt(a, b){ return Math.floor(a + Math.random() * (b - a + 1)); }
function randSign(){ return Math.random() < 0.5 ? -1 : 1; }
function clamp(v, a, b){ return v < a ? a : v > b ? b : v; }
function lerp(a, b, t){ return a + (b - a) * t; }
function dist(a, b){ return Math.hypot(b[0] - a[0], b[1] - a[1]); }

function hexToRgba(hex, a){
  var v = parseInt(hex.slice(1), 16);
  return 'rgba(' + ((v >> 16) & 255) + ',' + ((v >> 8) & 255) + ',' + (v & 255) + ',' + a + ')';
}

function catmullRom(p0, p1, p2, p3, t){
  var t2 = t * t, t3 = t2 * t;
  return [
    0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
    0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
  ];
}

function smoothPath(ctrl, samplesPerSeg){
  samplesPerSeg = samplesPerSeg || 5;
  if(ctrl.length < 3) return ctrl.slice();
  var pts = [ctrl[0]].concat(ctrl, [ctrl[ctrl.length - 1]]);
  var out = [];
  for(var i = 0; i < pts.length - 3; i++){
    for(var s = 0; s < samplesPerSeg; s++) out.push(catmullRom(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], s / samplesPerSeg));
  }
  out.push(ctrl[ctrl.length - 1]);
  return out;
}

function withTremor(pts, amp, freq){
  var phase = rand(0, Math.PI * 2);
  var out = new Array(pts.length);
  for(var i = 0; i < pts.length; i++){
    var prev = pts[Math.max(0, i - 1)], next = pts[Math.min(pts.length - 1, i + 1)];
    var dx = next[0] - prev[0], dy = next[1] - prev[1];
    var len = Math.hypot(dx, dy) || 1;
    var wob = Math.sin(i * freq + phase) * amp * 0.6 + (Math.random() - 0.5) * amp * 0.7;
    out[i] = [pts[i][0] - dy / len * wob, pts[i][1] + dx / len * wob];
  }
  return out;
}

function pathLength(pts){
  var L = 0;
  for(var i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
  return L;
}

// A hand-drawn stroke. opts: color, width, alpha, jitter, curve(false = polyline), samples.
function ink(ctrl, opts){
  opts = opts || {};
  var base = opts.curve === false ? ctrl.slice() : smoothPath(ctrl, opts.samples || 5);
  var pts = withTremor(base, opts.jitter == null ? 1.1 : opts.jitter, opts.freq || 0.22);
  return { pts: pts, len: pathLength(pts), color: opts.color || COLOR.ink1, width: opts.width || 1.4, alpha: opts.alpha == null ? 0.85 : opts.alpha };
}

// A straight line subdivided so the tremor gives it a hand-drawn wobble.
function inkLine(a, b, st){
  var n = clamp(Math.round(dist(a, b) / 16), 1, 14);
  var pts = [];
  for(var i = 0; i <= n; i++) pts.push([lerp(a[0], b[0], i / n), lerp(a[1], b[1], i / n)]);
  return ink(pts, { color: st.color, width: st.width, alpha: st.alpha, jitter: st.jitter, curve: false });
}

// An opaque occluder: erases whatever ink is already beneath it (painter's algorithm).
function maskItem(poly){
  return { pts: poly.map(function(p){ return [p[0], p[1]]; }), len: 0, mask: true, color: '', width: 0, alpha: 1 };
}

function leafMark(cx, cy, size, angleRad, color, alpha, width){
  var dx = Math.cos(angleRad), dy = Math.sin(angleRad);
  var bow = size * (0.22 + Math.random() * 0.2) * randSign();
  var mid = [cx + dx * size * 0.55 - dy * bow, cy + dy * size * 0.55 + dx * bow];
  return ink([[cx, cy], mid, [cx + dx * size, cy + dy * size]], { color: color, width: width || 0.7, jitter: 0.25, curve: false, alpha: alpha });
}

// A lumpy canopy silhouette filled with individual leaves, denser on the shadow side.
// opts: color, contourWidth, contourAlpha, sizeMin, sizeMax, alphaMul, mask, leafWidth
function canopyShape(cx, cy, rx, ry, leafCount, opts){
  opts = opts || {};
  var seed = rand(0, 10), am = opts.alphaMul == null ? 1 : opts.alphaMul;
  function edgeR(a){ return 0.66 + 0.18 * Math.sin(a * 2 + seed) + 0.1 * Math.sin(a * 4 + seed * 1.4) + 0.06 * Math.sin(a * 7 + seed * 2.3); }
  var out = [], contour = [];
  var n = rx > 25 ? 44 : rx > 8 ? 22 : 12;
  for(var i = 0; i <= n; i++){
    var a = (i / n) * Math.PI * 2, r = edgeR(a);
    contour.push([cx + Math.cos(a) * r * rx, cy + Math.sin(a) * r * ry]);
  }
  if(opts.mask) out.push(maskItem(contour));
  out.push(ink(contour, { color: opts.color || COLOR.ink1, width: opts.contourWidth || 1.5, jitter: Math.min(1.6, rx * 0.06 + 0.3), samples: 3, alpha: (opts.contourAlpha == null ? 0.82 : opts.contourAlpha) * am }));
  var sMin = opts.sizeMin || 3, sMax = opts.sizeMax || 6.5, lightDir = -2.35;
  for(var k = 0; k < leafCount; k++){
    var aa = rand(0, Math.PI * 2);
    var rr = Math.sqrt(Math.random()) * edgeR(aa);
    var shade = (Math.cos(aa - lightDir) + 1) / 2;
    if(Math.random() < 0.5 * (1 - shade)) continue;
    out.push(leafMark(cx + Math.cos(aa) * rr * rx, cy + Math.sin(aa) * rr * ry, rand(sMin, sMax), rand(0, Math.PI * 2),
      opts.color || COLOR.ink1, (0.3 + shade * 0.42 + Math.random() * 0.12) * am, opts.leafWidth));
  }
  return out;
}

// ---------- geometry ----------
function convexHull(points){
  var p = points.slice().sort(function(a, b){ return a[0] - b[0] || a[1] - b[1]; });
  if(p.length < 3) return p;
  function cross(o, a, b){ return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
  var lower = [], upper = [], i;
  for(i = 0; i < p.length; i++){ while(lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p[i]) <= 0) lower.pop(); lower.push(p[i]); }
  for(i = p.length - 1; i >= 0; i--){ while(upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p[i]) <= 0) upper.pop(); upper.push(p[i]); }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

function polyBBox(pts){
  var b = [Infinity, Infinity, -Infinity, -Infinity];
  for(var i = 0; i < pts.length; i++){
    if(pts[i][0] < b[0]) b[0] = pts[i][0];
    if(pts[i][1] < b[1]) b[1] = pts[i][1];
    if(pts[i][0] > b[2]) b[2] = pts[i][0];
    if(pts[i][1] > b[3]) b[3] = pts[i][1];
  }
  return b;
}

function unionBox(a, b){ if(!a) return b ? b.slice() : null; if(!b) return a; return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]; }
function pad(b, p){ return [b[0] - p, b[1] - p, b[2] + p, b[3] + p]; }
function boxesOverlap(a, b){ return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]; }

// Keep a small set of disjoint dirty rectangles: overlapping ones merge; past `cap`, the pair whose union is smallest merges.
function addRect(list, b, cap){
  for(var i = 0; i < list.length; i++){
    if(boxesOverlap(list[i], b)){ var u = unionBox(list[i], b); list.splice(i, 1); return addRect(list, u, cap); }
  }
  list.push(b);
  if(list.length > (cap || 6)){
    var best = null, bi = 0, bj = 1;
    for(i = 0; i < list.length; i++) for(var j = i + 1; j < list.length; j++){
      var m = unionBox(list[i], list[j]), area = (m[2] - m[0]) * (m[3] - m[1]);
      if(best === null || area < best){ best = area; bi = i; bj = j; }
    }
    var merged = unionBox(list[bi], list[bj]);
    list.splice(bj, 1); list.splice(bi, 1);
    return addRect(list, merged, cap);
  }
  return list;
}

function ellipsePoly(cx, cy, rx, ry, n){
  var pts = [];
  for(var i = 0; i < n; i++){ var a = i / n * Math.PI * 2; pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]); }
  return pts;
}

// Cyrus-Beck: clip the infinite line p + t*d to a convex polygon.
function clipLineToConvex(px, py, dx, dy, poly){
  var area = 0, n = poly.length, i;
  for(i = 0; i < n; i++){ var a = poly[i], b = poly[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
  var sgn = area > 0 ? 1 : -1, t0 = -1e7, t1 = 1e7;
  for(i = 0; i < n; i++){
    var v = poly[i], w = poly[(i + 1) % n];
    var ex = w[0] - v[0], ey = w[1] - v[1];
    var nx = -ey * sgn, ny = ex * sgn;
    var num = nx * (px - v[0]) + ny * (py - v[1]);
    var den = nx * dx + ny * dy;
    if(Math.abs(den) < 1e-9){ if(num < 0) return null; continue; }
    var t = -num / den;
    if(den > 0){ if(t > t0) t0 = t; } else { if(t < t1) t1 = t; }
    if(t0 > t1) return null;
  }
  return [[px + dx * t0, py + dy * t0], [px + dx * t1, py + dy * t1]];
}

function hatchPoly(poly, angleDeg, spacing, opts){
  opts = opts || {};
  if(!poly || poly.length < 3 || spacing <= 0) return [];
  var rad = angleDeg * Math.PI / 180, dx = Math.cos(rad), dy = Math.sin(rad), nx = -dy, ny = dx;
  var cmin = Infinity, cmax = -Infinity;
  for(var i = 0; i < poly.length; i++){ var c = poly[i][0] * nx + poly[i][1] * ny; if(c < cmin) cmin = c; if(c > cmax) cmax = c; }
  var st = { color: opts.color || COLOR.ink2, width: opts.width || 0.8, jitter: opts.jitter == null ? 0.45 : opts.jitter, curve: false, alpha: opts.alpha == null ? 0.3 : opts.alpha };
  var out = [], limit = opts.max || 400;
  for(var cc = cmin + spacing * 0.5; cc < cmax && out.length < limit; cc += spacing){
    var seg = clipLineToConvex(cc * nx, cc * ny, dx, dy, poly);
    if(seg && dist(seg[0], seg[1]) > 0.8) out.push(ink(seg, st));
  }
  return out;
}

function hatchRect(x0, y0, x1, y1, angleDeg, spacing, opts){
  if(x1 <= x0 || y1 <= y0) return [];
  return hatchPoly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], angleDeg, spacing, opts);
}

function hatchEllipse(cx, cy, rx, ry, angleDeg, spacing, opts){
  if(rx <= 0 || ry <= 0) return [];
  return hatchPoly(ellipsePoly(cx, cy, rx, ry, 24), angleDeg, spacing, opts);
}

// ---------- cursor field math (shared by ink points and entities) ----------
var INFLUENCE_R = 95, MAX_PUSH = 26;
var WALKER_INFLUENCE_R = 70, WALKER_MAX_PUSH = 40;
var _pushTmp = [0, 0];

function pushTarget(px, py, mx, my, influenceR, maxPush, out){
  var adx = px - mx, ady = py - my;
  if(adx <= -influenceR || adx >= influenceR || ady <= -influenceR || ady >= influenceR){ out[0] = 0; out[1] = 0; return out; }
  var d = Math.sqrt(adx * adx + ady * ady);
  if(d >= influenceR || d < 0.0001){ out[0] = 0; out[1] = 0; return out; }
  var f = 1 - d / influenceR;
  var push = maxPush * f * f;
  out[0] = adx / d * push;
  out[1] = ady / d * push;
  return out;
}

function springToward(cur, tx, ty){
  var rate = (tx * tx + ty * ty) > (cur.x * cur.x + cur.y * cur.y) ? 0.45 : 0.08;
  cur.x += (tx - cur.x) * rate;
  cur.y += (ty - cur.y) * rate;
}
