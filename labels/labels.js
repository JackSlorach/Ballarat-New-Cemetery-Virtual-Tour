/* labels/labels.js — Linear compass on top, togglable; chip shows nearest area
   + scene-wide label support; robust scene-change detection + hysteresis. */
(function () {
  'use strict';

  // ---------------- UI scaffold ----------------
  var hud = document.getElementById('label-hud');
  if (!hud) { hud = document.createElement('div'); hud.id = 'label-hud'; document.body.appendChild(hud); }

  var compass = document.getElementById('label-compass');
  if (!compass) { compass = document.createElement('div'); compass.id = 'label-compass'; hud.appendChild(compass); }

  var caret = document.getElementById('comp-caret');
  if (!caret) { caret = document.createElement('div'); caret.id = 'comp-caret'; compass.appendChild(caret); }

  var ruler = document.getElementById('comp-ruler');
  if (!ruler) { ruler = document.createElement('div'); ruler.id = 'comp-ruler'; compass.appendChild(ruler); }

  var chip = document.getElementById('label-chip');
  if (!chip) { chip = document.createElement('div'); chip.id = 'label-chip'; hud.appendChild(chip); }

  // ---------------- Math helpers ----------------
  function rad2deg(r){ return r * 180 / Math.PI; }
  function norm(d){ var x = ((d + 180) % 360 + 360) % 360; return x - 180; }
  function angDiff(a,b){ return Math.abs(norm(a - b)); }

  // ---------------- Config ----------------
  var SPAN_DEG    = 180;
  var MAJOR_STEP  = 30;
  var MINOR_STEP  = 10;

  // Hysteresis for area labels: show when within 25°, hide after 35°
  var SHOW_CONE = 25;   // degrees (enter)
  var HIDE_CONE = 35;   // degrees (exit)

  var CARDINALS = { 0:'N', 90:'E', 180:'S', '-180':'S', '-90':'W' };

  // Toggle (persisted) — default OFF
  var COMPASS_KEY = 'labels_compass_enabled';
  var compassEnabled = false;
  try { compassEnabled = (localStorage.getItem(COMPASS_KEY) === '1'); } catch(e){}
  function applyCompassVisibility(){ compass.classList.toggle('hidden', !compassEnabled); }
  applyCompassVisibility();

  window.LabelHUD = window.LabelHUD || {};
  window.LabelHUD.enableCompass = function(on){
    compassEnabled = !!on;
    try { localStorage.setItem(COMPASS_KEY, on ? '1' : '0'); } catch(e){}
    applyCompassVisibility();
  };
  window.LabelHUD.toggleCompass = function(){ window.LabelHUD.enableCompass(!compassEnabled); };
  document.addEventListener('labels:compass:enable', function(e){ window.LabelHUD.enableCompass(!!(e && e.detail)); });

  // ---------------- Data ----------------
  // db: sceneId -> { north:Number, areas:[{name,yaw,pitch}], sceneWide:String|null }
  var db = {};
  var loaded = false;

  // Track current/previous scene ids for reset
  var currentSceneId = null;
  var prevSceneId = null;

  // ---------------- Ruler ----------------
  function makeRuler(widthPx){
    while (ruler.firstChild) ruler.removeChild(ruler.firstChild);
    var pxPerDeg = widthPx / SPAN_DEG;
    var START = -540, END = 540;
    for (var d = START; d <= END; d += MINOR_STEP) {
      var x = Math.round(widthPx/2 + d * pxPerDeg);
      var isMajor = (d % MAJOR_STEP === 0);
      var isCard  = (d % 90 === 0);

      var tick = document.createElement('div');
      tick.className = 'tick ' + (isCard ? 'cardinal' : (isMajor ? 'major' : 'minor'));
      tick.style.left = x + 'px';
      ruler.appendChild(tick);

      if (isCard) {
        var lblC = document.createElement('div');
        lblC.className = 'tick-label tick-cardinal-label';
        var nd = String(norm(d));
        var card = CARDINALS.hasOwnProperty(nd) ? CARDINALS[nd] : CARDINALS[String(((d%360)+360)%360)];
        lblC.textContent = card || '';
        lblC.style.left = x + 'px';
        ruler.appendChild(lblC);
      } else if (isMajor) {
        var lbl = document.createElement('div');
        lbl.className = 'tick-label';
        var val = ((d % 360) + 360) % 360;
        lbl.textContent = String(val);
        lbl.style.left = x + 'px';
        ruler.appendChild(lbl);
      }
    }
  }

  // ---------------- Chip ----------------
  var lastChipText = null;
  function resetChip(){ lastChipText = null; chip.textContent = ''; chip.classList.remove('visible'); chip.classList.remove('scene-wide'); }
  function showChip(text, mode){
    var t = (text || '').replace(/^\s+|\s+$/g,'');
    if (!t) { resetChip(); return; }
    chip.classList.toggle('scene-wide', mode === 'wide');
    if (t !== lastChipText) {
      chip.textContent = t;
      chip.classList.add('visible');
      lastChipText = t;
    }
  }

  // ---------------- Scene & yaw helpers ----------------
  function domCurrentSceneId(){
    try {
      var el = document.querySelector('#sceneList .scene.current');
      if (el && el.getAttribute) return el.getAttribute('data-id') || null;
    } catch(e){}
    return null;
  }

  function resolveCurrentSceneId(){
    // Priority: DOM “current” marker → our tracked id
    return domCurrentSceneId() || currentSceneId || null;
  }

  function getYawDeg(){
    try {
      if (!window.viewer || !window.viewer.view) return null;
      var v = window.viewer.view();
      if (!v) return null;
      if (typeof v.yaw === 'function') return rad2deg(v.yaw());
      if (typeof v.parameters === 'function') {
        var p = v.parameters({});
        if (p && typeof p.yaw === 'number') return rad2deg(p.yaw);
      }
    } catch (e) {}
    return null;
  }

  // Return best area + its angular delta (single definition)
  function nearestArea(sceneId, yawDeg){
    var entry = db[sceneId];
    if (!entry || !entry.areas || !entry.areas.length) return null;
    var best = null, bestD = 9999;
    for (var i=0; i<entry.areas.length; i++) {
      var a = entry.areas[i];
      var d = angDiff(yawDeg, Number(a.yaw) || 0);
      if (d < bestD) { bestD = d; best = a; }
    }
    return best ? { area: best, delta: bestD } : null;
  }

  function hotspotText(){
    try {
      var list = document.querySelectorAll('.info-hotspot');
      if (!list || !list.length) return null;

      var cx0 = window.innerWidth  / 2;
      var cy0 = window.innerHeight / 2;
      var closeLim = Math.min(window.innerWidth, window.innerHeight) * 0.14; // ~14%

      var i, closest=null, best=1e9;
      for (i=0; i<list.length; i++) {
        var hs = list[i];
        var r = hs.getBoundingClientRect();
        // ignore if mostly off-screen
        if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) continue;

        var cx = r.left + r.width/2;
        var cy = r.top  + r.height/2;
        var d = Math.hypot(cx - cx0, cy - cy0);
        if (d < best) { best = d; closest = hs; }
      }
      if (best <= closeLim && closest) {
        var t = closest.querySelector('.info-hotspot-title');
        var txt = t ? t.textContent.replace(/^\s+|\s+$/g,'') : '';
        return txt || null;
      }
    } catch (e) {}
    return null;
  }

  // ---------------- Paint ----------------
  var lastShift = NaN;

  function paint(){
    if (!loaded) { resetChip(); return; }

    var sceneId = resolveCurrentSceneId();
    if (!sceneId) { resetChip(); return; }

    // If scene changed since last frame, clear chip to avoid “stickiness”
    if (prevSceneId !== sceneId) { resetChip(); prevSceneId = sceneId; }

    var entry = db[sceneId];
    var yawAbs = getYawDeg();

    // Scene-wide label → always show
    if (entry && entry.sceneWide) {
      showChip(entry.sceneWide, 'wide');
    } else {
      // hotspot override > nearest area (with hysteresis)
      var hs = hotspotText();
      if (hs) {
        showChip(hs);
      } else if (entry && yawAbs != null) {
        var res = nearestArea(sceneId, yawAbs); // {area, delta}
        if (!res) {
          resetChip();
        } else {
          var isSame = (lastChipText === res.area.name);
          var lim = isSame ? HIDE_CONE : SHOW_CONE;
          if (res.delta <= lim) showChip(res.area.name);
          else resetChip();
        }
      } else {
        resetChip();
      }
    }

    // Compass
    if (!compassEnabled || !compass.clientWidth) return;
    var W = compass.clientWidth;
    var pxPerDeg = W / SPAN_DEG;

    var initW = ruler.getAttribute('data-init-width');
    if (!initW || Number(initW) !== W) {
      makeRuler(W);
      ruler.setAttribute('data-init-width', String(W));
      lastShift = NaN;
    }

    if (entry && yawAbs != null) {
      var local = norm(yawAbs - (Number(entry.north) || 0));
      var offsetPx = local * pxPerDeg;
      var shift = Math.round(W/2 - offsetPx);
      if (shift !== lastShift) {
        ruler.style.transform = 'translateX(' + shift + 'px)';
        lastShift = shift;
      }
    }
  }

  // ---------------- Load labels JSON ----------------
  fetch('labels/map_labels.json', { cache: 'no-store' })
    .then(function (r){ if (!r.ok) throw new Error('labels JSON not found'); return r.json(); })
    .then(function (j){
      var map = {};
      var scenes = j && j.scenes ? j.scenes : [];
      for (var i=0; i<scenes.length; i++) {
        var s = scenes[i];
        if (!s || !s.sceneId) continue;
        map[s.sceneId] = {
          north: Number(s.north) || 0,
          areas: Array.isArray(s.areas) ? s.areas.slice() : [],
          sceneWide: s.sceneWideLabel ? String(s.sceneWideLabel) : null
        };
      }
      db = map;
      loaded = true;
      paint();
    })
    .catch(function (e){ console.warn('[labels] load failed:', e); });

  // ---------------- Hook scene switches (BOTH forms) ----------------
  // 1) switchToScene(id, opts)
  if (typeof window.switchToScene === 'function') {
    var _origSwitchToScene = window.switchToScene;
    window.switchToScene = function(id, opts){
      currentSceneId = id || null;
      resetChip();
      var rv = _origSwitchToScene.apply(this, arguments);
      setTimeout(paint, 120);
      return rv;
    };
  }
  // 2) switchScene(sceneObj)
  if (typeof window.switchScene === 'function') {
    var _origSwitchScene = window.switchScene;
    window.switchScene = function(sceneObj){
      var id = (sceneObj && sceneObj.data && sceneObj.data.id) || (sceneObj && sceneObj.id) || null;
      currentSceneId = id;
      resetChip();
      var rv = _origSwitchScene.apply(this, arguments);
      setTimeout(paint, 120);
      return rv;
    };
  }

  // Fallback: when the scene list marks a new item as .current
  try {
    var list = document.getElementById('sceneList');
    if (list && window.MutationObserver) {
      var obs = new MutationObserver(function(){ setTimeout(paint, 60); });
      obs.observe(list, { attributes:true, childList:true, subtree:true });
    }
  } catch(e){}

  // Animation loop
  var last = 0;
  function loop(ts){
    if (window.viewer && ts - last > 80) { paint(); last = ts; }
    window.requestAnimationFrame(loop);
  }
  window.requestAnimationFrame(loop);

  window.addEventListener('resize', function(){
    ruler.removeAttribute('data-init-width');
    paint();
  });
})();
