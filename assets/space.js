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
    { base: 'assets/man/',   dir: 1,  c: [0, 0, 0], parts: [] },
    { base: 'assets/woman/', dir: -1, c: [0, 0, 0], parts: [] }
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
    return { pos: acc(p.attributes.POSITION), nrm: p.attributes.NORMAL != null ? acc(p.attributes.NORMAL) : null, idx: acc(p.indices), min: pa.min, max: pa.max };
  }
  var total = FIG.length * PARTS.length, done = 0;
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
        g.vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, g.vb); gl.bufferData(gl.ARRAY_BUFFER, m.pos, gl.STATIC_DRAW);
        g.nb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, g.nb); gl.bufferData(gl.ARRAY_BUFFER, m.nrm || new Float32Array(m.pos.length), gl.STATIC_DRAW);
        g.ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.idx, gl.STATIC_DRAW);
        g.count = m.idx.length; g.type = m.idx instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
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
    gl.enable(gl.DEPTH_TEST);
    // pass 1: opaque (exo, vessels) for both figures, pass 2: additive glass
    for (var pass = 0; pass < 2; pass++) {
      FIG.forEach(function (fg, i) {
        var x = (i === 0 ? -1 : 1) * gap / 2;
        var model = mul(tr(x, 0, 0), mul(rotY(yaw * fg.dir), tr(-fg.c[0], 0, -fg.c[2])));
        gl.uniformMatrix4fv(loc.uModel, false, model);
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
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
