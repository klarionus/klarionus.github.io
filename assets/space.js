/* 3D SPACE: two rotating x-ray figures (man M-01, woman F-01) in one WebGL canvas.
   Same shading as the EXO-XRAY renders: opaque exo, pulsing vessels, additive glass skin and bones. */
(function () {
  'use strict';
  var canvas = document.getElementById('space');
  var status = document.getElementById('status');
  if (!canvas) return;

  var gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: false });
  if (!gl) { if (status) status.textContent = 'WEBGL N/A'; return; }
  gl.getExtension('OES_element_index_uint');

  var PARTS = [
    { file: 'exo_dark.glb',   mode: 0, color: [0.10, 0.105, 0.11], spec: 0.55 },
    { file: 'exo_alu.glb',    mode: 0, color: [0.56, 0.58, 0.60],  spec: 0.45 },
    { file: 'exo_chrome.glb', mode: 0, color: [0.78, 0.80, 0.82],  spec: 0.95 },
    { file: 'exo_needle.glb', mode: 0, color: [0.85, 0.86, 0.88],  spec: 0.9 },
    { file: 'vessels.glb',    mode: 1, color: [1.00, 0.16, 0.10] },
    { file: 'bone.glb',       mode: 2, color: [0.92, 0.90, 0.86], k: 0.55, base: 0.10 },
    { file: 'cartilage.glb',  mode: 2, color: [0.75, 0.80, 0.85], k: 0.35, base: 0.05 },
    { file: 'body.glb',       mode: 2, color: [0.80, 0.86, 0.92], k: 0.85, base: 0.02 }
  ];
  // each figure: folder, spin direction, centre (filled from the body bbox)
  var FIG = [
    { base: 'assets/man/',   dir: 1,  c: [0, 0, 0], parts: [], id: 'M-01',
      anc: [[0.0, 1.79, 0.04], [0.0, 1.385, 0.125], [0.2164, 1.4847, -0.041], [-0.3288, 1.1535, -0.0624], [-0.1835, 0.96, -0.048], [0.183, 0.5052, -0.0826]] },
    { base: 'assets/woman/', dir: -1, c: [0, 0, 0], parts: [], id: 'F-01',
      anc: [[0.0946, 1.6206, 0.1423], [-0.087, 1.3273, 0.2102], [0.0878, 1.375, -0.0044], [-0.4579, 1.4501, 0.0251], [-0.1617, 0.8665, 0.0305], [0.1076, 0.4657, 0.0666]] }
  ];

  var VS = 'attribute vec3 aPos; attribute vec3 aNrm; uniform mat4 uProj, uView, uModel;' +
    'varying vec3 vN; varying vec3 vV; varying float vY;' +
    'void main(){ vec4 wp = uModel*vec4(aPos,1.0); vec4 vp = uView*wp; vN = mat3(uView)*mat3(uModel)*aNrm; vV = -vp.xyz; vY = aPos.y; gl_Position = uProj*vp; }';
  var FS = 'precision mediump float; varying vec3 vN; varying vec3 vV; varying float vY;' +
    'uniform vec3 uColor; uniform float uMode, uSpec, uK, uBase, uTime;' +
    'void main(){ vec3 n = normalize(vN); vec3 v = normalize(vV); float f = abs(dot(n,v));' +
    ' if (uMode < 0.5) { if (dot(n,v) < 0.0) n = -n;' +
    '  vec3 l1 = normalize(vec3(0.5,0.8,0.6)); vec3 l2 = normalize(vec3(-0.6,0.2,0.4));' +
    '  float d = max(dot(n,l1),0.0)*0.8 + max(dot(n,l2),0.0)*0.35 + 0.18;' +
    '  float s = pow(max(dot(n, normalize(l1+v)),0.0), 48.0)*uSpec; float rim = pow(1.0-f,3.0)*0.35;' +
    '  gl_FragColor = vec4(uColor*d + vec3(s+rim), 1.0);' +
    ' } else if (uMode < 1.5) { float p = 0.65 + 0.35*sin(uTime*6.2832 - vY*5.0);' +
    '  gl_FragColor = vec4(uColor*(0.75+0.6*p) + vec3(0.25,0.03,0.0)*pow(f,4.0), 1.0);' +
    ' } else { float g = pow(1.0-f, 2.2); gl_FragColor = vec4(uColor*(g*uK + uBase), 1.0); } }';
  function sh(t, s) { var o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); return o; }
  var prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { if (status) status.textContent = 'WEBGL N/A'; return; }
  gl.useProgram(prog);
  var loc = {};
  ['aPos', 'aNrm'].forEach(function (a) { loc[a] = gl.getAttribLocation(prog, a); });
  ['uProj', 'uView', 'uModel', 'uColor', 'uMode', 'uSpec', 'uK', 'uBase', 'uTime'].forEach(function (u) { loc[u] = gl.getUniformLocation(prog, u); });

  // ---- minimal GLB reader (one mesh, POSITION/NORMAL/indices)
  var CT = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array }, NC = { SCALAR: 1, VEC3: 3 };
  function parse(buf) {
    var jl = new DataView(buf).getUint32(12, true);
    var js = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jl))), bo = 20 + jl + 8;
    function acc(i) { var a = js.accessors[i], bv = js.bufferViews[a.bufferView], T = CT[a.componentType];
      var off = bo + (bv.byteOffset || 0) + (a.byteOffset || 0); return new T(buf.slice(off, off + a.count * NC[a.type] * T.BYTES_PER_ELEMENT)); }
    var p = js.meshes[0].primitives[0], pa = js.accessors[p.attributes.POSITION];
    return { pos: acc(p.attributes.POSITION), nrm: p.attributes.NORMAL != null ? acc(p.attributes.NORMAL) : null, idx: acc(p.indices), pc: p.attributes._PIECE != null ? acc(p.attributes._PIECE) : null, min: pa.min, max: pa.max };
  }
  var total = FIG.length * PARTS.length, done = 0;
  // exo disassembly: rigid 3x4 per piece per sampled frame (exported from Houdini), same 150-frame loop as the render
  FIG.forEach(function (fg) {
    Promise.all([fetch(fg.base + 'exo_anim.json').then(function (r) { if (!r.ok) throw 0; return r.json(); }),
                 fetch(fg.base + 'exo_anim.bin').then(function (r) { if (!r.ok) throw 0; return r.arrayBuffer(); })])
      .then(function (a) { fg.anim = a[0]; fg.animM = new Float32Array(a[1]); fg.cur = new Float32Array(a[0].pieces * 12); }).catch(function () {});
  });
  FIG.forEach(function (fg) {
    PARTS.forEach(function (pt) {
      var part = { mode: pt.mode, color: pt.color, spec: pt.spec || 0, k: pt.k || 0, base: pt.base || 0, gpu: null };
      fg.parts.push(part);
      fetch(fg.base + pt.file).then(function (r) { if (!r.ok) throw 0; return r.arrayBuffer(); }).then(function (b) {
        var m = parse(b), g = {};
        if (pt.file === 'body.glb') {          // spin axis = torso centre (verts between hips and chest), not the bbox
          var sx = 0, sz = 0, n = 0;
          for (var q = 0; q < m.pos.length; q += 3) { var y = m.pos[q + 1]; if (y > 0.9 && y < 1.2) { sx += m.pos[q]; sz += m.pos[q + 2]; n++; } }
          if (n) fg.c = [sx / n, 0, sz / n];
        }
        var usage = m.pc ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW;
        g.vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, g.vb); gl.bufferData(gl.ARRAY_BUFFER, m.pos, usage);
        g.nb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, g.nb); gl.bufferData(gl.ARRAY_BUFFER, m.nrm || new Float32Array(m.pos.length), usage);
        g.ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.idx, gl.STATIC_DRAW);
        g.count = m.idx.length; g.type = m.idx instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
        if (m.pc) { g.p0 = m.pos; g.n0 = m.nrm; g.pc = m.pc; g.pw = new Float32Array(m.pos.length); g.nw = new Float32Array(m.pos.length); }
        part.gpu = g;
      }).catch(function () {}).then(function () {
        done++; if (status) status.textContent = done < total ? 'LOADING ' + Math.round(100 * done / total) + '%' : '';
      });
    });
  });

  // ---- matrices (column-major)
  function mul(a, b) { var o = new Array(16); for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++)
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]; return o; }
  function rotY(a) { var c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; }
  function rotX(a) { var c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]; }
  function tr(x, y, z) { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]; }
  function persp(fy, asp, n, f) { var t = 1 / Math.tan(fy / 2); return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, 2 * f * n / (n - f), 0]; }

  // ---- interaction: drag = rotate both, wheel / pinch = zoom
  var yaw = 0.5, spin = 0.32, drag = false, lx = 0, pinch = 0;
  var Z = { z: 0, zt: 0 };
  function setZoom(v) { Z.zt = Math.max(0, Math.min(1, v)); }
  canvas.addEventListener('mousedown', function (e) { drag = true; lx = e.clientX; });
  window.addEventListener('mousemove', function (e) { if (!drag) return; yaw += (e.clientX - lx) * 0.008; lx = e.clientX; });
  window.addEventListener('mouseup', function () { drag = false; });
  canvas.addEventListener('wheel', function (e) { e.preventDefault(); setZoom(Z.zt - e.deltaY * 0.0012); }, { passive: false });
  canvas.addEventListener('dblclick', function () { setZoom(Z.zt > 0.5 ? 0 : 1); });
  function pd(t) { var dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY; return Math.sqrt(dx * dx + dy * dy); }
  canvas.addEventListener('touchstart', function (e) {
    if (e.touches.length === 2) { pinch = pd(e.touches); drag = false; }
    else { drag = true; lx = e.touches[0].clientX; }
  }, { passive: true });
  canvas.addEventListener('touchmove', function (e) {
    e.preventDefault();
    if (e.touches.length === 2 && pinch) { var d = pd(e.touches); setZoom(Z.zt + (d - pinch) * 0.004); pinch = d; }
    else if (drag) { yaw += (e.touches[0].clientX - lx) * 0.008; lx = e.touches[0].clientX; }
  }, { passive: false });
  window.addEventListener('touchend', function (e) { if (!e.touches || e.touches.length < 2) pinch = 0; if (!e.touches || !e.touches.length) drag = false; });


  // ---- HUD (SVG overlay in CSS pixels): thin lines, callouts follow the rotating anchors, no corner brackets
  var svg = document.getElementById('hud');
  var NS = 'http://www.w3.org/2000/svg', INK = '#e6e8ea', DIM = '#8b8e91', ACC = '#ff5a1f';
  var MONO = '"Space Mono", Consolas, monospace', SANS = '"Space Grotesk", "Helvetica Neue", sans-serif';
  function el(tag, a, parent) { var e = document.createElementNS(NS, tag); for (var k in a) e.setAttribute(k, a[k]); (parent || svg).appendChild(e); return e; }
  function txt(a, str, parent) { var t = el('text', a, parent); t.textContent = str; return t; }
  function pad3(v) { v = Math.round(v); return (v < 10 ? '00' : v < 100 ? '0' : '') + v; }
  var CALL = [
    { t: 'NEURAL INTERFACE', v: function (th) { return 'EEG SYNC ' + (98.2 + 0.6 * Math.sin(th)).toFixed(1) + ' %'; } },
    { t: 'STERNAL HUB S-01', v: function (th) { return 'LOAD ' + (412 + 9 * Math.sin(th * 2)).toFixed(1) + ' N'; } },
    { t: 'SHOULDER ACT. L',  v: function (th) { return 'ROT ' + (37.5 + 2.5 * Math.sin(th * 3)).toFixed(1) + ' DEG'; } },
    { t: 'ELBOW ACT. R',     v: function (th) { return 'TORQUE ' + (18.6 + 1.2 * Math.sin(th)).toFixed(1) + ' NM'; } },
    { t: 'HIP ACT. R',       v: function (th) { return 'FLEX ' + (12.4 + 1.6 * Math.sin(th * 2)).toFixed(1) + ' DEG'; } },
    { t: 'KNEE ACT. L',      v: function (th) { return 'LOAD ' + (61 + 2.2 * Math.sin(th * 3)).toFixed(1) + ' KG'; } }
  ];
  var H = null;
  function buildHud() {
    if (!svg) return;
    H = {};
    H.rule = el('line', { stroke: INK, 'stroke-width': 0.6, opacity: 0.5 });
    H.tl = txt({ fill: DIM, 'font-family': MONO, 'font-size': 10, 'letter-spacing': 1.5 }, 'XR TRANSMISSION SCAN  120 kV  /  0.8 mA');
    H.tr = txt({ fill: ACC, 'font-family': MONO, 'font-size': 10, 'letter-spacing': 1.5, 'text-anchor': 'end' }, '');
    H.tr2 = txt({ fill: DIM, 'font-family': MONO, 'font-size': 10, 'letter-spacing': 1.5, 'text-anchor': 'end' }, 'LOOP SYNC  //  30 FPS');
    // scan line
    H.scan = el('g', {}); H.scanL = el('line', { stroke: ACC, 'stroke-width': 0.6, opacity: 0.55 }, H.scan);
    H.scanT = txt({ fill: ACC, 'font-family': MONO, 'font-size': 9, 'letter-spacing': 1.2, 'text-anchor': 'end' }, '', H.scan);
    // per-figure callouts + subject tag
    FIG.forEach(function (fg) {
      fg.h = { calls: [], tag: txt({ fill: INK, 'font-family': SANS, 'font-weight': 300, 'font-size': 13, 'letter-spacing': 3, 'text-anchor': 'middle' }, 'SUBJECT ' + fg.id),
               tagL: el('line', { stroke: INK, 'stroke-width': 0.6, opacity: 0.6 }) };
      CALL.forEach(function (c) {
        var g = el('g', {});
        fg.h.calls.push({ g: g, line: el('polyline', { fill: 'none', stroke: INK, 'stroke-width': 0.6, opacity: 0.75 }, g),
          dot: el('circle', { r: 3.2, fill: 'none', stroke: ACC, 'stroke-width': 0.8 }, g),
          t: txt({ fill: INK, 'font-family': SANS, 'font-weight': 300, 'font-size': 13, 'letter-spacing': 1.2 }, c.t, g),
          v: txt({ fill: DIM, 'font-family': MONO, 'font-size': 9.5, 'letter-spacing': 1 }, '', g), def: c });
      });
    });
    // system bars (bottom-left) + integration (bottom-centre) + EMG (bottom-right)
    H.sys = ['C1-C7  SERVO ARRAY', 'T1-T12 SPINAL CARRIER', 'L1-L5  LUMBAR ACTUATOR', 'PELVIC MOUNT', 'FEMORAL STRUTS L/R', 'TIBIAL STRUTS L/R'].map(function (n) {
      return { n: txt({ fill: DIM, 'font-family': MONO, 'font-size': 9, 'letter-spacing': 1 }, n),
               box: el('rect', { fill: 'none', stroke: INK, 'stroke-width': 0.6, opacity: 0.6 }), fill: el('rect', { fill: INK, opacity: 0.85 }),
               p: txt({ fill: DIM, 'font-family': MONO, 'font-size': 9 }, '') };
    });
    H.intT = txt({ fill: INK, 'font-family': SANS, 'font-weight': 300, 'font-size': 12, 'letter-spacing': 3 }, 'INTEGRATION');
    H.intB = el('rect', { fill: 'none', stroke: INK, 'stroke-width': 0.6, opacity: 0.6 }); H.intF = el('rect', { fill: ACC, opacity: 0.9 });
    H.intP = txt({ fill: INK, 'font-family': MONO, 'font-size': 10, 'text-anchor': 'end' }, '');
    H.stat = txt({ fill: ACC, 'font-family': MONO, 'font-size': 10, 'letter-spacing': 1.5 }, '');
    H.emgT = txt({ fill: DIM, 'font-family': MONO, 'font-size': 9, 'letter-spacing': 1 }, 'EMG  CH 1-4');
    H.emg = [0, 1, 2, 3].map(function () { return el('polyline', { fill: 'none', stroke: INK, 'stroke-width': 0.6, opacity: 0.75 }); });
  }
  buildHud();
  function A(e, a) { for (var k in a) e.setAttribute(k, a[k]); }
  function proj(PV, m, p) {
    var x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], z = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
    var cx = PV[0] * x + PV[4] * y + PV[8] * z + PV[12], cy = PV[1] * x + PV[5] * y + PV[9] * z + PV[13], cw = PV[3] * x + PV[7] * y + PV[11] * z + PV[15];
    return [cx / cw, cy / cw, z];
  }
  function drawHud(PV, W, Hh, tsec) {
    if (!H) return;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + Hh);
    var small = W < 640, F = 1 + ((tsec * 30) % 150), th = 2 * Math.PI * (F - 1) / 150;
    var m = Math.max(16, W * 0.03), top = small ? 92 : Math.max(96, Hh * 0.115);
    A(H.rule, { x1: m, x2: W - m, y1: top, y2: top });
    A(H.tl, { x: m, y: top - 10 }); H.tl.style.display = small ? 'none' : '';
    A(H.tr, { x: W - m, y: small ? top + 16 : top - 24 }); H.tr.textContent = 'TC LIVE   ' + (Math.floor((F - 1) / 15) % 2 ? '   ' : 'REC');
    A(H.tr2, { x: W - m, y: top - 10 }); H.tr2.style.display = small ? 'none' : '';
    var sy = top + 10 + (Hh - top - 20) * ((F - 1) / 150);
    A(H.scanL, { x1: m, x2: W - m, y1: sy, y2: sy }); A(H.scanT, { x: W - m, y: sy - 5 }); H.scanT.textContent = 'SCAN ' + pad3(100 * (F - 1) / 150) + '%';
    // callouts: man to the left edge, woman to the right edge
    var showIdx = small ? [] : [0, 1, 2, 3, 4, 5];
    FIG.forEach(function (fg, i) {
      if (!fg.model) return;
      var side = i === 0 ? -1 : 1, lx = side < 0 ? m : W - m;
      var items = [];
      fg.h.calls.forEach(function (c, k) {
        var on = showIdx.indexOf(k) >= 0; c.g.style.display = on ? '' : 'none'; if (!on) return;
        var p = proj(PV, fg.model, fg.anc[k]);
        var cen = proj(PV, fg.model, [fg.c[0], fg.anc[k][1], fg.c[2]]);
        items.push({ c: c, x: (p[0] * 0.5 + 0.5) * W, y: (0.5 - p[1] * 0.5) * Hh, back: p[2] < cen[2] - 0.01 });
      });
      items.sort(function (a, b) { return a.y - b.y; });
      var minY = top + 40, gapY = small ? 34 : 44;
      items.forEach(function (it) { it.ly = Math.max(minY, it.y); minY = it.ly + gapY; });
      var maxY = Hh - (small ? 70 : 150);
      for (var j = items.length - 1; j >= 0; j--) { if (items[j].ly > maxY) items[j].ly = maxY; maxY = items[j].ly - gapY; }
      var tw = small ? 104 : 150;
      items.forEach(function (it) {
        var c = it.c, ex = lx - side * tw, kx = ex + (it.x - ex) * 0.25;
        c.line.setAttribute('points', it.x + ',' + it.y + ' ' + kx + ',' + it.ly + ' ' + lx + ',' + it.ly);
        A(c.dot, { cx: it.x, cy: it.y });
        var tx = side < 0 ? lx : lx, anchor = side < 0 ? 'start' : 'end';
        A(c.t, { x: tx, y: it.ly - 5, 'text-anchor': anchor, 'font-size': small ? 10.5 : 13 });
        A(c.v, { x: tx, y: it.ly + 12, 'text-anchor': anchor, 'font-size': small ? 8.5 : 9.5 });
        c.v.textContent = c.def.v(th);
        c.g.setAttribute('opacity', it.back ? 0.35 : 1);
      });
      // subject tag under the feet
      var f = proj(PV, fg.model, [fg.c[0], -0.04, fg.c[2]]), fx = (f[0] * 0.5 + 0.5) * W, fy = (0.5 - f[1] * 0.5) * Hh;
      A(fg.h.tag, { x: fx, y: fy + 26, 'font-size': small ? 10.5 : 13 });
      A(fg.h.tagL, { x1: fx - 46, x2: fx + 46, y1: fy + 10, y2: fy + 10 });
    });
    // bottom blocks (desktop only)
    var showB = !small && Hh > 560;
    var by = Hh - m - 6;
    H.sys.forEach(function (s, i) {
      [s.n, s.box, s.fill, s.p].forEach(function (e) { e.style.display = showB ? '' : 'none'; });
      if (!showB) return;
      var y = by - 40 - (5 - i) * 17, e = 0.55 + 0.45 * Math.sin(th + i * 1.05);
      A(s.n, { x: m, y: y + 7 }); A(s.box, { x: m + 168, y: y, width: 110, height: 8 }); A(s.fill, { x: m + 170, y: y + 2, width: 106 * e, height: 4 });
      A(s.p, { x: m + 286, y: y + 7 }); s.p.textContent = pad3(100 * e) + '%' + (Math.round(100 * e) >= 90 ? '  OK' : '  ..');
    });
    var ie = 0.72 + 0.24 * Math.sin(th), iw = Math.min(260, W * 0.17), ix = (W - iw) / 2, iy = top + 44;
    [H.intT, H.intB, H.intF, H.intP, H.stat].forEach(function (e) { e.style.display = showB ? '' : 'none'; });
    if (showB) {
      A(H.intT, { x: ix, y: iy - 8 }); A(H.intB, { x: ix, y: iy, width: iw, height: 7 }); A(H.intF, { x: ix + 2, y: iy + 2, width: (iw - 4) * ie, height: 3 });
      A(H.intP, { x: ix + iw, y: iy - 8 }); H.intP.textContent = pad3(100 * ie) + '%';
      A(H.stat, { x: ix, y: iy + 22 });
      H.stat.textContent = Math.round(100 * ie) >= 90 ? 'STATUS: SYNCHRONIZED' : (Math.floor((F - 1) / 5) % 2 ? 'STATUS: CALIBRATING _' : 'STATUS: CALIBRATING');
    }
    H.emgT.style.display = showB ? '' : 'none';
    var ex0 = W - m - 220;
    A(H.emgT, { x: ex0, y: by - 92 });
    H.emg.forEach(function (pl, c) {
      pl.style.display = showB ? '' : 'none'; if (!showB) return;
      var pts = [], y0 = by - 70 + c * 18;
      for (var k = 0; k <= 70; k++) { var x = ex0 + k * 3.14;
        var v = Math.sin(x * 0.09 + th * 10 + c * 1.7) * (0.6 + 0.4 * Math.sin(x * 0.021 - th * 3 + c));
        pts.push(x.toFixed(1) + ',' + (y0 - v * 6).toFixed(1)); }
      pl.setAttribute('points', pts.join(' '));
    });
  }


  // blend the two sampled frames around loop frame F and move every exo vertex by its piece transform
  function animate(fg, F) {
    var A = fg.anim; if (!A) return false;
    var u = ((F - 1) / A.step) % A.frames, i0 = Math.floor(u), i1 = (i0 + 1) % A.frames, w = u - i0;
    var n = A.pieces * 12, M = fg.animM, C = fg.cur, o0 = i0 * n, o1 = i1 * n;
    for (var k = 0; k < n; k++) C[k] = M[o0 + k] * (1 - w) + M[o1 + k] * w;
    fg.parts.forEach(function (p) {
      var g = p.gpu; if (!g || !g.pc) return;
      var P = g.p0, N = g.n0, Q = g.pw, R = g.nw, pc = g.pc;
      for (var v = 0, j = 0; v < pc.length; v++, j += 3) {
        var b = pc[v] * 12, x = P[j], y = P[j + 1], z = P[j + 2];
        Q[j] = C[b] * x + C[b + 1] * y + C[b + 2] * z + C[b + 3];
        Q[j + 1] = C[b + 4] * x + C[b + 5] * y + C[b + 6] * z + C[b + 7];
        Q[j + 2] = C[b + 8] * x + C[b + 9] * y + C[b + 10] * z + C[b + 11];
        if (N) { x = N[j]; y = N[j + 1]; z = N[j + 2];
          R[j] = C[b] * x + C[b + 1] * y + C[b + 2] * z; R[j + 1] = C[b + 4] * x + C[b + 5] * y + C[b + 6] * z; R[j + 2] = C[b + 8] * x + C[b + 9] * y + C[b + 10] * z; }
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, g.vb); gl.bufferSubData(gl.ARRAY_BUFFER, 0, Q);
      if (N) { gl.bindBuffer(gl.ARRAY_BUFFER, g.nb); gl.bufferSubData(gl.ARRAY_BUFFER, 0, R); }
    });
    return true;
  }

  var FREEZE = (/#f(\d+)/.exec(location.hash) || [])[1] | 0;   // debug: #f75 holds loop frame 75
  // ---- loop
  var t0 = performance.now(), last = t0;
  function tick(now) {
    var dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (!drag) yaw += spin * dt;
    Z.z += (Z.zt - Z.z) * (1 - Math.exp(-dt * 6));

    var dpr = Math.min(window.devicePixelRatio || 1, 2), w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    var asp = w / Math.max(h, 1);
    // spacing between the figures and a camera distance that fits both, landscape or portrait
    var gap = asp < 0.8 ? 0.95 : 1.15;
    var fy = 30 * Math.PI / 180;
    var needH = 2.3, needW = gap + (asp < 0.8 ? 1.45 : 1.05);
    var dist = Math.max(needH / 2 / Math.tan(fy / 2), needW / 2 / (Math.tan(fy / 2) * asp));
    dist *= 1 - 0.55 * Z.z;
    var focus = 0.86 + 0.5 * Z.z;
    var VIEW = tr(0, -focus, -dist);
    var PROJ = persp(fy, asp, 0.05, 30);

    gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniformMatrix4fv(loc.uProj, false, PROJ); gl.uniformMatrix4fv(loc.uView, false, VIEW);
    gl.uniform1f(loc.uTime, (now - t0) / 1000);
    var LF = FREEZE || 1 + (((now - t0) / 1000 * 30) % 150);
    FIG.forEach(function (fg) { animate(fg, LF); });
    gl.enable(gl.DEPTH_TEST);
    // pass 1: opaque (exo, vessels) for both figures, pass 2: additive glass
    for (var pass = 0; pass < 2; pass++) {
      FIG.forEach(function (fg, i) {
        var x = (i === 0 ? -1 : 1) * gap / 2;
        var model = mul(tr(x, 0, 0), mul(rotY(yaw * fg.dir), tr(-fg.c[0], 0, -fg.c[2])));
        fg.model = model; gl.uniformMatrix4fv(loc.uModel, false, model);
        fg.parts.forEach(function (p) {
          if (!p.gpu || (p.mode === 2) !== (pass === 1)) return;
          if (p.mode === 2) { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthMask(false); } else { gl.disable(gl.BLEND); gl.depthMask(true); }
          gl.uniform1f(loc.uMode, p.mode); gl.uniform3fv(loc.uColor, p.color); gl.uniform1f(loc.uSpec, p.spec); gl.uniform1f(loc.uK, p.k); gl.uniform1f(loc.uBase, p.base);
          gl.bindBuffer(gl.ARRAY_BUFFER, p.gpu.vb); gl.enableVertexAttribArray(loc.aPos); gl.vertexAttribPointer(loc.aPos, 3, gl.FLOAT, false, 0, 0);
          gl.bindBuffer(gl.ARRAY_BUFFER, p.gpu.nb); gl.enableVertexAttribArray(loc.aNrm); gl.vertexAttribPointer(loc.aNrm, 3, gl.FLOAT, false, 0, 0);
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, p.gpu.ib); gl.drawElements(gl.TRIANGLES, p.gpu.count, p.gpu.type, 0);
        });
      });
    }
    gl.depthMask(true); gl.disable(gl.BLEND);
    drawHud(mul(PROJ, VIEW), canvas.clientWidth, canvas.clientHeight, (now - t0) / 1000);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
