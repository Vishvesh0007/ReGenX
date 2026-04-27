 <div align="center">

# 🌿 ReGenX

### *Smart Circular Bio-Waste Logistics Platform with AI scanning, real-time GPS tracking, and role-based dashboards for Providers, Riders & Processing Plants.*

![HTML](https://img.shields.io/badge/HTML5-E34F26?style=flat&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=flat&logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat&logo=javascript&logoColor=black)
![TensorFlow](https://img.shields.io/badge/TensorFlow.js-FF6F00?style=flat&logo=tensorflow&logoColor=white)
![Leaflet](https://img.shields.io/badge/Leaflet-199900?style=flat&logo=leaflet&logoColor=white)
![PWA](https://img.shields.io/badge/PWA-5A0FC8?style=flat&logo=pwa&logoColor=white)
![Chart.js](https://img.shields.io/badge/Chart.js-FF6384?style=flat&logo=chartdotjs&logoColor=white)

> A premium Progressive Web App that digitizes the entire bio-waste supply chain — from hotel waste generation, through GPS-tracked rider pickup, to verified delivery at processing plants — all powered by AI and rewarded with blockchain tokens.

</div>

---

## ✨ Features

### 🤖 AI-Powered Bio Scanner
- Real-time waste image analysis using **TensorFlow.js + MobileNet**
- Contamination detection and organic percentage scoring
- Auto-fills dispatch form fields based on scan results
- Supports live camera capture and file upload

### 📍 Real-Time GPS & Mapping
- High-accuracy GPS detection with draggable pin refinement
- Address-based geocoding via **Nominatim / OpenStreetMap**
- 50km service radius enforcement for route eligibility
- Live rider tracking with **Leaflet.js** interactive maps

### 👥 Role-Based Dashboards
| Role | Capabilities |
|---|---|
| 🏨 **Provider** (Hotel/Hostel) | Create dispatch requests, scan waste, track active pickups, view analytics |
| 🚛 **Rider** | Accept routes, navigate to pickup, confirm collection with AI scan |
| ⚗️ **Plant** | Monitor incoming waste flow, confirm receipt, log processed output |

### 🪙 $RGX Token Economy
- Providers earn **$RGX tokens** on every verified pickup
- Trade tokens on the **ReGen DeFi Exchange** (CSR NFTs, Smart Bin Hardware, Energy Vouchers)
- Stake tokens in the **Carbon Credit Fund** (12.5% APY)
- Contribute to the **Amazon Reforestation Initiative** crowdfund

### 🌍 Impact & Analytics
- CO₂ offset calculator (per completed dispatch)
- Weekly/Monthly waste history with Chart.js bar charts
- Regional Leaderboard (top waste diverters in your area)
- AI-predicted waste volume for next day
- **The Green Wall** — live community sustainability activity feed

### 🎨 Premium UI/UX
- Glassmorphism design with dark/light theme toggle
- Live ticker bar with real-time platform activity
- Smooth micro-animations and transitions
- Fully responsive — mobile-first PWA with offline support
- Space Grotesk + Inter typography

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Structure | HTML5 (Semantic) |
| Styling | Vanilla CSS3 (Glassmorphism, CSS Variables) |
| Logic | Vanilla JavaScript (ES6 Modules) |
| AI / ML | TensorFlow.js, MobileNet |
| Maps | Leaflet.js, OpenStreetMap, Nominatim |
| Charts | Chart.js |
| PWA | Service Worker, Web App Manifest |
| Weather | Open-Meteo API |
| Storage | LocalStorage (demo-ready, no backend needed) |

---

## 🚀 Getting Started

### Prerequisites
- Node.js (for local dev server)
- A modern browser (Chrome / Edge recommended for camera access)

### Run Locally

```bash
git clone https://github.com/Shruti070107/ReGenX.git
cd ReGenX
npm install
npm run serve




## Local development

```bash
npm run serve
```

## Appwrite deployment

Appwrite Sites currently expects your project endpoint and project ID in addition to an API key. The deployment script uses server-side environment variables and keeps secrets out of the browser bundle.

1. Copy `.env.example` to `.env`.
2. Fill in `APPWRITE_ENDPOINT`, `APPWRITE_PROJECT_ID`, and `APPWRITE_API_KEY`.
3. Run:

```bash
npm run deploy:appwrite
```

The script will:

- create the Appwrite Site if it does not exist
- upload the current static project as a deployment
- wait for the deployment to finish
- activate the deployment if Appwrite leaves it in `ready`

Never expose a private Appwrite API key in frontend code.
