/* Minimal dependency-free WebGL viewer for the EXO-XRAY man.
   Loads several single-mesh GLB files and draws them in an x-ray style,
   slowly rotating; drag to rotate. */
(function () {
  'use strict';

  var canvas = document.getElementById('man');
  if (!canvas) return;
  var stage = canvas.parentElement;
  var status = document.getElementById('manStatus');
  var gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: false });
  if (!gl) { if (status) status.textContent = 'WEBGL N/A'; return; }
  var u32 = gl.getExtension('OES_element_index_uint');

  var BASE = canvas.getAttribute('data-base') || 'assets/man/';

  // draw order: opaque first, then additive x-ray layers
  var PARTS = [
    { file: 'exo_dark.glb',    mode: 'solid',  color: [0.10, 0.105, 0.11], spec: 0.55 },
    { file: 'exo_alu.glb',     mode: 'solid',  color: [0.56, 0.58, 0.60],  spec: 0.45 },
    { file: 'exo_chrome.glb',  mode: 'solid',  color: [0.78, 0.80, 0.82],  spec: 0.95 },
    { file: 'exo_needle.glb',  mode: 'solid',  color: [0.85, 0.86, 0.88],  spec: 0.9 },
    { file: 'vessels.glb',     mode: 'glow',   color: [1.00, 0.16, 0.10],  spec: 0.0 },
    { file: 'bone.glb',        mode: 'xray',   color: [0.92, 0.90, 0.86],  k: 0.55, base: 0.10 },
    { file: 'cartilage.glb',   mode: 'xray',   color: [0.75, 0.80, 0.85],  k: 0.35, base: 0.05 },
    { file: 'body.glb',        mode: 'xray',   color: [0.80, 0.86, 0.92],  k: 0.85, base: 0.02 }
  ];

  var VS = [
    'attribute vec3 aPos; attribute vec3 aNrm;',
    'uniform mat4 uProj, uView, uModel;',
    'varying vec3 vN; varying vec3 vV; varying float vY;',
    'void main(){',
    '  vec4 wp = uModel * vec4(aPos,1.0);',
    '  vN = mat3(uView) * mat3(uModel) * aNrm;',
    '  vec4 vp = uView * wp; vV = -vp.xyz; vY = aPos.y;',
    '  gl_Position = uProj * vp;',
    '}'
  ].join('\n');

  var FS = [
    'precision mediump float;',
    'varying vec3 vN; varying vec3 vV; varying float vY;',
    'uniform vec3 uColor; uniform float uMode; uniform float uSpec; uniform float uK; uniform float uBase;',
    'uniform float uTime;',
    'void main(){',
    '  vec3 n = normalize(vN);',
    '  vec3 v = normalize(vV);',
    '  float f = abs(dot(n, v));',
    '  if (uMode < 0.5) {',               // solid metal
    '    if (dot(n, v) < 0.0) n = -n;',
    '    vec3 l1 = normalize(vec3(0.5, 0.8, 0.6)); vec3 l2 = normalize(vec3(-0.6, 0.2, 0.4));',
    '    float d = max(dot(n,l1),0.0)*0.8 + max(dot(n,l2),0.0)*0.35 + 0.18;',
    '    vec3 h = normalize(l1 + v); float s = pow(max(dot(n,h),0.0), 48.0) * uSpec;',
    '    float rim = pow(1.0 - f, 3.0) * 0.35;',
    '    gl_FragColor = vec4(uColor * d + vec3(s + rim), 1.0);',
    '  } else if (uMode < 1.5) {',        // emissive vessels with travelling pulse
    '    float pulse = 0.65 + 0.35 * sin(uTime * 6.2832 - vY * 5.0);',
    '    gl_FragColor = vec4(uColor * (0.75 + 0.6 * pulse) + vec3(0.25,0.03,0.0) * pow(f, 4.0), 1.0);',
    '  } else {',                         // additive x-ray shell
    '    float g = pow(1.0 - f, 2.2);',
    '    gl_FragColor = vec4(uColor * (g * uK + uBase), 1.0);',
    '  }',
    '}'
  ].join('\n');

  function sh(type, src) {
    var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  var prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { if (status) status.textContent = 'WEBGL ERROR'; throw new Error(gl.getProgramInfoLog(prog)); }
  gl.useProgram(prog);
  var loc = {};
  ['aPos', 'aNrm'].forEach(function (a) { loc[a] = gl.getAttribLocation(prog, a); });
  ['uProj', 'uView', 'uModel', 'uColor', 'uMode', 'uSpec', 'uK', 'uBase', 'uTime'].forEach(function (u) { loc[u] = gl.getUniformLocation(prog, u); });

  // ---- GLB parsing (single mesh, POSITION/NORMAL/indices) ----
  var CT = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
  var NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  function parseGLB(buf) {
    var dv = new DataView(buf);
    var jlen = dv.getUint32(12, true);
    var json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jlen)));
    var binOff = 20 + jlen + 8;
    function acc(i) {
      var a = json.accessors[i], bv = json.bufferViews[a.bufferView];
      var T = CT[a.componentType], n = a.count * NC[a.type];
      var off = binOff + (bv.byteOffset || 0) + (a.byteOffset || 0);
      return new T(buf.slice(off, off + n * T.BYTES_PER_ELEMENT));
    }
    var p = json.meshes[0].primitives[0];
    return { pos: acc(p.attributes.POSITION), nrm: p.attributes.NORMAL != null ? acc(p.attributes.NORMAL) : null, idx: p.indices != null ? acc(p.indices) : null };
  }

  function upload(m) {
    var o = {};
    o.vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, o.vb); gl.bufferData(gl.ARRAY_BUFFER, m.pos, gl.STATIC_DRAW);
    var nrm = m.nrm || new Float32Array(m.pos.length);
    o.nb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, o.nb); gl.bufferData(gl.ARRAY_BUFFER, nrm, gl.STATIC_DRAW);
    if (m.idx) {
      var idx = m.idx;
      if (idx instanceof Uint32Array && !u32) idx = new Uint16Array(idx); // very old devices: may clip
      o.ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, o.ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
      o.count = idx.length; o.type = idx instanceof Uint32Array ? gl.UNSIGNED_INT : (idx instanceof Uint16Array ? gl.UNSIGNED_SHORT : gl.UNSIGNED_BYTE);
    } else { o.count = m.pos.length / 3; }
    return o;
  }

  var loaded = 0;
  PARTS.forEach(function (part) {
    fetch(BASE + part.file).then(function (r) { if (!r.ok) throw 0; return r.arrayBuffer(); })
      .then(function (b) { part.gpu = upload(parseGLB(b)); })
      .catch(function () { part.failed = true; })
      .then(function () {
        loaded++;
        if (status) status.textContent = loaded < PARTS.length ? 'LOADING MODEL ' + Math.round(100 * loaded / PARTS.length) + '%' : '';
      });
  });

  // ---- math ----
  function persp(fovy, asp, n, f) {
    var t = 1 / Math.tan(fovy / 2), nf = 1 / (n - f);
    return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) * nf, -1, 0, 0, 2 * f * n * nf, 0];
  }
  function mul(a, b) {
    var o = new Array(16);
    for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return o;
  }
  function rotY(a) { var c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; }
  function rotX(a) { var c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]; }
  function trans(x, y, z) { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]; }

  // ---- interaction ----
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var yaw = -0.5, pitch = 0.0, vel = reduce ? 0.0015 : 0.004, drag = false, lx = 0, ly = 0;
  function pt(e) { return e.touches ? e.touches[0] : e; }
  stage.addEventListener('mousedown', function (e) { drag = true; lx = e.clientX; ly = e.clientY; stage.classList.add('touched'); });
  window.addEventListener('mousemove', function (e) {
    if (!drag) return; yaw += (e.clientX - lx) * 0.008; pitch = Math.max(-0.5, Math.min(0.5, pitch + (e.clientY - ly) * 0.005)); lx = e.clientX; ly = e.clientY;
  });
  window.addEventListener('mouseup', function () { drag = false; });
  stage.addEventListener('touchstart', function (e) { drag = true; var p = pt(e); lx = p.clientX; ly = p.clientY; stage.classList.add('touched'); }, { passive: true });
  stage.addEventListener('touchmove', function (e) {
    if (!drag) return; var p = pt(e); yaw += (p.clientX - lx) * 0.008; pitch = Math.max(-0.5, Math.min(0.5, pitch + (p.clientY - ly) * 0.005)); lx = p.clientX; ly = p.clientY;
    if (e.cancelable) e.preventDefault();
  }, { passive: false });
  window.addEventListener('touchend', function () { drag = false; });

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
  }

  var t0 = performance.now();
  function frame(now) {
    resize();
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!drag) yaw += vel;

    var asp = canvas.width / Math.max(1, canvas.height);
    var fov = 0.62;
    // fit 1.9 m tall figure; keep width in view on narrow screens
    var dist = Math.max(1.0 / Math.tan(fov / 2), (0.55 / asp) / Math.tan(fov / 2)) * 1.0;
    var proj = persp(fov, asp, 0.05, 20);
    var view = trans(0, 0, -dist);
    var model = mul(rotX(pitch), mul(rotY(yaw), trans(0, -0.9, 0)));
    gl.uniformMatrix4fv(loc.uProj, false, proj);
    gl.uniformMatrix4fv(loc.uView, false, view);
    gl.uniformMatrix4fv(loc.uModel, false, model);
    gl.uniform1f(loc.uTime, (now - t0) / 1000);

    for (var i = 0; i < PARTS.length; i++) {
      var p = PARTS[i]; if (!p.gpu) continue;
      var m = p.mode === 'solid' ? 0 : (p.mode === 'glow' ? 1 : 2);
      if (m === 2) { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthMask(false); gl.disable(gl.CULL_FACE); }
      else { gl.disable(gl.BLEND); gl.depthMask(true); gl.disable(gl.CULL_FACE); }
      gl.enable(gl.DEPTH_TEST);
      gl.uniform1f(loc.uMode, m);
      gl.uniform3fv(loc.uColor, p.color);
      gl.uniform1f(loc.uSpec, p.spec || 0);
      gl.uniform1f(loc.uK, p.k || 0);
      gl.uniform1f(loc.uBase, p.base || 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, p.gpu.vb); gl.enableVertexAttribArray(loc.aPos); gl.vertexAttribPointer(loc.aPos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, p.gpu.nb); gl.enableVertexAttribArray(loc.aNrm); gl.vertexAttribPointer(loc.aNrm, 3, gl.FLOAT, false, 0, 0);
      if (p.gpu.ib) { gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, p.gpu.ib); gl.drawElements(gl.TRIANGLES, p.gpu.count, p.gpu.type, 0); }
      else gl.drawArrays(gl.TRIANGLES, 0, p.gpu.count);
    }
    gl.depthMask(true);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
