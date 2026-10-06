'use strict';
// Click to throw: a heavy ball is lobbed from the bottom centre of the view, arcs through the scene in perspective
// and smashes into whatever was clicked, blasting a facade, snapping a limb or thudding onto the terrace.
//
// The flight is a ballistic arc in the target's own camera space: straight-line progress from launch to target plus a
// parabolic rise, so the ball shrinks and slows as it flies away. Its world size is chosen so it leaves the bottom
// edge at BALL.r0 px and arrives a readable size, which also fixes the launch depth. It homes on a moving target
// (a swaying or falling limb), and at the moment of impact whatever is at the impact point takes the hit.
//
// Depth: things standing on the ground are nearer than the ball when their foot is lower on screen than the point
// on the ground under the ball. So the ball is drawn over everything while it is close to the viewer, and slips
// behind nearer buildings, hedges and trees as it flies deeper into the scene.

var balls = [];
var BALL = { r0: 20, maxFlying: 10, arc: 0.35, farZ: 1500, margin: 10 };

// The world point in camera cam that projects to screen (sx, sy) at depth z.
function worldAt(cam, sx, sy, z){ return [(sx - VP_X) * z / FOCAL, cam.eye - (sy - HORIZON_Y) * z / FOCAL, z]; }
// Depth of the ground seen at screen height y in camera cam (y must be below the horizon).
function groundZ(cam, y){ return FOCAL * cam.eye / Math.max(1e-3, y - HORIZON_Y); }

// A tree point's rest-frame position, undoing the pose of the piece holding it (or the sway of the standing tree).
function restOf(T, B, sx, sy){
  if(B){ var dx = sx - B.pos[0], dy = sy - B.pos[1], ca = Math.cos(B.th), sa = Math.sin(B.th); return [B.c[0] + ca * dx + sa * dy, B.c[1] - sa * dx + ca * dy]; }
  var g = T.sway;
  if(g && g.cur){ var a = swayAngle(g, sy), ex = sx - g.px, ey = sy - g.py, c = Math.cos(a), s = Math.sin(a); return [g.px + c * ex + s * ey, g.py - s * ex + c * ey]; }
  return [sx, sy];
}

// Where the aimed-at wood or leaves are on screen now: they may sway, fall, or be carried off by an earlier hit.
function trackTree(k){
  var T = k.T, p;
  if(k.n){ var st = segStart(k.n); p = [lerp(st.x, k.n.x, k.t), lerp(st.y, k.n.y, k.t)]; return placeAt(T, k.n.body, p[0], p[1]); }
  if(k.S){ p = [lerp(k.S.a[0], k.S.b[0], k.t), lerp(k.S.a[1], k.S.b[1], k.t)]; return placeAt(T, stubOwner(k.S), p[0], p[1]); }
  var c = k.c, r = c.rot || 0, ca = Math.cos(r), sa = Math.sin(r);
  return placeAt(T, c.body, c.x + ca * k.o[0] - sa * k.o[1], c.y + sa * k.o[0] + ca * k.o[1]);
}

// Does a disc at (x, y) of radius r touch walker wk's body (a segment from its feet, leaning as it falls)?
function walkerHit(wk, x, y, r){
  var th = wk.th || 0, ax = Math.sin(th), ay = -Math.cos(th), dx = x - wk.sx, dy = y - wk.sy;
  var t = clamp(dx * ax + dy * ay, 0, wk.hp), ex = dx - ax * t, ey = dy - ay * t;
  return ex * ex + ey * ey < (r + wk.hp * 0.22) * (r + wk.hp * 0.22);
}
// The nearest walker under a click (walkers are drawn over the ink, so they come first). The cursor pushes walkers
// away from itself, so a click also counts where the walker would be without that push; tiny ones get extra room.
// Returns the walker and the point on its drawn body that was aimed at.
function walkerAt(sx, sy){
  var best = null;
  walkers.forEach(function(wk){
    if(!wk.vis || wk.sx == null) return;
    var r = Math.max(3, 8 - 0.22 * wk.hp);
    [[sx, sy], [sx + wk.disp.x, sy + wk.disp.y]].forEach(function(at){
      var d = walkerGap(wk, at[0], at[1]);
      // the body the click is closest to wins (nearer walkers win ties)
      if(d < r && (!best || d < best.d - 0.5 || (Math.abs(d - best.d) <= 0.5 && wk.z < best.wk.z))) best = { wk: wk, at: at, d: d };
    });
  });
  return best;
}
// How far (x, y) is outside walker wk's body.
function walkerGap(wk, x, y){
  var th = wk.th || 0, ax = Math.sin(th), ay = -Math.cos(th), dx = x - wk.sx, dy = y - wk.sy;
  var t = clamp(dx * ax + dy * ay, 0, wk.hp);
  return Math.hypot(dx - ax * t, dy - ay * t) - wk.hp * 0.22;
}
// Where the aimed-at thing is on screen now, for homing (null if it doesn't move).
function aimPoint(aim){
  if(aim.track) return trackTree(aim.track);
  if(aim.walker) return [aim.walker.sx, aim.walker.sy];
  return null;
}

// What the ball is thrown at: the camera and depth it lands at, where to find the target as it moves, which layers
// could hide it (those drawn after `gi`, or all of them for a landing on the ground), and the ground under the impact.
function aimFor(h, sx, sy){
  var gi = -1, z, cam, pick = walkerAt(sx, sy);
  if(pick){
    var wk = pick.wk;
    cam = wk.spec.cam;
    return { kind: 'walker', cam: cam, z: wk.z, world: worldAt(cam, pick.at[0], pick.at[1], wk.z), walker: wk, gi: -1, ground: wk.sy };
  }
  if(h && h.tree){
    var th = h.tree, T = th.T, k = { T: T };
    if(th.kind === 'limb'){ k.n = th.n; k.S = th.S; k.t = th.t; }
    else {
      var c = th.clump, rp = restOf(T, c.body, sx, sy), r = -(c.rot || 0), dx = rp[0] - c.x, dy = rp[1] - c.y;
      k.c = c; k.o = [Math.cos(r) * dx - Math.sin(r) * dy, Math.sin(r) * dx + Math.cos(r) * dy];
    }
    T.grps.forEach(function(g){ gi = Math.max(gi, groups.indexOf(g)); });
    z = FOCAL / T.scale; cam = T.cam;
    return { kind: 'tree', cam: cam, z: z, world: worldAt(cam, sx, sy, z), track: k, gi: gi, ground: T.base[1], skip: T };
  }
  if(h && h.hit){
    var fr = faceFrame(h.hit.box, h.hit.face), P = unproject(h.hit.cam, h.hit.box, h.hit.face, sx, sy);
    if(P && isFinite(P[0]) && isFinite(P[1])){
      var w = fr.w(P[0], P[1], 0);
      if(w[2] > 1) return { kind: 'building', cam: h.hit.cam, z: w[2], world: w, gi: groups.indexOf(h.g), ground: sy };
    }
  }
  if(h && h.blocked){
    // Something solid that isn't a target (a lamp, the balustrade, the floor, a spire): the ball lands on it and drops
    // from there to its foot. Its depth is tagged (spires), or that of the nearest facade in its layer (balconies,
    // roof gardens), or else where its foot meets the ground.
    var m = h.mask, g0 = h.blocked, foot = m.floor ? sy : Math.max(sy, m.bb[3]), near = null, nd = Infinity;
    cam = g0.garden ? GARDEN_CAM : CITY_CAM;
    if(!g0.garden) g0.hits.forEach(function(hq){
      var q = polyBBox(hq.quad), d = Math.hypot(Math.max(q[0] - sx, 0, sx - q[2]), Math.max(q[1] - sy, 0, sy - q[3]));
      if(d < nd){ nd = d; near = hq; }
    });
    z = m.z || (near ? near.box.z0 : foot > HORIZON_Y + 2 ? Math.min(BALL.farZ, groundZ(cam, foot)) : BALL.farZ);
    return { kind: 'thud', cam: cam, z: z, world: worldAt(cam, sx, sy, z), gi: -1, ground: foot, skip: m.floor ? null : m };
  }
  // Open city: the street under the click, or off into the sky.
  cam = CITY_CAM;
  var street = sy > HORIZON_Y + 2 && groundZ(cam, sy) < BALL.farZ;
  z = street ? groundZ(cam, sy) : BALL.farZ;
  return { kind: street ? 'thud' : 'away', cam: cam, z: z, world: worldAt(cam, sx, sy, z), gi: -1, ground: sy };
}

function launchBall(sx, sy){
  if(balls.filter(function(b){ return !b.spent; }).length >= BALL.maxFlying) return;
  var aim = aimFor(hitTest(sx, sy), sx, sy), s = FOCAL / aim.z;
  var r1 = clamp(0.25 * s, 3, 10), R = r1 / s, z0 = Math.min(aim.z * 0.9, R * FOCAL / BALL.r0);
  var S = worldAt(aim.cam, VP_X, H + BALL.r0, z0), dist = Math.hypot(sx - VP_X, sy - H);
  var b = {
    aim: aim, S: S, R: R, t: 0, tf: clamp(0.45 + dist / 1500, 0.5, 1.0), spin: rand(0, Math.PI * 2), spinV: rand(8, 14) * randSign(),
    rise: 0, trail: [], spent: false, bowled: [],
    // Home from the aimed point as it was at launch: the ball lands on the click plus however far the target moved.
    q0: aimPoint(aim)
  };
  if(b.q0) b.q0 = b.q0.slice();
  // Rise at mid-flight chosen so the arc reads as about a third of the throw's length on screen, but never so high
  // that the ball leaves the top of the picture. Screen height is linear in the rise, so the limit is exact.
  var want = BALL.arc * dist * (z0 + aim.z) / 2 / FOCAL, limit = Infinity;
  for(var f = 0.05; f < 0.99; f += 0.05){
    var p = flightAt(b, f), zf = lerp(S[2], aim.world[2], f);
    limit = Math.min(limit, (p[1] - p[2] - BALL.margin) * zf / (FOCAL * 4 * f * (1 - f)));
  }
  b.rise = clamp(want, 0, Math.max(0, limit));
  balls.push(b);
  particles.push({ blast: { occ: null }, kind: 'dust', x: VP_X, y: H - 3, vx: 0, vy: -40, r: 6, grow: 22, age: 0, life: 0.6 });
}

// The ball's screen position and radius at flight fraction f (before homing).
function flightAt(b, f){
  var S = b.S, W = b.aim.world, z = lerp(S[2], W[2], f);
  var p = proj(b.aim.cam, lerp(S[0], W[0], f), lerp(S[1], W[1], f) + b.rise * 4 * f * (1 - f), z);
  return [p[0], p[1], b.R * FOCAL / z];
}

// Flight position including homing on a moving target.
function flyingPos(b){
  var f = Math.min(1, b.t / b.tf), p = flightAt(b, f);
  if(b.q0){
    var q = aimPoint(b.aim), e = f * f * (3 - 2 * f);
    p[0] += (q[0] - b.q0[0]) * e; p[1] += (q[1] - b.q0[1]) * e;
  }
  return p;
}

function updateBalls(dt){
  for(var i = balls.length - 1; i >= 0; i--){
    var b = balls[i];
    if(b.spent){
      if(stepSpent(b, dt)) balls.splice(i, 1);
      continue;
    }
    b.t += dt; b.spin += b.spinV * dt;
    b.pos = flyingPos(b);
    b.trail.unshift([b.pos[0], b.pos[1]]);
    if(b.trail.length > 7) b.trail.length = 7;
    bowl(b, b.trail.length > 1 ? b.trail[0][0] - b.trail[1][0] : 0, 1);
    if(b.t >= b.tf){
      try { smash(b); }
      catch(e){ b.spent = true; b.gone = true; if(window.console) console.error(e); }
    }
  }
}

// Anyone the ball passes through at its depth is bowled over, away from the way it is going; the ball carries on.
function bowl(b, vx, power){
  var zb = b.spent ? b.aim.z : lerp(b.S[2], b.aim.world[2], Math.min(1, b.t / b.tf)), r = b.pos[2], hit = false;
  walkers.forEach(function(wk){
    if(!wk.vis || wk.sx == null || wk.spec.cam !== b.aim.cam || b.bowled.indexOf(wk) >= 0 || (!b.spent && wk === b.aim.walker)) return;
    if(Math.abs(wk.z - zb) > 0.6 + b.R || !walkerHit(wk, b.pos[0], b.pos[1], r)) return;
    if(knockWalker(wk, Math.sign(vx) || Math.sign(wk.sx - b.pos[0]) || randSign(), power)){ b.bowled.push(wk); hit = true; }
  });
  return hit;
}

// Impact: whatever is at the impact point now takes the hit (it may no longer be what was aimed at).
function smash(b){
  var x = b.pos[0], y = b.pos[1], r = b.pos[2], h = hitTest(x, y), s = FOCAL / b.aim.z;
  // Velocity from the flight curve itself (independent of frame rate), and the arc's own gravity for what follows.
  var e = 0.02, p0 = flightAt(b, 1 - e), p1 = flightAt(b, 1), vx = (p1[0] - p0[0]) / (e * b.tf), vy = (p1[1] - p0[1]) / (e * b.tf);
  b.spent = true; b.age = 0; b.trail = [];
  b.g = Math.max(9.81, 8 * b.rise / (b.tf * b.tf)) * s;
  b.ground = b.aim.ground;
  var hop = Math.sqrt(2 * b.g * Math.max(4, r * 3));  // the most a rebound can carry it back up: a few ball-heights
  var wk = b.aim.walker;
  if(wk && wk.vis && walkerHit(wk, x, y, r + 2)){
    // Straight into the walker it was thrown at: over they go, and the ball drops at their feet (or, if they are
    // already lying there, just in front of them).
    var wasDown = !!wk.down;
    knockWalker(wk, Math.sign(vx) || Math.sign(wk.sx - x) || randSign(), 1.2);
    b.bowled.push(wk);
    b.vx = clamp(-vx * 0.2, -hop, hop); b.vy = -hop * rand(0.3, 0.5);
    b.ground = Math.max(y, wk.sy + (wasDown ? wk.hp * 0.25 + r : 0));
    return;
  }
  if(h && h.tree){
    shootTree(h.tree, x, y);
    // The ball glances off the wood and drops to the ground under the tree.
    b.vx = clamp(-vx * 0.25, -hop, hop); b.vy = -hop * rand(0.3, 0.6);
    b.ground = Math.max(y, h.tree.T.base[1] + rand(-0.2, 0.6) * s);
  } else if(h && h.hit){
    explode(h.g, h.hit, x, y);
    b.gone = true;  // buried in the wreckage
  } else if(b.aim.kind === 'away'){
    b.gone = true;  // lost in the distance
  } else if(!h && b.aim.kind !== 'thud'){
    b.vx = clamp(vx, -hop * 2, hop * 2); b.vy = clamp(vy, -hop, hop * 3);
    b.ground = Math.max(y + r, b.ground);  // what it was thrown at is gone: it sails on and drops
  } else {
    // A thud on the terrace or the street: a puff of dust, and the ball bounces on.
    var occ = ballOccluder(b, [x - r * 4, y - r * 4, x + r * 4, y + r * 4]), fx = { occ: occ };
    particles.push({ blast: fx, kind: 'dust', x: x, y: y, vx: 0, vy: -0.3 * s, r: r * 0.8, grow: r * 3, age: 0, life: 0.9 });
    particles.push({ blast: fx, kind: 'ring', x: x, y: y, r: r * 3, age: 0, life: 0.3 });
    b.vx = clamp(vx * 0.35, -hop, hop); b.vy = -hop * rand(0.4, 0.7);
    b.ground = Math.max(y, b.ground);
    blastImpulse(x, y, clamp(r * 6, 20, 60));
  }
}

// A spent ball bounces and rolls to a stop, then fades. Returns true when done.
function stepSpent(b, dt){
  b.age += dt;
  if(b.gone) return true;
  var s = FOCAL / b.aim.z, onGround = b.vy === 0 && b.pos[1] >= b.ground, sp = onGround ? Math.abs(b.vx) : Math.hypot(b.vx, b.vy);
  b.vy += b.g * dt;
  b.pos[0] += b.vx * dt; b.pos[1] += b.vy * dt;
  // Still rolling or bouncing with some speed, it bowls over anyone in the way (and loses some of that speed).
  if(sp > 0.3 * s && bowl(b, b.vx, clamp(sp / (3 * s), 0.4, 1))) b.vx *= 0.5;
  b.spin += b.vx / Math.max(1, b.pos[2]) * dt;
  if(b.pos[1] > b.ground){
    b.pos[1] = b.ground;
    if(b.vy > Math.sqrt(2 * b.g * 1.5)){ b.vy = -b.vy * 0.35; b.vx *= 0.8; }
    else { b.vy = 0; b.vx *= Math.pow(0.3, dt); }  // a heavy ball rolls on a good way before it stops
  }
  return b.age > 3.5;
}

// The ink in front of the ball near box: masks of layers drawn after the target's, as they are drawn right now,
// whose foot is nearer than the ground under the ball (lower on screen). null if nothing can hide it.
function ballOccluder(b, box){
  var zb = b.spent ? b.aim.z : lerp(b.S[2], b.aim.world[2], Math.min(1, b.t / b.tf)), gy = HORIZON_Y + FOCAL * b.aim.cam.eye / zb;
  if(gy > H + 40) return null;  // still close to the viewer: nothing stands in front of it
  var p = null, skip = b.aim.skip;
  for(var i = b.aim.gi + 1; i < groups.length; i++){
    var g = groups[i];
    if(!boxesOverlap(g.bb, box)) continue;
    for(var k = 0; k < g.masks.length; k++){
      var m = g.masks[k];
      if(m.floor || m === skip || (skip && m.tree === skip) || !boxesOverlap(m.bb, box)) continue;
      var foot = m.tree ? m.tree.base[1] : m.bb[3];
      if(foot <= gy + 2) continue;
      p = p || new Path2D();
      tracePoly(p, m, false);
      p.closePath();
    }
  }
  return p;
}

// An ink cannonball: a solid disc with a sketchy outline, hatching on the side away from the light, a band that
// turns as it spins, and speed lines trailing behind it while it flies. Returns how far its strokes reach.
function drawBall(ctx, b){
  var x = b.pos[0], y = b.pos[1], r = Math.max(1.2, b.pos[2]), a = b.spent ? clamp((3.5 - b.age) / 0.8, 0, 1) : 1, w = clamp(r * 0.09, 0.8, 1.8);
  var lx = -Math.SQRT1_2, ly = -Math.SQRT1_2;  // toward the light, upper left
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = COLOR.ink1;
  // Speed lines: short strokes leaving the back of the ball along its path, fading out behind it.
  if(!b.spent && b.trail.length > 2){
    var tr = b.trail, dx = tr[0][0] - tr[2][0], dy = tr[0][1] - tr[2][1], L = Math.hypot(dx, dy);
    if(L > r * 0.3){
      var ux = dx / L, uy = dy / L;
      ctx.lineWidth = Math.max(0.8, w * 0.85);
      [-0.55, 0, 0.55].forEach(function(k){
        var ox = -uy * k * r, oy = ux * k * r, back = r * Math.sqrt(1 - k * k);
        // Walk back along the trail from the rim until the line is long enough.
        var pts = [[x - ux * back + ox, y - uy * back + oy]], left = speedReach(r) * (1 - 0.35 * Math.abs(k));
        for(var i = 1; i < tr.length && left > 0; i++){
          var q = [tr[i][0] - ux * back + ox, tr[i][1] - uy * back + oy], p = pts[pts.length - 1], seg = Math.hypot(q[0] - p[0], q[1] - p[1]);
          if(seg <= 0.01) continue;
          if(seg > left){ var f = left / seg; q = [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f]; seg = left; }
          pts.push(q); left -= seg;
        }
        if(pts.length < 2) return;
        var e = pts[pts.length - 1], g = ctx.createLinearGradient(pts[0][0], pts[0][1], e[0], e[1]);
        g.addColorStop(0, hexToRgba(COLOR.ink1, 0.7 * a)); g.addColorStop(1, hexToRgba(COLOR.ink1, 0));
        ctx.strokeStyle = g; ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
        for(var j = 1; j < pts.length; j++) ctx.lineTo(pts[j][0], pts[j][1]);
        ctx.stroke();
      });
      ctx.strokeStyle = COLOR.ink1;
    }
  }
  // A solid ball: paper inside, so it hides the ink it passes in front of.
  ctx.globalAlpha = a;
  ctx.fillStyle = COLOR.paper;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  if(r > 3){
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.clip();
    // Hatching over the shadowed crescent (outside a lit disc shifted toward the light), crosshatched where deepest.
    var hatch = function(ang, lit, gap, alpha){
      ctx.save();
      ctx.beginPath(); ctx.rect(x - r - 2, y - r - 2, 2 * r + 4, 2 * r + 4); ctx.arc(x + lx * r * lit, y + ly * r * lit, r * (1 - lit * 0.35), 0, Math.PI * 2, true); ctx.clip();
      ctx.globalAlpha = alpha * a; ctx.lineWidth = Math.max(0.5, w * 0.6);
      var cx = Math.cos(ang), sy = Math.sin(ang);
      ctx.beginPath();
      for(var c = -r; c <= r; c += gap){ ctx.moveTo(x - sy * c - cx * r, y + cx * c - sy * r); ctx.lineTo(x - sy * c + cx * r, y + cx * c + sy * r); }
      ctx.stroke();
      ctx.restore();
    };
    hatch(Math.PI / 4, 0.3, Math.max(1.5, r * 0.17), 0.55);
    if(r > 6) hatch(-Math.PI / 4, 0.55, Math.max(1.8, r * 0.2), 0.4);
    // A band around the ball, turning with its spin.
    ctx.globalAlpha = 0.45 * a; ctx.lineWidth = Math.max(0.6, w * 0.7);
    ctx.beginPath(); ctx.ellipse(x, y, r * Math.max(0.06, Math.abs(Math.cos(b.spin))), r, 0.5, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    // A glint on the lit side.
    ctx.globalAlpha = 0.7 * a; ctx.lineWidth = Math.max(0.6, w * 0.6);
    ctx.beginPath(); ctx.arc(x, y, r * 0.62, Math.PI * 1.08, Math.PI * 1.42); ctx.stroke();
  }
  // Outline: heavier on the shadow side, drawn a little past a full turn like a pen circle.
  ctx.globalAlpha = 0.9 * a; ctx.lineWidth = w * 1.25;
  ctx.beginPath(); ctx.arc(x, y, r, -0.35, Math.PI * 0.95); ctx.stroke();
  ctx.lineWidth = w * 0.8;
  ctx.beginPath(); ctx.arc(x, y, r, Math.PI * 0.85, Math.PI * 2 - 0.2); ctx.stroke();
  ctx.restore();
}
function speedReach(r){ return Math.min(r * 4 + 16, 90); }

// Balls are drawn over the ink, minus whatever stands in front of them (drawn on the scratch layer and cut out).
function renderBalls(){
  balls.forEach(function(b){
    if(b.gone) return;
    if(!b.spent) b.pos = flyingPos(b);  // re-placed after this frame's sway and falls, so it rides its target exactly
    var r = Math.max(1.2, b.pos[2]), half = r + (b.spent ? 4 : speedReach(r) + 6);
    var box = [b.pos[0] - half, b.pos[1] - half, b.pos[0] + half, b.pos[1] + half], occ = ballOccluder(b, box);
    if(!occ){ drawBall(fctx, b); return; }
    var x0 = Math.max(0, Math.floor(box[0])), y0 = Math.max(0, Math.floor(box[1])), x1 = Math.min(W, Math.ceil(box[2])), y1 = Math.min(H, Math.ceil(box[3]));
    if(x1 <= x0 || y1 <= y0) return;
    sctx.clearRect(x0, y0, x1 - x0, y1 - y0);
    drawBall(sctx, b);
    sctx.save();
    sctx.globalCompositeOperation = 'destination-out';
    sctx.fill(occ);
    sctx.restore();
    fctx.drawImage(scratch, x0 * dpr, y0 * dpr, (x1 - x0) * dpr, (y1 - y0) * dpr, x0, y0, x1 - x0, y1 - y0);
    sctx.clearRect(x0, y0, x1 - x0, y1 - y0);
  });
}
