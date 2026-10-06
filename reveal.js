'use strict';
// Splash reveal: ink lands in splashes. Each splash bursts outward from an impact point and every
// stroke in it springs to rest along an underdamped curve, overshooting slightly and wobbling to a stop.
//
//   impact time      T_k   = SPAN * u^1.35,  u = 0.62*depth + 0.38*massRank + noise   (big + far land first)
//   stroke start     t_i   = T_k + |c_i - c_k| / WAVE                                 (a shockwave from the impact)
//   scale about c_k  g(tau)= 1 - (1-G0) * e^(-beta*tau) * cos(omega*tau)               (burst, overshoot, settle)
//   drawn length     L(tau)= L_i * (1 - e^(-tau/tr_i))                                 (shoots out, creeps to the end)
//   settled when     tau  >= max(5.3*tr_i, ln(D_i/0.25)/beta)                          (every point within 0.25px of rest)

// G0: a splash starts at this fraction of its final size, so a whole splash never collapses to one dark dot.
var REVEAL = { span: 1.55, wave: 1600, cell: 220, bakeEvery: 0.12, g0: 0.35 };
var baseCanvas = document.createElement('canvas'), settledCanvas = document.createElement('canvas');
[baseCanvas, settledCanvas].forEach(function(c){ c.width = W * dpr; c.height = H * dpr; c.getContext('2d').scale(dpr, dpr); });
var baseCtx = baseCanvas.getContext('2d'), settledCtx = settledCanvas.getContext('2d');

function buildSplashes(groups){
  var map = {}, list = [], G = groups.length;
  groups.forEach(function(g, gi){
    g.totalLen = 0; g.doneLen = 0; g.doneCount = 0;
    g.strokes.forEach(function(s){
      var p = s.pts, a = p[0], b = p[p.length - 1], m = p[p.length >> 1];
      s.cx = (a[0] + b[0] + m[0]) / 3; s.cy = (a[1] + b[1] + m[1]) / 3; s.g = g;
      var key = gi + ':' + Math.floor(s.cx / REVEAL.cell) + ':' + Math.floor(s.cy / REVEAL.cell), sp = map[key];
      if(!sp){ sp = map[key] = { gi: gi, mass: 0, sx: 0, sy: 0, strokes: [] }; list.push(sp); }
      var w = s.len + 1;
      sp.mass += w; sp.sx += s.cx * w; sp.sy += s.cy * w; sp.strokes.push(s);
      g.totalLen += s.len;
    });
  });
  var byMass = list.slice().sort(function(a, b){ return b.mass - a.mass; });
  byMass.forEach(function(sp, r){ sp.massRank = byMass.length > 1 ? r / (byMass.length - 1) : 0; });
  list.forEach(function(sp){
    sp.cx = sp.sx / sp.mass + rand(-18, 18);
    sp.cy = sp.sy / sp.mass + rand(-18, 18);
    var u = clamp(0.62 * (G > 1 ? sp.gi / (G - 1) : 0) + 0.38 * sp.massRank + rand(-0.1, 0.1), 0, 1);
    sp.T = REVEAL.span * Math.pow(u, 1.35) + rand(0, 0.1);
    // beta/omega ~ 0.77-0.91 keeps the overshoot to a jiggle: first swing past rest is e^(-pi*beta/omega)*(1-G0), about 4-6%.
    var beta = rand(10, 13);
    sp.strokes.forEach(function(s){
      s.sp = sp;
      s.t0 = sp.T + Math.hypot(s.cx - sp.cx, s.cy - sp.cy) / REVEAL.wave + rand(0, 0.04);
      s.beta = beta * rand(0.93, 1.07);
      s.omega = s.beta * rand(1.1, 1.3);
      s.tr = clamp(0.02 + 0.00025 * s.len, 0.02, 0.08);
      var D = 1;
      for(var i = 0; i < s.pts.length; i++) D = Math.max(D, Math.hypot(s.pts[i][0] - sp.cx, s.pts[i][1] - sp.cy));
      // Done only when both the undrawn tail and the distance from rest are under 0.25px.
      s.tDone = Math.max(s.tr * Math.log(Math.max(1.01, s.len / 0.25)), Math.log(Math.max(1.01, D * (1 - REVEAL.g0) / 0.25)) / s.beta);
      s.done = false;
    });
  });
  return list;
}

// In-flight strokes are batched by style across all groups.
function globalBuckets(groups){
  var map = {}, list = [];
  groups.forEach(function(g){
    g.buckets.forEach(function(b){
      var key = b.color + '|' + b.width + '|' + b.alpha, idx = map[key];
      if(idx == null){ idx = map[key] = list.length; list.push({ color: b.color, width: b.width, alpha: b.alpha }); }
      b.strokes.forEach(function(s){ s.gb = idx; });
    });
  });
  return list;
}

function traceFlying(path, s, tau){
  var sp = s.sp, cx = sp.cx, cy = sp.cy, p = s.pts;
  var g = 1 - (1 - REVEAL.g0) * Math.exp(-s.beta * tau) * Math.cos(s.omega * tau), target = s.len * (1 - Math.exp(-tau / s.tr)), acc = 0;
  path.moveTo(cx + (p[0][0] - cx) * g, cy + (p[0][1] - cy) * g);
  for(var i = 1; i < p.length; i++){
    var seg = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
    if(acc + seg >= target){
      var f = seg > 0 ? (target - acc) / seg : 1;
      path.lineTo(cx + (p[i - 1][0] + (p[i][0] - p[i - 1][0]) * f - cx) * g, cy + (p[i - 1][1] + (p[i][1] - p[i - 1][1]) * f - cy) * g);
      return;
    }
    acc += seg;
    path.lineTo(cx + (p[i][0] - cx) * g, cy + (p[i][1] - cy) * g);
  }
}

// Groups not yet complete: settled strokes only, with the group's occluding mask fading in as it fills.
function drawGroupSettled(ctx, g){
  if(!g.doneCount) return;
  var frac = g.totalLen > 0 ? g.doneLen / g.totalLen : 1;
  if(g.masks.length){
    var mp = new Path2D();
    g.masks.forEach(function(m){ tracePoly(mp, m, true); mp.closePath(); });
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = frac;
    ctx.fill(mp);
    ctx.restore();
  }
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  g.buckets.forEach(function(b){
    var path = new Path2D(), any = false;
    b.strokes.forEach(function(s){ if(s.done){ tracePoly(path, s, true); any = true; } });
    if(!any) return;
    ctx.strokeStyle = b.color; ctx.lineWidth = b.width; ctx.globalAlpha = b.alpha;
    ctx.stroke(path);
  });
  ctx.globalAlpha = 1;
}

// Transient spray flung from each impact; purely decorative, gone before the render completes.
function spawnSpray(sp, t, spray){
  var k = clamp(Math.sqrt(sp.mass) / 120, 0.35, 1.4), n = Math.round(clamp(Math.sqrt(sp.mass) / 5, 3, 22));
  for(var i = 0; i < n; i++) spray.push({ x: sp.cx, y: sp.cy, a: rand(0, Math.PI * 2), v: rand(250, 900) * k, t0: t, life: rand(0.25, 0.5), w: rand(0.8, 2.2) });
  if(sp.mass > 600) spray.push({ ring: true, x: sp.cx, y: sp.cy, r: 40 + 60 * k, t0: t, life: 0.3 });
}

function renderSpray(spray, t){
  fctx.clearRect(0, 0, W, H);
  fctx.strokeStyle = COLOR.ink1; fctx.fillStyle = COLOR.ink1; fctx.lineCap = 'round';
  for(var i = spray.length - 1; i >= 0; i--){
    var d = spray[i], tau = t - d.t0;
    if(tau > d.life){ spray.splice(i, 1); continue; }
    var fade = 1 - tau / d.life;
    if(d.ring){
      fctx.globalAlpha = 0.28 * fade; fctx.lineWidth = 1;
      fctx.beginPath(); fctx.arc(d.x, d.y, 6 + d.r * (1 - Math.exp(-12 * tau)), 0, Math.PI * 2); fctx.stroke();
      continue;
    }
    var r1 = d.v / 9 * (1 - Math.exp(-9 * tau)), r0 = d.v / 9 * (1 - Math.exp(-9 * Math.max(0, tau - 0.035)));
    var ca = Math.cos(d.a), sa = Math.sin(d.a);
    fctx.globalAlpha = 0.7 * fade; fctx.lineWidth = d.w;
    fctx.beginPath(); fctx.moveTo(d.x + ca * r0, d.y + sa * r0); fctx.lineTo(d.x + ca * r1, d.y + sa * r1); fctx.stroke();
    fctx.beginPath(); fctx.arc(d.x + ca * r1, d.y + sa * r1, d.w * 0.7, 0, Math.PI * 2); fctx.fill();
  }
  fctx.globalAlpha = 1;
}

function runSplashReveal(groups, onDone){
  var splashes = buildSplashes(groups), gb = globalBuckets(groups), all = [];
  groups.forEach(function(g){ g.strokes.forEach(function(s){ all.push(s); }); });
  all.sort(function(a, b){ return a.t0 - b.t0; });
  splashes.sort(function(a, b){ return a.T - b.T; });
  baseCtx.clearRect(0, 0, W, H);
  settledCtx.clearRect(0, 0, W, H);
  // landed: strokes that reached rest since the last settled rebuild; drawn at rest until the rebuild includes them.
  var next = 0, si = 0, prefix = 0, flying = [], landed = [], spray = [], lastBake = -1, stale = false, t = 0, last = null;

  function step(now){
    // A clamped clock: after a stall or a hidden tab the reveal resumes where it was instead of skipping ahead.
    t += last == null ? 0 : Math.min(now - last, 50) / 1000;
    last = now;
    var i;
    while(next < all.length && all[next].t0 <= t) flying.push(all[next++]);
    while(si < splashes.length && splashes[si].T <= t){ var sp = splashes[si++]; if(t - sp.T < 0.1) spawnSpray(sp, sp.T, spray); }

    var keep = [];
    for(i = 0; i < flying.length; i++){
      var s = flying[i];
      if(t - s.t0 >= s.tDone){ s.done = true; s.g.doneCount++; s.g.doneLen += s.len; stale = true; landed.push(s); }
      else keep.push(s);
    }
    flying = keep;

    // Groups complete in depth order are baked permanently, so the finished image is exact.
    while(prefix < groups.length && groups[prefix].doneCount === groups[prefix].strokes.length){ drawGroup(baseCtx, groups[prefix], true); prefix++; stale = true; }
    var finished = next >= all.length && !flying.length;
    if(stale && (finished || t - lastBake >= REVEAL.bakeEvery)){
      settledCtx.clearRect(0, 0, W, H);
      settledCtx.drawImage(baseCanvas, 0, 0, W, H);
      for(i = prefix; i < groups.length; i++) drawGroupSettled(settledCtx, groups[i]);
      lastBake = t; stale = false; landed = [];
    }

    inkCtx.clearRect(0, 0, W, H);
    inkCtx.drawImage(settledCanvas, 0, 0, W, H);
    var paths = new Array(gb.length);
    for(i = 0; i < landed.length; i++){ var L = landed[i]; tracePoly(paths[L.gb] || (paths[L.gb] = new Path2D()), L, true); }
    for(i = 0; i < flying.length; i++){
      var f = flying[i];
      traceFlying(paths[f.gb] || (paths[f.gb] = new Path2D()), f, t - f.t0);
    }
    inkCtx.lineCap = 'round'; inkCtx.lineJoin = 'round';
    for(i = 0; i < gb.length; i++){
      if(!paths[i]) continue;
      inkCtx.strokeStyle = gb[i].color; inkCtx.lineWidth = gb[i].width; inkCtx.globalAlpha = gb[i].alpha;
      inkCtx.stroke(paths[i]);
    }
    inkCtx.globalAlpha = 1;
    renderSpray(spray, t);

    if(finished && prefix >= groups.length && !spray.length){ onDone(); return; }
    revealRaf = requestAnimationFrame(step);
  }
  revealRaf = requestAnimationFrame(step);
}
