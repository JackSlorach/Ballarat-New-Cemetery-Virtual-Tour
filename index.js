/*
 * Copyright 2016 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
'use strict';

(function() {
  var Marzipano = window.Marzipano;
  var bowser = window.bowser;
  var screenfull = window.screenfull;
  var data = window.APP_DATA;

  // Grab elements from DOM.
  var panoElement = document.querySelector('#pano');
  var sceneNameElement = document.querySelector('#titleBar .sceneName');
  var sceneListElement = document.querySelector('#sceneList');
  var sceneElements = document.querySelectorAll('#sceneList .scene');
  var sceneListToggleElement = document.querySelector('#sceneListToggle');
  var autorotateToggleElement = document.querySelector('#autorotateToggle');
  var fullscreenToggleElement = document.querySelector('#fullscreenToggle');

  // Detect desktop or mobile mode.
  if (window.matchMedia) {
    var setMode = function() {
      if (mql.matches) {
        document.body.classList.remove('desktop');
        document.body.classList.add('mobile');
      } else {
        document.body.classList.remove('mobile');
        document.body.classList.add('desktop');
      }
    };
    var mql = matchMedia("(max-width: 500px), (max-height: 500px)");
    setMode();
    mql.addListener(setMode);
  } else {
    document.body.classList.add('desktop');
  }

  // Detect whether we are on a touch device.
  document.body.classList.add('no-touch');
  window.addEventListener('touchstart', function() {
    document.body.classList.remove('no-touch');
    document.body.classList.add('touch');
  });

  // Use tooltip fallback mode on IE < 11.
  if (bowser.msie && parseFloat(bowser.version) < 11) {
    document.body.classList.add('tooltip-fallback');
  }

  // Viewer options.
  var viewerOpts = {
    controls: {
      mouseViewMode: data.settings.mouseViewMode
    }
  };

  // Initialize viewer.
  var viewer = new Marzipano.Viewer(panoElement, viewerOpts);

  // Create scenes.
  var scenes = data.scenes.map(function(data) {
    var urlPrefix = "tiles";
    var source = Marzipano.ImageUrlSource.fromString(
      urlPrefix + "/" + data.id + "/{z}/{f}/{y}/{x}.jpg",
      { cubeMapPreviewUrl: urlPrefix + "/" + data.id + "/preview.jpg" });
    var geometry = new Marzipano.CubeGeometry(data.levels);

    var limiter = Marzipano.RectilinearView.limit.traditional(data.faceSize, 100*Math.PI/180, 120*Math.PI/180);
    var view = new Marzipano.RectilinearView(data.initialViewParameters, limiter);

    var scene = viewer.createScene({
      source: source,
      geometry: geometry,
      view: view,
      pinFirstLevel: true
    });

    // Create link hotspots.
    data.linkHotspots.forEach(function(hotspot) {
      var element = createLinkHotspotElement(hotspot);
      scene.hotspotContainer().createHotspot(element, { yaw: hotspot.yaw, pitch: hotspot.pitch });
    });

    // Create info hotspots.
    data.infoHotspots.forEach(function(hotspot) {
      var element = createInfoHotspotElement(hotspot);
      scene.hotspotContainer().createHotspot(element, { yaw: hotspot.yaw, pitch: hotspot.pitch });
    });

    return {
      data: data,
      scene: scene,
      view: view
    };
  });

  // Set up autorotate, if enabled.
  var autorotate = Marzipano.autorotate({
    yawSpeed: 0.03,
    targetPitch: 0,
    targetFov: Math.PI/2
  });
  if (data.settings.autorotateEnabled) {
    autorotateToggleElement.classList.add('enabled');
  }

  // Set handler for autorotate toggle.
  autorotateToggleElement.addEventListener('click', toggleAutorotate);

  // Set up fullscreen mode, if supported.
  if (screenfull.enabled && data.settings.fullscreenButton) {
    document.body.classList.add('fullscreen-enabled');
    fullscreenToggleElement.addEventListener('click', function() {
      screenfull.toggle();
    });
    screenfull.on('change', function() {
      if (screenfull.isFullscreen) {
        fullscreenToggleElement.classList.add('enabled');
      } else {
        fullscreenToggleElement.classList.remove('enabled');
      }
    });
  } else {
    document.body.classList.add('fullscreen-disabled');
  }

  // Set handler for scene list toggle.
  sceneListToggleElement.addEventListener('click', toggleSceneList);

  // Start with the scene list open on desktop.
  if (!document.body.classList.contains('mobile')) {
    showSceneList();
  }

  // Set handler for scene switch.
  scenes.forEach(function(scene) {
    var el = document.querySelector('#sceneList .scene[data-id="' + scene.data.id + '"]');
    el.addEventListener('click', function() {
      switchScene(scene);
      // On mobile, hide scene list after selecting a scene.
      if (document.body.classList.contains('mobile')) {
        hideSceneList();
      }
    });
  });

  // DOM elements for view controls.
  var viewUpElement = document.querySelector('#viewUp');
  var viewDownElement = document.querySelector('#viewDown');
  var viewLeftElement = document.querySelector('#viewLeft');
  var viewRightElement = document.querySelector('#viewRight');
  var viewInElement = document.querySelector('#viewIn');
  var viewOutElement = document.querySelector('#viewOut');

  // Dynamic parameters for controls.
  var velocity = 0.7;
  var friction = 3;

  // Associate view controls with elements.
  var controls = viewer.controls();
  controls.registerMethod('upElement',    new Marzipano.ElementPressControlMethod(viewUpElement,     'y', -velocity, friction), true);
  controls.registerMethod('downElement',  new Marzipano.ElementPressControlMethod(viewDownElement,   'y',  velocity, friction), true);
  controls.registerMethod('leftElement',  new Marzipano.ElementPressControlMethod(viewLeftElement,   'x', -velocity, friction), true);
  controls.registerMethod('rightElement', new Marzipano.ElementPressControlMethod(viewRightElement,  'x',  velocity, friction), true);
  controls.registerMethod('inElement',    new Marzipano.ElementPressControlMethod(viewInElement,  'zoom', -velocity, friction), true);
  controls.registerMethod('outElement',   new Marzipano.ElementPressControlMethod(viewOutElement, 'zoom',  velocity, friction), true);

  function sanitize(s) {
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;');
  }

  function switchScene(scene) {
    scene.view.setParameters(scene.data.initialViewParameters);
    scene.scene.switchTo();
    updateSceneName(scene);
    updateSceneList(scene);
  }

  function updateSceneName(scene) {
    sceneNameElement.innerHTML = sanitize(scene.data.name);
  }

  function updateSceneList(scene) {
    for (var i = 0; i < sceneElements.length; i++) {
      var el = sceneElements[i];
      if (el.getAttribute('data-id') === scene.data.id) {
        el.classList.add('current');
      } else {
        el.classList.remove('current');
      }
    }
  }

  function showSceneList() {
    sceneListElement.classList.add('enabled');
    sceneListToggleElement.classList.add('enabled');
  }

  function hideSceneList() {
    sceneListElement.classList.remove('enabled');
    sceneListToggleElement.classList.remove('enabled');
  }

  function toggleSceneList() {
    sceneListElement.classList.toggle('enabled');
    sceneListToggleElement.classList.toggle('enabled');
  }

  function startAutorotate() {
    if (!autorotateToggleElement.classList.contains('enabled')) {
      return;
    }
    viewer.startMovement(autorotate);
    viewer.setIdleMovement(3000, autorotate);
  }

  function stopAutorotate() {
    viewer.stopMovement();
    viewer.setIdleMovement(Infinity);
  }

  function toggleAutorotate() {
    if (autorotateToggleElement.classList.contains('enabled')) {
      autorotateToggleElement.classList.remove('enabled');
      stopAutorotate();
    } else {
      autorotateToggleElement.classList.add('enabled');
      startAutorotate();
    }
  }

  function createLinkHotspotElement(hotspot) {

    // Create wrapper element to hold icon and tooltip.
    var wrapper = document.createElement('div');
    wrapper.classList.add('hotspot');
    wrapper.classList.add('link-hotspot');

    // Create image element.
    var icon = document.createElement('img');
    icon.src = 'img/link.png';
    icon.classList.add('link-hotspot-icon');

    // Set rotation transform.
    var transformProperties = [ '-ms-transform', '-webkit-transform', 'transform' ];
    for (var i = 0; i < transformProperties.length; i++) {
      var property = transformProperties[i];
      icon.style[property] = 'rotate(' + hotspot.rotation + 'rad)';
    }

    // Add click event handler.
    wrapper.addEventListener('click', function() {
      switchScene(findSceneById(hotspot.target));
    });

    // Prevent touch and scroll events from reaching the parent element.
    // This prevents the view control logic from interfering with the hotspot.
    stopTouchAndScrollEventPropagation(wrapper);

    // Create tooltip element.
    var tooltip = document.createElement('div');
    tooltip.classList.add('hotspot-tooltip');
    tooltip.classList.add('link-hotspot-tooltip');
    tooltip.innerHTML = findSceneDataById(hotspot.target).name;

    wrapper.appendChild(icon);
    wrapper.appendChild(tooltip);

    return wrapper;
  }

  function createInfoHotspotElement(hotspot) {

    // Create wrapper element to hold icon and tooltip.
    var wrapper = document.createElement('div');
    wrapper.classList.add('hotspot');
    wrapper.classList.add('info-hotspot');

    // Create hotspot/tooltip header.
    var header = document.createElement('div');
    header.classList.add('info-hotspot-header');

    // Create image element.
    var iconWrapper = document.createElement('div');
    iconWrapper.classList.add('info-hotspot-icon-wrapper');
    var icon = document.createElement('img');
    icon.src = 'img/info.png';
    icon.classList.add('info-hotspot-icon');
    iconWrapper.appendChild(icon);

    // Create title element.
    var titleWrapper = document.createElement('div');
    titleWrapper.classList.add('info-hotspot-title-wrapper');
    var title = document.createElement('div');
    title.classList.add('info-hotspot-title');
    title.innerHTML = hotspot.title;
    titleWrapper.appendChild(title);

    // Create close element.
    var closeWrapper = document.createElement('div');
    closeWrapper.classList.add('info-hotspot-close-wrapper');
    var closeIcon = document.createElement('img');
    closeIcon.src = 'img/close.png';
    closeIcon.classList.add('info-hotspot-close-icon');
    closeWrapper.appendChild(closeIcon);

    // Construct header element.
    header.appendChild(iconWrapper);
    header.appendChild(titleWrapper);
    header.appendChild(closeWrapper);

    // Create text element.
    var text = document.createElement('div');
    text.classList.add('info-hotspot-text');
    text.innerHTML = hotspot.text;

    // Place header and text into wrapper element.
    wrapper.appendChild(header);
    wrapper.appendChild(text);

    // Create a modal for the hotspot content to appear on mobile mode.
    var modal = document.createElement('div');
    modal.innerHTML = wrapper.innerHTML;
    modal.classList.add('info-hotspot-modal');
    document.body.appendChild(modal);

    var toggle = function() {
      wrapper.classList.toggle('visible');
      modal.classList.toggle('visible');
    };

    // Show content when hotspot is clicked.
    wrapper.querySelector('.info-hotspot-header').addEventListener('click', toggle);

    // Hide content when close icon is clicked.
    modal.querySelector('.info-hotspot-close-wrapper').addEventListener('click', toggle);

    // Prevent touch and scroll events from reaching the parent element.
    // This prevents the view control logic from interfering with the hotspot.
    stopTouchAndScrollEventPropagation(wrapper);

    return wrapper;
  }

  // Prevent touch and scroll events from reaching the parent element.
  function stopTouchAndScrollEventPropagation(element, eventList) {
    var eventList = [ 'touchstart', 'touchmove', 'touchend', 'touchcancel',
                      'wheel', 'mousewheel' ];
    for (var i = 0; i < eventList.length; i++) {
      element.addEventListener(eventList[i], function(event) {
        event.stopPropagation();
      });
    }
  }

  function findSceneById(id) {
    for (var i = 0; i < scenes.length; i++) {
      if (scenes[i].data.id === id) {
        return scenes[i];
      }
    }
    return null;
  }

  function findSceneDataById(id) {
    for (var i = 0; i < data.scenes.length; i++) {
      if (data.scenes[i].id === id) {
        return data.scenes[i];
      }
    }
    return null;
  }

  // Display the initial scene.
  switchScene(scenes[0]);
  // --- Display the initial scene (no autorotate on load) ---
  const initialScene = scenes[0];
  initialScene.scene.switchTo();
  updateSceneName(initialScene);
  updateSceneList(initialScene);

  // --- MapUI integration: notify which scene is active ---
  if (window.mapUISetActive) window.mapUISetActive(initialScene.data.id);
  if (window.mapuiOnSceneChange) window.mapuiOnSceneChange(initialScene.data.id);

  // --- Expose viewer & scene registries globally for MapUI teleport support ---
  window.viewer = viewer;
  window.sceneById = {};
  scenes.forEach((s) => {
    const id = s.data?.id || s.id;
    const scn = s.scene || s;
    if (id && scn) window.sceneById[id] = scn;
  });

  // --- Expose findSceneById (MapUI legacy fallback expects it) ---
  window.findSceneById = function(id) {
    for (let i = 0; i < scenes.length; i++) {
      if (scenes[i].data.id === id) return scenes[i];
    }
    return null;
  };

  // --- Expose switchScene (MapUI legacy fallback expects it) ---
  window.switchScene = function(sceneObj) {
    if (!sceneObj) return;
    viewer.stopMovement();                     // stop autorotate
    viewer.setIdleMovement(Infinity);
    sceneObj.view.setParameters(sceneObj.data.initialViewParameters);
    sceneObj.scene.switchTo(Object.assign({ transitionDuration: 800 }, {}));
    updateSceneName(sceneObj);
    updateSceneList(sceneObj);
    if (window.mapUISetActive) window.mapUISetActive(sceneObj.data.id);
    if (window.mapuiOnSceneChange) window.mapuiOnSceneChange(sceneObj.data.id);
  };

  // --- Main teleport method (preferred by MapUI) ---
  window.switchToScene = function(id, opts) {
    const scn = window.sceneById && window.sceneById[id];
    if (scn && typeof scn.switchTo === 'function') {
      scn.switchTo(Object.assign({ transitionDuration: 800 }, opts));
      if (window.mapUISetActive) window.mapUISetActive(id);
      if (window.mapuiOnSceneChange) window.mapuiOnSceneChange(id);
    } else {
      console.warn('[MapUI] Scene not found for id:', id);
    }
  };

  initQuickMenuSystem();

})();
// Feature: Quick Menu (QM) system for audio, fullscreen, and autorotate control
function initQuickMenuSystem() {
  const wrapper    = document.getElementById('qm');
  const navigation = wrapper?.querySelector('.navigation');
  const closeBtn   = wrapper?.querySelector('.close');
  const audio      = document.getElementById('ambientAudio');

  if (!wrapper || !navigation) return; // nothing to initialize

  const volDisplay = wrapper.querySelector('.vol-display');
  const volCell    = document.getElementById('qmVolCell') || volDisplay?.querySelector('strong');

  let armed = false;
  let revealTimer;

  // ----- helpers -----
  function ensureAudioStarted(){
    if (!audio) return;
    if (audio.paused) audio.play().catch(()=>{}); // satisfy autoplay policy
  }
  function updateVolCell(){
    if (!volCell || !audio) return;
    const level = audio.muted ? 0 : (audio.volume ?? 0);
    const pct   = Math.round(level * 100);
    volCell.textContent = (pct === 0) ? 'Muted' : `${pct}%`;
  }
  audio?.addEventListener('volumechange', updateVolCell);
  updateVolCell();

  // ----- open / close with animation awareness -----
  function openMenu(){
    if (navigation.classList.contains('active')) return;
    armed = false;
    volDisplay?.classList.remove('reveal'); // hide % text until anim done

    const onEnd = (ev) => {
      if (ev.target !== volDisplay || ev.propertyName !== 'transform') return;
      armed = true;
      volDisplay.classList.add('reveal');
      volDisplay.removeEventListener('transitionend', onEnd);
      clearTimeout(revealTimer);
    };
    volDisplay?.addEventListener('transitionend', onEnd);

    revealTimer = setTimeout(() => {
      armed = true;
      volDisplay?.classList.add('reveal');
    }, 700);

    navigation.classList.add('active');
    updateVolCell();
  }

  function closeMenu(){
    if (!navigation.classList.contains('active')) return;
    navigation.classList.remove('active');
    volDisplay?.classList.remove('reveal');
    armed = false;
    clearTimeout(revealTimer);
  }

  // ----- handle navigation clicks -----
  navigation.addEventListener('click', (e) => {
    if (!navigation.classList.contains('active')) {
      openMenu();
      return;
    }
    if (!armed) return;

    const tile = e.target.closest('span');
    if (!tile) return;

    switch (tile.dataset.action) {
      case 'mute':
        if (!audio) break;
        ensureAudioStarted();
        audio.muted = !audio.muted;
        updateVolCell();
        break;
      case 'vol-down':
        if (!audio) break;
        ensureAudioStarted();
        audio.muted = false;
        audio.volume = Math.max(0, (audio.volume ?? 1) - 0.1);
        updateVolCell();
        break;
      case 'vol-up':
        if (!audio) break;
        ensureAudioStarted();
        audio.muted = false;
        audio.volume = Math.min(1, (audio.volume ?? 1) + 0.1);
        updateVolCell();
        break;
      case 'fullscreen': {
        const elem = document.documentElement;
        if (window.screenfull && screenfull.enabled) screenfull.toggle(elem);
        else if (!document.fullscreenElement)
          (elem.requestFullscreen || elem.webkitRequestFullscreen || elem.msRequestFullscreen)?.call(elem);
        else
          (document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen)?.call(document);
        break;
      }
      default: break;
    }
  });

  // ----- autorotate tile integration -----
  (function(){
    const navRoot  = document.querySelector('#qm .navigation');
    const autoTile = document.querySelector('#qm .autorotate');
    const autoLink = document.getElementById('autorotateToggle');

    if (!navRoot || !autoTile || !autoLink) return;

    let revealFallback;
    function armAutorotateTile(){
      autoTile.classList.remove('reveal');
      const onEnd = (ev) => {
        if (ev.target !== autoTile || ev.propertyName !== 'transform') return;
        autoTile.classList.add('reveal');
        autoTile.removeEventListener('transitionend', onEnd);
        clearTimeout(revealFallback);
      };
      autoTile.addEventListener('transitionend', onEnd);
      clearTimeout(revealFallback);
      revealFallback = setTimeout(() => autoTile.classList.add('reveal'), 700);
    }
    function disarmAutorotateTile(){
      autoTile.classList.remove('reveal');
      clearTimeout(revealFallback);
    }

    const mo = new MutationObserver(() => {
      if (navRoot.classList.contains('active')) armAutorotateTile();
      else disarmAutorotateTile();
    });
    mo.observe(navRoot, { attributes: true, attributeFilter: ['class'] });

    navRoot.addEventListener('click', (e) => {
      const tile = e.target.closest('span');
      if (!tile || tile !== autoTile) return;
      if (!autoTile.classList.contains('reveal')) return;
      e.preventDefault();
      autoLink.click(); // triggers autorotate toggle from main file
    });
  })();

// ----- autorotate UI state -----
(function(){
  const autoLink = document.getElementById('autorotateToggle');
  if (!autoLink) return;

  function setAutorotateUI(on){
    document.body.classList.toggle('autorotate-on', !!on);
    autoLink.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (on) autoLink.classList.add('enabled');
    else autoLink.classList.remove('enabled');
  }

  // Ensure autorotate is OFF by default
  setAutorotateUI(false);

  // Toggle the UI and viewer behavior when user clicks
  autoLink.addEventListener('click', () => {
    const on = !document.body.classList.contains('autorotate-on');
    setAutorotateUI(on);
  });
})();
  // --- Auto-close the Quick Menu when a scene teleport occurs via MapUI ---
  if (window.mapuiOnSceneChange) {
    const originalMapuiOnSceneChange = window.mapuiOnSceneChange;
    window.mapuiOnSceneChange = function(id) {
      try {
        // Call the original handler first
        originalMapuiOnSceneChange(id);
      } catch (e) {
        console.warn('[QuickMenu] mapuiOnSceneChange error:', e);
      }
      // Then close the menu if it's open
      if (navigation?.classList.contains('active')) closeMenu();
    };
  } else {
    // If no handler yet, add one that just closes the menu
    window.mapuiOnSceneChange = function() {
      if (navigation?.classList.contains('active')) closeMenu();
    };
  }

  // ----- try autoplay on load (muted) -----
  document.addEventListener('DOMContentLoaded', async () => {
    const audio = document.getElementById('ambientAudio');
    if (!audio) return;
    audio.volume = 0.6;
    try { await audio.play(); } catch (_) {}

    const unlock = () => {
      const target = audio.volume || 0.6;
      audio.muted = false;
      audio.volume = 0.0;
      audio.play().catch(()=>{});
      const step = 0.05;
      const iv = setInterval(() => {
        audio.volume = Math.min(target, audio.volume + step);
        if (audio.volume >= target) clearInterval(iv);
      }, 50);
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
      window.removeEventListener('touchstart', unlock, true);
    };

    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    window.addEventListener('touchstart', unlock, true);
  });

  closeBtn?.addEventListener('click', closeMenu);
  document.addEventListener('mousedown', (e) => {
    if (navigation.classList.contains('active') && !wrapper.contains(e.target)) closeMenu();
  });
}
// Feature: Quick Menu (QM) system END
// Disable all hotspot titles tooltips in JS
document.querySelectorAll('.hotspot-tooltip, .tooltip, .info-hotspot-tooltip').forEach(el => {
  el.remove();
});

(function(){
  var STORAGE_KEY = 'labels_compass_enabled';
  var btn = document.querySelector('[data-action="compass"]');
  if (!btn) return;

  // read persisted state (default ON if not set)
  var saved = null;
  try { saved = localStorage.getItem(STORAGE_KEY); } catch(e){}
  var enabled = (saved === '1'); 
  
  // apply initial UI + inform HUD (if already loaded)
  btn.classList.toggle('active', enabled);
  btn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
  if (window.LabelHUD && typeof window.LabelHUD.enableCompass === 'function') {
    window.LabelHUD.enableCompass(enabled);
  }

  // click handler
  btn.addEventListener('click', function(){
    enabled = !btn.classList.contains('active'); // toggle to opposite
    btn.classList.toggle('active', enabled);
    btn.setAttribute('aria-pressed', enabled ? 'true' : 'false');

    // call HUD API (labels.js) — this shows/hides the compass bar
    if (window.LabelHUD && typeof window.LabelHUD.enableCompass === 'function') {
      window.LabelHUD.enableCompass(enabled);
    }

    // persist
    try { localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0'); } catch(e){}
  });

  // Safety: if labels.js loads later, sync once it’s ready
  window.addEventListener('labels:hud-ready', function(){
    if (window.LabelHUD && typeof window.LabelHUD.enableCompass === 'function') {
      window.LabelHUD.enableCompass(
        document.querySelector('[data-action="compass"]').classList.contains('active')
      );
    }
  });
})();

// Build nav graph from your scenes + links and register with NavigationHUD
(function(){
  if (!window.APP_DATA || !APP_DATA.scenes || !window.NavigationHUD) return;

  var g = {};
  APP_DATA.scenes.forEach(function(scene){
    var links = scene.linkHotspots || [];
    g[scene.id] = links.map(function(h){
      var yawDeg = (typeof h.yaw==='number') ? (h.yaw * 180/Math.PI) : 0; // APP_DATA yaw is radians
      return { to: h.target, yawDeg: yawDeg };
    });
  });
  NavigationHUD.setGraph(g);

  // Tiny helpers for your UI
  window.navTo       = function(sceneId, label){ NavigationHUD.start(sceneId, label || sceneId); };
  window.navStop     = function(){ NavigationHUD.stop(); };
  window.autoTourTo  = function(sceneId, dwellMs){ (window.NavAutoTour||{}).startTo && NavAutoTour.startTo(sceneId, dwellMs); };
  window.autoTourStop= function(){ (window.NavAutoTour||{}).stop && NavAutoTour.stop(); };
})();
// Allow external code (your tour) to tell us the new scene id explicitly.
window.LabelHUD = window.LabelHUD || {};
window.LabelHUD.setScene = function(id){
  if (!id) return;
  currentSceneId = id;
  // Give the new scene a moment to mount its hotspots, and prevent old hotspot text
  ignoreHotspotUntil = (performance && performance.now ? performance.now() : 0) + 700;
  hardClear();
  resetChip();
  setTimeout(paint, 60);
};
