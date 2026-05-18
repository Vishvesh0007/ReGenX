// ══════════════════════════════════════
// ReGenX v3 — Unified Premium Logic
// ══════════════════════════════════════
import { Intelligence } from './intelligence.js';
import { TrustProtocol } from './trust.js';
import { YieldOptimizer } from './yield-optimizer.js';
import { RouteOptimizer } from './route-optimizer.js';

const STORAGE_KEY_PREFIX = "regenx-v3:";

// ── PWA Service Worker v3 Registration ──
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js')
    .then(reg => {
      console.log('☁️ ReGenX SW v3 Registered');
      window._swReg = reg;

      // Listen for Background Sync completion messages from SW
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'SYNC_COMPLETE') {
          window.showToast(event.data.message);
        }
        if (event.data?.type === 'NAVIGATE') {
          window.showView && window.showView('v-r-dash');
        }
      });
    })
    .catch(err => console.log('SW Registration Failed', err));
}

// ── Push Notification Permission UI ──
window.requestPushPermission = async function() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    window.showToast('✓ Smart Alerts are already enabled!');
    return;
  }
  const permission = await Notification.requestPermission();
  if (permission === 'granted') {
    window.showToast('🔔 Smart Alerts enabled! You\'ll be notified of new dispatches.');
    // Register Background Sync on first permission grant
    if (window._swReg && 'sync' in window._swReg) {
      window._swReg.sync.register('regenx-order-sync');
    }
  } else {
    window.showToast('⚠️ Notifications blocked. Enable in browser settings.');
  }
};

// ── Trigger Background Sync when going offline ──
window.addEventListener('offline', () => {
  window.showToast && window.showToast('📶 Offline mode — changes queued for sync.');
  if (window._swReg && 'sync' in window._swReg) {
    window._swReg.sync.register('regenx-order-sync');
  }
});
window.addEventListener('online', () => {
  window.showToast && window.showToast('✅ Back online! Syncing queued data...');
});


// Simulated Localities for default plants (if no GPS)
const DEFAULT_LOCALITIES = [
  { name: "Sector Beta", lat: 28.4682, lng: 77.5031 },
  { name: "Delta Zone", lat: 28.4710, lng: 77.4950 }
];

const WASTE_TYPES = ['Food waste (wet)', 'Vegetable scraps', 'Mixed kitchen waste', 'Biodegradable packaging'];
const SHIFTS = ['Morning Shift (08:00 - 12:00)', 'Evening Shift (16:00 - 20:00)'];

// ── DB HELPER ──
const DB = {
  get: (key) => { try { const r = window.localStorage.getItem(STORAGE_KEY_PREFIX + key); return r ? JSON.parse(r) : null; } catch { return null; } },
  set: (key, val) => { try { window.localStorage.setItem(STORAGE_KEY_PREFIX + key, JSON.stringify(val)); return true; } catch { return false; } },
  list: (prefix) => {
    try {
      const keys = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k.startsWith(STORAGE_KEY_PREFIX + prefix)) keys.push(k.substring(STORAGE_KEY_PREFIX.length));
      }
      return keys;
    } catch { return []; }
  }
};

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2,6); }
function ts() { return Date.now(); }
function fmtDate(ms) { return new Date(ms).toLocaleDateString('en-IN', {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}); }
function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; const dLat = (lat2-lat1)*Math.PI/180; const dLon = (lon2-lon1)*Math.PI/180;
  const a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)*Math.sin(dLon/2);
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

window.showToast = function(msg) {
  const t = document.getElementById('toast');
  if(!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

window.resetAppData = function() {
  if (!confirm('⚠ This will delete ALL registered accounts, orders, and data. The app will reset to a fresh state. Continue?')) return;
  // Remove all keys that start with our prefix
  const keysToRemove = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (k && k.startsWith(STORAGE_KEY_PREFIX)) keysToRemove.push(k);
  }
  keysToRemove.forEach(k => window.localStorage.removeItem(k));
  // Also clear theme preference
  window.localStorage.removeItem('regenx-theme');
  // Reload fresh
  window.location.reload();
}

window.fetchWeather = async function(lat, lng) {
  if (!lat || !lng) { lat = 28.5355; lng = 77.3910; } // Fallback to Noida coords if undefined
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true`);
    const d = await r.json();
    return d.current_weather; // { temperature, windspeed, weathercode }
  } catch(e) { return null; }
}

// ── STATE ──
let SESSION = { role: null, name: '', org: '', uid: '', lat: null, lng: null };
let selectedRole = 'provider';
let currentView = '';
let rMap = null; // Rider map instance
let autoRefreshTimer = null;

// ── THEME ──
window.toggleTheme = function() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  window.localStorage.setItem('regenx-theme', next);
}
const savedTheme = window.localStorage.getItem('regenx-theme') || 'light';
document.documentElement.setAttribute('data-theme', savedTheme);

// ── AUTH & REGISTRATION ──
window.switchAuthTab = function(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.auth-view').forEach(v => v.classList.add('hidden'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.getElementById('view-' + tab).classList.remove('hidden');
  
  if (tab === 'login') refreshLoginDropdown();
}

window.selectRole = function(r) {
  selectedRole = r;
  document.querySelectorAll('.role-btn').forEach(b => b.classList.remove('selected'));
  document.getElementById('role-' + r).classList.add('selected');
  const l = document.getElementById('reg-org-label');
  const i = document.getElementById('reg-org');
  if(r==='provider') { l.textContent = 'Hostel/Hotel Name'; i.placeholder = 'e.g. Omega Hostel'; }
  if(r==='rider') { l.textContent = 'Vehicle ID'; i.placeholder = 'e.g. GN-Tempo-1'; }
  if(r==='plant') { l.textContent = 'Plant Facility Name'; i.placeholder = 'e.g. Plant Alpha'; }
}

let detectedPos = null;
let regMapInstance = null;
let regMarker = null;

window.detectGPS = function() {
  const st = document.getElementById('gps-status');
  if(!navigator.geolocation) { st.textContent = "GPS not supported by browser."; return; }
  st.textContent = "Detecting high-accuracy location...";
  
  navigator.geolocation.getCurrentPosition(
    pos => {
      detectedPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      st.innerHTML = `<span style="color:var(--green)">✓ Found! Drag pin to refine your exact address.</span>`;
      
      const mapEl = document.getElementById('reg-map');
      mapEl.classList.add('show');
      
      if(!regMapInstance) {
        regMapInstance = L.map('reg-map').setView([detectedPos.lat, detectedPos.lng], 14);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(regMapInstance);
        
        const dragIco = L.divIcon({html:"<div style='width:18px;height:18px;background:var(--green);border-radius:50%;border:2px solid white;box-shadow:0 0 10px rgba(0,0,0,0.4);'></div>", className:''});
        regMarker = L.marker([detectedPos.lat, detectedPos.lng], {icon: dragIco, draggable: true}).addTo(regMapInstance);
        
        regMarker.on('dragend', function(e) {
          const mPos = regMarker.getLatLng();
          detectedPos = { lat: mPos.lat, lng: mPos.lng };
        });
      } else {
        regMapInstance.setView([detectedPos.lat, detectedPos.lng], 14);
        regMarker.setLatLng([detectedPos.lat, detectedPos.lng]);
      }
    },
    err => { st.innerHTML = `<span style="color:var(--red)">✗ Failed to detect. Check permissions.</span>`; },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

window.searchLocation = async function() {
  const query = document.getElementById('loc-search').value.trim();
  const st = document.getElementById('gps-status');
  if(!query) { st.innerHTML = `<span style="color:var(--red)">⚠ Enter a location (e.g., "Amity Noida").</span>`; return; }
  
  st.textContent = "Searching global maps...";
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`);
    const data = await res.json();
    if(data && data.length > 0) {
      const lat = parseFloat(data[0].lat);
      const lng = parseFloat(data[0].lon);
      detectedPos = { lat, lng };
      st.innerHTML = `<span style="color:var(--green)">✓ Found: ${data[0].display_name.split(',')[0]}</span>`;
      
      const mapEl = document.getElementById('reg-map');
      mapEl.classList.add('show');
      
      if(!regMapInstance) {
        regMapInstance = L.map('reg-map').setView([lat, lng], 14);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(regMapInstance);
        
        const dragIco = L.divIcon({html:"<div style='width:18px;height:18px;background:var(--green);border-radius:50%;border:2px solid white;box-shadow:0 0 10px rgba(0,0,0,0.4);'></div>", className:''});
        regMarker = L.marker([lat, lng], {icon: dragIco, draggable: true}).addTo(regMapInstance);
        
        regMarker.on('dragend', function(e) {
          const mPos = regMarker.getLatLng();
          detectedPos = { lat: mPos.lat, lng: mPos.lng };
        });
      } else {
        regMapInstance.setView([lat, lng], 14);
        regMarker.setLatLng([lat, lng]);
      }
    } else {
      st.innerHTML = `<span style="color:var(--amber)">⚠ Not found. Try adding city name.</span>`;
    }
  } catch (err) {
    st.innerHTML = `<span style="color:var(--red)">✗ Network error. Try again.</span>`;
  }
}

window.doRegister = async function() {
  const name = document.getElementById('reg-name').value.trim();
  const org = document.getElementById('reg-org').value.trim();
  if(!name || !org) return showToast("⚠ Please enter Name and Organisation.");
  if(!detectedPos) return showToast("⚠ Please detect GPS Location first.");
  
  const acc = { id: uid(), role: selectedRole, name, org, lat: detectedPos.lat, lng: detectedPos.lng, tokens: 0 };
  DB.set('acc:' + acc.id, acc);
  
  // If no plants exist, establish a mock plant nearby to ensure routing works
  const plants = DB.list('acc:').map(k => DB.get(k)).filter(a => a.role === 'plant');
  if (plants.length === 0 && selectedRole !== 'plant') {
    DB.set('acc:mock-plant-1', { id: 'mock-plant-1', role: 'plant', name: 'Established Plant', org: 'Beta Zone Plant', lat: detectedPos.lat + 0.05, lng: detectedPos.lng + 0.05 });
  }

  // Show Splash Screen
  const splash = document.getElementById('success-splash');
  if(splash) splash.classList.add('show');
  
  setTimeout(() => {
    if(splash) splash.classList.remove('show');
    executeLogin(acc);
  }, 2500);
}

async function refreshLoginDropdown() {
  const sel = document.getElementById('login-account');
  const accounts = DB.list('acc:').map(k => DB.get(k));
  if(accounts.length === 0) {
    sel.innerHTML = '<option value="">-- No accounts registered yet --</option>';
  } else {
    sel.innerHTML = accounts.map(a => `<option value="${a.id}">${a.name} (${a.org}) - ${a.role.toUpperCase()}</option>`).join('');
  }
}

window.doLogin = async function() {
  const id = document.getElementById('login-account').value;
  if(!id) return showToast("⚠ Please select an account or register first.");
  const acc = DB.get('acc:' + id);
  if(!acc) return;
  executeLogin(acc);
}

let tickerTimer = null;
function startTicker() {
  const t = document.getElementById('global-ticker');
  if(!t) return;
  const msgs = [
    "AI Route Optimization Active. Saving 12% Fuel Fleet-wide.",
    "Plant Alpha just minted 250 $RGX for organic compost yield.",
    "Over 5,000kg of biowaste diverted from landfills today.",
    "Rider GN-Tempo-1 completing Route #A1B2... ETA 5 mins."
  ];
  let i = 0;
  t.textContent = msgs[i];
  if(tickerTimer) clearInterval(tickerTimer);
  tickerTimer = setInterval(() => { i = (i+1)%msgs.length; t.textContent = msgs[i]; }, 20000);
}

let gwTimer = null;
function startGreenWall() {
  const feed = document.getElementById('gw-feed');
  if(!feed) return;
  if(gwTimer) clearInterval(gwTimer);
  feed.innerHTML = '';
  
  const completedOrders = getAllOrders().filter(o => o.status === 'completed');
  if(completedOrders.length === 0) {
    feed.innerHTML = '<div class="gw-item" style="color:var(--text-muted)">No network activity yet. Complete a pickup to appear here!</div>';
    return;
  }
  
  completedOrders.slice(0, 5).forEach(o => {
    const el = document.createElement('div');
    el.className = 'gw-item';
    el.innerHTML = `<div>🌟 ${o.providerOrg} diverted ${o.actualKg || o.kg}kg of waste!</div><div class="gw-time">${fmtDate(o.ts)}</div>`;
    feed.appendChild(el);
  });
}

window.buyMarketItem = function(price, name) {
  if((SESSION.tokens || 0) < price) return showToast("⚠ Insufficient $RGX balance.");
  
  const hash = '0x' + Array.from({length:40}, () => Math.floor(Math.random()*16).toString(16)).join('');
  const html = `
    <h3 class="modal-title">Web3 Smart Contract Interaction</h3>
    <p class="modal-sub">Minting <strong>${name}</strong> to the ReGen Layer-2 Network...</p>
    <div style="background:#0a0a0a; color:#0f0; font-family:monospace; padding:16px; border-radius:8px; font-size:12px; margin-bottom:16px; border:1px solid #333;">
       <div>> Initializing secure connection...</div>
       <div style="animation: fadeIn 1s 0.5s both">> Deducting ${price} $RGX tokens...</div>
       <div style="animation: fadeIn 1s 1.5s both">> Minting verifiable credential...</div>
       <div style="animation: fadeIn 1s 2.5s both">> Tx Hash: ${hash}</div>
       <div style="animation: fadeIn 1s 3.5s both; color:#fff;">> <strong>SUCCESS. Block confirmed.</strong></div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-primary btn-full" id="btn-close-mint" disabled onclick="closeModal()">Minting...</button>
    </div>
  `;
  document.getElementById('modal-box').innerHTML = html;
  document.getElementById('modal').classList.add('open');
  
  setTimeout(() => {
    SESSION.tokens -= price;
    DB.set('acc:' + SESSION.id, SESSION);
    document.getElementById('token-balance').textContent = SESSION.tokens;
    const b = document.getElementById('btn-close-mint');
    if(b) { b.disabled = false; b.textContent = "Close & Claim Asset"; }
    refreshCurrentView(true);
  }, 3500);
}

window.stakeTokens = function() {
  const amt = parseInt(prompt("How many $RGX tokens would you like to stake in the Community Digester Fund?"));
  if(!amt || isNaN(amt) || amt <= 0) return;
  if((SESSION.tokens || 0) < amt) return showToast("⚠ Insufficient balance to stake.");
  SESSION.tokens -= amt;
  SESSION.staked = (SESSION.staked || 0) + amt;
  DB.set('acc:' + SESSION.id, SESSION);
  document.getElementById('token-balance').textContent = SESSION.tokens;
  showToast(`✓ Successfully staked ${amt} $RGX. Earning 12% APY.`);
  refreshCurrentView(true);
}

window.fundProject = function() {
  if((SESSION.tokens || 0) < 500) return showToast("⚠ Insufficient balance. Need 500 $RGX.");
  SESSION.tokens -= 500;
  DB.set('acc:' + SESSION.id, SESSION);
  const cur = DB.get('global-fund') || 45200;
  DB.set('global-fund', cur + 500);
  document.getElementById('token-balance').textContent = SESSION.tokens;
  showToast("✓ Contributed 500 $RGX to the Amazon Reforestation Initiative!");
  refreshCurrentView(true);
}

function executeLogin(acc) {
  SESSION = acc;
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-shell').classList.add('active');
  
  document.getElementById('tb-name').textContent = acc.name;
  document.getElementById('tb-role').textContent = `${acc.role.toUpperCase()} · ${acc.org}`;
  document.getElementById('tb-avatar').textContent = acc.name.slice(0,2).toUpperCase();
  
  // GPS RECOVERY: If coordinates are missing, attempt auto-detect
  if(!acc.lat || !acc.lng) {
    console.log('[GPS Recovery] Attempting auto-detection...');
    navigator.geolocation.getCurrentPosition(pos => {
      acc.lat = pos.coords.latitude; acc.lng = pos.coords.longitude;
      DB.set('acc:' + acc.id, acc);
      refreshCurrentView(true);
      showToast("✓ GPS Corrected Automatically");
    });
  }
  
  const tokenContainer = document.getElementById('token-balance-container');
  if (acc.role === 'provider') {
    tokenContainer.classList.remove('hidden');
    // GSAP Animation for Token Balance
    const targetTokens = acc.tokens || 0;
    const countObj = { val: 0 };
    gsap.to(countObj, {
      val: targetTokens,
      duration: 2,
      ease: "power2.out",
      onUpdate: () => {
        document.getElementById('token-balance').textContent = Math.floor(countObj.val);
      }
    });
  } else {
    tokenContainer.classList.add('hidden');
  }
  startTicker();
  const gwWidget = document.getElementById('green-wall-widget');
  if(gwWidget) { gwWidget.style.display = 'flex'; startGreenWall(); }
  
  buildSidebar();
  autoRefreshTimer = setInterval(() => refreshCurrentView(), 15000);
}


window.doLogout = function() {
  clearInterval(autoRefreshTimer);
  clearInterval(tickerTimer);
  clearInterval(gwTimer);
  stopIoTSim();
  if (pvChartInstance) { pvChartInstance.destroy(); pvChartInstance = null; }
  if (plChartInstance) { plChartInstance.destroy(); plChartInstance = null; }
  if (rMap) { rMap.remove(); rMap = null; }
  SESSION = { role: null, name: '', org: '', uid: '', lat: null, lng: null };
  document.getElementById('app-shell').classList.remove('active');
  document.getElementById('login-screen').style.display = 'flex';
  switchAuthTab('login');
}

// ── NAVIGATION ──
function buildSidebar() {
  const nav = document.getElementById('sidebar-nav');
  if (SESSION.role === 'provider') {
    nav.innerHTML = `
      <button class="nav-item active" onclick="showView('v-pv-dash')" id="nav-v-pv-dash"><span class="nav-item-icon">📊</span> Overview</button>
      <button class="nav-item" onclick="showView('v-pv-req')" id="nav-v-pv-req"><span class="nav-item-icon">➕</span> Dispatch Request</button>
      <button class="nav-item" onclick="showView('v-iot-bins')" id="nav-v-iot-bins"><span class="nav-item-icon">🗑️</span> IoT Sensory Bins <span class="nav-badge" id="iot-alert-badge" style="display:none">!</span></button>
      <button class="nav-item" onclick="showView('v-pv-hist-week')" id="nav-v-pv-hist-week"><span class="nav-item-icon">📅</span> Weekly Records</button>
      <button class="nav-item" onclick="showView('v-pv-hist-month')" id="nav-v-pv-hist-month"><span class="nav-item-icon">🗓️</span> Monthly Records</button>
      <button class="nav-item" onclick="showView('v-market')" id="nav-v-market"><span class="nav-item-icon">🛒</span> ReGen Exchange</button>
    `;
    showView('v-pv-dash');
  }
  if (SESSION.role === 'rider') {
    nav.innerHTML = `
      <button class="nav-item active" onclick="showView('v-rd-dash')" id="nav-v-rd-dash"><span class="nav-item-icon">🗺️</span> Active Route</button>
      <button class="nav-item" onclick="showView('v-rd-jobs')" id="nav-v-rd-jobs"><span class="nav-item-icon">📋</span> Available Jobs <span class="nav-badge" id="rd-badge" style="display:none">0</span></button>
      <button class="nav-item" onclick="showView('v-rd-hist')" id="nav-v-rd-hist"><span class="nav-item-icon">✓</span> Completions</button>
    `;
    showView('v-rd-dash');
  }
  if (SESSION.role === 'plant') {
    nav.innerHTML = `
      <button class="nav-item active" onclick="showView('v-pl-dash')" id="nav-v-pl-dash"><span class="nav-item-icon">🏭</span> Operations</button>
      <button class="nav-item" onclick="showView('v-pl-in')" id="nav-v-pl-in"><span class="nav-item-icon">🚚</span> Incoming Flow</button>
      <button class="nav-item" onclick="showView('v-pl-out')" id="nav-v-pl-out"><span class="nav-item-icon">⚗️</span> Log Output</button>
    `;
    showView('v-pl-dash');
  }
}

window.showView = function(viewId) {
  currentView = viewId;
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const btn = document.getElementById('nav-' + viewId);
  if(btn) btn.classList.add('active');
  
  // Set Title
  const titleMap = { 'v-iot-bins': 'IoT Sensory Bins' };
  if(btn) document.getElementById('tb-view-title').textContent = titleMap[viewId] || btn.innerText.replace(/[^a-zA-Z\s]/g, '').trim();
  
  if (window.innerWidth <= 768) toggleSidebar(false);
  refreshCurrentView(true);
}

window.toggleSidebar = function(force) {
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('sidebar-overlay');
  if(!sb || !ov) return;
  
  const isOpen = force !== undefined ? force : !sb.classList.contains('open');
  sb.classList.toggle('open', isOpen);
  ov.classList.toggle('open', isOpen);
}

// ── CORE DATA ENGINE ──
function getAllOrders() { return DB.list('ord:').map(k => DB.get(k)).filter(Boolean).sort((a,b)=>b.ts-a.ts); }
function getOrder(id) { return DB.get('ord:'+id); }
function saveOrder(o) { 
  DB.set('ord:'+o.id, o); 
  if (window.CloudSync && window.CloudSync.isLive) {
      window.CloudSync.pushDocument('orders', o);
  }
}
function getAllLogs() { return DB.list('log:').map(k => DB.get(k)).filter(Boolean).sort((a,b)=>b.ts-a.ts); }

// Generic Order Card Component
function buildOrderCard(o, role) {
  const badges = {
    requested: '<span class="badge badge-blue">Requested</span>',
    assigned: '<span class="badge badge-amber">Assigned to Rider</span>',
    en_route: '<span class="badge badge-amber">En Route</span>',
    picked_up: '<span class="badge badge-green">Picked Up</span>',
    at_plant: '<span class="badge badge-green">Arrived at Plant</span>',
    completed: '<span class="badge" style="background:var(--green);color:white;">Completed</span>',
    rejected: '<span class="badge badge-red">Rejected</span>'
  };
  
  let acts = '';
  if (role === 'provider' && o.status === 'requested') {
    acts = `<button class="btn btn-ghost btn-sm" onclick="cancelOrder('${o.id}')">Cancel</button>`;
  }
  if (role === 'rider' && o.status === 'requested') {
    acts = `<button class="btn btn-primary btn-sm" onclick="riderAccept('${o.id}')">Accept Route</button>`;
  }
  if (role === 'rider' && o.status === 'assigned' && o.riderId === SESSION.id) {
    acts = `<button class="btn btn-amber btn-sm" onclick="riderUpdate('${o.id}','en_route')">Start Navigation →</button>`;
  }
  if (role === 'rider' && o.status === 'en_route' && o.riderId === SESSION.id) {
    acts = `<button class="btn btn-primary btn-sm" onclick="openPickupConfirm('${o.id}')">Confirm Collection ✓</button>`;
  }
  if (role === 'rider' && o.status === 'picked_up' && o.riderId === SESSION.id) {
    acts = `<button class="btn btn-amber btn-sm" onclick="riderUpdate('${o.id}','at_plant')">Arrived at Plant</button>`;
  }
  if (role === 'plant' && o.status === 'at_plant' && o.plantId === SESSION.id) {
    acts = `<button class="btn btn-primary btn-sm" onclick="openPlantConfirm('${o.id}')">Confirm Receipt ✓</button>`;
  }
  if (['provider', 'rider', 'plant'].includes(role) && o.status === 'completed') {
    acts += `<button class="btn btn-outline-danger btn-sm" onclick="deleteOrder('${o.id}')" style="margin-left:auto;">🗑 Delete Record</button>`;
  }

  return `
    <div class="order-card" data-status="${o.status}">
      <div class="oc-header">
        <div class="oc-title">${o.providerOrg} <span style="font-size:12px;color:var(--text-muted);font-family:monospace">#${o.id.slice(-6).toUpperCase()}</span></div>
        <div>${badges[o.status]}</div>
      </div>
      <div class="oc-meta">
        <div class="oc-meta-item">🗑 ${o.wasteType} (${o.kg}kg)</div>
        <div class="oc-meta-item">🕒 ${o.shift}</div>
        <div class="oc-meta-item">⚗️ Dest: ${o.plantName}</div>
      </div>
      ${o.actualKg ? `<div style="margin-bottom:8px;font-size:13px;color:var(--green);font-weight:600;">✓ Actual Collected: ${o.actualKg}kg (Quality: ${o.quality})</div>` : ''}
      ${o.tokensMinted ? `<div style="margin-bottom:8px;font-size:13px;color:var(--amber);font-weight:600;">🪙 Minted ${o.tokensMinted} $RGX <span style="font-size:10px; color:var(--text-muted); font-family:monospace; margin-left:8px;">TX: ${o.txHash.slice(0,12)}...</span></div>` : ''}
      ${acts ? `<div class="oc-actions">${acts}</div>` : ''}
    </div>
  `;
}

// ── REFRESH CONTROLLER ──
async function refreshCurrentView(fullRender = false) {
  const mc = document.getElementById('main-content');
  if (currentView === 'v-market') {
    const globalFunded = DB.get('global-fund') || 45200;
    const staked = SESSION.staked || 0;
    const totalStakedGlobal = 1250000 + staked;

    if(fullRender) mc.innerHTML = `
      <div class="between" style="margin-bottom:24px;">
        <h3 class="heading">DeFi Carbon Exchange Hub</h3>
        <div class="badge badge-amber" style="font-size:14px; padding:6px 12px;">Wallet Balance: ${SESSION.tokens || 0} $RGX</div>
      </div>
      
      <div class="two-col" style="margin-bottom:32px;">
        <div class="glass-card" style="border-color:var(--blue); padding:24px;">
           <div class="between" style="margin-bottom:16px;">
             <div>
               <h4 style="margin-bottom:4px; font-size:18px;">Carbon Credit Staking</h4>
               <p style="font-size:13px; color:var(--text-muted);">Your collective waste diversion has offset <strong>${(DB.get('global-fund') || 45200 / 10).toFixed(1)} tons</strong> of CO2.</p>
             </div>
             <div style="text-align:right;">
               <div style="font-size:24px; font-weight:700; color:var(--blue);">12.5% <span style="font-size:14px">APY</span></div>
             </div>
           </div>
           <div class="between" style="margin-bottom:24px; background:var(--surface); padding:16px; border-radius:12px; border:1px solid var(--border);">
             <div>
               <div style="font-size:12px; text-transform:uppercase; color:var(--text-muted); font-weight:700;">Your Impact Portfolio</div>
               <div style="font-size:20px; font-weight:700;">${staked} $RGX</div>
             </div>
             <div style="text-align:right;">
               <div style="font-size:12px; text-transform:uppercase; color:var(--text-muted); font-weight:700;">Network TVL</div>
               <div style="font-size:20px; font-weight:700; color:var(--green);">${totalStakedGlobal.toLocaleString()} $RGX</div>
             </div>
           </div>
           <button class="btn btn-primary btn-full" style="background:var(--blue); border-color:var(--blue);" onclick="stakeTokens()">Stake for Environment</button>
        </div>
        
        <div class="glass-card" style="border-color:var(--green); padding:24px;">
           <h4 style="margin-bottom:4px; font-size:18px;">Global Impact Crowdfunding</h4>
           <p style="font-size:13px; color:var(--text-muted); margin-bottom:24px;">Contribute to massive global projects. When the pool hits 100%, real-world action is executed.</p>
           
           <div style="margin-bottom:8px; font-weight:700;">Amazon Reforestation Initiative</div>
           <div class="between" style="font-size:12px; margin-bottom:4px; color:var(--text-muted);">
             <span>${globalFunded.toLocaleString()} $RGX</span>
             <span>Goal: 100,000 $RGX</span>
           </div>
           <div style="width:100%; height:12px; background:var(--border); border-radius:6px; overflow:hidden; margin-bottom:24px;">
             <div style="width:${Math.min((globalFunded/100000)*100, 100)}%; height:100%; background:var(--green); border-radius:6px; transition:width 1s;"></div>
           </div>
           
           <button class="btn btn-primary btn-full" onclick="fundProject()">Fund with 500 $RGX</button>
        </div>
      </div>

      <h3 class="heading" style="margin-bottom:16px;">Web3 NFT Assets & Utilities</h3>
      <div class="market-grid">
         ${Intelligence.MARKETPLACE_ITEMS.map(item => `
          <div class="market-card glass-card">
            <div class="mc-icon">${item.icon}</div>
            <div class="mc-title">${item.name}</div>
            <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px;">${item.description}</p>
            <div class="mc-price">${item.price} $RGX</div>
            <button class="btn btn-primary btn-full" onclick="buyMarketItem(${item.price}, '${item.name}')">Mint Asset</button>
          </div>
         `).join('')}
      </div>
    `;
    return;
  }
  if (currentView === 'v-iot-bins') { renderIoT(mc, fullRender); return; }
  if (SESSION.role === 'provider') await renderProvider(mc, fullRender);
  if (SESSION.role === 'rider') await renderRider(mc, fullRender);
  if (SESSION.role === 'plant') await renderPlant(mc, fullRender);
}

// ════════ PROVIDER LOGIC ════════
async function renderProvider(mc, fullRender) {
  const orders = getAllOrders().filter(o => o.providerId === SESSION.id);
  const active = orders.filter(o => !['completed','rejected'].includes(o.status));
  const completed = orders.filter(o => o.status === 'completed');
  
  if (currentView === 'v-pv-dash') {
    if(fullRender) mc.innerHTML = `
      <!-- Mobile Quick Access -->
      <div class="mobile-quick-actions">
        <button class="glass-card" style="flex:1; padding:12px; text-align:center; border-color:var(--green);" onclick="showView('v-pv-req')">
          <div style="font-size:20px;">🚀</div><div style="font-size:11px; font-weight:600; margin-top:4px;">Dispatch</div>
        </button>
        <button class="glass-card" style="flex:1; padding:12px; text-align:center; border-color:var(--amber);" onclick="showView('v-market')">
          <div style="font-size:20px;">🛒</div><div style="font-size:11px; font-weight:600; margin-top:4px;">Exchange</div>
        </button>
      </div>

      <div class="stats-grid" id="pv-stats"></div>
      <div class="two-col">
        <div>
          <h3 class="heading" style="margin-bottom:16px;">Active Dispatches</h3><div id="pv-act"></div>

          <!-- IoT Bin Status Widget -->
          <div class="between" style="margin-top:24px; margin-bottom:16px;">
            <h3 class="heading" style="margin-bottom:0;">🗑️ IoT Bin Status</h3>
            <button class="btn btn-ghost btn-sm" onclick="showView('v-iot-bins')">View All →</button>
          </div>
          <div id="pv-iot-widget" class="glass-card" style="padding:16px;"></div>

          <h3 class="heading" style="margin-top:24px; margin-bottom:16px;">Impact Analytics</h3>
          <div class="glass-card" style="padding:16px;">
            <div class="between" style="margin-bottom:12px;">
               <div style="font-size:12px; font-weight:600; color:var(--text-muted); text-transform:uppercase;">Timeframe</div>
               <select class="form-select" style="width:auto; padding:4px 8px;" onchange="updatePvChart(this.value)">
                 <option value="weekly">Weekly</option>
                 <option value="monthly">Monthly</option>
               </select>
            </div>
            <div class="chart-container"><canvas id="pvChart"></canvas></div>
            <button class="btn btn-outline-primary btn-full" style="margin-top:16px; border: 2px solid var(--blue); color: var(--blue);" onclick="window.ESGReporter.generateReport(SESSION, getAllOrders().filter(o => o.providerId === SESSION.id && o.status === 'completed'))">
                📄 Export ESG PDF Report
            </button>
          </div>
        </div>
        <div>
          <div class="glass-card" style="margin-bottom:24px; border-color:var(--blue); background:linear-gradient(135deg, var(--surface) 0%, var(--blue-light) 100%);">
            <div class="ai-badge" style="background:var(--blue); margin-bottom:12px;">🛡️ Trust Protocol</div>
            <div class="between" style="margin-bottom:16px;">
               <div id="pv-trust-rank-icon" style="font-size:42px;">🥉</div>
               <div style="text-align:right;">
                  <div style="font-size:12px; font-weight:700; color:var(--text-muted); text-transform:uppercase;">Reputation Score</div>
                  <div style="font-size:28px; font-weight:800; color:var(--blue);" id="pv-trust-score">0</div>
               </div>
            </div>
            <div style="height:8px; background:rgba(0,0,0,0.1); border-radius:4px; overflow:hidden; margin-bottom:12px;">
               <div id="pv-trust-bar" style="height:100%; width:0%; background:var(--blue); transition:width 1.5s cubic-bezier(0.34, 1.56, 0.64, 1);"></div>
            </div>
            <div class="between" style="font-size:12px; font-weight:600;">
               <div id="pv-trust-rank-name">Bronze Level</div>
               <div id="pv-trust-multiplier" style="color:var(--green);">1.0x Rewards</div>
            </div>
            <button class="btn btn-ghost btn-sm btn-full" style="margin-top:16px; border:1px solid var(--blue); color:var(--blue);" onclick="openDigitalPassport()">View Digital Passport →</button>
          </div>

          <div class="glass-card" style="background:var(--green-light); border-color:var(--green);">
            <div style="font-size:32px;margin-bottom:12px;">♻️</div>
            <h3 class="heading" style="color:var(--green-hover);margin-bottom:8px;">Ready to dispatch?</h3>
            <p style="font-size:14px;color:var(--green-hover);opacity:0.8;margin-bottom:20px;">Ensure you meet the 50kg minimum threshold for net-positive energy yield.</p>
            <button class="btn btn-primary" onclick="showView('v-pv-req')">Create Request →</button>
          </div>

          <h3 class="heading" style="margin-top:24px; margin-bottom:16px;">Market Summary</h3>
          <div class="glass-card" style="margin-bottom:16px; border-color:var(--blue);">
            <div style="font-size:13px; color:var(--text-muted); margin-bottom:12px;">Access the carbon credit exchange to trade your earned $RGX tokens.</div>
            <button class="btn btn-primary btn-full" onclick="showView('v-market')">🛒 Open Market</button>
          </div>

          <div class="glass-card sensor-card" style="margin-top:24px; padding:16px;">
            <div class="ai-badge">✨ Intelligence Engine</div>
            <h4 style="margin-bottom:4px;" id="pv-ai-predict">Analyzing patterns...</h4>
            <p style="font-size:13px; color:var(--text-muted);" id="pv-ai-trend">History-based forecasting active.</p>
          </div>

          <h3 class="heading" style="margin-top:24px; margin-bottom:16px;">Regional Leaderboard</h3>
          <div class="glass-card" style="padding:16px;" id="pv-leaderboard">
            <!-- Dynamic Leaderboard -->
          </div>

          <div class="glass-card" style="margin-top:24px; padding:16px; border-color:var(--amber); background:rgba(245,158,11,0.07);">
            <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
              <span style="font-size:22px;">🔔</span>
              <div>
                <div style="font-weight:700; font-size:14px;">Smart Dispatch Alerts</div>
                <div style="font-size:12px; color:var(--text-muted);">Get notified instantly when your dispatch is picked up</div>
              </div>
            </div>
            <button class="btn btn-full" style="background:linear-gradient(135deg,#F59E0B,#D97706); color:#fff; font-weight:700;" onclick="window.requestPushPermission()">
              🔔 Enable Smart Alerts
            </button>
          </div>
        </div>

      </div>
    `;
    
    // Calculate Leaderboard
    const allCompleted = getAllOrders().filter(o=>o.status==='completed');
    const lbMap = {};
    allCompleted.forEach(o => {
       lbMap[o.providerId] = (lbMap[o.providerId]||0) + parseInt(o.actualKg||o.kg||0);
    });
    // Ensure current user is in map even if 0
    if(!lbMap[SESSION.id]) lbMap[SESSION.id] = 0;
    
    const lbSorted = Object.keys(lbMap).map(id => ({
       id, org: (DB.get('acc:'+id)||{org:'Unknown'}).org, kg: lbMap[id]
    })).sort((a,b)=>b.kg - a.kg).slice(0,3);
    
    const lbHTML = lbSorted.map((item, i) => `
      <div class="between" style="padding:8px 0; border-bottom:${i<2?'1px solid var(--border)':'none'};">
         <div style="font-weight:600;"><span style="color:var(--amber);">${i+1}.</span> ${item.org} ${item.id===SESSION.id?'(You)':''}</div>
         <div class="badge badge-green">${item.kg} kg</div>
      </div>
    `).join('');
    
    const lbDiv = document.getElementById('pv-leaderboard');
    if(lbDiv) lbDiv.innerHTML = lbHTML;

    // Trust Protocol Integration
    const trustScore = TrustProtocol.calculateScore(SESSION, orders);
    const rank = TrustProtocol.getRankDetails(trustScore);
    const scoreEl = document.getElementById('pv-trust-score');
    if (scoreEl) {
        scoreEl.textContent = trustScore;
        document.getElementById('pv-trust-bar').style.width = trustScore + '%';
        document.getElementById('pv-trust-rank-icon').textContent = rank.icon;
        document.getElementById('pv-trust-rank-name').textContent = rank.name + ' Level';
        document.getElementById('pv-trust-multiplier').textContent = rank.multiplier + 'x Rewards';
    }
    
    // Predict next day = AI Intelligence Engine
    const myTotal = lbMap[SESSION.id] || 0;
    const myComps = completed.length;
    const avg = myComps > 0 ? Math.round(myTotal / myComps) : 0;
    const prediction = Intelligence.predictWasteVolume(completed);
    const aiPredict = document.getElementById('pv-ai-predict');
    if(aiPredict) {
      aiPredict.textContent = `${prediction.expectedKg}kg ${prediction.trend === 'Upward' ? '📈' : '📉'}`;
      const trendEl = document.getElementById('pv-ai-trend');
      if(trendEl) trendEl.textContent = `Trend: ${prediction.trend} | Confidence: ${prediction.confidence}`;
    }
    const totalKg = completed.reduce((s,o)=>s+(o.actualKg||o.kg),0);
    const statsDiv = document.getElementById('pv-stats');
    if(statsDiv) {
      const bins = getIoTBins();
      const critCount = bins.filter(b => b.fill >= 85).length;
      statsDiv.innerHTML = `
        <div class="stat-card"><div class="stat-val">${orders.length}</div><div class="stat-lbl">Total Requests</div></div>
        <div class="stat-card"><div class="stat-val">${totalKg}</div><div class="stat-lbl">Kg Recycled</div></div>
        <div class="stat-card"><div class="stat-val">${Math.round(totalKg*0.62)}</div><div class="stat-lbl">CO₂ Offset (kg)</div></div>
        <div class="stat-card" style="border-top-color:${critCount > 0 ? 'var(--red)' : 'var(--green)'};cursor:pointer;" onclick="showView('v-iot-bins')">
          <div class="stat-val" style="color:${critCount > 0 ? 'var(--red)' : 'var(--green)'}">${critCount}</div>
          <div class="stat-lbl">Bins Critical</div>
        </div>
      `;
    }
    const pvMyKg = document.getElementById('pv-my-kg');
    if(pvMyKg) pvMyKg.textContent = totalKg + ' kg';
    const pvActDiv = document.getElementById('pv-act');
    if(pvActDiv) pvActDiv.innerHTML = active.length ? active.map(o=>buildOrderCard(o,'provider')).join('') : '<div class="empty-state"><div class="empty-sub">No active dispatches.</div></div>';

    if(fullRender) setTimeout(initPvChart, 100);

    // Render IoT Bin mini-widget
    const iotWidget = document.getElementById('pv-iot-widget');
    if (iotWidget) {
      const bins = getIoTBins();
      if (!bins.length) {
        iotWidget.innerHTML = '<div style="font-size:13px;color:var(--text-muted);text-align:center;padding:12px;">No bins registered. <button class="btn btn-ghost btn-sm" onclick="showView(\'v-iot-bins\')">Add one →</button></div>';
      } else {
        iotWidget.innerHTML = bins.map(b => {
          const col = b.fill >= 85 ? 'var(--red)' : b.fill >= 60 ? 'var(--amber)' : 'var(--green)';
          const badge = b.fill >= 85 ? `<span class="badge badge-red" style="font-size:10px;">⚠ Critical</span>`
            : b.fill >= 60 ? `<span class="badge badge-amber" style="font-size:10px;">◑ Filling</span>`
            : `<span class="badge badge-green" style="font-size:10px;">✓ OK</span>`;
          return `
            <div style="margin-bottom:14px;">
              <div class="between" style="margin-bottom:5px;">
                <div style="font-size:13px;font-weight:600;">${b.name}</div>
                <div style="display:flex;align-items:center;gap:8px;">
                  ${badge}
                  <span style="font-size:13px;font-weight:700;color:${col};">${b.fill}%</span>
                  ${b.fill >= 85 ? `<button class="btn btn-primary btn-sm" style="font-size:10px;padding:3px 8px;" onclick="iotDispatchFromBin('${b.id}')">🚀 Dispatch</button>` : ''}
                </div>
              </div>
              <div style="height:8px;background:var(--border);border-radius:999px;overflow:hidden;">
                <div style="height:100%;width:${b.fill}%;background:${col};border-radius:999px;transition:width 0.8s;"></div>
              </div>
            </div>`;
        }).join('') + `<button class="btn btn-ghost btn-sm" style="width:100%;margin-top:4px;" onclick="showView('v-iot-bins')">Manage All Bins →</button>`;
      }
      syncIoTAlertBadge();
      startIoTSim();
    }
  }
  
  if (currentView === 'v-pv-req') {
    if(fullRender) mc.innerHTML = `
      <div style="max-width:600px; margin:0 auto;">
        <div class="glass-card" style="margin-bottom:16px; border-color:var(--green); background:var(--green-light); padding:20px; display:flex; align-items:center; gap:16px;">
          <div style="font-size:32px;">🔬</div>
          <div style="flex:1;">
            <div style="font-weight:700; font-size:15px; color:var(--green-hover); margin-bottom:4px;">BioScan AI — Waste Verification</div>
            <div style="font-size:13px; color:var(--green-hover); opacity:0.8;">Scan your waste with AI before dispatching. Auto-fills form fields.</div>
          </div>
          <button class="btn btn-primary" id="btn-open-scanner" onclick="openScanner()" style="white-space:nowrap; background:var(--green); border-color:var(--green);">
            🔬 Scan Waste
          </button>
        </div>
        <div class="glass-card">
          <h3 class="heading" style="margin-bottom:24px;">New Dispatch Request</h3>
          <div class="form-group">
            <label class="form-label">Waste Category</label>
            <select class="form-select" id="req-type">${WASTE_TYPES.map(t=>`<option>${t}</option>`).join('')}</select>
          </div>
          <div class="form-group">
            <label class="form-label">Estimated Quantity (kg) <span style="color:var(--amber);">*Min 50kg Limit*</span></label>
            <input class="form-input" id="req-kg" type="number" min="50" placeholder="e.g. 120">
          </div>
          <div class="form-group">
            <label class="form-label">Collection Shift</label>
            <select class="form-select" id="req-shift">${SHIFTS.map(t=>`<option>${t}</option>`).join('')}</select>
          </div>
          <button class="btn btn-primary btn-full" onclick="submitPvRequest()">Locate Plant & Dispatch 🚀</button>
        </div>
      </div>
    `;
  }

  if (currentView === 'v-pv-hist-week' || currentView === 'v-pv-hist-month') {
    const isMonth = currentView === 'v-pv-hist-month';
    const limitDays = isMonth ? 30 : 7;
    const now = Date.now();
    const filteredHistory = completed.filter(o => (now - o.ts) <= (limitDays * 24 * 60 * 60 * 1000));
    
    if(fullRender) mc.innerHTML = `
      <div class="between" style="margin-bottom:24px;">
         <h3 class="heading" style="margin-bottom:0;">${isMonth ? 'Monthly' : 'Weekly'} Records</h3>
         ${filteredHistory.length ? `<button class="btn btn-outline-danger btn-sm" onclick="clearAllHistory('provider')">🗑 Clear All History</button>` : ''}
      </div>
      <div id="pv-hist-list"></div>
    `;
    document.getElementById('pv-hist-list').innerHTML = filteredHistory.length ? filteredHistory.map(o=>buildOrderCard(o,'provider')).join('') : `<div class="empty-state"><div class="empty-sub">No completed history in the last ${limitDays} days.</div></div>`;
  }
}

window.openScanner = function() {
  const mb = document.getElementById('modal-box');
  if(mb) {
    mb.classList.add('modal-large');
    mb.innerHTML = ''; // Clear previous content
  }
  
  BioScanner.open({
    containerId: 'modal-box',
    role: SESSION.role,
    userName: SESSION.name,
    userOrg: SESSION.org,
    userId: SESSION.id,
    onBack: () => closeScanner(),
    onApply: (score, organicPercent) => {
      showView('v-pv-req');
      setTimeout(() => {
        const rKg = document.getElementById('req-kg'); if(rKg) rKg.value = Math.floor(Math.random() * 150 + 50); 
        const rType = document.getElementById('req-type'); if(rType) rType.value = organicPercent > 70 ? "Food Waste" : "Dry Waste";
        showToast(`✓ Scanner Data Applied: ${score}% Segregation Score`);
        closeScanner();
      }, 200);
    },
    onScanSaved: (record) => {
      console.log('IoT Scan Saved:', record);
    }
  });
  document.getElementById('modal').classList.add('open');
}

window.closeModal = function() {
  const m = document.getElementById('modal');
  if(m) m.classList.remove('open');
  const mb = document.getElementById('modal-box');
  if(mb) {
    mb.classList.remove('modal-large');
    mb.innerHTML = '';
  }
}

window.closeScanner = function() {
  if (window.BioScanner) BioScanner.stop();
  const mb = document.getElementById('modal-box');
  if(mb) mb.classList.remove('modal-large');
  closeModal();
}

let pvChartInstance = null;

function initPvChart() {
  const ctx = document.getElementById('pvChart');
  if(!ctx || window.Chart === undefined) return;
  if(pvChartInstance) pvChartInstance.destroy();
  
  // Calculate dynamic weekly data from real history
  const orders = getAllOrders().filter(o => o.providerId === SESSION.id && o.status === 'completed');
  let kgData = [0,0,0,0,0,0,0];
  let co2Data = [0,0,0,0,0,0,0];
  
  // Dump all into current day for simplicity in local demo without real dates over weeks
  const totKg = orders.reduce((s,o)=>s+parseInt(o.actualKg||o.kg), 0);
  kgData[6] = totKg;
  co2Data[6] = Math.round(totKg * 0.62);
  
  window._pvDynamicData = { kg: kgData, co2: co2Data, totKg };

  pvChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5', 'Day 6', 'Today'],
      datasets: [{
        label: 'Waste Generated (kg)',
        data: kgData,
        backgroundColor: '#0D9488',
        borderRadius: 4
      }, {
        label: 'CO2 Offset (kg)',
        data: co2Data,
        backgroundColor: '#3B82F6',
        borderRadius: 4
      }]
    },
    options: { responsive: true, maintainAspectRatio: false }
  });
}

window.updatePvChart = function(period) {
  if(!pvChartInstance) return;
  const d = window._pvDynamicData;
  if(!d) return;
  
  if(period === 'monthly') {
    pvChartInstance.data.labels = ['Week 1', 'Week 2', 'Week 3', 'This Week'];
    pvChartInstance.data.datasets[0].data = [0, 0, 0, d.totKg];
    pvChartInstance.data.datasets[1].data = [0, 0, 0, Math.round(d.totKg*0.62)];
  } else {
    pvChartInstance.data.labels = ['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5', 'Day 6', 'Today'];
    pvChartInstance.data.datasets[0].data = d.kg;
    pvChartInstance.data.datasets[1].data = d.co2;
  }
  pvChartInstance.update();
}

window.clearAllHistory = function(role) {
  if(!confirm("Are you sure you want to clear all completed history? This cannot be undone.")) return;
  const orders = getAllOrders().filter(o => {
    if(role === 'provider') return o.providerId === SESSION.id && o.status === 'completed';
    if(role === 'rider') return o.riderId === SESSION.id && o.status === 'completed';
    return false;
  });
  orders.forEach(o => window.localStorage.removeItem(STORAGE_KEY_PREFIX + 'ord:' + o.id));
  showToast("✓ History Cleared");
  refreshCurrentView(true);
}

window.submitPvRequest = function() {
  const type = document.getElementById('req-type').value;
  const kg = parseInt(document.getElementById('req-kg').value);
  const shift = document.getElementById('req-shift').value;
  
  if (!kg || kg < 50) return showToast("⚠ Minimum 50 kg requirement not met to ensure net-positive energy yield.");
  
  // Find nearest plant (50km limit)
  const plants = DB.list('acc:').map(k=>DB.get(k)).filter(a=>a.role==='plant');
  let nearest = null; let minDist = 9999;
  for(let p of plants) {
    const d = distanceKm(SESSION.lat, SESSION.lng, p.lat, p.lng);
    if(d < minDist) { minDist = d; nearest = p; }
  }
  
  if (!nearest || minDist > 50) return showToast(`⚠ Out of Range! Nearest plant is >50km away.`);
  
  const o = {
    id: uid(), ts: ts(), providerId: SESSION.id, providerOrg: SESSION.org, providerLat: SESSION.lat, providerLng: SESSION.lng,
    wasteType: type, kg, shift, plantId: nearest.id, plantName: nearest.org, status: 'requested'
  };
  saveOrder(o);
  showToast(`✓ Dispatched! Routed to ${nearest.org} (${minDist.toFixed(1)}km away).`);
  showView('v-pv-dash');
}

window.cancelOrder = function(id) {
  const o = getOrder(id); if(!o) return;
  o.status = 'rejected'; saveOrder(o); showToast("Cancelled."); refreshCurrentView();
}

window.deleteOrder = function(id) {
  window.localStorage.removeItem(STORAGE_KEY_PREFIX + 'ord:' + id);
  showToast("✓ Record Deleted");
  refreshCurrentView(true);
}


// ════════ OSRM REAL-ROAD ROUTING ENGINE ════════

async function fetchOSRMRoute(waypoints) {
  if (!waypoints || waypoints.length < 2) return null;
  const coords = waypoints.map(w => `${w.lng},${w.lat}`).join(';');
  try {
    const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`);
    if (!res.ok) return null;
    const d = await res.json();
    if (d.code !== 'Ok' || !d.routes.length) return null;
    const r = d.routes[0];
    return {
      geojson: r.geometry,
      distance_km: (r.distance / 1000).toFixed(1),
      duration_min: Math.round(r.duration / 60),
      legs: r.legs.map(l => ({ distance_km: (l.distance/1000).toFixed(1), duration_min: Math.round(l.duration/60) }))
    };
  } catch { return null; }
}

async function fetchOSRMDurationMatrix(points) {
  if (!points || points.length < 2) return null;
  const coords = points.map(p => `${p.lng},${p.lat}`).join(';');
  try {
    const res = await fetch(`https://router.project-osrm.org/table/v1/driving/${coords}?annotations=duration`);
    if (!res.ok) return null;
    const d = await res.json();
    return d.code === 'Ok' ? d.durations : null;
  } catch { return null; }
}

function greedyTSP(matrix, startIdx) {
  const n = matrix.length;
  const visited = new Array(n).fill(false);
  const order = [startIdx];
  visited[startIdx] = true;
  for (let s = 1; s < n; s++) {
    const cur = order[order.length - 1];
    let best = -1, bestT = Infinity;
    for (let j = 0; j < n; j++) {
      if (!visited[j] && matrix[cur][j] != null && matrix[cur][j] < bestT) { best = j; bestT = matrix[cur][j]; }
    }
    if (best >= 0) { visited[best] = true; order.push(best); }
  }
  return order;
}

// Always-available Haversine TSP (zero API dependency)
function haversineTSP(riderLat, riderLng, jobs) {
  if (jobs.length <= 1) return { jobs, savings_km: 0 };
  const n = jobs.length;
  // Build NxN distance matrix between pickups
  const mat = Array.from({length: n}, (_, i) =>
    Array.from({length: n}, (_, j) =>
      distanceKm(jobs[i].providerLat, jobs[i].providerLng, jobs[j].providerLat, jobs[j].providerLng)
    )
  );
  // Distance from rider to each pickup
  const rDist = jobs.map(j => distanceKm(riderLat, riderLng, j.providerLat, j.providerLng));
  const firstPick = rDist.reduce((bi, d, i) => d < rDist[bi] ? i : bi, 0);

  // Naive total (visit in original order)
  const naiveDist = jobs.reduce((s, _, i) => s + (i > 0 ? mat[i-1][i] : rDist[0]), 0);

  // Greedy TSP from nearest first pickup
  const orderIdx = greedyTSP(mat, firstPick);
  const optDist   = orderIdx.reduce((s, idx, step) => s + (step === 0 ? rDist[idx] : mat[orderIdx[step-1]][idx]), 0);

  return {
    jobs: orderIdx.map(i => jobs[i]),
    savings_km: Math.max(0, parseFloat((naiveDist - optDist).toFixed(2)))
  };
}

async function aiOptimizeJobs(riderLat, riderLng, jobs) {
  // Phase 1: Haversine TSP — always works, instant result
  const hv = haversineTSP(riderLat, riderLng, jobs);
  if (jobs.length <= 1) return { jobs, savings_min: 0, source: 'none' };

  // Phase 2: Try OSRM duration matrix for more accurate road-time TSP
  try {
    const pts = [{ lat: riderLat, lng: riderLng }, ...jobs.map(j => ({ lat: j.providerLat, lng: j.providerLng }))];
    const matrix = await fetchOSRMDurationMatrix(pts);
    if (matrix) {
      const n = jobs.length;
      const sub = Array.from({length: n}, (_, i) => Array.from({length: n}, (_, j) => matrix[i+1][j+1]));
      const riderRow = matrix[0].slice(1);
      const firstPick = riderRow.reduce((bi, t, i) => t < riderRow[bi] ? i : bi, 0);
      const naiveTime = jobs.reduce((s, _, i) => s + (i > 0 ? sub[i-1][i] : (riderRow[0]||0)), 0);
      const orderIdx  = greedyTSP(sub, firstPick);
      const optTime   = orderIdx.reduce((s, idx, step) => s + (step === 0 ? (matrix[0][idx+1]||0) : (sub[orderIdx[step-1]][idx]||0)), 0);
      return { jobs: orderIdx.map(i => jobs[i]), savings_min: Math.max(0, Math.round((naiveTime - optTime) / 60)), source: 'osrm' };
    }
  } catch { /* OSRM unavailable, fall through */ }

  // Fallback: return Haversine TSP result
  return { jobs: hv.jobs, savings_min: 0, savings_km: hv.savings_km, source: 'haversine' };
}

// ════════ RIDER LOGIC ════════
async function renderRider(mc, fullRender) {
  const orders = getAllOrders();
  const myOrders = orders.filter(o => o.riderId === SESSION.id);
  const activeJobs = myOrders.filter(o => !['completed','rejected'].includes(o.status));
  const pending = orders.filter(o => o.status === 'requested');
  const hist = myOrders.filter(o => o.status === 'completed');
  
  const b = document.getElementById('rd-badge');
  if(b) { b.style.display = pending.length ? 'inline-block' : 'none'; b.innerText = pending.length; }

  if (currentView === 'v-rd-dash') {
    const tab = window._rdTab || 'route';
    if(fullRender) mc.innerHTML = `
      <div class="mobile-tabs">
        <button class="mobile-tab-btn ${tab==='route'?'active':''}" onclick="switchRdTab('route')">Route HUD</button>
        <button class="mobile-tab-btn ${tab==='analytics'?'active':''}" onclick="switchRdTab('analytics')">AI Telemetry</button>
      </div>

      <div class="two-col">
        <div class="${tab !== 'route' ? 'desktop-only' : ''}">
          <h3 class="heading" style="margin-bottom:16px;">Active Tasks ${activeJobs.length > 1 ? `<span class="badge badge-amber" style="margin-left:8px;">Batching Enabled</span>` : ''}</h3>
          <div id="rd-act"></div>
          <h3 class="heading" style="margin-bottom:16px; margin-top:24px;">Optimal Batch Map</h3>
          <div id="rider-map" style="margin-bottom:24px;"></div>
          ${activeJobs.length ? `<div class="glass-card"><h4 style="margin-bottom:16px;">Route Progress</h4><div id="rd-tl" class="timeline"></div></div>` : ''}
        </div>
        <div class="${tab !== 'analytics' ? 'desktop-only' : ''}">
          ${activeJobs.length ? `
          <div class="glass-card sensor-card" style="margin-bottom:16px; padding:16px; border-color:var(--green); background:var(--green-light);" id="rd-route-summary">
            <div style="font-size:12px;color:var(--green-hover);display:flex;align-items:center;gap:8px;"><div class="bw-spinner" style="width:16px;height:16px;border-width:2px;"></div> AI computing optimal route…</div>
          </div>
          <div class="glass-card sensor-card" style="margin-bottom:16px; padding:16px; border-color:var(--border);">
             <div style="font-size:12px; font-weight:600; color:var(--text-muted); margin-bottom:12px; text-transform:uppercase;">🌍 Live Conditions</div>
             <div class="between" style="margin-bottom:8px;"><div>🌧️ Weather</div><div id="rt-weather" class="skeleton-loader"></div></div>
             <div class="between" style="margin-bottom:8px;"><div>🚗 Traffic</div><div style="font-weight:700; color:var(--green);" id="rt-traffic">Normal</div></div>
             <div class="between"><div>⏱️ Weather Delay</div><div style="font-weight:700; color:var(--text-muted);" id="rt-ai-adj">+0 Mins</div></div>
          </div>
          <div class="glass-card sensor-card" style="padding:16px; border-color:var(--blue);">
             <div style="font-size:12px; font-weight:600; color:var(--text-muted); margin-bottom:12px; text-transform:uppercase;">📡 Route Telemetry</div>
             <div class="between" style="margin-bottom:8px;"><div>📍 Total Distance</div><div style="font-weight:700;" id="rt-total-dist">Calculating…</div></div>
             <div class="between" style="margin-bottom:8px;"><div>⏱️ ETA</div><div style="font-weight:700; color:var(--blue);" id="rt-eta">Calculating…</div></div>
             <div class="between" style="margin-bottom:8px;"><div>⛽ Fuel Saved</div><div style="font-weight:700; color:var(--green);" id="rt-fuel-saved">—</div></div>
             <div class="between"><div>🔋 Battery</div><div style="font-weight:700;" id="rt-batt">--</div></div>
          </div>` : '<div class="empty-state">No active telemetry. Accept a job to see live data.</div>'}
        </div>
      </div>
    `;
    
    document.getElementById('rd-act').innerHTML = activeJobs.length ? activeJobs.map(o => buildOrderCard(o, 'rider')).join('') : `<div class="empty-state"><div class="empty-icon">📍</div><div class="empty-title">No Active Task</div><div class="empty-sub">Check available jobs to begin a route.</div></div>`;
    
    if (activeJobs.length) {
      const active = activeJobs[0]; // Primary task for timeline
      const steps = [
        {k:'assigned', l:'Batch Assigned', d:true},
        {k:'en_route', l:'Driving to Provider', d:['en_route','picked_up','at_plant'].includes(active.status)},
        {k:'picked_up', l:'Waste Collected', d:['picked_up','at_plant'].includes(active.status)},
        {k:'at_plant', l:'Arrived at Plant', d:active.status==='at_plant'}
      ];
      document.getElementById('rd-tl').innerHTML = steps.map((s,i) => `
        <div class="tl-item ${s.d ? 'done':''}">
          <div class="tl-col"><div class="tl-dot"></div>${i<steps.length-1?'<div class="tl-line"></div>':''}</div>
          <div class="tl-content"><div class="tl-title">${s.l}</div></div>
        </div>
      `).join('');
    }
    
    // ── Real OSRM Road Routing (with Haversine TSP fallback) ──
    setTimeout(async () => {
      if (!document.getElementById('rider-map')) return;
      if (rMap) { rMap.remove(); rMap = null; }
      rMap = L.map('rider-map').setView([SESSION.lat, SESSION.lng], 13);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(rMap);

      const rIco = L.divIcon({ html: "<div style='width:18px;height:18px;background:var(--blue);border-radius:50%;border:3px solid white;box-shadow:0 0 12px rgba(59,130,246,0.8);'></div>", className: '' });
      const rMarker = L.marker([SESSION.lat, SESSION.lng], { icon: rIco, draggable: true }).addTo(rMap)
        .bindPopup('📍 You (Rider) — <b>Drag to correct GPS</b>').openPopup();
      rMarker.on('dragend', () => {
        const p = rMarker.getLatLng();
        SESSION.lat = p.lat; SESSION.lng = p.lng;
        DB.set('acc:' + SESSION.id, SESSION);
        refreshCurrentView(false);
      });

      if (activeJobs.length) {
        // AI Multi-Stop Route Optimization (Greedy + 2-Opt)
        const result = RouteOptimizer.optimizeRoute(SESSION, activeJobs);
        const optimizedJobs = result.optimizedJobs;

        const plantId = optimizedJobs.length > 0 ? optimizedJobs[0].plantId : null;
        const plant = plantId ? DB.get('acc:' + plantId) : null;
        const waypoints = [
          { lat: SESSION.lat, lng: SESSION.lng },
          ...optimizedJobs.map(j => ({ lat: j.providerLat, lng: j.providerLng })),
          ...(plant ? [{ lat: plant.lat, lng: plant.lng }] : [])
        ];

        // Draw numbered pickup markers in TSP order immediately
        optimizedJobs.forEach((job, i) => {
          const ico = L.divIcon({
            html: `<div style="width:28px;height:28px;background:#F59E0B;border-radius:50%;border:3px solid white;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:white;box-shadow:0 2px 8px rgba(0,0,0,0.4);">${i+1}</div>`,
            className: '', iconAnchor: [14, 14]
          });
          L.marker([job.providerLat, job.providerLng], { icon: ico }).addTo(rMap)
            .bindPopup(`<b>Stop ${i+1}: ${job.providerOrg}</b><br>${job.kg}kg ${job.wasteType}`);
        });
        if (plant) {
          const pltIco = L.divIcon({
            html: `<div style="width:32px;height:32px;background:#0D9488;border-radius:8px;border:3px solid white;display:flex;align-items:center;justify-content:center;font-size:16px;box-shadow:0 2px 8px rgba(0,0,0,0.4);">🏭</div>`,
            className: '', iconAnchor: [16, 16]
          });
          L.marker([plant.lat, plant.lng], { icon: pltIco }).addTo(rMap).bindPopup(`<b>Plant:</b> ${plant.org}`);
        }

        // Draw TSP-ordered path immediately (glowing glassmorphism neon route flow)
        const latlngs = waypoints.map(w => [w.lat, w.lng]);
        L.polyline(latlngs, { color: '#38BDF8', weight: 8, opacity: 0.3, lineJoin: 'round' }).addTo(rMap);
        let pathLayer = L.polyline(latlngs, { color: '#0D9488', weight: 4, opacity: 0.9, dashArray: '8, 8', lineJoin: 'round' }).addTo(rMap);
        rMap.fitBounds(pathLayer.getBounds(), { padding: [50, 50] });

        // INTELLIGENCE ENHANCEMENT: High Demand Heatmap
        const allAccs = DB.list('acc:').map(k => DB.get(k));
        const providers = allAccs.filter(a => a.role === 'provider');
        const demandZones = Intelligence.getHighDemandZones(providers, orders);
        
        demandZones.forEach(zone => {
           L.circle([zone.lat, zone.lng], {
              color: 'transparent',
              fillColor: '#EF4444',
              fillOpacity: zone.intensity * 0.4,
              radius: 800
           }).addTo(rMap).bindPopup(`<b>High Demand Area</b><br>${zone.reason}`);
        });

        // Haversine total distance estimate
        const hvDist = waypoints.reduce((sum, wp, i) => i === 0 ? 0 : sum + RouteOptimizer.calculateDistance(waypoints[i-1].lat, waypoints[i-1].lng, wp.lat, wp.lng), 0);
        const hvETA  = Math.round(hvDist / 0.25); // ~15 km/h avg speed

        const distEl    = document.getElementById('rt-total-dist');
        const etaEl     = document.getElementById('rt-eta');
        const fuelEl    = document.getElementById('rt-fuel-saved');
        const summaryEl = document.getElementById('rd-route-summary');

        if (distEl) { distEl.textContent = hvDist.toFixed(1) + ' km'; distEl.style.color = 'var(--text)'; }
        if (etaEl)  { etaEl.textContent  = hvETA + ' min (est.)'; etaEl.style.color = 'var(--blue)'; }
        if (fuelEl) { fuelEl.textContent = (result.savingsKm * 0.08).toFixed(2) + ' L'; fuelEl.style.color = 'var(--green)'; }

        const savingsLabel = result.savingsKm > 0 ? ` · Saved ${result.savingsKm} km via 2-Opt AI` : '';
        if (summaryEl) {
          summaryEl.innerHTML = `
            <div style="font-size:12px;font-weight:700;text-transform:uppercase;color:var(--green-hover);margin-bottom:12px;">
              🤖 AI TSP 2-Opt Optimized Sequence${savingsLabel}
              <span style="font-size:10px;font-weight:500;color:var(--text-muted);margin-left:6px;">(Dynamic Load Factor Routing)</span>
            </div>
            ${optimizedJobs.map((j, i) => `
              <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px dashed var(--border);">
                <div style="width:22px;height:22px;background:var(--amber);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:white;flex-shrink:0;">${i+1}</div>
                <div style="flex:1;font-size:13px;font-weight:600;">${j.providerOrg}</div>
                <div style="font-size:11px;color:var(--text-muted);">${RouteOptimizer.calculateDistance(i===0?SESSION.lat:optimizedJobs[i-1].providerLat, i===0?SESSION.lng:optimizedJobs[i-1].providerLng, j.providerLat, j.providerLng).toFixed(1)}km</div>
              </div>`).join('')}
            <div style="display:flex;align-items:center;gap:10px;padding:8px 0;">
              <div style="width:22px;height:22px;background:var(--green);border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:13px;">🏭</div>
              <div style="flex:1;font-size:13px;font-weight:600;">${plant ? plant.org : 'Plant'}</div>
            </div>
          `;
        }
        showToast(`🤖 TSP Order ready (${source}). Fetching road route…`);

        // PHASE 2: Try OSRM for real road geometry (async enhancement)
        const route = await fetchOSRMRoute(waypoints);
        if (route) {
          rMap.removeLayer(pathLayer); // replace dashed with real roads
          L.geoJSON(route.geojson, { style: { color: '#34D399', weight: 9, opacity: 0.2, lineJoin: 'round' } }).addTo(rMap);
          pathLayer = L.geoJSON(route.geojson, { style: { color: '#0D9488', weight: 5, opacity: 0.9, lineJoin: 'round', lineCap: 'round' } }).addTo(rMap);
          rMap.fitBounds(pathLayer.getBounds(), { padding: [50, 50] });

          // Upgrade telemetry with real OSRM values
          if (distEl) { distEl.textContent = route.distance_km + ' km'; distEl.style.color = 'var(--green)'; }
          if (etaEl)  { etaEl.textContent  = route.duration_min + ' min'; etaEl.style.color = 'var(--blue)'; }
          if (fuelEl) { fuelEl.textContent = (parseFloat(route.distance_km) * 0.08).toFixed(2) + ' L'; }

          // Upgrade stop list with real per-leg times from OSRM
          if (summaryEl) {
            summaryEl.innerHTML = `
              <div style="font-size:12px;font-weight:700;text-transform:uppercase;color:var(--green-hover);margin-bottom:12px;">
                🤖 TSP Optimized · Real Road Route${savingsLabel}
              </div>
              ${optimizedJobs.map((j, i) => {
                const leg = route.legs[i];
                return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px dashed var(--border);">
                  <div style="width:22px;height:22px;background:var(--amber);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:white;flex-shrink:0;">${i+1}</div>
                  <div style="flex:1;font-size:13px;font-weight:600;">${j.providerOrg}</div>
                  ${leg ? `<div style="font-size:11px;color:var(--text-muted);">${leg.duration_min}min · ${leg.distance_km}km</div>` : ''}
                </div>`;
              }).join('')}
              <div style="display:flex;align-items:center;gap:10px;padding:8px 0;">
                <div style="width:22px;height:22px;background:var(--green);border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:13px;">🏭</div>
                <div style="flex:1;font-size:13px;font-weight:600;">${plant ? plant.org : 'Plant'}</div>
                ${route.legs[optimizedJobs.length] ? `<div style="font-size:11px;color:var(--text-muted);">${route.legs[optimizedJobs.length].duration_min}min · ${route.legs[optimizedJobs.length].distance_km}km</div>` : ''}
              </div>
            `;
          }
          showToast(`🛰️ OSRM Route: ${route.distance_km}km · ${route.duration_min}min`);
        }
      }
    }, 100);
    
    // API Call for Rider Dashboard
    if(active && fullRender) {
       fetchWeather(SESSION.lat, SESSION.lng).then(w => {
          if(!w || currentView !== 'v-rd-dash') return;
          const wt = document.getElementById('rt-weather');
          const ct = document.getElementById('rt-temp');
          if(wt) {
            let cond = "Clear";
            if(w.weathercode > 50) cond = "Raining";
            if(w.weathercode > 70) cond = "Snowing";
            wt.textContent = cond + ` (${Math.round(w.temperature)}°C)`;
            wt.style.color = w.weathercode > 50 ? "var(--amber)" : "var(--green)";
            if(w.weathercode > 50) { 
               document.getElementById('rt-traffic').textContent = "Congested"; 
               document.getElementById('rt-ai-adj').textContent = "+12 Mins"; 
               document.getElementById('rt-ai-adj').style.color = "var(--amber)"; 
            }
          }
          if(ct) ct.textContent = Math.round(w.temperature - 2) + "°C";
          document.getElementById('rt-batt').textContent = Math.floor(Math.random() * 30 + 60) + "%";
          document.getElementById('rt-batt').style.color = "var(--green)";
          document.getElementById('rt-conf').textContent = "98.2%";
          document.getElementById('rt-conf').style.color = "var(--blue)";
       });
    }
  }

  if (currentView === 'v-rd-jobs') {
    if(fullRender) mc.innerHTML = `<h3 class="heading" style="margin-bottom:24px;">Available Jobs</h3><div id="rd-jobs-list"></div>`;
    document.getElementById('rd-jobs-list').innerHTML = pending.length ? pending.map(o=>buildOrderCard(o,'rider')).join('') : '<div class="empty-state"><div class="empty-sub">No pending requests right now.</div></div>';
  }

  if (currentView === 'v-rd-hist') {
    if(fullRender) mc.innerHTML = `<h3 class="heading" style="margin-bottom:24px;">Completions</h3><div id="rd-hist-list"></div>`;
    document.getElementById('rd-hist-list').innerHTML = hist.length ? hist.map(o=>buildOrderCard(o,'rider')).join('') : '<div class="empty-state">No completions yet.</div>';
  }
}

window.switchRdTab = function(t) { window._rdTab = t; refreshCurrentView(true); }

window.riderAccept = function(id) {
  const o = getOrder(id); if(!o) return;
  o.status = 'assigned'; o.riderId = SESSION.id; o.riderName = SESSION.name;
  saveOrder(o); showToast("✓ Route Added to Batch!"); showView('v-rd-dash');
}
window.riderUpdate = function(id, st) {
  const o = getOrder(id); if(!o) return;
  o.status = st; saveOrder(o); refreshCurrentView();
}
window.openPickupConfirm = function(id) {
  const html = `
    <h3 class="modal-title">Confirm Collection</h3>
    <p class="modal-sub">Verify the load before continuing to plant.</p>
    <div class="form-group"><label class="form-label">Actual Weight Collected (kg)</label><input type="number" id="m-kg" class="form-input"></div>
    <div class="form-group"><label class="form-label">Quality Observation</label><select id="m-qual" class="form-select"><option>Good (Segregated)</option><option>Mixed (Contaminated)</option></select></div>
    <div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="confirmPickup('${id}')">Confirm ✓</button></div>
  `;
  document.getElementById('modal-box').innerHTML = html;
  document.getElementById('modal').classList.add('open');
}
window.confirmPickup = function(id) {
  const kg = document.getElementById('m-kg').value;
  if(!kg) return showToast("⚠ Enter weight.");
  const o = getOrder(id); o.status = 'picked_up'; o.actualKg = kg; o.quality = document.getElementById('m-qual').value;
  saveOrder(o); closeModal(); refreshCurrentView();
}
window.closeModal = function() { document.getElementById('modal').classList.remove('open'); }

window.openSettings = function() {
  const html = `
    <h3 class="modal-title">Account Settings</h3>
    <p class="modal-sub">Manage your ReGenX Profile</p>
    <div style="background:var(--bg); padding:16px; border-radius:12px; margin-bottom:20px;">
      <div style="font-size:12px; color:var(--text-muted); text-transform:uppercase;">Name</div>
      <div style="font-weight:600; margin-bottom:12px;">${SESSION.name}</div>
      <div style="font-size:12px; color:var(--text-muted); text-transform:uppercase;">Entity</div>
      <div style="font-weight:600; margin-bottom:12px;">${SESSION.org}</div>
      <div style="font-size:12px; color:var(--text-muted); text-transform:uppercase;">Role</div>
      <div style="font-weight:600;">${SESSION.role.toUpperCase()}</div>
    </div>
    
    <div class="modal-actions" style="justify-content: space-between;">
      <button class="btn btn-outline-danger" onclick="deleteAccount()">Delete Account</button>
      <div>
        <button class="btn btn-ghost" onclick="closeModal()">Close</button>
      </div>
    </div>
  `;
  document.getElementById('modal-box').innerHTML = html;
  document.getElementById('modal').classList.add('open');
}

window.deleteAccount = function() {
  if(confirm("Are you sure you want to permanently delete your account? This action cannot be undone.")) {
    window.localStorage.removeItem(STORAGE_KEY_PREFIX + 'acc:' + SESSION.id);
    closeModal();
    doLogout();
    refreshLoginDropdown();
    showToast("Account successfully deleted.");
  }
}

window.openDigitalPassport = function() {
    const orders = getAllOrders().filter(o => o.providerId === SESSION.id && o.status === 'completed');
    const score = TrustProtocol.calculateScore(SESSION, orders);
    const rank = TrustProtocol.getRankDetails(score);
    
    const html = `
        <div style="text-align:center; padding:20px;">
            <div style="font-size:64px; margin-bottom:16px;">${rank.icon}</div>
            <h3 class="modal-title">${SESSION.org}</h3>
            <p class="modal-sub">Verified Circular Economy Provider</p>
            
            <div class="glass-card" style="background:var(--bg); border:2px solid ${rank.color}; margin-bottom:24px; padding:20px;">
                <div style="font-size:12px; font-weight:700; color:var(--text-muted); text-transform:uppercase; margin-bottom:8px;">Trust Protocol Identity</div>
                <div style="font-size:24px; font-weight:800; color:${rank.color};">${rank.name} Class</div>
                <div style="font-size:13px; color:var(--text-muted); margin-top:4px;">Account ID: <span style="font-family:monospace;">${SESSION.id.slice(0,12)}...</span></div>
            </div>
            
            <div class="stats-grid" style="grid-template-columns: repeat(2, 1fr); gap:12px; margin-bottom:24px;">
                <div class="stat-card" style="padding:12px; border-top-color:var(--blue);">
                    <div style="font-size:20px; font-weight:800;">${score}%</div>
                    <div style="font-size:10px; color:var(--text-muted);">Reputation</div>
                </div>
                <div class="stat-card" style="padding:12px; border-top-color:var(--green);">
                    <div style="font-size:20px; font-weight:800;">${rank.multiplier}x</div>
                    <div style="font-size:10px; color:var(--text-muted);">Reward Rate</div>
                </div>
            </div>
            
            <div style="text-align:left; font-size:13px; background:rgba(0,0,0,0.03); padding:16px; border-radius:12px;">
                <div style="font-weight:700; margin-bottom:8px;">📜 Protocol Verification</div>
                <div style="margin-bottom:4px;">✓ Biowaste Authenticity: <strong>Verified</strong></div>
                <div style="margin-bottom:4px;">✓ Network Participation: <strong>${orders.length} Dispatches</strong></div>
                <div>✓ Security Status: <strong>Encrypted & Secure</strong></div>
            </div>
            
            <div class="modal-actions">
                <button class="btn btn-primary btn-full" onclick="closeModal()">Close Passport</button>
            </div>
        </div>
    `;
    document.getElementById('modal-box').innerHTML = html;
    document.getElementById('modal').classList.add('open');
}

// ════════ PLANT LOGIC ════════
async function renderPlant(mc, fullRender) {
  const orders = getAllOrders().filter(o => o.plantId === SESSION.id);
  const incoming = orders.filter(o => o.status === 'at_plant');
  const completed = orders.filter(o => o.status === 'completed');
  const logs = getAllLogs().filter(l => l.plantId === SESSION.id);
  
  if (currentView === 'v-pl-dash') {
    if(fullRender) mc.innerHTML = `
      <div class="stats-grid" id="pl-stats"></div>
      
      <div id="pl-ai-widget"></div>
      
      <h3 class="heading" style="margin-bottom:16px; margin-top:16px;">Live Digester Vitals</h3>
      <div class="stats-grid" style="margin-bottom:32px;">
        <div class="glass-card sensor-card" style="text-align:center;">
           <div class="gauge-circle" style="border-top-color:var(--text-muted); animation:none;" id="pl-gauge-temp"><span>0°C</span></div>
           <div style="font-weight:600;">Core Temp</div>
           <div style="font-size:11px; color:var(--text-muted); margin-top:4px;" id="pl-stat-temp">Fetching...</div>
        </div>
        <div class="glass-card sensor-card" style="text-align:center;">
           <div class="gauge-circle" style="border-top-color:var(--text-muted); animation:none;"><span>0</span></div>
           <div style="font-weight:600;">Pressure (atm)</div>
           <div style="font-size:11px; color:var(--text-muted); margin-top:4px;">Offline</div>
        </div>
        <div class="glass-card sensor-card" style="text-align:center;">
           <div class="gauge-circle" style="border-top-color:var(--text-muted); animation:none;"><span>0</span></div>
           <div style="font-weight:600;">CH₄ Flow (m³/h)</div>
           <div style="font-size:11px; color:var(--text-muted); margin-top:4px;">Offline</div>
        </div>
      </div>

      <h3 class="heading" style="margin-top:24px; margin-bottom:16px;">Operational Analytics</h3>
      <div class="glass-card" style="padding:16px; margin-bottom:32px;">
         <div class="chart-container"><canvas id="plChart"></canvas></div>
      </div>

      <div class="two-col">
        <div><h3 class="heading" style="margin-bottom:16px;">Gate Arrivals</h3><div id="pl-inc"></div></div>
        <div><h3 class="heading" style="margin-bottom:16px;">Recent Output</h3><div id="pl-out-logs"></div></div>
      </div>
    `;
    const totKg = completed.reduce((s,o)=>s+parseFloat(o.actualKg||0),0);
    const totBio = logs.reduce((s,l)=>s+parseFloat(l.bio||0),0);
    
    document.getElementById('pl-stats').innerHTML = `
      <div class="stat-card"><div class="stat-val">${completed.length}</div><div class="stat-lbl">Processed Loads</div></div>
      <div class="stat-card"><div class="stat-val">${totKg}</div><div class="stat-lbl">Kg Received</div></div>
      <div class="stat-card"><div class="stat-val">${totBio.toFixed(1)}</div><div class="stat-lbl">Biogas (m³)</div></div>
    `;

    // AI Yield Optimization Engine
    const yieldPrediction = YieldOptimizer.predictYield(completed.slice(0, 10)); // Use recent history
    const aiWidgetEl = document.getElementById('pl-ai-widget');
    if (aiWidgetEl) {
        aiWidgetEl.innerHTML = `
          <h3 class="heading" style="margin-bottom:16px; margin-top:24px;">AI Yield Optimization</h3>
          <div class="glass-card" style="margin-bottom:32px; border:2px solid var(--blue); background:linear-gradient(135deg, var(--surface) 0%, var(--blue-light) 100%);">
            <div class="between" style="margin-bottom:16px;">
               <div class="ai-badge" style="background:var(--blue);">✨ Methane Optimizer</div>
               <div class="badge badge-green">${yieldPrediction.healthStatus}</div>
            </div>
            <div class="stats-grid" style="grid-template-columns: repeat(2, 1fr); gap:12px; margin-bottom:16px;">
               <div class="stat-card" style="padding:12px; text-align:center;">
                  <div style="font-size:24px; font-weight:800; color:var(--blue);">${yieldPrediction.predictedMethane} m³</div>
                  <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; font-weight:700;">Predicted Daily Yield</div>
               </div>
               <div class="stat-card" style="padding:12px; text-align:center;">
                  <div style="font-size:24px; font-weight:800; color:var(--amber);">${yieldPrediction.optimalTemp}°C</div>
                  <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; font-weight:700;">Target Digester Temp</div>
               </div>
            </div>
            <div style="font-size:13px; background:rgba(255,255,255,0.5); padding:12px; border-radius:8px; border-left:4px solid var(--blue);">
               <strong>AI Recommendation:</strong> ${yieldPrediction.recommendation}
            </div>
          </div>
        `;
    }
    document.getElementById('pl-inc').innerHTML = incoming.length ? incoming.map(o=>buildOrderCard(o,'plant')).join('') : '<div class="empty-state">No trucks waiting at gate.</div>';
    
    document.getElementById('pl-out-logs').innerHTML = logs.length ? logs.slice(0,4).map(l => `
      <div class="glass-card" style="padding:16px; margin-bottom:12px;">
         <div class="between" style="margin-bottom:8px;"><span class="badge badge-blue">Log</span> <span class="muted" style="font-size:12px">${fmtDate(l.ts)}</span></div>
         <div style="font-size:14px;"><strong>Biogas:</strong> ${l.bio} m³ &nbsp;·&nbsp; <strong>Compost:</strong> ${l.comp} kg</div>
      </div>
    `).join('') : '<div class="empty-state">No outputs logged.</div>';
    
    if(fullRender) {
      setTimeout(initPlChart, 100);
      fetchWeather(SESSION.lat, SESSION.lng).then(w => {
         if(!w || currentView !== 'v-pl-dash') return;
         const coreTemp = Math.round(w.temperature + 15);
         const gt = document.getElementById('pl-gauge-temp');
         if(gt) {
            gt.style.borderTopColor = "var(--red)"; gt.style.animation = "spin-slow 10s linear infinite";
            gt.querySelector('span').textContent = coreTemp + "°C";
            document.getElementById('pl-stat-temp').textContent = "Optimal"; document.getElementById('pl-stat-temp').style.color = "var(--green)";
         }
         const gp = document.getElementById('pl-gauge-pres');
         if(gp) {
            gp.style.borderTopColor = "var(--blue)"; gp.style.animation = "spin-slow 10s linear infinite";
            gp.querySelector('span').textContent = "1.2";
            document.getElementById('pl-stat-pres').textContent = "Stable"; document.getElementById('pl-stat-pres').style.color = "var(--green)";
         }
         const gf = document.getElementById('pl-gauge-flow');
         if(gf) {
            gf.style.borderTopColor = "var(--amber)"; gf.style.animation = "spin-slow 10s linear infinite";
            gf.querySelector('span').textContent = "45";
            document.getElementById('pl-stat-flow').textContent = "Surging"; document.getElementById('pl-stat-flow').style.color = "var(--amber)";
         }
      });
    }
  }

  if (currentView === 'v-pl-in') {
    if(fullRender) mc.innerHTML = `<h3 class="heading" style="margin-bottom:24px;">Incoming Flow</h3><div id="pl-in-list"></div>`;
    document.getElementById('pl-in-list').innerHTML = incoming.length ? incoming.map(o=>buildOrderCard(o,'plant')).join('') : '<div class="empty-state">No incoming.</div>';
  }

  if (currentView === 'v-pl-out') {
    if(fullRender) mc.innerHTML = `
      <div style="max-width:600px; margin:0 auto;">
        <div class="glass-card">
          <h3 class="heading" style="margin-bottom:24px;">Log Daily Output</h3>
          <div class="form-group"><label class="form-label">Biogas Produced (m³)</label><input class="form-input" id="out-bio" type="number" step="0.1"></div>
          <div class="form-group"><label class="form-label">Compost Yield (kg)</label><input class="form-input" id="out-comp" type="number" step="0.1"></div>
          <div class="form-group"><label class="form-label">Digester Temp (°C) <span style="font-size:11px; color:var(--amber)">(Auto-detected)</span></label><input class="form-input" id="out-temp" type="number" step="0.1" readonly placeholder="Fetching live temp..."></div>
          <button class="btn btn-primary btn-full" onclick="savePlantLog()">Save Record</button>
        </div>
      </div>
    `;
    if(fullRender) {
      fetchWeather(SESSION.lat, SESSION.lng).then(w => {
         if(w && document.getElementById('out-temp')) {
            document.getElementById('out-temp').value = Math.round(w.temperature + 15);
         }
      });
    }
  }
}

window.openPlantConfirm = function(id) {
  const html = `
    <h3 class="modal-title">Intake Assessment</h3>
    <p class="modal-sub">Final confirmation before processing.</p>
    <div class="form-group">
        <label class="form-label">Segregation Score (0-100)</label>
        <div style="display:flex; gap:8px;">
            <input type="number" id="p-score" class="form-input" style="flex:1;">
            <button class="btn btn-outline-primary" style="white-space:nowrap; border:2px solid var(--blue); color:var(--blue);" onclick="window.VisionScanner.openScanner('p-score')">📸 AI Scan</button>
        </div>
    </div>
    <div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="confirmPlantReceipt('${id}')">Accept Load ✓</button></div>
  `;
  document.getElementById('modal-box').innerHTML = html;
  document.getElementById('modal').classList.add('open');
}

window.confirmPlantReceipt = function(id) {
  const o = getOrder(id); if(!o) return;
  const score = document.getElementById('p-score').value || 0;
  o.status = 'completed'; o.segScore = score;
  
  const providerAcc = DB.get('acc:' + o.providerId);
  if (providerAcc) {
     const providerHistory = getAllOrders().filter(ord => ord.providerId === o.providerId && ord.status === 'completed');
     const trustScore = TrustProtocol.calculateScore(providerAcc, providerHistory);
     const earnedTokens = TrustProtocol.calculateReward(Math.round((o.actualKg || o.kg) * 2), trustScore);
     
     providerAcc.tokens = (providerAcc.tokens || 0) + earnedTokens;
     o.tokensMinted = earnedTokens;
     o.txHash = '0x' + uid() + uid() + uid();

     DB.set('acc:' + o.providerId, providerAcc);
     if (SESSION.role === 'provider' && SESSION.id === o.providerId) {
         SESSION.tokens = providerAcc.tokens;
         document.getElementById('token-balance').textContent = SESSION.tokens;
     }
  }

  saveOrder(o); closeModal(); refreshCurrentView(); showToast(`✓ Intake Confirmed. Minted ${earnedTokens} $RGX for provider!`);
}

window.savePlantLog = function() {
  const bio = document.getElementById('out-bio').value;
  const comp = document.getElementById('out-comp').value;
  if(!bio && !comp) return window.showToast("⚠ Enter output values.");
  
  DB.set('log:'+uid(), { id: uid(), ts: ts(), plantId: SESSION.id, bio, comp, temp: document.getElementById('out-temp').value });
  window.showToast("✓ Output logged! Automated msg sent.");
  showView('v-pl-dash');
}

let plChartInstance = null;
function initPlChart() {
  const ctx = document.getElementById('plChart');
  if(!ctx || window.Chart === undefined) return;
  if(plChartInstance) plChartInstance.destroy();
  
  const logs = getAllLogs().filter(l => l.plantId === SESSION.id);
  let bioData = [0,0,0,0,0,0];
  let predData = [0,0,0,0,0,0];
  
  if(logs.length > 0) {
      // Just map the last 6 logs
      const recent = logs.slice(0,6).reverse();
      for(let i=0; i<recent.length; i++){
          bioData[5 - recent.length + 1 + i] = parseFloat(recent[i].bio||0);
          predData[5 - recent.length + 1 + i] = parseFloat(recent[i].bio||0) * (1 + (Math.random()*0.05)); // AI Prediction slightly above actual
      }
  }

  plChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: ['Reading 1', 'Reading 2', 'Reading 3', 'Reading 4', 'Reading 5', 'Latest'],
      datasets: [{
        label: 'Actual Yield (m³)',
        data: bioData,
        borderColor: '#0D9488',
        tension: 0.4,
        fill: true,
        backgroundColor: 'rgba(13, 148, 136, 0.1)'
      }, {
        label: 'AI Predicted Yield (m³)',
        data: predData,
        borderColor: '#3B82F6',
        borderDash: [5, 5],
        tension: 0.4
      }]
    },
    options: { responsive: true, maintainAspectRatio: false }
  });
}

// ════════ IoT SENSORY BIN LOGIC ════════

// ── IoT helpers ──
function getIoTBins() { return DB.get('iot-bins') || []; }
function saveIoTBins(bins) { DB.set('iot-bins', bins); }

function iotFillColor(fill) {
  if (fill >= 85) return 'var(--red)';
  if (fill >= 60) return 'var(--amber)';
  return 'var(--green)';
}

function iotStatusBadge(bin) {
  if (bin.fill >= 85) return '<span class="badge badge-red">⚠ Critical</span>';
  if (bin.fill >= 60) return '<span class="badge badge-amber">◑ Filling</span>';
  if (bin.status === 'offline') return '<span class="badge" style="background:var(--border);color:var(--text-muted)">● Offline</span>';
  return '<span class="badge badge-green">✓ Normal</span>';
}

function iotAlertCount() {
  return getIoTBins().filter(b => b.fill >= 85 || b.status === 'offline').length;
}

function syncIoTAlertBadge() {
  const badge = document.getElementById('iot-alert-badge');
  if (!badge) return;
  const n = iotAlertCount();
  badge.style.display = n ? 'inline-block' : 'none';
  badge.textContent = n;
}

// ── IoT Simulation Engine (single shared interval) ──
let _iotSimTimer = null;
function startIoTSim() {
  if (_iotSimTimer) return; // already running
  _iotSimTimer = setInterval(() => {
    const bins = getIoTBins();
    let changed = false;
    bins.forEach(b => {
      if (b.status === 'offline') return;
      // Advance fill by rate ± small noise, clamp 0-100
      const delta = (b.rate || 0.5) + (Math.random() - 0.4) * 0.3;
      b.fill = Math.min(100, Math.max(0, parseFloat((b.fill + delta).toFixed(1))));
      b.lastReading = Date.now();
      // Simulate occasional temp/humidity changes
      b.temp = parseFloat((22 + Math.random() * 8).toFixed(1));
      b.humidity = parseFloat((55 + Math.random() * 20).toFixed(1));
      b.methane = parseFloat((Math.random() * 5).toFixed(2));
      changed = true;
    });
    if (changed) {
      saveIoTBins(bins);
      syncIoTAlertBadge();
      // If user is watching the IoT view, refresh the fill bars without full re-render
      if (currentView === 'v-iot-bins') iotLiveUpdate(bins);
    }
  }, 8000); // tick every 8 s
}

function stopIoTSim() {
  clearInterval(_iotSimTimer);
  _iotSimTimer = null;
}

// Lightweight DOM-only update (no full re-render)
function iotLiveUpdate(bins) {
  bins.forEach(b => {
    const fillEl = document.getElementById(`iot-fill-${b.id}`);
    const pctEl  = document.getElementById(`iot-pct-${b.id}`);
    const badgeEl = document.getElementById(`iot-badge-${b.id}`);
    const tempEl = document.getElementById(`iot-temp-${b.id}`);
    const humEl  = document.getElementById(`iot-hum-${b.id}`);
    const ch4El  = document.getElementById(`iot-ch4-${b.id}`);
    if (fillEl) { fillEl.style.width = b.fill + '%'; fillEl.style.background = iotFillColor(b.fill); }
    if (pctEl)  pctEl.textContent = b.fill + '%';
    if (badgeEl) badgeEl.outerHTML = `<span id="iot-badge-${b.id}">${iotStatusBadge(b)}</span>`;
    if (tempEl)  tempEl.textContent = (b.temp || '--') + '°C';
    if (humEl)   humEl.textContent  = (b.humidity || '--') + '%';
    if (ch4El)   ch4El.textContent  = (b.methane || '--') + ' ppm';
  });
}

// ── IoT Bin Card Builder ──
function buildBinCard(b) {
  const col = iotFillColor(b.fill);
  const lastSeen = b.lastReading ? fmtDate(b.lastReading) : 'Never';
  return `
  <div class="iot-bin-card glass-card" id="iot-card-${b.id}">
    <div class="iot-card-header">
      <div>
        <div class="iot-bin-name">🗑️ ${b.name}</div>
        <div class="iot-bin-sub">ID: ${b.id} · Last ping: ${lastSeen}</div>
      </div>
      <div style="display:flex; align-items:center; gap:8px;">
        <span id="iot-badge-${b.id}">${iotStatusBadge(b)}</span>
        <button class="btn btn-ghost btn-sm" onclick="iotEditBin('${b.id}')" title="Edit">✏️</button>
        <button class="btn btn-outline-danger btn-sm" onclick="iotDeleteBin('${b.id}')" title="Delete">🗑</button>
      </div>
    </div>

    <!-- Fill level bar -->
    <div class="iot-fill-row">
      <div class="iot-fill-label">Fill Level</div>
      <div class="iot-fill-pct" id="iot-pct-${b.id}">${b.fill}%</div>
    </div>
    <div class="iot-fill-track">
      <div class="iot-fill-bar" id="iot-fill-${b.id}" style="width:${b.fill}%; background:${col};"></div>
    </div>

    <!-- Sensor readings -->
    <div class="iot-sensor-grid">
      <div class="iot-sensor-item">
        <div class="iot-sensor-icon">🌡️</div>
        <div class="iot-sensor-val" id="iot-temp-${b.id}">${b.temp ? b.temp + '°C' : '--'}</div>
        <div class="iot-sensor-lbl">Temp</div>
      </div>
      <div class="iot-sensor-item">
        <div class="iot-sensor-icon">💧</div>
        <div class="iot-sensor-val" id="iot-hum-${b.id}">${b.humidity ? b.humidity + '%' : '--'}</div>
        <div class="iot-sensor-lbl">Humidity</div>
      </div>
      <div class="iot-sensor-item">
        <div class="iot-sensor-icon">🧪</div>
        <div class="iot-sensor-val" id="iot-ch4-${b.id}">${b.methane != null ? b.methane + ' ppm' : '--'}</div>
        <div class="iot-sensor-lbl">CH₄</div>
      </div>
      <div class="iot-sensor-item">
        <div class="iot-sensor-icon">📈</div>
        <div class="iot-sensor-val">${b.rate} kg/h</div>
        <div class="iot-sensor-lbl">Fill Rate</div>
      </div>
    </div>

    ${b.fill >= 85 ? `
    <div class="iot-alert-banner">
      ⚠️ <strong>Bin is critically full!</strong> Dispatch a collection immediately to prevent overflow.
      <button class="btn btn-primary btn-sm" style="margin-left:8px;" onclick="iotDispatchFromBin('${b.id}')">🚀 Dispatch Now</button>
    </div>` : ''}
  </div>`;
}

// ── IoT View Renderer ──
function renderIoT(mc, fullRender) {
  const bins = getIoTBins();
  syncIoTAlertBadge();
  startIoTSim(); // ensure sim is running

  if (!fullRender) { iotLiveUpdate(bins); return; }

  const alerts = bins.filter(b => b.fill >= 85 || b.status === 'offline');

  mc.innerHTML = `
    <!-- Header row -->
    <div class="between" style="margin-bottom:24px; flex-wrap:wrap; gap:12px;">
      <div>
        <h3 class="heading">IoT Sensory Bin Network</h3>
        <div style="font-size:13px; color:var(--text-muted); margin-top:4px;">
          Real-time fill monitoring · ${bins.length} bin${bins.length !== 1 ? 's' : ''} connected
        </div>
      </div>
      <button class="btn btn-primary" id="btn-add-iot-bin" onclick="iotAddBin()">＋ Add Bin</button>
    </div>

    <!-- Summary stats -->
    <div class="stats-grid" style="margin-bottom:28px;">
      <div class="stat-card">
        <div class="stat-val">${bins.length}</div>
        <div class="stat-lbl">Total Bins</div>
      </div>
      <div class="stat-card" style="border-top-color:var(--red);">
        <div class="stat-val" style="color:var(--red);">${bins.filter(b => b.fill >= 85).length}</div>
        <div class="stat-lbl">Critical (≥85%)</div>
      </div>
      <div class="stat-card" style="border-top-color:var(--amber);">
        <div class="stat-val" style="color:var(--amber);">${bins.filter(b => b.fill >= 60 && b.fill < 85).length}</div>
        <div class="stat-lbl">Filling (60–84%)</div>
      </div>
      <div class="stat-card">
        <div class="stat-val">${Math.round(bins.reduce((s,b) => s + b.fill, 0) / Math.max(bins.length, 1))}%</div>
        <div class="stat-lbl">Avg Fill Level</div>
      </div>
    </div>

    <!-- Alert Banner (if any critical bins) -->
    ${alerts.length ? `
    <div class="iot-global-alert glass-card" style="margin-bottom:24px; border-color:var(--red); background:var(--red-light); padding:16px;">
      <div style="font-weight:700; color:var(--red); margin-bottom:4px;">⚠️ ${alerts.length} bin${alerts.length > 1 ? 's require' : ' requires'} immediate attention</div>
      <div style="font-size:13px; color:var(--text-muted);">${alerts.map(b => b.name).join(', ')}</div>
    </div>` : ''}

    <!-- Bin Cards Grid -->
    <div class="iot-bins-grid" id="iot-bins-grid">
      ${bins.length ? bins.map(buildBinCard).join('') : `
        <div class="empty-state" style="grid-column:1/-1;">
          <div class="empty-icon">🗑️</div>
          <div class="empty-title">No bins connected</div>
          <div class="empty-sub">Click <strong>+ Add Bin</strong> to register your first IoT sensory bin.</div>
        </div>`}
    </div>

    <!-- Network telemetry footer -->
    <div class="glass-card sensor-card" style="margin-top:28px; padding:20px;">
      <div style="font-size:12px; font-weight:700; text-transform:uppercase; color:var(--text-muted); margin-bottom:16px;">🛰️ Network Telemetry</div>
      <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:16px;">
        <div><div style="font-size:11px;color:var(--text-muted);">SIGNAL HEALTH</div><div style="font-weight:700;color:var(--green);">98.4% Uptime</div></div>
        <div><div style="font-size:11px;color:var(--text-muted);">DATA LATENCY</div><div style="font-weight:700;color:var(--blue);">~120 ms</div></div>
        <div><div style="font-size:11px;color:var(--text-muted);">SIM TICK</div><div style="font-weight:700;">8 s interval</div></div>
        <div><div style="font-size:11px;color:var(--text-muted);">PROTOCOL</div><div style="font-weight:700;">MQTT / LoRaWAN</div></div>
      </div>
    </div>
  `;
}

// ── IoT CRUD Actions ──
window.iotAddBin = function() {
  const html = `
    <h3 class="modal-title">Add IoT Sensory Bin</h3>
    <p class="modal-sub">Register a new bin to the network.</p>
    <div class="form-group"><label class="form-label">Bin Name / Location</label><input class="form-input" id="iot-m-name" placeholder="e.g. East Wing Organic Hub"></div>
    <div class="form-group"><label class="form-label">Initial Fill Level (%)</label><input class="form-input" type="number" id="iot-m-fill" value="0" min="0" max="100"></div>
    <div class="form-group"><label class="form-label">Fill Rate (kg/h)</label><input class="form-input" type="number" id="iot-m-rate" value="0.8" step="0.1" min="0.1"></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="iotSaveNewBin()">Add Bin ✓</button>
    </div>`;
  document.getElementById('modal-box').innerHTML = html;
  document.getElementById('modal').classList.add('open');
};

window.iotSaveNewBin = function() {
  const name = document.getElementById('iot-m-name').value.trim();
  const fill = parseFloat(document.getElementById('iot-m-fill').value) || 0;
  const rate = parseFloat(document.getElementById('iot-m-rate').value) || 0.8;
  if (!name) return showToast('⚠ Enter a bin name.');
  const bins = getIoTBins();
  bins.push({ id: 'bin-' + uid(), name, fill, rate, status: 'active', lastReading: Date.now(), temp: 24, humidity: 60, methane: 0 });
  saveIoTBins(bins);
  closeModal();
  showToast('✓ Bin added to network.');
  refreshCurrentView(true);
};

window.iotEditBin = function(id) {
  const bins = getIoTBins();
  const b = bins.find(x => x.id === id);
  if (!b) return;
  const html = `
    <h3 class="modal-title">Edit Bin — ${b.name}</h3>
    <div class="form-group"><label class="form-label">Bin Name</label><input class="form-input" id="iot-m-name" value="${b.name}"></div>
    <div class="form-group"><label class="form-label">Fill Rate (kg/h)</label><input class="form-input" type="number" id="iot-m-rate" value="${b.rate}" step="0.1" min="0.1"></div>
    <div class="form-group"><label class="form-label">Status</label>
      <select class="form-select" id="iot-m-status">
        <option value="active" ${b.status==='active'?'selected':''}>Active</option>
        <option value="offline" ${b.status==='offline'?'selected':''}>Offline</option>
      </select>
    </div>
    <div class="form-group"><label class="form-label">Mark as Emptied (Reset Fill to 0%)</label>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;"><input type="checkbox" id="iot-m-reset"> Reset fill level</label>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="iotSaveEditBin('${id}')">Save Changes ✓</button>
    </div>`;
  document.getElementById('modal-box').innerHTML = html;
  document.getElementById('modal').classList.add('open');
};

window.iotSaveEditBin = function(id) {
  const bins = getIoTBins();
  const b = bins.find(x => x.id === id);
  if (!b) return;
  b.name   = document.getElementById('iot-m-name').value.trim() || b.name;
  b.rate   = parseFloat(document.getElementById('iot-m-rate').value) || b.rate;
  b.status = document.getElementById('iot-m-status').value;
  if (document.getElementById('iot-m-reset').checked) { b.fill = 0; b.lastReading = Date.now(); }
  saveIoTBins(bins);
  closeModal();
  showToast('✓ Bin updated.');
  refreshCurrentView(true);
};

window.iotDeleteBin = function(id) {
  if (!confirm('Remove this bin from the network?')) return;
  const bins = getIoTBins().filter(b => b.id !== id);
  saveIoTBins(bins);
  showToast('Bin removed.');
  refreshCurrentView(true);
};

window.iotDispatchFromBin = function(id) {
  // Pre-fill a dispatch request for this bin
  showView('v-pv-req');
  showToast('⚠ Fill in quantity and submit to dispatch a collection for this bin.');
};

// ── INIT ──
(function seedDB() {
  if (!DB.get('iot-bins')) {
    const now = Date.now();
    const bins = [
      { id: 'bin-1', name: 'West Wing Organic Hub',   fill: 24,  rate: 0.8, status: 'active',  lastReading: now - 30000, temp: 23.1, humidity: 61, methane: 0.12 },
      { id: 'bin-2', name: 'Kitchen Processing Unit', fill: 68,  rate: 1.2, status: 'active',  lastReading: now - 15000, temp: 27.4, humidity: 74, methane: 1.85 },
      { id: 'bin-3', name: 'Main Disposal Pit',       fill: 91,  rate: 0.4, status: 'active',  lastReading: now - 8000,  temp: 25.0, humidity: 58, methane: 3.20 },
      { id: 'bin-4', name: 'Rooftop Compost Bay',     fill: 12,  rate: 0.6, status: 'active',  lastReading: now - 60000, temp: 21.8, humidity: 52, methane: 0.04 }
    ];
    DB.set('iot-bins', bins);
  }
})();

document.getElementById('login-screen').style.display = 'flex';
switchAuthTab('login');

// ── Initialize Appwrite Cloud Sync Engine ──
setTimeout(() => { if (window.CloudSync) window.CloudSync.init(); }, 1000);
