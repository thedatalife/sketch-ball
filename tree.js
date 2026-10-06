'use strict';
// Grown trees: a branch skeleton from space colonization, limbs tapered by da Vinci's pipe rule,
// and foliage as scalloped clumps of individual leaves at the branch tips. Some clumps sit behind the
// limbs and some in front, so branches show through gaps and the crown stays attached to the trunk.

// Space colonization in screen space: branches grow step by step toward attractor points scattered
// through the crown envelope, and each attractor is consumed once a branch reaches it.
function colonize(o){
  var A = [], seed = rand(0, 10), tries = 0;
  function edge(a){ return 0.8 + 0.12 * Math.sin(a * 3 + seed) + 0.08 * Math.sin(a * 5 + seed * 1.7); }
  while(A.length < o.attractors && tries++ < o.attractors * 8){
    var a = rand(0, Math.PI * 2), rr = Math.sqrt(Math.random()) * edge(a);
    var x = o.cx + Math.cos(a) * rr * o.rx, y = o.cy + Math.sin(a) * rr * o.ry;
    if(y > o.cy + o.ry * 0.55) continue;
    A.push([x, y]);
  }
  var N = [];
  function add(x, y, parent){ var n = { x: x, y: y, parent: parent, kids: [], r: 0 }; if(parent) parent.kids.push(n); N.push(n); return n; }
  var cur = add(o.base[0], o.base[1], null), steps = Math.max(2, Math.round(dist(o.base, o.top) / o.D)), i;
  for(i = 1; i <= steps; i++){
    var t = i / steps;
    cur = add(lerp(o.base[0], o.top[0], t) + Math.sin(t * 3 + seed) * o.D * 0.25, lerp(o.base[1], o.top[1], t), cur);
  }
  var di = o.D * (o.reach || 5), dk = o.D * (o.kill || 1.5), fresh = N.slice();
  for(var it = 0; it < 140 && A.length; it++){
    var pull = new Map();
    A.forEach(function(p){
      var best = null, bd = di * di;
      for(var k = 0; k < N.length; k++){ var dx = p[0] - N[k].x, dy = p[1] - N[k].y, d2 = dx * dx + dy * dy; if(d2 < bd){ bd = d2; best = N[k]; } }
      if(!best) return;
      var L = Math.sqrt(bd) || 1, v = pull.get(best) || [0, 0];
      v[0] += (p[0] - best.x) / L; v[1] += (p[1] - best.y) / L;
      pull.set(best, v);
    });
    fresh = [];
    if(!pull.size){
      var tx = o.cx - cur.x, ty = o.cy - cur.y, tl = Math.hypot(tx, ty) || 1;
      cur = add(cur.x + tx / tl * o.D, cur.y + ty / tl * o.D, cur);
      fresh.push(cur);
    }
    pull.forEach(function(v, n){
      var L = Math.hypot(v[0], v[1]);
      if(L < 0.2 || n.kids.length >= 3) return;
      var nx = n.x + v[0] / L * o.D + rand(-0.12, 0.12) * o.D, ny = n.y + v[1] / L * o.D - o.D * 0.06;
      if(n.kids.some(function(k){ return Math.hypot(k.x - nx, k.y - ny) < o.D * 0.35; })) return;
      fresh.push(add(nx, ny, n));
    });
    if(!fresh.length) break;
    A = A.filter(function(p){ return !fresh.some(function(n){ var dx = p[0] - n.x, dy = p[1] - n.y; return dx * dx + dy * dy < dk * dk; }); });
  }
  // da Vinci / pipe model: a parent's cross-section carries its children's.
  for(i = N.length - 1; i >= 0; i--){
    var n = N[i];
    n.r = n.kids.length ? Math.pow(n.kids.reduce(function(s, k){ return s + Math.pow(k.r, 2.4); }, 0), 1 / 2.4) : 1;
  }
  var f = o.baseR / N[0].r;
  N.forEach(function(n){ n.r = Math.max(o.tipR, n.r * f); });
  return N;
}

// Follow the thickest child to make long flowing limbs; every other child starts its own limb.
function limbs(N){
  var out = [];
  (function walk(start, side){
    var chain = side ? [start.parent, start] : [start], n = start;
    while(n.kids.length){
      var main = n.kids.reduce(function(a, b){ return b.r > a.r ? b : a; });
      n.kids.forEach(function(k){ if(k !== main) walk(k, true); });
      chain.push(main);
      n = main;
    }
    out.push({ nodes: chain, side: side });
  })(N[0], false);
  // Each node knows the limb it runs along and its place in that chain; a side limb's first entry is its parent's node.
  out.forEach(function(limb, li){
    limb.id = li;
    limb.trunk = li === out.length - 1;
    limb.start = limb.side ? limb.nodes[1] : limb.nodes[0];
    limb.nodes.forEach(function(n, i){ if(i || !limb.side){ n.limb = limb; n.li = i; } });
  });
  return out;
}

// Every limb item records where it lies along its chain (u = 0 at the chain's first node, 1 at the next, ...),
// so a shot can cut the limb anywhere and hand everything beyond the cut to the falling piece.
function chainU(it, limb, ctrlLen, samples){
  var n = it.pts.length, u = new Float32Array(n);
  for(var j = 0; j < n; j++) u[j] = ctrlLen >= 3 ? j / samples : j;
  it.limb = limb; it.u = u;
  return it;
}
function atU(it, limb, u){ it.limb = limb; it.u0 = u; return it; }
// A short straight stroke along the limb from chain position u0 to u1, so a cut splits it like the outline.
function alongU(it, limb, u0, u1){ it.limb = limb; it.u = Float32Array.from([u0, u1]); return it; }

function drawLimb(S, limb, o, isTrunk){
  var pts = limb.nodes.map(function(n){ return [n.x, n.y]; }), rs = limb.nodes.map(function(n){ return n.r; });
  if(limb.side){
    // A side limb grows out of its parent's surface, not its centre line (which would cross the parent like a rung).
    var pr = limb.nodes[0].r, jx = pts[1][0] - pts[0][0], jy = pts[1][1] - pts[0][1], jl = Math.hypot(jx, jy) || 1, jk = Math.min(pr * 0.8, jl * 0.85) / jl;
    pts[0] = [pts[0][0] + jx * jk, pts[0][1] + jy * jk];
    rs[0] = rs[1] * 1.12;
  }
  if(isTrunk){ rs[0] *= 1.7; if(rs.length > 2) rs[1] *= 1.25; }
  limb.p0 = pts[0].slice(); limb.rd = rs.slice();  // where the drawn wood starts, and its drawn radius at each node
  var maxR = Math.max.apply(null, rs), am = o.alpha, wm = o.width;
  if(maxR < 1.3 || pts.length < 2){
    S.add(chainU(ink(pts, { color: COLOR.ink1, width: clamp(maxR * 1.4, 0.55, 1.4) * wm, alpha: 0.75 * am, jitter: 0.25, samples: 3 }), limb, pts.length, 3));
    return;
  }
  var L = [], R = [];
  for(var i = 0; i < pts.length; i++){
    var a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    var px = -dy / len, py = dx / len;
    L.push([pts[i][0] + px * rs[i], pts[i][1] + py * rs[i]]);
    R.push([pts[i][0] - px * rs[i], pts[i][1] - py * rs[i]]);
  }
  S.mask(L.concat(R.slice().reverse()));
  var mk = S.cur.items[S.cur.items.length - 1], mu = new Float32Array(L.length * 2);
  for(i = 0; i < L.length; i++){ mu[i] = i; mu[L.length * 2 - 1 - i] = i; }
  mk.limb = limb; mk.u = mu;
  var shadowR = R[0][0] + R[R.length - 1][0] > L[0][0] + L[L.length - 1][0];
  var edge = { color: COLOR.ink1, width: clamp(0.8 + maxR * 0.08, 0.9, 1.9) * wm, alpha: 0.85 * am, jitter: 0.5, samples: 3 };
  S.add(chainU(ink(L, shadowR ? edge : Object.assign({}, edge, { alpha: 0.7 * am })), limb, L.length, 3));
  S.add(chainU(ink(R, shadowR ? Object.assign({}, edge, { alpha: 0.95 * am }) : edge), limb, R.length, 3));
  if(maxR < 4) return;
  // Bark: short strokes running with the grain, and slanted hatching down the shaded side.
  var bark = { color: COLOR.ink2, width: 0.7 * wm, alpha: 0.5 * am, jitter: 0.3, curve: false };
  var shade = { color: COLOR.ink2, width: 0.65 * wm, alpha: 0.35 * am, jitter: 0.25, curve: false };
  for(i = 0; i < pts.length - 1; i++){
    var sx = pts[i + 1][0] - pts[i][0], sy = pts[i + 1][1] - pts[i][1], sl = Math.hypot(sx, sy) || 1, ux = sx / sl, uy = sy / sl, r = rs[i];
    if(r < 4) continue;
    var marks = Math.max(1, Math.round(sl * r / 60));
    for(var m = 0; m < marks; m++){
      var t = Math.random(), w = rand(-0.7, 0.7), cx = pts[i][0] + sx * t - uy * r * w, cy = pts[i][1] + sy * t + ux * r * w, bl = rand(0.6, 1.4) * Math.min(r, 8);
      S.add(alongU(ink([[cx, cy], [cx + ux * bl + rand(-0.6, 0.6), cy + uy * bl]], bark), limb, i + t, i + t + bl / sl));
    }
    // Hatch strokes start inside the shaded half and run out to the edge, slanted up the limb.
    var side = shadowR ? R : L, hatches = Math.max(1, Math.round(sl / 3));
    for(m = 0; m < hatches; m++){
      var tt = (m + 0.5) / hatches, ex = lerp(side[i][0], side[i + 1][0], tt), ey = lerp(side[i][1], side[i + 1][1], tt);
      var mx = lerp(pts[i][0], pts[i + 1][0], tt), my = lerp(pts[i][1], pts[i + 1][1], tt), k0 = rand(0.3, 0.55), slant = r * 0.9;
      S.add(alongU(ink([[lerp(mx, ex, k0) - ux * slant, lerp(my, ey, k0) - uy * slant], [ex, ey]], shade), limb, i + tt - slant / sl, i + tt));
    }
  }
  if(isTrunk){
    var b0 = pts[0], rr = rs[0] / 1.7;
    for(var k = 0; k < 4; k++){
      var sgn = k < 2 ? -1 : 1, off = rr * rand(0.3, 0.9) * sgn;
      S.add(atU(ink([[b0[0] + off, b0[1] - rr * 0.6], [b0[0] + off + sgn * rr * rand(0.8, 1.4), b0[1] - rr * 0.1], [b0[0] + off + sgn * rr * rand(1.8, 2.8), b0[1] + rr * rand(0.1, 0.35)]],
        { color: COLOR.ink1, width: 1.1 * wm, alpha: 0.7 * am, jitter: 0.4, samples: 3 }), limb, 0));
    }
  }
}

// A curved lens: widest just below the middle, pointed at the tip.
function leafAlmond(cx, cy, size, ang, color, alpha){
  var dx = Math.cos(ang), dy = Math.sin(ang), w = size * 0.32;
  function at(t, side){ var k = side * w * Math.sin(Math.PI * Math.pow(t, 0.85)); return [cx + dx * size * t - dy * k, cy + dy * size * t + dx * k]; }
  return ink([[cx, cy], at(0.3, 1), at(0.65, 1), [cx + dx * size, cy + dy * size], at(0.65, -1), at(0.3, -1), [cx, cy]], { color: color, width: 0.6, jitter: 0.15, curve: false, alpha: alpha });
}

var TREE_LIGHT = -2.35; // light falls from the upper left

// A clump's silhouette: one rounded scallop per leaf cluster, each its own size, over a slight overall lean.
// Radius at screen angle a is c.r * edge(a), with y squashed by 0.88.
function clumpEdge(lobes){
  var amp = [], seed = rand(0, 10), k;
  for(k = 0; k < lobes; k++) amp.push(rand(0.1, 0.28));
  return function(a){
    var u = (a + seed) / (Math.PI * 2) * lobes, k;
    u -= Math.floor(u / lobes) * lobes; k = Math.floor(u);
    return 0.8 + amp[k] * Math.sin(Math.PI * (u - k)) + 0.05 * Math.sin(a * 2 + seed);
  };
}

function clumpInside(c, x, y){
  var dx = x - c.x, dy = y - c.y;
  if(c.rot){ var ca = Math.cos(c.rot), sa = Math.sin(c.rot), t = dx * ca + dy * sa; dy = dy * ca - dx * sa; dx = t; }  // turned when a fallen piece was baked
  dy /= 0.88;
  var d = dx * dx + dy * dy;
  if(d > c.r * c.r * 1.3) return false;
  return Math.sqrt(d) < c.r * c.edge(Math.atan2(dy, dx)) * 0.97;
}

// Clumps in one group share a single mask pass, so a nearer clump would not hide the ink of one behind it.
// Cut that ink out geometrically, walking each stroke in small steps and splitting it where it goes under.
function occludeClumps(items, occ){
  if(!occ.length) return items;
  var out = [];
  function under(q){ for(var k = 0; k < occ.length; k++) if(clumpInside(occ[k], q[0], q[1])) return true; return false; }
  items.forEach(function(it){
    if(it.mask){ out.push(it); return; }
    var p = it.pts, run = [], was = under(p[0]), cut = false;
    function flush(){ if(run.length > 1) out.push(Object.assign({}, it, { pts: run, len: pathLength(run) })); run = []; }
    if(!was) run.push(p[0]);
    for(var i = 1; i < p.length; i++){
      var a = p[i - 1], b = p[i], n = Math.max(1, Math.ceil(dist(a, b) / 2.5));
      for(var s = 1; s <= n; s++){
        var q = s === n ? b : [lerp(a[0], b[0], s / n), lerp(a[1], b[1], s / n)], now = under(q);
        if(now !== was){ cut = true; run.push(q); if(now) flush(); was = now; }
        else if(!now && s === n) run.push(q);
      }
    }
    if(cut) flush();
    else if(!was) out.push(it);
  });
  return out;
}

// One scalloped clump. c.shade (0 lit .. 1 shadowed) is where the clump sits in the crown; within the clump the
// far side from the light gets the heavy outline, most of the leaves and the hatching, while the lit rim stays
// open with a broken outline and a few leaves breaking the silhouette.
function drawClump(S, c, o){
  var lobes = Math.round(clamp(c.r / 3.2, 5, 14)), n = lobes * 5, poly = [], am = o.alpha * (c.front ? 1 : 0.8), i, a;
  var edge = c.edge = clumpEdge(lobes), a0 = TREE_LIGHT + Math.PI / 2 - 0.25, h = Math.round(n * (Math.PI + 0.5) / (Math.PI * 2));
  function at(a, k){ var e = c.r * edge(a) * k; return [c.x + Math.cos(a) * e, c.y + Math.sin(a) * e * 0.88]; }
  for(i = 0; i <= n; i++) poly.push(at(a0 + i / n * Math.PI * 2, 1));
  S.mask(poly.slice(0, n));
  S.add(ink(poly.slice(0, h + 1), { color: COLOR.ink1, width: (1 + 0.3 * c.shade) * o.width, alpha: (0.68 + 0.22 * c.shade) * am, jitter: 0.5, samples: 2 }));
  for(i = h; i < n; ){
    var len = randInt(4, 8);
    S.add(ink(poly.slice(i, Math.min(n, i + len) + 1), { color: COLOR.ink1, width: 0.8 * o.width, alpha: 0.5 * am, jitter: 0.45, samples: 2 }));
    i += len + randInt(1, 3);
  }
  var count = Math.round(clamp(c.r * c.r * o.density * (0.7 + 0.6 * c.shade), 5, 200));
  function leaf(x, y, la, size, alpha){
    // Leaves point out from the clump and hang a little.
    var vx = Math.cos(la), vy = Math.sin(la) + 0.6, dir = Math.atan2(vy, vx) + rand(-0.7, 0.7);
    S.add(size >= 4 && Math.random() < 0.6 ? leafAlmond(x, y, size, dir, COLOR.ink1, alpha) : leafMark(x, y, size, dir, COLOR.ink1, alpha, 0.65));
  }
  for(i = 0; i < count; i++){
    a = rand(0, Math.PI * 2);
    var dark = (1 - Math.cos(a - TREE_LIGHT)) / 2;
    if(Math.random() < 0.65 * (1 - dark) * (1 - 0.5 * c.shade)) continue;
    var p = at(a, Math.pow(Math.random(), 0.42) * 0.93);
    leaf(p[0], p[1], a, rand(o.leafMin, o.leafMax), (0.3 + 0.35 * dark + 0.2 * c.shade + rand(0, 0.08)) * am);
  }
  if(c.r > 6){
    for(i = Math.round(lobes * 0.7); i > 0; i--){
      a = TREE_LIGHT + rand(-1.3, 1.3);
      var q = at(a, rand(0.9, 1.02));
      leaf(q[0], q[1], a, o.leafMax * rand(0.8, 1.1), (0.5 + rand(0, 0.15)) * am);
    }
    // Hatch the shadowed cap, larger and doubled into crosshatch the deeper the clump sits in shadow.
    var cap = function(span, depth){
      var pts = [], m = 10;
      for(var k = 0; k <= m; k++) pts.push(at(TREE_LIGHT + Math.PI - span + 2 * span * k / m, 1));
      pts.push(at(TREE_LIGHT + Math.PI, 1 - depth));
      return convexHull(pts);
    };
    var sp = clamp(2.4 + c.r * 0.03, 2.6, 4) * (1.2 - 0.35 * c.shade);
    S.add(hatchPoly(cap(0.95 + 0.6 * c.shade, 0.3 + 0.3 * c.shade), HATCH_A, sp, { alpha: (0.18 + 0.12 * c.shade) * am, width: 0.6 * o.width }));
    if(c.shade > 0.55) S.add(hatchPoly(cap(0.7, 0.25), HATCH_B, sp * 1.15, { alpha: 0.16 * am, width: 0.55 * o.width }));
  }
}

// Every grown tree, for shooting (fell.js). Rebuilt with the scene.
var trees = [];

// Returns the tree record (its items feed the sway). Groups: clumps behind the limbs, the limbs, clumps in front.
function buildTree(S, o){
  var N = colonize(o), L = limbs(N), items = [];
  // Foliage grows on all the fine outer twigs, not only at the very tips.
  var tips = N.filter(function(n){ return !n.kids.length || n.r < o.tipR * (o.twig || 3.5); });
  for(var i = tips.length - 1; i > 0; i--){ var j = Math.floor(Math.random() * (i + 1)), t = tips[i]; tips[i] = tips[j]; tips[j] = t; }
  var placed = [], spacing = o.clumpR * (o.spacing || 0.82), lx = Math.cos(TREE_LIGHT), ly = Math.sin(TREE_LIGHT);
  tips.forEach(function(n){
    if(n.y > o.cy + o.ry * 0.7) return;
    if(placed.every(function(c){ return Math.hypot(c.x - n.x, c.y - n.y) > spacing; })){
      var x = n.x + rand(-0.2, 0.2) * o.clumpR, y = n.y + rand(-0.3, 0.05) * o.clumpR, ux = (x - o.cx) / o.rx, uy = (y - o.cy) / o.ry;
      var front = Math.random() < 0.55;
      placed.push({
        x: x, y: y, front: front, node: n,
        // Big masses toward the middle of the crown, smaller sprays at its edge.
        r: o.clumpR * rand(0.7, 1.25) * (1.15 - 0.3 * clamp(Math.hypot(ux, uy), 0, 1)),
        // The crown is a lit volume: the side away from the light, and everything deeper inside, is in shade.
        shade: clamp(0.45 - 0.55 * (ux * lx + uy * ly) + (front ? 0 : 0.2), 0, 1)
      });
    }
  });
  function group(fn){ S.begin(o.mergeable); fn(); items = items.concat(S.cur.items); }
  function clumps(list){
    var spans = list.map(function(c){ var i0 = S.cur.items.length; drawClump(S, c, o); return [i0, S.cur.items.length]; });
    var all = S.cur.items, out = [];
    list.forEach(function(c, k){
      var own = all.slice(spans[k][0], spans[k][1]);
      own.forEach(function(it){ it.clump = c; });
      c.maskIt = own[0];
      // Keep the uncut strokes: when a neighbour falls away, this clump is cut again against the ones still with it.
      c.raw = own.filter(function(it){ return !it.mask; }).map(function(it){ return { pts: it.pts.map(function(q){ return [q[0], q[1]]; }), len: it.len, color: it.color, width: it.width, alpha: it.alpha }; });
      c.occ = list.slice(k + 1).filter(function(d){ return Math.hypot(d.x - c.x, d.y - c.y) < (c.r + d.r) * 1.25; });
      c.cutBy = c.occ.slice();
      c.inks = occludeClumps(own.slice(1), c.occ);
      out = out.concat([own[0]], c.inks);
    });
    S.cur.items = out;
  }
  // Within each layer the higher clumps are drawn last, so they overlap the shaded masses beneath them.
  function byDepth(a, b){ return b.y - a.y; }
  var back = placed.filter(function(c){ return !c.front; }).sort(byDepth), front = placed.filter(function(c){ return c.front; }).sort(byDepth);
  group(function(){ clumps(back); });
  group(function(){ L.forEach(function(limb, idx){ drawLimb(S, limb, o, idx === L.length - 1); }); });
  group(function(){ clumps(front); });
  // The record fell.js works from. Clumps are kept in draw order (last drawn is on top). Nodes get DFS numbering so
  // "is n in the subtree of b" is two comparisons. stubs: the wood left between a cut and the last node before it.
  var T = { nodes: N, limbs: L, clumps: back.concat(front), stubs: [], items: items, base: o.base, scale: o.scale || 1, cam: o.cam || CITY_CAM, leaf: [o.leafMin, o.leafMax], alpha: o.alpha, width: o.width, sway: null };
  var tick = 0;
  (function dfs(n){ n.tin = tick++; n.kids.forEach(dfs); n.tout = tick - 1; })(N[0]);
  N.forEach(function(n, i){ n.id = i; n.body = null; });
  placed.forEach(function(c){ c.body = null; });
  items.forEach(function(it){ it.tree = T; });
  trees.push(T);
  return T;
}
