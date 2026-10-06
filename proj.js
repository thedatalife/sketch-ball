'use strict';
// One-point perspective: cameras, draw-order groups, and 3D buildings drawn as ink.

// Both cameras share the horizon and vanishing point so every receding line agrees.
var CITY_CAM = { eye: 60 };
var GARDEN_CAM = { eye: 9 };

function proj(cam, x, y, z){ return [VP_X + FOCAL * x / z, HORIZON_Y - FOCAL * (y - cam.eye) / z]; }

// Atmospheric perspective: distant ink is lighter, finer and steadier.
function depthStyle(z){
  var t = Math.pow(clamp((z - 170) / 4200, 0, 1), 0.6);
  return { a: 1 - 0.6 * t, w: 1 - 0.48 * t, j: 1 - 0.6 * t };
}
function sty(ds, color, width, alpha, jitter){
  return { color: color, width: Math.max(0.45, width * ds.w), alpha: alpha * ds.a, jitter: (jitter == null ? 0.6 : jitter) * ds.j, curve: false };
}
function mid(a, b){ return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }

// Items are painted group by group: a group's masks erase what lies behind it, then its ink is drawn.
function Scene(){ this.groups = []; this.cur = null; }
Scene.prototype.begin = function(mergeable){ this.cur = { items: [], mergeable: !!mergeable, hits: [] }; this.groups.push(this.cur); return this; };
Scene.prototype.add = function(x){
  if(!x) return this;
  if(Array.isArray(x)){ for(var i = 0; i < x.length; i++) this.cur.items.push(x[i]); }
  else this.cur.items.push(x);
  return this;
};
Scene.prototype.mask = function(poly){ this.cur.items.push(maskItem(poly)); return this; };

// ---------- boxes ----------
var FACE_DEF = {
  front: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
  right: [[1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0]],
  left:  [[0, 0, 1], [0, 0, 0], [0, 1, 0], [0, 1, 1]],
  top:   [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]]
};
function boxCorner(b, c){ return [c[0] ? b.x1 : b.x0, c[1] ? b.y1 : b.y0, c[2] ? b.z1 : b.z0]; }
function visibleFaces(cam, b){
  var f = ['front'];
  if(b.x1 < 0) f.push('right');
  if(b.x0 > 0) f.push('left');
  if(b.y1 < cam.eye) f.push('top');
  return f;
}
function faceFn(b, name){
  if(name === 'front') return function(u, v){ return [lerp(b.x0, b.x1, u), lerp(b.y0, b.y1, v), b.z0]; };
  if(name === 'right') return function(u, v){ return [b.x1, lerp(b.y0, b.y1, v), lerp(b.z0, b.z1, u)]; };
  if(name === 'left') return function(u, v){ return [b.x0, lerp(b.y0, b.y1, v), lerp(b.z1, b.z0, u)]; };
  return function(u, v){ return [lerp(b.x0, b.x1, u), b.y1, lerp(b.z0, b.z1, v)]; };
}
function faceDims(b, name){
  if(name === 'front') return [b.x1 - b.x0, b.y1 - b.y0];
  if(name === 'top') return [b.x1 - b.x0, b.z1 - b.z0];
  return [b.z1 - b.z0, b.y1 - b.y0];
}
function fp(cam, fn, u, v){ var w = fn(u, v); return proj(cam, w[0], w[1], w[2]); }
function faceQuad(cam, b, name){ return FACE_DEF[name].map(function(c){ var w = boxCorner(b, c); return proj(cam, w[0], w[1], w[2]); }); }

function drawBox(S, cam, b, o){
  var faces = visibleFaces(cam, b), ds = depthStyle(b.z0), s = FOCAL / b.z0, quads = {};
  faces.forEach(function(f){ quads[f] = faceQuad(cam, b, f); S.mask(quads[f]); S.cur.hits.push({ box: b, face: f, quad: quads[f], cam: cam }); });
  var seen = {}, edgeSt = sty(ds, COLOR.ink1, 1.5, 0.86, 0.9);
  faces.forEach(function(f){
    var d = FACE_DEF[f];
    for(var i = 0; i < 4; i++){
      var a = d[i], c = d[(i + 1) % 4], ka = a.join(''), kc = c.join('');
      var key = ka < kc ? ka + kc : kc + ka;
      if(seen[key]) continue;
      seen[key] = 1;
      var wa = boxCorner(b, a), wc = boxCorner(b, c);
      S.add(inkLine(proj(cam, wa[0], wa[1], wa[2]), proj(cam, wc[0], wc[1], wc[2]), edgeSt));
    }
  });
  faces.forEach(function(f){ shadeFace(S, cam, b, f, quads[f], ds, s); });
  faces.forEach(function(f){ if(f !== 'top') faceWindows(S, cam, b, f, ds, o); });
  if(o.awnings) drawAwnings(S, cam, b, ds);
  if(o.hanging && s > 1.1) drawBalconies(S, cam, b, ds, s);
}

function shadeFace(S, cam, b, f, quad, ds, s){
  var bb = polyBBox(quad);
  if(bb[2] - bb[0] < 1.5 || bb[3] - bb[1] < 1.5) return;
  var fn = faceFn(b, f), dims = faceDims(b, f), sp = clamp(2.2 + s * 0.8, 2.6, 6.5), i;
  if(f === 'right'){
    var nC = clamp(Math.round(dims[1] / 2.4), 2, 70), cst = sty(ds, COLOR.ink2, 0.75, 0.3, 0.4);
    for(i = 1; i < nC; i++) S.add(inkLine(fp(cam, fn, 0, i / nC), fp(cam, fn, 1, i / nC), cst));
    S.add(hatchPoly(quad, HATCH_A, sp, { alpha: 0.22 * ds.a, width: 0.7 * ds.w, jitter: 0.4 * ds.j }));
  } else if(f === 'front'){
    var nV = clamp(Math.round(dims[0] / 5), 1, 30), vst = sty(ds, COLOR.ink2, 0.7, 0.16, 0.4);
    for(i = 1; i < nV; i++) if(Math.random() < 0.7) S.add(inkLine(fp(cam, fn, i / nV, 0), fp(cam, fn, i / nV, 1), vst));
    S.add(hatchPoly([fp(cam, fn, 0.7, 0), fp(cam, fn, 1, 0), fp(cam, fn, 1, 1), fp(cam, fn, 0.7, 1)], HATCH_B, sp + 1, { alpha: 0.16 * ds.a, width: 0.7 * ds.w }));
  } else if(f === 'left'){
    var nL = clamp(Math.round(dims[1] / 7), 1, 20), lst = sty(ds, COLOR.ink2, 0.7, 0.14, 0.4);
    for(i = 1; i < nL; i++) S.add(inkLine(fp(cam, fn, 0, i / nL), fp(cam, fn, 1, i / nL), lst));
  } else if(f === 'top' && s > 0.7){
    var y = b.y1, e = 0.7;
    var ring = [[b.x0 + e, b.z0 + e], [b.x1 - e, b.z0 + e], [b.x1 - e, b.z1 - e], [b.x0 + e, b.z1 - e], [b.x0 + e, b.z0 + e]]
      .map(function(q){ return proj(cam, q[0], y, q[1]); });
    S.add(ink(ring, sty(ds, COLOR.ink1, 0.8, 0.5, 0.4)));
  }
}

function faceWindows(S, cam, b, f, ds, o){
  var fn = faceFn(b, f), dims = faceDims(b, f), Wf = dims[0], Hf = dims[1];
  var ground = b.y0 === 0 ? 4.8 : 0.6, floorH = 3.6, colW = 3.8;
  var floors = Math.floor((Hf - ground - 1.2) / floorH), cols = Math.floor((Wf - 1.4) / colW);
  var rectSt = sty(ds, COLOR.ink1, 0.85, 0.6, 0.3), subSt = sty(ds, COLOR.ink2, 0.55, 0.4, 0.2);
  if(floors * cols > 260){
    // Too many windows to draw one by one: a curtain-wall grid of floor lines and mullions reads the same.
    var gst = sty(ds, COLOR.ink1, 0.6, 0.4, 0.3), v0 = ground / Hf, step;
    step = Math.max(1, Math.ceil(floors / 110));
    for(var fr = 0; fr <= floors; fr += step){ var v = (ground + fr * floorH + 0.7) / Hf; if(v < 0.99) S.add(inkLine(fp(cam, fn, 0.02, v), fp(cam, fn, 0.98, v), gst)); }
    step = Math.max(1, Math.ceil(cols / 110));
    for(var cl = 0; cl <= cols; cl += step){ var u = (Wf - cols * colW) / 2 / Wf + cl * colW / Wf; S.add(inkLine(fp(cam, fn, u, v0), fp(cam, fn, u, 0.98), gst)); }
    floors = 0;
  }
  if(floors >= 1 && cols >= 1){
    var mU = (Wf - cols * colW) / 2, hw = 0.85 / Wf;
    for(var r = 0; r < floors; r++){
      var vb = (ground + r * floorH + 0.7) / Hf, vt = (ground + r * floorH + 2.8) / Hf;
      if(vt > 0.99) break;
      for(var c = 0; c < cols; c++){
        if(Math.random() < 0.06) continue;
        var uc = (mU + (c + 0.5) * colW) / Wf;
        var p00 = fp(cam, fn, uc - hw, vb), p10 = fp(cam, fn, uc + hw, vb), p11 = fp(cam, fn, uc + hw, vt), p01 = fp(cam, fn, uc - hw, vt);
        var pw = dist(p00, p10), ph = dist(p00, p01);
        if(ph < 1.2 || p00[0] < -20 || p00[0] > W + 20) continue;
        if(pw >= 4.5){
          S.add(ink([p00, p10, p11, p01, p00], rectSt));
          if(pw >= 7){
            S.add(ink([mid(p00, p10), mid(p01, p11)], subSt));
            S.add(ink([mid(p00, p01), mid(p10, p11)], subSt));
          }
          if(Math.random() < 0.22) S.add(hatchPoly([p00, p10, p11, p01], HATCH_A, clamp(pw * 0.28, 1.6, 3), { alpha: 0.34 * ds.a, width: 0.55 }));
        } else if(pw >= 1.6){
          S.add(ink([p00, p10, p11, p01, p00], rectSt));
        } else {
          S.add(ink([mid(p00, p10), mid(p01, p11)], rectSt));
        }
      }
    }
  }
  if(o.storefront && f === 'front' && b.y0 === 0 && FOCAL / b.z0 > 1.2){
    var bays = Math.max(1, Math.floor(Wf / 6)), bw = Wf / bays;
    for(var k = 0; k < bays; k++){
      var u0 = (k * bw + 0.8) / Wf, u1 = ((k + 1) * bw - 0.8) / Wf, v0 = 0.5 / Hf, v1 = 3.6 / Hf;
      var q = [fp(cam, fn, u0, v0), fp(cam, fn, u1, v0), fp(cam, fn, u1, v1), fp(cam, fn, u0, v1)];
      S.add(ink(q.concat([q[0]]), rectSt));
      S.add(inkLine(fp(cam, fn, u0, 2.8 / Hf), fp(cam, fn, u1, 2.8 / Hf), subSt));
    }
  }
}

function drawAwnings(S, cam, b, ds){
  var n = Math.max(1, Math.floor((b.x1 - b.x0) / 6)), bw = (b.x1 - b.x0) / n, st = sty(ds, COLOR.ink1, 0.9, 0.7, 0.4), stripe = sty(ds, COLOR.ink2, 0.6, 0.45, 0.3);
  for(var k = 0; k < n; k++){
    var xa = b.x0 + k * bw + 0.7, xb = b.x0 + (k + 1) * bw - 0.7;
    var q = [proj(cam, xa, 4.4, b.z0), proj(cam, xb, 4.4, b.z0), proj(cam, xb, 3.3, b.z0 - 1.4), proj(cam, xa, 3.3, b.z0 - 1.4)];
    S.mask(q);
    S.add(ink(q.concat([q[0]]), st));
    for(var i = 1; i < 5; i++){ var t = i / 5; S.add(inkLine([lerp(q[0][0], q[1][0], t), lerp(q[0][1], q[1][1], t)], [lerp(q[3][0], q[2][0], t), lerp(q[3][1], q[2][1], t)], stripe)); }
  }
}

function hangTendril(S, p, Lpx, s, ds){
  var drift = rand(-0.14, 0.14) * Lpx;
  S.add(ink([p, [p[0] + drift * 0.3, p[1] + Lpx * 0.4], [p[0] + drift, p[1] + Lpx * 0.85], [p[0] + drift * 1.1, p[1] + Lpx]],
    { color: COLOR.ink2, width: 0.8 * ds.w, jitter: 0.6 * ds.j, samples: 4, alpha: 0.6 * ds.a }));
  var leaves = clamp(Math.floor(Lpx / 5), 2, 14), lsz = clamp(s * 0.9, 1.6, 5.5);
  for(var i = 1; i <= leaves; i++){
    var t = i / (leaves + 1);
    S.add(leafMark(p[0] + drift * t + rand(-1.5, 1.5), p[1] + Lpx * t, rand(lsz * 0.7, lsz), rand(0, Math.PI * 2), COLOR.ink2, (0.5 + Math.random() * 0.2) * ds.a));
  }
}

function drawBalconies(S, cam, b, ds, s){
  var floors = Math.floor((b.y1 - 6) / 3.6), st = sty(ds, COLOR.ink1, 1.0, 0.75, 0.5), made = 0;
  for(var r = 2; r < floors - 1 && made < 3; r += 3 + randInt(0, 1)){
    var y = 4.8 + r * 3.6, x0 = b.x0 + 1.2, x1 = b.x1 - 1.2, zf = b.z0 - 0.9;
    var a = proj(cam, x0, y, zf), c = proj(cam, x1, y, zf);
    S.add(inkLine(proj(cam, x0, y, b.z0), a, st)).add(inkLine(a, c, st)).add(inkLine(c, proj(cam, x1, y, b.z0), st));
    S.add(inkLine(proj(cam, x0, y + 0.7, zf), proj(cam, x1, y + 0.7, zf), sty(ds, COLOR.ink1, 0.8, 0.6, 0.5)));
    for(var x = x0 + 0.6; x < x1; x += rand(1.6, 2.6)) hangTendril(S, proj(cam, x, y, zf), rand(2.5, 6.5) * s, s, ds);
    made++;
  }
}

// Shrubs and small trees standing on a roof or terrace, back to front.
function roofPlants(S, cam, x0, x1, z0, z1, y, spacing){
  if(x1 - x0 < 1.5 || z1 - z0 < 0.8) return;
  var pts = [];
  for(var x = x0 + spacing * 0.5; x < x1; x += spacing * rand(0.8, 1.2)) pts.push([x, rand(z0, z1), rand(0.9, 1.9)]);
  pts.sort(function(a, b){ return b[1] - a[1]; });
  pts.forEach(function(p){
    var s = FOCAL / p[1], ds = depthStyle(p[1]), r = p[2] * s;
    if(r < 0.9) return;
    var c = proj(cam, p[0], y + p[2] * 1.05, p[1]);
    S.add(canopyShape(c[0], c[1], r, r * 0.85, Math.round(clamp(r * r * 0.4, 4, 160)),
      { mask: true, contourWidth: 1.1 * ds.w, alphaMul: ds.a, sizeMin: clamp(r * 0.14, 1.1, 2.6), sizeMax: clamp(r * 0.24, 1.6, 4.5), leafWidth: 0.6 }));
  });
}

function drawSpire(S, cam, b, sh){
  var cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2, top = b.y1, ds = depthStyle(b.z0);
  var A = proj(cam, cx, top + sh, cz);
  var c = [[b.x0, b.z0], [b.x1, b.z0], [b.x1, b.z1], [b.x0, b.z1]].map(function(q){ return proj(cam, q[0], top, q[1]); });
  S.mask(convexHull(c.concat([A])));
  S.cur.items[S.cur.items.length - 1].z = b.z0;  // its depth, for a ball thrown at it
  var st = sty(ds, COLOR.ink1, 1.3, 0.85, 0.7);
  S.add(inkLine(A, c[0], st)).add(inkLine(A, c[1], st)).add(inkLine(c[0], c[1], st));
  if(b.x1 < 0){ S.add(inkLine(A, c[2], st)).add(inkLine(c[1], c[2], st)); S.add(hatchPoly([A, c[1], c[2]], HATCH_A, 2.8, { alpha: 0.3 * ds.a, width: 0.7 * ds.w })); }
  else if(b.x0 > 0){ S.add(inkLine(A, c[3], st)).add(inkLine(c[0], c[3], st)); S.add(hatchPoly([A, mid(c[0], c[1]), c[1]], HATCH_B, 3, { alpha: 0.25 * ds.a, width: 0.7 * ds.w })); }
  else S.add(hatchPoly([A, mid(c[0], c[1]), c[1]], HATCH_B, 3, { alpha: 0.25 * ds.a, width: 0.7 * ds.w }));
  S.add(inkLine(A, [A[0], A[1] - sh * 0.3 * FOCAL / cz], sty(ds, COLOR.ink1, 0.9, 0.8, 0.3)));
}

// A building is a stack of set-back tiers; each tier is its own group so the stack occludes itself correctly.
function buildBuilding(S, cam, bld){
  var boxes = [], prevH = 0, ins = 0, i;
  for(i = 0; i < bld.tiers.length; i++){
    ins += bld.tiers[i].inset || 0;
    var b = { x0: bld.x0 + ins, x1: bld.x1 - ins, z0: bld.z0 + ins, z1: bld.z1 - ins, y0: prevH, y1: bld.tiers[i].h };
    if(b.x1 - b.x0 < 3 || b.z1 - b.z0 < 3 || b.y1 <= b.y0) break;
    boxes.push(b);
    prevH = b.y1;
  }
  if(!boxes.length) return;
  var k = -1, order = [];
  for(i = 1; i < boxes.length; i++) if(boxes[i].y0 >= cam.eye){ k = i; break; }
  if(k < 0) for(i = 0; i < boxes.length; i++) order.push(i);
  else { for(i = boxes.length - 1; i >= k; i--) order.push(i); for(i = 0; i < k; i++) order.push(i); }
  order.forEach(function(idx){
    var b = boxes[idx], s = FOCAL / b.z0, ds = depthStyle(b.z0), top = idx === boxes.length - 1;
    S.begin(true);
    drawBox(S, cam, b, { hanging: bld.hanging && idx === 0 && boxes.length === 1, awnings: idx === 0 && s > 1.8 && bld.awnings, storefront: idx === 0 });
    if(idx > 0 && s > 0.5 && (bld.garden || bld.hanging)){
      var pb = boxes[idx - 1];
      if(pb.y1 < cam.eye) roofPlants(S, cam, pb.x0 + 0.6, pb.x1 - 0.6, pb.z0 + 0.5, b.z0 - 0.4, pb.y1, 3.2);
    }
    if(bld.hanging && b.y1 < cam.eye && s > 0.9){
      for(var x = b.x0 + 0.6; x < b.x1 - 0.4; x += rand(1.8, 2.8)) hangTendril(S, proj(cam, x, b.y1, b.z0), rand(2.5, 7) * s, s, ds);
    }
    if(top && bld.garden && b.y1 < cam.eye && s > 0.5) roofPlants(S, cam, b.x0 + 0.9, b.x1 - 0.9, b.z0 + 0.9, b.z1 - 0.9, b.y1, 4.5);
  });
  if(bld.spire){ S.begin(true); drawSpire(S, cam, boxes[boxes.length - 1], bld.spire); }
}

// Near trees are grown (tree.js); tiny distant ones are a trunk running into the middle of a leafy mass.
function parkTree(S, cam, x, z, r, ht){
  var s = FOCAL / z, ds = depthStyle(z), rpx = r * s;
  if(rpx < 0.8) return;
  var base = proj(cam, x, 0, z), cc = proj(cam, x, ht, z);
  if(rpx >= 6){
    buildTree(S, {
      base: base, top: proj(cam, x + rand(-0.15, 0.15) * r, ht - r * 0.95, z), cx: cc[0], cy: cc[1], rx: rpx, ry: rpx * 0.88,
      D: clamp(rpx * 0.12, 2, 11), attractors: Math.round(clamp(rpx * rpx * 0.05, 30, 500)), reach: 6, kill: 1.1, baseR: clamp(rpx * 0.075, 0.9, 14), tipR: 0.35,
      twig: 5, clumpR: clamp(rpx * 0.28, 3, 38), spacing: 0.75, density: rpx > 20 ? 0.05 : 0.09, leafMin: clamp(rpx * 0.04, 1.1, 4), leafMax: clamp(rpx * 0.075, 1.6, 6.5),
      mergeable: true, alpha: ds.a, width: ds.w, scale: s, cam: cam
    });
    return;
  }
  S.begin(true);
  S.add(canopyShape(cc[0], cc[1], rpx, rpx * 0.85, Math.round(clamp(rpx * rpx * 0.35, 3, 900)),
    { mask: true, contourWidth: 1.3 * ds.w, alphaMul: ds.a, sizeMin: clamp(rpx * 0.12, 1.2, 3), sizeMax: clamp(rpx * 0.22, 1.8, 6), leafWidth: 0.65 * ds.w }));
  S.add(inkLine(base, [cc[0], cc[1] + rpx * 0.15], sty(ds, COLOR.ink1, 1.1, 0.75, 0.4)));
}
