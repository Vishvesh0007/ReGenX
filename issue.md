---
name: "🚀 Critical & Exceptional Issue"
about: "Use this template for high-impact features or critical bug fixes to earn maximum GSSoC points."
title: "[BUG] doLogout leaves timers, chart instances, and map unreleased"
labels: ["level:critical", "quality:exceptional", "type:bug"]
assignees: []

---

## 🌟 GSSoC Scoring Details
- **Base Points:** 50 (with `gssoc:approved`)
- **Difficulty:** `level:critical`
- **Quality:** `quality:exceptional`
- **Expected Score:** 50 + (Critical × Exceptional) + Type Bonus

---

### 📝 Description
When a user logs out of the ReGenX platform, the `doLogout` function only clears the `autoRefreshTimer`. Several other long-lived background resources started during a session are never torn down. This leads to severe memory leaks, orphaned Chart.js and Leaflet map instances, and continuous background timer executions that throw console errors and degrade performance after logout.

This is **Critical** for the ReGenX platform because it directly degrades the PWA's resource efficiency, leaks user data across sessions, and generates constant JS console exceptions that break our clean-code quality standard.

### 🎯 Objective
Ensure that logging out fully and cleanly releases all active background timers, destroys Chart.js instances, and removes the Leaflet map so that no background activity or memory leakage survives a logout event.

### 🛠️ Proposed Technical Stack
- **Structure:** Semantic HTML5
- **Logic:** Vanilla JS (ES6+)
- **APIs/Libraries:** Chart.js, Leaflet.js

### Affected Resources Table
| Resource | Variable | Effect when left running |
|---|---|---|
| IoT simulation | `_iotSimTimer` | Writes to `localStorage` every 8 s; calls `syncIoTAlertBadge()` against a DOM node that no longer exists |
| Provider chart | `pvChartInstance` | Orphaned Chart.js instance held in memory |
| Plant chart | `plChartInstance` | Orphaned Chart.js instance held in memory |
| Ticker | `tickerTimer` | Writes to `#global-ticker` (destroyed) |
| Green wall | `gwTimer` | Reads from `#gw-feed` (destroyed) |
| Leaflet map | `rMap` | Map + tile layers held in memory |

### Steps to Reproduce
1. Log in as a **Provider** and open **IoT Sensory Bins** (starts `_iotSimTimer` interval).
2. Click the **Logout** button.
3. Open the browser's DevTools console: notice `syncIoTAlertBadge` errors appear every 8 seconds due to missing DOM nodes.
4. Log in again and repeat: a second timer is now running concurrently alongside the first, compounding the memory leaks.

### 💎 Quality Standards (for "Exceptional" Label)
To maintain the `quality:exceptional` label, the implementation MUST:
- [x] Clear all active interval timers (`tickerTimer`, `gwTimer`, and `_iotSimTimer`).
- [x] Properly call `stopIoTSim()` helper function.
- [x] Safely destroy Chart.js instances if they exist (`pvChartInstance.destroy()`, etc.) and set references to `null`.
- [x] Safely remove the Leaflet map instance (`rMap.remove()`) and nullify its reference.
- [x] Have **Zero Console Errors** after logout.

### ✅ Checklist
- [x] I am a GSSoC'26 contributor.
- [x] I have read the `CONTRIBUTING.md` guidelines.
- [x] I will provide a high-quality PR within the deadline.
