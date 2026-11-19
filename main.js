/*
  Hero artwork: a stack of infrared (FTIR-style) spectra.
  Each line is one "sample": the same absorption bands, at different strengths.
  Bands drift slowly, and lines near the cursor are gently pulled toward it.
  Canvas 2D, no libraries. Pauses off-screen; still frame for reduced motion.
*/
(function () {
  'use strict';
  var canvas = document.getElementById('art');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d', { alpha: false });
  var hero = canvas.parentElement;

  var motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  var darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
  var reduce = motionQuery.matches;

  var W = 0, H = 0, dpr = 1;
  var bg = '#ffffff', ink = '#0a0a0a', accent = '#ff6a00';
  var t = 0, last = 0, raf = 0, onScreen = true;
  var born = performance.now();   // the lines grow up from flat when the page loads

  // Deterministic random so the composition is the same on every visit.
  var seed = 72;
  function rnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }

  // Absorption bands, placed on a wavenumber axis (cm-1, read right to left like an IR plot).
  // Loosely a polymer: broad O-H, the C-H stretch doublet, a carbonyl, and a fingerprint cluster.
  var BANDS = [
    { k: 3350, w: 160, a: 0.35, s: 0.17 },
    { k: 2918, w: 16, a: 1.00, s: 0.31 },
    { k: 2850, w: 14, a: 0.80, s: 0.31 },
    { k: 1725, w: 20, a: 0.85, s: 0.23 },
    { k: 1460, w: 14, a: 0.55, s: 0.37 },
    { k: 1375, w: 12, a: 0.40, s: 0.29 },
    { k: 1240, w: 22, a: 0.60, s: 0.21 },
    { k: 1100, w: 26, a: 0.70, s: 0.19 },
    { k: 720, w: 10, a: 0.45, s: 0.41 }
  ];
  var KMAX = 4000, KMIN = 500;
  var NB = BANDS.length;
  for (var b = 0; b < NB; b++) BANDS[b].p = rnd() * Math.PI * 2;

  var lines = 0, pts = 0;
  var gain = null;      // per-line, per-band strength: each line is a different "sample"
  var centres = new Float64Array(NB), widths = new Float64Array(NB), heights = new Float64Array(NB);
  var ys = null;        // scratch buffer for one line's y values
  var muted = '#595959';

  var pointer = { x: 0, y: 0, tx: 0, ty: 0, k: 0, tk: 0 };

  function readColors() {
    var s = getComputedStyle(document.documentElement);
    bg = s.getPropertyValue('--bg').trim() || bg;
    ink = s.getPropertyValue('--ink').trim() || ink;
    muted = s.getPropertyValue('--muted').trim() || muted;
    accent = s.getPropertyValue('--accent').trim() || accent;
  }

  function build() {
    lines = W < 640 ? 18 : 24;
    pts = Math.round(Math.min(900, Math.max(320, W * 0.7)));
    seed = 72;
    gain = new Float64Array(lines * NB);
    ys = new Float32Array(pts + 1);
    for (var i = 0; i < lines; i++) {
      for (var j = 0; j < NB; j++) gain[i * NB + j] = rnd() < 0.18 ? 0.08 : 0.35 + rnd() * 0.8;
    }
  }

  function resize() {
    var r = canvas.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    readColors();
    build();
    draw();
  }

  function draw() {
    var narrow = W < 640;
    var top = H * (narrow ? 0.2 : 0.2);
    var bottom = H * (narrow ? 0.58 : (H < 760 ? 0.56 : 0.64));
    var shear = narrow ? W * 0.10 : Math.min(W * 0.12, 200); // back lines sit up and to the right
    var left = narrow ? 16 : W * 0.07;
    var right = W - (narrow ? 16 : W * 0.07);
    var span = right - left - shear;
    var gap = (bottom - top) / (lines - 1);
    var amp = gap * (narrow ? 4.2 : 5.2);
    var sx = Math.pow(Math.min(W, 1400) * 0.12, 2);
    var sy = Math.pow(H * 0.14, 2);
    var pullK = pointer.k;
    var kRange = KMAX - KMIN;
    var elapsed = reduce ? 1e9 : performance.now() - born;

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    ctx.lineWidth = 1;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = ink;

    // Bands drift a little along the axis and breathe in strength.
    for (var j = 0; j < NB; j++) {
      var bd = BANDS[j];
      centres[j] = (KMAX - bd.k) / kRange + Math.sin(t * bd.s + bd.p) * 0.012;
      widths[j] = (bd.w / kRange) * (1 + 0.3 * Math.sin(t * bd.s * 0.7 + bd.p * 2));
      heights[j] = bd.a * (0.75 + 0.25 * Math.sin(t * bd.s * 1.3 + bd.p));
    }

    // Back (top) to front (bottom): fill under each line with the background, then stroke it.
    for (var i = 0; i < lines; i++) {
      var f = i / (lines - 1);                // 0 = back, 1 = front
      var y0 = top + i * gap;
      var x0 = left + shear * (1 - f);
      var gi = i * NB;
      var drift = (f - 0.5) * 0.01;
      var gr = Math.min(1, Math.max(0, (elapsed - 250 - (1 - f) * 700) / 1400));
      gr = 1 - Math.pow(1 - gr, 3);                    // ease out

      for (var n = 0; n <= pts; n++) {
        var u = n / pts;
        var x = x0 + u * span;
        var d = 0;
        for (var q = 0; q < NB; q++) {
          var g = (u - centres[q] - drift) / widths[q];
          d += gain[gi + q] * heights[q] / (1 + g * g);   // Lorentzian band shape
        }
        d += 0.06 * u;                                     // gentle sloping baseline
        var y = y0 - d * amp * gr;
        if (pullK > 0.001) {
          var dx = x - pointer.x, dy = y0 - pointer.y;
          var w = Math.exp(-(dx * dx) / sx - (dy * dy) / sy);
          y += (pointer.y - y) * 0.3 * w * pullK;
        }
        ys[n] = y;
      }

      ctx.beginPath();
      ctx.moveTo(x0, ys[0]);
      for (n = 1; n <= pts; n++) ctx.lineTo(x0 + (n / pts) * span, ys[n]);
      ctx.lineTo(x0 + span, H + 2);
      ctx.lineTo(x0, H + 2);
      ctx.closePath();
      ctx.fillStyle = bg;
      ctx.fill();

      var front = i === lines - 1;               // the front spectrum is the orange one
      ctx.beginPath();
      ctx.moveTo(x0, ys[0]);
      for (n = 1; n <= pts; n++) ctx.lineTo(x0 + (n / pts) * span, ys[n]);
      ctx.lineWidth = front ? 2 : 1;
      ctx.strokeStyle = front ? accent : ink;
      ctx.stroke();
      if (!front && pullK > 0.001) {              // lines near the cursor warm to orange
        var dyl = y0 - pointer.y;
        var hot = pullK * Math.exp(-(dyl * dyl) / (sy * 0.09));
        var m = Math.min(1, Math.max(0, (hot - 0.3) / 0.3));   // sharp switch, so lines are black or orange, not brown
        if (m > 0.01) {
          ctx.globalAlpha = m * m * (3 - 2 * m);
          ctx.lineWidth = 1.6;
          ctx.strokeStyle = accent;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
    }

    // Wavenumber axis under the front spectrum.
    var ay = bottom + gap * 1.6;
    ctx.lineWidth = 1;
    ctx.strokeStyle = muted;
    ctx.fillStyle = muted;
    ctx.beginPath();
    ctx.moveTo(left, ay); ctx.lineTo(left + span, ay);
    var ticks = narrow ? [4000, 3000, 2000, 1000] : [4000, 3500, 3000, 2500, 2000, 1500, 1000, 500];
    ctx.font = (narrow ? 10 : 11) + 'px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
    ctx.textBaseline = 'top';
    for (var tk = 0; tk < ticks.length; tk++) {
      var tx = left + ((KMAX - ticks[tk]) / kRange) * span;
      ctx.moveTo(tx, ay); ctx.lineTo(tx, ay + 4);
      ctx.textAlign = tk === 0 ? 'left' : (ticks[tk] === 500 ? 'right' : 'center');
      ctx.fillText(String(ticks[tk]), tx, ay + 8);
    }
    ctx.stroke();
    ctx.textAlign = 'right';
    if (!narrow) ctx.fillText('wavenumber, cm⁻¹', left + span, ay + 24);
  }

  function frame(now) {
    raf = 0;
    var dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
    last = now;
    t += dt;
    var ease = 1 - Math.pow(0.001, dt);       // frame-rate independent smoothing
    pointer.x += (pointer.tx - pointer.x) * ease;
    pointer.y += (pointer.ty - pointer.y) * ease;
    pointer.k += (pointer.tk - pointer.k) * ease * 0.6;
    draw();
    schedule();
  }
  function schedule() {
    if (!raf && onScreen && !reduce && !document.hidden) raf = requestAnimationFrame(frame);
  }
  function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; last = 0; }

  function onPointer(e) {
    if (e.pointerType === 'touch') return;
    var r = canvas.getBoundingClientRect();
    pointer.tx = e.clientX - r.left;
    pointer.ty = e.clientY - r.top;
    if (pointer.k < 0.01) { pointer.x = pointer.tx; pointer.y = pointer.ty; }
    pointer.tk = 1;
  }
  hero.addEventListener('pointermove', onPointer, { passive: true });
  hero.addEventListener('pointerleave', function () { pointer.tk = 0; });

  var resizeQueued = false;
  window.addEventListener('resize', function () {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(function () { resizeQueued = false; resize(); });
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else schedule(); });

  function onSchemeChange() { readColors(); draw(); }
  function onMotionChange() { reduce = motionQuery.matches; if (reduce) { stop(); draw(); } else schedule(); }
  if (darkQuery.addEventListener) {
    darkQuery.addEventListener('change', onSchemeChange);
    motionQuery.addEventListener('change', onMotionChange);
  }

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      onScreen = entries[0].isIntersecting;
      if (onScreen) schedule(); else stop();
    }).observe(hero);
  }

  t = 4; // start mid-drift so the still frame is a good composition
  resize();
  schedule();

})();

/* Local time in Bengaluru */
(function () {
  var el = document.getElementById('clock');
  if (!el) return;
  var fmt;
  try {
    fmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
  } catch (e) { return; }
  function tick() {
    var s = fmt.format(new Date());
    el.textContent = s + ' IST';
    el.setAttribute('datetime', s);
  }
  tick();
  setInterval(tick, 1000);
})();

/* Page motion: reveal, word-by-word headlines, stagger, scroll progress, parallax, nav highlight */
(function () {
  'use strict';
  var root = document.documentElement;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // 1. Split headlines into words so each can rise into place.
  if (!reduce) {
    var heads = document.querySelectorAll('.f-head h3, .row h3, .big');
    for (var h = 0; h < heads.length; h++) {
      var el = heads[h], words = el.textContent.trim().split(/\s+/);
      el.textContent = '';
      for (var w = 0; w < words.length; w++) {
        var outer = document.createElement('span'); outer.className = 'w';
        var inner = document.createElement('span'); inner.className = 'wi';
        inner.style.setProperty('--i', w);
        inner.textContent = words[w];
        outer.appendChild(inner); el.appendChild(outer);
        if (w < words.length - 1) el.appendChild(document.createTextNode(' '));
      }
    }
  }

  // 2. Give each child of a .stagger container its position in the cascade.
  var groups = document.querySelectorAll('.stagger');
  for (var g = 0; g < groups.length; g++) {
    for (var c = 0; c < groups[g].children.length; c++) groups[g].children[c].style.setProperty('--i', c);
  }

  // 3. Reveal on scroll.
  var els = document.querySelectorAll('.reveal, .stagger');
  if (!('IntersectionObserver' in window) || reduce) {
    for (var i = 0; i < els.length; i++) els[i].classList.add('in');
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    for (var j = 0; j < els.length; j++) io.observe(els[j]);
  }

  // 4. Scroll progress bar and hero parallax, one frame at a time.
  var hero = document.querySelector('.hero'), ticking = false;
  function update() {
    ticking = false;
    var y = window.pageYOffset || 0, vh = window.innerHeight || 1;
    var max = root.scrollHeight - vh;
    root.style.setProperty('--p', max > 0 ? Math.min(1, y / max).toFixed(4) : 0);
    if (!reduce && hero && y < vh * 1.3) {
      hero.style.setProperty('--hy', (y * 0.22).toFixed(1));
      hero.style.setProperty('--hp', Math.min(1, y / (vh * 0.7)).toFixed(3));
    }
  }
  function queue() { if (!ticking) { ticking = true; requestAnimationFrame(update); } }
  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', queue);
  update();

  // 5. Highlight the nav link for the section in view.
  if ('IntersectionObserver' in window) {
    var links = {};
    var anchors = document.querySelectorAll('.pill a[href^="#"]');
    for (var k = 0; k < anchors.length; k++) links[anchors[k].getAttribute('href').slice(1)] = anchors[k];
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var a = links[en.target.id];
        if (!a) return;
        if (en.isIntersecting) {
          for (var id in links) links[id].removeAttribute('aria-current');
          a.setAttribute('aria-current', 'location');
        } else if (a.getAttribute('aria-current')) {
          a.removeAttribute('aria-current');
        }
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    ['work', 'about', 'contact'].forEach(function (id) {
      var sec = document.getElementById(id); if (sec) spy.observe(sec);
    });
  }
})();
