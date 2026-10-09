/* =====================================================================
   MERIDIAN CITY VIEW
   ---------------------------------------------------------------------
   Thirteen buildings on an isometric plate, coloured by service quality and
   sized by capacity. Ported from the original world-state monitor so the
   two renders stay recognisably the same city, but driven directly from
   an engine world-state object instead of a hand-authored JSON file.

   The projection is a CSS matrix trick: every face is a plain div with a
   2D transform that lands it on one of the three isometric planes. No
   canvas, no WebGL, no library.

       proj(i, j, k) -> screen point
       i, j = position on the ground grid, k = height in storeys

   render(state, host, opts) redraws the whole plate. It is cheap enough
   to call on every lever drag.
   ===================================================================== */

(function (root) {
'use strict';

/* --- projection constants, unchanged from the original monitor ------- */
var HW = 58, HH = 26, UZ = 66, S = 100, OX = 640, OY = 215;
var SP = 3.1, FX = 1.7, FY = 1.7;
var SCENE_W = 1400, SCENE_H = 780;

/* --- what each sector looks like as a building ----------------------- */
var META = {
  finance:              { name: 'Finance',                h: 2.70, roof: 'tower', fx: 1.5, fy: 1.5 },
  housing_construction: { name: 'Housing & Construction', h: 2.35, roof: 'tank' },
  compute_telecom:      { name: 'Compute & Telecom',      h: 1.90, roof: 'solar' },
  energy_utilities:     { name: 'Energy & Utilities',     h: 1.60, roof: 'tank' },
  healthcare:           { name: 'Healthcare',             h: 1.50, roof: 'dome' },
  care_services:        { name: 'Care Services',          h: 1.45, roof: 'vents', fx: 1.8, fy: 1.8 },
  manufacturing:        { name: 'Manufacturing',          h: 1.35, roof: 'vents', fx: 1.8, fy: 1.5 },
  public_admin:         { name: 'Public Administration',  h: 1.30, roof: 'dome' },
  education_research:   { name: 'Education & Research',   h: 1.20, roof: 'vents' },
  public_safety:        { name: 'Public Safety',          h: 1.20, roof: 'mast' },
  retail_commerce:      { name: 'Retail & Commerce',      h: 1.10, roof: 'solar' },
  food_agri:            { name: 'Food & Agri',            h: 1.05, roof: 'silo' },
  transport_logistics:  { name: 'Transport & Logistics',  h: 0.95, roof: 'mast' }
};
/* Ordered tallest-first, because a slot's depth on the plate decides what
   draws in front of what. Tall buildings sit at the back of the grid so
   they do not hide the short ones. */
var ORDER = ['finance','compute_telecom','energy_utilities','housing_construction',
             'healthcare','manufacturing','care_services','public_admin',
             'education_research','public_safety','retail_commerce','food_agri',
             'transport_logistics'];
/* Thirteen positions on a 5x3 plate with two gaps, so the ring still reads
   as a city rather than a spreadsheet. Was ten on a 4x3; an eleventh
   sector used to index past the end of this array and throw when the page
   opened, which is the worst moment to discover a layout constant. */
var SLOTS = [[0,0],[1,0],[2,0],[3,0],[4,0],
             [0,1],      [2,1],      [4,1],
             [0,2],[1,2],[2,2],[3,2],[4,2]];

var BANDS = {
  healthy:  { top:'#E4EDDC', right:'#B9CFB2', left:'#9CB795', win:'rgba(255,255,255,0.66)', chip:'#7FA476', label:'healthy'  },
  strained: { top:'#F2E7C9', right:'#DFC79B', left:'#C7AA75', win:'rgba(255,255,255,0.52)', chip:'#C9A45E', label:'strained' },
  failing:  { top:'#E0C0B4', right:'#C08D80', left:'#A26E62', win:'rgba(86,62,54,0.55)',    chip:'#AE6450', label:'failing'  }
};

/* --- primitives ------------------------------------------------------- */
function proj(i, j, k){ return [(i - j) * HW + OX, (i + j) * HH - k * UZ + OY]; }

function q(P, a, b, c, d, w, h, extra, kids){
  return '<div style="position:absolute;left:0;top:0;width:' + w + 'px;height:' + h +
    'px;transform-origin:0 0;transform:matrix(' + a + ',' + b + ',' + c + ',' + d + ',' +
    P[0] + ',' + P[1] + ');box-sizing:border-box;' + (extra || '') + '">' + (kids || '') + '</div>';
}
function top(i, j, k, fx, fy, extra, kids){
  return q(proj(i,j,k), HW/S, HH/S, -HW/S, HH/S, fx*S, fy*S, extra, kids);
}
function right(i, j, k, fy, h, extra, kids){
  return q(proj(i,j,k), -HW/S, HH/S, 0, UZ/S, fy*S, h*S, extra, kids);
}
function left(i, j, k, fx, h, extra, kids){
  return q(proj(i,j,k), HW/S, HH/S, 0, UZ/S, fx*S, h*S, extra, kids);
}

/* A box is three faces. Painted right, left, top so the top lands on top. */
function box(i, j, k0, fx, fy, h, c, kidsR, kidsL, kidsT){
  return right(i+fx, j, k0+h, fy, h,
      'background:' + c.right + ';border-radius:3px 3px 1px 1px;' +
      'background-image:linear-gradient(to bottom,rgba(255,255,255,0.16),rgba(0,0,0,0.05));', kidsR) +
    left(i, j+fy, k0+h, fx, h,
      'background:' + c.left + ';border-radius:3px 3px 1px 1px;' +
      'background-image:linear-gradient(to bottom,rgba(255,255,255,0.10),rgba(0,0,0,0.08));', kidsL) +
    top(i, j, k0+h, fx, fy, 'background:' + c.top + ';border-radius:6px;', kidsT);
}

/* Lit windows read as a working building. Dark and cracked ones read as a
   failing one, which is the whole point of the view. */
function windows(w, h, bandKey, fail){
  var cols = Math.max(2, Math.round(w/55)), rows = Math.max(1, Math.floor(h/62));
  var ww = 26, wh = 30, out = '';
  var gapX = (w - cols*ww)/(cols+1), gapY = (h - rows*wh)/(rows+1);
  for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++){
    var dead = fail ? ((r*3 + c*5) % 3 !== 1) : (bandKey === 'strained' && (r+c) % 4 === 0);
    out += '<div style="position:absolute;left:' + (gapX + c*(ww+gapX)) + 'px;top:' +
      (gapY + r*(wh+gapY)) + 'px;width:' + ww + 'px;height:' + wh + 'px;box-sizing:border-box;background:' +
      (dead ? (fail ? 'rgba(70,56,48,0.55)' : 'rgba(120,116,104,0.35)') : BANDS[bandKey].win) +
      ';border-radius:2px;' +
      (dead && fail ? 'background-image:linear-gradient(45deg,transparent 46%,rgba(60,48,42,0.55) 46% 54%,transparent 54%);' : '') +
      '"></div>';
  }
  if (fail){
    out += '<div style="position:absolute;left:8%;top:-4px;width:3px;height:74%;background:rgba(74,60,54,0.38);transform:rotate(9deg)"></div>';
    out += '<div style="position:absolute;left:62%;top:18%;width:2px;height:58%;background:rgba(74,60,54,0.3);transform:rotate(-13deg)"></div>';
    out += '<div style="position:absolute;left:0;right:0;bottom:6px;height:16px;opacity:.72;' +
      'background-image:repeating-linear-gradient(115deg,rgba(176,112,92,.9) 0 12px,rgba(201,172,114,.9) 12px 24px)"></div>';
  }
  return out;
}

/* Roofs are how you tell a hospital from a data centre at a glance. */
function roof(type, i, j, h, fx, fy, c, fail){
  var cx = i + fx/2, cy = j + fy/2, out = '';
  var dark = { top:c.top, right:c.right, left:c.left };
  if (type === 'dome'){
    out += box(cx-0.45, cy-0.45, h, 0.9, 0.9, 0.18, dark);
    out += top(cx-0.42, cy-0.42, h+0.18, 0.84, 0.84,
      'background:' + (fail ? '#C0AA9E' : '#F2EEE4') + ';border-radius:50%;box-shadow:inset 0 -6px 12px rgba(59,66,62,.10);');
    out += top(cx-0.12, cy-0.12, h+0.22, 0.24, 0.24,
      'background:' + (fail ? '#B0705C' : '#B98A72') + ';border-radius:50%;');
  } else if (type === 'mast'){
    out += box(cx-0.06, cy-0.06, h, 0.12, 0.12, fail ? 0.5 : 1.0, { top:'#C3C7BE', right:'#AAB0A6', left:'#949B92' });
    out += top(cx-0.18, cy-0.18, h + (fail ? 0.5 : 1.0), 0.36, 0.36,
      'background:' + (fail ? '#8E3A23' : '#7FA3AC') + ';border-radius:50%;');
  } else if (type === 'tank'){
    out += box(cx-0.3, cy-0.3, h, 0.6, 0.6, 0.35, dark);
    out += top(cx-0.3, cy-0.3, h+0.35, 0.6, 0.6,
      'background:' + (fail ? '#6E2818' : '#DCE7E6') + ';border-radius:50%;');
  } else if (type === 'silo'){
    out += box(i+0.25, j+0.3, h, 0.42, 0.42, 0.75, dark);
    out += top(i+0.25, j+0.3, h+0.75, 0.42, 0.42, 'background:' + (fail ? '#6E2818' : '#F1ECE0') + ';border-radius:50%;');
    out += box(i+fx-0.7, j+fy-0.72, h, 0.42, 0.42, 0.55, dark);
    out += top(i+fx-0.7, j+fy-0.72, h+0.55, 0.42, 0.42, 'background:' + (fail ? '#6E2818' : '#F1ECE0') + ';border-radius:50%;');
  } else if (type === 'tower'){
    out += box(cx-0.35, cy-0.35, h, 0.7, 0.7, 0.7, dark);
    out += box(cx-0.08, cy-0.08, h+0.7, 0.16, 0.16, fail ? 0.2 : 0.55, { top:'#C3C7BE', right:'#AAB0A6', left:'#949B92' });
  } else if (type === 'solar'){
    for (var n = 0; n < 3; n++){
      out += top(i + 0.22 + n*0.44, j + 0.25, h + 0.02, 0.3, fx - 0.5,
        'background:' + (fail ? '#A9A296' : '#A8C0C2') + ';border-radius:2px;' +
        'background-image:repeating-linear-gradient(90deg,rgba(59,66,62,.16) 0 2px,transparent 2px 12px);');
    }
    out += box(i+fx-0.55, j+fy-0.6, h, 0.4, 0.4, 0.3, dark);
  } else { /* vents */
    out += box(i+0.3, j+0.35, h, 0.4, 0.35, 0.28, dark);
    out += box(i+fx-0.8, j+fy-0.7, h, 0.5, 0.35, 0.42, dark);
    out += top(i+fx-0.8, j+fy-0.7, h+0.42, 0.5, 0.35, 'background:' + (fail ? '#6E2818' : '#DCE7E6') + ';');
  }
  return out;
}

function tree(i, j, tone){
  return box(i, j, 0, 0.14, 0.14, 0.38, { top:'#B7A88F', right:'#A2917A', left:'#8D7C67' }) +
    top(i-0.22, j-0.22, 0.42, 0.6, 0.6, 'background:' + tone + ';border-radius:50%;') +
    top(i-0.14, j-0.14, 0.62, 0.44, 0.44, 'background:' + tone + ';border-radius:50%;filter:brightness(1.12);');
}

/* --- the plate: ground, parks, roads, reservoir ---------------------- */
function ground(){
  var out = box(-0.8, -0.8, -0.3, 12.5, 9.7, 0.3, { top:'#F0EBDD', right:'#E0DACB', left:'#D2CBB9' });
  [[0.6,6.2,3.4,2.6],[8.6,0.2,3.0,2.2],[4.4,8.4,3.6,1.6],[-0.4,2.4,1.6,3.0],[10.6,5.6,1.8,3.4],[3.0,-0.5,2.6,1.4]]
    .forEach(function(g){
      out += top(g[0], g[1], 0.014, g[2], g[3], 'background:rgba(150,172,138,0.28);border-radius:48% 42% 50% 44%;');
    });
  for (var c = 0; c < 3; c++){
    out += top(c*SP + 1.95, -0.8, 0.01, 0.86, 9.7,
      'background:#EFEADC;border-radius:5px;background-image:repeating-linear-gradient(90deg,rgba(255,255,255,.55) 0 30px,transparent 30px 58px);');
  }
  for (var r = 0; r < 2; r++){
    out += top(-0.8, r*SP + 1.95, 0.012, 12.5, 0.86,
      'background:#EFEADC;border-radius:5px;background-image:repeating-linear-gradient(0deg,rgba(255,255,255,.55) 0 30px,transparent 30px 58px);');
  }
  out += top(3.55, 3.35, 0.02, 2.7, 1.6, 'background:rgba(178,203,203,0.45);border-radius:50%;');
  [[0.2,5.4],[1.1,8.6],[7.4,8.9],[11.4,2.1],[10.9,7.8],[4.0,-0.2]].forEach(function(t, n){
    out += tree(t[0], t[1], n % 2 ? '#A9C29C' : '#93B189');
  });
  return out;
}

/* --------------------------------------------------------------------- */
function bandOf(q){ return q >= 65 ? 'healthy' : (q >= 40 ? 'strained' : 'failing'); }

/**
 * render(state, host, opts)
 *   state  a world-state object from the engine
 *   host   the element to draw into
 *   opts   { selected, onSelect, showSmoke }
 */
function render(state, host, opts){
  opts = opts || {};
  var html = '<div class="city-scene" style="position:absolute;left:0;top:0;width:' +
    SCENE_W + 'px;height:' + SCENE_H + 'px;">';
  html += ground();

  var items = [], smoke = '';

  ORDER.forEach(function(key, n){
    var sec = state.sectors[key];
    if (!sec) return;
    var m = META[key] || { name:key, h:1.2, roof:'vents' };
    var slot = SLOTS[n], i = slot[0]*SP, j = slot[1]*SP;
    var fx = m.fx || FX, fy = m.fy || FY;
    var bk = bandOf(sec.quality), c = BANDS[bk], fail = bk === 'failing';
    // Height carries capacity: a sector that cannot meet demand looks squat.
    var h = Math.max(0.5, m.h * (0.72 + (sec.capacity || 1) * 0.28));
    var sel = opts.selected === key;

    var g = '';
    g += top(i-0.2, j-0.2, 0.03, fx+0.5, fy+0.5, 'background:rgba(88,94,86,0.20);border-radius:46%;filter:blur(9px);');

    var wallExtra = fail
      ? 'background-image:repeating-linear-gradient(45deg,rgba(90,72,64,.10) 0 8px,transparent 8px 22px);' : '';
    var faces = right(i+fx, j, h, fy, h,
        'background:' + c.right + ';border-radius:3px 3px 1px 1px;' + wallExtra, windows(fy*S, h*S, bk, fail)) +
      left(i, j+fy, h, fx, h,
        'background:' + c.left + ';border-radius:3px 3px 1px 1px;' + wallExtra, windows(fx*S, h*S, bk, fail)) +
      top(i, j, h, fx, fy, 'background:' + c.top + ';border-radius:6px;' +
        (fail ? 'background-image:repeating-linear-gradient(90deg,rgba(90,72,64,.10) 0 7px,transparent 7px 20px);' : ''));
    g += faces;
    g += top(i+0.1, j+0.1, h+0.008, fx-0.2, fy-0.2,
      'background:' + c.chip + ';opacity:' + (sel ? 0.85 : 0.5) + ';border-radius:5px;');
    g += roof(m.roof, i, j, h, fx, fy, c, fail);

    if (fail){
      g += top(i+fx+0.14, j+0.2, 0.03, 0.34, 0.34, 'background:rgba(176,112,92,0.5);border-radius:40%;');
      g += top(i+0.4, j+fy+0.2, 0.03, 0.26, 0.26, 'background:rgba(140,132,118,0.45);border-radius:40%;');
      if (opts.showSmoke !== false){
        var P = proj(i + fx/2, j + fy/2, h + 0.35);
        for (var p = 0; p < 3; p++){
          smoke += '<div class="city-puff" style="left:' + (P[0]-17+p*9) + 'px;top:' + (P[1]-17) +
            'px;animation-delay:' + (p*1.4) + 's"></div>';
        }
      }
    }

    var lp = proj(i + fx/2, j + fy/2, h + (fail ? 1.2 : 0.6) + (2 - slot[1]) * 0.16);
    items.push({
      depth: i + j, key: key,
      body: '<div class="city-group" data-k="' + key + '" role="button" tabindex="0" aria-label="' +
        m.name + ', quality ' + sec.quality + '">' + g + '</div>',
      label: { key:key, name:m.name, q:sec.quality, chip:c.chip, fail:fail, x:lp[0], y:lp[1], sel:sel }
    });
  });

  // Paint back-to-front so nearer buildings overlap further ones.
  items.sort(function(a,b){ return a.depth - b.depth; });
  items.forEach(function(it){ html += it.body; });
  html += smoke;

  /* Labels: pushed up until they stop colliding. Cheap greedy pass - the
     plaza sits in the middle so it is reserved first. */
  var placed = [{ cx: proj(4.95, 4.2, 1.0)[0], y: proj(4.95, 4.2, 1.0)[1], w: 230, h: 70 }];
  var LH = 32, minTop = 26;
  items.forEach(function(it, n){
    var L = it.label;
    var w = 104 + L.name.length * 9.4;
    var y0 = Math.max(minTop + LH, L.y);
    var free = function(cx, y){
      return y >= minTop && !placed.some(function(p){
        return Math.abs(p.cx - cx) < (p.w + w)/2 + 10 && Math.abs(p.y - y) < ((p.h || LH) + LH)/2 + 10;
      });
    };
    var hit = null;
    for (var dy = 0; dy >= -140 && !hit; dy -= 34){
      [0, 0.34, -0.34, 0.66, -0.66].forEach(function(f){
        if (!hit && free(L.x + f*w, y0 + dy)) hit = { x: L.x + f*w, y: y0 + dy };
      });
    }
    if (!hit) hit = { x: L.x, y: y0 - 150 };
    placed.push({ cx: hit.x, y: hit.y, w: w, h: LH });

    html += '<button class="city-label' + (L.sel ? ' on' : '') + '" data-k="' + L.key +
      '" style="left:' + hit.x + 'px;top:' + hit.y + 'px;z-index:' + (60 + n) + '">' +
      '<span class="city-dot" style="background:' + L.chip + '"></span>' +
      '<span class="city-name">' + L.name + '</span>' +
      '<span class="city-q"' + (L.fail ? ' style="color:#A85B49"' : '') + '>' + L.q + '</span></button>';
  });

  /* The plaza tile carries the number the whole simulation is about. */
  var pz = proj(4.95, 4.2, 1.0);
  html += '<div class="city-plaza" style="left:' + pz[0] + 'px;top:' + pz[1] + 'px">' +
    '<span class="lbl">universal payment</span>' +
    '<span class="city-plaza-v">$' + Math.round(state.indicators.ubi_monthly_sgd).toLocaleString('en-SG') +
    '<span class="city-plaza-u">/mo</span></span></div>';

  html += '</div>';
  host.innerHTML = html;

  if (opts.onSelect){
    host.querySelectorAll('[data-k]').forEach(function(el){
      el.addEventListener('click', function(){ opts.onSelect(el.dataset.k); });
      el.addEventListener('keydown', function(e){
        if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); opts.onSelect(el.dataset.k); }
      });
    });
  }
}

root.MeridianCity = {
  render: render, SCENE_W: SCENE_W, SCENE_H: SCENE_H,
  META: META, BANDS: BANDS, bandOf: bandOf
};

})(typeof window !== 'undefined' ? window : globalThis);
