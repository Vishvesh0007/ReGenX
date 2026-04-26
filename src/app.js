// ══════════════════════════════════════
// ReGenX v3 — Unified Premium Logic
// ══════════════════════════════════════

const STORAGE_KEY_PREFIX = "regenx-v3:";

// PWA Service Worker Registration
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js')
    .then(() => console.log('ReGenX PWA Service Worker Registered'))
    .catch(err => console.log('SW Registration Failed', err));
}

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
  
  const tokenContainer = document.getElementById('token-balance-container');
  if (acc.role === 'provider') {
    tokenContainer.classList.remove('hidden');
    document.getElementById('token-balance').textContent = acc.tokens || 0;
  } else {
    tokenContainer.classList.add('hidden');
  }
  startTicker();
  const gwWidget = document.getElementById('green-wall-widget');
  if(gwWidget) { gwWidget.style.display = 'flex'; startGreenWall(); }
  
  buildSidebar();
  autoRefreshTimer = setInterval(() => refreshCurrentView(), 15000);
  startIoTSimulation();
}

function startIoTSimulation() {
  setInterval(() => {
    const bins = DB.get('iot-bins') || [
      { id: 'bin-1', name: 'Main Kitchen Bin', fill: 12, rate: 0.5, status: 'active' },
      { id: 'bin-2', name: 'Outdoor Organic Pit', fill: 45, rate: 0.8, status: 'active' }
    ];
    
    bins.forEach(b => {
      b.fill = Math.min(100, b.fill + (Math.random() * b.rate));
      if (b.fill > 90) b.alert = true;
    });
    
    DB.set('iot-bins', bins);
    if (currentView === 'v-pv-dash') refreshCurrentView(false); 
  }, 10000); 
}

window.doLogout = function() {
  clearInterval(autoRefreshTimer);
  SESSION = { role:null, name:'', org:'', uid:'', lat:null, lng:null };
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
  if(btn) document.getElementById('tb-view-title').textContent = btn.innerText.replace(/[^a-zA-Z\s]/g, '').trim();
  
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
function saveOrder(o) { DB.set('ord:'+o.id, o); }
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
               <h4 style="margin-bottom:4px; font-size:18px;">DeFi Token Staking</h4>
               <p style="font-size:13px; color:var(--text-muted);">Lock your tokens in the Community Digester Fund to earn sustainable yield.</p>
             </div>
             <div style="text-align:right;">
               <div style="font-size:24px; font-weight:700; color:var(--blue);">12% <span style="font-size:14px">APY</span></div>
             </div>
           </div>
           <div class="between" style="margin-bottom:24px; background:var(--surface); padding:16px; border-radius:12px; border:1px solid var(--border);">
             <div>
               <div style="font-size:12px; text-transform:uppercase; color:var(--text-muted); font-weight:700;">Your Staked Balance</div>
               <div style="font-size:20px; font-weight:700;">${staked} $RGX</div>
             </div>
             <div style="text-align:right;">
               <div style="font-size:12px; text-transform:uppercase; color:var(--text-muted); font-weight:700;">Network TVL</div>
               <div style="font-size:20px; font-weight:700; color:var(--green);">${totalStakedGlobal.toLocaleString()} $RGX</div>
             </div>
           </div>
           <button class="btn btn-primary btn-full" style="background:var(--blue); border-color:var(--blue);" onclick="stakeTokens()">Stake Tokens</button>
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

      <h3 class="heading" style="margin-bottom:16px;">Web3 NFT Assets</h3>
      <div class="market-grid">
         <div class="market-card">
           <div class="mc-icon">📜</div><div class="mc-title">CSR Certificate NFT</div>
           <div class="mc-price">5,000 $RGX</div>
           <button class="btn btn-primary btn-full" onclick="buyMarketItem(5000, 'CSR Certificate NFT')">Mint to Blockchain</button>
         </div>
         <div class="market-card">
           <div class="mc-icon">🗑️</div><div class="mc-title">Smart Bin Hardware</div>
           <div class="mc-price">10,000 $RGX</div>
           <button class="btn btn-primary btn-full" onclick="buyMarketItem(10000, 'Smart Bin Sensor')">Claim Physical Asset</button>
         </div>
         <div class="market-card">
           <div class="mc-icon">⚡</div><div class="mc-title">Energy Rebate Voucher</div>
           <div class="mc-price">25,000 $RGX</div>
           <button class="btn btn-primary btn-full" onclick="buyMarketItem(25000, 'Energy Rebate Voucher')">Mint Voucher</button>
         </div>
      </div>
    `;
    return;
  }
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
        <button class="glass-card" style="flex:1; padding:12px; text-align:center; border-color:var(--blue);" onclick="openScanner()">
          <div style="font-size:20px;">📸</div><div style="font-size:11px; font-weight:600; margin-top:4px;">AI Scan</div>
        </button>
        <button class="glass-card" style="flex:1; padding:12px; text-align:center; border-color:var(--amber);" onclick="showView('v-market')">
          <div style="font-size:20px;">🛒</div><div style="font-size:11px; font-weight:600; margin-top:4px;">Exchange</div>
        </button>
      </div>

      <div class="stats-grid" id="pv-stats"></div>
      <div class="two-col">
        <div>
          <h3 class="heading" style="margin-bottom:16px;">Active Dispatches</h3><div id="pv-act"></div>
          
          <h3 class="heading" style="margin-top:32px; margin-bottom:16px;">IoT Smart Bins (Live Telemetry)</h3>
          <div id="pv-iot-list"></div>

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
          </div>
        </div>
        <div>
          <div class="glass-card" style="background:var(--green-light); border-color:var(--green);">
            <div style="font-size:32px;margin-bottom:12px;">♻️</div>
            <h3 class="heading" style="color:var(--green-hover);margin-bottom:8px;">Ready to dispatch?</h3>
            <p style="font-size:14px;color:var(--green-hover);opacity:0.8;margin-bottom:20px;">Ensure you meet the 50kg minimum threshold for net-positive energy yield.</p>
            <button class="btn btn-primary" onclick="showView('v-pv-req')">Create Request →</button>
          </div>

          <h3 class="heading" style="margin-top:24px; margin-bottom:16px;">AI Vision Waste Scanner</h3>
          <div class="glass-card" style="margin-bottom:16px; border-color:var(--blue);">
            <div style="font-size:13px; color:var(--text-muted); margin-bottom:12px;">Assess contamination and weight via computer vision before dispatch.</div>
            <button class="btn btn-primary btn-full" onclick="openScanner()">📸 Launch AI Scanner</button>
          </div>

          <div class="glass-card sensor-card" style="margin-top:24px; padding:16px;">
            <div class="ai-badge">✨ AI Predicts</div>
            <h4 style="margin-bottom:4px;" id="pv-ai-predict">0kg Expected Tomorrow</h4>
            <p style="font-size:13px; color:var(--text-muted);">Based on your recent historical completion data.</p>
          </div>

          <h3 class="heading" style="margin-top:24px; margin-bottom:16px;">Regional Leaderboard</h3>
          <div class="glass-card" style="padding:16px;" id="pv-leaderboard">
            <!-- Dynamic Leaderboard -->
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
    
    // Predict next day = average of all time (simple logic)
    const myTotal = lbMap[SESSION.id] || 0;
    const myComps = completed.length;
    const avg = myComps > 0 ? Math.round(myTotal / myComps) : 0;
    const aiPredict = document.getElementById('pv-ai-predict');
    if(aiPredict) aiPredict.textContent = avg + "kg Expected Tomorrow";
    const totalKg = completed.reduce((s,o)=>s+(o.actualKg||o.kg),0);
    document.getElementById('pv-stats').innerHTML = `
      <div class="stat-card"><div class="stat-val">${orders.length}</div><div class="stat-lbl">Total Requests</div></div>
      <div class="stat-card"><div class="stat-val">${totalKg}</div><div class="stat-lbl">Kg Recycled</div></div>
      <div class="stat-card"><div class="stat-val">${Math.round(totalKg*0.62)}</div><div class="stat-lbl">CO₂ Offset (kg)</div></div>
    `;
    const pvMyKg = document.getElementById('pv-my-kg');
    if(pvMyKg) pvMyKg.textContent = totalKg + ' kg';
    document.getElementById('pv-act').innerHTML = active.length ? active.map(o=>buildOrderCard(o,'provider')).join('') : '<div class="empty-state"><div class="empty-sub">No active dispatches.</div></div>';
    
    // IoT Bins Rendering
    const bins = DB.get('iot-bins') || [
      { id: 'bin-1', name: 'Main Kitchen Bin', fill: 12, rate: 0.5, status: 'active' },
      { id: 'bin-2', name: 'Outdoor Organic Pit', fill: 45, rate: 0.8, status: 'active' }
    ];
    const iotHTML = bins.map(b => {
      const color = b.fill > 85 ? 'var(--red)' : (b.fill > 60 ? 'var(--amber)' : 'var(--green)');
      return `
        <div class="glass-card sensor-card" style="margin-bottom:16px; border-color:${b.fill > 85 ? 'var(--red)' : 'var(--border)'};">
          <div class="between">
            <div>
              <div style="font-weight:700; font-size:16px; margin-bottom:4px;">${b.name}</div>
              <div class="badge" style="background:${color}; color:white;">${Math.round(b.fill)}% Full</div>
            </div>
            <div class="gauge-circle" style="border-top-color:${color}; width:50px; height:50px; font-size:14px; border-width:3px; ${b.fill > 85 ? 'animation:pulse 2s infinite;' : ''}">
              <span>${Math.round(b.fill)}%</span>
            </div>
          </div>
          ${b.fill > 85 ? `<button class="btn btn-primary btn-sm btn-full" style="margin-top:12px; background:var(--red); border:none;" onclick="showView('v-pv-req')">⚠️ CAPACITY REACHED - DISPATCH NOW</button>` : `<p style="font-size:12px; color:var(--text-muted); margin-top:8px;">AI Predicts full in ~${Math.round((100-b.fill)/b.rate)} hours.</p>`}
        </div>
      `;
    }).join('');
    const iotDiv = document.getElementById('pv-iot-list');
    if(iotDiv) iotDiv.innerHTML = iotHTML;

    if(fullRender) setTimeout(initPvChart, 100);
  }
  
  if (currentView === 'v-pv-req') {
    if(fullRender) mc.innerHTML = `
      <div style="max-width:600px; margin:0 auto;">
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
          <div class="glass-card" style="background:var(--green-light); border-color:var(--green); margin-bottom:16px;">
            <div class="between">
              <div>
                <h4 style="color:var(--green-hover); margin-bottom:4px;">${activeJobs.length > 1 ? 'AI Batching Optimized' : 'Optimal Path Active'}</h4>
                <p style="font-size:12px; color:var(--green-hover);">${activeJobs.length > 1 ? 'Combining routes to minimize fuel.' : 'Route optimized for lowest emissions.'}</p>
              </div>
              <div style="text-align:right;">
                <div style="font-size:20px; font-weight:700; color:var(--green-hover);">~${(activeJobs.length * 2.4).toFixed(1)} L</div>
                <div style="font-size:11px; color:var(--green-hover); text-transform:uppercase; font-weight:600;">Total Fuel Saved</div>
              </div>
            </div>
          </div>
          <div class="glass-card sensor-card" style="margin-bottom:16px; padding:16px; border-color:var(--border);">
             <div style="font-size:12px; font-weight:600; color:var(--text-muted); margin-bottom:12px; text-transform:uppercase;">Live Environment Impact</div>
             <div class="between" style="margin-bottom:8px;">
               <div>🌧️ Weather</div>
               <div style="font-weight:700; color:var(--text-muted);" id="rt-weather">Fetching...</div>
             </div>
             <div class="between" style="margin-bottom:8px;">
               <div>🚗 Traffic Density</div>
               <div style="font-weight:700; color:var(--green);" id="rt-traffic">Normal</div>
             </div>
             <div class="between">
               <div>⏱️ AI Routing Adjust</div>
               <div style="font-weight:700; color:var(--text-muted);" id="rt-ai-adj">+0 Mins</div>
             </div>
          </div>
          <div class="glass-card sensor-card" style="padding:16px; border-color:var(--blue);">
             <div style="font-size:12px; font-weight:600; color:var(--text-muted); margin-bottom:12px; text-transform:uppercase;">Vehicle Telemetry (Live)</div>
             <div class="between" style="margin-bottom:8px;">
               <div>🔋 Battery Level</div>
               <div style="font-weight:700; color:var(--text-muted);" id="rt-batt">--</div>
             </div>
             <div class="between" style="margin-bottom:8px;">
               <div>🌡️ Cargo Temp</div>
               <div style="font-weight:700;" id="rt-temp">--</div>
             </div>
             <div class="between">
               <div>⚙️ AI ETA Confidence</div>
               <div style="font-weight:700; color:var(--blue);" id="rt-conf">94.2%</div>
             </div>
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
    
    // Map Logic
    setTimeout(() => {
      if(!document.getElementById('rider-map')) return;
      if(rMap) { rMap.remove(); rMap=null; }
      rMap = L.map('rider-map').setView([SESSION.lat, SESSION.lng], 13);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(rMap);
      
      const rIco = L.divIcon({html:"<div style='width:16px;height:16px;background:var(--blue);border-radius:50%;border:2px solid white;box-shadow:0 0 10px rgba(0,0,0,0.5);'></div>", className:''});
      const rMarker = L.marker([SESSION.lat, SESSION.lng], {icon:rIco, draggable:true}).addTo(rMap).bindPopup("You (Rider) — <b>Drag me</b> to update exact GPS!").openPopup();
      
      rMarker.on('dragend', function(e) {
        const mPos = rMarker.getLatLng();
        SESSION.lat = mPos.lat; SESSION.lng = mPos.lng;
        DB.set('acc:'+SESSION.id, SESSION);
        refreshCurrentView(false); // Update polyline and distance silently
      });
      
      if(activeJobs.length) {
        const pIco = L.divIcon({html:"<div style='width:16px;height:16px;background:var(--amber);border-radius:50%;border:2px solid white;'></div>", className:''});
        const latlngs = [[SESSION.lat, SESSION.lng]];
        
        activeJobs.forEach(job => {
          L.marker([job.providerLat, job.providerLng], {icon:pIco}).addTo(rMap).bindPopup("Pickup: "+job.providerOrg);
          latlngs.push([job.providerLat, job.providerLng]);
          
          const plant = DB.get('acc:'+job.plantId);
          if (plant) {
            const pltIco = L.divIcon({html:"<div style='width:16px;height:16px;background:var(--green);border-radius:50%;border:2px solid white;'></div>", className:''});
            L.marker([plant.lat, plant.lng], {icon:pltIco}).addTo(rMap).bindPopup("Dropoff: "+plant.org);
            latlngs.push([plant.lat, plant.lng]);
          }
        });
        
        const polyline = L.polyline(latlngs, {color: 'var(--amber)', weight: 4, dashArray: '5,5'}).addTo(rMap);
        rMap.fitBounds(polyline.getBounds(), {padding:[40,40]});
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

// ════════ PLANT LOGIC ════════
async function renderPlant(mc, fullRender) {
  const orders = getAllOrders().filter(o => o.plantId === SESSION.id);
  const incoming = orders.filter(o => o.status === 'at_plant');
  const completed = orders.filter(o => o.status === 'completed');
  const logs = getAllLogs().filter(l => l.plantId === SESSION.id);
  
  if (currentView === 'v-pl-dash') {
    if(fullRender) mc.innerHTML = `
      <div class="stats-grid" id="pl-stats"></div>
      
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
    <div class="form-group"><label class="form-label">Segregation Score (0-100)</label><input type="number" id="p-score" class="form-input"></div>
    <div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="confirmPlantReceipt('${id}')">Accept Load ✓</button></div>
  `;
  document.getElementById('modal-box').innerHTML = html;
  document.getElementById('modal').classList.add('open');
}

window.confirmPlantReceipt = function(id) {
  const o = getOrder(id); if(!o) return;
  const score = document.getElementById('p-score').value || 0;
  o.status = 'completed'; o.segScore = score;
  
  const multiplier = score >= 80 ? 1.5 : (score >= 50 ? 1.0 : 0.5);
  const earnedTokens = Math.round((o.actualKg || o.kg) * 2 * multiplier);
  o.tokensMinted = earnedTokens;
  o.txHash = '0x' + uid() + uid() + uid();
  
  const providerAcc = DB.get('acc:' + o.providerId);
  if (providerAcc) {
     providerAcc.tokens = (providerAcc.tokens || 0) + earnedTokens;
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
  let compData = [0,0,0,0,0,0];
  
  if(logs.length > 0) {
      // Just map the last 6 logs
      const recent = logs.slice(0,6).reverse();
      for(let i=0; i<recent.length; i++){
          bioData[5 - recent.length + 1 + i] = parseFloat(recent[i].bio||0);
          compData[5 - recent.length + 1 + i] = parseFloat(recent[i].comp||0);
      }
  }

  plChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: ['Reading 1', 'Reading 2', 'Reading 3', 'Reading 4', 'Reading 5', 'Latest'],
      datasets: [{
        label: 'Digester Temp (°C)',
        data: compData, // using compost for secondary line as temp is optional
        borderColor: '#EF4444',
        tension: 0.4
      }, {
        label: 'Methane Yield (m³)',
        data: bioData,
        borderColor: '#0D9488',
        tension: 0.4,
        fill: true,
        backgroundColor: 'rgba(13, 148, 136, 0.1)'
      }]
    },
    options: { responsive: true, maintainAspectRatio: false }
  });
}

// ── INIT ──
document.getElementById('login-screen').style.display = 'flex';
switchAuthTab('login');
