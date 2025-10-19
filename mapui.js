/* ===========================================================
   Interactive Map UI — Sprint 5
   =========================================================== */

let DEV_MODE     = false;      
let OPEN_ON_LOAD = true;


const STORAGE_KEY = 'mapPins';
const LIST_KEY    = 'mapListNames';

const SCENE_WAIT_MAX_MS = 4000;
const SCENE_WAIT_STEP   = 100;

const UNGROUPED_KEY   = 'Ungrouped';
const UNGROUPED_LABEL = 'Ungrouped';

let pins = [];
let scenesCache = null;
let listState = { groups:{}, scenes:{}, order:{ groups:[], items:{} } };

const el = {
  backdrop : document.getElementById('m4-backdrop'),
  toggle   : document.getElementById('m4-toggle'),
  close    : document.getElementById('m4-close'),

  scenes   : document.getElementById('m4-scenes'),
  search   : document.getElementById('m4-search'),

  mapwrap  : document.querySelector('.m4-mapwrap') || document.querySelector('.m4-map'),
  img      : document.getElementById('m4-img'),
  pinLayer : document.getElementById('m4-pinlayer'),

  foot       : document.getElementById('m4-foot'),
  addHotspot : document.getElementById('m4-add-hotspot') || document.getElementById('m4-add'),
  addInfo    : document.getElementById('m4-add-info'),
  reset      : document.getElementById('m4-reset'),

  
  editPanel : document.getElementById('m4-edit-panel'),
  editId    : document.getElementById('m4-edit-id'),
  editName  : document.getElementById('m4-edit-name'),
  editType  : document.getElementById('m4-edit-type'),
  saveEdit  : document.getElementById('m4-save-edit'),
  deletePin : document.getElementById('m4-delete-pin'),
  teleport  : document.getElementById('m4-teleport'),   

  
  infoPopup : document.getElementById('m4-info-popup'),
  infoView  : document.getElementById('m4-info-view'),
  infoText  : document.getElementById('m4-info-text'),
  infoClose : document.getElementById('m4-info-close'),
  infoDelete: document.getElementById('m4-info-delete'),

 
  copyBtn   : document.getElementById('m4-copy')
};
function byId(id){ return document.getElementById(id); }
function onClick(id, fn){
  const el = byId(id);
  if (el) el.addEventListener('click', fn);
}
const mapWrap = el.mapwrap || document.querySelector('.m4-mapwrap');
const root = document.querySelector('.m4-scenes');

let selectedPin = null;
let selectedGroupKey = null;

let dragData = null;  
let ghostEl  = null;
// Always read the latest pins from the DOM (so drags/edits are included)
function readPinsFromDOM(){
  const out = [];
  document.querySelectorAll('.m4-pin').forEach(p=>{
    // prefer dataset.x/y; fallback to computed style %
    const x = (p.dataset.x !== undefined)
      ? parseFloat(p.dataset.x)
      : parseFloat(String(p.style.left || '0').replace('%',''));
    const y = (p.dataset.y !== undefined)
      ? parseFloat(p.dataset.y)
      : parseFloat(String(p.style.top  || '0').replace('%',''));

    out.push({
      x, y,
      type:        p.dataset.type || 'info',
      sceneId:     p.dataset.sceneId || '',
      displayName: p.dataset.displayName || '',
      image:       p.dataset.image || undefined,
      imgSize:     p.dataset.imgSize || undefined
    });
  });
  return out;
}


document.getElementById('m4-copy')?.addEventListener('click', async () => {
  const pinsFresh = (typeof readPinsFromDOM === 'function') ? readPinsFromDOM() : (pins || []);
  const cfg = { list: (typeof listState !== 'undefined' ? listState : null), pins: pinsFresh };

  try {
    const text = JSON.stringify(cfg, null, 2);
    await navigator.clipboard.writeText(text);
    toast('Config copied to clipboard');
  } catch (e) {
    try {
      const ta = document.createElement('textarea');
      ta.value = JSON.stringify(cfg, null, 2);
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      toast('Copied via fallback', false);
    } catch (err) {
      console.error('[MapUI] Copy failed', err);
      toast('Copy failed', false);
    }
  }
});
function highlightActiveRow(sceneId) {
  const container = el && el.scenes ? el.scenes : document.querySelector('.m4-scenes');
  if (!container) return;

  container.querySelectorAll('a.scene').forEach(a => a.classList.remove('active'));
  const row = container.querySelector(`a.scene[data-id="${CSS.escape(sceneId)}"]`);
  if (row) row.classList.add('active');
}

function highlightActivePin(sceneId) {
  document.querySelectorAll('.m4-pin').forEach(p => {
    if (p.dataset.sceneId === sceneId) {
      p.dataset.active = '1';
      p.classList.add('m4-pulse');
      p.classList.remove('m4-pulse'); 
      void p.offsetWidth; 
      p.classList.add('m4-pulse');
    } else {
      p.dataset.active = '0';
      p.classList.remove('m4-pulse');
    }
  });
}

function pinDisplayName(pin){ return pin?.dataset.displayName?.trim() || pin?.dataset.sceneId || ''; }
function applyPinTitleTooltip(pin){
  // Native tooltip; shows on hover
  pin.title = pinDisplayName(pin);
}

const notEmpty = a => Array.isArray(a) && a.length>0;
const clone = o => JSON.parse(JSON.stringify(o));

function hideNativeSceneList(){
  const native = document.getElementById('sceneList');
  if (native) native.style.display = 'none';
}

function safeSwitchToScene(id) {
  try {
    window.resetMapFocus();
    if (typeof window.switchToScene === 'function') {
      window.switchToScene(id);
      return true;
    }
    if (window.sceneById && window.sceneById[id] && typeof window.sceneById[id].switchTo === 'function') {
      window.sceneById[id].switchTo({ transitionDuration: 800 });
      return true;
    }
    if (typeof window.findSceneById === 'function' && typeof window.switchScene === 'function') {
      const scnObj = window.findSceneById(id);
      if (scnObj) { window.switchScene(scnObj); return true; }
    }
  } catch (e) {
    console.warn('[MapUI] switch error', e);
  }
  console.warn('[MapUI] No way to switch scene for id:', id);
  return false;
}


async function loadConfigFromUrl(url) {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const json = await r.json();
    if (!json || typeof json !== 'object' || !('pins' in json) || !('list' in json)) {
      throw new Error('Invalid config format (need { pins, list })');
    }

    listState = json.list || { groups:{}, scenes:{}, order:{ groups:[], items:{} } };
    pins = json.pins || [];
    saveLocalFromState();
    console.log('[MapUI] Loaded config from', url);
  } catch (e) {
    console.warn('[MapUI] Could not load config from URL:', url, e);
  }
}
// --- Flat scenes list (no groups) -------------------------------------------
function renderScenesListFlat(listCfg){
  if (!el.scenes) return;

  const container = el.scenes;
  container.innerHTML = '';

  // Small helper to create a row
  const addRow = (id, label) => {
    if (!id) return;
    const a = document.createElement('a');
    a.className = 'scene';
    a.dataset.id = id;
    a.href = '#';
    // Prefer label from list.scenes; fall back to id
    a.textContent = (label ?? (listCfg?.scenes?.[id])) || id;

    // Click -> focus/teleport like before
    a.addEventListener('click', (e) => {
      e.preventDefault();
      // Highlight the row
      if (typeof highlightActiveRow === 'function') highlightActiveRow(id);
      if (typeof highlightActivePin === 'function') highlightActivePin(id);

      // If there's a visible hotspot pin, focus the map on it,
      // otherwise fall back to scene switch (keeps prior behavior robust)
      const pin = (typeof findPinByScene === 'function') ? findPinByScene(id) : null;
      if (pin && typeof focusHotspot === 'function') {
        // If you want to reset then focus, call your resetThenFocus if you have it
        // resetThenFocus ? resetThenFocus(id) : focusHotspot(id);
        focusHotspot(id);
      } else if (typeof safeSwitchToScene === 'function') {
        const ok = safeSwitchToScene(id);
        if (ok && typeof closeMenu === 'function') closeMenu();
      }
    });

    container.appendChild(a);
  };

  // We honor the order in list.order.groups + list.order.items,
  // but render rows directly (no headers).
  const seen = new Set();
  const groups = listCfg?.order?.groups || [];
  const items  = listCfg?.order?.items  || {};

  groups.forEach((key) => {
    const ids = items[key] || [];
    ids.forEach((id) => {
      if (!seen.has(id)) {
        addRow(id, listCfg?.scenes?.[id]);
        seen.add(id);
      }
    });
  });

  // Append any scenes not explicitly ordered so nothing is lost
  Object.keys(listCfg?.scenes || {}).forEach((id) => {
    if (!seen.has(id)) addRow(id, listCfg.scenes[id]);
  });

  // --- Search wiring (keeps your existing search UX) ---
  const q = el.search?.value?.trim().toLowerCase() || '';
  if (q) filterScenesList(q);

  // (Re)wire the input if not already
  if (el.search && !el.search.__m4FlatBound) {
    el.search.addEventListener('input', () => {
      filterScenesList(el.search.value.trim().toLowerCase());
    });
    el.search.__m4FlatBound = true;
  }

  function filterScenesList(query){
    const rows = container.querySelectorAll('a.scene');
    rows.forEach(row => {
      const txt = row.textContent.toLowerCase();
      row.style.display = query ? (txt.includes(query) ? '' : 'none') : '';
    });
  }
}

function collectScenesNow() {
  if (window.APP_DATA && notEmpty(APP_DATA.scenes)) {
    return APP_DATA.scenes.map(s => ({ id:s.id, name:s.name || s.id }));
  }
  if (notEmpty(window.scenes)) {
    return window.scenes.map(s => ({
      id:   (s.data && s.data.id)   || s.id,
      name: (s.data && s.data.name) || s.name || ((s.data && s.data.id) || s.id)
    })).filter(s=>!!s.id);
  }
  const anchors = Array.from(document.querySelectorAll('#sceneList a.scene'));
  if (anchors.length) {
    return anchors.map(a => ({
      id: a.dataset.id || '',
      name: (a.querySelector('li.text')?.textContent || a.dataset.id || '').trim()
    })).filter(s => s.id);
  }
  return [];
}
function collectScenesWithWait(){
  return new Promise(resolve=>{
    const t0 = performance.now();
    (function poll(){
      const s = collectScenesNow();
      if (notEmpty(s) || performance.now()-t0>SCENE_WAIT_MAX_MS) resolve(s);
      else setTimeout(poll, SCENE_WAIT_STEP);
    })();
  });
}





function openMenu() {
  el.backdrop?.setAttribute('aria-hidden', 'false');
  // Wait until after CSS/display updates
  setTimeout(() => {
    if (window.Z) {
      window.Z.scale = 1;
      window.Z.tx = 0;
      window.Z.ty = 0;
    }
    const stage = document.querySelector('.m4-zoomstage');
    const pinLayer = document.getElementById('m4-pinlayer');
    if (stage) stage.style.transform = 'translate(0, 0) scale(1)';
    if (pinLayer) pinLayer.style.transform = 'translate(0, 0)';
    if (typeof window.syncPinLayerToImage === 'function')
      window.syncPinLayerToImage();
  }, 200);
}

function closeMenu() {
  el.backdrop?.setAttribute('aria-hidden', 'true');
  window.resetMapFocus();
}

el.toggle?.addEventListener('click',openMenu);
el.close?.addEventListener('click', closeMenu);
el.backdrop?.addEventListener('click', (e)=>{ if (e.target === el.backdrop) closeMenu(); });


// Keeps the absolute overlay (pin layer) perfectly aligned to the map image.
// Safe to call often; it just reads layout and sets size/position.
function syncPinLayerToImage() {
  if (!el || !el.img || !el.pinLayer) return;

  const img   = el.img;
  const layer = el.pinLayer;

  // Parent that contains BOTH the image and the pin layer
  const parent = layer.parentElement || img.parentElement;
  if (!parent) return;

  const ir = img.getBoundingClientRect();
  const pr = parent.getBoundingClientRect();

  // Position the layer exactly over the image
  const dx = Math.round(ir.left - pr.left);
  const dy = Math.round(ir.top  - pr.top);

  // Ensure the layer sits on top of the image
  parent.style.position = parent.style.position || 'relative';
  layer.style.position  = 'absolute';
  layer.style.pointerEvents = 'none';

  layer.style.transform = 'translate(0, 0)';
  layer.style.left = dx + 'px';
  layer.style.top  = dy + 'px';

  layer.style.width  = Math.round(ir.width)  + 'px';
  layer.style.height = Math.round(ir.height) + 'px';

  // Pins are already stored as %; ensure they keep % positioning
  // (No recalculation needed—just make sure left/top are %)
  layer.querySelectorAll('.m4-pin').forEach(p => {
    if (p.style.left.indexOf('%') === -1 && p.dataset.x) p.style.left = `${p.dataset.x}%`;
    if (p.style.top.indexOf('%')  === -1 && p.dataset.y) p.style.top  = `${p.dataset.y}%`;
  });
}

el.img?.addEventListener('load', syncPinLayerToImage);
window.addEventListener('resize', syncPinLayerToImage);


function groupScenesDefault(arr){
  const g={};
  arr.forEach(sc=>{
    const raw = sc.name||'';
    const key = (raw.includes('-') ? raw.split('-')[0] : raw).trim() || 'Other';
    (g[key]??=[]).push(sc);
  });
  return g;
}
function ensureOrder(defaultGrouped){
  if (!listState.order.groups.length){
    listState.order.groups = Object.keys(defaultGrouped);
    listState.order.items = {};
    for (const [g, list] of Object.entries(defaultGrouped)){
      listState.order.items[g] = list.map(s=>s.id);
    }
  }
  if (!listState.order.items[UNGROUPED_KEY]) listState.order.items[UNGROUPED_KEY] = [];
  if (!listState.order.groups.includes(UNGROUPED_KEY)){
    listState.order.groups.push(UNGROUPED_KEY);
    listState.groups[UNGROUPED_KEY] = listState.groups[UNGROUPED_KEY] || UNGROUPED_LABEL;
  }
}
// --- Toast (quick visual feedback) ---
function m4Toast(msg){
  const t = document.createElement('div');
  t.className = 'm4-toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(()=> t.remove(), 1500);
}

// --- Read all pins from the DOM into plain objects (percent units) ---
function readPinsFromDOM(){
  const out = [];
  document.querySelectorAll('.m4-pin').forEach(p=>{
    // prefer dataset.x/y; fallback to style left/top
    const x = (p.dataset.x !== undefined) ? parseFloat(p.dataset.x)
             : parseFloat(String(p.style.left || '0').replace('%',''));
    const y = (p.dataset.y !== undefined) ? parseFloat(p.dataset.y)
             : parseFloat(String(p.style.top  || '0').replace('%',''));
    out.push({
      x, y,
      type:        p.dataset.type || 'info',
      sceneId:     p.dataset.sceneId || '',
      displayName: p.dataset.displayName || '',
      image:       p.dataset.image || undefined,
      imgSize:     p.dataset.imgSize || undefined
    });
  });
  return out;
}

// --- Update the in-memory `pins` array from DOM and save ---
function savePinsFromDOM(){
  if (typeof window.pins !== 'undefined') {
    window.pins = readPinsFromDOM();
  }
  if (typeof saveLocal === 'function') saveLocal();
}


function exportPins(){
  const out = [];
  document.querySelectorAll('.m4-pin').forEach(p=>{
    out.push({
      x: parseFloat(p.dataset.x ?? parseFloat(p.style.left)),
      y: parseFloat(p.dataset.y ?? parseFloat(p.style.top)),
      type: p.dataset.type,
      sceneId: p.dataset.sceneId,
      displayName: p.dataset.displayName,
      image: p.dataset.image || undefined
    });
  });
  return out;
}
function loadLocal(){
  try{
    const pinsRaw = localStorage.getItem(STORAGE_KEY);
    const listRaw = localStorage.getItem(LIST_KEY);
    return {
      pins: pinsRaw ? JSON.parse(pinsRaw) : null,
      list: listRaw ? JSON.parse(listRaw) : null
    };
  }catch{ return {pins:null, list:null}; }
}
function saveLocal() {
  try {
    // --- Clone current pins to avoid mutating live array ---
    const pinsClean = pins.map(p => {
      const copy = { ...p };

      // Normalize coordinates if the map is zoomed or panned
      if (window.Z) {
        const scale = window.Z.scale || 1;
        const tx = window.Z.tx || 0;
        const ty = window.Z.ty || 0;

        if (scale !== 1 || tx !== 0 || ty !== 0) {
          const imgW = el.img?.offsetWidth || 1000;
          const imgH = el.img?.offsetHeight || 1000;

          // Remove translation and scale offset (convert back to base percentages)
          copy.x = ((p.x / 100) - (tx / imgW)) * (100 / scale);
          copy.y = ((p.y / 100) - (ty / imgH)) * (100 / scale);
        }
      }

      // Round values slightly for cleaner saves
      copy.x = Math.round(copy.x * 1000) / 1000;
      copy.y = Math.round(copy.y * 1000) / 1000;
      return copy;
    });

    // --- Save normalized map state ---
    const cfg = { list: listState, pins: pinsClean };
    localStorage.setItem('map_config_combined', JSON.stringify(cfg, null, 2));
  } catch (e) {
    console.error('saveLocal failed:', e);
  }
}


function saveLocalFromState() {
  try {
    const cfg = { list: listState || { groups:{}, scenes:{}, order:{groups:[],items:{}} }, pins: pins || [] };
    localStorage.setItem('map_config_combined', JSON.stringify(cfg, null, 2));
  } catch (e) {
    console.error('saveLocalFromState failed:', e);
  }
}


function removeGhost(){
  if (ghostEl && ghostEl.parentNode) ghostEl.parentNode.removeChild(ghostEl);
  ghostEl=null;
}
function makeGhost(){
  const g = document.createElement('div');
  g.className = 'm4-drag-ghost';
  return g;
}
function insertGhostBefore(target){
  if (!ghostEl) ghostEl = makeGhost();
  target?.parentNode?.insertBefore(ghostEl, target);
}
function appendGhostTo(container){
  if (!ghostEl) ghostEl = makeGhost();
  container?.appendChild(ghostEl);
}
function getAfterElement(container, y, selector) {
  const els = [...container.querySelectorAll(selector + ':not(.m4-dragging)')];
  return els.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      return { offset, element: child };
    } else {
      return closest;
    }
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}


function localSceneById(id){ return scenesCache.find(s=>s.id===id) || {id, name:id}; }


function inlineEdit(elm, initial, onSave){
  if (!DEV_MODE) return;
  elm.setAttribute('contenteditable','true');
  elm.focus();
  const sel=window.getSelection(), r=document.createRange();
  r.selectNodeContents(elm); sel.removeAllRanges(); sel.addRange(r);
  const commit=()=>{ elm.removeAttribute('contenteditable'); const v=elm.textContent.trim(); if (v!==initial) onSave(v); };
  const onKey=e=>{ if(e.key==='Enter'){e.preventDefault();commit();} if(e.key==='Escape'){e.preventDefault();elm.textContent=initial;elm.blur();} };
  elm.addEventListener('blur',commit,{once:true}); elm.addEventListener('keydown',onKey);
}


function buildSceneList() {
  const root = el && el.scenes ? el.scenes : document.querySelector('.m4-scenes');
  if (!root) {
    console.warn('[buildSceneList] root scene container not found');
    return;
  }

  root.innerHTML = '';
  removeGhost();

  // ===========================================================
  // DEV MODE SHORTCUT — show all scenes from data.js
  // ===========================================================
  if (DEV_MODE) {
    console.log('[MapUI] DEV_MODE active — showing all scenes from data.js');
    if (!scenesCache?.length) {
      console.warn('[MapUI] No scenesCache available');
      return;
    }

    const frag = document.createDocumentFragment();
    scenesCache.forEach(meta => {
      const a = document.createElement('a');
      a.href = 'javascript:void(0)';
      a.className = 'scene';
      a.dataset.id = meta.id;

      const li = document.createElement('li');
      li.className = 'text';
      li.textContent = meta.name || meta.id;
      a.appendChild(li);

      // Click → focus scene & highlight
      a.addEventListener('click', () => {
        if (typeof window.focusHotspot === 'function') {
          window.focusHotspot(meta.id, { zoom: 2, animate: true });
        }
        highlightActiveRow(meta.id);
        highlightActivePin(meta.id);
      });

      // Double-click → inline edit for dev
      a.addEventListener('dblclick', ev => {
        ev.stopPropagation();
        inlineEdit(li, li.textContent, newName => {
          listState.scenes[meta.id] = newName;
          saveLocal();
        });

        const p = findPinByScene(meta.id) || createPin(50, 50, 'hotspot', meta.id, li.textContent, true);
        selectedPin = p;

        if (el.editPanel) {
          if (typeof showInfoPopup === 'function') showInfoPopup(selectedPin || pin);
          el.editId.value = p.dataset.sceneId;
          el.editName.value = p.dataset.displayName;
          el.editType.value = p.dataset.type;
          el.saveEdit.onclick = () => {
            p.dataset.sceneId = el.editId.value.trim();
            p.dataset.displayName = el.editName.value;
            p.dataset.type = el.editType.value;
            saveLocal();
          };
          el.deletePin.onclick = () => { p.remove(); saveLocal(); el.editPanel.style.display = 'none'; };
        }
      });

      frag.appendChild(a);
    });

    root.appendChild(frag);
    return; // stop here in dev mode
  }

  // ===========================================================
  // NON-DEV MODE — use JSON file groups
  // ===========================================================
  const definedGroups = listState?.order?.groups || [];
  const definedItems = listState?.order?.items || {};

  const cleanGroups = {};
  for (const gKey of definedGroups) {
    if (!definedItems[gKey]) continue;
    cleanGroups[gKey] = definedItems[gKey].filter(id => !!localSceneById(id));
  }

  // Ensure at least one default group (Visible)
  if (!cleanGroups["Visible"]) cleanGroups["Visible"] = [];

  const labelGroup = g => listState.groups[g] || g;
  const labelScene = (id, fallback) => listState.scenes[id] || fallback || id;

  // ===========================================================
  // Scene Row Builder (click/edit/drag per scene)
  // ===========================================================
  const makeSceneRow = (groupKey, sceneId) => {
    const meta = localSceneById(sceneId);
    if (!meta) return null;

    const a = document.createElement('a');
    a.href = 'javascript:void(0)';
    a.className = 'scene';
    a.dataset.id = meta.id;

    const li = document.createElement('li');
    li.className = 'text';
    const label = (listState?.scenes?.[meta.id]) || meta.name || labelScene(meta.id, meta.name);
    li.textContent = label;
    a.appendChild(li);

    // --- Click behaviour
    a.addEventListener('click', () => {
      if (!DEV_MODE) {
        if (typeof window.focusHotspot === 'function') {
          window.focusHotspot(meta.id, { zoom: 2, animate: true });
        }
        highlightActiveRow(meta.id);
        highlightActivePin(meta.id);
        selectedPin = findPinByScene(meta.id);
        selectedGroupKey = null;
      } else {
        selectedPin = null; selectedGroupKey = null;
        if (el.editPanel) {
          el.editPanel.style.display = 'flex';
          el.editId.value = meta.id;
          el.editName.value = li.textContent;
          el.editType.value = 'hotspot';
          el.saveEdit.onclick = () => {
            const newName = el.editName.value.trim();
            if (newName) {
              li.textContent = newName;
              listState.scenes[meta.id] = newName;
              saveLocal();
            }
          };
          el.deletePin.onclick = null;
        }
      }
    });

    // --- DEV: inline edit + drag
    if (DEV_MODE) {
      a.addEventListener('dblclick', ev => {
        ev.stopPropagation();
        inlineEdit(li, li.textContent, newName => {
          listState.scenes[meta.id] = newName;
          saveLocal();
        });

        const p = findPinByScene(meta.id) || createPin(50, 50, 'hotspot', meta.id, li.textContent, true);
        selectedPin = p;

        if (el.editPanel) {
          el.editPanel.style.display = 'flex';
          el.editId.value = p.dataset.sceneId;
          el.editName.value = p.dataset.displayName;
          el.editType.value = p.dataset.type;
          el.saveEdit.onclick = () => {
            p.dataset.sceneId = el.editId.value.trim();
            p.dataset.displayName = el.editName.value;
            p.dataset.type = el.editType.value;
            saveLocal();
          };
          el.deletePin.onclick = () => { p.remove(); saveLocal(); el.editPanel.style.display = 'none'; };
        }
      });

      a.draggable = true;
      a.addEventListener('dragstart', e => {
        dragData = {
          type: 'scene',
          sceneId: meta.id,
          fromGroup: groupKey,
          fromIndex: (listState.order.items[groupKey] || []).indexOf(meta.id)
        };
        a.classList.add('m4-dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      a.addEventListener('dragend', () => {
        a.classList.remove('m4-dragging');
        dragData = null;
        removeGhost();
      });
    }

    return a;
  };

  // ===========================================================
  // Group Header Builder
  // ===========================================================
  const makeGroupHeader = (groupKey) => {
    const header = document.createElement('div');
    header.className = 'group';
    header.setAttribute('aria-expanded', 'false');

    header.innerHTML = `
      <button type="button" class="m4-gbtn" aria-expanded="false">
        <span class="m4-arrow" aria-hidden="true">▸</span>
        <span class="m4-glabel">${labelGroup(groupKey)}</span>
      </button>
      ${DEV_MODE ? '<span class="m4-grip" title="Drag group" aria-hidden="true">⋮⋮</span>' : ''}
    `;

    const btn = header.querySelector('.m4-gbtn');
    const grip = header.querySelector('.m4-grip');

    const bindToggle = (ulEl) => {
      const setExpanded = (exp) => {
        header.setAttribute('aria-expanded', String(exp));
        btn.setAttribute('aria-expanded', String(exp));
        if (ulEl) ulEl.style.display = exp ? 'block' : 'none';
      };
      setExpanded(false);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const exp = header.getAttribute('aria-expanded') === 'true';
        setExpanded(!exp);
      });
    };

    if (DEV_MODE) {
      header.addEventListener('click', (ev) => {
        if (ev.target.closest('.m4-gbtn')) return;
        selectedGroupKey = groupKey; selectedPin = null;
        if (el.editPanel) {
          el.editPanel.style.display = 'flex';
          el.editId.value = groupKey;
          el.editName.value = labelGroup(groupKey);
          el.editType.value = 'group';
          el.saveEdit.onclick = () => {
            const newName = el.editName.value.trim();
            if (!newName) return;
            listState.groups[groupKey] = newName;
            saveLocal();
            header.querySelector('.m4-glabel').textContent = newName;
          };
          el.deletePin.onclick = () => {
            listState.order.items[UNGROUPED_KEY] = listState.order.items[UNGROUPED_KEY] || [];
            listState.order.items[UNGROUPED_KEY].push(...(listState.order.items[groupKey] || []));
            delete listState.order.items[groupKey];
            const gi = listState.order.groups.indexOf(groupKey);
            if (gi > -1) listState.order.groups.splice(gi, 1);
            delete listState.groups[groupKey];
            saveLocal();
            buildSceneList();
          };
        }
      });

      if (grip) {
        grip.draggable = true;
        grip.addEventListener('dragstart', (e) => {
          dragData = { type: 'group', groupKey, fromIndex: listState.order.groups.indexOf(groupKey) };
          header.classList.add('m4-dragging');
          e.dataTransfer.effectAllowed = 'move';
        });
        grip.addEventListener('dragend', () => {
          header.classList.remove('m4-dragging');
          dragData = null;
          removeGhost();
        });
      }
    }

    return { header, bindToggle };
  };

  // ===========================================================
  // Assemble DOM
  // ===========================================================
  const rootFrag = document.createDocumentFragment();

  for (const gKey of Object.keys(cleanGroups)) {
    const ids = cleanGroups[gKey];
    if (!ids.length) continue;

    if (gKey === 'Visible') {
      ids.forEach(id => {
        const row = makeSceneRow(gKey, id);
        if (row) rootFrag.appendChild(row);
      });
    } else {
      const wrap = document.createElement('li');
      wrap.className = 'group-li';
      const { header, bindToggle } = makeGroupHeader(gKey);
      const ul = document.createElement('ul');
      ul.className = 'children';
      ids.forEach(id => {
        const row = makeSceneRow(gKey, id);
        if (row) ul.appendChild(row);
      });
      wrap.appendChild(header);
      wrap.appendChild(ul);
      rootFrag.appendChild(wrap);
      bindToggle(ul);
    }
  }

  root.appendChild(rootFrag);

  // ===========================================================
  // Expand/collapse sync
  // ===========================================================
  requestAnimationFrame(() => {
    if (!root) return;
    root.querySelectorAll('.group-li').forEach(li => {
      const header = li.querySelector('.group');
      const ul = li.querySelector('.children');
      if (!header || !ul) return;

      ul.style.display = (header.getAttribute('aria-expanded') === 'true') ? 'block' : 'none';
      header.addEventListener('click', () => {
        const exp = header.getAttribute('aria-expanded') === 'true';
        ul.style.display = exp ? 'none' : 'block';
      });
    });
  });
}




/* pins */
function applyPinTitleTooltip(pin){
  try {
    let tip = '';
    if (pin?.dataset?.type === 'hotspot') {
      // Hotspots: label first, then fallbacks
      tip = pin.dataset.displayName || pin.dataset.sceneId || '';
    } else if (pin?.dataset?.type === 'info') {
      // Info pins: title first (sceneId), then fallbacks
      tip = pin.dataset.sceneId || pin.dataset.displayName || '';
    } else {
      tip = pin.dataset.displayName || pin.dataset.sceneId || '';
    }

    pin.title = tip;                  // native tooltip
    pin.dataset.tooltip = tip;        // if your custom tooltip reads this

    // If you have a custom tooltip initializer, let it run too
    if (typeof window._applyPinTitleTooltip === 'function') {
      window._applyPinTitleTooltip(pin, tip);
    }
  } catch (e) {
    // no-op, keep things robust
  }
}
function loadPins(arr) {
  if (!arr) return;
  el.pinLayer.innerHTML = '';
  pins = [];

  arr.forEach(p => {
    // accept both % strings and numbers
    const x = typeof p.x === 'string' ? parseFloat(p.x) : p.x;
    const y = typeof p.y === 'string' ? parseFloat(p.y) : p.y;

    const pin = createPin(x, y, p.type, p.sceneId, p.displayName, p.image, false, p.tour);
});
}
// Wire the DEV footer (bottom bar) to edit a given pin
function wireDevFooterForPin(pin){
  if (!el.editPanel) return;

  el.editPanel.style.display = 'flex';
  el.editId.value            = pin.dataset.sceneId || '';
  el.editName.value          = pin.dataset.displayName || '';
  el.editType.value          = pin.dataset.type || 'hotspot';

  // Save button: persist changes into the pin & local storage
  el.saveEdit.onclick = () => {
    pin.dataset.sceneId     = (el.editId.value || '').trim();
    pin.dataset.displayName = el.editName.value || '';
    pin.dataset.type        = el.editType.value || 'hotspot';
    applyPinTitleTooltip(pin);
    saveLocal();
  };

  // Delete button
  el.deletePin.onclick = () => {
    pin.remove();
    saveLocal();
    el.editPanel.style.display = 'none';
  };

  // Teleport button (for hotspots)
  if (el.teleport){
    el.teleport.onclick = () => {
      const targetId = (el.editId.value || '').trim();
      if (!targetId) return;
      const ok = safeSwitchToScene(targetId);
      if (ok){
        highlightActivePin(targetId);
        highlightActiveRow(targetId);
        closeMenu();
      }
    };
  }
}
function findPinByScene(id) {
  return Array.from(document.querySelectorAll('.m4-pin'))
    .find(p => p.dataset.type === 'hotspot' && p.dataset.sceneId === id) || null;
}

/**
Create Pin Logic
 */
function createPin(xPct, yPct, type, sceneId, displayName, imageOrSave, maybeSave,tour){
  let imageFile, saveNow = false;
  if (typeof imageOrSave === 'boolean') {
    saveNow = imageOrSave;
  } else if (typeof imageOrSave === 'string' && imageOrSave.trim()){
    imageFile = imageOrSave.trim();
    saveNow   = !!maybeSave;
  } else if (typeof maybeSave === 'boolean') {
    saveNow = maybeSave;
  }

  const pin = document.createElement('div');
  pin.className = 'm4-pin';
  pin.dataset.type        = type;
  pin.dataset.sceneId     = sceneId || '';
  pin.dataset.displayName = displayName || '';
  if (imageFile) pin.dataset.image = imageFile;
  if (tour) pin.dataset.tour = tour;

  // position (percent so it scales with the image)
  pin.style.left = xPct + '%';
  pin.style.top  = yPct + '%';
  pin.dataset.x  = String(xPct);
  pin.dataset.y  = String(yPct);

  // hover title
  applyPinTitleTooltip(pin);

  // === EVENTS ===
  // Single click
// === EVENTS ===
pin.addEventListener('click', (e) => {
  e.stopPropagation();
  selectedGroupKey = null;

  if (!DEV_MODE){
    // --- Normal user mode ---
    if (pin.dataset.type === 'hotspot'){
      // Teleport immediately for end users
      const ok = safeSwitchToScene(pin.dataset.sceneId);
      if (ok){ highlightActivePin(pin.dataset.sceneId); highlightActiveRow(pin.dataset.sceneId); closeMenu(); }
    } else {
      // Info pin popup
      showInfoPopup(pin);
    }
    return;
  }

  // --- DEV MODE ---
  // Single-click only selects pin for editing (no teleport!)
  selectedPin = pin;
  if (el.editPanel){
    el.editPanel.style.display = 'flex';
    el.editId.value   = pin.dataset.sceneId || '';
    el.editName.value = pin.dataset.displayName || '';
    el.editType.value = pin.dataset.type || '';
    // if you have image input: el.editImage.value = pin.dataset.image || '';
  }

  // highlight but DO NOT teleport
  highlightActivePin(pin.dataset.sceneId);
  highlightActiveRow(pin.dataset.sceneId);
});

// --- DEV MODE DOUBLE CLICK ---
if (DEV_MODE){
  pin.addEventListener('dblclick', (ev) => {
    ev.stopPropagation();

    if (pin.dataset.type === 'hotspot'){
      // Now double-click performs teleport
      const targetId = (pin.dataset.sceneId || '').trim();
      if (!targetId) return;
      const ok = safeSwitchToScene(targetId);
      if (ok){ highlightActivePin(targetId); highlightActiveRow(targetId); closeMenu(); }
    } else if (pin.dataset.type === 'info') {
      // Double-click opens info popup for editing
      showInfoPopup(pin);
    }
  });
}

  // DEV_MODE drag to reposition
  if (DEV_MODE){
    let dragging = false;
    const onDown = (ev) => {
      if (ev.detail > 1) return; // ignore if part of dblclick
      dragging = true;
      ev.preventDefault();
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp, { once:true });
    };
    const onMove = (ev) => {
      if (!dragging) return;
      const r  = el.pinLayer.getBoundingClientRect();
      const nx = ((ev.clientX - r.left)/r.width ) * 100;
      const ny = ((ev.clientY - r.top )/r.height) * 100;
      const clx = Math.max(0, Math.min(100, nx));
      const cly = Math.max(0, Math.min(100, ny));
      pin.style.left = clx + '%';
      pin.style.top  = cly + '%';
      pin.dataset.x  = String(clx);
      pin.dataset.y  = String(cly);
    };
    const onUp = () => {
      dragging = false;
      window.removeEventListener('pointermove', onMove);
      savePinsFromDOM();
      m4Toast('💾 Pin position saved');
    };
    pin.addEventListener('pointerdown', onDown);
  }

// Mount pin on layer
el.pinLayer.appendChild(pin);

// Normalize coordinates before saving (remove any active transform)
const neutral = { x: xPct, y: yPct };
if (window.Z) {
  const scale = window.Z.scale || 1;
  const tx = window.Z.tx || 0;
  const ty = window.Z.ty || 0;

  neutral.x = (xPct - (tx / el.img.offsetWidth) * 100 / scale);
  neutral.y = (yPct - (ty / el.img.offsetHeight) * 100 / scale);
}

// Push only neutralized coordinates
pins.push({
  x: neutral.x,
  y: neutral.y,
  type,
  sceneId,
  displayName,
  image: imageFile || undefined
});

if (saveNow) saveLocal();

return pin;

}

// -----------------------------------------------------
// Info Popup + Tour Button Fix
// -----------------------------------------------------
function showInfoPopup(pin) {
  window.currentPin = pin;
  console.log('[showInfoPopup] Active pin set:', pin.dataset?.sceneId, pin.dataset?.tour);

  const popup   = document.getElementById('m4-info-popup');
  const titleH  = document.getElementById('m4-info-title');
  const fig     = document.getElementById('m4-info-preview');
  const img     = document.getElementById('m4-info-img');
  const cap     = document.getElementById('m4-info-caption');
  if (!popup || !fig || !img || !cap) return;

  const isDev = !!window.DEV_MODE;

  // Read pin data
  const title = (pin.dataset.sceneId || '').trim();
  const text  = (pin.dataset.displayName || '').trim();
  const file  = (pin.dataset.image || '').trim();
  const saved = parseInt(pin.dataset.imgSize || '100', 10);
  const pct   = Number.isFinite(saved) ? saved : 100;

  // Heading + caption
  titleH.textContent = title || 'Info';
  cap.innerHTML = '';
  if (title) {
    const s = document.createElement('strong');
    s.textContent = title;
    cap.appendChild(s);
  }
  if (text) {
    const d = document.createElement('div');
    d.style.marginTop = title ? '6px' : '0';
    d.textContent = text;
    cap.appendChild(d);
  }

  // Image setup
  img.style.display = 'block';
  img.style.maxWidth = '50%';
  img.style.maxHeight = '62vh';
  if (file) {
    img.src = `assets/hotspot/${file}`;
    img.alt = title || 'Info image';
    img.style.width = pct + '%';
    fig.hidden = false;
  } else {
    img.removeAttribute('src');
    fig.hidden = !(title || text);
  }

  // Open popup
  popup.classList.add('m4-open');
  popup.style.display = 'flex';
  const closeTop = document.getElementById('m4-info-close');
  if (closeTop) {
    closeTop.onclick = () => {
      popup.classList.remove('m4-open');
      popup.style.display = 'none';
    };
  }

  // Refresh tour button
  if (!window.DEV_MODE) {
    updateInfoPreview(title, text, file, pct);
  }
}

// -----------------------------------------------------
// Update Info Preview + Tour Button Handling
// -----------------------------------------------------
function updateInfoPreview(title, text, imageFile, sizePct) {
  const box = document.getElementById('m4-info-preview');
  const img = document.getElementById('m4-info-img');
  const cap = document.getElementById('m4-info-caption');
  const tourBox = document.getElementById('m4-tour-btn-container');
  const autoBtn = document.getElementById('m4-btn-auto');
  if (!box || !img || !cap || !tourBox) return;

  // Caption + image update
  cap.innerHTML = '';
  if (title) {
    const strong = document.createElement('strong');
    strong.textContent = title.trim();
    cap.appendChild(strong);
  }
  if (text) {
    const div = document.createElement('div');
    div.style.marginTop = cap.childNodes.length ? '6px' : '0';
    div.textContent = text.trim();
    cap.appendChild(div);
  }

  if (imageFile) {
    const pct = Number.isFinite(+sizePct) ? +sizePct : 100;
    img.onload = () => (img.style.width = pct + '%');
    img.src = `assets/hotspot/${imageFile.trim()}`;
    img.alt = title || 'Info image';
    img.style.width = pct + '%';
    box.hidden = false;
  } else {
    img.removeAttribute('src');
    box.hidden = cap.childNodes.length === 0;
  }

  // ------------------ TOUR BUTTON ------------------
  const activePin = window.currentPin || null;
  const tourPath = activePin?.dataset?.tour?.trim();

  // Reset default hidden state
  tourBox.classList.remove('visible');
  tourBox.style.display = 'none';
  tourBox.style.visibility = 'hidden';
  tourBox.style.opacity = '0';

  if (tourPath && tourPath.endsWith('.json')) {
    console.log('[TourButton] Showing tour:', tourPath);

    // Wait for popup paint, then show
    setTimeout(() => {
      tourBox.style.display = 'flex';
      tourBox.style.visibility = 'visible';
      tourBox.style.opacity = '1';
      tourBox.classList.add('visible');

      if (autoBtn) {
        autoBtn.onclick = () => {
          console.log('[TourButton] Starting tour:', tourPath);
          const popup = document.getElementById('m4-info-popup');
          popup?.classList.remove('m4-open');
          popup?.style.setProperty('display', 'none');
          document.getElementById('m4-close')?.click();

          if (typeof window.startTourFromPopup === 'function') {
            window.startTourFromPopup(tourPath);
            window.dispatchEvent(new Event('tour:end'));
          } else if (typeof window.startTour === 'function') {
            window.startTour(tourPath);
            window.dispatchEvent(new Event('tour:end'));
          } else {
            console.warn('[TourButton] No tour start function found');
          }
        };
      }
    }, 400);
  } else {
    console.log('[TourButton] Hidden — no linked tour');
  }
}




function renderInfoImages(pin){
  const wrap = document.getElementById('m4-info-images');
  if (!wrap) return;
  wrap.innerHTML = '';

  const files = (pin.dataset.image || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  if (!files.length) return;

  files.forEach(file => {
    const url = 'assets/hotspot/' + file;
    const img = document.createElement('img');
    img.loading  = 'lazy';
    img.decoding = 'async';
    img.alt      = pin.dataset.displayName || 'Hotspot image';
    img.src      = url;
    img.onclick  = () => window.open(url, '_blank');
    img.onerror  = () => img.remove();
    wrap.appendChild(img);
  });
}
// Feature: Restore map pins after tour or scene transition
function restorePinsAfterTour() {
  const stage = document.querySelector('.m4-mapstage');
  const pinLayer = document.querySelector('.m4-pinlayer');

  // Reattach pins if layer was lost
  if (!stage || !pinLayer) {
    console.warn('[MapUI] Pin layer missing, rebuilding...');
    const newStage = document.querySelector('#m4-stage, .m4-mapwrap');
    if (!newStage) return;

    const newLayer = document.createElement('div');
    newLayer.className = 'm4-pinlayer';
    newStage.appendChild(newLayer);

    // re-render your pins if you have stored data
    if (window.renderPins) window.renderPins(newLayer);
  }
}

// Call this after tour ends or scene change
document.addEventListener('tour:end', restorePinsAfterTour);
document.addEventListener('scene:change', restorePinsAfterTour);

(function () {
  const VP   = () => el.mapwrap;
  const STG  = () => document.getElementById('m4-stage') || el.img?.parentElement || el.mapwrap;
  const PINQ = (id) => document.querySelector(`.m4-pin[data-scene-id="${CSS.escape(id)}"]`);

  function readTransform(stage) {
    const t = stage.style.transform || getComputedStyle(stage).transform || '';
    let scale = 1, tx = 0, ty = 0;

    if (t.startsWith('matrix(')) {
      const m = t.match(/matrix\(([^)]+)\)/);
      if (m) {
        const [a, , , d, e, f] = m[1].split(',').map(Number);
        scale = (a === d) ? a : Math.sqrt(a * a + d * d);
        tx = e; ty = f;
      }
    } else if (t.startsWith('matrix3d(')) {
      const m = t.match(/matrix3d\(([^)]+)\)/);
      if (m) {
        const arr = m[1].split(',').map(Number);
        scale = arr[0]; tx = arr[12]; ty = arr[13];
      }
    } else {
      const ms = t.match(/scale\(([-\d.]+)\)/);
      const mt = t.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
      if (ms) scale = parseFloat(ms[1]);
      if (mt) { tx = parseFloat(mt[1]); ty = parseFloat(mt[2]); }
    }
    return { scale, tx, ty };
  }

  function applyTransform(stage, { tx, ty, scale }, animate) {
    if (animate) {
      stage.style.transition = 'transform 220ms ease';
      stage.addEventListener('transitionend', () => {
        stage.style.transition = '';
      }, { once: true });
    }
    stage.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  }

  function clampTranslate(viewport, stage, tx, ty, scale) {
    const vp = viewport.getBoundingClientRect();
    const w  = stage.offsetWidth  * scale;
    const h  = stage.offsetHeight * scale;

    const minX = Math.min(0, vp.width  - w), maxX = Math.max(0, 0);
    const minY = Math.min(0, vp.height - h), maxY = Math.max(0, 0);
    return {
      tx: Math.max(minX, Math.min(maxX, tx)),
      ty: Math.max(minY, Math.min(maxY, ty))
    };
  }

  function pinPxFromConfig(sceneId) {

    const pinEl = PINQ(sceneId);
    if (pinEl && pinEl.offsetParent) {
      return { x: pinEl.offsetLeft, y: pinEl.offsetTop, pinEl };
    }
 
    const cfgPin = (window.pins || []).find(p => p.sceneId === sceneId);
    if (!cfgPin || !el.img) return null;

    const imgW = el.img.naturalWidth  || el.img.width  || 0;
    const imgH = el.img.naturalHeight || el.img.height || 0;
    return {
      x: (cfgPin.x / 100) * imgW,
      y: (cfgPin.y / 100) * imgH,
      pinEl: null
    };
  }

  window.focusHotspot = function focusHotspot(sceneId, opts = {}) {
    const viewport = VP();
    const stage    = STG();
    if (!viewport || !stage) return;

    const pinInfo = pinPxFromConfig(sceneId);
    if (!pinInfo) return;

   
    const { scale: curScale } = readTransform(stage);

  
    let targetScale = typeof opts.zoom === 'number'
      ? opts.zoom
      : (curScale < 1.5 ? 2 : curScale);
    targetScale = Math.max(1, Math.min(5, targetScale));

 
    const vpRect = viewport.getBoundingClientRect();
    const cx = vpRect.width  / 2;
    const cy = vpRect.height / 2;

    let tx = cx - pinInfo.x * targetScale;
    let ty = cy - pinInfo.y * targetScale;

  
    ({ tx, ty } = clampTranslate(viewport, stage, tx, ty, targetScale));

   
    applyTransform(stage, { tx, ty, scale: targetScale }, !!opts.animate);


    if (pinInfo.pinEl) {
      pinInfo.pinEl.classList.remove('m4-pulse'); void pinInfo.pinEl.offsetWidth;
      pinInfo.pinEl.classList.add('m4-pulse');
    }
    if (typeof highlightActiveRow === 'function') highlightActiveRow(sceneId);
    if (typeof highlightActivePin === 'function') highlightActivePin(sceneId);
  };
  // --- Full reset for map stage and pin layer ---
  window.resetMapFocus = function resetMapFocus() {
    const stage = document.querySelector('.m4-zoomstage') || document.getElementById('m4-stage');
    const pinLayer = el.pinLayer || document.querySelector('.m4-pinlayer');
    if (!stage) return;

    // Reset both transforms with transition
    [stage, pinLayer].forEach(layer => {
      if (!layer) return;
      layer.style.transition = 'transform 0.25s ease';
      layer.style.transform = 'translate(0px, 0px) scale(1)';
      setTimeout(() => { layer.style.transition = ''; }, 300);
    });

    // Reset zoom state
    if (window.Z) {
      Z.scale = 1;
      Z.tx = 0;
      Z.ty = 0;
    }

    // Re-sync pins to image after reset
    if (typeof window.syncPinLayerToImage === 'function') {
      setTimeout(() => window.syncPinLayerToImage(), 250);
    }

    // Clear focus marker
    window.__mapWasFocused = false;
  };


})();




if (el.addHotspot) el.addHotspot.addEventListener('click', ()=>{ if (DEV_MODE) createPin(50,50,'hotspot','', 'Hotspot', true); });
if (el.addInfo)    el.addInfo.addEventListener('click',    ()=>{ if (DEV_MODE) createPin(60,60,'info',   '', 'Info',    true); });
if (el.reset)      el.reset.addEventListener('click',      ()=>{
  if (!DEV_MODE) return;
  el.pinLayer.innerHTML=''; pins=[];
  listState = { groups:{}, scenes:{}, order:{groups:[],items:{}} };
  saveLocal();
  buildSceneList();
  if (el.editPanel) el.editPanel.style.display='none';
});


el.search?.addEventListener('input', ()=>{
  const q = el.search.value.trim().toLowerCase();

  const groupLis = Array.from(el.scenes.querySelectorAll('li.group-li'));
  groupLis.forEach(wrap=>{
    const header = wrap.querySelector('.group');
    const children = wrap.querySelector('ul.children');
    const rows = Array.from(children.querySelectorAll('a.scene'));
    let any=false;
    rows.forEach(a=>{
      const name=(a.querySelector('li.text')?.textContent||'').toLowerCase();
      const m=name.includes(q); a.style.display=m?'':'none'; if(m) any=true;
    });
    const headMatch=(header.querySelector('.m4-glabel')?.textContent||'').toLowerCase().includes(q);
    header.setAttribute('aria-expanded', (any||q==='')?'true':'false');
    if (children) children.style.display = (any||q==='') ? 'block' : 'none';
    wrap.style.display=(any||headMatch||q==='')?'':'none';
  });

  const flatRows = Array.from(el.scenes.querySelectorAll(':scope > a.scene'));
  flatRows.forEach(a=>{
    const name=(a.querySelector('li.text')?.textContent||'').toLowerCase();
    a.style.display = name.includes(q) || q==='' ? '' : 'none';
  });
});

/* ===== config export to clipboard ===== */
function currentConfigObject(){
  return { pins: exportPins(), list: listState };
}

async function copyConfigToClipboard(){
  const json = JSON.stringify(currentConfigObject(), null, 2);
  try {
    await navigator.clipboard.writeText(json);
    console.log('[MapUI] Config copied to clipboard.');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = json;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    console.log('[MapUI] Config copied via fallback.');
  }
}


function waitForImage(imgEl) {
  return new Promise(resolve => {
    if (!imgEl) return resolve();
    if (imgEl.complete && imgEl.naturalWidth > 0) return resolve();
    imgEl.addEventListener('load', () => resolve(), { once: true });
    imgEl.addEventListener('error', () => resolve(), { once: true });
  });
}


function syncPinsSoon() {
  syncPinLayerToImage();
  setTimeout(syncPinLayerToImage, 50);
}
// Feature: Fix pins when entering or exiting fullscreen
(function handleFullscreenPinSync() {
  const events = [
    'resize',
    'fullscreenchange',
    'webkitfullscreenchange',
    'mozfullscreenchange',
    'msfullscreenchange'
  ];

  events.forEach(ev => {
    window.addEventListener(ev, () => {
      try {
        // Recalculate after a short delay to allow DOM reflow
        if (typeof syncPinsSoon === 'function') {
          requestAnimationFrame(() => setTimeout(syncPinsSoon, 150));
        } else if (typeof updatePins === 'function') {
          requestAnimationFrame(() => setTimeout(updatePins, 150));
        }
      } catch (err) {
        console.warn('[MapUI] fullscreen pin sync failed:', err);
      }
    });
  });
})();
function initPinSyncObservers() {
  if (!el || !el.img || !el.pinLayer) return;

  // Initial sync
  syncPinLayerToImage();

  // Whenever the image box changes size, resync pins.
  try {
    const ro = new ResizeObserver(() => syncPinLayerToImage());
    ro.observe(el.img);
    el.__pinResizeObserver = ro;
  } catch (e) {
    // Older browsers: a light fallback
    window.addEventListener('resize', () => syncPinLayerToImage());
  }

  // Fullscreen & orientation events (cover all vendors)
  [
    'resize',
    'orientationchange',
    'fullscreenchange',
    'webkitfullscreenchange',
    'mozfullscreenchange',
    'MSFullscreenChange'
  ].forEach(ev => {
    window.addEventListener(ev, () => {
      // Do several passes to catch late reflows on some browsers
      syncPinLayerToImage();
      setTimeout(syncPinLayerToImage, 120);
      setTimeout(syncPinLayerToImage, 260);
    });
  });
}

// Feature: open menu and ensure map pins resync correctly (fullscreen + normal mode)
function openMenu(sceneId) {
  // Reveal the map overlay / backdrop
  el.backdrop?.setAttribute('aria-hidden', 'false');

  // Determine current scene and group
  const activeId = sceneId || window.__mapuiCurrentScene || null;
  const targetGroup = activeId ? groupKeyOfScene(activeId) : null;

  // Collapse other groups, open relevant one, highlight active row
  requestAnimationFrame(() => {
    collapseAllGroupsAndOpen(targetGroup);

    if (activeId && typeof highlightActiveRow === 'function') {
      highlightActiveRow(activeId);
    }

    // --- Immediate pin alignment ---
    if (typeof syncPinLayerToImage === 'function') {
      syncPinLayerToImage();
    }

    // --- Progressive re-sync passes ---
    // These catch late fullscreen reflows (browser-dependent)
    const reflows = [120, 300, 600];
    reflows.forEach(delay => {
      setTimeout(() => {
        if (typeof syncPinLayerToImage === 'function') syncPinLayerToImage();
        if (typeof syncPinsSoon === 'function') syncPinsSoon();
      }, delay);
    });
  });
}

function collapseAllGroupsAndOpen(targetGroupKey){
  const wraps = el.scenes?.querySelectorAll('li.group-li') || [];
  wraps.forEach(wrap => {
    const header = wrap.querySelector('.group');
    const ul = wrap.querySelector('.children');
    if (!header || !ul) return;

  
    header.setAttribute('aria-expanded','false');
    const btn = header.querySelector('.m4-gbtn');
    if (btn) btn.setAttribute('aria-expanded','false');
    ul.style.display = 'none';

    
    if (targetGroupKey){
      const label = header.querySelector('.m4-glabel')?.textContent?.trim();
      if (label === (listState.groups?.[targetGroupKey] || targetGroupKey)) {
        header.setAttribute('aria-expanded','true');
        if (btn) btn.setAttribute('aria-expanded','true');
        ul.style.display = 'block';
      }
    }
  });
}

function groupKeyOfScene(sceneId){
  if (!sceneId || !listState || !listState.order || !listState.order.items) return null;
  for (const [g, ids] of Object.entries(listState.order.items)){
    if (Array.isArray(ids) && ids.includes(sceneId)) return g;
  }
  return null;
}


function closeMenu(){ el.backdrop?.setAttribute('aria-hidden','true'); }


function applyDevUI(){ if (!DEV_MODE && el.foot) el.foot.style.display='none'; }

async function init() {
  hideNativeSceneList();
  applyDevUI();

  // ---------------------------
  // DEV UI setup (unchanged)
  // ---------------------------
  if (DEV_MODE && el.editPanel) {
    el.editPanel.style.display = 'flex';

    if (!el.editPanel.__wired) {
      el.saveEdit?.addEventListener('click', () => {
        if (!selectedPin) return;
        selectedPin.dataset.sceneId     = (el.editId?.value || '').trim();
        selectedPin.dataset.displayName = (el.editName?.value || '').trim();
        selectedPin.dataset.type        = (el.editType?.value || selectedPin.dataset.type);
        applyPinTitleTooltip(selectedPin);
        saveLocal();
      });

      el.deletePin?.addEventListener('click', () => {
        if (!selectedPin) return;
        selectedPin.remove();
        selectedPin = null;
        saveLocal();
        if (el.editId)   el.editId.value = '';
        if (el.editName) el.editName.value = '';
      });

      el.teleport?.addEventListener('click', () => {
        const targetId = (el.editId?.value || '').trim();
        if (!targetId) return;
        const ok = safeSwitchToScene(targetId);
        if (ok) {
          highlightActivePin(targetId);
          highlightActiveRow(targetId);
          closeMenu();
        }
      });

      el.editPanel.__wired = true;
    }
  }

  // ---------------------------
  // Load all scenes
  // ---------------------------
  scenesCache = await collectScenesWithWait();

  // ---------------------------
  // Load config (JSON first)
  // ---------------------------
  let mapJson = null;
  try {
    const resp = await fetch('map_config.json');
    if (resp.ok) {
      mapJson = await resp.json();
      window.mapConfig = mapJson;
      console.log('[MapUI] Loaded config from map_config.json');
    } else {
      console.warn('[MapUI] Failed to load map_config.json');
    }
  } catch (err) {
    console.warn('[MapUI] Error loading map_config.json', err);
  }

  // ---------------------------
  // Also check for any dynamic config (from data-config attr)
  // ---------------------------
  if (typeof loadConfigFromUrl === 'function') {
    const dataCfg = document.querySelector('[data-config]')?.getAttribute('data-config');
    if (dataCfg) {
      try { await loadConfigFromUrl(dataCfg); } catch {}
    }
  }

  // ---------------------------
  // Load localStorage (but prefer JSON)
  // ---------------------------
  const local = loadLocal();

  if (mapJson?.list) {
    console.log('[MapUI] Using list from map_config.json');
    listState = mapJson.list;
    localStorage.removeItem(LIST_KEY); // prevent future stale overwrites
  } else if (local.list) {
    console.log('[MapUI] Using list from localStorage');
    listState = local.list;
  } else {
    console.warn('[MapUI] No list found — using blank fallback');
    listState = { groups: {}, scenes: {}, order: { groups: [], items: {} } };
  }

  if (local.pins) pins = local.pins;

  // ---------------------------
  // Build UI
  // ---------------------------
  ensureOrder(groupScenesDefault(scenesCache));
  buildSceneList(scenesCache);

  if (pins?.length) loadPins(pins);

  await waitForImage(el.img);
  syncPinsSoon();
  initPinSyncObservers();
  if (OPEN_ON_LOAD) openMenu();
}

document.getElementById('m4-home')?.addEventListener('click', centerHome);


window.addEventListener('resize', () => { centerHome(); })

el.img?.addEventListener('load', syncPinsSoon);
window.addEventListener('resize', syncPinsSoon);

//el.mapwrap?.addEventListener('wheel', onWheelZoom, { passive: false });
//el.mapwrap?.addEventListener('mousedown', startPan);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
window.addEventListener('load', () => setTimeout(syncPinsSoon, 0));



let stageEl = null;                      
let Z = { scale: 1, min: 1, max: 4, tx: 0, ty: 0 };
let isPanning = false;
let panStart = { x: 0, y: 0, tx: 0, ty: 0 };

function clamp(v, mn, mx){ return Math.max(mn, Math.min(mx, v)); }

function applyTransform() {
  stageEl.style.transform = `translate(${Z.tx}px, ${Z.ty}px) scale(${Z.zoom})`;
}


function onWheelZoom(e){
  return;
}


function startPan(e){
  return;
}
function onPanMove(e){
  return;
}
function endPan(){
  return;
}



document.getElementById('m4-home')?.addEventListener('click', () => {
  Z = { zoom: 1, min: 1, max: 4, tx: 0, ty: 0 };
  applyTransform();
});


el.mapwrap?.addEventListener('wheel', onWheelZoom, { passive: false });
el.mapwrap?.addEventListener('mousedown', startPan);


function ensureZoomStage(){
  if (!el.mapwrap || !el.img || !el.pinLayer) return null;

  
  let st = el.mapwrap.querySelector('.m4-zoomstage');
  if (!st) {
    st = document.createElement('div');
    st.className = 'm4-zoomstage';
    
    st.style.position = 'relative';
    st.style.transformOrigin = '0 0';
    st.style.willChange = 'transform';

   
    st.appendChild(el.img);
    st.appendChild(el.pinLayer);
    el.mapwrap.appendChild(st);
  }
  return st;
}


function sizeStageToImage(){
  if (!stageEl || !el.img || !el.pinLayer) return;
  const w = el.img.naturalWidth  || el.img.width  || 1000;
  const h = el.img.naturalHeight || el.img.height || 600;

  stageEl.style.width  = w + 'px';
  stageEl.style.height = h + 'px';

  
  Object.assign(el.img.style, {
    position:'absolute', inset:'0', width:'100%', height:'100%', objectFit:'contain'
  });
  Object.assign(el.pinLayer.style, {
    position:'absolute', inset:'0', width:'100%', height:'100%'
  });
}
function applyZoom(){
  if (!stageEl) return;
  stageEl.style.transform = `translate(${Z.tx}px, ${Z.ty}px) scale(${Z.scale})`;
}

function clampPan() {
  const rect = mapWrap.getBoundingClientRect();
  const w = stage.offsetWidth * Z.scale;
  const h = stage.offsetHeight * Z.scale;

  
  if (w <= rect.width) {
    Z.tx = Math.round((rect.width - w) / 2);
  } else {
    const minX = rect.width - w;           
    Z.tx = Math.max(minX, Math.min(0, Z.tx));
  }
  if (h <= rect.height) {
    Z.ty = Math.round((rect.height - h) / 2);
  } else {
    const minY = rect.height - h;          
    Z.ty = Math.max(minY, Math.min(0, Z.ty));
  }
}


function fitAndCenter() {
  return;
}


window.addEventListener('resize', fitAndCenter)


function centerHome(){
  if (!stageEl) return;
  const vp = el.mapwrap.getBoundingClientRect();
  const w  = stageEl.offsetWidth;
  const h  = stageEl.offsetHeight;
  Z.scale = 1;
  Z.tx = Math.round((vp.width  - w) / 2);
  Z.ty = Math.round((vp.height - h) / 2);
  applyZoom();
}
const MAP_TRANSITION_MS = 350; // adjust to 500 for slower movement
let mapLocked = false;

function focusHotspot(sceneId) {
  const pin = findPinByScene(sceneId);
  if (!pin || !el.mapwrap) return;

  let xp = parseFloat(pin.dataset.x);
  let yp = parseFloat(pin.dataset.y);
  if (isNaN(xp)) xp = parseFloat((pin.style.left || '0').replace('%', ''));
  if (isNaN(yp)) yp = parseFloat((pin.style.top || '0').replace('%', ''));

  const stage = document.querySelector('.m4-zoomstage') || el.pinLayer?.parentElement || el.pinLayer;
  if (!stage) return;

  const baseW = stage.offsetWidth || el.img?.naturalWidth || 1000;
  const baseH = stage.offsetHeight || el.img?.naturalHeight || 600;

  const px = (xp / 100) * baseW;
  const py = (yp / 100) * baseH;

  const vp = el.mapwrap.getBoundingClientRect();
  const cx = vp.width / 2;
  const cy = vp.height / 2;

  // Smoothly zoom to the hotspot
  const targetScale = Math.max(2, Z.scale < 1.5 ? 2 : Z.scale);
  Z.scale = Math.min(Z.max, Math.max(Z.min, targetScale));

  Z.tx = Math.round(cx - px * Z.scale);
  Z.ty = Math.round(cy - py * Z.scale);

  if (typeof applyZoom === 'function') applyZoom();
  else if (typeof applyTransform === 'function') applyTransform();
  else {
    const s = document.querySelector('.m4-zoomstage');
    if (s) s.style.transform = `translate(${Z.tx}px, ${Z.ty}px) scale(${Z.scale})`;
  }

  // 🔒 Lock all gestures (non-dev mode only)
  if (!DEV_MODE) {
    window.__mapLocked = true; // global flag
    el.mapwrap.style.touchAction = 'none';
    el.mapwrap.style.pointerEvents = 'none';

    // disable wheel zoom & drag handlers if defined
    if (window.Z && typeof Z.enablePanZoom !== 'undefined') Z.enablePanZoom = false;
    document.body.classList.add('map-locked');
  }
if (typeof applyZoom === 'function') applyZoom();

// Lock the map after focusing
lockMapInteraction(true);

// Visual feedback
pin.classList.remove('m4-pulse'); void pin.offsetWidth; pin.classList.add('m4-pulse');
highlightActiveRow(sceneId);
highlightActivePin(sceneId);
}

function lockMapInteraction(lock = true) {
  const stage = document.querySelector('.m4-zoomstage') || el.mapwrap;
  if (!stage) return;

  if (lock) {
    stage.style.pointerEvents = 'none';
    el.mapwrap.style.touchAction = 'none';
  } else {
    stage.style.pointerEvents = 'auto';
    el.mapwrap.style.touchAction = 'auto';
  }
}


(function setupMapZoomPan() {
  const mapWrap = document.querySelector('.m4-mapwrap');
  const img = document.getElementById('m4-img');
  const pinLayer = document.getElementById('m4-pinlayer');

  if (!mapWrap || !img || !pinLayer) return;

 
  const stage = document.createElement('div');
  stage.className = 'm4-zoomstage';
  stage.style.position = 'relative';
  stage.style.transformOrigin = '0 0';
  stage.style.willChange = 'transform';
  img.parentNode.insertBefore(stage, img);
  stage.appendChild(img);
  stage.appendChild(pinLayer);

  let Z = { scale: 1, min: 1, max: 4, tx: 0, ty: 0 };
  let panning = false;
  let start = { x: 0, y: 0, tx: 0, ty: 0 };

  const clamp = (v, mn, mx) => Math.max(mn, Math.min(mx, v));
  const apply = () => {
    stage.style.transform = `translate(${Z.tx}px, ${Z.ty}px) scale(${Z.scale})`;
  };
  const clampPan = () => {
    const rect = mapWrap.getBoundingClientRect();
    const w = stage.offsetWidth * Z.scale;
    const h = stage.offsetHeight * Z.scale;
    const minX = Math.min(0, rect.width - w);
    const minY = Math.min(0, rect.height - h);
    Z.tx = clamp(Z.tx, minX, 0);
    Z.ty = clamp(Z.ty, minY, 0);
  };

 
  mapWrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = mapWrap.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const preX = (mx - Z.tx) / Z.scale;
    const preY = (my - Z.ty) / Z.scale;
    const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
    Z.scale = clamp(Z.scale * factor, Z.min, Z.max);
    Z.tx = mx - preX * Z.scale;
    Z.ty = my - preY * Z.scale;
    clampPan();
    apply();
  }, { passive: false });

  

//let isPanning = false;
//let panStart = { x: 0, y: 0, tx: 0, ty: 0 };


['mousedown'].forEach(evt => {
  [mapWrap, stage, pinLayer, img].forEach(el => {
    el.addEventListener(evt, (e) => {

      if (e.target && e.target.closest('.m4-pin')) return;

      if (e.button !== 0) return;

      e.preventDefault();
      isPanning = true;
      panStart = { x: e.clientX, y: e.clientY, tx: Z.tx, ty: Z.ty };
      document.addEventListener('mousemove', onPanMove, { passive: false });
      document.addEventListener('mouseup', endPan, { once: true });
      mapWrap.classList.add('grabbing');
    }, { passive: false });
  });
});

function onPanMove(e) {
  return;
}

function endPan() {
  return;
}



  function centerMap() {
    const rect = mapWrap.getBoundingClientRect();
    const w = stage.offsetWidth;
    const h = stage.offsetHeight;
    Z.scale = 1;
    Z.tx = (rect.width - w) / 2;
    Z.ty = (rect.height - h) / 2;
    apply();
  }
  window.addEventListener('resize', centerMap);
  centerMap();

  
  document.getElementById('m4-home')?.addEventListener('click', (e) => {
    e.preventDefault();
    fitAndCenter();
  });
})();

function unlockMap() {
  window.__mapLocked = false;
  el.mapwrap.style.pointerEvents = 'auto';
  el.mapwrap.style.touchAction = 'auto';
  if (window.Z) Z.enablePanZoom = true;
  document.body.classList.remove('map-locked');
}

function resetMapView() {
  Z.scale = 1;
  Z.tx = 0;
  Z.ty = 0;

  if (typeof applyZoom === 'function') applyZoom();
  else if (typeof applyTransform === 'function') applyTransform();
  unlockMap();
}





(function () {

  if (typeof window.mapUISetActive === 'function' && !window.mapUISetActive.__wrapped) {
    const _origMapUISetActive = window.mapUISetActive;
    window.mapUISetActive = function (sceneId) {
      if (sceneId) window.__mapuiCurrentScene = sceneId;
      _origMapUISetActive(sceneId); 
    };
    window.mapUISetActive.__wrapped = true;
  }


  if (typeof window.switchToScene === 'function' && !window.switchToScene.__tap) {
    const _origSwitchToScene = window.switchToScene;
    window.switchToScene = function (sceneOrId, opts) {
      try {
        const id = (typeof sceneOrId === 'string')
          ? sceneOrId
          : (sceneOrId && (sceneOrId.id || sceneOrId.data?.id));
        if (id) window.__mapuiCurrentScene = id;
      } catch {}
      return _origSwitchToScene.apply(this, arguments);
    };
    window.switchToScene.__tap = true;
  }


  const toggleBtn = document.getElementById('m4-toggle');
  if (toggleBtn && !toggleBtn.__collapseHook) {
    toggleBtn.addEventListener('click', () => {

      setTimeout(() => {
        const activeId = window.__mapuiCurrentScene;
        if (!activeId) return;
        if (typeof groupKeyOfScene !== 'function' || typeof collapseAllGroupsExcept !== 'function') return;

        const gKey = groupKeyOfScene(activeId);
        collapseAllGroupsExcept(gKey);


        if (typeof highlightActiveRow === 'function') highlightActiveRow(activeId);
        if (typeof highlightActivePin === 'function') highlightActivePin(activeId);


        if (typeof syncPinLayerToImage === 'function') requestAnimationFrame(syncPinLayerToImage);
      }, 0);
    });
    toggleBtn.__collapseHook = true;
  }
})();

function toast(message, ok = true) {
  let el = document.createElement('div');
  el.className = 'm4-toast';
  el.textContent = message || (ok ? 'Done' : 'OK');
  Object.assign(el.style, {
    position:'fixed', left:'50%', bottom:'24px', transform:'translateX(-50%)',
    background: ok ? 'rgba(16,185,129,.95)' : 'rgba(59,130,246,.95)',
    color:'#020617', fontWeight:'700', padding:'8px 12px',
    borderRadius:'10px', boxShadow:'0 8px 24px rgba(0,0,0,.35)', zIndex: 99999,
    opacity:'0', transition:'opacity .18s ease, transform .18s ease'
  });
  document.body.appendChild(el);
  requestAnimationFrame(() => { el.style.opacity='1'; el.style.transform='translateX(-50%) translateY(-4px)'; });
  setTimeout(() => {
    el.style.opacity='0'; el.style.transform='translateX(-50%) translateY(0)';
    setTimeout(() => el.remove(), 180);
  }, 1400);
}
// Keep pins in sync on resize or fullscreen changes
['resize', 'fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'msfullscreenchange'].forEach(ev => {
  window.addEventListener(ev, () => {
    if (typeof syncPinsSoon === 'function') {
      requestAnimationFrame(() => setTimeout(syncPinsSoon, 150));
    } else if (typeof updatePins === 'function') {
      requestAnimationFrame(() => setTimeout(updatePins, 150));
    }
  });
});
