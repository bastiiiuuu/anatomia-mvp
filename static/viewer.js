import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { AnatomyMaterials, visualMode } from './materials.js';
import { AnatomyBatches } from './batch-renderer.js';
import { DemandFrames, AdaptiveResolution } from './performance.js';
import { AtlasData } from './data-source.js';

const elements = new Map();
const $ = id => { if (!elements.has(id)) elements.set(id, document.getElementById(id)); return elements.get(id); };
const siteBase=new URL('../',import.meta.url);
const data=new AtlasData({base:siteBase,runtime:document.documentElement.dataset.runtime||'api',json:getJSON,signal:null});
const viewport = $('viewport');
const stage = $('render-stage');
const state = {
  selected: null, isolated: false, hidden: new Set(),
  layers: { oseo: true, articular: false, muscular: false, cartilago: true, otro: false },
  region: 'all', xray: false,
  entries: new Map(), flight: null, ready: false,
  needsRender: true,
  autoIsolatedMuscle: false,
  muscleStudy: true, section: 'all', group: 'all', side: 'both', sectionContext: 'hide',
  loading:false,
};
let renderer, scene, camera, controls, root, allBox, overallRadius = 4, metadata;
let frames, resolution, batches, resizeObserver, intersectionObserver, activeGesture=false, inViewport=true;
const materials = new AnatomyMaterials();
const lifecycle = new AbortController();
const cleanup = [];
const mobile = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
const diagnostics = { picks: 0, pickMs: 0, testedMeshes: 0, appearanceMs: 0, requests: 0, disposed: false };
const on = (target, type, callback, options = {}) => {
  if (target === controls) { target.addEventListener(type, callback); cleanup.push(() => target.removeEventListener(type, callback)); }
  else target.addEventListener(type, callback, { ...options, signal: lifecycle.signal });
};
const requestRender = () => { state.needsRender = true; frames?.request(); };
let renderWidth=1, renderHeight=1, labelWidth=0, labelHeight=0, labelDirty=true, lastLabelTransform='';
let lastConnectorPosition='';
const cameraDirection = new THREE.Vector3(), labelDirection = new THREE.Vector3(), boxHit = new THREE.Vector3();
const visibleEntries = [];
let hasGhostContext=false;
let listMatches=[], listPage=0;
const PAGE_SIZE=40;
let studyController, studySequence=0, searchTimer, wikiTimer;
const studyCache=new Map();
const loadedAssets=new Set(),assetPromises=new Map(),recordAssets=new Map(),layerAssets=new Map();
let assetPipeline=Promise.resolve(),pendingAssets=0,selectionSequence=0;
const regionBoxes = new Map();
let wikiController, wikiSequence = 0;
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const labelPoint = new THREE.Vector3();
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

function announce(message) { $('status').textContent = message; }

async function getJSON(url, signal, timeout=15000) {
  diagnostics.requests++;
  const controller=new AbortController(),abort=()=>controller.abort(signal.reason);
  if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>controller.abort(new DOMException('La consulta tardó demasiado.','TimeoutError')),timeout);
  try {
    const response = await fetch(url, {signal:controller.signal});
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
    return await response.json();
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}

function cancellable(promise,signal) {
  if(signal.aborted)return Promise.reject(signal.reason);
  return new Promise((resolve,reject)=>{
    const abort=()=>reject(signal.reason||new DOMException('Carga cancelada','AbortError'));
    signal.addEventListener('abort',abort,{once:true});
    promise.then(value=>{signal.removeEventListener('abort',abort);resolve(value)},error=>{signal.removeEventListener('abort',abort);reject(error)});
  });
}

async function fetchModel(asset,onProgress) {
  const response=await fetch(data.url(asset.url),{signal:lifecycle.signal});
  if(!response.ok)throw new Error('No se pudo descargar la capa anatómica (HTTP '+response.status+').');
  if(!response.body)return response.arrayBuffer();
  const reader=response.body.getReader(),bytes=new Uint8Array(asset.bytes);let offset=0;
  try {
    while(true){const {value,done}=await reader.read();if(done)break;
      if(offset+value.byteLength>bytes.length)throw new Error('El modelo y el catálogo tienen versiones distintas. Recarga la página.');
      bytes.set(value,offset);offset+=value.byteLength;onProgress(offset);
    }
    if(offset!==asset.bytes)throw new Error('La descarga del modelo quedó incompleta. Recarga la página.');
    return bytes.buffer;
  }catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
}

function setupScene() {
  renderer = new THREE.WebGLRenderer({ antialias: !mobile, alpha: true, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = false;
  resolution = new AdaptiveResolution(renderer, stage, mobile);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  stage.prepend(renderer.domElement);
  renderer.domElement.setAttribute('aria-label', 'Modelo 3D. También puedes seleccionar piezas desde la lista de estructuras.');
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(38, 1, 0.01, 1000);
  camera.position.set(6, 3.2, 12);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.enablePan = true;
  frames = new DemandFrames(render);
  on(controls, 'start', () => { state.flight = null; activeGesture=true; requestRender(); });
  on(controls, 'end', () => { activeGesture=false; requestRender(); });
  on(controls, 'change', requestRender);
  scene.add(new THREE.HemisphereLight(0xd7edff, 0x27323e, 1.6));
  const key = new THREE.DirectionalLight(0xfff4ea, 2.6);
  key.position.set(-5, 8, 7); scene.add(key);
  const fill = new THREE.DirectionalLight(0xa5caff, 1.4);
  fill.position.set(5, 2, -5); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xafe7db, 1.6);
  rim.position.set(2, -3, 4); scene.add(rim);
  resizeObserver = new ResizeObserver(() => {
    const { width, height } = stage.getBoundingClientRect();
    if(width<1||height<1)return;
    renderWidth=Math.round(width);renderHeight=Math.round(height);labelDirty=true;
    resolution.resize(); renderer.setSize(renderWidth, renderHeight, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (state.ready && allBox) {
      fitBox(state.selected ? state.entries.get(state.selected).box : currentRegionBox(), null, true);
    }
    requestRender();
  });
  resizeObserver.observe(stage);
  intersectionObserver=new IntersectionObserver(entries=>{inViewport=entries[0].isIntersecting;updateActivity();},{threshold:0});
  intersectionObserver.observe(viewport);
  on(document,'visibilitychange',updateActivity);
  on(window,'pagehide',event=>{if(event.persisted)frames.pause();else disposeViewer();});
  on(window,'pageshow',updateActivity);
  on(renderer.domElement,'webglcontextlost',event=>{event.preventDefault();frames.pause();announce('Restaurando el contexto gráfico…');});
  on(renderer.domElement,'webglcontextrestored',()=>{resolution.setMode($('render-quality').value);updateActivity();requestRender();});
  let start = null;
  const pointers = new Set();
  on(renderer.domElement,'pointerdown', event => {
    pointers.add(event.pointerId);
    if(pointers.size>1){start=null;return;}
    if (event.isPrimary && event.button === 0) start = { x: event.clientX, y: event.clientY };
  }, {passive:true});
  on(renderer.domElement,'pointercancel',event => { pointers.delete(event.pointerId);start = null; }, {passive:true});
  on(renderer.domElement,'pointerup', event => {
    pointers.delete(event.pointerId);
    const down = start; start = null;
    if (!down || !state.ready || event.button !== 0 ||
        Math.hypot(event.clientX - down.x, event.clientY - down.y) > 6) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1,
                -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = pickStructure();
    if (hit) selectStructure(hit.object.userData.anatomyId, false);
    else if(state.selected){clearSelection();applyAppearance();}
  }, {passive:true});
}

function updateActivity() {
  if (!frames || diagnostics.disposed) return;
  if(document.hidden||!inViewport){if(state.flight&&!state.flight.pausedAt)state.flight.pausedAt=performance.now();resolution.lastTime=0;frames.pause();}
  else {
    if(state.flight?.pausedAt){state.flight.start+=performance.now()-state.flight.pausedAt;delete state.flight.pausedAt;}
    frames.resume();
  }
}

function pickStructure() {
  const start=performance.now();diagnostics.picks++;diagnostics.testedMeshes=0;
  const candidates=[];
  for(const entry of visibleEntries) {
    if(!raycaster.ray.intersectBox(entry.box,boxHit))continue;
    candidates.push({entry,distance:entry.box.containsPoint(raycaster.ray.origin)?0:raycaster.ray.origin.distanceTo(boxHit)});
  }
  candidates.sort((a,b)=>a.distance-b.distance);
  const preferSelected=state.isolated&&$('isolate-mode').value==='xray';
  const preferOpaque=state.xray||state.sectionContext==='ghost'||hasGhostContext;
  let best=null,opaque=null,selected=null;
  for(const {entry,distance} of candidates) {
    const limit=preferSelected?(selected?.distance??Infinity):preferOpaque?(opaque?.distance??Infinity):(best?.distance??Infinity);
    if(distance>limit)continue;
    for(const mesh of entry.meshes)if(mesh.visible) {
      diagnostics.testedMeshes++;
      const hits=[];mesh.raycast(raycaster,hits);
      for(const hit of hits) {
        if(!best||hit.distance<best.distance)best=hit;
        if(mesh.userData.visualMode!=='ghost'&&(!opaque||hit.distance<opaque.distance))opaque=hit;
        if(entry.record.Mesh_ID===state.selected&&(!selected||hit.distance<selected.distance))selected=hit;
      }
    }
  }
  diagnostics.pickMs=performance.now()-start;
  return (preferSelected&&selected)||(preferOpaque&&opaque)||best;
}

function disposeViewer() {
  if(diagnostics.disposed)return;
  diagnostics.disposed=true;lifecycle.abort();frames?.dispose();resizeObserver?.disconnect();intersectionObserver?.disconnect();
  studyController?.abort();wikiController?.abort();clearTimeout(searchTimer);clearTimeout(wikiTimer);
  for(const fn of cleanup)fn();controls?.dispose();batches?.dispose();
  cleanup.length=0;
  const geometries=new Set();
  for(const entry of state.entries.values())for(const mesh of entry.meshes)geometries.add(mesh.geometry);
  scene?.traverse(object=>{if(object.geometry)geometries.add(object.geometry);});
  for(const geometry of geometries)geometry.dispose();
  scene?.traverse(object=>{if(!object.isMesh&&object.material)for(const material of [].concat(object.material))material.dispose();});
  materials.dispose();renderer?.renderLists.dispose();renderer?.dispose();renderer?.forceContextLoss();renderer?.domElement.remove();
  root?.traverse(object=>{if(object.geometry&&!geometries.has(object.geometry))object.geometry.dispose();});
  root?.clear();scene?.clear();state.entries.clear();visibleEntries.length=0;studyCache.clear();listMatches=[];regionBoxes.clear();elements.clear();
  loadedAssets.clear();assetPromises.clear();recordAssets.clear();layerAssets.clear();data.dispose();
  state.ready=false;state.flight=null;
}

async function loadModel(assets) {
  const body = root || new THREE.Group(); body.name = 'Z-Anatomy · atlas real';
  const records = new Map(metadata.structures.map(s => [s.Mesh_ID, s]));
  const colors = { oseo: 0xd9c9b1, muscular: 0xb85c66, articular: 0x76c5c9, cartilago: 0x8eaecb, otro: 0x9ca7a5 };
  const draco = new DRACOLoader(); draco.setDecoderPath(data.url('static/vendor/draco/')); draco.setWorkerLimit(2);
  const loader = new GLTFLoader(); loader.setDRACOLoader(draco);
  const total = assets.reduce((n, a) => n + a.bytes, 0);
  let completed = 0;
  const fallbackMaterials=new Map();
  try {
    for (const asset of assets) {
      const buffer=await fetchModel(asset,loaded=>{
        const progress=Math.min(99,Math.round((completed+loaded)/total*100));
        $('loading').querySelector('span').textContent=`Cargando atlas real… ${progress} %`;$('loading-progress').value=progress;
      });
      const gltf=await cancellable(loader.parseAsync(buffer,data.url('static/models/')),lifecycle.signal);
      gltf.scene.name = asset.key;
      gltf.scene.traverse(object => {
        if (!object.isMesh) return;
        for(const original of [].concat(object.material))materials.register(original);
        // The parser retains ORIGINAL node indices even when it sanitizes/renames objects.
        let owner = object; let nodeIndex;
        while (owner && nodeIndex === undefined) {
          nodeIndex = gltf.parser.associations.get(owner)?.nodes;
          owner = owner.parent;
        }
        const id = asset.node_bindings[String(nodeIndex)];
        if (!id) {
          if (!(String(nodeIndex) in asset.excluded_nodes)) throw new Error(`Nodo ${nodeIndex} de ${asset.key} sin identidad anatómica.`);
          object.visible = false; object.userData.anatomyExcluded = true; return;
        }
        const record = records.get(id);
        object.userData.Mesh_ID = id; object.userData.asset = asset.key; object.userData.originalNodeIndex = nodeIndex;
        object.name = record.nombre;
        const originals = [].concat(object.material).map(original=>{
          if(asset.key!=='articular')return original;
          const key=`${original.uuid}:${record.capa}`;
          if(!fallbackMaterials.has(key)) {
            const fallback=original.clone();fallback.color.setHex(colors[record.capa]);fallback.side=THREE.DoubleSide;
            fallbackMaterials.set(key,materials.register(fallback));
          }
          return fallbackMaterials.get(key);
        });
        // GLTFLoader already shares materials. Preserve muscle color/roughness/maps exactly.
        for(const original of originals) {
          materials.register(original);
        }
        object.userData.sourceMaterials=originals;
        object.material=Array.isArray(object.material)?originals:originals[0];
      });
      body.add(gltf.scene); completed += asset.bytes;loadedAssets.add(asset.key);
      await new Promise(requestAnimationFrame);
    }
    return body;
  } finally { draco.dispose(); }
}

function ensureAsset(key) {
  if(assetPromises.has(key))return assetPromises.get(key);
  if(loadedAssets.has(key))return Promise.resolve();
  const asset=metadata.model.assets.find(a=>a.key===key);
  if(!asset)return Promise.reject(new Error('Capa anatómica desconocida'));
  state.loading=true;pendingAssets++;announce('Cargando la capa anatómica…');
  const promise=assetPipeline.then(async()=>{
    await loadModel([asset]);indexModel();await batches.build(state.entries);applyAppearance();
  }).finally(()=>{pendingAssets--;state.loading=pendingAssets>0;});
  assetPromises.set(key,promise);
  assetPipeline=promise.catch(()=>{});
  promise.catch(()=>assetPromises.delete(key));
  return promise;
}

async function ensureLayers(layers) {
  const assets=new Set();for(const [layer,enabled] of Object.entries(layers))if(enabled)for(const key of layerAssets.get(layer)||[])assets.add(key);
  await Promise.all([...assets].map(ensureAsset));
}

function indexModel() {
  const records = new Map(metadata.structures.map(s => [s.Mesh_ID, s]));
  for (const record of records.values()) {
    if(state.entries.has(record.Mesh_ID))continue;
    state.entries.set(record.Mesh_ID, { record, meshes: [], box: new THREE.Box3(), row: null,
      searchNames: [record.nombre, record.nombre_oficial_ta2||'', ...record.aliases].map(normalized) });
  }
  const unmapped = [];
  root.updateMatrixWorld(true);
  root.traverse(object => {
    if (!object.isMesh || object.userData.anatomyExcluded || object.userData.indexed) return;
    let owner = object;
    let id;
    // IDs come from the GLB parser's original node index, including laterality.
    while (owner && !id) {
      const candidate = owner.userData.Mesh_ID || owner.name;
      if (records.has(candidate)) id = candidate;
      owner = owner.parent;
    }
    if (!id) { unmapped.push(object.name); return; }
    object.userData.anatomyId = id;
    if(!object.geometry.boundingBox)object.geometry.computeBoundingBox();
    if(!object.geometry.boundingSphere)object.geometry.boundingSphere=object.geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
    object.userData.indexed=true;
    const entry = state.entries.get(id); entry.meshes.push(object);
    object.userData.worldBox=object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld);
    entry.box.union(object.userData.worldBox);
  });
  const expected=new Set(metadata.model.assets.filter(a=>loadedAssets.has(a.key)).flatMap(a=>Object.values(a.node_bindings)));
  const missing = [...state.entries.values()].filter(e => expected.has(e.record.Mesh_ID)&&!e.meshes.length).map(e => e.record.Mesh_ID);
  if (missing.length || unmapped.length) {
    throw new Error(`Geometría/catálogo incompatibles. IDs sin geometría: ${missing.slice(0, 5).join(', ') || 'ninguno'}. Mallas sin ficha: ${unmapped.slice(0, 5).join(', ') || 'ninguna'}. Revisa las recetas y sus IDs.`);
  }
  allBox = new THREE.Box3();
  regionBoxes.clear();
  for (const entry of state.entries.values()) {
    if(!entry.meshes.length)continue;
    entry.center=entry.box.getCenter(new THREE.Vector3());
    allBox.union(entry.box);
    const key = entry.record.view_region;
    if (!regionBoxes.has(key)) regionBoxes.set(key, new THREE.Box3());
    regionBoxes.get(key).union(entry.box);
  }
  if (allBox.isEmpty()) throw new Error('El modelo no contiene estructuras seleccionables.');
  const center = allBox.getCenter(new THREE.Vector3());
  overallRadius = Math.max(allBox.getBoundingSphere(new THREE.Sphere()).radius, 0.01);
  // Grid scales with dataset bounds and never belongs to the selectable anatomy.
  if(!scene.getObjectByName('Suelo anatómico')) {
  const grid = new THREE.GridHelper(overallRadius * 3, 24, 0x375063, 0x26384b);grid.name='Suelo anatómico';
  grid.position.set(center.x, allBox.min.y - overallRadius * .025, center.z);
  grid.material.transparent = true; grid.material.opacity = .28; grid.material.depthWrite = false;
  scene.add(grid);
  }
  controls.minDistance = overallRadius * .005;
  controls.maxDistance = overallRadius * 20;
  camera.near = Math.max(overallRadius / 10000, .00001);
  camera.far = overallRadius * 100;
  camera.updateProjectionMatrix();
}

function buildList() {
  $('structure-count').textContent = String(state.entries.size).padStart(2, '0');
  on($('structure-list'),'click',event=>{
    const row=event.target.closest('[data-mesh-id]');if(row)selectStructure(row.dataset.meshId,true);
  });
  on($('list-prev'),'click',()=>{listPage--;renderListPage();});
  on($('list-next'),'click',()=>{listPage++;renderListPage();});
  const hasOther = [...state.entries.values()].some(e => !['oseo', 'articular', 'muscular', 'cartilago'].includes(e.record.capa));
  $('other-layer').hidden = !hasOther; $('layer-count').textContent = hasOther ? '05' : '04';
}

function renderListPage() {
  for(const entry of state.entries.values())entry.row=null;
  const pages=Math.max(1,Math.ceil(listMatches.length/PAGE_SIZE));
  listPage=Math.max(0,Math.min(listPage,pages-1));
  const fragment = document.createDocumentFragment();
  for (const entry of listMatches.slice(listPage*PAGE_SIZE,(listPage+1)*PAGE_SIZE)) {
    const id=entry.record.Mesh_ID;
    const row = document.createElement('button');
    row.className = 'structure-item'; row.dataset.layer = entry.record.capa;
    row.dataset.meshId = id; row.setAttribute('aria-pressed', 'false');
    const dot = document.createElement('i');
    const name = document.createElement('span'); name.textContent = entry.record.nombre;
    const arrow = document.createElement('small'); arrow.textContent = '↗';
    row.append(dot, name, arrow);
    row.classList.toggle('active',id===state.selected);row.classList.toggle('invisible',!entry.visible);
    row.setAttribute('aria-pressed',String(id===state.selected));
    entry.row = row; fragment.append(row);
  }
  $('structure-list').replaceChildren(fragment);
  $('structure-list').scrollTop=0;
  $('list-pager').hidden=pages===1;$('list-prev').disabled=listPage===0;$('list-next').disabled=listPage===pages-1;
  $('list-page').textContent=`${listPage+1} / ${pages}`;
}

function layerOf(entry) { return entry.record.capa in state.layers ? entry.record.capa : 'otro'; }

function inStudySection(entry) {
  const s = entry.record;
  return s.capa === 'muscular' && (state.section === 'all' || s.study_section === state.section) &&
    (state.group === 'all' || s.study_group === state.group) &&
    (state.side === 'both' || s.side === state.side || s.side === 'midline');
}

function sectionBox(includeHidden=false) {
  const box = new THREE.Box3();
  for (const entry of state.entries.values()) {
    if (inStudySection(entry) && (includeHidden||!state.hidden.has(entry.record.Mesh_ID))) box.union(entry.box);
  }
  return box.isEmpty() ? null : box;
}

function currentRegionBox() {
  return (state.muscleStudy && sectionBox()) || regionBoxes.get(state.region) || allBox;
}

function syncStudyUI() {
  $('muscle-study').hidden = !state.muscleStudy;
  $('muscle-section').value = state.section;
  $('muscle-group').value = state.group;
  document.querySelectorAll('[data-side]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.side === state.side)));
  const entries = [...state.entries.values()].filter(inStudySection);
  const label = metadata.model.muscle_sections[state.section]?.label || 'Cuerpo completo';
  $('region-select').value=state.muscleStudy?(state.section==='all'?'all':'muscle:'+state.section):state.region;
  $('section-summary').textContent = `${entries.length} piezas musculares · ${label}${state.side === 'both' ? '' : state.side === 'L' ? ' · izquierdo' : ' · derecho'}`;
  $('scene-title').textContent = (state.muscleStudy ? label : metadata.model.regions[state.region]).toUpperCase();
  $('return-section').hidden = !(state.muscleStudy && state.selected && state.isolated);
  $('focus-section').hidden = !state.muscleStudy || state.isolated;
  $('restore-section').hidden = !entries.some(e => state.hidden.has(e.record.Mesh_ID));
  document.querySelectorAll('[data-preset]').forEach(button => {
    const p = button.dataset.preset;
    const active = p === 'muscles' ? state.muscleStudy : p === 'bones' ? state.layers.oseo && !state.layers.muscular && !state.layers.articular :
      p === 'joints' ? state.layers.articular && !state.layers.muscular && !state.layers.oseo : state.layers.muscular && state.layers.oseo;
    button.setAttribute('aria-pressed', String(active));
  });
}

function updateGroups() {
  const groups = metadata.model.muscle_sections[state.section]?.groups || {};
  $('muscle-group').replaceChildren(new Option('Todos los grupos', 'all'),
    ...Object.entries(groups).map(([id, label]) => new Option(label, id)));
  $('muscle-group').disabled = state.section === 'all';
  $('muscle-group').value = state.group;
}

function clearSelection() {
  selectionSequence++;
  state.selected = null; state.isolated = false; state.xray = false; state.autoIsolatedMuscle = false;
  $('study').hidden = true; $('empty-study').hidden = false; $('floating-label').hidden = true;
  $('label-connector').setAttribute('hidden','');
  wikiController?.abort(); wikiSequence++;studyController?.abort();studySequence++;clearTimeout(wikiTimer);
  $('wiki-title').textContent = 'Texto enciclopédico de la estructura';
  $('wiki-status').textContent = 'Selecciona un músculo para consultar su resumen.';
  $('wiki-extract').textContent = ''; $('wiki-license').textContent = ''; $('wiki-link').hidden = true;
}

function focusSection(clear = true) {
  if (clear) clearSelection();
  const box = sectionBox();
  refreshList(); applyAppearance();
  if (box) fitBox(box, studyDirection());
  else announce('No hay piezas en esta combinación. Prueba otro grupo o lado.');
}

function studyDirection(record = null) {
  const section = record?.study_section || state.section;
  const group = record?.study_group || state.group;
  const posterior = section === 'back' || group.includes('posterior') || group.startsWith('gluteal') ||
    (section === 'pelvis' && group === 'all');
  return new THREE.Vector3(.04, .02, posterior ? -1 : 1).normalize();
}

function closePanels() {
  document.body.classList.remove('explorer-open', 'study-open');
  $('toggle-explorer').setAttribute('aria-expanded', String(matchMedia('(min-width: 901px) and (max-width: 1200px)').matches && !document.body.classList.contains('explorer-collapsed')));
  $('toggle-study').setAttribute('aria-expanded', 'false');
}

function normalized(text) {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function refreshList() {
  const terms = normalized($('structure-filter').value).split(/\s+/).filter(Boolean);
  listMatches=[];listPage=0;
  for (const entry of state.entries.values()) {
    const regionMatches = state.region === 'all' || entry.record.view_region === state.region;
    const matches = entry.searchNames.some(name => terms.every(term => name.includes(term)));
    if(regionMatches&&matches&&(!state.muscleStudy||inStudySection(entry)))listMatches.push(entry);
  }
  $('filter-count').textContent = `${listMatches.length} coincidencias · Enter enfoca la primera`;
  renderListPage();
}

async function loadWikipedia(record) {
  wikiController?.abort(); wikiController = new AbortController();
  const current = ++wikiSequence;
  $('wiki-title').textContent = record.nombre;
  $('wiki-status').textContent = 'Consultando Wikipedia en español…';
  $('wiki-extract').textContent = ''; $('wiki-license').textContent = ''; $('wiki-link').hidden = true;
  try {
    const result = await data.wikipedia(record.Mesh_ID, wikiController.signal);
    if (current !== wikiSequence) return;
    $('wiki-status').textContent = result.status === 'ok'
      ? `Artículo: ${result.title} · ${result.cached ? 'caché en memoria' : 'consulta en línea'}${result.revision ? ' · revisión ' + result.revision : ''}`
      : result.message;
    $('wiki-extract').textContent = result.extract;
    $('wiki-link').href = result.url; $('wiki-link').hidden = result.status === 'not_mapped';
    $('wiki-license').textContent = result.license + ' · consulta autores e historial en el artículo. Texto distinto de las notas locales.';
  } catch (error) {
    if (error.name !== 'AbortError' && current === wikiSequence) {
      $('wiki-status').textContent = 'No se pudo consultar Wikipedia. La ficha anatómica local sigue disponible.';
    }
  }
}

function applyAppearance() {
  const start=performance.now();
  visibleEntries.length=0;
  hasGhostContext=false;
  const studyBox=state.muscleStudy?sectionBox(true):null;
  let count = 0;
  for (const [id, entry] of state.entries) {
    const selected = id === state.selected;
    const anatomicalContext=state.muscleStudy&&layerOf(entry)!=='muscular'&&studyBox&&entry.box.intersectsBox(studyBox)&&
      (state.side==='both'||entry.record.side===state.side||entry.record.side==='midline');
    const outsideSection = state.muscleStudy && !inStudySection(entry) && !anatomicalContext;
    const context = (state.isolated && !selected) || (outsideSection && state.sectionContext === 'ghost') ||
      (state.xray && !selected && ['oseo', 'muscular'].includes(layerOf(entry))) || (anatomicalContext&&!selected);
    const visible = entry.meshes.length>0 && !state.hidden.has(id) && state.layers[layerOf(entry)] &&
      !(outsideSection && state.sectionContext === 'hide' && !selected) &&
      !(state.isolated && !selected && $('isolate-mode').value === 'hide');
    entry.visible=!!visible;
    if (visible) {count++;visibleEntries.push(entry);}
    const mode=visualMode({selected:visible&&selected,isolated:state.isolated,context:visible&&context});
    if(visible&&mode==='ghost')hasGhostContext=true;
    for (const mesh of entry.meshes) {
      mesh.visible = visible;
      if(mesh.userData.visualMode!==mode) {
        const variants=mesh.userData.sourceMaterials.map(source=>materials.get(source,mode));
        mesh.material=Array.isArray(mesh.material)?variants:variants[0];mesh.userData.visualMode=mode;
      }
    }
    entry.row?.classList.toggle('active', selected);
    entry.row?.classList.toggle('invisible', !visible);
    entry.row?.setAttribute('aria-pressed', String(selected));
  }
  $('visible-count').textContent = `${count} / ${state.entries.size} estructuras visibles`;
  $('isolate').setAttribute('aria-pressed', String(state.isolated));
  $('global-xray').setAttribute('aria-pressed', String(state.isolated || state.xray));
  $('isolate').firstChild.textContent = state.isolated ? 'Salir de aislamiento ' : 'Aislar ';
  $('hide-piece').firstChild.textContent = state.hidden.has(state.selected) ? 'Mostrar pieza ' : 'Ocultar pieza ';
  syncStudyUI();
  batches?.update(state.entries,state.selected);
  diagnostics.appearanceMs=performance.now()-start;
  requestRender();
}

async function selectStructure(id, fly = false) {
  const sequence=++selectionSequence;
  const entry = state.entries.get(id);
  if (!entry) { announce('La estructura no está disponible en este modelo.'); return; }
  if(!entry.meshes.length) {
    try{await ensureAsset(recordAssets.get(id));}catch{announce('No se pudo cargar esta capa. Vuelve a seleccionar la pieza.');return;}
    if(sequence!==selectionSequence)return;
  }
  const s = entry.record;
  if (state.muscleStudy && layerOf(entry) !== 'muscular') {
    state.muscleStudy = false; refreshList();
  } else if (state.muscleStudy && !inStudySection(entry)) {
    state.section = s.study_section || 'all'; state.group = 'all';
    if (state.side !== 'both' && s.side !== 'midline') state.side = s.side;
    updateGroups(); refreshList();
  }
  state.selected = id;
  state.hidden.delete(id);
  const layer = layerOf(entry); state.layers[layer] = true;
  if (layer === 'muscular' && $('auto-isolate-muscle').checked) {
    state.isolated = true; state.xray = false; state.autoIsolatedMuscle = true;
    // Keep the chosen isolation mode: hidden or a translucent anatomical context.
  } else if (state.autoIsolatedMuscle) {
    state.isolated = false; state.autoIsolatedMuscle = false;
  }
  document.querySelector(`[data-layer="${layer}"]`).checked = true;
  $('empty-study').hidden = true; $('study').hidden = false;
  showStudy(studyCache.get(id)||s);
  loadStudy(id);
  labelDirty=true;
  $('floating-label').querySelector('span').textContent = s.nombre;
  if (state.region !== 'all' && state.region !== s.view_region) {
    state.region = s.view_region; $('region-select').value = state.region; refreshList();
  }
  applyAppearance();
  clearTimeout(wikiTimer);wikiController?.abort();wikiSequence++;
  $('wiki-title').textContent=s.nombre;$('wiki-status').textContent='Consultando Wikipedia en español…';$('wiki-extract').textContent='';$('wiki-license').textContent='';$('wiki-link').hidden=true;
  wikiTimer=setTimeout(()=>loadWikipedia(s),120);
  if (fly || state.autoIsolatedMuscle) fitBox(entry.box, layer === 'muscular' ? studyDirection(s) : null);
  closePanels();
  announce(`${s.nombre} seleccionada`);
}


function showStudy(s) {
  const id=s.Mesh_ID, layer=s.capa, pending='Cargando ficha anatómica…';
  const fields = { 'study-name': s.nombre, 'study-latin': s.nombre_oficial_ta2 || s.nombre_original,
    'study-system': s.sistema_label || s.sistema, 'study-region': s.region, 'study-description': s.descripcion||pending,
    'study-insertions': s.inserciones_articulaciones||pending, 'study-function': s.funcion||pending,
    'study-origin': s.origen||pending, 'study-insertion': s.insercion||pending, 'study-innervation': s.inervacion||pending,
    'study-id': id, 'study-type': layer === 'oseo' ? (s.subtype === 'diente' ? 'Diente' : 'Hueso') : layer === 'muscular' ? 'Músculo' : layer === 'articular' ? (s.subtype === 'tendon' ? 'Tendón' : s.subtype === 'capsula' ? 'Cápsula articular' : 'Ligamento / tejido conectivo') : layer === 'cartilago' ? 'Cartílago / disco' : 'Otros tejidos',
    'study-revision': s.revision?`Estado: ${s.revision.replaceAll('_', ' ')}. Geometría real del dataset; Wikipedia complementa las notas locales.`:pending };
  for (const [element, content] of Object.entries(fields)) $(element).textContent = content;
  const sources = (s.sources || []).slice();
  if (s.wikipedia_evidence) sources.push({ title: `${s.wikipedia_evidence.title} · Wikipedia (pendiente)`, url: s.wikipedia_evidence.url });
  $('study-sources').replaceChildren(...sources.map(source => {
    const li = document.createElement('li');
    try {
      const url = new URL(source.url);
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error('URL no válida');
      const a = document.createElement('a'); a.textContent = source.title;
      a.href = url.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; li.append(a);
    } catch { li.textContent = source.title || 'Referencia pendiente'; }
    return li;
  }));
}

async function loadStudy(id) {
  studyController?.abort();const sequence=++studySequence;
  if(studyCache.has(id))return;
  studyController=new AbortController();
  try {
    const record=await data.structure(id,studyController.signal);
    if(sequence!==studySequence||state.selected!==id)return;
    studyCache.set(id,record);if(studyCache.size>128)studyCache.delete(studyCache.keys().next().value);
    showStudy(record);
  }catch(error){if(error.name!=='AbortError'&&sequence===studySequence)$('study-description').textContent='No se pudo cargar la ficha. Vuelve a seleccionar la estructura.';}
}

function fitBox(box, direction = null, instant = false) {
  requestRender();
  const center = box.getCenter(new THREE.Vector3());
  const vfov = THREE.MathUtils.degToRad(camera.fov);
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
  const vector = direction || camera.position.clone().sub(controls.target).normalize();
  if (vector.lengthSq() === 0) vector.set(0, .2, 1).normalize();
  vector.normalize();
  const right = new THREE.Vector3().crossVectors(camera.up, vector);
  if (right.lengthSq() < .0001) right.crossVectors(new THREE.Vector3(0, 0, 1), vector);
  right.normalize();
  const up = new THREE.Vector3().crossVectors(vector, right).normalize();
  let distance = overallRadius * .01;
  // Fit all eight Box3 corners in camera coordinates. This avoids wasting portrait
  // width on the radius of a tall full-body bounding sphere.
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const offset = new THREE.Vector3(x, y, z).sub(center);
    const depth = offset.dot(vector);
    distance = Math.max(distance, depth + Math.abs(offset.dot(right)) / Math.tan(hfov / 2),
      depth + Math.abs(offset.dot(up)) / Math.tan(vfov / 2), depth + camera.near * 2);
  }
  distance *= 1.2;
  const destination = center.clone().addScaledVector(vector, distance);
  if (instant || reducedMotion) {
    camera.position.copy(destination); controls.target.copy(center); controls.update(); state.flight = null;
  } else {
    state.flight = { start: performance.now(), from: camera.position.clone(), to: destination,
      fromTarget: controls.target.clone(), toTarget: center, duration: 900 };
  }
}

function reset() {
  state.hidden.clear(); state.isolated = false; state.xray = false;
  state.autoIsolatedMuscle = false;
  clearSelection(); state.muscleStudy = true; state.section = 'all'; state.group = 'all'; state.side = 'both'; updateGroups();
  for (const key of Object.keys(state.layers)) state.layers[key] = metadata.model.default_layers[key] ?? true;
  document.querySelectorAll('[data-layer][type=checkbox]').forEach(input => { input.checked = state.layers[input.dataset.layer]; });
  state.region = 'all'; $('region-select').value = 'all'; $('structure-filter').value = ''; refreshList();
  applyAppearance(); fitBox(allBox, new THREE.Vector3(.08, .02, 1).normalize());
  announce('Vista completa restaurada');
}

function render(now) {
  if(!renderer||diagnostics.disposed)return false;
  if (state.flight) {
    state.needsRender = true;
    const f = state.flight;
    const t = Math.min((now - f.start) / f.duration, 1);
    const ease = t * t * (3 - 2 * t);
    camera.position.lerpVectors(f.from, f.to, ease);
    controls.target.lerpVectors(f.fromTarget, f.toTarget, ease);
    if (t === 1) state.flight = null;
  }
  const controlsChanged=controls.update();
  if (state.needsRender && state.selected && state.ready) {
    const entry = state.entries.get(state.selected);
    labelPoint.copy(entry.center);
    labelDirection.copy(labelPoint).sub(camera.position);
    const inFront = labelDirection.dot(camera.getWorldDirection(cameraDirection)) > 0;
    labelPoint.project(camera);
    const show = entry.meshes.some(m => m.visible) && inFront && Math.abs(labelPoint.x) < 1 &&
      Math.abs(labelPoint.y) < 1 && labelPoint.z >= -1 && labelPoint.z <= 1;
    const label = $('floating-label'); label.hidden = !show;
    const connector=$('label-connector');connector.toggleAttribute('hidden',!show);
    if (show) {
      if(labelDirty){labelWidth=label.offsetWidth;labelHeight=label.offsetHeight;labelDirty=false;}
      const x = Math.round(THREE.MathUtils.clamp((labelPoint.x * .5 + .5) * renderWidth + 18 + stage.offsetLeft, 10, Math.max(10, viewport.clientWidth - labelWidth - 10)));
      const y = Math.round(THREE.MathUtils.clamp((-labelPoint.y * .5 + .5) * renderHeight - 35 + stage.offsetTop, stage.offsetTop, viewport.clientHeight - labelHeight - 10));
      const transform=`translate3d(${x}px, ${y}px, 0)`;
      if(transform!==lastLabelTransform){label.style.transform=transform;lastLabelTransform=transform;}
      const px=(labelPoint.x*.5+.5)*renderWidth+stage.offsetLeft,py=(-labelPoint.y*.5+.5)*renderHeight+stage.offsetTop;
      const position=[Math.round(px),Math.round(py),Math.max(x,Math.min(px,x+labelWidth)),Math.max(y,Math.min(py,y+labelHeight))].join(',');
      if(position!==lastConnectorPosition){
        const line=connector.querySelector('line'),dot=connector.querySelector('circle');
        line.setAttribute('x1',px);line.setAttribute('y1',py);line.setAttribute('x2',Math.max(x,Math.min(px,x+labelWidth)));line.setAttribute('y2',Math.max(y,Math.min(py,y+labelHeight)));
        dot.setAttribute('cx',px);dot.setAttribute('cy',py);lastConnectorPosition=position;
      }
    }
  }
  if (state.needsRender) {
    const start=performance.now();
    renderer.render(scene, camera);
    frames.stats.frames++;
    resolution.sample(now,performance.now()-start,!!state.flight||activeGesture||controlsChanged);
    state.needsRender = false;
  }
  return !!state.flight || controlsChanged;
}

function wireUI() {
  $('layer-options').open = matchMedia('(min-width: 1201px) and (min-height: 900px)').matches;
  $('muscle-section').append(...Object.entries(metadata.model.muscle_sections).map(([id, section]) => new Option(`${section.label} · ${section.count}`, id)));
  const muscleRegions=document.createElement('optgroup');muscleRegions.label='Secciones musculares';
  muscleRegions.append(...Object.entries(metadata.model.muscle_sections).map(([id,section])=>new Option(section.label,'muscle:'+id)));
  $('region-select').append(muscleRegions);
  updateGroups();
  on($('muscle-section'),'change', () => {
    state.section = $('muscle-section').value; state.group = 'all'; state.region = 'all'; $('region-select').value = 'all';
    $('structure-filter').value = ''; updateGroups(); focusSection();
  });
  on($('muscle-group'),'change', () => { state.group = $('muscle-group').value; focusSection(); });
  document.querySelectorAll('[data-side]').forEach(button => on(button,'click', () => { state.side = button.dataset.side; focusSection(); }));
  on($('section-context'),'change', () => { state.sectionContext = $('section-context').value; applyAppearance(); });
  on($('restore-section'),'click', () => {
    for (const entry of state.entries.values()) if (inStudySection(entry)) state.hidden.delete(entry.record.Mesh_ID);
    focusSection();
  });
  for (const id of ['return-section', 'focus-section', 'tablet-section']) on($(id),'click', () => {
    if (state.muscleStudy) focusSection(); else { clearSelection(); applyAppearance(); fitBox(currentRegionBox()); }
    closePanels();
  });
  on($('render-quality'),'change', () => {
    const mode = $('render-quality').value;
    resolution.setMode(mode);requestRender();
  });
  for (const [id, className] of [['toggle-explorer', 'explorer-open'], ['toggle-study', 'study-open']]) {
    on($(id),'click', () => {
      if (id === 'toggle-explorer' && matchMedia('(min-width: 901px)').matches) {
        const collapsed = document.body.classList.toggle('explorer-collapsed');
        closePanels(); $(id).setAttribute('aria-expanded', String(!collapsed)); return;
      }
      const open = !document.body.classList.contains(className); closePanels();
      document.body.classList.toggle(className, open); $(id).setAttribute('aria-expanded', String(open));
    });
  }
  document.querySelectorAll('[data-close-panel]').forEach(button => on(button,'click', closePanels));
  on(document,'keydown', event => { if (event.key === 'Escape') closePanels(); });
  on(matchMedia('(min-width: 901px)'),'change', closePanels);
  closePanels();
  document.querySelectorAll('[data-layer][type=checkbox]').forEach(input => on(input,'change', async () => {
    const enabled=input.checked,layer=input.dataset.layer;
    if(enabled&&layer!=='muscular'&&state.autoIsolatedMuscle){state.isolated=false;state.autoIsolatedMuscle=false;}
    state.layers[layer] = enabled; applyAppearance();
    if(enabled)try{await ensureLayers({[layer]:true});applyAppearance();}catch{state.layers[layer]=false;input.checked=false;applyAppearance();announce('No se pudo cargar esa capa.');}
  }));
  on($('focus'),'click', () => { if (state.selected) fitBox(state.entries.get(state.selected).box); });
  on($('clear-selection'),'click',()=>{clearSelection();applyAppearance();});
  on($('isolate'),'click', () => {
    if (!state.selected) return;
    state.autoIsolatedMuscle = false;
    state.isolated = !state.isolated; applyAppearance();
    announce(state.isolated ? 'Aislamiento activado' : 'Aislamiento desactivado');
  });
  on($('isolate-mode'),'change', applyAppearance);
  on($('hide-piece'),'click', () => {
    if (!state.selected) return;
    if (state.hidden.has(state.selected)) state.hidden.delete(state.selected);
    else {
      state.hidden.add(state.selected);
      if (state.autoIsolatedMuscle) { state.isolated = false; state.autoIsolatedMuscle = false; }
    }
    applyAppearance(); announce(state.hidden.has(state.selected) ? 'Pieza ocultada' : 'Pieza restaurada');
  });
  on($('reset-view'),'click', reset);
  on($('front-view'),'click', () => fitBox(state.selected ? state.entries.get(state.selected).box : currentRegionBox(), new THREE.Vector3(0, 0, 1)));
  on($('back-view'),'click', () => fitBox(state.selected ? state.entries.get(state.selected).box : currentRegionBox(), new THREE.Vector3(0, 0, -1)));
  on($('start-study'),'click', () => selectStructure(metadata.structures.find(s => s.nombre_original === 'Short head of biceps brachii' && s.side === 'L').Mesh_ID, true));
  document.querySelectorAll('[data-preset]').forEach(button => on(button,'click', async () => {
    state.isolated = false; state.xray = false;
    state.autoIsolatedMuscle = false;
    const preset = button.dataset.preset;
    clearSelection(); state.muscleStudy = preset === 'muscles'; state.region = 'all'; $('region-select').value = 'all';
    state.layers = { oseo: ['bones', 'all'].includes(preset), muscular: ['muscles', 'all'].includes(preset), articular: ['joints', 'all'].includes(preset), cartilago: preset !== 'muscles', otro: false };
    const sequence=selectionSequence;
    document.querySelectorAll('[data-layer][type=checkbox]').forEach(input => { input.checked = state.layers[input.dataset.layer]; });
    refreshList(); applyAppearance();
    try{await ensureLayers(state.layers);}catch{announce('No se pudo cargar esta vista. Prueba otra sección.');return;}
    if(sequence!==selectionSequence)return;
    fitBox(currentRegionBox(), new THREE.Vector3(.08, .02, state.muscleStudy && metadata.model.muscle_sections[state.section]?.posterior ? -1 : 1).normalize());
    announce(preset === 'bones' ? 'Vista de esqueleto' : preset === 'muscles' ? 'Estudio por secciones musculares' : preset === 'joints' ? 'Vista de articulaciones' : 'Capas combinadas');
  }));
  on($('global-xray'),'click', () => {
    state.autoIsolatedMuscle = false;
    if (state.selected) { state.isolated = !state.isolated; state.xray = false; }
    else state.xray = !state.xray;
    applyAppearance();
  });
  on($('region-select'),'change', () => {
    const value=$('region-select').value;
    if(value.startsWith('muscle:')) {
      clearSelection();state.muscleStudy=true;state.section=value.slice(7);state.group='all';state.region='all';state.side='both';
      state.layers={oseo:false,muscular:true,articular:false,cartilago:false,otro:false};
      document.querySelectorAll('[data-layer][type=checkbox]').forEach(input=>{input.checked=state.layers[input.dataset.layer];});
      updateGroups();focusSection();return;
    }
    clearSelection();
    state.muscleStudy = false;
    state.region = $('region-select').value; state.selected = null; state.isolated = false;
    state.autoIsolatedMuscle = false;
    $('study').hidden = true; $('empty-study').hidden = false; $('floating-label').hidden = true;
    $('wiki-title').textContent = 'Texto enciclopédico de la estructura';
    $('wiki-status').textContent = 'Selecciona una pieza de esta región para consultar Wikipedia.';
    $('wiki-extract').textContent = ''; $('wiki-license').textContent = ''; $('wiki-link').hidden = true;
    refreshList(); applyAppearance(); fitBox(currentRegionBox(), new THREE.Vector3(.12, .03, 1).normalize());
    $('scene-title').textContent = metadata.model.regions[state.region].toUpperCase();
    announce(`Región: ${metadata.model.regions[state.region]}`);
  });
  on($('structure-filter'),'input', refreshList);
  on($('auto-isolate-muscle'),'change', () => {
    if (!$('auto-isolate-muscle').checked && state.autoIsolatedMuscle) {
      state.isolated = false; state.autoIsolatedMuscle = false; applyAppearance();
    } else if ($('auto-isolate-muscle').checked && state.selected && layerOf(state.entries.get(state.selected)) === 'muscular') {
      selectStructure(state.selected, false);
    }
  });
  on($('structure-filter'),'keydown', event => {
    if (event.key === 'Enter') {
      const first = listMatches[0];
      if (first) selectStructure(first.record.Mesh_ID, true);
    }
  });
  refreshList();
  setupSearch();
}

function setupSearch() {
  const input=$('search'), results=$('results');
  const close=()=>{results.hidden=true;input.setAttribute('aria-expanded','false');};
  function searchNow() {
    const query=normalized(input.value), terms=query.split(/\s+/).filter(Boolean);
    if(!terms.length){close();return;}
    const matches=[];
    for(const entry of state.entries.values()) {
      let rank=Infinity;
      for(const name of entry.searchNames)if(terms.every(term=>name.includes(term)))rank=Math.min(rank,name===query?0:name.startsWith(query)?1:2);
      if(Number.isFinite(rank))matches.push({entry,rank});
    }
    matches.sort((a,b)=>a.rank-b.rank||(a.entry.record.nombre.toLowerCase()<b.entry.record.nombre.toLowerCase()?-1:1));
    const buttons=matches.slice(0,30).map(({entry})=>{
      const s=entry.record,button=document.createElement('button');button.className='result';button.dataset.meshId=s.Mesh_ID;
      const text=document.createElement('span');text.textContent=s.nombre;
      const small=document.createElement('small');small.textContent=`${s.nombre_oficial_ta2||'TA2 pendiente'} · ${s.region}`;
      text.append(small);const arrow=document.createElement('span');arrow.textContent='↗';button.append(text,arrow);return button;
    });
    if(!buttons.length){const text=document.createElement('p');text.textContent='No se encontraron estructuras. Prueba un nombre o una sigla.';buttons.push(text);}
    results.replaceChildren(...buttons);results.hidden=false;input.setAttribute('aria-expanded','true');
  }
  on(input,'input',()=>{clearTimeout(searchTimer);if(!input.value.trim()){close();return;}searchTimer=setTimeout(searchNow,80);});
  on(results,'click',event=>{
    const button=event.target.closest('[data-mesh-id]');if(!button)return;
    const s=state.entries.get(button.dataset.meshId).record;input.value=s.nombre;close();selectStructure(s.Mesh_ID,true);
  });
  on(input,'keydown',event=>{
    if(event.key==='Escape'){close();return;}
    if(event.key==='ArrowDown'){event.preventDefault();clearTimeout(searchTimer);searchNow();results.querySelector('button')?.focus();}
    if(event.key==='Enter'){event.preventDefault();clearTimeout(searchTimer);searchNow();results.querySelector('button')?.click();}
  });
  on(results,'keydown',event=>{
    const buttons=[...results.querySelectorAll('button')],i=buttons.indexOf(document.activeElement);
    if(event.key==='ArrowDown'){event.preventDefault();buttons[(i+1)%buttons.length]?.focus();}
    if(event.key==='ArrowUp'){event.preventDefault();if(i<=0)input.focus();else buttons[i-1].focus();}
    if(event.key==='Escape'){close();input.focus();}
  });
  on(document,'pointerdown',event=>{if(!event.target.closest('.search-wrap'))close();},{passive:true});
  on(document,'keydown',event=>{
    if(event.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)){event.preventDefault();input.focus();}
  });
}

async function start() {
  try {
    data.signal=lifecycle.signal;metadata = await data.scene(lifecycle.signal);
    const byId=new Map(metadata.structures.map(s=>[s.Mesh_ID,s]));
    for(const asset of metadata.model.assets)for(const id of Object.values(asset.node_bindings)) {
      recordAssets.set(id,asset.key);const layer=byId.get(id).capa;
      if(!layerAssets.has(layer))layerAssets.set(layer,new Set());layerAssets.get(layer).add(asset.key);
    }
    setupScene();
    root = await loadModel(metadata.model.assets.filter(asset=>asset.key==='muscular'));
    indexModel(); batches=new AnatomyBatches(scene,materials);await batches.build(state.entries);
    buildList(); wireUI();
    $('model-note').textContent = metadata.model.note;
    $('model-subtitle').textContent = `${metadata.structures.length} estructuras · modelos reales`;
    for (const [layer, enabled] of Object.entries(metadata.model.default_layers)) {
      state.layers[layer] = enabled;
      document.querySelector(`[data-layer="${layer}"][type=checkbox]`).checked = enabled;
    }
    $('isolate-mode').value = 'hide';
    state.ready = true; refreshList(); applyAppearance();
    fitBox(allBox, new THREE.Vector3(.08, .02, 1).normalize(), true);
    requestRender();
    $('loading-progress').value=100;$('loading').hidden = true;
    announce(`Atlas real cargado · ${metadata.structures.length} estructuras`);
  } catch (error) {
    console.error(error);
    $('loading').classList.add('error'); $('loading').querySelector('.spinner').hidden = true;
    $('loading').querySelector('span').textContent = `No se pudo abrir el visor: ${error.message}`;
    announce('Error al cargar el visor');
    disposeViewer();
  }
}

// Diagnostics are exposed only for an explicit QA URL; no product interface depends on this.
if (new URLSearchParams(location.search).has('debug')) {
  window.atlasDebug = { state, get camera() { return camera; }, get controls() { return controls; },
    select: selectStructure, get entries() { return state.entries; }, get renderer() { return renderer; },
    get scene() { return scene; }, get batches(){return batches;}, renderNow: () => renderer.render(scene, camera), clear:()=>{clearSelection();applyAppearance();},
    dispose:disposeViewer, performance:{snapshot:()=>({ ...diagnostics, frames:{...frames?.stats}, resolution:{...resolution?.stats,ratio:resolution?.ratio},
      batches:{...batches?.stats}, materials:materials.sources.size+materials.variants.size, loadedAssets:[...loadedAssets], rowCount:document.getElementById('structure-list')?.childElementCount, visibleMeshes:visibleEntries.reduce((n,e)=>n+e.meshes.length,0) })} };
}

start();
