// Scene Label Editor (Multi-Area) — auto-save NORTH per scene + scene-wide label GUI
(() => {
  // --- State ---
  let viewer;
  const scenes = {};          // id -> { scene, view, data }
  let currentSceneId = null;
  let activeLabelIndex = null;

  // JSON: { scenes: [ { sceneId, north, sceneWideLabel?, areas:[{name,yaw,pitch}, ...] }, ... ] }
  let labelsData = { scenes: [] };

  // --- Elements ---
  const panoEl      = document.getElementById("pano");
  const sceneList   = document.getElementById("sceneListItems");
  const areaList    = document.getElementById("areaList");

  const sceneIdEl   = document.getElementById("sceneId");
  const sceneWideEl = document.getElementById("sceneWide");
  const clearWideEl = document.getElementById("clearSceneWide");

  const areaNameEl  = document.getElementById("areaName");
  const yawEl       = document.getElementById("yaw");
  const pitchEl     = document.getElementById("pitch");
  const northEl     = document.getElementById("north");

  const rad2deg = r => r * 180 / Math.PI;
  const deg2rad = d => d * Math.PI / 180;

  function mustGetMarzipano() {
    const M = window.Marzipano || window.MARZIPANO;
    if (!M) throw new Error("Marzipano is not loaded. Ensure ../marzipano.js is included before this script.");
    return M;
  }

  function getSceneEntry(id){ return labelsData.scenes.find(s => s.sceneId === id); }
  function ensureSceneEntry(id){
    let e = getSceneEntry(id);
    if(!e){ e = { sceneId: id, north: 0, areas: [] }; labelsData.scenes.push(e); }
    if (!Array.isArray(e.areas)) e.areas = [];
    return e;
  }
  function saveLocal(){ try { localStorage.setItem("map_labels", JSON.stringify(labelsData)); } catch(_){} }

  // --- central helper to write & persist NORTH immediately ---
  function writeNorthForCurrentScene(n){
    if (!currentSceneId) return;
    const val = Number(n);
    if (!isFinite(val)) return;
    const entry = ensureSceneEntry(currentSceneId);
    entry.north = Math.round(val);
    northEl.value = String(entry.north);   // normalize UI
    saveLocal();
  }

  // --- Robust scene boot ---
  function getTileUrlForScene(s){
    // Prefer a tileUrl provided by data.js, else fallback to ../tiles pattern
    if (s.tileUrl && typeof s.tileUrl === 'string') return s.tileUrl;
    const base = (window.TILES_BASE || "../tiles");
    return `${base}/${s.id}/{z}/{f}/{y}/{x}.jpg`;
  }

  function buildScenes(){
    const M = mustGetMarzipano();
    window.APP_DATA = window.APP_DATA || {};

    const list = Array.isArray(window.APP_DATA.scenes) ? window.APP_DATA.scenes : [];
    if (!list.length) {
      // Don't throw—show a gentle hint in the viewport so the editor UI still loads
      if (panoEl) {
        panoEl.innerHTML =
          '<div style="color:#fff;background:#222;padding:12px;border-radius:8px;max-width:520px;margin:12px;">' +
          '<strong>No scenes found.</strong> Ensure <code>../data.js</code> is included and defines <code>APP_DATA.scenes</code>.' +
          '</div>';
      }
      return;
    }

    // Create viewer once
    try { viewer = new M.Viewer(panoEl); }
    catch (e) {
      console.error("[Editor] Viewer init failed:", e);
      return;
    }

    // Build each scene defensively
    list.forEach(s => {
      try {
        const srcUrl = getTileUrlForScene(s);
        const source = M.ImageUrlSource.fromString(
          srcUrl,
          { cubeMapPreviewUrl: (s.previewUrl || srcUrl.replace("{z}/{f}/{y}/{x}.jpg","preview.jpg")) }
        );

        const geometry = new M.CubeGeometry(s.levels || []);
        const limiter = M.RectilinearView.limit.traditional(
          s.faceSize || 8192,
          120 * Math.PI / 180
        );
        const view = new M.RectilinearView(s.initialViewParameters || {}, limiter);

        const scene = viewer.createScene({ source, geometry, view, pinFirstLevel: true });
        scenes[s.id] = { scene, view, data: s };
      } catch (err) {
        console.warn("[Editor] Failed to create scene", s && s.id, err);
      }
    });
  }

  function sceneBadgeText(id){
    const e = getSceneEntry(id);
    return (e && e.sceneWideLabel) ? " 🌐" : "";
  }

  function populateSceneList(){
    sceneList.innerHTML = "";
    Object.keys(scenes).forEach(id => {
      const li = document.createElement("li");
      li.textContent = (scenes[id].data.name || id) + sceneBadgeText(id);
      li.addEventListener("click", () => switchTo(id));
      sceneList.appendChild(li);
    });
  }

  // Persist panel fields (NORTH + sceneWide) before moving away
  function persistPanelSceneFields(){
    if (!currentSceneId) return;
    writeNorthForCurrentScene(northEl.value);  // North: always save current input
    const entry = ensureSceneEntry(currentSceneId);
    const wide = (sceneWideEl.value || "").trim();
    if (wide) entry.sceneWideLabel = wide; else delete entry.sceneWideLabel;
    saveLocal();
  }

  function switchTo(id){
    if(!scenes[id]) return;

    // auto-save current scene fields before switching
    persistPanelSceneFields();

    currentSceneId = id;
    try {
      scenes[id].scene.switchTo({ transitionDuration: 400 });
    } catch (e) {
      console.warn("[Editor] switchTo failed for scene:", id, e);
    }
    sceneIdEl.value = id;
    activeLabelIndex = null;
    refreshAreaList();
    renderEditorPins();
    updateSceneWideField();
    markActiveSceneInList();
  }

  function markActiveSceneInList(){
    const items = sceneList.querySelectorAll('li');
    for (let i=0;i<items.length;i++){
      const li = items[i];
      const text = li.textContent.replace(/\s*🌐$/,'');
      const id = Object.keys(scenes).find(k => (scenes[k].data.name || k) === text || k === text);
      if (!id) continue;
      if (id === currentSceneId) li.classList.add('active'); else li.classList.remove('active');
      // refresh the 🌐 badge as we might have just added/cleared it
      li.textContent = (scenes[id].data.name || id) + sceneBadgeText(id);
    }
  }

  // Clicking pano → enter "new label" mode with yaw/pitch filled
  function onPanoClick(ev){
    if(!currentSceneId) return;
    const rect = panoEl.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    try {
      const coords = scenes[currentSceneId].view.screenToCoordinates({ x, y });
      yawEl.value   = rad2deg(coords.yaw).toFixed(2);
      pitchEl.value = rad2deg(coords.pitch).toFixed(2);
    } catch (e) {
      console.warn("[Editor] screenToCoordinates failed:", e);
    }
    activeLabelIndex = null;
    [...areaList.querySelectorAll('li')].forEach(li => li.classList.remove('active'));
  }

  function refreshAreaList(){
    const entry = ensureSceneEntry(currentSceneId);
    northEl.value = entry.north ?? 0;

    areaList.innerHTML = "";
    if(!entry.areas.length) return;

    entry.areas.forEach((a,idx) => {
      const li = document.createElement("li");
      li.textContent = `${a.name} (yaw: ${Number(a.yaw).toFixed(1)}°)`;
      if(idx === activeLabelIndex) li.classList.add("active");
      li.addEventListener("click", () => selectLabel(idx));
      areaList.appendChild(li);
    });
  }

  function selectLabel(idx){
    activeLabelIndex = idx;
    const entry = ensureSceneEntry(currentSceneId);
    const a = entry.areas[idx];
    areaNameEl.value = a.name || '';
    yawEl.value = a.yaw || 0;
    pitchEl.value = a.pitch || 0;
    northEl.value = entry.north ?? 0;
    refreshAreaList();
    renderEditorPins();
  }

  // Editor-only pins
  let pinHotspots = [];
  function clearPins(){ pinHotspots.forEach(h => h && h.destroy && h.destroy()); pinHotspots = []; }
  function renderEditorPins(){
    clearPins();
    const entry = getSceneEntry(currentSceneId);
    if(!entry) return;
    const M = mustGetMarzipano();
    entry.areas.forEach((a,idx) => {
      try {
        const el = document.createElement("div");
        el.className = "editor-pin";
        el.textContent = a.name;
        if(idx === activeLabelIndex) el.style.background = "#ffd166";
        const hp = scenes[currentSceneId]
          .scene.hotspotContainer()
          .createHotspot(el, { yaw: deg2rad(a.yaw), pitch: deg2rad(a.pitch) });
        pinHotspots.push(hp);
      } catch(e) {
        console.warn("[Editor] createHotspot failed:", e);
      }
    });
  }

  // --- NORTH: set from current view -> saves immediately ---
  document.getElementById("setNorth").addEventListener("click", () => {
    if(!currentSceneId) return;
    try {
      const yaw = rad2deg(scenes[currentSceneId].view.yaw());
      writeNorthForCurrentScene(yaw);
      refreshAreaList();
    } catch(e){
      console.warn("[Editor] read yaw failed:", e);
    }
  });

  // --- auto-save on TYPING into the North input ---
  northEl.addEventListener('input', () => {
    writeNorthForCurrentScene(northEl.value);
  });

  // --- SCENE-WIDE: input + clear (saves immediately on change) ---
  function updateSceneWideField(){
    const entry = ensureSceneEntry(currentSceneId);
    sceneWideEl.value = entry.sceneWideLabel || '';
  }

  sceneWideEl.addEventListener('change', () => {
    if(!currentSceneId) return;
    const entry = ensureSceneEntry(currentSceneId);
    const val = (sceneWideEl.value || '').trim();
    if (val) entry.sceneWideLabel = val; else delete entry.sceneWideLabel;
    saveLocal();
    markActiveSceneInList();
  });

  clearWideEl.addEventListener('click', () => {
    if(!currentSceneId) return;
    const entry = ensureSceneEntry(currentSceneId);
    delete entry.sceneWideLabel;
    sceneWideEl.value = '';
    saveLocal();
    markActiveSceneInList();
  });

  // Save / Add area label (keeps north + sceneWide as already saved)
  document.getElementById("saveLabel").addEventListener("click", () => {
    if(!currentSceneId) return;

    const name = (areaNameEl.value || "").trim();
    if(!name) return alert("Enter an area name");

    const yaw   = parseFloat(yawEl.value)   || 0;
    const pitch = parseFloat(pitchEl.value) || 0;

    const entry = ensureSceneEntry(currentSceneId);

    if(activeLabelIndex != null && entry.areas[activeLabelIndex]){
      entry.areas[activeLabelIndex] = { name, yaw, pitch };
    } else {
      entry.areas.push({ name, yaw, pitch });
      activeLabelIndex = entry.areas.length - 1;
    }
    saveLocal();
    refreshAreaList();
    renderEditorPins();
  });

  document.getElementById("deleteLabel").addEventListener("click", () => {
    const entry = ensureSceneEntry(currentSceneId);
    if(!entry || activeLabelIndex == null) return;
    entry.areas.splice(activeLabelIndex, 1);
    if(entry.areas.length === 0 && !entry.sceneWideLabel){
      labelsData.scenes = labelsData.scenes.filter(s => s.sceneId !== currentSceneId);
      activeLabelIndex = null;
    } else {
      activeLabelIndex = Math.min(activeLabelIndex, entry.areas.length - 1);
    }
    saveLocal();
    refreshAreaList();
    renderEditorPins();
  });

  async function loadLabels(){
    // Prefer localStorage copy if present
    try{
      const local = localStorage.getItem("map_labels");
      if (local) { labelsData = JSON.parse(local); return; }
    } catch(_){}

    // else load from file
    try{
      const res = await fetch("map_labels.json", { cache: "no-store" });
      labelsData = res.ok ? await res.json() : { scenes: [] };
    } catch { labelsData = { scenes: [] }; }
  }

  document.getElementById("saveJson").addEventListener("click", () => {
    // sync panel fields before exporting
    persistPanelSceneFields();

    const out = {
      scenes: labelsData.scenes.map(s => {
        const o = { sceneId: s.sceneId, north: s.north || 0, areas: s.areas || [] };
        if (s.sceneWideLabel) o.sceneWideLabel = s.sceneWideLabel;
        return o;
      })
    };
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "map_labels.json";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  document.getElementById("loadJson").addEventListener("click", async () => {
    const f = await pickFile(".json"); if(!f) return;
    labelsData = JSON.parse(await f.text());
    saveLocal();
    populateSceneList();
    if (currentSceneId) { refreshAreaList(); renderEditorPins(); updateSceneWideField(); }
    alert("Labels loaded");
  });

  document.getElementById("copyJson").addEventListener("click", async () => {
    // sync panel fields before copying
    persistPanelSceneFields();

    const out = {
      scenes: labelsData.scenes.map(s => {
        const o = { sceneId: s.sceneId, north: s.north || 0, areas: s.areas || [] };
        if (s.sceneWideLabel) o.sceneWideLabel = s.sceneWideLabel;
        return o;
      })
    };
    await navigator.clipboard.writeText(JSON.stringify(out, null, 2));
    alert("JSON copied to clipboard");
  });

  function pickFile(accept){
    return new Promise(r => {
      const i = document.createElement("input");
      i.type = "file"; i.accept = accept;
      i.onchange = e => r(e.target.files[0]);
      i.click();
    });
  }

  window.addEventListener("DOMContentLoaded", async () => {
    try {
      mustGetMarzipano();
      buildScenes();
      await loadLabels();
      populateSceneList();

      // Switch to first available scene
      const firstId = Object.keys(scenes)[0];
      if(firstId){ switchTo(firstId); }

      // Pano click to seed yaw/pitch
      panoEl.addEventListener("click", onPanoClick);
    } catch (e) {
      console.error(e);
      alert(e.message || e);
    }
  });
})();
