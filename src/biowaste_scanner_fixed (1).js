/**
 * ========================================================================================================================
 * BioWaste — AI Waste Scanner Module
 * File: biowaste_scanner_fixed.js (High-Fidelity Integrated Version)
 * ========================================================================================================================
 */

const BioScanner = (() => {

  // ── Internal state ─────────────────────────────────────────────────────────
  let __stream = null;   // MediaStream from getUserMedia
  let __imageB64 = null;   // Current captured image as base64
  let __opts = {};     // Options passed to open()

  // ── Storage helpers ────────────────────────────────────────────────────────
  const __storage = {
    async get(key) {
      try { 
        if (typeof window.storage !== 'undefined' && window.storage.get) {
          const r = await window.storage.get(key, true); 
          return r ? JSON.parse(r.value) : null; 
        }
        const r = localStorage.getItem('regenx:' + key);
        return r ? JSON.parse(r) : null;
      }
      catch { return null; }
    },
    async set(key, value) {
      try { 
        if (typeof window.storage !== 'undefined' && window.storage.set) {
          await window.storage.set(key, JSON.stringify(value), true); 
          return true; 
        }
        localStorage.setItem('regenx:' + key, JSON.stringify(value));
        return true;
      }
      catch { return false; }
    },
    async list(prefix) {
      try { 
        if (typeof window.storage !== 'undefined' && window.storage.list) {
          const r = await window.storage.list(prefix, true); 
          return r ? r.keys : []; 
        }
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k.startsWith('regenx:' + prefix)) keys.push(k.replace('regenx:', ''));
        }
        return keys;
      }
      catch { return []; }
    }
  };

  function __uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function __ts() { return Date.now(); }
  function __ago(ms) {
    const d = Date.now() - ms;
    if (d < 60000) return 'just now';
    if (d < 3600000) return Math.floor(d / 60000) + 'm ago';
    if (d < 86400000) return Math.floor(d / 3600000) + 'h ago';
    return Math.floor(d / 86400000) + 'd ago';
  }

  function __toast(msg) {
    if (typeof showToast === 'function') showToast(msg);
    else console.warn('[BioScanner]', msg);
  }

  function __stopCamera() {
    if (__stream) { __stream.getTracks().forEach(t => t.stop()); __stream = null; }
  }

  function __render() {
    const container = document.getElementById(__opts.containerId || 'scanner-view');
    if (!container) { 
      const modalBox = document.getElementById('modal-box');
      if (modalBox) { __opts.containerId = 'modal-box'; __render(); return; }
      console.error('[BioScanner] Container not found:', __opts.containerId); 
      return; 
    }

    container.innerHTML = `
      <div class="scanner-shell">
        <div class="scanner-header">
          <button class="scanner-back" onclick="BioScanner.__back()">← Back</button>
          <div style="font-family:var(--font,sans-serif);font-size:20px;font-weight:800;">📷 Waste Scanner</div>
          <div style="font-size:11px;color:var(--muted,#888);font-family:var(--mono,monospace);">AI · Visual analysis</div>
        </div>

        <div style="background:var(--green-light,#E1F5EE);border:1px solid #b0e4cf;border-radius:12px;padding:13px 16px;margin-bottom:16px;font-size:13px;color:var(--green-dark,#0F6E56);line-height:1.5;">
          <strong>How to use:</strong> Point your camera at the waste bin. 
          The AI identifies items and calculates a <strong>segregation score</strong>.
        </div>

        <div class="cam-mode-row">
          <button class="cam-mode-btn on" id="bws-mode-cam"    onclick="BioScanner.__setMode('camera')">📷 Camera</button>
          <button class="cam-mode-btn"    id="bws-mode-upload" onclick="BioScanner.__setMode('upload')">🖼 Upload</button>
        </div>

        <div class="cam-zone" id="bws-cam-zone">
          <video id="bws-video" autoplay muted playsinline></video>
          <canvas id="bws-canvas" style="display:none;"></canvas>
          <img id="bws-preview" alt="Captured waste">
          <div class="cam-overlay">
            <div class="cam-frame">
              <div class="cam-corner cam-corner-tl"></div>
              <div class="cam-corner cam-corner-tr"></div>
              <div class="cam-corner cam-corner-bl"></div>
              <div class="cam-corner cam-corner-br"></div>
              <div class="cam-scan-line" id="bws-scan-line" style="display:none;"></div>
            </div>
          </div>
          <div class="cam-placeholder" id="bws-placeholder">
            <div class="cam-placeholder-icon">📷</div>
            <div class="cam-placeholder-text">Press <strong>Start Camera</strong> to begin</div>
          </div>
        </div>

        <div class="cam-controls" id="bws-controls">
          <button class="cam-btn btn-secondary" style="border-radius:10px;" onclick="BioScanner.__clickUpload()">🖼 Upload photo</button>
          <button class="cam-btn btn-primary" id="bws-btn-main" style="border-radius:10px; min-width:180px;" onclick="BioScanner.__startCamera()">📷 Start camera</button>
        </div>

        <div id="bws-result"></div>
      </div>`;
  }

  function __setMode(mode) {
    document.getElementById('bws-mode-cam')?.classList.toggle('on', mode === 'camera');
    document.getElementById('bws-mode-upload')?.classList.toggle('on', mode === 'upload');
    if (mode === 'upload') { __stopCamera(); __clickUpload(); }
    else __startCamera();
  }

  function __clickUpload() {
    const fi = document.getElementById('file-input');
    if (!fi) return;
    fi.removeAttribute('capture');
    fi.click();
  }

  function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    __stopCamera();
    const reader = new FileReader();
    reader.onload = e => {
      const dataURL = e.target.result;
      __imageB64 = dataURL.split(',')[1];
      __showPreview(dataURL);
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  }

  async function __startCamera() {
    if (__stream) { __captureFrame(); return; }
    const placeholder = document.getElementById('bws-placeholder');
    const video = document.getElementById('bws-video');
    const preview = document.getElementById('bws-preview');
    const mainBtn = document.getElementById('bws-btn-main');
    const scanLine = document.getElementById('bws-scan-line');

    if (preview) preview.style.display = 'none';
    if (placeholder) placeholder.style.display = 'flex';

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false
      });
      __stream = stream;
      if (video) { video.srcObject = stream; video.style.display = 'block'; }
      if (placeholder) placeholder.style.display = 'none';
      if (mainBtn) { mainBtn.textContent = '📸 Capture & Analyse'; mainBtn.onclick = () => __captureFrame(); }
      if (scanLine) scanLine.style.display = 'block';
    } catch (err) {
      if (placeholder) placeholder.innerHTML = `<div class="cam-placeholder-text">Camera error: ${err.message}</div>`;
      __toast('⚠ Camera blocked — use Upload');
    }
  }

  function __captureFrame() {
    const video = document.getElementById('bws-video');
    const canvas = document.getElementById('bws-canvas');
    const scanLine = document.getElementById('bws-scan-line');
    if (!video || !canvas) return;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const dataURL = canvas.toDataURL('image/jpeg', 0.85);
    __imageB64 = dataURL.split(',')[1];
    __stopCamera();
    if (scanLine) scanLine.style.display = 'none';
    __showPreview(dataURL);
  }

  function __showPreview(dataURL) {
    const preview = document.getElementById('bws-preview');
    const video = document.getElementById('bws-video');
    const placeholder = document.getElementById('bws-placeholder');
    const mainBtn = document.getElementById('bws-btn-main');
    const controls = document.getElementById('bws-controls');

    if (preview) { preview.src = dataURL; preview.style.display = 'block'; }
    if (video) video.style.display = 'none';
    if (placeholder) placeholder.style.display = 'none';
    if (mainBtn) { mainBtn.textContent = '🔄 Retake'; mainBtn.onclick = () => __retake(); }

    if (controls && !document.getElementById('bws-analyse-btn')) {
      const btn = document.createElement('button');
      btn.id = 'bws-analyse-btn';
      btn.className = 'cam-btn btn-primary';
      btn.style.borderRadius = '10px';
      btn.style.minWidth = '180px';
      btn.textContent = '🔍 Analyse waste';
      btn.onclick = () => __analyse();
      controls.appendChild(btn);
    }
  }

  function __retake() {
    __imageB64 = null;
    __stopCamera();
    const preview = document.getElementById('bws-preview');
    const video = document.getElementById('bws-video');
    const mainBtn = document.getElementById('bws-btn-main');
    const analyBtn = document.getElementById('bws-analyse-btn');
    const placeholder = document.getElementById('bws-placeholder');
    const result = document.getElementById('bws-result');

    if (preview) preview.style.display = 'none';
    if (video) video.style.display = 'none';
    if (analyBtn) analyBtn.remove();
    if (result) result.innerHTML = '';
    if (mainBtn) { mainBtn.textContent = '📷 Start camera'; mainBtn.onclick = () => __startCamera(); }
    if (placeholder) {
      placeholder.innerHTML = `<div class="cam-placeholder-icon">📷</div><div class="cam-placeholder-text">Press <strong>Start Camera</strong> to begin</div>`;
      placeholder.style.display = 'flex';
    }
    __startCamera();
  }

  function __back() {
    __stopCamera();
    if (typeof __opts.onBack === 'function') __opts.onBack();
  }

  // ── CORE ANALYSIS (SIMULATED) ────────────────────────────────────────────
  async function __analyse() {
    if (!__imageB64) { __toast('⚠ Capture or upload an image first'); return; }

    const resultArea = document.getElementById('bws-result');
    const analyBtn = document.getElementById('bws-analyse-btn');
    if (analyBtn) analyBtn.disabled = true;

    resultArea.innerHTML = `
      <div class="result-panel">
        <div class="analysing-box">
          <div class="bw-spinner"></div>
          <div style="font-family:var(--font,sans-serif);font-size:18px;font-weight:700;">Analysing waste…</div>
          <div class="scan-dots">
            <div class="scan-dot"></div><div class="scan-dot"></div><div class="scan-dot"></div>
          </div>
          <div class="scan-steps" id="bws-step-txt">Verifying image is waste…</div>
        </div>
      </div>`;

    const steps = [
      'Identifying waste items…',
      'Checking for contaminants…',
      'Calculating segregation score…',
      'Finalizing analysis…'
    ];
    let si = 0;
    const stepInt = setInterval(() => {
      const el = document.getElementById('bws-step-txt');
      if (el && si < steps.length) el.textContent = steps[si++];
    }, 1200);

    setTimeout(async () => {
      clearInterval(stepInt);
      if (analyBtn) analyBtn.disabled = false;

      try {
        const result = __simulateAnalysis();
        __displayResult(result);
        await __saveToHistory(result);
      } catch (err) {
        console.error('[BioScanner] Error:', err);
        resultArea.innerHTML = `<div class="result-panel"><div style="padding:20px;text-align:center;">⚠ Error rendering results.</div></div>`;
      }
    }, (steps.length + 1) * 1200);
  }

  function __simulateAnalysis() {
    const categories = {
      Organic:   { emoji: '🍃', items: ['Banana Peel', 'Egg Shells', 'Coffee Grounds', 'Leftover Rice', 'Vegetable Scraps', 'Fruit Rind', 'Stale Bread'], biogas: true },
      Plastic:   { emoji: '🥤', items: ['Water Bottle', 'Snack Wrapper', 'Milk Pouch', 'Plastic Cup', 'Polybag', 'Yogurt Tub'], biogas: false },
      Glass:     { emoji: '🍾', items: ['Broken Bottle', 'Jam Jar', 'Medicine Vial'], biogas: false },
      Metal:     { emoji: '🥫', items: ['Soda Can', 'Aluminium Foil', 'Tin Lid'], biogas: false },
      Paper:     { emoji: '📦', items: ['Cardboard Box', 'Newspaper', 'Tissues'], biogas: false },
      Hazardous: { emoji: '🔋', items: ['Used Battery', 'Expired Medicine', 'Bleach Bottle'], biogas: false }
    };

    const catKeys = Object.keys(categories);
    const numItems = Math.floor(Math.random() * 3) + 3; 
    const detectedItems = [];
    let containsContaminants = false;

    for (let i = 0; i < numItems; i++) {
      const catName = i === 0 ? 'Organic' : catKeys[Math.floor(Math.random() * catKeys.length)]; 
      const catData = categories[catName];
      const name = catData.items[Math.floor(Math.random() * catData.items.length)];
      const isContaminant = !catData.biogas;
      if (isContaminant) containsContaminants = true;

      detectedItems.push({
        name,
        category: catName,
        isContaminant,
        emoji: catData.emoji
      });
    }

    const contaminantsFound = detectedItems.filter(i => i.isContaminant).map(i => i.name);
    let segregationScore = containsContaminants ? Math.floor(Math.random() * 30) + 40 : Math.floor(Math.random() * 10) + 90;

    const overallGrade = 
      segregationScore >= 90 ? 'Excellent' :
      segregationScore >= 75 ? 'Good' :
      segregationScore >= 55 ? 'Fair' : 'Poor';

    const biogasSuitability = 
      segregationScore >= 85 ? 'Ideal' :
      segregationScore >= 65 ? 'Acceptable' :
      segregationScore >= 45 ? 'Marginal' : 'Reject';

    const recommendations = [];
    if (containsContaminants) {
      recommendations.push({ icon: '🧤', text: `Please remove the ${contaminantsFound[0]} before disposal.` });
      recommendations.push({ icon: '♻️', text: 'Separate non-organic items into the dry waste bin.' });
    } else {
      recommendations.push({ icon: '✨', text: 'Perfectly segregated organic waste batch.' });
      recommendations.push({ icon: '🔒', text: 'Keep the bin lid tightly closed to avoid odour.' });
    }

    return {
      segregationScore,
      overallGrade,
      gradeSummary: containsContaminants ? `Detected ${contaminantsFound.length} contaminants. Batch needs sorting.` : "High-quality organic batch ready for processing.",
      detectedItems,
      contaminantsFound,
      recommendations,
      biogasSuitability,
      estimatedOrganicPercent: containsContaminants ? Math.floor(Math.random() * 20) + 60 : 100,
      actionRequired: containsContaminants
    };
  }

  async function __saveToHistory(result) {
    const record = {
      id: __uid(),
      timestamp: __ts(),
      imageBase64: __imageB64,
      score: result.segregationScore,
      grade: result.overallGrade,
      summary: result.gradeSummary,
      contaminants: result.contaminantsFound || [],
      biogasSuitability: result.biogasSuitability,
      actionRequired: result.actionRequired,
      role: __opts.role,
      org: __opts.userOrg,
      userName: __opts.userName
    };
    const storageKey = `scan:${__opts.userId || 'anon'}:${record.id}`;
    await __storage.set(storageKey, record);
    if (__opts.onScanSaved) __opts.onScanSaved(record);
    return record;
  }

  function __displayResult(r) {
    const resultArea = document.getElementById('bws-result');
    if (!resultArea) return;

    const score = Math.max(0, Math.min(100, r.segregationScore || 0));
    const headerBg = {
      Excellent: 'linear-gradient(135deg,#0F6E56,#1D9E75)',
      Good: 'linear-gradient(135deg,#2E5C00,#639922)',
      Fair: 'linear-gradient(135deg,#6B3E0A,#BA7517)',
      Poor: 'linear-gradient(135deg,#8B2E0E,#D85A30)'
    }[r.overallGrade] || 'linear-gradient(135deg,#4a4840,#6B6860)';

    const ringStroke = score >= 75 ? '#4ADE80' : score >= 50 ? '#FCD34D' : '#F87171';
    const C = 2 * Math.PI * 34;
    const dashOffset = C * (1 - score / 100);

    const itemsHTML = (r.detectedItems || []).map(item => `
      <div class="detected-item" style="background:${item.isContaminant ? 'rgba(239, 68, 68, 0.05)' : 'rgba(16, 185, 129, 0.03)'};">
        <div class="detected-item-name">
          <span>${item.emoji || '•'}</span>
          <span style="color:${item.isContaminant ? '#DC2626' : 'var(--text)'};">${item.name}</span>
          ${item.isContaminant ? '<span style="font-size:9px; background:#FEE2E2; color:#DC2626; padding:1px 5px; border-radius:10px; margin-left:5px; font-weight:700;">CONTAMINANT</span>' : ''}
        </div>
        <span class="badge ${item.isContaminant ? 'badge-amber' : 'badge-green'}" style="font-size:10px; margin-top:4px;">${item.category}</span>
      </div>`).join('');

    const recsHTML = (r.recommendations || []).map(rec =>
      `<div class="rec-row">
        <span class="rec-icon">${rec.icon || '•'}</span>
        <span>${rec.text}</span>
      </div>`).join('');

    const suitBadge = { Ideal: 'badge-teal', Acceptable: 'badge-green', Marginal: 'badge-amber', Reject: 'badge-coral' }[r.biogasSuitability] || 'badge-grey';

    resultArea.innerHTML = `
      <div class="result-panel" style="margin-top:24px; animation: fadeIn 0.4s ease-out;">
        <div class="result-header" style="background:${headerBg}; border-radius:20px 20px 0 0; padding: 24px;">
          <div class="score-ring-wrap" style="display:flex; align-items:center; gap:24px;">
            <div class="score-ring" style="position:relative; width:80px; height:80px;">
              <svg viewBox="0 0 80 80" width="80" height="80">
                <circle cx="40" cy="40" r="34" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="6"/>
                <circle cx="40" cy="40" r="34" fill="none" stroke="${ringStroke}" stroke-width="6"
                  stroke-dasharray="${C}" stroke-dashoffset="${dashOffset}" stroke-linecap="round"
                  style="transition: stroke-dashoffset 1s ease-out;"/>
              </svg>
              <div class="score-ring-num" style="position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); color:#fff; font-weight:800; font-size:22px;">${score}</div>
            </div>
            <div>
              <div class="score-grade-label" style="color:#fff; font-weight:800; font-size:24px; line-height:1; font-family:'Space Grotesk';">${r.overallGrade}</div>
              <div style="margin-top:10px; display:flex; gap:8px;">
                <span class="badge ${suitBadge}" style="font-size:11px;">⚗ ${r.biogasSuitability}</span>
                ${r.actionRequired ? '<span class="badge badge-red" style="font-size:11px;">⚠ Action Required</span>' : '<span class="badge badge-green" style="font-size:11px;">✓ Ready</span>'}
              </div>
            </div>
          </div>
        </div>
        <div class="result-body" style="padding: 24px; background: var(--surface); border-radius: 0 0 20px 20px;">
          <div style="font-size:15px; color:var(--text-muted); margin-bottom:20px; font-style:italic; line-height:1.5;">"${r.gradeSummary}"</div>
          
          <div style="margin-bottom:24px;">
            <div style="font-size:12px; font-weight:700; color:var(--text-muted); text-transform:uppercase; margin-bottom:12px; letter-spacing:1px;">Detected Items</div>
            <div class="detected-grid">${itemsHTML}</div>
          </div>

          <div style="background:var(--surface-hover); padding:20px; border-radius:16px; border: 1px solid var(--border);">
            <div style="font-size:12px; font-weight:700; color:var(--text-muted); text-transform:uppercase; margin-bottom:12px; letter-spacing:1px;">Recommendations</div>
            ${recsHTML}
          </div>

          <div style="display:flex; gap:12px; margin-top:24px;">
            <button class="btn btn-secondary" onclick="BioScanner.__retake()" style="flex:1;">🔄 New Scan</button>
            <button class="btn btn-primary" onclick="BioScanner.__applyResult(${score}, ${r.estimatedOrganicPercent})" style="flex:1.5;">📥 Apply Data</button>
          </div>
        </div>
      </div>`;
  }

  // ── HELPER: Apply Scan Data to Form ──────────────────────────────────────
  function __applyResult(score, organicPercent) {
    if (typeof __opts.onApply === 'function') {
      __opts.onApply(score, organicPercent);
    }
  }

  function open(options) {
    __opts = options || {};
    __render();
  }

  return {
    open,
    handleFileUpload,
    __back: () => { __stopCamera(); if (__opts.onBack) __opts.onBack(); },
    __setMode,
    __clickUpload,
    __startCamera,
    __captureFrame,
    __retake,
    __analyse,
    __applyResult
  };

})();
