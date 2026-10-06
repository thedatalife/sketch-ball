'use strict';
// Scene assembly and the frame loop.

var groups = [], firstDynamic = 0, cacheValid = false;
var revealRaf = null, ambientRaf = null, lastT = null, animStart = 0;

function buildScene(){
  var S = new Scene();
  swayGroups = []; trees = []; bodies = []; fellAcc = 0;
  buildSky(S);
  buildHills(S);
  buildCity(S);
  var g0 = S.groups.length, gd = buildGarden(S);
  S.groups.slice(g0).forEach(function(g){ g.garden = true; });  // the terrace: a thrown ball lands on its floor
  gd.sway.forEach(function(sw, i){ var g = registerSway(sw.items, sw.pivot, sw.heightRef, i ? 0.028 : 0.032, rand(0.18, 0.26)); if(sw.tree) sw.tree.sway = g; });
  groups = mergeGroups(S.groups);
  // Which groups hold each tree's ink: hit-testing walks the groups, and a cut limb's new ink joins its layer.
  groups.forEach(function(g){
    var ts = new Set();
    g.items.forEach(function(it){ if(!it.tree) return; it.grp = g; ts.add(it.tree); if(it.limb) it.tree.limbGrp = g; });
    if(!ts.size) return;
    g.trees = Array.from(ts);
    g.trees.forEach(function(T){ (T.grps || (T.grps = [])).push(g); });
  });
  walkers = gd.walkers.map(makeWalker);
  for(var i = 0; i < 16; i++){
    var a = rand(238, 520);
    walkers.push(makeWalker({ cam: CITY_CAM, axis: 'z', fixed: randSign() * rand(13, 14.5), a: a, b: a + rand(80, 320), h: 1.8, maxY: 505, speedMul: 3.5 }));
  }
}

// The static city is baked once at rest. Each frame blits it, re-renders only the groups the cursor
// has disturbed (clipped to that region, still in depth order), then draws the swaying trees.
// Re-render the static groups inside some boxes, in depth order, clipped to them: one pass over the groups for all
// the boxes, each group drawn once if it touches any of them.
function redrawRegions(ctx, boxes, rest){
  if(!boxes.length) return;
  ctx.save();
  ctx.beginPath();
  boxes.forEach(function(b){ ctx.rect(b[0], b[1], b[2] - b[0], b[3] - b[1]); });
  ctx.clip();
  boxes.forEach(function(b){ ctx.clearRect(b[0], b[1], b[2] - b[0], b[3] - b[1]); });
  for(var i = 0; i < firstDynamic; i++){
    var bb = groups[i].bb;
    for(var k = 0; k < boxes.length; k++) if(boxesOverlap(bb, boxes[k])){ drawGroup(ctx, groups[i], rest, boxes); break; }
  }
  ctx.restore();
}
function redrawRegion(ctx, box, rest){ redrawRegions(ctx, [box], rest); }

// After a blast, only the blasted region of the cached rest render needs rebuilding.
function patchCache(box){ if(cacheValid) redrawRegion(cacheCtx, box, true); }

function renderFrame(rects){
  var i;
  if(!cacheValid){
    cacheCtx.clearRect(0, 0, W, H);
    for(i = 0; i < firstDynamic; i++) drawGroup(cacheCtx, groups[i], true);
    cacheValid = true;
  }
  inkCtx.clearRect(0, 0, W, H);
  inkCtx.drawImage(cacheCanvas, 0, 0, W, H);
  redrawRegions(inkCtx, rects, false);
  for(i = firstDynamic; i < groups.length; i++) drawGroup(inkCtx, groups[i]);
}

function frame(now){
  if(lastT != null && now - lastT < (mouseInside ? 0 : 33)){ ambientRaf = requestAnimationFrame(frame); return; }
  var dt = lastT == null ? 0.016 : Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  ambientRaf = requestAnimationFrame(frame);  // first, so an error in one frame can't stop the animation
  updateCursorWell(dt);
  updateBalls(dt);
  var rects = updatePhysics(groups);
  updateBlasts().forEach(function(b){ addRect(rects, b); });
  updateSway((now - animStart) / 1000);
  updateFell(dt).forEach(function(b){ addRect(rects, b); });
  renderFrame(rects);
  renderFx(dt, now);
  renderParticles(dt);
  renderBalls();
}

function finishReveal(){
  fctx.clearRect(0, 0, W, H);
  if(reduceMotion) return;
  firstDynamic = groups.length;
  for(var i = 0; i < groups.length; i++) if(groups[i].dynamic){ firstDynamic = i; break; }
  cacheValid = false;
  animStart = performance.now();
  nextBirdAt = animStart + rand(3000, 6000);
  lastT = null;
  ambientRaf = requestAnimationFrame(frame);
}

function start(){
  if(revealRaf) cancelAnimationFrame(revealRaf);
  if(ambientRaf) cancelAnimationFrame(ambientRaf);
  revealRaf = ambientRaf = null;
  activeBirds = []; blasts = []; particles = []; balls = [];
  sctx.clearRect(0, 0, W, H); smoothedSpeed = 0; restTime = 0; wellBoost = 0; wasInside = false;
  fctx.clearRect(0, 0, W, H);
  inkCtx.clearRect(0, 0, W, H);
  drawPaper();
  buildScene();
  prepareInteractive(groups);
  if(reduceMotion){ groups.forEach(function(g){ drawGroup(inkCtx, g, true); }); finishReveal(); return; }
  runSplashReveal(groups, function(){ revealRaf = null; finishReveal(); });
}

canvasWrap.addEventListener('pointermove', function(e){
  var rect = inkCanvas.getBoundingClientRect();
  mouseX = (e.clientX - rect.left) * (W / rect.width);
  mouseY = (e.clientY - rect.top) * (H / rect.height);
  mouseInside = true;
});
canvasWrap.addEventListener('pointerleave', function(){ mouseInside = false; });
canvasWrap.addEventListener('click', function(e){
  if(!ambientRaf) return;
  var rect = inkCanvas.getBoundingClientRect();
  var x = (e.clientX - rect.left) * (W / rect.width), y = (e.clientY - rect.top) * (H / rect.height);
  launchBall(x, y);
});
document.getElementById('redraw').addEventListener('click', start);

start();
