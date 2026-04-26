/**
 * ========================================================================================================================
 * BioWaste — Advanced AI Waste Scanner
 * File: biowaste_scanner.js (Clean Consolidated Version)
 * ========================================================================================================================
 */

const BioScanner = (() => {

    // ── Internal state ─────────────────────────────────────────────────────────
    let __stream = null;
    let __imageB64 = null;
    let __opts = {};
    let __apiKey = '';
    let __aiProvider = 'gemini'; // Default to Gemini as it's more web-friendly

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
        }
    };

    function __uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
    function __ts() { return Date.now(); }

    function __toast(msg) {
        if (typeof showToast === 'function') showToast(msg);
        else console.warn('[BioScanner]', msg);
    }

    function __stopCamera() {
        if (__stream) { __stream.getTracks().forEach(t => t.stop()); __stream = null; }
    }

    // ── Initialization ──────────────────────────────────────────────────────────
    async function __init() {
        const savedKey = await __storage.get('settings:api_key');
        const savedProv = await __storage.get('settings:ai_provider');
        if (savedKey) __apiKey = savedKey;
        if (savedProv) __aiProvider = savedProv;
    }

    function __render() {
        const container = document.getElementById(__opts.containerId || 'scanner-view');
        if (!container) return;

        container.innerHTML = `
      <div class="scanner-shell">
        <div class="scanner-header">
          <button class="scanner-back" onclick="BioScanner.__back()">← Back</button>
          <div style="flex:1; text-align:center;">
            <div style="font-family:var(--font,sans-serif);font-size:18px;font-weight:800;">📷 AI Bio-Scanner</div>
            <div style="font-size:10px;color:var(--muted,#888);text-transform:uppercase;letter-spacing:1px;">
              ${__apiKey ? 'Real-Time AI Active' : 'Smart Vision Mode'}
            </div>
          </div>
          <button class="scanner-settings-btn" onclick="BioScanner.__toggleSettings()" title="AI Settings">⚙️</button>
        </div>

        <!-- AI Settings Panel -->
        <div id="bws-settings" class="scanner-settings-panel" style="display:none;">
          <div style="font-weight:700; font-size:14px; margin-bottom:12px; color:var(--green);">AI Engine Settings</div>
          
          <div class="form-group">
            <label class="form-label">AI Provider</label>
            <select id="bws-ai-provider" class="form-select" onchange="BioScanner.__updateProvider()">
              <option value="gemini" ${__aiProvider === 'gemini' ? 'selected' : ''}>Google Gemini (1.5 Flash)</option>
              <option value="anthropic" ${__aiProvider === 'anthropic' ? 'selected' : ''}>Anthropic Claude (3.5 Sonnet)</option>
            </select>
          </div>

          <div class="form-group">
            <label class="form-label">API Key</label>
            <input type="password" id="bws-api-key-input" class="form-input" placeholder="Paste your API key..." value="${__apiKey}">
          </div>

          <button class="btn btn-primary btn-sm btn-full" onclick="BioScanner.__saveApiKey()">Save & Apply</button>
          <p style="font-size:10px; color:var(--text-muted); margin-top:12px; line-height:1.4;">
            To use <strong>Real AI</strong>, enter your key. If empty, the scanner uses <strong>Smart Vision</strong> to analyze photo colors locally.
          </p>
        </div>

        <div id="bws-main-view">
          <div class="cam-mode-row">
            <button class="cam-mode-btn on" id="bws-mode-cam"    onclick="BioScanner.__setMode('camera')">📷 Live Camera</button>
            <button class="cam-mode-btn"    id="bws-mode-upload" onclick="BioScanner.__setMode('upload')">🖼 Upload File</button>
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
              <div class="cam-placeholder-text">Camera Standby<br><small>Click "Start Camera" to begin</small></div>
            </div>
          </div>

          <div class="cam-controls" id="bws-controls">
            <button class="btn btn-secondary" onclick="BioScanner.__clickUpload()">🖼 Upload</button>
            <button class="btn btn-primary" id="bws-btn-main" style="min-width:180px;" onclick="BioScanner.__startCamera()">📷 Start Camera</button>
          </div>
        </div>

        <div id="bws-result"></div>
      </div>`;
    }

    // ── Settings ───────────────────────────────────────────────────────────────
    function __toggleSettings() {
        const s = document.getElementById('bws-settings');
        const m = document.getElementById('bws-main-view');
        if (s.style.display === 'none') {
            s.style.display = 'block'; m.style.opacity = '0.2'; m.style.pointerEvents = 'none';
        } else {
            s.style.display = 'none'; m.style.opacity = '1'; m.style.pointerEvents = 'auto';
        }
    }

    function __updateProvider() {
        __aiProvider = document.getElementById('bws-ai-provider').value;
    }

    async function __saveApiKey() {
        const key = document.getElementById('bws-api-key-input').value.trim();
        const prov = document.getElementById('bws-ai-provider').value;
        __apiKey = key; __aiProvider = prov;
        await __storage.set('settings:api_key', key);
        await __storage.set('settings:ai_provider', prov);
        __toast('✓ AI Engine Updated');
        __toggleSettings(); __render();
    }

    // ── Camera ─────────────────────────────────────────────────────────────────
    function __setMode(mode) {
        document.getElementById('bws-mode-cam')?.classList.toggle('on', mode === 'camera');
        document.getElementById('bws-mode-upload')?.classList.toggle('on', mode === 'upload');
        if (mode === 'upload') { __stopCamera(); __clickUpload(); }
        else __startCamera();
    }

    function __clickUpload() {
        const fi = document.getElementById('file-input');
        if (fi) { fi.removeAttribute('capture'); fi.click(); }
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
            if (mainBtn) { mainBtn.textContent = '📸 Analyze Now'; mainBtn.onclick = () => __captureFrame(); }
            if (scanLine) scanLine.style.display = 'block';
        } catch (err) {
            if (placeholder) placeholder.innerHTML = `<div class="cam-placeholder-text">Camera error: ${err.message}</div>`;
        }
    }

    function __captureFrame() {
        const video = document.getElementById('bws-video');
        const canvas = document.getElementById('bws-canvas');
        if (!video || !canvas) return;
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        canvas.getContext('2d').drawImage(video, 0, 0);
        const dataURL = canvas.toDataURL('image/jpeg', 0.8);
        __imageB64 = dataURL.split(',')[1];
        __stopCamera();
        __showPreview(dataURL);
    }

    function __showPreview(dataURL) {
        const preview = document.getElementById('bws-preview');
        const video = document.getElementById('bws-video');
        const mainBtn = document.getElementById('bws-btn-main');
        const controls = document.getElementById('bws-controls');

        if (preview) { preview.src = dataURL; preview.style.display = 'block'; }
        if (video) video.style.display = 'none';
        if (mainBtn) { mainBtn.textContent = '🔄 Retake'; mainBtn.onclick = () => __retake(); }

        if (controls && !document.getElementById('bws-analyse-btn')) {
            const btn = document.createElement('button');
            btn.id = 'bws-analyse-btn'; btn.className = 'btn btn-primary';
            btn.style.minWidth = '180px'; btn.textContent = '🔍 Run Analysis';
            btn.onclick = () => __analyse();
            controls.appendChild(btn);
        }
    }

    function __retake() {
        __imageB64 = null; __stopCamera();
        const preview = document.getElementById('bws-preview');
        const mainBtn = document.getElementById('bws-btn-main');
        const analyBtn = document.getElementById('bws-analyse-btn');
        const result = document.getElementById('bws-result');

        if (preview) preview.style.display = 'none';
        if (analyBtn) analyBtn.remove();
        if (result) result.innerHTML = '';
        if (mainBtn) { mainBtn.textContent = '📷 Start Camera'; mainBtn.onclick = () => __startCamera(); }
        __startCamera();
    }

    function __back() { __stopCamera(); if (__opts.onBack) __opts.onBack(); }

    // ── Analysis Logic ────────────────────────────────────────────────────────
    async function __analyse() {
        if (!__imageB64) { __toast('⚠ Capture image first'); return; }

        const resultArea = document.getElementById('bws-result');
        const analyBtn = document.getElementById('bws-analyse-btn');
        if (analyBtn) analyBtn.disabled = true;

        resultArea.innerHTML = `
      <div class="result-panel">
        <div class="analysing-box">
          <div class="bw-spinner"></div>
          <div style="font-family:var(--font,sans-serif);font-size:18px;font-weight:700;">${__apiKey ? 'AI Vision Analysing…' : 'Smart Context Analysis…'}</div>
          <div class="scan-dots"><div class="scan-dot"></div><div class="scan-dot"></div><div class="scan-dot"></div></div>
          <div class="scan-steps" id="bws-step-txt">${__apiKey ? 'Processing high-res visual data...' : 'Analyzing image context colors...'}</div>
        </div>
      </div>`;

        if (__apiKey) {
            try {
                if (__aiProvider === 'gemini') await __callGemini();
                else await __callAnthropic();
            } catch (err) {
                console.error('[BioScanner] AI Error:', err);
                __toast('⚠ AI Failed. Falling back to Smart Vision.');
                __displayResult(__smartSimulation());
            }
        } else {
            setTimeout(() => __displayResult(__smartSimulation()), 2500);
        }
        if (analyBtn) analyBtn.disabled = false;
    }

    // ── Smart Vision Simulation (Reads Actual Pixels) ────────────────────────
    function __smartSimulation() {
        const canvas = document.getElementById('bws-canvas');
        const ctx = canvas.getContext('2d');
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

        let r = 0, g = 0, b = 0;
        for (let i = 0; i < pixels.length; i += 40) { r += pixels[i]; g += pixels[i + 1]; b += pixels[i + 2]; }
        const count = pixels.length / 40;
        r /= count; g /= count; b /= count;

        const isOrganic = (g > r + 10 && g > b) || (r > 120 && g > 110 && b < 80); // Green/Brown/Yellow
        const isPlastic = (b > r + 10) || (r > 210 && g > 210 && b > 210); // Blue or White

        let detectedItems = [];
        let score = 95;

        if (isOrganic) {
            detectedItems = [{ name: 'Organic Waste', category: 'Organic', isContaminant: false, emoji: '🍃' }];
            if (isPlastic) { detectedItems.push({ name: 'Plastic Pouch', category: 'Plastic', isContaminant: true, emoji: '🥤' }); score = 65; }
        } else if (isPlastic) {
            detectedItems = [{ name: 'Plastic Bottle', category: 'Plastic', isContaminant: true, emoji: '🥤' }, { name: 'Packaging', category: 'Mixed', isContaminant: true, emoji: '📦' }];
            score = 40;
        } else {
            detectedItems = [{ name: 'Non-Organic Waste', category: 'Mixed', isContaminant: true, emoji: '🗑️' }];
            score = 30;
        }

        return {
            segregationScore: score,
            overallGrade: score > 80 ? 'Excellent' : score > 50 ? 'Fair' : 'Poor',
            gradeSummary: score > 80 ? "Clean organic batch detected." : "High contamination levels detected.",
            detectedItems,
            recommendations: score < 80 ? [{ icon: '🧤', text: 'Remove non-organic items.' }] : [{ icon: '✨', text: 'Batch ready for pick-up.' }],
            biogasSuitability: score > 75 ? 'Ideal' : 'Reject',
            estimatedOrganicPercent: score > 80 ? 98 : 45,
            actionRequired: score < 80
        };
    }

    // ── AI Implementation ──────────────────────────────────────────────────────
    const SYSTEM_PROMPT = 'Analyze this waste image. Return ONLY JSON: { "segregationScore": 0-100, "overallGrade": "Excellent|Good|Fair|Poor|Rejected", "gradeSummary": "...", "detectedItems": [{"name": "...", "category": "...", "isContaminant": bool, "emoji": "..."}], "biogasSuitability": "...", "estimatedOrganicPercent": 0-100, "actionRequired": bool }';

    async function __callGemini() {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${__apiKey}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: SYSTEM_PROMPT }, { inline_data: { mime_type: 'image/jpeg', data: __imageB64 } }] }]
            })
        });
        const data = await response.json();
        const result = JSON.parse(data.candidates[0].content.parts[0].text.replace(/```json/g, '').replace(/```/g, ''));
        __displayResult(result);
    }

    async function __callAnthropic() {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'x-api-key': __apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', 'anthropic-dangerous-direct-browser-access': 'true' },
            body: JSON.stringify({
                model: 'claude-3-haiku-20240307', max_tokens: 1024,
                messages: [{ role: 'user', content: [{ type: 'text', text: SYSTEM_PROMPT }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: __imageB64 } }] }]
            })
        });
        const data = await response.json();
        const result = JSON.parse(data.content[0].text.replace(/```json/g, '').replace(/```/g, ''));
        __displayResult(result);
    }

    function __displayResult(r) {
        const resultArea = document.getElementById('bws-result');
        if (!resultArea) return;

        const score = r.segregationScore || 0;
        const headerBg = score > 80 ? 'linear-gradient(135deg,#0F6E56,#1D9E75)' : score > 50 ? 'linear-gradient(135deg,#6B3E0A,#BA7517)' : 'linear-gradient(135deg,#8B2E0E,#D85A30)';
        const C = 2 * Math.PI * 34;
        const dashOffset = C * (1 - score / 100);

        resultArea.innerHTML = `
      <div class="result-panel" style="margin-top:24px; animation: fadeIn 0.4s ease-out;">
        <div class="result-header" style="background:${headerBg}; border-radius:20px 20px 0 0; padding: 24px;">
          <div class="score-ring-wrap" style="display:flex; align-items:center; gap:24px;">
            <div class="score-ring" style="position:relative; width:80px; height:80px;">
              <svg viewBox="0 0 80 80" width="80" height="80"><circle cx="40" cy="40" r="34" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="6"/><circle cx="40" cy="40" r="34" fill="none" stroke="#fff" stroke-width="6" stroke-dasharray="${C}" stroke-dashoffset="${dashOffset}" stroke-linecap="round"/></svg>
              <div class="score-ring-num" style="position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); color:#fff; font-weight:800; font-size:22px;">${score}</div>
            </div>
            <div>
              <div class="score-grade-label" style="color:#fff; font-weight:800; font-size:24px; line-height:1; font-family:'Space Grotesk';">${r.overallGrade}</div>
              <div style="margin-top:10px; display:flex; gap:8px;">
                <span class="badge badge-teal" style="font-size:11px;">⚗ ${r.biogasSuitability}</span>
                ${r.actionRequired ? '<span class="badge badge-red" style="font-size:11px;">⚠ Sorting Needed</span>' : '<span class="badge badge-green" style="font-size:11px;">✓ Ready</span>'}
              </div>
            </div>
          </div>
        </div>
        <div class="result-body" style="padding: 24px; background: var(--surface); border-radius: 0 0 20px 20px;">
          <div style="font-size:15px; color:var(--text-muted); margin-bottom:20px; font-style:italic;">"${r.gradeSummary}"</div>
          <div class="detected-grid">${(r.detectedItems || []).map(i => `
            <div class="detected-item" style="background:${i.isContaminant ? 'rgba(239, 68, 68, 0.05)' : 'rgba(16, 185, 129, 0.05)'};">
              <div class="detected-item-name"><span>${i.emoji}</span> ${i.name}</div>
            </div>`).join('')}</div>
          <div style="display:flex; gap:12px; margin-top:24px;">
            <button class="btn btn-secondary" onclick="BioScanner.__retake()" style="flex:1;">🔄 New Scan</button>
            <button class="btn btn-primary" onclick="BioScanner.__applyResult(${score}, ${r.estimatedOrganicPercent})" style="flex:1.5;">📥 Apply Data</button>
          </div>
        </div>
      </div>`;
    }

    function __applyResult(score, organicPercent) {
        if (typeof __opts.onApply === 'function') __opts.onApply(score, organicPercent);
    }

    async function open(options) {
        __opts = options || {}; await __init(); __render();
    }

    function stop() {
        __stopCamera();
    }

    return {
        open, stop, handleFileUpload, __back, __setMode, __clickUpload, __startCamera, __captureFrame, __retake, __analyse, __applyResult, __toggleSettings, __saveApiKey, __updateProvider
    };

})();
