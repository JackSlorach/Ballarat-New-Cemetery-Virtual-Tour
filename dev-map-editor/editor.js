/* Editor with:
   - Map fits panel HEIGHT; horizontal overflow allowed; always-on panning
   - Zoom (wheel and +/- buttons)
   - Pins are GLOBAL (not per scene); drag to reposition
   - Create hotspot: button (center) or double-click a scene (center)
   - Create info: button (center)
   - Info panel preview shows title/caption/body; title also mirrored above preview
   - Image workflow:
       • Field now expects FILENAME ONLY (e.g. "birdsong.jpg")
       • "Upload" writes/overwrites into assets/hotspot/<filename> (via File System Access API)
       • Preview prefers the saved file; falls back to ./assets/hotspot/<filename> or object URL
       • Export uses filename only
   - Autosave for INFO pins on blur/change and after image select
   - Export EXACT schema downstream expects:
       • list block preserved verbatim (but updated when hotspots added/renamed)
       • hotspot: { type:"hotspot", sceneId:<marzipanoSceneId>, displayName:<label> }
       • info:    { type:"info",    sceneId:<title>,           displayName:<body>, image:<filename> }
   - Scene list uses hotspot display name for titles; hotspots also grouped by best-match group label
*/
const $ = s => document.querySelector(s);
const GLOBAL_SCENE = '__GLOBAL__';

const els = {
  // header
  sceneSearch: $('#sceneSearch'),
  btnPickData: $('#btnPickData'), dataPicker: $('#dataPicker'),
  mapUrlGlobal: $('#mapUrlGlobal'),
  btnImport: $('#btnImport'), btnDownload: $('#btnDownload'),
  btnSaveTop: $('#btnSaveTop'), pinTag: $('#pinTag'),
  // left
  sceneList: $('#sceneList'),
  // center
  mapWrap: $('#mapWrap'), stage: $('#stage'), mapImg: $('#mapImg'), pinLayer: $('#pinLayer'),
  // right (info)
  title: $('#titleInput'), caption: $('#captionInput'), body: $('#bodyInput'),
  imgUrl: $('#imgUrlInput'), imgFile: $('#imgFileInput'),
  imgSize: $('#imgSizeInput'), imgSizeVal: $('#imgSizeVal'),
  useHtml: $('#useHtmlInput'), transparentBg: $('#transparentBgInput'),
  fig: $('#fig'), img: $('#img'), cap: $('#cap'), bodyOut: $('#bodyOut'),
  btnReset: $('#btnReset'),
  // footer
  btnAddHotspot: $('#btnAddHotspot'), btnAddInfo: $('#btnAddInfo'),
  btnResetPins: $('#btnResetPins'), btnDelete: $('#btnDelete'),
  btnCopy: $('#btnCopy'), btnSave: $('#btnSave'),
  inpSceneId: $('#inpSceneId'), inpDisplay: $('#inpDisplay'), selKind: $('#selKind'),
  // misc
  infoPanel: $('#infoPanel'),
  status: $('#status'),
  toasts: $('#toasts'),
  titleOut: $('#titleOut'),
  // zoom
  zoomIn: $('#zoomIn'), zoomOut: $('#zoomOut'), zoomReset: $('#zoomReset'),
};

/* ---------- State ---------- */
let APP_DATA = null;
let scenes = [];
let selectedSceneId = null;

let pins = [];            // {id, sceneId: GLOBAL_SCENE, targetSceneId, kind, displayText, xPct, yPct, payload}
let activePinId = null;

let SCENE_NAME_BY_ID = {};
let ORDERED_SCENE_IDS = [];
let MAP_LIST_BLOCK = null;   // preserved verbatim from map_config.json

/* ---------- Helpers ---------- */
const pad=n=>String(n).padStart(2,'0');
const timestamp=()=>{const d=new Date();return`${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;};
const clamp01 = v => Math.max(0, Math.min(1, v));
const basename = p => (p||'').split('/').pop().split('\\').pop();

/* ---------- Toasts / Status ---------- */
function toast(msg, kind='ok'){
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  els.toasts.appendChild(el);
  setTimeout(()=>{ el.style.transition='opacity .25s ease, transform .25s ease'; el.style.opacity='.0'; el.style.transform='translateY(6px)'; }, 1800);
  setTimeout(()=> el.remove(), 2100);
}
function setStatus(msg, kind='muted'){
  els.status.textContent = msg;
  els.status.style.color = kind==='ok' ? 'var(--ok)' : kind==='err' ? 'var(--err)' : 'var(--muted)';
}

/* ============================================================
   MAP STAGE LAYOUT + ZOOM + PANNING (FIT HEIGHT, ALLOW OVERFLOW)
   ============================================================ */
let natW=0, natH=0;
let stageW=0, stageH=0;
let panX=0, panY=0;
let panning=false, panStart={x:0,y:0}, panOrigin={x:0,y:0};
let zoom = 1;
const ZMIN = 0.6, ZMAX = 3, ZSTEP = 0.1;

function fitToHeight() {
  const wrap = els.mapWrap.getBoundingClientRect();
  if (!natW || !natH || !wrap.width || !wrap.height) return;

  const baseScale = wrap.height / natH;
  const baseW = Math.round(natW * baseScale);
  const baseH = Math.round(natH * baseScale);

  stageW = Math.round(baseW * zoom);
  stageH = Math.round(baseH * zoom);

  const baseLeft = Math.round((wrap.width  - stageW) / 2);
  const baseTop  = Math.round((wrap.height - stageH) / 2);

  let left = baseLeft + panX;
  let top  = baseTop  + panY;

  const minLeft = Math.min(0, wrap.width - stageW);
  const maxLeft = Math.max(0, baseLeft);
  const minTop  = Math.min(0, wrap.height - stageH);
  const maxTop  = Math.max(0, baseTop);

  if (left < minLeft) left = minLeft;
  if (left > maxLeft) left = maxLeft;
  if (top  < minTop ) top  = minTop;
  if (top  > maxTop ) top  = maxTop;

  els.stage.style.width  = stageW + 'px';
  els.stage.style.height = stageH + 'px';
  els.stage.style.left   = left   + 'px';
  els.stage.style.top    = top    + 'px';
}

els.mapWrap.addEventListener('wheel', (e)=>{
  e.preventDefault();
  const dir = e.deltaY > 0 ? -1 : 1;
  setZoom(zoom + dir*ZSTEP, false);
}, { passive:false });

function onImageLoad(){
  natW = els.mapImg.naturalWidth  || 2048;
  natH = els.mapImg.naturalHeight || 2048;
  zoom = 1.35; panX = 0; panY = 0;
  fitToHeight();
  renderPins();
}
function setZoom(next, showToast=true){
  zoom = Math.min(ZMAX, Math.max(ZMIN, Math.round(next*100)/100));
  fitToHeight();
  if (showToast) toast(`${Math.round(zoom*100)}%`, 'ok');
}
function zoomIn(){ setZoom(zoom + ZSTEP); }
function zoomOut(){ setZoom(zoom - ZSTEP); }
function zoomReset(){ setZoom(1); }

els.zoomIn?.addEventListener('click', zoomIn);
els.zoomOut?.addEventListener('click', zoomOut);
els.zoomReset?.addEventListener('click', zoomReset);

// Always-on panning (click-drag on empty map)
function isOnControl(target){
  return !!(target.closest('.m4-pin') ||
            target.closest('.zoomCtl') ||
            target.closest('.hint') ||
            target.closest('.panel:not(.mapCol)'));
}
function startPan(e){
  if (e.button !== 0) return;
  if (isOnControl(e.target)) return;
  panning = true;
  const wrap = els.mapWrap.getBoundingClientRect();
  const stageRect = els.stage.getBoundingClientRect();
  const baseLeft = (wrap.width  - stageW) / 2;
  const baseTop  = (wrap.height - stageH) / 2;
  panStart  = { x: e.clientX, y: e.clientY };
  panOrigin = { x: (stageRect.left - wrap.left) - baseLeft,
                y: (stageRect.top  - wrap.top ) - baseTop  };
  document.body.style.cursor='grab';
}
function movePan(e){
  if(!panning) return;
  panX = panOrigin.x + (e.clientX - panStart.x);
  panY = panOrigin.y + (e.clientY - panStart.y);
  fitToHeight();
}
function endPan(){
  if(!panning) return;
  panning=false;
  document.body.style.cursor='';
}
els.mapWrap.addEventListener('mousedown', startPan);
window.addEventListener('mousemove', movePan);
window.addEventListener('mouseup', endPan);
window.addEventListener('resize', fitToHeight);
els.mapImg.addEventListener('load', onImageLoad);

/* ---------- Loaders ---------- */
async function loadDataJsFromUrl(url){
  return new Promise((res,rej)=>{ const s=document.createElement('script'); s.src=url; s.onload=()=>res(); s.onerror=()=>rej(new Error('Failed '+url)); document.head.appendChild(s); });
}
async function loadDataJsFromFile(file){
  const text=await file.text();
  const fn=new Function('window', `${text}; return window.APP_DATA || APP_DATA;`);
  return fn(window);
}
async function tryLoadMapConfig(path='../map_config.json'){
  try { const r=await fetch(path, {cache:'no-cache'}); if(!r.ok) return null; return await r.json(); }
  catch { return null; }
}
function extractScenesFromAPP(){
  const arr=(APP_DATA&&APP_DATA.scenes)||[];
  return arr.map(sc=>({ id: sc.id || sc.sceneId || sc.name, name: sc.name || sc.id || 'Scene' }));
}

/* ---------- Scene list ---------- */
function sceneDisplayName(id){ return SCENE_NAME_BY_ID[id] || scenes.find(s=>s.id===id)?.name || id; }
function computeOrderedScenes(){
  if (ORDERED_SCENE_IDS.length){
    const set=new Set(ORDERED_SCENE_IDS);
    const ordered=ORDERED_SCENE_IDS.filter(id=>scenes.some(s=>s.id===id));
    const rest=scenes.map(s=>s.id).filter(id=>!set.has(id));
    return [...ordered,...rest].map(id=>({id,name:sceneDisplayName(id)}));
  }
  return scenes.map(s=>({id:s.id,name:sceneDisplayName(s.id)}));
}
function renderSceneList(){
  const q=(els.sceneSearch.value||'').toLowerCase();
  const base=computeOrderedScenes();
  const filtered=base.filter(s=>(s.name||'').toLowerCase().includes(q)||(s.id||'').toLowerCase().includes(q));
  els.sceneList.innerHTML = filtered.map(s=>`<div class="sceneItem ${s.id===selectedSceneId?'active':''}" data-id="${s.id}" tabindex="0">${s.name||s.id}</div>`).join('') || '<div class="card">No scenes loaded.</div>';
  els.sceneList.querySelectorAll('.sceneItem').forEach(el=>{
    const id=el.dataset.id;
    el.addEventListener('click', ()=> selectScene(id));
    el.addEventListener('dblclick', ()=>{ selectScene(id); autoCreateHotspotForScene(id); });
    el.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ selectScene(id); autoCreateHotspotForScene(id); }});
  });
}
function selectScene(id){
  selectedSceneId=id;
  renderSceneList();
  const url = els.mapUrlGlobal.value.trim();
  if (url) els.mapImg.src = url;
  else fitToHeight();
  renderPins();
}

/* ---------- List maintenance (preserve verbatim; update titles & groups) ---------- */
function ensureListBlock(){
  if (!MAP_LIST_BLOCK) {
    MAP_LIST_BLOCK = {
      groups: { "Ungrouped": "Ungrouped" },
      scenes: { ...SCENE_NAME_BY_ID },
      order: {
        groups: ["Visible","Ungrouped"],
        items: { "Visible": ORDERED_SCENE_IDS?.length ? ORDERED_SCENE_IDS.slice() : scenes.map(s=>s.id),
                 "Ungrouped": [] }
      }
    };
  }
}
function addHotspotToList(sceneId, displayName){
  if (!sceneId) return;
  ensureListBlock();

  const name = (displayName || sceneId).trim();
  const groupsMap = MAP_LIST_BLOCK.groups || {};
  const items = (MAP_LIST_BLOCK.order && MAP_LIST_BLOCK.order.items) || (MAP_LIST_BLOCK.order.items = {});

  // 1) Use hotspot display name for the list title
  MAP_LIST_BLOCK.scenes[sceneId] = name;
  SCENE_NAME_BY_ID[sceneId] = name;

  // 2) Always be visible
  const visibleArr = items["Visible"] || (items["Visible"] = []);
  if (!visibleArr.includes(sceneId)) visibleArr.push(sceneId);

  // 3) Also add to a matching group list if we can find one
  Object.entries(groupsMap).forEach(([groupKey, groupLabel]) => {
    const gl = (groupLabel || '').trim();
    if (!gl) return;
    const isMatch = (name === gl) || name.includes(gl) || gl.includes(name);
    if (!isMatch) return;
    const groupArr = items[groupKey] || (items[groupKey] = []);
    if (!groupArr.includes(sceneId)) groupArr.push(sceneId);
  });

  if (!ORDERED_SCENE_IDS.includes(sceneId)) ORDERED_SCENE_IDS.push(sceneId);
  renderSceneList();
}

/* ---------- Pin helpers (percent coords) ---------- */
function pointOnStageToPct(clientX, clientY){
  const r = els.stage.getBoundingClientRect();
  const x = clamp01((clientX - r.left) / r.width);
  const y = clamp01((clientY - r.top ) / r.height);
  return { xPct:+(x*100).toFixed(6), yPct:+(y*100).toFixed(6) };
}
function applyPinTitleTooltip(el){
  const tip = (el.dataset.type === 'hotspot')
    ? (el.dataset.displayName || el.dataset.sceneId || '')
    : (el.dataset.sceneId || el.dataset.displayName || '');
  el.title = tip;
  el.dataset.tooltip = tip;
}
function createPinPercent(xPct,yPct,type='hotspot',sceneId='',displayName='',select=true){
  const id='pin_'+Math.random().toString(36).slice(2,10);
  const pin={
    id,
    sceneId: GLOBAL_SCENE,
    targetSceneId: type==='hotspot' ? (sceneId || '') : '',
    kind: type,  // 'hotspot' | 'info'
    displayText: displayName || '',
    xPct, yPct,
    payload: toPayload()
  };
  pins.push(pin);

  if (type === 'hotspot') {
    const label = displayName || SCENE_NAME_BY_ID[pin.targetSceneId] || pin.targetSceneId;
    addHotspotToList(pin.targetSceneId, label);
  }

  if (select){ activePinId=id; els.pinTag.textContent='#'+id; }
  renderPins();
  toast(type==='info' ? 'Info added' : 'Hotspot added', 'ok');
  return id;
}

/* ---------- Render pins (global) ---------- */
function renderPins(){
  els.pinLayer.innerHTML = '';
  pins.forEach(p=>{
    const el=document.createElement('div');
    el.className='m4-pin';
    el.dataset.id = p.id;
    el.dataset.type = p.kind;
    el.dataset.sceneId = p.kind==='hotspot' ? (p.targetSceneId || '') : (p.displayText || '');
    el.dataset.displayName = p.displayText || '';
    el.dataset.x = p.xPct; el.dataset.y = p.yPct;
    el.style.left = p.xPct + '%';
    el.style.top  = p.yPct + '%';
    applyPinTitleTooltip(el);

    el.addEventListener('click', e=>{ e.stopPropagation(); selectPin(p.id); });

    // drag to move
    let dragging=false;
    const move=(ev)=>{
      if(!dragging) return;
      const {xPct,yPct}=pointOnStageToPct(ev.clientX, ev.clientY);
      p.xPct=xPct; p.yPct=yPct;
      el.dataset.x=xPct; el.dataset.y=yPct;
      el.style.left=xPct+'%'; el.style.top=yPct+'%';
    };
    const up=()=>{
      if(!dragging) return;
      dragging=false;
      window.removeEventListener('mousemove',move);
      window.removeEventListener('mouseup',up);
      setStatus('Position updated ✓','ok');
      toast('Location saved','ok');
    };
    el.addEventListener('mousedown', ev=>{
      ev.preventDefault();
      dragging=true;
      window.addEventListener('mousemove',move);
      window.addEventListener('mouseup',up);
    });

    els.pinLayer.appendChild(el);
  });
}

function selectPin(id){
  activePinId=id; els.pinTag.textContent='#'+id;
  const pin=pins.find(p=>p.id===id); if(!pin) return;
  applyPayload(pin.payload);
  els.inpSceneId.value = pin.targetSceneId || '';
  els.inpDisplay.value = pin.displayText || '';
  els.selKind.value    = pin.kind || 'hotspot';
  updateInfoEnabled();
  setStatus('Loaded pin content.');
}
function resetPinsForCurrentScene(){  // clears all pins (global)
  pins = [];
  renderPins();
}

/* Double-click scene → center hotspot for that scene */
function autoCreateHotspotForScene(sceneId){
  const label = sceneDisplayName(sceneId);
  const id = createPinPercent(50,50,'hotspot',sceneId,label,true);
  setStatus(`Hotspot created for "${label}"`, 'ok');
  toast('Hotspot added','ok');
}

/* ---------- Info editor (preview + payload) ---------- */
function toPayload(){
  return {
    title: els.title.value.trim(),
    caption: els.caption.value.trim(),
    body: els.body.value,
    imageUrl: els.imgUrl.value.trim(),        // FILENAME ONLY
    imageSize: parseInt(els.imgSize.value,10) || 360,
    useHtml: !!els.useHtml.checked,
    transparentPreview: !!els.transparentBg.checked
  };
}
function applyPayload(v={}){
  els.title.value=v.title||'';
  els.caption.value=v.caption||'';
  els.body.value=v.body||'';
  els.imgUrl.value=v.imageUrl||'';  // filename
  els.imgSize.value=String(v.imageSize||360);
  els.imgSizeVal.textContent=els.imgSize.value;
  els.useHtml.checked=!!v.useHtml;
  els.transparentBg.checked=!!v.transparentPreview;
  previewImageByName(els.imgUrl.value);  // async preview by filename
  preview();
}
function preview(){
  const px = parseInt(els.imgSize.value, 10) || 360;

  const t = (els.title.value || '').trim();
  if (els.titleOut) els.titleOut.textContent = t;

  els.imgSizeVal.textContent = String(px);
  els.img.style.width = px + 'px';
  els.cap.textContent = (els.caption.value || '').trim();
  els.fig.style.background = els.transparentBg.checked ? 'transparent' : '';

  const text = els.body.value || '';
  if (els.useHtml.checked) els.bodyOut.innerHTML = text;
  else                     els.bodyOut.textContent = text;
}

/* ---------- File System Access: save to assets/hotspot ---------- */
let assetsDirHandle = null;     // user-picked "assets" folder
let hotspotDirHandle = null;    // "hotspot" subfolder under assets

async function verifyPermission(handle, readWrite = true) {
  if (!handle) return false;
  const opts = readWrite ? { mode: 'readwrite' } : {};
  if ((await handle.queryPermission?.(opts)) === 'granted') return true;
  if ((await handle.requestPermission?.(opts)) === 'granted') return true;
  return false;
}
async function ensureAssetsDir() {
  if (!('showDirectoryPicker' in window)) return null; // unsupported browser
  try {
    if (!assetsDirHandle) {
      assetsDirHandle = await window.showDirectoryPicker({ id: 'assets-folder', startIn: 'documents' });
      if (!(await verifyPermission(assetsDirHandle, true))) return null;
    }
    hotspotDirHandle = await assetsDirHandle.getDirectoryHandle('hotspot', { create: true });
    return hotspotDirHandle;
  } catch (e) {
    console.warn('Directory pick/cancel:', e);
    return null;
  }
}
async function saveImageToHotspotDir(file, safeName) {
  const dir = await ensureAssetsDir();
  if (!dir) return false;
  const fileHandle = await dir.getFileHandle(safeName, { create: true }); // overwrite via write
  if (!(await verifyPermission(fileHandle, true))) return false;
  const writable = await fileHandle.createWritable();
  await writable.write(file);
  await writable.close();
  return true;
}

/* ---------- Preview helpers: prefer bound folder; else try path fallbacks ---------- */
// Possible public paths (editor may live in /editor/ or root)
const HOTSPOT_PATHS = [
  '../assets/hotspot/',  // editor in a subfolder
  './assets/hotspot/',   // editor at project root
  '/assets/hotspot/'     // server root
];

async function tryObjectURLFromHotspot(name){
  if (!name || !hotspotDirHandle) return null;
  try {
    const fh = await hotspotDirHandle.getFileHandle(name);
    const f  = await fh.getFile();
    return URL.createObjectURL(f);
  } catch {
    return null;
  }
}

function loadImageOnce(url){
  return new Promise((resolve, reject) => {
    const img = new Image();
    const bust = url + (url.includes('?') ? '&' : '?') + 'v=' + Date.now(); // cache-bust
    img.onload = () => resolve(bust);
    img.onerror = reject;
    img.src = bust;
  });
}

async function previewImageByName(name){
  if (!name) { els.img.removeAttribute('src'); return; }

  // 1) If we have the bound folder, read the real file
  const objUrl = await tryObjectURLFromHotspot(name);
  if (objUrl) { els.img.src = objUrl; return; }

  // 2) Try common URL bases in order
  for (const base of HOTSPOT_PATHS) {
    const tryUrl = base + name;
    try {
      const okUrl = await loadImageOnce(tryUrl);
      els.img.src = okUrl;
      return;
    } catch { /* try next */ }
  }

  // 3) Couldn’t resolve anywhere
  els.img.removeAttribute('src');
  setStatus(`Could not find assets/hotspot/${name} at expected paths`, 'err');
  toast('Image not found at expected paths', 'warn');
}

// when "image filename" changes, preview it and autosave
async function handleImgUrlInput(){
  const name = (els.imgUrl.value || '').trim();
  await previewImageByName(name);
  autoSaveInfo?.('image filename');
}

// when a file is picked, save/overwrite to assets/hotspot/<name>, set filename field, preview, autosave
async function handleImgFileChange(e){
  const f = e.target.files && e.target.files[0];
  if (!f) return;

  const safeName = f.name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '_');

  let wrote = false;
  try { wrote = await saveImageToHotspotDir(f, safeName); }
  catch (err) { console.warn('Write failed:', err); wrote = false; }

  // store filename only
  els.imgUrl.value = safeName;

  if (wrote) {
    await previewImageByName(safeName);
    toast(`Saved & referenced ./assets/hotspot/${safeName}`, 'ok');
    setStatus(`Saved image to assets/hotspot (${safeName})`, 'ok');
  } else {
    // Fallback: preview immediate selection (works even without folder access)
    const rd = new FileReader();
    rd.onload = v => { els.img.src = v.target.result; };
    rd.readAsDataURL(f);
    setStatus('Could not write to disk (browser limits). Using preview only.', 'err');
    toast(`Referencing ./assets/hotspot/${safeName}. Bind folder to save`, 'warn');
  }

  autoSaveInfo?.('image file');
}

/* ---------- Autosave for info pins ---------- */
function debounce(fn, ms = 400) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
const autoSaveInfo = debounce((reason = 'auto') => {
  if (!activePinId) return;
  const pin = pins.find(p => p.id === activePinId);
  if (!pin || pin.kind !== 'info') return;
  pin.payload = toPayload();
  setStatus(`Info saved (${reason})`, 'ok');
}, 300);

/* Live preview + autosave events */
['input','change','keyup'].forEach(evt=>{
  els.title.addEventListener(evt, preview);
  els.caption.addEventListener(evt, preview);
  els.body.addEventListener(evt, preview);
  els.imgUrl.addEventListener(evt, handleImgUrlInput);
  els.imgSize.addEventListener('input', preview);
  els.useHtml.addEventListener('change', preview);
  els.transparentBg.addEventListener('change', preview);
});
['blur','change'].forEach(evt=>{
  els.title.addEventListener(evt, () => autoSaveInfo('title'));
  els.caption.addEventListener(evt, () => autoSaveInfo('caption'));
  els.body.addEventListener(evt, () => autoSaveInfo('body'));
  els.imgUrl.addEventListener(evt, () => autoSaveInfo('image filename'));
  els.imgSize.addEventListener(evt, () => autoSaveInfo('image size'));
  els.useHtml.addEventListener(evt, () => autoSaveInfo('format'));
  els.transparentBg.addEventListener(evt, () => autoSaveInfo('bg'));
});
els.imgFile.addEventListener('change', handleImgFileChange);

els.btnReset.addEventListener('click', ()=> applyPayload({}));

/* Enable/disable info panel */
function updateInfoEnabled(){
  if (els.selKind.value === 'info') {
    els.infoPanel.classList.remove('disabled');
    autoSaveInfo('kind=info');
  } else {
    els.infoPanel.classList.add('disabled');
  }
}
els.selKind.addEventListener('change', updateInfoEnabled);

/* Keep quick fields synced with active pin and list */
function updateActivePinMeta(){
  if(!activePinId) return;
  const pin=pins.find(p=>p.id===activePinId); if(!pin) return;

  const prevTarget = pin.targetSceneId;
  const prevName   = pin.displayText;

  pin.targetSceneId = els.inpSceneId.value.trim();
  pin.displayText   = els.inpDisplay.value.trim();
  pin.kind          = els.selKind.value;

  if (pin.kind === 'hotspot' && (pin.targetSceneId !== prevTarget || pin.displayText !== prevName)) {
    const label = pin.displayText || SCENE_NAME_BY_ID[pin.targetSceneId] || pin.targetSceneId;
    addHotspotToList(pin.targetSceneId, label);
  }
  updateInfoEnabled();
  renderPins();
}
['input','change'].forEach(evt=>{
  els.inpSceneId.addEventListener(evt, updateActivePinMeta);
  els.inpDisplay.addEventListener(evt, updateActivePinMeta);
  els.selKind.addEventListener(evt, updateActivePinMeta);
});

/* ---------- Export / Import (EXACT schema) ---------- */
function exportToMapConfigJSON(){
  const list = MAP_LIST_BLOCK ? MAP_LIST_BLOCK : {
    groups: { "Ungrouped": "Ungrouped" },
    scenes: SCENE_NAME_BY_ID,
    order: { groups:["Visible","Ungrouped"], items:{ "Visible": (ORDERED_SCENE_IDS.length?ORDERED_SCENE_IDS:scenes.map(s=>s.id)), "Ungrouped":[] } }
  };

  const outPins = pins.map(p => {
    const isInfo = (p.kind === 'info');
    const base = {
      x: p.xPct,
      y: p.yPct,
      type: isInfo ? 'info' : 'hotspot',
      // INFO: sceneId = title/label; HOTSPOT: sceneId = target marzipano id
      sceneId: isInfo ? (p.displayText || p.payload?.title || '') : (p.targetSceneId || ''),
      // INFO: displayName = BODY; HOTSPOT: displayName = label/title
      displayName: isInfo ? (p.payload?.body || '') : (p.displayText || p.payload?.title || '')
    };
    if (isInfo) {
      const img = basename(p.payload?.imageUrl || '');
      if (img) base.image = img;         // filename only
      if (p.payload?.tour) base.tour = p.payload.tour;
    }
    return base;
  });

  return { list, pins: outPins };
}

function downloadJson(){
  const out=exportToMapConfigJSON();
  const blob=new Blob([JSON.stringify(out,null,2)],{type:'application/json'});
  const name=`map_config-${timestamp()}.json`;
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },100);
  setStatus('Downloaded '+name,'ok');
  toast('Config downloaded','ok');
}
els.btnDownload.addEventListener('click', downloadJson);

els.btnImport.addEventListener('click', ()=>{
  const i=document.createElement('input'); i.type='file'; i.accept='.json,application/json';
  i.onchange=async()=>{
    const f=i.files?.[0]; if(!f) return;
    try{
      const txt=await f.text(); const data=JSON.parse(txt);
      if(data){
        if (data.list) {
          MAP_LIST_BLOCK = data.list;                                  // preserve verbatim
          if (data.list.scenes && typeof data.list.scenes==='object') SCENE_NAME_BY_ID = data.list.scenes;
          const vis = data.list?.order?.items?.Visible;
          if (Array.isArray(vis)) ORDERED_SCENE_IDS = vis.slice();
        }
        if(Array.isArray(data.pins)){
          pins = data.pins.map((p,idx)=>({
            id: p.id || ('pin_'+(idx+1)+'_'+Math.random().toString(36).slice(2,8)),
            sceneId: GLOBAL_SCENE,
            targetSceneId: p.type==='hotspot' ? (p.sceneId||'') : '',
            kind: p.type==='info' ? 'info' : 'hotspot',
            // INFO: displayText=title(label); HOTSPOT: label from displayName
            displayText: p.type==='info' ? (p.sceneId || '') : (p.displayName || ''),
            xPct: typeof p.x==='string' ? parseFloat(p.x) : p.x,
            yPct: typeof p.y==='string' ? parseFloat(p.y) : p.y,
            payload: {
              // INFO: title=sceneId, body=displayName; HOTSPOT: title=displayName
              title: p.type==='info' ? (p.sceneId || '') : (p.displayName || ''),
              caption: '',
              body:  p.type==='info' ? (p.displayName || '') : '',
              imageUrl: p.image || '',                // filename (or empty)
              imageSize: 360, useHtml:false, transparentPreview:false,
              tour: p.tour
            }
          }));
        }
        renderSceneList(); if(!selectedSceneId && scenes.length) selectScene(scenes[0].id);
        setStatus('Imported '+f.name+' ✓','ok'); toast('Config imported','ok'); renderPins();
      } else setStatus('Invalid JSON','err');
    } catch(e){ console.error(e); setStatus('Import failed','err'); toast('Import failed','err'); }
  };
  i.click();
});

els.btnCopy.addEventListener('click', ()=>{
  const txt=JSON.stringify(exportToMapConfigJSON(),null,2);
  navigator.clipboard.writeText(txt).then(()=>{ setStatus('Config copied','ok'); toast('Config copied','ok'); }).catch(()=>{ setStatus('Copy failed','err'); toast('Copy failed','err'); });
});

/* ---------- Controls ---------- */
function save(){
  if(activePinId){
    const pin=pins.find(p=>p.id===activePinId);
    if(pin) pin.payload=toPayload();
    toast(pin?.kind==='info' ? 'Info saved' : 'Hotspot saved', 'ok');
  } else {
    toast('Nothing selected to save','warn');
  }
  setStatus('Saved ✓','ok');
}
els.btnSave.addEventListener('click', save);
els.btnSaveTop.addEventListener('click', save);

// Add Hotspot -> center once
els.btnAddHotspot.replaceWith(els.btnAddHotspot.cloneNode(true));
els.btnAddHotspot = $('#btnAddHotspot');
els.btnAddHotspot.addEventListener('click', ()=>{
  const target = (els.inpSceneId.value || selectedSceneId || '').trim();
  const label  = (els.inpDisplay.value || SCENE_NAME_BY_ID[target] || target || '').trim();
  const id = createPinPercent(50, 50, 'hotspot', target, label, true);
  addHotspotToList(target, label);
  selectPin(id);
  setStatus('Hotspot placed at center','ok');
  toast('Hotspot added','ok');
  els.selKind.value='hotspot'; updateInfoEnabled();
});

// Add Info -> center once
els.btnAddInfo.replaceWith(els.btnAddInfo.cloneNode(true));
els.btnAddInfo = $('#btnAddInfo');
els.btnAddInfo.addEventListener('click', ()=>{
  const label = (els.inpDisplay.value || els.title.value || '').trim();
  const id = createPinPercent(50, 50, 'info', '', label, true);
  selectPin(id);
  setStatus('Info placed at center','ok');
  toast('Info added','ok');
  els.selKind.value='info'; updateInfoEnabled();
});

els.btnResetPins.addEventListener('click', ()=>{ resetPinsForCurrentScene(); setStatus('Pins reset'); toast('Pins cleared','ok'); });
els.btnDelete.addEventListener('click', ()=>{
  if(!activePinId) return;
  pins = pins.filter(p=>p.id!==activePinId);
  activePinId=null; els.pinTag.textContent='—'; renderPins(); setStatus('Deleted','ok'); toast('Pin deleted','ok');
});
els.sceneSearch.addEventListener('input', renderSceneList);
els.btnPickData.addEventListener('click', ()=> els.dataPicker.click());
els.dataPicker.addEventListener('change', async ()=>{
  const f=els.dataPicker.files?.[0]; if(!f) return;
  try{ APP_DATA=await loadDataJsFromFile(f); await initFromAppData('file'); setStatus('Loaded data.js from file ✓','ok'); toast('data.js loaded','ok'); }
  catch(e){ console.error(e); setStatus('Failed to load data.js','err'); toast('Load failed','err'); }
});

/* ---------- Boot ---------- */
window.addEventListener('keydown', e=>{
  if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='s'){ e.preventDefault(); save(); }
  if(e.key==='Escape'){ e.preventDefault(); setStatus('Mode: idle'); }
});
(async function boot(){
  const u=new URL(location.href); let dataUrl=u.searchParams.get('data') || '../data.js';
  try{
    await loadDataJsFromUrl(dataUrl);
    APP_DATA = window.APP_DATA || window.app_data || APP_DATA;
    if(!APP_DATA) throw new Error('APP_DATA not found');
    await initFromAppData('url');
    setStatus('Loaded '+dataUrl+' ✓','ok');
  } catch(e){ console.error(e); setStatus('Failed to load '+dataUrl+' — click “Load data.js”.','err'); }
  if(!els.mapUrlGlobal.value) els.mapUrlGlobal.value='../assets/new-cemetery-map.png';
  if(els.mapUrlGlobal.value) els.mapImg.src=els.mapUrlGlobal.value; // triggers onImageLoad
  updateInfoEnabled();
})();

async function initFromAppData(){
  scenes = extractScenesFromAPP();

  const cfg = await tryLoadMapConfig('../map_config.json');
  if(cfg){
    if(cfg.list){ 
      MAP_LIST_BLOCK = cfg.list;                                    // preserve verbatim
      if(cfg.list.scenes && typeof cfg.list.scenes==='object') SCENE_NAME_BY_ID=cfg.list.scenes;
      const vis = cfg.list?.order?.items?.Visible;
      if (Array.isArray(vis)) ORDERED_SCENE_IDS = vis.slice();
    }
    if(Array.isArray(cfg.pins)){
      pins = cfg.pins.map((p,idx)=>({
        id: p.id || ('pin_'+(idx+1)+'_'+Math.random().toString(36).slice(2,8)),
        sceneId: GLOBAL_SCENE,
        targetSceneId: p.type==='hotspot' ? (p.sceneId||'') : '',
        kind: p.type==='info' ? 'info' : 'hotspot',
        // INFO: displayText=title(label); HOTSPOT: label from displayName
        displayText: p.type==='info' ? (p.sceneId || '') : (p.displayName || ''),
        xPct: typeof p.x==='string' ? parseFloat(p.x) : p.x,
        yPct: typeof p.y==='string' ? parseFloat(p.y) : p.y,
        payload: {
          // INFO: title=sceneId, body=displayName; HOTSPOT: title=displayName
          title: p.type==='info' ? (p.sceneId || '') : (p.displayName || ''),
          caption: '',
          body:  p.type==='info' ? (p.displayName || '') : '',
          imageUrl: p.image || '',                // filename (or empty)
          imageSize: 360, useHtml:false, transparentPreview:false,
          tour: p.tour
        }
      }));
    }
  }

  renderSceneList();
  if(!selectedSceneId && scenes.length) selectScene(scenes[0].id);

  const url=els.mapUrlGlobal.value.trim();
  if(url) els.mapImg.src=url; // onImageLoad -> fitToHeight()
  else fitToHeight();
}
