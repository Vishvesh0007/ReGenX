<div align="center">

### 👨‍🏫 Project Mentor
**Satyam Pandey**

- LinkedIn: https://www.linkedin.com/in/satyam-pandey-0b246432a/
- Phone: 9820866720

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
<div align="center">
 
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

</div>

---

<div align="center">

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
| Storage | LocalStorage cache + Socket.IO realtime state sync |

</div>

---

<div align="center">
 
## 🚀 Getting Started

</div>

### Prerequisites
- Node.js (for local dev server)
- A modern browser (Chrome / Edge recommended for camera access)

### Run Locally

```bash
# Clone the repository
git clone https://github.com/your-username/ReGenX.git
cd ReGenX

# Install dependencies
npm install

# Start development server
npm run serve
```
Then open `http://localhost:4173` in your browser.

The realtime server keeps Provider, Rider, and Plant dashboards synchronized across open tabs and devices.

### First-Time Setup
1. Click **Register** and choose your role (Provider / Rider / Plant)
2. Set your location via GPS or address search
3. Login and explore your role-specific dashboard

> **Tip:** Register at least one Provider and one Rider to simulate a full pickup flow!

---

<div align="center">
 
## 📦 Deployment (Appwrite Sites)

</div>

1. Copy `.env.example` to `.env`
2. Fill in your Appwrite credentials:
```env
APPWRITE_ENDPOINT=https://cloud.appwrite.io/v1
APPWRITE_PROJECT_ID=your-project-id
APPWRITE_API_KEY=your-private-api-key
```
3. Deploy:
```bash
npm run deploy:appwrite
```

> ⚠️ **Never expose your Appwrite API key in frontend code.**

The deploy script will:
- Create the Appwrite Site if it doesn't exist
- Upload the static project as a new deployment
- Wait for build completion and auto-activate

---

## 📁 Project Structure

```
ReGenX/
├── .github/                  # GSSoC Issue and PR templates
├── scripts/                  # Deployment scripts
│   └── appwrite-deploy.mjs   # Appwrite automatic site deployment
├── src/
│   ├── app.js                # Core application logic (all roles)
│   ├── esg-reporter.js       # ESG compliance and PDF report generator
│   ├── intelligence.js       # Core data metrics computation layer
│   ├── scanner.js            # BioScanner AI module configuration
│   ├── styles.css            # Global premium design system & components
│   ├── trust.js              # Fraud prevention and token mechanics
│   ├── vision-scanner.js     # TensorFlow.js camera asset model loader
│   └── yield-optimizer.js    # AI processing yield configuration tool
├── .env.example              # Environment variable template
├── .gitignore                # Git tracked-file exemptions
├── appwrite.config.example.json
├── index.html                # App shell & login UI
├── manifest.json             # PWA mobile layout configuration
├── package-lock.json
├── package.json              # Build configuration and scripts
├── push.bat                  # Automated local utility execution script
├── README.md                 # Project documentation
└── service-worker.js         # Offline caching and performance optimization
```

---

<div align="center">
 
## 🔄 Pickup Workflow

```
Provider creates dispatch request
        ↓
   (Optional) BioScan AI verifies waste quality
        ↓
   Request appears on Rider's job board
        ↓
   Rider accepts → navigates to pickup location
        ↓
   Rider confirms collection (actual kg + AI scan)
        ↓
   Rider marks "Arrived at Plant"
        ↓
   Plant confirms receipt → order COMPLETED
        ↓
   Provider earns $RGX tokens 🪙
```

</div>

---

<div align="center">

## 🌱 Environmental Impact

Every completed dispatch through ReGenX:
- Diverts bio-waste from landfills
- Calculates **CO₂ offset** (0.62 kg CO₂ per kg bio-waste)
- Mints verifiable $RGX carbon credits
- Contributes to the global Green Wall feed

---

## 📸 Screenshots

> *Coming soon — deploy and capture your dashboard!*

---

## 🤝 Contributing

Pull requests are welcome! For major changes, please open an issue first to discuss what you'd like to change.

---

## 📄 License

This project is open source. See [LICENSE](LICENSE) for details.

</div>

---

<div align="center">

Made with 💚 for a cleaner planet · **ReGenX** · *Closing the loop on bio-waste*

</div>