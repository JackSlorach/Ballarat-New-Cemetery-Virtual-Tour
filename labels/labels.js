/* labels/labels.js — Compass + centered chip (area name) under the compass.
   Robust scene detection; continuous repaint (fresh viewer view each frame).
   Hysteresis area label: enter 32°, exit 46°. Reads labels/map_labels.json.

   Numbers are displayed with 0° at NORTH even though NORTH is mapped to -90°.
*/
(function () {
  'use strict';

  // ---------- helpers
  function rad2deg(r){ return r * 180 / Math.PI; }
  function norm(d){ var x=((d+180)%360+360)%360; return x-180; }
  function angDiff(a,b){ return Math.abs(norm(a-b)); }
  function byId(id){ return document.getElementById(id); }

  // ---------- HUD scaffold
  var hud = byId('label-hud'); if(!hud){ hud=document.createElement('div'); hud.id='label-hud'; document.body.appendChild(hud); }
  var compass = byId('label-compass'); if(!compass){ compass=document.createElement('div'); compass.id='label-compass'; hud.appendChild(compass); }
  var caret = byId('comp-caret'); if(!caret){ caret=document.createElement('div'); caret.id='comp-caret'; compass.appendChild(caret); }
  var ruler = byId('comp-ruler'); if(!ruler){ ruler=document.createElement('div'); ruler.id='comp-ruler'; compass.appendChild(ruler); }

  // centered CHIP (under the compass)
  var chip = byId('comp-chip');
  if (!chip){ chip=document.createElement('div'); chip.id='comp-chip'; hud.appendChild(chip); }

  // ---------- config
  var SPAN_DEG=180, MAJOR=30, MINOR=10;
  var SHOW_CONE=32, HIDE_CONE=46;  // hysteresis enter/exit

  // Cardinal mapping used for letters along the bar
  // NORTH is at -90°, then E at 0°, S at +90°, W at ±180°
  var CARDINALS = { '-90':'N', 0:'E', 90:'S', 180:'W', '-180':'W' };

  // Where is NORTH in degrees in the above mapping? (used to shift numeric labels)
  var ZERO_AT_N = (function(){
    for (var k in CARDINALS) if (CARDINALS[k] === 'N') return parseFloat(k) || 0;
    return 0;
  })();

  // Compass toggle (persisted; default OFF) + device rule (mobile/coarse = off)
  var KEY='labels_compass_enabled', compassOn=false;
  try { compassOn = (localStorage.getItem(KEY) === '1'); } catch(_){}
  var media = window.matchMedia('(max-width: 900px), (pointer: coarse)');
  function compassDisabledForDevice(){ return media && media.matches; }
  function applyCompass(){
    var hide = (!compassOn) || compassDisabledForDevice();
    compass.classList.toggle('hidden', hide);
    if (hide) chip.classList.remove('visible');
  }
  if (media && (media.addEventListener || media.addListener)) {
    (media.addEventListener || media.addListener).call(media, 'change', applyCompass);
  }
  applyCompass();

  window.LabelHUD = window.LabelHUD || {};
  window.LabelHUD.enableCompass = function(on){ compassOn=!!on; try{localStorage.setItem(KEY,on?'1':'0');}catch(_){} applyCompass(); };
  window.LabelHUD.toggleCompass  = function(){ window.LabelHUD.enableCompass(!compassOn); };

  // ---------- data
  var db={}, loaded=false;

  // ---------- state
  var lastShift=NaN, lastScene=null, lastArea=null;

  // ---------- ruler (numbers show 0 at NORTH)
    function buildRuler(W){
      while (ruler.firstChild) ruler.removeChild(ruler.firstChild);

      var pxPerDeg = W / SPAN_DEG;

      for (var d = -540; d <= 540; d += MINOR) {
        var x       = Math.round(W/2 + d * pxPerDeg);
        var isMajor = (d % MAJOR === 0);
        var isCard  = (d % 90 === 0);

        // tick line
        var t = document.createElement('div');
        t.className = 'tick ' + (isCard ? 'cardinal' : (isMajor ? 'major' : 'minor'));
        t.style.left = x + 'px';
        ruler.appendChild(t);

        // label: if cardinal, show letter only; otherwise (major) show degree number (0 at N)
        if (isCard) {
          var c = document.createElement('div');
          c.className = 'tick-label tick-cardinal-label';
          var nd  = String(norm(d));
          var lab = CARDINALS.hasOwnProperty(nd) ? CARDINALS[nd]
                                                : CARDINALS[String(((d%360)+360)%360)];
          c.textContent = lab || '';
          c.style.left  = x + 'px';
          ruler.appendChild(c);
          // NOTE: no numeric label under cardinals (N/E/S/W)
        } else if (isMajor) {
          var val = ((d - ZERO_AT_N) % 360 + 360) % 360; // 0..359 with 0 at North
          var l = document.createElement('div');
          l.className = 'tick-label';
          l.textContent = String(val);
          l.style.left  = x + 'px';
          ruler.appendChild(l);
        }
      }
    }

  // ---------- scene + view resolvers (fresh each frame)
  function currentSceneId(){
    if (window.__labelsCurrentScene) return window.__labelsCurrentScene; // hint, set by notifiers
    try {
      if (window.currentScene)
        return window.currentScene.id ||
               (window.currentScene.data && window.currentScene.data.id) || null;
    } catch(_){}
    try {
      var el=document.querySelector('#sceneList .scene.current');
      if (el){ var id=el.getAttribute('data-id'); if (id) return id; }
    } catch(_){}
    if (window.CURRENT_SCENE_ID)    return window.CURRENT_SCENE_ID;
    if (window.__mapuiCurrentScene) return window.__mapuiCurrentScene;
    return lastScene;
  }

  // Always use the viewer's live camera view; avoids stale scene views.
  function freshView(){
    try { if (window.viewer && typeof window.viewer.view === 'function') return window.viewer.view(); } catch(_){}
    return null;
  }
  function yawDegFromView(v){
    try{
      if(!v) return null;
      if (typeof v.yaw==='function') return rad2deg(v.yaw());
      if (typeof v.parameters==='function'){ var p=v.parameters({}); if(p && typeof p.yaw==='number') return rad2deg(p.yaw); }
    }catch(_){}
    return null;
  }

  // ---------- nearest area (with hysteresis)
  function nearestAreaName(sceneId, yaw){
    var e=db[sceneId]; if(!e||!e.areas||!e.areas.length) return null;
    var best=null, bestD=9e9;
    for(var i=0;i<e.areas.length;i++){
      var a=e.areas[i], d=angDiff(yaw, Number(a.yaw)||0);
      if (d<bestD){bestD=d; best=a;}
    }
    if(!best) return null;
    var lim=(lastArea===best.name)?HIDE_CONE:SHOW_CONE;
    return (bestD<=lim)?best.name:null;
  }

  // ---------- chip helpers
  function hideChip(){ chip.classList.remove('visible'); chip.textContent=''; lastArea=null; }
  function showChipText(s){ if(!s){ hideChip(); return; } if(s!==chip.textContent){ chip.textContent=s; } chip.classList.add('visible'); lastArea=s; }

  // ---------- paint
  function paint(sid){
    var e=db[sid]; if(!e){ hideChip(); e={north:0,areas:[]}; }

    var v=freshView(), yaw=yawDegFromView(v);
    if (yaw==null){
      hideChip();
      if (compassOn && compass.clientWidth) {
        var W=compass.clientWidth, iw=ruler.getAttribute('data-init-width');
        if (!iw || Number(iw)!==W){ buildRuler(W); ruler.setAttribute('data-init-width', String(W)); lastShift=NaN; }
        if (lastShift !== 0) { ruler.style.transform='translateX(0px)'; lastShift=0; }
      }
      return;
    }

    // chip (unless scene-wide label is defined — then you can use your own static UI)
    if (e.sceneWideLabel || e.sceneWide){ hideChip(); }
    else { showChipText(nearestAreaName(sid, yaw)); }

    if (!compassOn || !compass.clientWidth) return;
    var W=compass.clientWidth, pxPerDeg=W/SPAN_DEG;
    var initW=ruler.getAttribute('data-init-width');
    if (!initW || Number(initW)!==W){ buildRuler(W); ruler.setAttribute('data-init-width', String(W)); lastShift=NaN; }
    var local=norm(yaw - (Number(e.north)||0));
    var shift=Math.round(W/2 - local*pxPerDeg);
    if (shift!==lastShift){ ruler.style.transform='translateX('+shift+'px)'; lastShift=shift; }
  }

  // ---------- loop (~12fps)
  var lastTick=0;
  function loop(ts){
    if(!loaded){ requestAnimationFrame(loop); return; }
    if (!lastTick || ts-lastTick>80){
      var sid=currentSceneId();
      if (sid){
        if (sid!==lastScene){ lastScene=sid; hideChip(); ruler.removeAttribute('data-init-width'); lastShift=NaN; }
        paint(sid);
      } else { hideChip(); }
      lastTick=ts;
    }
    requestAnimationFrame(loop);
  }

  // ---------- load JSON
  function loadLabels(){
    return fetch('./labels/map_labels.json?cb='+Date.now(), {cache:'no-store'})
      .then(function(r){ return r.ok?r.json():{scenes:[]}; })
      .then(function(j){
        db={};
        var arr=j&&j.scenes?j.scenes:[];
        for (var i=0;i<arr.length;i++){
          var s=arr[i]; if(!s||!s.sceneId) continue;
          db[s.sceneId]={
            north:Number(s.north)||0,
            areas:Array.isArray(s.areas)?s.areas.slice():[],
            sceneWideLabel: s.sceneWideLabel?String(s.sceneWideLabel):null,
            sceneWide: s.sceneWideLabel?String(s.sceneWideLabel):null
          };
        }
        loaded=true;
      })
      .catch(function(e){ console.warn('[labels] load failed', e); db={}; loaded=true; });
  }

  // Fast-track repaints when the app announces a scene
  window.addEventListener('labels:scene', function (e) {
    var id = e && e.detail; if (!id) return;
    window.__labelsCurrentScene = id;
    try { ruler.removeAttribute('data-init-width'); } catch(_){}
    hideChip();
    try { requestAnimationFrame(function(){ paint(id); }); } catch(_){}
  });

  // Optional helper your code can call on any scene switch
  window.__notifySceneChange = function(id){
    window.__labelsCurrentScene = id || null;
    hideChip(); ruler.removeAttribute('data-init-width'); lastShift=NaN;
  };

  // init
  loadLabels().then(function(){ requestAnimationFrame(loop); });
  window.addEventListener('resize', function(){ ruler.removeAttribute('data-init-width'); });
})();
