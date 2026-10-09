/* =====================================================================
   MERIDIAN MAP
   ---------------------------------------------------------------------
   The city as an architectural massing model: blue-grey buildings on a
   warm ground, a river, a coast, a street grid, an industrial bank with
   tanks and chimneys, a port, a business district and an arena. Drawn on
   a canvas in an axonometric projection, with no library, so the room
   still needs no internet.

   THE MODEL IS THE DATA. Nothing on it is decoration:

     buildings     every building belongs to one of the thirteen industries
     built share   capacity: a sector that cannot meet demand has empty lots
     tint          quality: amber where a sector is strained, rust where it
                   is failing, in proportion to how badly
     dark roofs    automation: the share of a sector's roofs that are
                   machine-slate is its automation level
     cranes        a sector growing past its demand is building
     dots          people. Each dot is a number of residents, placed where
                   they are and coloured by what they are doing. When the
                   year changes they move: to work, home, a protest, the pier.

     const map = MeridianMap.create(host, { onSelect });
     map.setState(state, people, { mode: 'trial'|'agents' });
     map.select(sectorKey);
   ===================================================================== */

(function (root) {
'use strict';

var C = 0.866, S = 0.5, ZK = 0.5;
var WORLD = 1200;
var XMIN = -420, XMAX = 1650, YMIN = -380;   // the built extent, beyond the core

var PAL = {
  ground: '#F1ECE3', block: '#EAE4D9', park: '#E2E5D3', road: '#F8F5EF', casing: '#A3ACB8',
  artery: '#FBF9F4', water: '#B4C3D4', waterLine: 'rgba(255,255,255,0.35)', shore: '#8E9DB0',
  top: '#E9EFF6', south: '#A7BACE', east: '#7C92AB', edge: 'rgba(66,80,100,0.55)',
  shadow: 'rgba(74,86,108,0.15)',
  amber: { top: '#FBE4A8', south: '#E0A838', east: '#B07E1E' },
  rust:  { top: '#F0B9A4', south: '#BC4F32', east: '#8E371F' },
  slate: '#5B6779', lot: 'rgba(94,107,124,0.75)', lotFill: 'rgba(94,107,124,0.08)', crane: '#3F4A59'
};

var ROLE = {
  working:   { color: '#2E5E7E', label: 'Working' },
  out:       { color: '#D18A2C', label: 'Out of work' },
  other:     { color: '#9A8FAF', label: 'Retired, caring or studying' },
  protest:   { color: '#C0452F', label: 'Protesting or striking' },
  aid:       { color: '#4F8F52', label: 'Helping others' },
  organise:  { color: '#7B5EA7', label: 'Organising' },
  left:      { color: '#3B423E', label: 'Leaving the country', ring: true }
};

/* ------------------------------------------------------------------ */
function rng(seed) {
  var a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    var t = a; t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(str) {
  var h = 2166136261;
  for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}
var clamp = function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); };

/* ---------------------------------------------------------------------
   THE CITY PLAN — generated once, identical for every team
   --------------------------------------------------------------------- */
var RIVER_CTRL = [[-150, -520], [-60, -280], [30, -80], [120, 140], [215, 360], [320, 580], [430, 790], [530, 980]];
var RIVER_HALF = 26;

function catmull(pts, step) {
  var out = [];
  for (var i = 0; i < pts.length - 1; i++) {
    var p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (var t = 0; t < 1; t += step) {
      var t2 = t * t, t3 = t2 * t;
      out.push([
        0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
      ]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}
var RIVER = catmull(RIVER_CTRL, 0.08);
function riverX(y) {
  for (var i = 0; i < RIVER.length - 1; i++) {
    var a = RIVER[i], b = RIVER[i + 1];
    if (y >= a[1] && y <= b[1]) return a[0] + (b[0] - a[0]) * ((y - a[1]) / Math.max(1e-6, b[1] - a[1]));
  }
  return y < RIVER[0][1] ? RIVER[0][0] : RIVER[RIVER.length - 1][0];
}
function coastY(x) { return 790 + 26 * Math.sin(x / 110) + 14 * Math.sin(x / 37); }
function coastD(x, y) { return y - coastY(x); }   // > 0 is sea
var CBD = [560, 620], PARK = [690, 705], CIVIC = [600, 540];

function zoneEast(cx, cy, r) {
  var dC = Math.hypot(cx - CBD[0], cy - CBD[1]);
  if (Math.hypot(cx - PARK[0], cy - PARK[1]) < 92) return 'park';
  if (Math.hypot(cx - CIVIC[0], cy - CIVIC[1]) < 30) return 'civic';
  if (dC < 150) return r < 0.62 ? 'finance' : (r < 0.8 ? 'retail' : (r < 0.88 ? 'public_safety_hq' : 'finance'));
  if (Math.hypot(cx - 790, cy - 430) < 66) return 'hospital';
  if (Math.hypot(cx - 960, cy - 250) < 78 || Math.hypot(cx - 430, cy - 250) < 46) return 'university';
  if (coastD(cx, cy) > -110 && cx > 800) return 'port';
  if (cx > 1080 && cy > 440 && cy < 690) return 'farm';
  if (Math.hypot(cx - 1090, cy - 110) < 72) return 'datacentre';
  return dC < 330 ? 'dense' : 'estate';
}

function generate() {
  var R = rng(20501207);
  var B = [];          // buildings
  var lots = [];       // empty-lot outlines appear where buildings are not built
  var G = 44, BLOCK = 36;

  function add(b) { b.id = B.length; b.h0 = b.h; b.r1 = R(); b.r2 = R(); b.r3 = R(); b.r4 = R(); B.push(b); return b; }

  /* ---- the east bank: the city ---- */
  for (var i = Math.floor(XMIN / G); i * G < XMAX; i++) {
    for (var j = Math.floor(YMIN / G); j * G < WORLD; j++) {
      var bx = i * G + 4, by = j * G + 4, cx = bx + BLOCK / 2, cy = by + BLOCK / 2;
      if (cx < riverX(cy) + RIVER_HALF + 34) continue;
      if (coastD(cx, cy) > -28) continue;
      var arterial = (i % 5 === 0) || (j % 5 === 0);
      var zone = zoneEast(cx, cy, R());
      var region = regionOf(cx, cy);
      var blk = { x: bx, y: by, w: BLOCK, d: BLOCK };
      lots.push(blk);
      fillBlock(add, R, blk, zone, region, arterial);
    }
  }
  /* ---- the west bank: industry, energy, data, the old port ---- */
  var G2 = 72, BL2 = 62;
  for (i = Math.floor(XMIN / G2); i * G2 < WORLD; i++) {
    for (j = Math.floor(YMIN / G2); j * G2 < WORLD; j++) {
      bx = i * G2 + 6; by = j * G2 + 6; cx = bx + BL2 / 2; cy = by + BL2 / 2;
      if (cx > riverX(cy) - RIVER_HALF - 30) continue;
      if (coastD(cx, cy) > -26) continue;
      var z;
      if (Math.hypot(cx - 120, cy - 430) < 130) z = 'tanks';
      else if (cy < 200) z = 'datacentre_w';
      else if (coastD(cx, cy) > -110) z = 'port_w';
      else z = 'factory';
      blk = { x: bx, y: by, w: BL2, d: BL2 };
      lots.push(blk);
      fillIndustry(add, R, blk, z);
    }
  }
  /* The arena, the one landmark that belongs to nobody. */
  add({ kind: 'dome', sector: null, cx: PARK[0], cy: PARK[1], r: 46, h: 16, x: PARK[0] - 46, y: PARK[1] - 46, w: 92, d: 92 });

  B.forEach(function (b) { b.depth = (b.x + b.w / 2) + (b.y + b.d / 2) + (b.kind === 'dome' ? 30 : 0); });
  B.sort(function (a, b) { return a.depth - b.depth; });

  var anchors = {};
  B.forEach(function (b) {
    if (!b.sector) return;
    var a = anchors[b.sector] || (anchors[b.sector] = { x: 0, y: 0, n: 0, h: 0, list: [] });
    a.x += b.x + b.w / 2; a.y += b.y + b.d / 2; a.n++; a.h = Math.max(a.h, b.h0); a.list.push(b);
  });
  Object.keys(anchors).forEach(function (k) { anchors[k].x /= anchors[k].n; anchors[k].y /= anchors[k].n; });
  /* Each industry's label sits over its most characteristic cluster, not
     the average of every clinic and station scattered through the estates. */
  var HOME = { finance: CBD, public_admin: CIVIC, healthcare: [790, 430], education_research: [960, 250],
               transport_logistics: [980, 740], food_agri: [1130, 560], compute_telecom: [1090, 110],
               energy_utilities: [120, 430], manufacturing: [200, 660], housing_construction: [900, 360],
               retail_commerce: [700, 560], care_services: [820, 230], public_safety: [480, 690] };
  Object.keys(HOME).forEach(function (k) { if (anchors[k]) { anchors[k].lx = HOME[k][0]; anchors[k].ly = HOME[k][1]; } });

  return { buildings: B, lots: lots, anchors: anchors };
}

function regionOf(x, y) {
  if (Math.hypot(x - CBD[0], y - CBD[1]) < 300) return 'central';
  if (x < riverX(y) + 260) return 'west';
  if (y < 300 && x < 880) return 'north';
  if (x >= 880 && y < 520) return 'north_east';
  return 'east';
}

function fillBlock(add, R, blk, zone, region, arterial) {
  var x = blk.x, y = blk.y, w = blk.w, d = blk.d, s;
  function box(dx, dy, bw, bd, h, sector, kind) {
    return add({ kind: kind || 'box', sector: sector, x: x + dx, y: y + dy, w: bw, d: bd, h: h, region: region });
  }
  if (zone === 'park') return;
  if (zone === 'finance') {
    var n = R() < 0.5 ? 1 : 2;
    for (s = 0; s < n; s++) box(3 + s * 17, 3 + (s ? 14 : 0), 15 + R() * 5, 15 + R() * 5, 70 + Math.pow(R(), 1.6) * 170, 'finance', 'tower');
    return;
  }
  if (zone === 'civic') {
    box(2, 2, 32, 32, 20, 'public_admin');
    box(12, 12, 12, 12, 78, 'public_admin', 'tower');
    return;
  }
  if (zone === 'public_safety_hq') { box(4, 6, 28, 22, 26, 'public_safety'); box(22, 4, 8, 8, 52, 'public_safety', 'tower'); return; }
  if (zone === 'retail') { box(2, 4, 32, 26, 20, 'retail_commerce'); box(8, 10, 18, 12, 30, 'retail_commerce'); return; }
  if (zone === 'hospital') {
    box(4, 12, 28, 12, 34, 'healthcare'); box(12, 2, 12, 32, 48, 'healthcare'); return;
  }
  if (zone === 'university') { box(2, 2, 32, 9, 18, 'education_research'); box(2, 11, 9, 23, 18, 'education_research'); box(20, 20, 12, 12, 30, 'education_research'); return; }
  if (zone === 'port') {
    if (R() < 0.5) { box(2, 4, 34, 14, 12, 'transport_logistics', 'shed'); box(2, 22, 34, 12, 10, 'transport_logistics', 'shed'); }
    else {
      for (var cx = 0; cx < 5; cx++) for (var cy = 0; cy < 3; cy++) box(3 + cx * 6.4, 6 + cy * 8.5, 5.4, 6.5, 3 + Math.floor(R() * 3) * 2.6, 'transport_logistics', 'container');
      if (R() < 0.35) add({ kind: 'crane', sector: 'transport_logistics', x: x + 30, y: y + 2, w: 3, d: 3, h: 52, region: region });
    }
    return;
  }
  if (zone === 'farm') {
    for (s = 0; s < 3; s++) box(2, 2 + s * 11.5, 32, 9, 5, 'food_agri', 'glass');
    return;
  }
  if (zone === 'datacentre') { box(2, 3, 32, 14, 16, 'compute_telecom', 'datacentre'); box(2, 21, 32, 12, 14, 'compute_telecom', 'datacentre'); return; }

  /* The estates and the dense grid, with the services scattered through
     them the way clinics, schools and stations actually are. */
  var roll = R();
  if (roll < 0.05) { box(4, 6, 26, 12, 12, 'care_services'); box(6, 22, 18, 10, 10, 'care_services'); return; }
  if (roll < 0.075) { box(6, 6, 22, 18, 13, 'public_safety'); box(26, 4, 6, 6, 28, 'public_safety', 'tower'); return; }
  if (roll < 0.11) { box(3, 3, 30, 8, 14, 'education_research'); box(3, 11, 8, 20, 14, 'education_research'); return; }
  if (roll < 0.13) { box(8, 8, 20, 20, 22, 'healthcare'); return; }
  if (arterial && roll < 0.33) { box(2, 2, 32, 14, 16, 'retail_commerce'); fillLow(box, R, 0, 18, 36, 18, 'housing_construction'); return; }
  if (roll < 0.36) { box(4, 10, 22, 10, 8, 'food_agri'); return; }   // a hawker centre
  if (zone === 'estate' && R() < 0.7) {
    if (R() < 0.5) { box(3, 5, 30, 8, 48 + R() * 34, 'housing_construction', 'slab'); box(3, 22, 30, 8, 44 + R() * 34, 'housing_construction', 'slab'); }
    else { box(5, 3, 8, 30, 50 + R() * 30, 'housing_construction', 'slab'); box(23, 3, 8, 30, 46 + R() * 34, 'housing_construction', 'slab'); }
    return;
  }
  fillLow(box, R, 0, 0, 36, 36, 'housing_construction');
}

function fillLow(box, R, ox, oy, w, d, sector) {
  var cols = Math.max(1, Math.round(w / 12)), rows = Math.max(1, Math.round(d / 12));
  var cw = w / cols, rh = d / rows;
  for (var a = 0; a < cols; a++) for (var b = 0; b < rows; b++) {
    if (R() < 0.08) continue;
    box(ox + a * cw + 1.2, oy + b * rh + 1.2, cw - 2.4 - R() * 2, rh - 2.4 - R() * 2, 6 + R() * 12, sector);
  }
}

function fillIndustry(add, R, blk, zone) {
  var x = blk.x, y = blk.y;
  function box(dx, dy, bw, bd, h, sector, kind) { return add({ kind: kind || 'box', sector: sector, x: x + dx, y: y + dy, w: bw, d: bd, h: h, region: 'industrial' }); }
  function tank(dx, dy, r, h, sector) { return add({ kind: 'tank', sector: sector, cx: x + dx, cy: y + dy, r: r, h: h, x: x + dx - r, y: y + dy - r, w: 2 * r, d: 2 * r, region: 'industrial' }); }
  if (zone === 'tanks') {
    if (R() < 0.6) {
      for (var a = 0; a < 3; a++) for (var b = 0; b < 3; b++) if (R() < 0.8) tank(12 + a * 19, 12 + b * 19, 6.5 + R() * 2.5, 9 + R() * 8, 'energy_utilities');
    } else {
      box(6, 10, 38, 28, 22, 'energy_utilities');
      add({ kind: 'chimney', sector: 'energy_utilities', cx: x + 52, cy: y + 16, r: 3.4, h: 80 + R() * 30, x: x + 48, y: y + 12, w: 8, d: 8, region: 'industrial' });
      add({ kind: 'chimney', sector: 'energy_utilities', cx: x + 52, cy: y + 40, r: 3.4, h: 70 + R() * 30, x: x + 48, y: y + 36, w: 8, d: 8, region: 'industrial' });
    }
    return;
  }
  if (zone === 'datacentre_w') { box(4, 6, 54, 20, 18, 'compute_telecom', 'datacentre'); box(4, 34, 54, 20, 16, 'compute_telecom', 'datacentre'); return; }
  if (zone === 'port_w') {
    box(4, 6, 54, 20, 13, 'transport_logistics', 'shed');
    for (var c = 0; c < 8; c++) for (var e = 0; e < 3; e++) box(4 + c * 6.8, 32 + e * 9, 5.6, 7, 3 + Math.floor(R() * 3) * 2.6, 'transport_logistics', 'container');
    if (R() < 0.5) add({ kind: 'crane', sector: 'transport_logistics', x: x + 56, y: y + 30, w: 3, d: 3, h: 60, region: 'industrial' });
    return;
  }
  box(4, 4, 56, 26, 14 + R() * 6, 'manufacturing', 'shed');
  box(4, 36, 34, 22, 12 + R() * 8, 'manufacturing', 'shed');
  if (R() < 0.5) add({ kind: 'chimney', sector: 'manufacturing', cx: x + 50, cy: y + 48, r: 2.6, h: 40 + R() * 20, x: x + 47, y: y + 45, w: 6, d: 6, region: 'industrial' });
}

var PLAN = null;
function plan() { return PLAN || (PLAN = generate()); }

/* ---------------------------------------------------------------------
   THE MAP
   --------------------------------------------------------------------- */
function create(host, opts) {
  opts = opts || {};
  var P = plan();
  host.classList.add('mmap');
  host.innerHTML = '';
  var base = document.createElement('canvas'); base.className = 'mmap-base';
  var dots = document.createElement('canvas'); dots.className = 'mmap-dots';
  var labels = document.createElement('div'); labels.className = 'mmap-labels';
  host.appendChild(base); host.appendChild(dots); host.appendChild(labels);
  var bctx = base.getContext('2d'), dctx = dots.getContext('2d');

  var HOME_VIEW = { zoom: 1.3, cx: 600, cy: 470 };
  var view = { zoom: HOME_VIEW.zoom, cx: HOME_VIEW.cx, cy: HOME_VIEW.cy };
  var W = 0, H = 0, DPR = 1, sc = 1, ox = 0, oy = 0;
  var state = null, peopleSpec = null, selected = null, layers = { labels: true, people: true };
  var hits = [];
  var dotsNow = [], dotsFrom = [], dotsTo = [], anim = null;

  function project(x, y, z) { return [ox + (x - y) * C * sc, oy + (x + y) * S * sc - (z || 0) * ZK * sc]; }
  function unproject(px, py) {
    var u = (px - ox) / (C * sc), v = (py - oy) / (S * sc);
    return [(u + v) / 2, (v - u) / 2];
  }

  function resize() {
    var r = host.getBoundingClientRect();
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(200, r.width); H = Math.max(200, r.height);
    [base, dots].forEach(function (c) {
      c.width = Math.round(W * DPR); c.height = Math.round(H * DPR);
      c.style.width = W + 'px'; c.style.height = H + 'px';
    });
    fit();
    render();
  }
  function fit() {
    var baseScale = Math.min(W / (WORLD * 2 * C), H / (WORLD * 2 * S));
    sc = baseScale * view.zoom;
    ox = W / 2 - (view.cx - view.cy) * C * sc;
    oy = H / 2 - (view.cx + view.cy) * S * sc;
  }

  /* ---- what a sector's state does to its buildings ---- */
  function look(b) {
    if (!b.sector || !state) return { built: true, hMul: 1, tint: null, slate: false, crane: false };
    var s = state.sectors[b.sector];
    var cap = s.capacity == null ? 1 : s.capacity;
    var builtShare = clamp(0.25 + 0.75 * cap, 0.4, 1);
    var bad = clamp((68 - s.quality) / 58, 0, 1);
    return {
      built: b.r1 < builtShare,
      hMul: 0.86 + 0.14 * clamp(cap, 0, 1.4),
      tint: b.r2 < bad ? (s.quality < 40 ? PAL.rust : PAL.amber) : null,
      slate: b.r3 < (s.automation || 0),
      crane: cap > 1.05 && b.r4 < (cap - 1) * 0.6 && b.kind !== 'container'
    };
  }

  /* ---- drawing ---- */
  function poly(ctx, pts, fill, stroke, lw) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 0.6; ctx.stroke(); }
  }

  function drawGround(ctx) {
    ctx.fillStyle = PAL.ground;
    ctx.fillRect(0, 0, W, H);
    // city blocks as a faint paving tone
    P.lots.forEach(function (l) {
      poly(ctx, [project(l.x - 3, l.y - 3), project(l.x + l.w + 3, l.y - 3), project(l.x + l.w + 3, l.y + l.d + 3), project(l.x - 3, l.y + l.d + 3)], PAL.block);
    });
    // parks
    ctx.save();
    ctx.beginPath();
    for (var a = 0; a <= 40; a++) {
      var t = a / 40 * Math.PI * 2, pt = project(PARK[0] + Math.cos(t) * 108, PARK[1] + Math.sin(t) * 96);
      if (a) ctx.lineTo(pt[0], pt[1]); else ctx.moveTo(pt[0], pt[1]);
    }
    ctx.fillStyle = PAL.park; ctx.fill();
    ctx.restore();
    drawRoads(ctx);
    drawWater(ctx);
  }

  function strokePath(ctx, pts, width, color) {
    ctx.beginPath();
    pts.forEach(function (p, i) { var q = project(p[0], p[1]); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); });
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
  }
  function road(ctx, pts, worldWidth) {
    var px = Math.max(0.8, worldWidth * sc * 0.72);
    strokePath(ctx, pts, px + 1.4, PAL.casing);
    strokePath(ctx, pts, px, worldWidth > 10 ? PAL.artery : PAL.road);
  }
  function drawRoads(ctx) {
    var G = 44;
    for (var i = Math.floor(XMIN / G); i * G <= XMAX; i++) {
      var xL = i * G, seg = [];
      for (var y = YMIN; y <= WORLD; y += 22) {
        var inside = xL > riverX(y) + RIVER_HALF + 26 && coastD(xL, y) < -20;
        if (inside) seg.push([xL, y]);
        else { if (seg.length > 1) road(ctx, seg, i % 5 === 0 ? 12 : 6); seg = []; }
      }
      if (seg.length > 1) road(ctx, seg, i % 5 === 0 ? 12 : 6);
    }
    for (var j = Math.floor(YMIN / G); j * G <= WORLD; j++) {
      var yL = j * G; seg = [];
      for (var x = XMIN; x <= XMAX; x += 22) {
        inside = x > riverX(yL) + RIVER_HALF + 26 && coastD(x, yL) < -20;
        if (inside) seg.push([x, yL]);
        else { if (seg.length > 1) road(ctx, seg, j % 5 === 0 ? 12 : 6); seg = []; }
      }
      if (seg.length > 1) road(ctx, seg, j % 5 === 0 ? 12 : 6);
    }
    // industrial roads, sparser
    for (i = Math.floor(XMIN / 72); i * 72 <= WORLD; i++) {
      seg = [];
      for (y = YMIN; y <= WORLD; y += 24) {
        inside = i * 72 < riverX(y) - RIVER_HALF - 20 && coastD(i * 72, y) < -18;
        if (inside) seg.push([i * 72, y]); else { if (seg.length > 1) road(ctx, seg, 7); seg = []; }
      }
      if (seg.length > 1) road(ctx, seg, 7);
    }
    for (j = Math.floor(YMIN / 72); j * 72 <= WORLD; j++) {
      seg = [];
      for (x = XMIN; x <= WORLD; x += 24) {
        inside = x < riverX(j * 72) - RIVER_HALF - 20 && coastD(x, j * 72) < -18;
        if (inside) seg.push([x, j * 72]); else { if (seg.length > 1) road(ctx, seg, 7); seg = []; }
      }
      if (seg.length > 1) road(ctx, seg, 7);
    }
    // expressways along both banks and the coast
    var east = [], west = [];
    RIVER.forEach(function (p) {
      if (coastD(p[0] + 44, p[1]) < -16) east.push([p[0] + RIVER_HALF + 16, p[1]]);
      if (coastD(p[0] - 44, p[1]) < -16) west.push([p[0] - RIVER_HALF - 14, p[1]]);
    });
    road(ctx, east, 16); road(ctx, west, 12);
    var coast = [];
    for (x = riverX(760) + RIVER_HALF + 20; x <= WORLD; x += 20) coast.push([x, coastY(x) - 30]);
    road(ctx, coast, 14);
    // two bridges
    [[520, 0], [250, 0]].forEach(function (b) {
      var rx = riverX(b[0]);
      road(ctx, [[rx - RIVER_HALF - 20, b[0]], [rx + RIVER_HALF + 22, b[0]]], 13);
    });
  }

  function drawWater(ctx) {
    // the sea
    ctx.beginPath();
    var first = true;
    for (var x = XMIN - 600; x <= XMAX + 300; x += 16) {
      var p = project(x, coastY(x));
      if (first) { ctx.moveTo(p[0], p[1]); first = false; } else ctx.lineTo(p[0], p[1]);
    }
    [project(XMAX + 300, WORLD + 1600), project(XMIN - 600, WORLD + 1600)].forEach(function (q) { ctx.lineTo(q[0], q[1]); });
    ctx.closePath();
    ctx.fillStyle = PAL.water; ctx.fill();
    ctx.strokeStyle = PAL.shore; ctx.lineWidth = 1; ctx.stroke();
    // the river
    var left = [], right = [];
    RIVER.forEach(function (q) { left.push(project(q[0] - RIVER_HALF, q[1])); right.push(project(q[0] + RIVER_HALF, q[1])); });
    poly(ctx, left.concat(right.reverse()), PAL.water, PAL.shore, 0.9);
    // the faceted light across water, as in a massing render
    ctx.save();
    ctx.strokeStyle = PAL.waterLine; ctx.lineWidth = 0.7;
    var fan = project(560, 1180);
    for (var k = 0; k < 30; k++) {
      var tx = -500 + k * 70, ty = coastY(tx) + 8 + (k % 3) * 10;
      var q = project(tx, ty);
      ctx.beginPath(); ctx.moveTo(fan[0], fan[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
    }
    ctx.restore();
  }

  function drawShadow(ctx, b, h) {
    var sx = h * 0.42, sy = h * 0.2;
    if (b.kind === 'tank' || b.kind === 'chimney' || b.kind === 'dome') {
      var c0 = project(b.cx + sx * 0.5, b.cy + sy * 0.5);
      ctx.beginPath();
      ctx.ellipse(c0[0], c0[1], b.r * 1.414 * C * sc + sx * C * sc * 0.4, b.r * 1.414 * S * sc + sy * S * sc * 0.4, 0, 0, Math.PI * 2);
      ctx.fillStyle = PAL.shadow; ctx.fill();
      return;
    }
    var x = b.x, y = b.y, w = b.w, d = b.d;
    poly(ctx, [project(x + w, y), project(x + w + sx, y + sy), project(x + w + sx, y + d + sy),
               project(x + sx, y + d + sy), project(x, y + d), project(x + w, y + d)], PAL.shadow);
  }

  function drawBox(ctx, b, h, lk) {
    var x = b.x, y = b.y, w = b.w, d = b.d;
    var col = lk.tint || PAL;
    var t = [project(x, y, h), project(x + w, y, h), project(x + w, y + d, h), project(x, y + d, h)];
    var south = [project(x, y + d, 0), project(x + w, y + d, 0), project(x + w, y + d, h), project(x, y + d, h)];
    var east = [project(x + w, y, 0), project(x + w, y + d, 0), project(x + w, y + d, h), project(x + w, y, h)];
    var glass = b.kind === 'glass';
    poly(ctx, south, glass ? '#DCE5EC' : col.south, PAL.edge, 0.5);
    poly(ctx, east, glass ? '#C5D2DD' : col.east, PAL.edge, 0.5);
    poly(ctx, t, lk.slate ? PAL.slate : (glass ? '#EAF0F4' : col.top), PAL.edge, 0.5);
    // a little vertical rhythm on the tall buildings, like floor lines in a model
    if ((b.kind === 'tower' || b.kind === 'slab') && sc > 0.55) {
      ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 0.6;
      for (var f = 14; f < h; f += 14) {
        var a = project(x, y + d, f), c = project(x + w, y + d, f), e = project(x + w, y, f);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(e[0], e[1]); ctx.stroke();
      }
    }
    if (b.kind === 'datacentre' || lk.slate) {
      var u = project(x + w * 0.3, y + d * 0.4, h), v = project(x + w * 0.7, y + d * 0.6, h);
      ctx.fillStyle = 'rgba(80,92,110,0.35)';
      ctx.fillRect(Math.min(u[0], v[0]), Math.min(u[1], v[1]) - 1, Math.abs(v[0] - u[0]) * 0.5 + 1, 2);
    }
    return [t[0], t[1], east[1], east[0], south[0], south[3]];
  }

  function drawCylinder(ctx, b, h, lk) {
    var p = project(b.cx, b.cy, 0), rx = b.r * 1.414 * C * sc, ry = b.r * 1.414 * S * sc, hh = h * ZK * sc;
    var col = lk.tint || PAL;
    var grad = ctx.createLinearGradient(p[0] - rx, 0, p[0] + rx, 0);
    grad.addColorStop(0, col.south); grad.addColorStop(1, col.east);
    ctx.beginPath();
    ctx.moveTo(p[0] - rx, p[1] - hh);
    ctx.lineTo(p[0] - rx, p[1]);
    ctx.ellipse(p[0], p[1], rx, ry, 0, Math.PI, 0, true);
    ctx.lineTo(p[0] + rx, p[1] - hh);
    ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();
    ctx.strokeStyle = PAL.edge; ctx.lineWidth = 0.5; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(p[0], p[1] - hh, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = lk.slate ? PAL.slate : col.top; ctx.fill(); ctx.stroke();
    if (b.kind === 'dome') {
      ctx.beginPath(); ctx.ellipse(p[0], p[1] - hh, rx * 0.72, ry * 0.72, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#E3E8EE'; ctx.fill(); ctx.stroke();
      for (var k = 0; k < 12; k++) {
        var ang = k / 12 * Math.PI * 2;
        ctx.beginPath(); ctx.moveTo(p[0] + Math.cos(ang) * rx * 0.72, p[1] - hh + Math.sin(ang) * ry * 0.72);
        ctx.lineTo(p[0] + Math.cos(ang) * rx, p[1] - hh + Math.sin(ang) * ry); ctx.stroke();
      }
    }
    return [[p[0] - rx, p[1] - hh - ry], [p[0] + rx, p[1] - hh - ry], [p[0] + rx, p[1] + ry], [p[0] - rx, p[1] + ry]];
  }

  function drawCrane(ctx, b, h) {
    var foot = project(b.x, b.y, 0), top = project(b.x, b.y, h), jib = project(b.x - 26, b.y + 8, h);
    ctx.strokeStyle = PAL.crane; ctx.lineWidth = Math.max(1, 1.2 * sc);
    ctx.beginPath(); ctx.moveTo(foot[0], foot[1]); ctx.lineTo(top[0], top[1]); ctx.lineTo(jib[0], jib[1]); ctx.stroke();
    ctx.lineWidth = 0.6;
    var hang = project(b.x - 20, b.y + 6, h * 0.55);
    var hj = project(b.x - 20, b.y + 6, h);
    ctx.beginPath(); ctx.moveTo(hj[0], hj[1]); ctx.lineTo(hang[0], hang[1]); ctx.stroke();
  }

  function render() {
    if (!W) return;
    fit();
    bctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawGround(bctx);
    hits = [];
    var looks = P.buildings.map(look);
    // shadows first, beneath everything
    P.buildings.forEach(function (b, i) {
      var lk = looks[i];
      if (b.kind === 'crane' || !lk.built) return;
      drawShadow(bctx, b, b.h0 * lk.hMul);
    });
    P.buildings.forEach(function (b, i) {
      var lk = looks[i];
      var h = b.h0 * lk.hMul;
      if (!lk.built) {
        if (b.kind !== 'crane' && b.kind !== 'container') {
          poly(bctx, [project(b.x, b.y), project(b.x + b.w, b.y), project(b.x + b.w, b.y + b.d), project(b.x, b.y + b.d)], PAL.lotFill, PAL.lot, 1.1);
        }
        return;
      }
      var hull;
      if (b.kind === 'crane') { drawCrane(bctx, b, h); return; }
      if (b.kind === 'tank' || b.kind === 'chimney' || b.kind === 'dome') hull = drawCylinder(bctx, b, h, lk);
      else hull = drawBox(bctx, b, h, lk);
      if (lk.crane) drawCrane(bctx, { x: b.x + b.w, y: b.y + b.d * 0.5 }, h + 36);
      if (selected && b.sector === selected) {
        bctx.save(); bctx.globalAlpha = 0.22;
        poly(bctx, hull, '#A8624C'); bctx.restore();
      }
      if (b.sector) hits.push({ sector: b.sector, hull: hull });
    });
    drawLabels();
    drawDots(1);
  }

  /* ---- labels ---- */
  function drawLabels() {
    labels.innerHTML = '';
    if (!layers.labels || !state) return;
    var placed = [];
    Object.keys(P.anchors).forEach(function (k) {
      var a = P.anchors[k], s = state.sectors[k];
      if (!s) return;
      var foot = project(a.lx, a.ly, 0);
      var p = project(a.lx, a.ly, Math.min(120, a.h * 0.8) + 30);
      var el = document.createElement('button');
      var band = s.quality >= 65 ? 'good' : (s.quality >= 40 ? 'mid' : 'bad');
      el.className = 'mmap-chip ' + band + (selected === k ? ' on' : '');
      el.setAttribute('data-k', k);
      el.innerHTML = '<i></i><span>' + NAMES[k] + '</span><b>' + s.quality + '</b>';
      var w = 30 + NAMES[k].length * 6.6 + 26, hgt = 22;
      /* Nearest free spot: sideways before upward, so a label stays over
         its own district instead of drifting into someone else's. */
      var x = p[0], y = p[1];
      var clashes = function (cx, cy) {
        return placed.some(function (q) { return Math.abs(q.x - cx) < (q.w + w) / 2 + 6 && Math.abs(q.y - cy) < hgt + 4; });
      };
      var offsets = [[0, 0], [0.6, 0], [-0.6, 0], [0, -26], [0.6, -26], [-0.6, -26], [1.2, 0], [-1.2, 0], [0, -52], [0.9, -52], [-0.9, -52], [0, -78]];
      for (var t = 0; t < offsets.length; t++) {
        var cx = p[0] + offsets[t][0] * w, cy = p[1] + offsets[t][1];
        if (!clashes(cx, cy)) { x = cx; y = cy; break; }
        if (t === offsets.length - 1) { x = cx; y = cy; }
      }
      placed.push({ x: x, y: y, w: w });
      if (x < -80 || x > W + 80 || y < -40 || y > H + 40) return;
      el.style.left = x + 'px'; el.style.top = y + 'px';
      labels.appendChild(el);
      var line = document.createElement('div');
      line.className = 'mmap-leader';
      /* The leader drops from the chip to the district's ground point. */
      line.style.left = x + 'px'; line.style.top = y + 'px';
      var dx = foot[0] - x, dy = foot[1] - y;
      line.style.height = Math.max(0, Math.hypot(dx, dy)) + 'px';
      line.style.transformOrigin = '0 0';
      line.style.transform = 'rotate(' + (Math.atan2(dy, dx) * 180 / Math.PI - 90) + 'deg)';
      labels.appendChild(line);
    });
  }

  /* ---- people ---- */
  var PER_DOT = 5000;
  var civicSpot = CIVIC, pier = [930, 800];

  function frontOf(b, seed) {
    return [b.x + b.w * (0.2 + 0.6 * seed), b.y + b.d + 4 + seed * 3];
  }
  function homeSpot(region, seed) {
    var pool = HOMES[region] || HOMES.east;
    var b = pool[Math.floor(seed * pool.length) % pool.length];
    return frontOf(b, (seed * 97) % 1);
  }
  function workSpot(sector, seed) {
    var a = P.anchors[sector];
    if (!a) return homeSpot('central', seed);
    var b = a.list[Math.floor(seed * a.list.length) % a.list.length];
    return frontOf(b, (seed * 31) % 1);
  }
  var HOMES = null;
  function homes() {
    if (HOMES) return HOMES;
    HOMES = {};
    P.buildings.forEach(function (b) {
      if (b.sector !== 'housing_construction') return;
      (HOMES[b.region] = HOMES[b.region] || []).push(b);
    });
    HOMES.east = HOMES.east || HOMES.central;
    return HOMES;
  }

  /* The dots for a year: who is where, doing what. */
  function targetsFor() {
    homes();
    var out = [];
    if (!state || !layers.people) return out;
    if (peopleSpec && peopleSpec.length) {
      peopleSpec.forEach(function (p) {
        var n = Math.max(1, Math.round((p.w || PER_DOT) / PER_DOT));
        for (var i = 0; i < n; i++) {
          var sd = hash(p.id + ':' + i);
          var role = roleOf(p), pos;
          if (role === 'left') pos = [pier[0] + (sd - 0.5) * 90, pier[1] + ((sd * 7) % 1 - 0.5) * 30];
          else if (role === 'protest' && p.act !== 'strike') pos = [civicSpot[0] + (sd - 0.5) * 70, civicSpot[1] + 40 + ((sd * 13) % 1 - 0.5) * 40];
          else if (role === 'working' || p.act === 'strike') pos = workSpot(p.k || 'retail_commerce', sd);
          else pos = homeSpot(p.r === 'north_east' ? 'north_east' : (p.r || 'east'), sd);
          out.push({ key: p.id + ':' + i, x: pos[0], y: pos[1], role: role });
        }
      });
      return out;
    }
    /* Trial: nobody is deciding, so the dots show only the country's shape —
       who has work, who does not, who is retired — from the engine itself. */
    var pop = state.population, adults = pop.by_age.age_20_64 + pop.by_age.age_65_plus;
    var employedShare = pop.employed_total / adults, elderShare = pop.by_age.age_65_plus / adults;
    var n = Math.round(adults / PER_DOT);
    var weights = [], total = 0;
    Object.keys(state.sectors).forEach(function (k) { total += state.sectors[k].headcount; weights.push([k, total]); });
    var regions = ['central', 'west', 'north', 'north_east', 'east'];
    for (var i = 0; i < n; i++) {
      var u = hash('dot' + i), u2 = hash('work' + i), u3 = hash('home' + i);
      var role = u < employedShare ? 'working' : (u < employedShare + elderShare ? 'other' : 'out');
      var pos;
      if (role === 'working') {
        var target = u2 * total, sector = weights[weights.length - 1][0];
        for (var w = 0; w < weights.length; w++) if (target <= weights[w][1]) { sector = weights[w][0]; break; }
        pos = workSpot(sector, u3);
      } else pos = homeSpot(regions[Math.floor(u3 * regions.length)], (u3 * 53) % 1);
      out.push({ key: 'dot' + i, x: pos[0], y: pos[1], role: role });
    }
    return out;
  }
  function roleOf(p) {
    if (p.d || p.act === 'left') return 'left';
    if (p.act === 'strike' || p.act === 'protest' || p.act === 'riot') return 'protest';
    if (p.act === 'mutual_aid') return 'aid';
    if (p.act === 'organise') return 'organise';
    if (p.s === 'employed') return 'working';
    if (p.s === 'unemployed') return 'out';
    return 'other';
  }

  function drawDots(progress) {
    dctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    dctx.clearRect(0, 0, W, H);
    if (!layers.people) return;
    var r = clamp(2.6 * Math.sqrt(sc * 1.6), 2.3, 4.6);
    var e = progress < 1 ? (progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2) : 1;
    dotsNow.forEach(function (d) {
      var x = d.fx + (d.tx - d.fx) * e, y = d.fy + (d.ty - d.fy) * e;
      var p = project(x, y, 1.5);
      if (p[0] < -5 || p[1] < -5 || p[0] > W + 5 || p[1] > H + 5) return;
      var role = ROLE[d.role] || ROLE.other;
      dctx.beginPath();
      dctx.arc(p[0], p[1], r, 0, Math.PI * 2);
      if (role.ring) { dctx.strokeStyle = role.color; dctx.lineWidth = 1; dctx.stroke(); }
      else {
        dctx.fillStyle = 'rgba(255,255,255,0.92)'; dctx.fill();
        dctx.beginPath(); dctx.arc(p[0], p[1], r * 0.74, 0, Math.PI * 2);
        dctx.fillStyle = role.color; dctx.fill();
      }
    });
  }

  function movePeople() {
    var targets = targetsFor();
    var prev = {};
    dotsNow.forEach(function (d) {
      var e = anim ? 1 : 1;
      prev[d.key] = { x: d.tx * e + d.fx * (1 - e), y: d.ty * e + d.fy * (1 - e) };
    });
    dotsNow = targets.map(function (t) {
      var from = prev[t.key] || { x: t.x, y: t.y };
      return { key: t.key, role: t.role, fx: from.x, fy: from.y, tx: t.x, ty: t.y };
    });
    if (anim) cancelAnimationFrame(anim.raf);
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { drawDots(1); anim = null; return; }
    var t0 = performance.now(), dur = 900;
    anim = {};
    (function frame(now) {
      var k = Math.min(1, (now - t0) / dur);
      drawDots(k);
      if (k < 1) anim.raf = requestAnimationFrame(frame);
      else anim = null;
    })(t0);
  }

  /* ---- interaction ---- */
  var drag = null;
  host.addEventListener('pointerdown', function (e) {
    if (e.target.closest('.mmap-chip')) return;
    drag = { x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy, moved: false };
    host.setPointerCapture(e.pointerId);
  });
  host.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (!drag.moved) return;
    var u = -dx / (C * sc), v = -dy / (S * sc);
    view.cx = clamp(drag.cx + (u + v) / 2, 0, WORLD);
    view.cy = clamp(drag.cy + (v - u) / 2, 0, WORLD);
    schedule();
  });
  host.addEventListener('pointerup', function (e) {
    if (drag && !drag.moved) pick(e);
    drag = null;
  });
  host.addEventListener('wheel', function (e) {
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12);
  }, { passive: false });
  labels.addEventListener('click', function (e) {
    var chip = e.target.closest('.mmap-chip');
    if (chip) { select(chip.getAttribute('data-k')); }
  });

  function pick(e) {
    var r = host.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    for (var i = hits.length - 1; i >= 0; i--) {
      if (inside(px, py, hits[i].hull)) { select(hits[i].sector); return; }
    }
    select(null);
  }
  function inside(x, y, pts) {
    var c = false;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      if (((pts[i][1] > y) !== (pts[j][1] > y)) && (x < (pts[j][0] - pts[i][0]) * (y - pts[i][1]) / (pts[j][1] - pts[i][1]) + pts[i][0])) c = !c;
    }
    return c;
  }
  var pending = null;
  function schedule() { if (pending) return; pending = requestAnimationFrame(function () { pending = null; render(); }); }
  function zoomBy(f) { view.zoom = clamp(view.zoom * f, 0.55, 5); schedule(); }
  function select(k) {
    selected = k;
    render();
    if (opts.onSelect) opts.onSelect(k);
  }

  var ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(function () { resize(); }) : null;
  if (ro) ro.observe(host); else window.addEventListener('resize', resize);
  resize();

  return {
    setState: function (s, people) {
      state = s; peopleSpec = people || null;
      render();
      movePeople();
    },
    select: select,
    zoomIn: function () { zoomBy(1.25); },
    zoomOut: function () { zoomBy(1 / 1.25); },
    reset: function () { view = { zoom: HOME_VIEW.zoom, cx: HOME_VIEW.cx, cy: HOME_VIEW.cy }; render(); drawDots(1); },
    setLayers: function (l) { Object.keys(l).forEach(function (k) { layers[k] = l[k]; }); render(); movePeople(); },
    resize: resize,
    stats: function () { return { buildings: P.buildings.length, dots: dotsNow.length }; }
  };
}

var NAMES = {
  healthcare: 'Healthcare', care_services: 'Care', education_research: 'Education', transport_logistics: 'Port & transport',
  energy_utilities: 'Energy', compute_telecom: 'Compute', housing_construction: 'Housing', food_agri: 'Food',
  manufacturing: 'Manufacturing', finance: 'Finance', retail_commerce: 'Retail', public_admin: 'Civic centre', public_safety: 'Public safety'
};

root.MeridianMap = { create: create, ROLE: ROLE, NAMES: NAMES, PALETTE: PAL };
})(typeof window !== 'undefined' ? window : globalThis);
