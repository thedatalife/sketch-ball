'use strict';
// Rendering, reveal, cursor field, sway, walkers, birds and the ambient loop.

var paperCanvas = document.getElementById('paper'), inkCanvas = document.getElementById('ink'), fxCanvas = document.getElementById('fx');
var canvasWrap = document.getElementById('canvasWrap');
var dpr = Math.min(window.devicePixelRatio || 1, 2);
[paperCanvas, inkCanvas, fxCanvas].forEach(function(c){ c.width = W * dpr; c.height = H * dpr; });
var paperCtx = paperCanvas.getContext('2d'), inkCtx = inkCanvas.getContext('2d'), fctx = fxCanvas.getContext('2d');
[paperCtx, inkCtx, fctx].forEach(function(c){ c.scale(dpr, dpr); });
var cacheCanvas = document.createElement('canvas');
cacheCanvas.width = W * dpr; cacheCanvas.height = H * dpr;
var cacheCtx = cacheCanvas.getContext('2d');
cacheCtx.scale(dpr, dpr);
var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function drawPaper(){
  paperCtx.save();
  paperCtx.fillStyle = COLOR.paper;
  paperCtx.fillRect(0, 0, W, H);
  var grad = paperCtx.createRadialGradient(W / 2, H * 0.45, H * 0.15, W / 2, H * 0.45, H * 0.85);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, hexToRgba(COLOR.paperShadow, 0.35));
  paperCtx.fillStyle = grad;
  paperCtx.fillRect(0, 0, W, H);
  for(var i = 0; i < 900; i++){
    paperCtx.fillStyle = Math.random() < 0.5 ? hexToRgba(COLOR.paperShadow, rand(0.05, 0.16)) : hexToRgba('#ffffff', rand(0.03, 0.08));
    var s = rand(0.4, 1.3);
    paperCtx.fillRect(rand(0, W), rand(0, H), s, s);
  }
  paperCtx.restore();
}

// ---------- scene preparation ----------
function itemsBBox(items){
  var b = [Infinity, Infinity, -Infinity, -Infinity];
  items.forEach(function(it){ var q = polyBBox(it.pts); b[0] = Math.min(b[0], q[0]); b[1] = Math.min(b[1], q[1]); b[2] = Math.max(b[2], q[2]); b[3] = Math.max(b[3], q[3]); });
  return b;
}

// Neighbouring groups that don't overlap on screen can share one mask pass and one set of strokes. Tree layers
// only share with other tree layers: a shot tree's pieces move, and must not end up in a pass with a facade.
function mergeGroups(groups){
  var out = [], cur = null, boxes = null;
  groups.forEach(function(g){
    if(!g.items.length) return;
    var bb = itemsBBox(g.items), isTree = !!g.items[0].tree;
    if(g.mergeable && cur && cur.mergeable && cur.isTree === isTree && !boxes.some(function(b){ return boxesOverlap(b, bb); })){
      for(var i = 0; i < g.items.length; i++) cur.items.push(g.items[i]);
      for(i = 0; i < g.hits.length; i++) cur.hits.push(g.hits[i]);
      boxes.push(bb);
    } else {
      cur = { items: g.items.slice(), mergeable: g.mergeable, hits: g.hits.slice(), isTree: isTree, garden: g.garden };
      boxes = [bb];
      out.push(cur);
    }
  });
  out.forEach(function(g){
    g.masks = g.items.filter(function(it){ return it.mask; });
    g.strokes = g.items.filter(function(it){ return !it.mask && it.pts.length > 1; });
    g.dynamic = g.items.some(function(it){ return it.animX; });
  });
  return out;
}

function initItem(it){
  it.dispX = new Float32Array(it.pts.length);
  it.dispY = new Float32Array(it.pts.length);
  it.bb = polyBBox(it.pts);
  it.moving = false;
}

// Strokes sharing a colour, width and (quantised) alpha are drawn with one path.
function bucketize(strokes){
  var map = {};
  strokes.forEach(function(s){
    var a = Math.round(s.alpha * 20) / 20, w = Math.round(s.width * 10) / 10, key = s.color + '|' + w + '|' + a;
    if(!map[key]) map[key] = { color: s.color, width: w, alpha: a, strokes: [] };
    map[key].strokes.push(s);
  });
  return Object.keys(map).map(function(k){ return map[k]; });
}

function prepareInteractive(groups){
  groups.forEach(function(g){
    g.items.forEach(initItem);
    g.buckets = bucketize(g.strokes);
    var bb = itemsBBox(g.items);
    g.bb = [bb[0] - 30, bb[1] - 30, bb[2] + 30, bb[3] + 30];
  });
}

// ---------- drawing ----------
function tracePoly(path, it, rest){
  var p = it.pts, dx = it.dispX, dy = it.dispY, ax = it.animX, ay = it.animY;
  if(dx && !rest){
    path.moveTo(p[0][0] + dx[0] + (ax ? ax[0] : 0), p[0][1] + dy[0] + (ay ? ay[0] : 0));
    for(var j = 1; j < p.length; j++) path.lineTo(p[j][0] + dx[j] + (ax ? ax[j] : 0), p[j][1] + dy[j] + (ay ? ay[j] : 0));
  } else {
    path.moveTo(p[0][0], p[0][1]);
    for(var k = 1; k < p.length; k++) path.lineTo(p[k][0], p[k][1]);
  }
}

// clip: optional screen box, or list of boxes; items whose (padded) bounds miss it are skipped entirely.
function inClip(it, clip){
  if(!clip) return true;
  var b = it.bb;
  if(typeof clip[0] === 'number') return b[0] - 30 < clip[2] && clip[0] < b[2] + 30 && b[1] - 30 < clip[3] && clip[1] < b[3] + 30;
  for(var i = 0; i < clip.length; i++){ var c = clip[i]; if(b[0] - 30 < c[2] && c[0] < b[2] + 30 && b[1] - 30 < c[3] && c[1] < b[3] + 30) return true; }
  return false;
}

function drawMasks(ctx, g, rest, clip){
  if(!g.masks.length) return;
  var path = new Path2D(), any = false;
  g.masks.forEach(function(m){ if(!(rest && m.live) && inClip(m, clip)){ tracePoly(path, m, rest); path.closePath(); any = true; } });
  if(!any) return;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#000';
  ctx.fill(path);
  ctx.restore();
}

function strokeBuckets(ctx, buckets, rest, clip){
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for(var i = 0; i < buckets.length; i++){
    var b = buckets[i], path = new Path2D(), any = false;
    for(var k = 0; k < b.strokes.length; k++){ var st = b.strokes[k]; if(!(rest && st.live) && inClip(st, clip)){ tracePoly(path, st, rest); any = true; } }
    if(!any) continue;
    ctx.strokeStyle = b.color;
    ctx.lineWidth = b.width;
    ctx.globalAlpha = b.alpha;
    ctx.stroke(path);
  }
  ctx.globalAlpha = 1;
}

// Blast holes, oldest first: cracks and soot are part of the facade, so they go down before any hole.
// Each hole erases everything inside its (displaceable) outline, older wreckage included, then draws its
// own interior clipped to that outline. Rubble sits in front of the wall and is drawn last.
function drawHoles(ctx, g, rest, clip){
  if(g.scarBuckets) strokeBuckets(ctx, g.scarBuckets, rest, clip);
  g.holes.forEach(function(h){
    if(!inClip(h, clip)) return;
    var hp = new Path2D();
    tracePoly(hp, h, rest);
    hp.closePath();
    ctx.save();
    ctx.clip(hp);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = 1;
    ctx.fill(hp);
    ctx.globalCompositeOperation = 'source-over';
    strokeBuckets(ctx, h.buckets, rest, clip);
    ctx.restore();
  });
  if(g.rubbleBuckets) strokeBuckets(ctx, g.rubbleBuckets, rest, clip);
}

// rest = ignore cursor displacement and animation (used to bake the static cache). Live items (a falling
// piece of tree, fell.js) are never baked: they are drawn only in the live pass, where they actually are.
function drawGroup(ctx, g, rest, clip){
  drawMasks(ctx, g, rest, clip);
  strokeBuckets(ctx, g.buckets, rest, clip);
  if(g.holes) drawHoles(ctx, g, rest, clip);
}

// ---------- cursor well ----------
var mouseX = -99999, mouseY = -99999, mouseInside = false;
var REST_SPEED_THRESHOLD = 15, SPEED_TO_RADIUS = 0.15, MAX_SPEED_BOOST = 90;
var PULSE_MAX_AMP = 70, PULSE_GROWTH_RATE = 6, PULSE_FREQ = 0.35;
var lastMX = 0, lastMY = 0, wasInside = false, smoothedSpeed = 0, restTime = 0, wellBoost = 0;

// The well swells with cursor speed and, when the cursor rests, pulses outward in ever larger beats.
function updateCursorWell(dt){
  if(!mouseInside){ wasInside = false; restTime = 0; smoothedSpeed = 0; wellBoost += -wellBoost * Math.min(1, dt * 4); return; }
  if(!wasInside){ lastMX = mouseX; lastMY = mouseY; wasInside = true; }
  var inst = Math.hypot(mouseX - lastMX, mouseY - lastMY) / Math.max(dt, 0.001);
  lastMX = mouseX; lastMY = mouseY;
  smoothedSpeed += (inst - smoothedSpeed) * Math.min(1, dt * 6);
  if(smoothedSpeed > REST_SPEED_THRESHOLD) restTime = 0; else restTime += dt;
  var raw = Math.sin(restTime * PULSE_FREQ * Math.PI * 2);
  var target = Math.min(MAX_SPEED_BOOST, smoothedSpeed * SPEED_TO_RADIUS) + (raw > 0 ? raw * Math.min(PULSE_MAX_AMP, restTime * PULSE_GROWTH_RATE) : 0);
  wellBoost += (target - wellBoost) * Math.min(1, dt * 4);
}

// Returns disjoint screen boxes covering all displaced static (non-swaying) ink.
function updatePhysics(groups){
  var r = INFLUENCE_R + wellBoost, rects = [];
  for(var gi = 0; gi < groups.length; gi++){
    var items = groups[gi].items, dyn = groups[gi].dynamic;
    for(var k = 0; k < items.length; k++){
      var it = items[k], bb = it.bb;
      // A falling piece isn't where its rest points are, so the cursor leaves it alone until it settles.
      var near = !it.live && mouseInside && mouseX > bb[0] - r && mouseX < bb[2] + r && mouseY > bb[1] - r && mouseY < bb[3] + r;
      if(!near && !it.moving) continue;
      var p = it.pts, dx = it.dispX, dy = it.dispY, maxd = 0;
      for(var i = 0; i < p.length; i++){
        var tx = 0, ty = 0;
        if(near){ pushTarget(p[i][0], p[i][1], mouseX, mouseY, r, MAX_PUSH, _pushTmp); tx = _pushTmp[0]; ty = _pushTmp[1]; }
        var rate = (tx * tx + ty * ty) > (dx[i] * dx[i] + dy[i] * dy[i]) ? 0.45 : 0.08;
        dx[i] += (tx - dx[i]) * rate;
        dy[i] += (ty - dy[i]) * rate;
        var m = Math.abs(dx[i]) + Math.abs(dy[i]);
        if(m > maxd) maxd = m;
      }
      it.moving = maxd > 0.03;
      if(!it.moving){ for(i = 0; i < p.length; i++){ dx[i] = 0; dy[i] = 0; } }
      else if(!dyn && !it.live){
        // Only segments touching a displaced vertex change: box those vertices and their neighbours.
        var box = [Infinity, Infinity, -Infinity, -Infinity], n = p.length, closeLoop = it.mask || it.hole;
        for(i = 0; i < n; i++){
          if(Math.abs(dx[i]) + Math.abs(dy[i]) < 0.02) continue;
          for(var o = -1; o <= 1; o++){
            var j = i + o;
            if(j < 0 || j >= n){ if(!closeLoop) continue; j = (j + n) % n; }
            var pd = o === 0 ? 30 : 3, q = p[j];
            if(q[0] - pd < box[0]) box[0] = q[0] - pd;
            if(q[1] - pd < box[1]) box[1] = q[1] - pd;
            if(q[0] + pd > box[2]) box[2] = q[0] + pd;
            if(q[1] + pd > box[3]) box[3] = q[1] + pd;
          }
        }
        if(box[0] < box[2]) addRect(rects, box);
      }
    }
  }
  return rects;
}

// ---------- sway ----------
var swayGroups = [];
function registerSway(items, pivot, heightRef, amp, freq){
  items.forEach(function(it){ it.animX = new Float32Array(it.pts.length); it.animY = new Float32Array(it.pts.length); });
  var g = { items: items, px: pivot[0], py: pivot[1], hr: heightRef, amp: amp, freq: freq, phase: rand(0, Math.PI * 2), cur: 0, ka: 0, kv: 0, lastT: null };
  swayGroups.push(g);
  return g;
}
// The bend angle the sway gives a point at height y (a point rotates about the pivot by this much).
function swayAngle(g, y){ var h = clamp((g.py - y) / g.hr, 0, 1.3); return g.cur * h * h; }
function updateSway(t){
  var e = Math.min(1, t / 1.2), ease = e * e * (3 - 2 * e);  // start from the rest pose the reveal ended on
  swayGroups.forEach(function(g){
    // Recoil: a damped spring on top of the breeze, kicked when a shot lands or a limb's weight is lost.
    var dt = g.lastT == null ? 0 : clamp(t - g.lastT, 0, 0.1), w = 2 * Math.PI * 0.85;
    g.lastT = t;
    if(g.ka || g.kv){
      g.kv += (-w * w * g.ka - 2 * 0.13 * w * g.kv) * dt;
      g.ka += g.kv * dt;
      if(Math.abs(g.ka) < 1e-5 && Math.abs(g.kv) < 1e-4){ g.ka = 0; g.kv = 0; }
    }
    var a0 = ease * (Math.sin(t * g.freq * Math.PI * 2 + g.phase) * g.amp + Math.sin(t * g.freq * 5.3 + g.phase * 2) * g.amp * 0.18) + g.ka;
    g.cur = a0;
    g.items.forEach(function(it){
      var p = it.pts, ax = it.animX, ay = it.animY;
      for(var i = 0; i < p.length; i++){
        var h = clamp((g.py - p[i][1]) / g.hr, 0, 1.3), a = a0 * h * h;
        var dx = p[i][0] - g.px, dy = p[i][1] - g.py, ca = Math.cos(a), sa = Math.sin(a);
        ax[i] = g.px + dx * ca - dy * sa - p[i][0];
        ay[i] = g.py + dx * sa + dy * ca - p[i][1];
      }
    });
  });
}

// ---------- walkers: entities walking in world space, drawn fresh each frame ----------
var walkers = [];
function makeWalker(spec){
  var span = spec.b - spec.a;
  return { spec: spec, pos: spec.a + Math.random() * span, dir: randSign(), speed: rand(0.9, 1.4) * (spec.speedMul || 1), phase: Math.random(), stride: rand(1.4, 1.9), disp: { x: 0, y: 0 },
    down: null, kx: 0, ky: 0, flee: 0, hatOff: false, vis: false };
}

// Knocked over (by a thrown ball): the walker topples about its feet toward dir, flailing, is shoved along and hops a
// little, bounces once on landing, lies there a few seconds, then gets up and hurries off. power scales the shove.
// A detailed walker's hat flies off. Hitting someone already down keeps them down a little longer.
function knockWalker(wk, dir, power){
  if(!wk.vis) return false;
  var d = wk.down;
  if(d){
    d.lie += 0.8;
    if(d.stage === 'rise'){ d.stage = 'fall'; d.w = d.dir * 2; d.t = 0; }
    return true;
  }
  wk.down = { stage: 'fall', dir: dir, th: 0, w: dir * rand(2.8, 4.2) * power, t: 0, age: 0, lie: rand(2.5, 4.5),
    kxT: dir * wk.hp * rand(0.3, 0.6) * power, hop: wk.hp * 0.15 * power };
  if(wk.spec.cam === GARDEN_CAM && !wk.hatOff){
    // Off comes the hat: its outline (as drawFigure draws it) spun away as a fragment that falls and lands.
    var hR = wk.hp * 0.075, s = FOCAL / wk.z, hx = wk.sx, hy = wk.sy - wk.hp * 0.95;
    var pts = [[-hR * 0.8, hR * 0.4], [-hR * 0.6, -hR * 0.4], [hR * 0.7, -hR * 0.4], [hR * 0.8, hR * 0.4], [hR * 1.5, hR * 0.45], [-hR * 1.5, hR * 0.45], [-hR * 0.8, hR * 0.4]];
    particles.push({ blast: { occ: null }, kind: 'frag', pts: pts, x: hx, y: hy, vx: dir * rand(1, 2.2) * s, vy: -rand(2, 3.5) * s, rot: 0, vr: dir * rand(6, 12),
      color: COLOR.ink1, width: Math.max(0.8, wk.hp / 42) * 0.8, alpha: 0.75, age: 0, life: 4.5, ground: wk.sy + rand(-0.05, 0.1) * s, g: 9.81 * s, bounce: 0 });
    wk.hatOff = true;
  }
  return true;
}

// Advance a downed walker; returns its lean (radians, clockwise positive) and moves its knock offset (kx, ky).
function stepDown(wk, dt){
  var d = wk.down;
  d.t += dt; d.age += dt;
  if(d.stage === 'fall'){
    // A body toppling about its feet: gravity's torque on a rod pivoting at one end (3g/2L for a ~1.75 m person).
    d.w += d.dir * 8.4 * Math.max(0.05, Math.sin(Math.abs(d.th))) * dt;
    d.th += d.w * dt;
    wk.phase = (wk.phase + dt * 3.5) % 1;  // arms and legs flail
    if(d.th * d.dir >= Math.PI / 2){
      d.th = d.dir * Math.PI / 2;
      if(Math.abs(d.w) > 1.2) d.w = -d.w * 0.25;  // a small bounce off the ground
      else { d.stage = 'lie'; d.t = 0; d.w = 0; }
    }
  } else if(d.stage === 'lie'){
    if(d.t > d.lie){
      d.stage = 'rise'; d.t = 0; wk.kx = d.kxT;
      // They get up where they fell: a walker crossing sideways takes the shove as ground covered on its path.
      var sp = wk.spec;
      if(sp.axis === 'x'){
        var np = clamp(wk.pos + wk.kx * wk.z / FOCAL, sp.a, sp.b);
        wk.kx -= (np - wk.pos) * FOCAL / wk.z; wk.pos = np; d.kxT = wk.kx;
      }
    }
  } else {
    var u = Math.min(1, d.t / 0.9), e = u * u * (3 - 2 * u);
    d.th = d.dir * (Math.PI / 2 * (1 - e) - 0.1 * Math.sin(u * Math.PI));  // up, with a little stagger past upright
    if(u >= 1){ wk.down = null; wk.ky = 0; wk.hatOff = false; wk.flee = 3; return 0; }
    return d.th;
  }
  wk.kx += (d.kxT - wk.kx) * Math.min(1, dt * 8);
  wk.ky = d.age < 0.35 ? -d.hop * Math.sin(Math.PI * d.age / 0.35) : 0;
  return d.th;
}

var wctx = fctx, wbox = null;  // where walkers are drawn (fx, or scratch when something may hide them), and their extent
function strokeLines(lines, width, alpha){
  wctx.lineWidth = width; wctx.globalAlpha = alpha; wctx.strokeStyle = COLOR.ink1; wctx.lineCap = 'round'; wctx.lineJoin = 'round';
  wctx.beginPath();
  lines.forEach(function(l){ wctx.moveTo(l[0][0], l[0][1]); for(var i = 1; i < l.length; i++) wctx.lineTo(l[i][0], l[i][1]); });
  wctx.stroke();
}

function drawFigure(fx, fy, hp, phase, axis, dir, detailed, hatless, noShadow){
  var a = phase * Math.PI * 2, hipY = fy - hp * 0.53 - Math.abs(Math.cos(a)) * hp * 0.015;
  var shoulder = [fx + (axis === 'x' ? dir * hp * 0.03 : 0), hipY - hp * 0.29], headR = hp * 0.075;
  var head = [shoulder[0] + (axis === 'x' ? dir * hp * 0.015 : 0), shoulder[1] - hp * 0.11], lines = [], w = Math.max(0.8, hp / 42);
  if(axis === 'x'){
    [0, Math.PI].forEach(function(off){
      var sw = 0.42 * Math.sin(a + off), bend = 0.7 * Math.max(0, Math.cos(a + off));
      var knee = [fx + Math.sin(sw) * hp * 0.26 * dir, hipY + Math.cos(sw) * hp * 0.26];
      var foot = [knee[0] + Math.sin(sw - bend) * hp * 0.26 * dir, knee[1] + Math.cos(sw - bend) * hp * 0.26];
      lines.push([[fx, hipY], knee, foot, [foot[0] + dir * hp * 0.05, foot[1]]]);
      var as = -0.38 * Math.sin(a + off), elbow = [shoulder[0] + Math.sin(as) * hp * 0.16 * dir, shoulder[1] + Math.cos(as) * hp * 0.16];
      lines.push([shoulder, elbow, [elbow[0] + Math.sin(as + 0.35) * hp * 0.14 * dir, elbow[1] + Math.cos(as + 0.35) * hp * 0.14]]);
    });
  } else {
    [-1, 1].forEach(function(side, idx){
      var lift = Math.max(0, Math.sin(a + idx * Math.PI)) * hp * 0.07;
      lines.push([[fx + side * hp * 0.03, hipY], [fx + side * hp * 0.045, hipY + hp * 0.27 - lift * 0.5], [fx + side * hp * 0.05, fy - lift]]);
      var swing = Math.sin(a + idx * Math.PI) * hp * 0.03;
      lines.push([[shoulder[0] + side * hp * 0.07, shoulder[1]], [shoulder[0] + side * hp * 0.1, shoulder[1] + hp * 0.16 + swing], [shoulder[0] + side * hp * 0.1, shoulder[1] + hp * 0.3 + swing]]);
    });
    lines.push([[shoulder[0] - hp * 0.08, shoulder[1]], [shoulder[0] + hp * 0.08, shoulder[1]]]);
    lines.push([[fx - hp * 0.05, hipY], [fx + hp * 0.05, hipY]]);
  }
  lines.push([[fx, hipY], shoulder, [head[0], head[1] + headR]]);
  strokeLines(lines, w, 0.8);
  wctx.beginPath(); wctx.arc(head[0], head[1], headR, 0, Math.PI * 2); wctx.stroke();
  wbox = unionBox(wbox, [fx - hp * 0.4, fy - hp * 1.1, fx + hp * 0.4, fy + hp * 0.1]);
  if(detailed && !hatless) strokeLines([[[head[0] - headR * 1.5, head[1] - headR * 0.55], [head[0] + headR * 1.5, head[1] - headR * 0.55]], [[head[0] - headR * 0.8, head[1] - headR * 0.6], [head[0] - headR * 0.6, head[1] - headR * 1.4], [head[0] + headR * 0.7, head[1] - headR * 1.4], [head[0] + headR * 0.8, head[1] - headR * 0.6]]], w * 0.8, 0.75);
  if(detailed && !noShadow){
    var sh = [];
    for(var i = -2; i <= 2; i++) sh.push([[fx - hp * 0.16 + Math.abs(i) * hp * 0.03, fy + i * hp * 0.012 + 1], [fx + hp * 0.2 - Math.abs(i) * hp * 0.03, fy + i * hp * 0.012 + 1]]);
    strokeLines(sh, 0.7, 0.25);
  }
  wctx.globalAlpha = 1;
}

function updateWalker(wk, dt){
  var sp = wk.spec, cam = sp.cam;
  if(!wk.down){
    // After being knocked over, a walker hurries on for a few seconds.
    var hurry = wk.flee > 0 ? 2.2 : 1;
    wk.flee = Math.max(0, wk.flee - dt);
    wk.pos += wk.dir * wk.speed * hurry * dt;
    if(wk.pos > sp.b){ wk.pos = sp.b; wk.dir = -1; }
    if(wk.pos < sp.a){ wk.pos = sp.a; wk.dir = 1; }
    wk.phase = (wk.phase + dt * wk.stride * hurry) % 1;
    wk.kx *= Math.pow(0.3, dt);  // what's left of a shove: they drift back onto their path as they walk
  }
  var x = sp.axis === 'x' ? wk.pos : sp.fixed, z = sp.axis === 'x' ? sp.fixed : wk.pos;
  var feet = proj(cam, x, 0, z), hp = sp.h * FOCAL / z;
  wk.z = z; wk.hp = hp; wk.vis = !(sp.maxY && feet[1] > sp.maxY);
  if(!wk.vis) return;
  var tx = 0, ty = 0;
  if(mouseInside){
    var lean = wk.th || 0, bx = feet[0] + wk.kx + Math.sin(lean) * hp / 2, by = feet[1] + wk.ky - Math.cos(lean) * hp / 2;
    pushTarget(bx, by, mouseX, mouseY, WALKER_INFLUENCE_R + wellBoost, WALKER_MAX_PUSH, _pushTmp); tx = _pushTmp[0]; ty = _pushTmp[1];
  }
  springToward(wk.disp, tx, ty);
  var th = wk.down ? stepDown(wk, dt) : 0, fx = feet[0] + wk.disp.x + wk.kx, fy = feet[1] + wk.disp.y + wk.ky;
  wk.sx = fx; wk.sy = fy; wk.th = th;
  if(th){ wctx.save(); wctx.translate(fx, fy); wctx.rotate(th); wctx.translate(-fx, -fy); }
  drawFigure(fx, fy, hp, wk.phase, sp.axis, wk.dir, cam === GARDEN_CAM, wk.hatOff, Math.abs(th) > 0.05);
  if(th){ wctx.restore(); wbox = unionBox(wbox, [fx - hp * 1.2, fy - hp * 1.2, fx + hp * 1.2, fy + hp * 0.3]); }
}

// ---------- birds ----------
var activeBirds = [], nextBirdAt = 0;
function drawBird(bt, y0){
  var x = -40 + (W + 80) * bt, y = y0 - Math.sin(bt * Math.PI) * 16, alpha = 0.6, wing = Math.sin(bt * 46) * 4;
  if(bt < 0.15) alpha *= bt / 0.15;
  if(bt > 0.85) alpha *= (1 - bt) / 0.15;
  fctx.save();
  fctx.globalAlpha = alpha; fctx.strokeStyle = COLOR.ink1; fctx.lineWidth = 1.2; fctx.lineCap = 'round';
  fctx.beginPath(); fctx.moveTo(x - 8, y); fctx.quadraticCurveTo(x - 4, y - 6 - wing, x, y); fctx.quadraticCurveTo(x + 4, y - 6 - wing, x + 8, y); fctx.stroke();
  fctx.restore();
}
function renderFx(dt, now){
  fctx.clearRect(0, 0, W, H);
  if(now > nextBirdAt){ activeBirds.push({ t0: now, dur: rand(3800, 5600), y0: rand(60, 200) }); nextBirdAt = now + rand(4500, 9500); }
  for(var i = activeBirds.length - 1; i >= 0; i--){
    var bt = (now - activeBirds[i].t0) / activeBirds[i].dur;
    if(bt >= 1){ activeBirds.splice(i, 1); continue; }
    drawBird(bt, activeBirds[i].y0);
  }
  walkers.sort(function(a, b){ return (b.spec.axis === 'x' ? b.spec.fixed : b.pos) - (a.spec.axis === 'x' ? a.spec.fixed : a.pos); });
  // Walkers sit above all the ink. Once a garden tree (nearer than any walker) has been shot, its pieces may lie in
  // front of them, so they are drawn on the (clean) scratch layer and that tree's outline where they are is cut out.
  var hide = trees.some(function(T){ return T.sway && T.shot; });
  wbox = null;
  if(hide) wctx = sctx;
  walkers.forEach(function(wk){ updateWalker(wk, dt); });
  wctx = fctx;
  if(!hide || !wbox) return;
  var x0 = Math.max(0, Math.floor(wbox[0] - 4)), y0 = Math.max(0, Math.floor(wbox[1] - 4)), x1 = Math.min(W, Math.ceil(wbox[2] + 4)), y1 = Math.min(H, Math.ceil(wbox[3] + 4));
  if(x1 > x0 && y1 > y0){
    var occ = walkerOccluder([x0, y0, x1, y1]);
    if(occ){
      sctx.save();
      sctx.globalCompositeOperation = 'destination-out';
      sctx.globalAlpha = 1;
      sctx.fill(occ);
      sctx.restore();
    }
    fctx.drawImage(scratch, x0 * dpr, y0 * dpr, (x1 - x0) * dpr, (y1 - y0) * dpr, x0, y0, x1 - x0, y1 - y0);
    sctx.clearRect(x0, y0, x1 - x0, y1 - y0);
  }
}

// The shot garden trees' outlines, as they are now, where they could cover a walker.
function walkerOccluder(box){
  var p = null;
  trees.forEach(function(T){
    if(!T.sway || !T.shot) return;
    T.items.forEach(function(m){ if(m.mask && boxesOverlap(pad(m.bb, 30), box)){ p = p || new Path2D(); tracePoly(p, m, false); p.closePath(); } });
  });
  return p;
}
