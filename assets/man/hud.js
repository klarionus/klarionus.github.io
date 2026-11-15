/* EXO-XRAY live: rotating x-ray model + HUD overlay (rebuilt from the Houdini HUD network).
   HUD lives in a 1080x1920 pixel space with origin at frame centre, y up — same as in Houdini.
   Every animated value is periodic in the 150-frame (5 s @ 30 fps) loop, like the render. */
(function () {
  'use strict';
  var frame = document.getElementById('hudFrame');
  var canvas = document.getElementById('man');
  var svg = document.getElementById('hud');
  var status = document.getElementById('manStatus');
  if (!frame || !canvas || !svg) return;

  var BASE = canvas.getAttribute('data-base') || 'assets/man/';
  var INK = '#e6e8ea', ACC = '#ff5a1f';
  var MONO = '"Space Mono", Consolas, monospace', SANS = '"Space Grotesk", "DejaVu Sans", sans-serif';
  var TXT = 1.3, HEAD = 0.92, SYS = 1.0;            // hud_text_scale / hud_head_scale / hud_sys_scale
  var LW = 2.0;                                     // hud_line_scale

  // ------------------------------------------------------------------ WebGL model
  var gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: false });
  var parts = [
    { file: 'exo_dark.glb',   mode: 0, color: [0.10, 0.105, 0.11], spec: 0.55 },
    { file: 'exo_alu.glb',    mode: 0, color: [0.56, 0.58, 0.60],  spec: 0.45 },
    { file: 'exo_chrome.glb', mode: 0, color: [0.78, 0.80, 0.82],  spec: 0.95 },
    { file: 'exo_needle.glb', mode: 0, color: [0.85, 0.86, 0.88],  spec: 0.9 },
    { file: 'vessels.glb',    mode: 1, color: [1.00, 0.16, 0.10] },
    { file: 'bone.glb',       mode: 2, color: [0.92, 0.90, 0.86], k: 0.55, base: 0.10 },
    { file: 'cartilage.glb',  mode: 2, color: [0.75, 0.80, 0.85], k: 0.35, base: 0.05 },
    { file: 'body.glb',       mode: 2, color: [0.80, 0.86, 0.92], k: 0.85, base: 0.02 }
  ];
  var loc = {}, prog;
  if (gl) {
    gl.getExtension('OES_element_index_uint');
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
    var mk = function (t, s) { var o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); return o; };
    prog = gl.createProgram();
    gl.attachShader(prog, mk(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) gl = null;
  }
  if (gl) {
    gl.useProgram(prog);
    ['aPos', 'aNrm'].forEach(function (a) { loc[a] = gl.getAttribLocation(prog, a); });
    ['uProj', 'uView', 'uModel', 'uColor', 'uMode', 'uSpec', 'uK', 'uBase', 'uTime'].forEach(function (u) { loc[u] = gl.getUniformLocation(prog, u); });
    var CT = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array }, NC = { SCALAR: 1, VEC3: 3 };
    var parse = function (buf) {
      var jl = new DataView(buf).getUint32(12, true);
      var js = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jl))), bo = 20 + jl + 8;
      var acc = function (i) { var a = js.accessors[i], bv = js.bufferViews[a.bufferView], T = CT[a.componentType];
        var off = bo + (bv.byteOffset || 0) + (a.byteOffset || 0); return new T(buf.slice(off, off + a.count * NC[a.type] * T.BYTES_PER_ELEMENT)); };
      var p = js.meshes[0].primitives[0];
      return { pos: acc(p.attributes.POSITION), nrm: p.attributes.NORMAL != null ? acc(p.attributes.NORMAL) : null, idx: acc(p.indices) };
    };
    var done = 0;
    parts.forEach(function (pt) {
      fetch(BASE + pt.file).then(function (r) { return r.arrayBuffer(); }).then(function (b) {
        var m = parse(b), g = {};
        g.vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, g.vb); gl.bufferData(gl.ARRAY_BUFFER, m.pos, gl.STATIC_DRAW);
        g.nb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, g.nb); gl.bufferData(gl.ARRAY_BUFFER, m.nrm || new Float32Array(m.pos.length), gl.STATIC_DRAW);
        g.ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.idx, gl.STATIC_DRAW);
        g.count = m.idx.length; g.type = m.idx instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
        pt.gpu = g;
      }).catch(function () {}).then(function () {
        done++; if (status) status.textContent = done < parts.length ? 'LOADING ' + Math.round(100 * done / parts.length) + '%' : '';
      });
    });
  } else if (status) status.textContent = 'WEBGL N/A';

  // ------------------------------------------------------------------ camera (matches /obj/CAM at frame 1)
  // dist 2.8 m, target 0.93 m, camera 0.32 m below target, aperture 24 / focal 50 on 1080 px width
  var CAM = { dist: 2.8, tgt: 0.93, drop: -0.32, k: 50 / 24 * 1080 };   // k: pixels per unit of x/z
  // zoom state: z 0 = full figure (frame 1 of the render), 1 = close-up; focus = height the camera looks at
  var Z = { z: 0, zt: 0, f: 0.93, ft: 0.93 };
  var DIST_FAR = 2.8, DIST_NEAR = 0.75;
  function mul(a, b) { var o = new Array(16); for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++)
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]; return o; }
  function rotY(a) { var c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; }
  function rotX(a) { var c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]; }
  function tr(x, y, z) { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]; }
  var VIEW;
  function updateView() {
    var d = DIST_FAR + (DIST_NEAR - DIST_FAR) * Z.z;
    var drop = CAM.drop * d / DIST_FAR;                         // keep the same slight low angle
    var pitch = Math.atan2(-drop, d);
    VIEW = mul(rotX(-pitch), tr(0, -(Z.f + drop), -d));
  }
  // simple, explicit version of the above: x_ndc = x/(-z) * k / 540, y_ndc = y/(-z) * k / 960
  var PROJ = [CAM.k / 540, 0, 0, 0, 0, CAM.k / 960, 0, 0, 0, 0, -20.05 / 19.95, -1, 0, 0, -2 * 20 * 0.05 / 19.95, 0];

  function apply(m, p) { return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]]; }
  // world point -> HUD pixel space (origin centre, y up)
  function project(model, p) { var v = apply(VIEW, apply(model, p)); return [v[0] / -v[2] * CAM.k, v[1] / -v[2] * CAM.k, v[2]]; }

  // ------------------------------------------------------------------ HUD (SVG)
  var NS = 'http://www.w3.org/2000/svg';
  function el(tag, attrs, parent) { var e = document.createElementNS(NS, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); (parent || svg).appendChild(e); return e; }
  var Y = function (y) { return -y; };                          // houdini y-up -> svg y-down
  function line(a, b, w, c, parent) { return el('line', { x1: a[0], y1: Y(a[1]), x2: b[0], y2: Y(b[1]), stroke: c, 'stroke-width': w * LW, 'stroke-linecap': 'square' }, parent); }
  function text(x, y, size, fam, col, str) { var t = el('text', { x: x, y: Y(y), fill: col, 'font-size': size, 'font-family': fam }); t.textContent = str; return t; }
  function pad3(v) { v = Math.round(v); return (v < 10 ? '00' : v < 100 ? '0' : '') + v; }

  var g = el('g', {});
  // static frame: corner brackets, header rule, right ruler
  [[-1, 1], [1, 1], [1, -1], [-1, -1]].forEach(function (q) {
    var o = [q[0] * 500, q[1] * 900]; line(o, [o[0] - q[0] * 90, o[1]], 2.5, INK, g); line(o, [o[0], o[1] - q[1] * 90], 2.5, INK, g);
  });
  line([-500, 795], [500, 795], 1.2, INK, g);
  for (var k = -20; k <= 20; k++) line([520, k * 40], [520 - (k % 5 === 0 ? 22 : 10), k * 40], 1.0, INK, g);

  text(-500, 840, 34 * HEAD, SANS, INK, 'EXO-SKELETAL INTEGRATION // UNIT 07');
  text(-500, 805, 19 * HEAD, MONO, INK, 'XR TRANSMISSION SCAN  120 kV  /  0.8 mA  /  SUBJECT M-01').setAttribute('xml:space', 'preserve');
  var tc = text(250, 840, 24 * HEAD, MONO, ACC, 'TC LIVE  REC'); tc.setAttribute('xml:space', 'preserve');
  text(250, 812, 19 * HEAD, MONO, INK, 'LOOP SYNC  //  30 FPS').setAttribute('xml:space', 'preserve');

  var SYSN = ['C1-C7  SERVO ARRAY', 'T1-T12 SPINAL CARRIER', 'L1-L5  LUMBAR ACTUATOR', 'PELVIC MOUNT', 'FEMORAL STRUTS L/R', 'TIBIAL STRUTS L/R'];
  var sys = SYSN.map(function (n, i) {
    var y = -560 - i * 38;
    var nt = text(-500, y, 17.2 * SYS, MONO, INK, n); nt.setAttribute('xml:space', 'preserve');
    if (n.length > 18) { nt.setAttribute('textLength', 212); nt.setAttribute('lengthAdjust', 'spacingAndGlyphs'); }
    el('rect', { x: -280, y: Y(y + 16), width: 170, height: 14, fill: 'none', stroke: INK, 'stroke-width': 1.0 * LW }, g);
    return { fill: el('rect', { x: -277, y: Y(y + 13), width: 0, height: 8, fill: INK }),
             pct: text(-100, y, 19 * SYS, MONO, INK, '000%'), ok: text(-30, y, 19 * SYS, MONO, ACC, '..') };
  });
  text(-500, -820, 22 * TXT, SANS, INK, 'INTEGRATION');
  var ipct = text(400, -820, 22 * TXT, MONO, INK, '000%');
  el('rect', { x: -500, y: Y(-830), width: 1000, height: 20, fill: 'none', stroke: INK, 'stroke-width': 1.2 * LW }, g);
  var ifill = el('rect', { x: -496, y: Y(-834), width: 0, height: 12, fill: ACC });
  var stat = text(-500, -905, 22 * TXT, MONO, ACC, 'STATUS: CALIBRATING');

  // EMG
  text(250, -690, 16 * TXT, MONO, INK, 'EMG  CH 1-4').setAttribute('xml:space', 'preserve');
  var emg = [0, 1, 2, 3].map(function () { return el('polyline', { fill: 'none', stroke: INK, 'stroke-width': 1.0 * LW }); });

  // scan line
  var scan = el('g', {});
  line([-540, 0], [540, 0], 1.0, ACC, scan);
  for (k = 0; k < 28; k++) line([-520 + k * 40, 0], [-520 + k * 40, -8], 1.0, ACC, scan);
  var ptr = el('g', {});
  line([492, 0], [470, 8], 1.5, ACC, ptr); line([492, 0], [470, -8], 1.5, ACC, ptr);
  var scanTxt = text(412, 6, 16 * TXT, MONO, ACC, 'SCAN 000%');

  // callouts (anchors in model space, label side/offset as in CALLOUT_PROJECT)
  var CALL = [
    { p: [0.0, 1.79, 0.04],        side: -1, off: 60,  t: 'NEURAL INTERFACE', v: function (th) { return 'EEG SYNC ' + (98.2 + 0.6 * Math.sin(th)).toFixed(1) + ' %'; } },
    { p: [0.0, 1.385, 0.125],      side: 1,  off: -70, t: 'STERNAL HUB S-01', v: function (th) { return 'LOAD ' + (412 + 9 * Math.sin(th * 2)).toFixed(1) + ' N'; } },
    { p: [0.2164, 1.4847, -0.041], side: 1,  off: 70,  t: 'SHOULDER ACT. L',  v: function (th) { return 'ROT ' + (37.5 + 2.5 * Math.sin(th * 3)).toFixed(1) + ' DEG'; } },
    { p: [-0.3288, 1.1535, -0.0624], side: -1, off: 40, t: 'ELBOW ACT. R',    v: function (th) { return 'TORQUE ' + (18.6 + 1.2 * Math.sin(th)).toFixed(1) + ' NM'; } },
    { p: [-0.1835, 0.96, -0.048],  side: -1, off: -40, t: 'HIP ACT. R',       v: function (th) { return 'FLEX ' + (12.4 + 1.6 * Math.sin(th * 2)).toFixed(1) + ' DEG'; } },
    { p: [0.183, 0.5052, -0.0826], side: 1,  off: 60,  t: 'KNEE ACT. L',      v: function (th) { return 'LOAD ' + (61 + 2.2 * Math.sin(th * 3)).toFixed(1) + ' KG'; } }
  ];
  CALL.forEach(function (c) {
    c.g = el('g', {});
    c.path = el('polyline', { fill: 'none', stroke: INK, 'stroke-width': 1.4 * LW }, c.g);
    c.ret = el('g', {}, c.g);
    c.ring = el('circle', { r: 12, fill: 'none', stroke: ACC, 'stroke-width': 1.4 * LW }, c.ret);
    c.ticks = [0, 1, 2, 3].map(function () { return el('line', { stroke: ACC, 'stroke-width': 1.4 * LW }, c.ret); });
    c.dot = el('circle', { r: 3.2, fill: ACC }, c.ret);
    c.l1 = text(0, 0, 19 * TXT, SANS, INK, c.t); c.g.appendChild(c.l1);
    c.l2 = text(0, 0, 16 * TXT, MONO, INK, ''); c.g.appendChild(c.l2);
  });

  // ------------------------------------------------------------------ interaction
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var yaw = 0, spin = reduce ? 0.12 : 0.35, drag = false, lx = 0, ly = 0, pinch = 0, lastTap = 0;
  function clampF(v) { return Math.max(0.15, Math.min(1.72, v)); }
  function setZoom(v) { Z.zt = Math.max(0, Math.min(1, v)); if (Z.zt < 0.02) Z.ft = 0.93; }
  function down(x, y) { drag = true; lx = x; ly = y; frame.classList.add('touched'); }
  function move(x, y) {
    if (!drag) return;
    var r = frame.getBoundingClientRect();
    yaw += (x - lx) * 0.008;
    // vertical drag pans along the body when zoomed in (metres per pixel shrink as we get closer)
    if (Z.zt > 0.02) Z.ft = clampF(Z.ft + (y - ly) / r.height * 2.0 * (1 - 0.7 * Z.z));
    lx = x; ly = y;
  }
  frame.addEventListener('mousedown', function (e) { down(e.clientX, e.clientY); });
  window.addEventListener('mousemove', function (e) { move(e.clientX, e.clientY); });
  window.addEventListener('mouseup', function () { drag = false; });
  frame.addEventListener('wheel', function (e) {
    e.preventDefault();
    // zoom towards the point under the cursor: aim the focus at that height
    var r = frame.getBoundingClientRect(), py = (0.5 - (e.clientY - r.top) / r.height) * 1920;
    if (e.deltaY < 0 && Z.zt < 1) Z.ft = clampF(Z.f + py / CAM.k * (DIST_FAR + (DIST_NEAR - DIST_FAR) * Z.z) * 0.35);
    setZoom(Z.zt - e.deltaY * 0.0015);
  }, { passive: false });
  frame.addEventListener('dblclick', function (e) {
    var r = frame.getBoundingClientRect(), py = (0.5 - (e.clientY - r.top) / r.height) * 1920;
    if (Z.zt > 0.5) setZoom(0); else { Z.ft = clampF(Z.f + py / CAM.k * DIST_FAR); setZoom(0.85); }
  });
  function pd(t) { var dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY; return Math.sqrt(dx * dx + dy * dy); }
  frame.addEventListener('touchstart', function (e) {
    if (e.touches.length === 2) { pinch = pd(e.touches); drag = false; return; }
    var now = Date.now(), t = e.touches[0];
    if (now - lastTap < 300) { var r = frame.getBoundingClientRect(), py = (0.5 - (t.clientY - r.top) / r.height) * 1920;
      if (Z.zt > 0.5) setZoom(0); else { Z.ft = clampF(Z.f + py / CAM.k * DIST_FAR); setZoom(0.85); } }
    lastTap = now;
    down(t.clientX, t.clientY);
  }, { passive: true });
  frame.addEventListener('touchmove', function (e) {
    if (e.touches.length === 2 && pinch) { var d = pd(e.touches); setZoom(Z.zt + (d - pinch) / 260); pinch = d; }
    else move(e.touches[0].clientX, e.touches[0].clientY);
    if (e.cancelable) e.preventDefault();
  }, { passive: false });
  window.addEventListener('touchend', function (e) { if (!e.touches || e.touches.length < 2) pinch = 0; if (!e.touches || !e.touches.length) drag = false; });
  var zin = document.getElementById('zoomIn'), zout = document.getElementById('zoomOut');
  if (zin) zin.addEventListener('click', function (e) { e.stopPropagation(); setZoom(Z.zt + 0.25); });
  if (zout) zout.addEventListener('click', function (e) { e.stopPropagation(); setZoom(Z.zt - 0.25); });
  [zin, zout].forEach(function (b) { if (b) { b.addEventListener('mousedown', function (e) { e.stopPropagation(); }); b.addEventListener('touchstart', function (e) { e.stopPropagation(); }, { passive: true }); } });

  // ------------------------------------------------------------------ loop
  if (/zoom/.test(location.hash)) { Z.ft = Z.f = 1.55; setZoom(0.85); Z.z = 0.85; }   // deep link: #zoom → close-up
  var t0 = performance.now(), last = t0;
  function tick(now) {
    var dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (!drag) yaw += spin * dt * (1 - 0.6 * Z.z);
    var ez = 1 - Math.exp(-dt * 6);
    Z.z += (Z.zt - Z.z) * ez; Z.f += (Z.ft - Z.f) * ez;
    updateView();
    var tsec = (now - t0) / 1000;
    var F = 1 + ((tsec * 30) % 150);                     // houdini frame in the loop
    var th = 2 * Math.PI * (F - 1) / 150;
    var model = mul(rotY(yaw), tr(0, 0, 0));

    // ---- model
    if (gl) {
      var dpr = Math.min(window.devicePixelRatio || 1, 2), w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniformMatrix4fv(loc.uProj, false, PROJ); gl.uniformMatrix4fv(loc.uView, false, VIEW); gl.uniformMatrix4fv(loc.uModel, false, model);
      gl.uniform1f(loc.uTime, tsec);
      parts.forEach(function (p) {
        if (!p.gpu) return;
        if (p.mode === 2) { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthMask(false); } else { gl.disable(gl.BLEND); gl.depthMask(true); }
        gl.enable(gl.DEPTH_TEST);
        gl.uniform1f(loc.uMode, p.mode); gl.uniform3fv(loc.uColor, p.color); gl.uniform1f(loc.uSpec, p.spec || 0); gl.uniform1f(loc.uK, p.k || 0); gl.uniform1f(loc.uBase, p.base || 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, p.gpu.vb); gl.enableVertexAttribArray(loc.aPos); gl.vertexAttribPointer(loc.aPos, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, p.gpu.nb); gl.enableVertexAttribArray(loc.aNrm); gl.vertexAttribPointer(loc.aNrm, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, p.gpu.ib); gl.drawElements(gl.TRIANGLES, p.gpu.count, p.gpu.type, 0);
      });
      gl.depthMask(true);
    }

    // ---- HUD values
    tc.textContent = 'TC LIVE  ' + (Math.floor((F - 1) / 15) % 2 ? '   ' : 'REC');
    sys.forEach(function (s, i) {
      var e = 0.55 + 0.45 * Math.sin(th + i * 1.05);
      s.fill.setAttribute('width', Math.max(0, 164 * e));
      s.pct.textContent = pad3(100 * e) + '%';
      s.ok.textContent = Math.round(100 * e) >= 90 ? 'OK' : '..';
    });
    var ie = 0.72 + 0.24 * Math.sin(th);
    ifill.setAttribute('width', 992 * ie);
    ipct.textContent = pad3(100 * ie) + '%';
    stat.textContent = Math.round(100 * ie) >= 90 ? 'STATUS: SYNCHRONIZED' : (Math.floor((F - 1) / 5) % 2 ? 'STATUS: CALIBRATING _' : 'STATUS: CALIBRATING');
    var sy = 1000 - 2000 * (F - 1) / 150;
    scan.setAttribute('transform', 'translate(0,' + Y(sy) + ')');
    ptr.setAttribute('transform', 'translate(0,' + Y(sy) + ')');
    scanTxt.setAttribute('y', Y(sy + 6));
    scanTxt.textContent = 'SCAN ' + pad3(Math.floor(100 * (F - 1) / 150)) + '%';
    emg.forEach(function (pl, c) {
      var pts = [], y0 = -720 - c * 22;
      for (var k = 0; k <= 80; k++) { var x = 250 + k * 3.1;
        var v = Math.sin(x * 0.09 + th * 10 + c * 1.7) * (0.6 + 0.4 * Math.sin(x * 0.021 - th * 3 + c));
        pts.push(x.toFixed(1) + ',' + Y(y0 + v * 8).toFixed(1)); }
      pl.setAttribute('points', pts.join(' '));
    });

    // ---- callouts follow the rotating body
    CALL.forEach(function (c, i) {
      var P = project(model, c.p);
      var on = Math.abs(P[0]) < 520 && Math.abs(P[1]) < 930;
      c.g.style.display = on ? '' : 'none';
      if (!on) return;
      var s = c.side, ly = Math.max(-700, Math.min(760, P[1] + c.off)), xe = s * 235;
      var E = [xe - s * 45, ly], U = [xe + s * 272, ly];
      c.path.setAttribute('points', [P, E, U].map(function (q) { return q[0].toFixed(1) + ',' + Y(q[1]).toFixed(1); }).join(' '));
      var pop = 0.8 + 0.2 * Math.sin(th * 3 + i), r = 12 * pop;
      c.ret.setAttribute('transform', 'translate(' + P[0].toFixed(1) + ',' + Y(P[1]).toFixed(1) + ')');
      c.ring.setAttribute('r', r); c.dot.setAttribute('r', 3.2 * pop);
      c.ticks.forEach(function (tk, k) { var a = k * Math.PI / 2, ca = Math.cos(a), sa = -Math.sin(a);
        tk.setAttribute('x1', ca * r * 1.35); tk.setAttribute('y1', sa * r * 1.35); tk.setAttribute('x2', ca * r * 2); tk.setAttribute('y2', sa * r * 2); });
      var lx = s > 0 ? 235 * s + 10 : 235 * s - 262;
      c.l1.setAttribute('x', lx); c.l1.setAttribute('y', Y(ly + 8));
      c.l2.setAttribute('x', lx); c.l2.setAttribute('y', Y(ly + 8 - 24 * TXT / 1.3 - 6));
      c.l2.textContent = c.v(th);
    });
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
