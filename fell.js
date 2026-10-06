'use strict';
// Shooting trees. A shot cuts the limb under the cursor. The part beyond the cut hangs on its torn fibres for a
// moment, then tears free and falls as a rigid body: gravity swings it about the break, the air through its leaves
// slows it, and it lands, bounces, slides and rolls to rest, snapping side branches off when it lands hard and
// shedding leaves that flutter down. Everything is in screen pixels at the tree's depth with gravity scaled by the
// tree's pixels per metre, so a distant park tree falls exactly like a near one, only smaller and slower on screen.
//
// A piece ("body") keeps its ink in the tree's own layers, so it stays in depth order; each frame its points get a
// rigid transform (plus a little flex) written into their animation offsets. Once it comes to rest the transform is
// baked into the points and the piece goes back to being ordinary static ink.

var bodies = [], fellAcc = 0;  // the pieces in motion; resting ones are reached through node.body / clump.body / it.body
var FELL = {
  g: 9.81, step: 1 / 120, maxSteps: 12, maxBodies: 60, maxParticles: 1500,
  woodE: 0.22, leafE: 0.04, woodMu: 0.6, leafMu: 0.9,   // restitution and friction against the ground
  fracture: 3.4,                                         // m/s of landing speed that snaps a side branch off
  residual: 0.12                                         // s: how fast a cut piece eases out of the sway pose it was cut in
};

// ---------- geometry of a (possibly broken, possibly falling) tree ----------

// Where a rest-frame point of a tree is on screen now: carried by its piece if it has fallen, else by the sway.
function placeAt(T, B, x, y, out){
  out = out || [0, 0];
  if(B){
    var qx = x - B.c[0], qy = y - B.c[1], ca = Math.cos(B.th), sa = Math.sin(B.th);
    out[0] = B.pos[0] + ca * qx - sa * qy; out[1] = B.pos[1] + sa * qx + ca * qy;
    return out;
  }
  var g = T.sway;
  if(g && g.cur){
    var a = swayAngle(g, y), dx = x - g.px, dy = y - g.py, c = Math.cos(a), s = Math.sin(a);
    out[0] = g.px + dx * c - dy * s; out[1] = g.py + dx * s + dy * c;
    return out;
  }
  out[0] = x; out[1] = y;
  return out;
}

// The drawn radius of the wood at node n (the trunk's base is flared wider than the skeleton says).
function rOf(n){ var L = n.limb; return L && L.rd && L.nodes[n.li] === n ? L.rd[n.li] : n.r; }

// Where the wood leading into node n starts: its parent, the drawn base of a side limb, or the cut its piece hangs from.
function segStart(n){
  var B = n.body, a = n.parent, L = n.limb;
  if(!a) return { x: n.x, y: n.y, r: rOf(n), u: 0 };
  if(B && a.body !== B) return { x: B.root[0], y: B.root[1], r: B.rootR, u: B.rootU };
  if(n.li === 1 && L.side && L.p0) return { x: L.p0[0], y: L.p0[1], r: L.rd[0], u: 0 };
  return { x: a.x, y: a.y, r: L.rd ? L.rd[n.li - 1] : a.r, u: n.li - 1 };
}

// A stub (wood left between a cut and the node before it) belongs to whoever holds that node.
function stubOwner(S){ return S.holder ? S.holder.body : S.body; }

// Is screen point (sx, sy) inside clump c's scalloped outline, wherever the clump is now?
function onClump(T, c, sx, sy){
  var P = placeAt(T, c.body, c.x, c.y), dx = sx - P[0], dy = sy - P[1];
  if(dx * dx + dy * dy > c.r * c.r * 1.6) return false;
  // Undo the turn the clump has picked up (its piece's pose, or the sway), then test it where it was drawn.
  var a = -(c.body ? c.body.th : T.sway ? swayAngle(T.sway, c.y) : 0), ca = Math.cos(a), sa = Math.sin(a);
  return clumpInside(c, c.x + dx * ca - dy * sa, c.y + dx * sa + dy * ca);
}

// What of tree T is under the point: leaves in front of the wood (topmost first), else the nearest wood within a few
// pixels of its bark (seen through gaps in the foliage), else leaves behind it. Says where along which limb to cut.
function treeHit(T, sx, sy){
  var best = null, A = [0, 0], Q = [0, 0], i;
  for(i = T.clumps.length - 1; i >= 0; i--){
    var fc = T.clumps[i];
    if(fc.front && onClump(T, fc, sx, sy)) return { T: T, kind: 'leaves', clump: fc, owner: fc.body };
  }
  function seg(owner, ax, ay, ra, ua, bx, by, rb, ub, limb, n, S){
    placeAt(T, owner, ax, ay, A);
    placeAt(T, owner, bx, by, Q);
    var dx = Q[0] - A[0], dy = Q[1] - A[1], L2 = dx * dx + dy * dy || 1;
    var t = clamp(((sx - A[0]) * dx + (sy - A[1]) * dy) / L2, 0, 1), r = lerp(ra, rb, t);
    var score = Math.hypot(sx - A[0] - dx * t, sy - A[1] - dy * t) - r;
    if(score < 3.5 && (!best || score < best.score)) best = { T: T, kind: 'limb', owner: owner, limb: limb, u: lerp(ua, ub, t), rP: r, score: score, n: n, S: S, t: t };
  }
  for(i = 0; i < T.nodes.length; i++){
    var n = T.nodes[i];
    if(!n.parent || !n.limb) continue;
    var st = segStart(n);
    seg(n.body, st.x, st.y, st.r, st.u, n.x, n.y, rOf(n), n.li, n.limb, n, null);
  }
  T.stubs.forEach(function(S){ seg(stubOwner(S), S.a[0], S.a[1], S.ra, S.ua, S.b[0], S.b[1], S.rb, S.ub, S.limb, null, S); });
  if(best) return best;
  for(i = T.clumps.length - 1; i >= 0; i--){
    var bc = T.clumps[i];
    if(!bc.front && onClump(T, bc, sx, sy)) return { T: T, kind: 'leaves', clump: bc, owner: bc.body };
  }
  return null;
}

// ---------- cutting ink ----------

// Points of an item carried with their chain position and cursor displacement, so a cut piece doesn't jump.
function vtx(it, i){ return { p: it.pts[i], u: it.u[i], dx: it.dispX ? it.dispX[i] : 0, dy: it.dispY ? it.dispY[i] : 0 }; }
function vmix(it, i, j, uB){
  var a = vtx(it, i), b = vtx(it, j), f = (uB - a.u) / ((b.u - a.u) || 1);
  return { p: [lerp(a.p[0], b.p[0], f), lerp(a.p[1], b.p[1], f)], u: uB, dx: lerp(a.dx, b.dx, f), dy: lerp(a.dy, b.dy, f) };
}
function piece(it, vs){
  var q = Object.assign({}, it, { pts: vs.map(function(v){ return [v.p[0], v.p[1]]; }), u: Float32Array.from(vs.map(function(v){ return v.u; })) });
  q.len = pathLength(q.pts);
  q.dispX = Float32Array.from(vs.map(function(v){ return v.dx; }));
  q.dispY = Float32Array.from(vs.map(function(v){ return v.dy; }));
  return q;
}
function range(it, a, b){ var out = []; for(var i = a; i < b; i++) out.push(vtx(it, i)); return out; }

// A stroke running along the chain (u increasing), split at uB. Either half may be the item itself, or null.
function splitOpen(it, uB){
  var u = it.u, n = it.pts.length, m = 0;
  while(m < n && u[m] < uB) m++;
  if(m === 0) return { go: it, stay: null };
  if(m === n) return { stay: it, go: null };
  var q = vmix(it, m - 1, m, uB);
  return { stay: piece(it, range(it, 0, m).concat([q])), go: piece(it, [q].concat(range(it, m, n))), cut: q };
}

// A limb's outline runs out along one side and back along the other, so what lies past the cut is one run in the middle.
function splitMask(it, uB){
  var u = it.u, n = it.pts.length, i0 = -1, i1 = -1, i;
  for(i = 0; i < n; i++) if(u[i] >= uB){ if(i0 < 0) i0 = i; i1 = i; }
  if(i0 < 0) return { stay: it, go: null };
  if(i0 === 0 && i1 === n - 1) return { go: it, stay: null };
  if(i0 === 0 || i1 === n - 1) return { stay: it, go: null };
  var qa = vmix(it, i0 - 1, i0, uB), qb = vmix(it, i1 + 1, i1, uB);
  return {
    go: piece(it, [qa].concat(range(it, i0, i1 + 1), [qb])),
    stay: piece(it, range(it, 0, i0).concat([qa, qb], range(it, i1 + 1, n))),
    cut: { dx: (qa.dx + qb.dx) / 2, dy: (qa.dy + qb.dy) / 2 }
  };
}

// The torn end of a limb: a zigzag of splinters across the wood at the cut, teeth pointing along (dx, dy) * sgn.
function jagEnd(P, dx, dy, r, sgn, st){
  var nx = -dy, ny = dx, pts = [], n = clamp(Math.round(r * 0.9) + 2, 3, 9), reach = Math.min(r, 6 + r * 0.3);
  if(r < 1.3){
    var l = Math.max(1.2, r * 2.5) * sgn;
    return ink([[P[0] + nx * 0.8, P[1] + ny * 0.8], [P[0] + dx * l, P[1] + dy * l], [P[0] - nx * 0.8, P[1] - ny * 0.8]], st);
  }
  for(var i = 0; i <= n; i++){
    var t = -1 + 2 * i / n, out = (i % 2 ? rand(0.45, 1.1) : rand(-0.1, 0.2)) * reach * sgn;
    pts.push([P[0] + nx * t * r + dx * out, P[1] + ny * t * r + dy * out]);
  }
  return ink(pts, st);
}

function refreshGroup(g){
  var blast = new Set();
  (g.holes || []).forEach(function(h){ blast.add(h); h.interior.forEach(function(it){ blast.add(it); }); });
  (g.scars || []).concat(g.rubble || []).forEach(function(it){ blast.add(it); });
  g.masks = g.items.filter(function(it){ return it.mask; });
  g.strokes = g.items.filter(function(it){ return !it.mask && !blast.has(it) && it.pts.length > 1; });
  g.buckets = bucketize(g.strokes);
}

// New ink for a tree: fresh per-point state (keeping any cursor displacement it was cut with), in layer grp.
function prepItem(it, T, grp){
  var dx = it.dispX, dy = it.dispY, n = it.pts.length;
  initItem(it);
  if(dx && dx.length === n){ it.dispX = dx; it.dispY = dy; it.moving = true; }
  it.animX = new Float32Array(n); it.animY = new Float32Array(n);
  it.tree = T; it.grp = grp; it.body = null; it.live = false; it.rx = it.ry = null;
  return it;
}

// ---------- mass ----------

// Wood as tapered rods (mass ~ r^2 * length), each leaf clump as a light disc (~ r^3 / 50, about a third of a
// grown crown's weight). Also picks the collision probes [x, y, radius, kind, node]: kind 0 is real wood (the
// limbs a fallen tree ends up propped on); 1 leaves and 2 twigs are soft, pressing well into the ground before
// they push back, because a crown lying on the ground spreads toward the viewer, below the trunk's ground line.
function massProps(B){
  var parts = [], prox = [], soft = [], m = 0, cx = 0, cy = 0, leafM = 0, I = 0, span = 1, stout = Math.max(1.5, 0.05 * B.T.scale);
  function rod(ax, ay, ra, bx, by, rb){
    var L = Math.max(0.5, Math.hypot(bx - ax, by - ay)), r = (ra + rb) / 2, mm = r * r * L;
    parts.push([(ax + bx) / 2, (ay + by) / 2, mm, mm * L * L / 12, bx, by]);
  }
  B.nodes.forEach(function(n){
    var st = segStart(n), r = rOf(n);
    rod(st.x, st.y, st.r, n.x, n.y, r);
    if(r >= stout) prox.push([n.x, n.y, r, 0, n]);
    else if(n.id % 3 === 0 || !n.kids.some(function(k){ return k.body === B; })) soft.push([n.x, n.y, Math.max(0.8, r), 2, n]);
  });
  B.T.stubs.forEach(function(S){
    if(stubOwner(S) !== B) return;
    rod(S.a[0], S.a[1], S.ra, S.b[0], S.b[1], S.rb);
    prox.push([S.b[0], S.b[1], Math.max(0.8, S.rb), 0, null]);
  });
  B.clumps.forEach(function(c){
    var mm = 0.02 * c.r * c.r * c.r;
    leafM += mm;
    parts.push([c.x, c.y, mm, 0.5 * mm * c.r * c.r, c.x, c.y]);
    soft.push([c.x, c.y, c.r * 0.5, 1, c.node]);
  });
  if(!parts.length) parts.push([B.root[0], B.root[1], Math.max(1, 2 * B.rootR * B.rootR), B.rootR * B.rootR, B.root[0], B.root[1]]);
  // Keep every wood probe; thin out the soft ones if there are too many.
  if(soft.length > 160){ var k = Math.ceil(soft.length / 160); soft = soft.filter(function(q, i){ return i % k === 0; }); }
  prox = prox.concat(soft);
  prox.push([B.root[0], B.root[1], Math.max(0.8, B.rootR), 0, null]);
  parts.forEach(function(p){ m += p[2]; cx += p[0] * p[2]; cy += p[1] * p[2]; });
  cx /= m; cy /= m;
  parts.forEach(function(p){
    I += p[2] * ((p[0] - cx) * (p[0] - cx) + (p[1] - cy) * (p[1] - cy)) + p[3];
    span = Math.max(span, Math.hypot(p[4] - B.root[0], p[5] - B.root[1]));
  });
  // A short sliver still has the inertia of its own thickness (a thin disc of wood, not a point).
  B.m = m; B.I = Math.max(I, m * Math.max(1, 0.5 * B.rootR * B.rootR)); B.c = [cx, cy]; B.leaf = leafM / m; B.span = span; B.prox = prox;
}

function treeMass(T){
  if(T.mass) return T.mass;
  var m = 0;
  T.nodes.forEach(function(n){ if(n.parent){ var r = (n.r + n.parent.r) / 2; m += r * r * Math.hypot(n.x - n.parent.x, n.y - n.parent.y); } });
  T.clumps.forEach(function(c){ m += 0.02 * c.r * c.r * c.r; });
  return (T.mass = m);
}

// ---------- re-cutting clumps ----------

// New ink starts displaced as the cursor field has the ink around it, so it doesn't jump (the shot is at the cursor).
function fieldDisp(it, c){
  var n = it.pts.length;
  it.dispX = new Float32Array(n); it.dispY = new Float32Array(n);
  if(!mouseInside) return it;
  var Q = placeAt(c.maskIt.tree, c.body, c.x, c.y), r = INFLUENCE_R + wellBoost;
  for(var j = 0; j < n; j++){
    // the push depends on where the point is on screen; the pose is near-rigid over a clump, so offset from its centre
    pushTarget(Q[0] + it.pts[j][0] - c.x, Q[1] + it.pts[j][1] - c.y, mouseX, mouseY, r, MAX_PUSH, _pushTmp);
    it.dispX[j] = _pushTmp[0]; it.dispY[j] = _pushTmp[1];
  }
  return it;
}

// Each clump's strokes are cut where the higher clumps of its layer overlap it. When clumps end up in different
// pieces (one falls, one stays) that cut is wrong, so redo it against the clumps still in the same piece.
// Returns the screen box of standing ink that changed (the static cache needs repainting there).
function recutClumps(T){
  var changed = new Map(), dirty = null;
  T.clumps.forEach(function(c){
    var want = c.occ.filter(function(d){ return d.body === c.body; });
    if(want.length === c.cutBy.length && want.every(function(d, i){ return d === c.cutBy[i]; })) return;
    c.cutBy = want;
    var grp = c.maskIt.grp, rec = changed.get(grp) || { dead: new Set(), fresh: [] };
    changed.set(grp, rec);
    c.inks.forEach(function(it){ rec.dead.add(it); if(!it.live) dirty = unionBox(dirty, it.bb); });
    c.inks = occludeClumps(c.raw, want).map(function(it){
      var q = prepItem(fieldDisp({ pts: it.pts.map(function(p){ return [p[0], p[1]]; }), len: it.len, color: it.color, width: it.width, alpha: it.alpha, clump: c }, c), T, grp);
      q.body = c.body; q.live = !!(c.body && !c.body.asleep);
      if(!q.live) dirty = unionBox(dirty, q.bb);
      return q;
    });
    rec.fresh = rec.fresh.concat(c.inks);
  });
  if(!changed.size) return null;
  var dead = new Set();
  changed.forEach(function(rec, grp){
    grp.items = grp.items.filter(function(it){ return !rec.dead.has(it); }).concat(rec.fresh);
    refreshGroup(grp);
    rec.dead.forEach(function(it){ dead.add(it); });
  });
  var fresh = [];
  changed.forEach(function(rec){ fresh = fresh.concat(rec.fresh); });
  T.items = T.items.filter(function(it){ return !dead.has(it); }).concat(fresh);
  var byBody = new Map();
  fresh.forEach(function(it){ if(it.body){ var l = byBody.get(it.body) || []; l.push(it); byBody.set(it.body, l); } });
  var owners = new Set();
  dead.forEach(function(it){ if(it.body) owners.add(it.body); });
  byBody.forEach(function(l, B){ owners.add(B); });
  owners.forEach(function(B){ B.items = B.items.filter(function(it){ return !dead.has(it); }).concat(byBody.get(B) || []); });
  return dirty;
}

// ---------- breaking ----------

// Cut `limb` at chain position u. owner is the piece that holds that wood (null = the standing tree). Everything of
// the owner's beyond the cut becomes a new body; ink straddling the cut is split there, and both torn ends get
// splinters. shot = the screen point of a bullet (the piece then hinges before it drops); null = snapped on impact.
function breakLimb(T, owner, limb, u, shot){
  if(bodies.length >= FELL.maxBodies) return null;
  var ns = limb.nodes, s = T.scale;
  u = clamp(u, 0.05, ns.length - 1.05);
  var k = Math.max(1, Math.ceil(u - 1e-6)), b = ns[k], a = ns[k - 1], st = null, holder = null, stub = null;
  if(b.body === owner){
    if(owner && a.body !== owner){
      st = { x: owner.root[0], y: owner.root[1], r: owner.rootR, u: owner.rootU };
      if(u <= st.u + 0.03) return null;  // right at a piece's own broken end: nothing to cut off
    } else {
      st = segStart(b); holder = a;
      u = Math.max(u, st.u + 0.03);  // just past a node: cut a hair further along
    }
  } else {
    // The far end already fell: the cut is in the stub of this limb the owner still holds.
    stub = T.stubs.find(function(S){ return S.limb === limb && stubOwner(S) === owner && u >= S.ua - 1e-6 && u <= S.ub + 1e-6; });
    if(!stub || stub.ub - stub.ua < 0.07) return null;
    u = clamp(u, stub.ua + 0.03, stub.ub - 0.03);
  }
  if(owner) wake(owner);
  var P, rP, dx, dy, f;
  if(stub){
    f = (u - stub.ua) / (stub.ub - stub.ua);
    P = [lerp(stub.a[0], stub.b[0], f), lerp(stub.a[1], stub.b[1], f)]; rP = lerp(stub.ra, stub.rb, f);
    dx = stub.b[0] - stub.a[0]; dy = stub.b[1] - stub.a[1];
  } else {
    f = (u - st.u) / Math.max(1e-3, k - st.u);
    P = [lerp(st.x, b.x, f), lerp(st.y, b.y, f)]; rP = lerp(st.r, rOf(b), f);
    dx = b.x - st.x; dy = b.y - st.y;
  }
  var dl = Math.hypot(dx, dy) || 1;
  dx /= dl; dy /= dl;
  function inSub(n){ return n.tin >= b.tin && n.tin <= b.tout; }
  function inD(n){ return !stub && n.body === owner && inSub(n); }
  var D = T.nodes.filter(inD), clumps = T.clumps.filter(function(c){ return c.body === owner && inD(c.node); });
  var src = owner ? owner.items : T.items.filter(function(it){ return !it.body; });
  var go = [], keep = [], dead = new Set(), fresh = [], oldBB = null, cutD = null;
  src.forEach(function(it){
    if(it.limb === limb && it.u){
      var sp = it.mask ? splitMask(it, u) : splitOpen(it, u);
      if(sp.go === it){ go.push(it); return; }
      if(sp.stay === it){ keep.push(it); return; }
      dead.add(it);
      if(!it.live) oldBB = unionBox(oldBB, it.bb);
      if(!cutD) cutD = sp.cut;
      keep.push(sp.stay); go.push(sp.go); fresh.push(sp.stay, sp.go);
      return;
    }
    // Other limbs go with the piece if they grow from it (judged by where they attach, which a limb cut near its
    // own base still has); clumps go with their twig.
    var mv = it.limb === limb ? it.u0 >= u : it.limb ? !stub && inSub(it.limb.nodes[0]) : it.clump ? inD(it.clump.node) : false;
    (mv ? go : keep).push(it);
  });
  if(!go.length && !D.length) return null;

  var est = { color: COLOR.ink1, width: clamp(0.8 + rP * 0.08, 0.7, 1.9) * T.width, alpha: 0.85 * T.alpha, jitter: 0.2, curve: false };
  var stumpEnd = atU(jagEnd(P, dx, dy, rP, 1, est), limb, u - 1e-3), pieceEnd = atU(jagEnd(P, dx, dy, rP, -1, est), limb, u + 1e-3);
  [stumpEnd, pieceEnd].forEach(function(j){
    if(!cutD) return;
    j.dispX = new Float32Array(j.pts.length).fill(cutD.dx); j.dispY = new Float32Array(j.pts.length).fill(cutD.dy);
  });
  keep.push(stumpEnd); go.push(pieceEnd); fresh.push(stumpEnd, pieceEnd);
  var grp = T.limbGrp;
  fresh.forEach(function(it){ prepItem(it, T, grp); });
  grp.items = grp.items.filter(function(it){ return !dead.has(it); }).concat(fresh);
  refreshGroup(grp);
  T.items = T.items.filter(function(it){ return !dead.has(it); }).concat(fresh);

  var trunk = limb.trunk && rP >= 0.5 * T.nodes[0].r;  // the thin top of the leader is just a branch
  var B = {
    T: T, items: go, nodes: D, clumps: clumps, root: P, rootR: rP, rootU: u, mainLimb: limb,
    pos: [0, 0], th: 0, v: [0, 0], w: 0, hinge: null, bend: 0, bendV: 0, resT: 1e9, still: 0, asleep: false, contact: false,
    fractures: 0, shed: 0, dustAt: 0, bb: null, ground: owner ? owner.ground : T.base[1] + (trunk ? 0 : rand(-0.15, 0.4) * s)
  };
  // The wood left on the owner's side of the cut, so it can still be hit (and cut again).
  var sup;  // the stub the new piece hangs from
  if(stub){
    var far = { limb: limb, ua: u, ub: stub.ub, a: P.slice(), ra: rP, b: stub.b, rb: stub.rb, holder: null, body: B };
    T.stubs.push(far);
    stub.ub = u; stub.b = P.slice(); stub.rb = rP;
    bodies.forEach(function(o){ if(o.hinge && o.hinge.sup === stub) o.hinge.sup = far; });  // they hung from its far end
    sup = stub;
  } else {
    sup = { limb: limb, ua: st.u, ub: u, a: [st.x, st.y], ra: st.r, b: P.slice(), rb: rP, holder: holder, body: holder ? null : owner };
    T.stubs.push(sup);
  }
  D.forEach(function(n){ n.body = B; });
  clumps.forEach(function(c){ c.body = B; });
  go.forEach(function(it){
    if(!it.live) oldBB = unionBox(oldBB, it.bb);
    it.body = B; it.live = true;
    if(!it.animX){ it.animX = new Float32Array(it.pts.length); it.animY = new Float32Array(it.pts.length); }
  });
  keep.forEach(function(it){ it.body = owner; it.live = !!owner; });
  if(owner) owner.items = keep;
  massProps(B);

  // Start exactly where the wood was: in the owner's frame, or in the pose the breeze had bent the tree into.
  // (The pose must exist before the clumps are re-cut: new clump ink is placed with it.)
  if(owner){
    B.th = owner.th;
    B.pos = placeAt(T, owner, B.c[0], B.c[1]);
    var ox = B.pos[0] - owner.pos[0], oy = B.pos[1] - owner.pos[1];
    B.v = [owner.v[0] - owner.w * oy, owner.v[1] + owner.w * ox];
    B.w = owner.w;
  } else {
    B.th = T.sway ? swayAngle(T.sway, B.c[1]) : 0;
    B.pos = placeAt(T, null, B.c[0], B.c[1]);
  }
  oldBB = unionBox(oldBB, recutClumps(T));
  if(!owner && T.sway && T.sway.cur){
    // Sway bends a tree (more at the top), a rigid pose can't; carry the difference and let it relax away.
    var R = [0, 0], ca = Math.cos(B.th), sa = Math.sin(B.th);
    B.items.forEach(function(it){
      var p = it.pts, n = p.length;
      it.rx = new Float32Array(n); it.ry = new Float32Array(n);
      for(var j = 0; j < n; j++){
        placeAt(T, null, p[j][0], p[j][1], R);
        var qx = p[j][0] - B.c[0], qy = p[j][1] - B.c[1];
        it.rx[j] = R[0] - (B.pos[0] + ca * qx - sa * qy); it.ry[j] = R[1] - (B.pos[1] + sa * qx + ca * qy);
      }
    });
    B.resT = 0;
  }
  // Probes that start inside the ground (a trunk cut just above its base) are shrunk to touch it, not shoved out.
  var pc = Math.cos(B.th), ps = Math.sin(B.th);
  B.prox.forEach(function(q){
    var pen = B.pos[1] + ps * (q[0] - B.c[0]) + pc * (q[1] - B.c[1]) + q[2] - B.ground;
    if(pen > -0.5) q[2] = Math.max(0.3, q[2] - pen - 0.5);
  });

  // What's left of the owner: a lighter piece whose centre of mass moved, or the standing tree, springing back.
  if(owner){
    var c0 = owner.c.slice(), p0 = owner.pos.slice();
    owner.nodes = owner.nodes.filter(function(n){ return n.body === owner; });
    owner.clumps = owner.clumps.filter(function(c){ return c.body === owner; });
    massProps(owner);
    // Still hanging: its fibres are resized for the weight left (a trunk's hinge has none, and stays as it is).
    if(owner.hinge && owner.hinge.k) owner.hinge.k = fibres(owner, owner.hinge.h, owner.hinge.thB);
    var oc = Math.cos(owner.th), os = Math.sin(owner.th), mx = owner.c[0] - c0[0], my = owner.c[1] - c0[1];
    owner.pos = [p0[0] + oc * mx - os * my, p0[1] + os * mx + oc * my];
    var rx = owner.pos[0] - p0[0], ry = owner.pos[1] - p0[1];
    owner.v = [owner.v[0] - owner.w * ry, owner.v[1] + owner.w * rx];
  } else if(T.sway){
    T.sway.items = T.items.filter(function(it){ return !it.body; });
    T.sway.kv += -Math.sign(B.c[0] - T.base[0]) * clamp(B.m / treeMass(T) * 1.5, 0.004, 0.14);
    T.shot = true;
  }

  // Shot off the standing tree, a piece hangs on its fibres first; cut from a piece already falling, it just goes.
  if(shot && !owner){
    var lx = B.c[0] - P[0], lever = Math.hypot(lx, B.c[1] - P[1]) || 1;
    var sgn = Math.abs(lx) > (trunk ? 0.3 : 0.12) * lever ? Math.sign(lx) : (Math.sign(P[0] - shot[0]) || randSign());
    var w0 = trunk ? rand(0.12, 0.2) : rand(0.35, 0.7);
    // A felled trunk hinges on the uncut wood on the side it falls toward, and only goes that way if the push can
    // carry its weight over that edge; otherwise it falls the way it leans. A branch hinges on its centre line.
    var hingeFor = function(sg){ return trunk ? [P[0] - dy * rP * 0.85 * sg, P[1] + dx * rP * 0.85 * sg] : P.slice(); };
    // Energy to lift the weight over hinge edge hr toward sg, with a wide margin for the damping on the way.
    var overEdge = function(hr, sg){
      var qx = B.c[0] - hr[0], qy = B.c[1] - hr[1], Ih = B.I + B.m * (qx * qx + qy * qy);
      return qx * sg >= 0 ? 0 : Math.sqrt(5 * B.m * FELL.g * s * (Math.hypot(qx, qy) + qy) / Ih);
    };
    if(trunk && lx && Math.sign(lx) !== sgn && overEdge(hingeFor(sgn), sgn) > w0 * 1.6) sgn = Math.sign(lx);
    var hr = hingeFor(sgn), thB = trunk ? 1.15 : clamp(0.15 + rP / s * 2.5, 0.15, 0.7);
    if(trunk) w0 = Math.max(w0, overEdge(hr, sgn));
    B.hinge = { h: hr, th0: B.th, thB: thB, t: 0, sup: sup, k: trunk ? 0 : fibres(B, hr, thB), hold: trunk ? 8 : 0.25 + rP / s * 4 };
    B.w += sgn * w0;
  }

  if(T.static == null) T.static = groups.indexOf(grp) < firstDynamic;
  if(T.static && oldBB) patchCache(pad(unionBox(oldBB, [P[0], P[1], P[0], P[1]]), 12));
  staleFx();  // particle occluders are rebuilt around the new shapes
  bodies.push(B);
  return B;
}

// Fibres that resist at first and weaken as they tear (peak ~ a fifth of the piece's weight torque about the hinge).
function fibres(B, h, thB){ return 0.9 * B.m * FELL.g * B.T.scale * Math.hypot(B.c[0] - h[0], B.c[1] - h[1]) / thB; }

// ---------- shooting ----------

// One particle group per tree (its leaves and splinters are drawn together), with an occluder of the nearer ink
// that is refreshed whenever pieces start or stop moving.
function treeFx(T){
  if(!T.fx || T.fx.stale){
    var gi = -1, own = itemsBBox(T.items), reach = Math.max(200, T.base[1] - own[1]);
    T.grps.forEach(function(g){ gi = Math.max(gi, groups.indexOf(g)); });
    T.fx = T.fx || {};
    T.fx.occ = occluderPath(gi, [own[0] - reach, own[1] - 50, own[2] + reach, H]);
    T.fx.stale = false;
  }
  return T.fx;
}
function staleFx(){ trees.forEach(function(t){ if(t.fx) t.fx.stale = true; }); }

function spawnLeaves(T, fx, x, y, n, spread, vx, vy){
  var s = T.scale;
  for(var i = 0; i < n && particles.length < FELL.maxParticles; i++){
    particles.push({ blast: fx, kind: 'leaf', x: x + rand(-spread, spread), y: y + rand(-spread, spread) * 0.8,
      vx: vx + rand(-1.2, 1.2) * s, vy: vy + rand(-1.2, 0.6) * s, size: rand(T.leaf[0], T.leaf[1]) * 1.15,
      rot: 0, rot0: rand(0, Math.PI * 2), ph: rand(0, Math.PI * 2), fw: rand(3, 6.5), flut: rand(2.5, 5) * s, drag: rand(6, 10), g: FELL.g * s,
      ground: T.base[1] + rand(-0.4, 0.7) * s, age: 0, life: rand(9, 14), alpha: T.alpha * rand(0.55, 0.85),
      color: COLOR.ink1, width: 0.7 * T.width, landed: false });
  }
}

function spawnSplinters(T, fx, x, y, n, r){
  var s = T.scale;
  for(var i = 0; i < n && particles.length < FELL.maxParticles; i++){
    var a = rand(0, Math.PI * 2), len = rand(0.5, 1.1) * clamp(r, 1.5, 6);
    particles.push({ blast: fx, kind: 'frag', pts: [[-len / 2, 0], [0, rand(-0.6, 0.6)], [len / 2, 0]], x: x, y: y,
      vx: Math.cos(a) * rand(1, 4) * s, vy: -rand(1, 4) * s, rot: a, vr: rand(-10, 10), color: COLOR.ink1, width: 0.75 * T.width,
      alpha: 0.8 * T.alpha, age: 0, life: rand(1, 1.8), ground: T.base[1] + rand(-0.3, 0.5) * s, g: FELL.g * s, bounce: 0 });
  }
}

function wake(B){
  if(!B.asleep) return;
  B.asleep = false; B.still = 0;
  B.items.forEach(function(it){ it.live = true; });
  if(bodies.indexOf(B) < 0) bodies.push(B);
  if(B.T.static && B.bb) patchCache(pad(B.bb, 8));
  staleFx();
}

// A shot into a fallen piece (or right at its torn end) makes it jump and spin.
function kick(B, sx, sy){
  wake(B);
  var s = B.T.scale, dvx = (B.pos[0] < sx ? -1 : 1) * rand(0.5, 1.3) * s, dvy = -rand(2, 3.2) * s, rx = sx - B.pos[0], ry = sy - B.pos[1];
  B.w += clamp(B.m * (rx * dvy - ry * dvx) / B.I, -5, 5);
  if(!B.hinge){ B.v[0] += dvx; B.v[1] += dvy; }  // still hanging on its fibres: it just swings harder
}

function shootTree(h, sx, sy){
  var T = h.T, s = T.scale, fx = treeFx(T), owner = h.owner, limb, u, rP;
  if(T.static == null) T.static = groups.indexOf(T.limbGrp) < firstDynamic;
  particles.push({ blast: fx, kind: 'ring', x: sx, y: sy, r: clamp(s * 0.3, 4, 18), age: 0, life: 0.3 });
  if(h.kind === 'leaves'){
    spawnLeaves(T, fx, sx, sy, clamp(Math.round(h.clump.r * 0.45), 4, 18), h.clump.r * 0.45, 0, -1.2 * s);
    // A shot into the foliage clips the twig that carries it: back up a few nodes, but never into a real limb.
    var n = h.clump.node, thin = Math.max(0.9, 0.07 * s);
    for(var k = 0; k < 6 && n.parent && n.parent.body === owner && n.parent.parent && n.parent.r < thin; k++) n = n.parent;
    if(!n.parent || !n.limb || (owner && n.parent.body !== owner)){ if(owner) kick(owner, sx, sy); return; }
    var st = segStart(n);
    limb = n.limb; u = lerp(st.u, n.li, 0.5); rP = lerp(st.r, rOf(n), 0.5);
  } else {
    limb = h.limb; u = h.u; rP = h.rP;
    spawnSplinters(T, fx, sx, sy, clamp(Math.round(rP * 1.5), 3, 14), rP);
  }
  var B = breakLimb(T, owner, limb, u, [sx, sy]);
  if(!B){ if(owner) kick(owner, sx, sy); return; }
  if(!owner){
    // The jolt shakes a few leaves loose from what's still standing.
    var cs = T.clumps.filter(function(c){ return !c.body; }), q = [0, 0];
    for(var i = 0; i < Math.min(8, cs.length); i++){
      var c = cs[Math.floor(Math.random() * cs.length)];
      placeAt(T, null, c.x + rand(-0.5, 0.5) * c.r, c.y + rand(-0.4, 0.4) * c.r, q);
      spawnLeaves(T, treeFx(T), q[0], q[1], 1, 0, 0, 0);
    }
  }
  blastImpulse(sx, sy, clamp(rP * 5 + 25, 30, 80));
}

// ---------- dynamics ----------

function lowestPen(B){
  var ca = Math.cos(B.th), sa = Math.sin(B.th), best = -Infinity;
  for(var i = 0; i < B.prox.length; i++){
    var q = B.prox[i], pen = B.pos[1] + sa * (q[0] - B.c[0]) + ca * (q[1] - B.c[1]) + q[2] - B.ground;
    if(pen > best) best = pen;
  }
  return best;
}

// Hanging on the torn fibres: rotation about the hinge under gravity, against fibres that give way as they bend.
// The hinge rides on whatever holds the wood it hangs from (the swaying tree, or a piece that wood fell with).
function hingeStep(B, h, G){
  var hg = B.hinge, rx = B.c[0] - hg.h[0], ry = B.c[1] - hg.h[1], Ih = B.I + B.m * (rx * rx + ry * ry);
  var H = placeAt(B.T, hg.sup ? stubOwner(hg.sup) : null, hg.h[0], hg.h[1]), ca = Math.cos(B.th), sa = Math.sin(B.th), d = B.th - hg.th0;
  hg.t += h;
  var tq = B.m * G * (ca * rx - sa * ry) - hg.k * d * Math.max(0, 1 - Math.abs(d) / hg.thB);
  B.w += tq / Ih * h;
  B.w *= Math.exp(-(0.2 + 1.2 * B.leaf) * h);
  B.th += B.w * h;
  ca = Math.cos(B.th); sa = Math.sin(B.th);
  var ox = ca * rx - sa * ry, oy = sa * rx + ca * ry;
  B.v[0] = (H[0] + ox - B.pos[0]) / h; B.v[1] = (H[1] + oy - B.pos[1]) / h;
  B.pos[0] = H[0] + ox; B.pos[1] = H[1] + oy;
  if(Math.abs(B.th - hg.th0) > hg.thB || hg.t > hg.hold || lowestPen(B) > 0){
    B.hinge = null; B.bendV += B.w * 0.15;
    B.v = [-B.w * oy, B.w * ox];  // leave with the swing's velocity, not the sway's jitter
  }
}

// Ground contact by sequential impulses over the probes that are in the ground: restitution on impact, Coulomb
// friction, and a gentle, capped push back out of any penetration. Leafy probes are soft: they squash in and don't
// bounce. Returns the hardest impact this step.
function contacts(B, h){
  var ca = Math.cos(B.th), sa = Math.sin(B.th), cs = [], P = B.prox, s = B.T.scale, i, it;
  for(i = 0; i < P.length; i++){
    var q = P[i], qx = q[0] - B.c[0], qy = q[1] - B.c[1], rx = ca * qx - sa * qy, ry = sa * qx + ca * qy;
    var pen = B.pos[1] + ry + q[2] - B.ground;
    if(pen > 0) cs.push({ rx: rx, ry: ry, pen: pen, q: q, jn: 0, jt: 0, vn0: 0 });
  }
  B.contact = cs.length > 0;
  B.cs = cs;
  if(!cs.length) return null;
  if(cs.length > 16){ cs.sort(function(a, b){ return b.pen - a.pen; }); cs.length = 16; }
  var im = 1 / B.m, iI = 1 / B.I, hit = null, maxBias = 0.4 * s;
  cs.forEach(function(c){
    c.vn0 = -(B.v[1] + B.w * c.rx);
    if(!hit || c.vn0 < hit.vn0) hit = c;
  });
  for(it = 0; it < 4; it++){
    for(i = 0; i < cs.length; i++){
      var c = cs[i], kind = c.q[3];
      var vn = -(B.v[1] + B.w * c.rx);
      var e = c.vn0 < -0.8 * s ? (kind ? FELL.leafE : FELL.woodE) : 0;
      var bias = Math.min(maxBias, 0.2 / h * Math.max(0, c.pen - (kind === 1 ? c.q[2] * 0.9 : kind === 2 ? 0.12 * s : 0.4)));
      var target = Math.max(-e * c.vn0, bias), kn = im + c.rx * c.rx * iI;
      var jn = Math.max(0, c.jn + (target - vn) / kn), dj = jn - c.jn;
      c.jn = jn;
      B.v[1] -= dj * im; B.w -= c.rx * dj * iI;
      var vt = B.v[0] - B.w * c.ry, kt = im + c.ry * c.ry * iI, mu = kind ? FELL.leafMu : FELL.woodMu;
      var jt = clamp(c.jt - vt / kt, -mu * c.jn, mu * c.jn), dt = jt - c.jt;
      c.jt = jt;
      B.v[0] += dt * im; B.w -= c.ry * dt * iI;
    }
  }
  return hit.vn0 < 0 ? hit : null;
}

// A hard landing snaps the side branch that took it, near where it joins.
function fracture(B, c){
  var n = c.q[4], L = n && n.limb;
  if(B.fractures >= (B.nodes.length > 120 ? 6 : 3) || bodies.length >= FELL.maxBodies || !L || !L.side || L === B.mainLimb) return;
  if(L.start.body !== B || L.nodes[0].body !== B) return;
  var cnt = 0, a = L.start;
  B.nodes.forEach(function(m){ if(m.tin >= a.tin && m.tin <= a.tout) cnt++; });
  var frac = cnt / Math.max(1, B.nodes.length);
  if(frac < 0.03 || frac > 0.45) return;
  var nb = breakLimb(B.T, B, L, rand(0.25, 0.75), null);
  if(!nb) return;
  B.fractures++; nb.fractures = 1;
  var P = placeAt(B.T, nb, nb.root[0], nb.root[1]), fx = treeFx(B.T);
  spawnSplinters(B.T, fx, P[0], P[1], clamp(Math.round(nb.rootR * 1.5), 3, 10), nb.rootR);
  nb.shed += Math.min(12, nb.clumps.length * 2);
}

function stepBody(B, h){
  var T = B.T, s = T.scale, G = FELL.g * s;
  B.resT += h;
  if(B.bend || B.bendV){
    // The piece flexes after a jolt: tips whip about the break on a stiff, well-damped spring.
    var wb = 2 * Math.PI * 2.2;
    B.bendV += (-wb * wb * B.bend - 2 * 0.2 * wb * B.bendV) * h;
    B.bend += B.bendV * h;
    if(Math.abs(B.bend) < 1e-5 && Math.abs(B.bendV) < 1e-4){ B.bend = 0; B.bendV = 0; }
  }
  if(B.hinge){ hingeStep(B, h, G); return; }
  B.v[1] += G * h;
  var dmp = Math.exp(-(0.06 + 1.3 * B.leaf) * h);   // air drag, mostly through the leaves
  B.v[0] *= dmp; B.v[1] *= dmp;
  B.w *= Math.exp(-(0.3 + 2.2 * B.leaf + (B.contact ? 3 : 0)) * h);
  B.pos[0] += B.v[0] * h; B.pos[1] += B.v[1] * h; B.th += B.w * h;
  var hit = contacts(B, h);
  B.w = clamp(B.w, -25, 25);  // nothing that size tumbles faster than a few turns a second
  if(hit){
    var v = -hit.vn0;
    if(v > 1.0 * s){
      B.bendV += clamp(v / s * 0.03, 0, 0.3) * (B.w >= 0 ? 1 : -1);
      if(B.clumps.length) B.shed += Math.min(25, v / s * 3);
      if(hit.q[3] !== 1 && B.resT - B.dustAt > 0.25){
        B.dustAt = B.resT;
        particles.push({ blast: treeFx(T), kind: 'dust', x: B.pos[0] + hit.rx, y: B.ground - 2, vx: rand(-0.4, 0.4) * s, vy: -rand(0.2, 0.6) * s,
          r: clamp(0.12 * s, 2, 10), grow: clamp(0.3 * s, 4, 22), age: 0, life: rand(0.8, 1.4) });
      }
    }
    if(v > FELL.fracture * s){
      // Every side branch that hit hard enough may snap, hardest first.
      B.cs.filter(function(c){ return -c.vn0 > FELL.fracture * s; }).sort(function(a, b){ return a.vn0 - b.vn0; }).forEach(function(c){ fracture(B, c); });
    }
  }
  var sp = Math.hypot(B.v[0], B.v[1]) / s;
  if(B.contact && sp < 0.1 && Math.abs(B.w) < 0.12){ B.still += h; if(B.still > 0.5) sleep(B); }
  else B.still = 0;
}

// Write the piece's current transform into its ink: flex about the break, then the rigid pose, plus whatever is
// left of the sway pose it was cut in. Nodeless slivers don't flex.
function pose(B){
  var ca = Math.cos(B.th), sa = Math.sin(B.th), cx = B.c[0], cy = B.c[1], px = B.pos[0], py = B.pos[1];
  var bend = B.nodes.length && Math.abs(B.bend) > 1e-4 ? B.bend : 0, r0x = B.root[0], r0y = B.root[1], inv = 1 / (B.span * B.span);
  var res = B.resT < 1 ? Math.exp(-B.resT / FELL.residual) : 0, bb = [Infinity, Infinity, -Infinity, -Infinity];
  B.items.forEach(function(it){
    var p = it.pts, ax = it.animX, ay = it.animY, rx = res ? it.rx : null, ry = it.ry, b = [Infinity, Infinity, -Infinity, -Infinity];
    for(var j = 0; j < p.length; j++){
      var x = p[j][0], y = p[j][1];
      if(bend){ var dx = x - r0x, dy = y - r0y, a = bend * (dx * dx + dy * dy) * inv; x -= dy * a; y += dx * a; }
      x -= cx; y -= cy;
      var X = px + ca * x - sa * y, Y = py + sa * x + ca * y;
      if(rx){ X += rx[j] * res; Y += ry[j] * res; }
      ax[j] = X - p[j][0]; ay[j] = Y - p[j][1];
      if(X < b[0]) b[0] = X; if(X > b[2]) b[2] = X;
      if(Y < b[1]) b[1] = Y; if(Y > b[3]) b[3] = Y;
    }
    it.bb = b;
    if(b[0] < bb[0]) bb[0] = b[0]; if(b[1] < bb[1]) bb[1] = b[1];
    if(b[2] > bb[2]) bb[2] = b[2]; if(b[3] > bb[3]) bb[3] = b[3];
  });
  if(bb[0] > bb[2]) bb = [px, py, px, py];
  B.bb = bb;
}

// At rest: bake the pose into the points (and the skeleton, stubs and clump outlines), so the piece is ordinary
// static ink again, and stop simulating it.
function sleep(B){
  B.bend = B.bendV = 0; B.resT = 1e9;
  pose(B);
  var T = B.T, q = [0, 0];
  B.items.forEach(function(it){
    var p = it.pts, ax = it.animX, ay = it.animY, np = new Array(p.length);
    for(var j = 0; j < p.length; j++) np[j] = [p[j][0] + ax[j], p[j][1] + ay[j]];
    it.pts = np; ax.fill(0); ay.fill(0); it.bb = polyBBox(np); it.live = false; it.rx = it.ry = null;
  });
  function mv(o, kx, ky){ placeAt(T, B, o[kx], o[ky], q); o[kx] = q[0]; o[ky] = q[1]; }
  B.nodes.forEach(function(n){ mv(n, 'x', 'y'); });
  B.clumps.forEach(function(c){
    mv(c, 'x', 'y');
    c.rot = (c.rot || 0) + B.th;
    c.raw.forEach(function(r){ r.pts.forEach(function(p){ mv(p, 0, 1); }); });
  });
  B.prox.forEach(function(p){ mv(p, 0, 1); });
  T.stubs.forEach(function(S){ if(stubOwner(S) === B){ mv(S.a, 0, 1); mv(S.b, 0, 1); } });
  T.limbs.forEach(function(L){ if(L.side && L.p0 && L.start.body === B && L.nodes[0].body === B) mv(L.p0, 0, 1); });
  mv(B.root, 0, 1);
  bodies.forEach(function(o){ if(o.hinge && o.hinge.sup && stubOwner(o.hinge.sup) === B) mv(o.hinge.h, 0, 1); });
  B.c = B.pos.slice(); B.th = 0; B.v = [0, 0]; B.w = 0; B.hinge = null; B.asleep = true; B.still = 0;
  var i = bodies.indexOf(B);
  if(i >= 0) bodies.splice(i, 1);
  if(T.static) patchCache(pad(B.bb, 8));
  staleFx();
}

// Falling leaves: a steady trickle while a piece moves, more when it lands.
function shed(B, dt){
  if(!B.clumps.length){ B.shed = 0; return; }
  var s = B.T.scale, sp = Math.hypot(B.v[0], B.v[1]) / s + Math.abs(B.w) * 2, q = [0, 0], fx = null;
  B.shed += dt * Math.min(40, B.clumps.length * 0.05 * sp);
  while(B.shed >= 1){
    B.shed -= 1;
    if(particles.length >= FELL.maxParticles){ B.shed = 0; break; }
    var c = B.clumps[Math.floor(Math.random() * B.clumps.length)];
    placeAt(B.T, B, c.x + rand(-0.6, 0.6) * c.r, c.y + rand(-0.5, 0.5) * c.r, q);
    spawnLeaves(B.T, fx || (fx = treeFx(B.T)), q[0], q[1], 1, 0, B.v[0] * 0.4, B.v[1] * 0.25);
  }
}

// Advance every moving piece on a fixed 120 Hz step and pose it. Returns boxes to redraw for pieces of static
// (cached) trees, one per tree; the swaying garden trees are redrawn every frame anyway.
function updateFell(dt){
  var rects = [];
  if(!bodies.length) return rects;
  fellAcc = Math.min(fellAcc + dt, FELL.step * FELL.maxSteps);
  var moving = bodies.slice();
  while(fellAcc >= FELL.step){
    fellAcc -= FELL.step;
    for(var i = 0; i < moving.length; i++) if(!moving[i].asleep) stepBody(moving[i], FELL.step);
  }
  var perTree = new Map();
  bodies.forEach(function(B){
    shed(B, dt);
    pose(B);
    var pb = pad(B.bb, 30);
    B.T.grps.forEach(function(g){ g.bb = unionBox(g.bb, pb); });
    if(B.T.static) perTree.set(B.T, unionBox(perTree.get(B.T), pad(B.bb, 4)));
  });
  perTree.forEach(function(b){ rects.push(b); });
  return rects;
}
