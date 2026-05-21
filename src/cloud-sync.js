/**
 * @fileoverview ReGenX Appwrite Cloud Sync Engine
 * Handles real-time synchronization between LocalStorage and Appwrite Cloud Databases.
 * Integrates WebSockets for Live Dispatch updates.
 * @author GSSoC Contributor
 */

const STORAGE_KEY_PREFIX = "regenx-v3:";

/**
 * Retrieves a local order from LocalStorage.
 * @param {string} id - The order ID.
 * @returns {Object|null} The order object or null if not found/error.
 */
function getLocalOrder(id) {
    try {
        const val = localStorage.getItem(STORAGE_KEY_PREFIX + 'ord:' + id);
        return val ? JSON.parse(val) : null;
    } catch (e) {
        return null;
    }
}

export const CloudSync = {
    client: null,
    databases: null,
    isLive: false,
    config: null,
    unsubscribe: null,

    /**
     * Loads configurations from the .env file at runtime.
     * @returns {Promise<Object>} The parsed configuration object.
     */
    loadConfig: async () => {
        const config = {
            endpoint: 'https://cloud.appwrite.io/v1',
            projectId: '',
            databaseId: '',
            ordersCollectionId: ''
        };

        try {
            const response = await fetch('/.env');
            if (response.ok) {
                const text = await response.text();
                const lines = text.split(/\r?\n/);
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed.startsWith('#')) continue;
                    
                    const eqIndex = trimmed.indexOf('=');
                    if (eqIndex === -1) continue;
                    
                    const key = trimmed.substring(0, eqIndex).trim();
                    let val = trimmed.substring(eqIndex + 1).trim();
                    
                    // Strip quotes if present
                    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                        val = val.substring(1, val.length - 1);
                    }
                    
                    if (key === 'VITE_APPWRITE_ENDPOINT' || key === 'APPWRITE_ENDPOINT') {
                        config.endpoint = val;
                    } else if (key === 'VITE_APPWRITE_PROJECT_ID' || key === 'APPWRITE_PROJECT_ID') {
                        config.projectId = val;
                    } else if (key === 'VITE_APPWRITE_DATABASE_ID' || key === 'APPWRITE_DATABASE_ID') {
                        config.databaseId = val;
                    } else if (key === 'VITE_APPWRITE_COLLECTION_ID_ORDERS' || key === 'APPWRITE_COLLECTION_ID_ORDERS') {
                        config.ordersCollectionId = val;
                    }
                }
            } else {
                console.warn("Could not load /.env file, status:", response.status);
            }
        } catch (e) {
            console.warn("Failed to fetch or parse .env file. Falling back to defaults.", e);
        }

        // Check window process for fallback
        if (window.process && window.process.env) {
            config.endpoint = window.process.env.VITE_APPWRITE_ENDPOINT || window.process.env.APPWRITE_ENDPOINT || config.endpoint;
            config.projectId = window.process.env.VITE_APPWRITE_PROJECT_ID || window.process.env.APPWRITE_PROJECT_ID || config.projectId;
            config.databaseId = window.process.env.VITE_APPWRITE_DATABASE_ID || window.process.env.APPWRITE_DATABASE_ID || config.databaseId;
            config.ordersCollectionId = window.process.env.VITE_APPWRITE_COLLECTION_ID_ORDERS || window.process.env.APPWRITE_COLLECTION_ID_ORDERS || config.ordersCollectionId;
        }

        return config;
    },

    /**
     * Initializes the Appwrite Web SDK and establishes Realtime connection.
     * @returns {Promise<void>}
     */
    init: async () => {
        if (!window.Appwrite) {
            console.warn("Appwrite SDK not loaded.");
            CloudSync.renderSyncBadge('offline', 'Offline');
            return;
        }

        try {
            const config = await CloudSync.loadConfig();
            
            if (!config.projectId || !config.databaseId || !config.ordersCollectionId) {
                console.warn("Appwrite credentials not fully configured in .env. Running in local mode.");
                CloudSync.isLive = false;
                CloudSync.renderSyncBadge('local', 'Local Mode');
                return;
            }

            const { Client, Databases } = window.Appwrite;
            
            CloudSync.client = new Client()
                .setEndpoint(config.endpoint) 
                .setProject(config.projectId);

            CloudSync.databases = new Databases(CloudSync.client);
            CloudSync.isLive = true;
            CloudSync.config = config;

            console.log("☁️ Appwrite Cloud Sync Engine Initialized");
            CloudSync.renderSyncBadge('live', 'Cloud Live');
            
            // Setup Realtime Subscription
            CloudSync.subscribeToDispatches();
        } catch (e) {
            console.error("CloudSync Init Failed:", e);
            CloudSync.isLive = false;
            CloudSync.renderSyncBadge('error', 'Sync Error');
        }
    },

    /**
     * Renders a premium Glassmorphic sync badge in the DOM header.
     * @param {string} [status='local'] - The status ('live', 'local', 'error', 'offline', or 'syncing').
     * @param {string} [label='Local Mode'] - The label to display.
     * @returns {void}
     */
    renderSyncBadge: (status = 'local', label = 'Local Mode') => {
        const topbarUser = document.querySelector('.topbar-user');
        const header = document.querySelector('header');
        if (!topbarUser && !header) return;

        let dotColor = '#64748b'; // Slate
        let borderColor = 'rgba(100, 116, 139, 0.2)';
        let bgStyle = 'background: rgba(100, 116, 139, 0.05);';
        let pulseAnim = '';

        if (status === 'live') {
            dotColor = '#10b981'; // Green
            borderColor = 'rgba(16, 185, 129, 0.3)';
            bgStyle = 'background: rgba(16, 185, 129, 0.1); backdrop-filter: blur(10px);';
            pulseAnim = 'animation: cs-pulse 2s infinite;';
        } else if (status === 'syncing') {
            dotColor = '#f59e0b'; // Amber
            borderColor = 'rgba(245, 158, 11, 0.3)';
            bgStyle = 'background: rgba(245, 158, 11, 0.1); backdrop-filter: blur(10px);';
            pulseAnim = 'animation: cs-pulse 0.8s infinite;';
        } else if (status === 'local') {
            dotColor = '#6366f1'; // Indigo/Blue
            borderColor = 'rgba(99, 102, 241, 0.3)';
            bgStyle = 'background: rgba(99, 102, 241, 0.08); backdrop-filter: blur(10px);';
            pulseAnim = 'animation: cs-pulse-slow 3s infinite;';
        } else if (status === 'error') {
            dotColor = '#ef4444'; // Red
            borderColor = 'rgba(239, 68, 68, 0.3)';
            bgStyle = 'background: rgba(239, 68, 68, 0.1); backdrop-filter: blur(10px);';
            pulseAnim = 'animation: cs-pulse 1s infinite;';
        } else if (status === 'offline') {
            dotColor = '#64748b'; // Gray
            borderColor = 'rgba(100, 116, 139, 0.2)';
            bgStyle = 'background: rgba(100, 116, 139, 0.05); backdrop-filter: blur(10px);';
        }

        const badgeHtml = `
            <div id="cloud-sync-badge" class="sync-badge" style="border:1px solid ${borderColor}; ${bgStyle}">
                <div class="sync-badge-dot" style="background:${dotColor}; box-shadow:0 0 8px ${dotColor}; ${pulseAnim}"></div>
                <span class="sync-badge-text" style="color:${dotColor};">${label}</span>
            </div>
            <style>
                @keyframes cs-pulse {
                    0% { opacity: 1; transform: scale(1); }
                    50% { opacity: 0.4; transform: scale(1.25); }
                    100% { opacity: 1; transform: scale(1); }
                }
                @keyframes cs-pulse-slow {
                    0% { opacity: 1; transform: scale(1); }
                    50% { opacity: 0.6; transform: scale(1.1); }
                    100% { opacity: 1; transform: scale(1); }
                }
            </style>
        `;
        
        // Remove existing badge if present
        const existing = document.getElementById('cloud-sync-badge');
        if (existing) existing.remove();

        // Insert inside topbar-user at the start, or fallback to header end
        if (topbarUser) {
            topbarUser.insertAdjacentHTML('afterbegin', badgeHtml);
        } else if (header) {
            header.insertAdjacentHTML('beforeend', badgeHtml);
        }
    },

    /**
     * Subscribes to the Appwrite Realtime API for incoming dispatches.
     * @returns {void}
     */
    subscribeToDispatches: () => {
        if (!CloudSync.client || !CloudSync.config) return;

        const channel = `databases.${CloudSync.config.databaseId}.collections.${CloudSync.config.ordersCollectionId}.documents`;
        console.log(`📡 Subscribed to Appwrite Realtime: ${channel}`);
        
        try {
            CloudSync.unsubscribe = CloudSync.client.subscribe(channel, response => {
                console.log("⚡ Appwrite Realtime Event Received:", response);
                
                const syncedOrder = response.payload;
                if (!syncedOrder || !syncedOrder.id) return;
                
                const localOrder = getLocalOrder(syncedOrder.id);
                
                const hasChanged = !localOrder || 
                                   localOrder.status !== syncedOrder.status ||
                                   localOrder.kg !== syncedOrder.kg ||
                                   localOrder.actualKg !== syncedOrder.actualKg ||
                                   localOrder.quality !== syncedOrder.quality ||
                                   localOrder.riderId !== syncedOrder.riderId ||
                                   localOrder.riderName !== syncedOrder.riderName;
                                   
                if (hasChanged) {
                    console.log(`🔄 Synced order [${syncedOrder.id}] has changes. Saving locally.`);
                    
                    const originalLive = CloudSync.isLive;
                    CloudSync.isLive = false;
                    try {
                        window.saveOrder(syncedOrder);
                    } finally {
                        CloudSync.isLive = originalLive;
                    }
                    
                    if (window.showToast) {
                        window.showToast("☁️ Real-Time: Dispatch status updated!");
                    }
                    
                    if (window.refreshCurrentView) {
                        window.refreshCurrentView(true);
                    }
                }
            });
        } catch (e) {
            console.error("Failed to subscribe to Appwrite Realtime:", e);
            CloudSync.renderSyncBadge('error', 'Sync Error');
        }
    },

    /**
     * Sanitizes an order object to match database attribute schemas.
     * Ensures all values match correct types.
     * @param {Object} doc - Raw order document.
     * @returns {Object} Sanitized object ready for Appwrite.
     */
    sanitizeDoc: (doc) => {
        const sanitized = {};
        
        const stringFields = ['id', 'providerId', 'providerOrg', 'wasteType', 'shift', 'plantId', 'plantName', 'status', 'riderId', 'riderName', 'quality'];
        stringFields.forEach(field => {
            if (doc[field] !== undefined && doc[field] !== null) {
                sanitized[field] = String(doc[field]);
            } else {
                sanitized[field] = '';
            }
        });

        const numberFields = ['ts', 'providerLat', 'providerLng', 'kg', 'actualKg'];
        numberFields.forEach(field => {
            if (doc[field] !== undefined && doc[field] !== null) {
                sanitized[field] = Number(doc[field]);
            } else {
                sanitized[field] = 0;
            }
        });

        return sanitized;
    },

    /**
     * Pushes a local state change to the Appwrite Database.
     * @param {string} collection - Target collection ID.
     * @param {Object} document - Data to sync.
     * @returns {Promise<void>}
     */
    pushDocument: async (collection, document) => {
        if (!CloudSync.isLive || !CloudSync.databases || !CloudSync.config) return;
        
        CloudSync.renderSyncBadge('syncing', 'Syncing...');

        try {
            const sanitizedDoc = CloudSync.sanitizeDoc(document);
            const { databaseId, ordersCollectionId } = CloudSync.config;

            try {
                await CloudSync.databases.updateDocument(
                    databaseId,
                    ordersCollectionId,
                    document.id,
                    sanitizedDoc
                );
                console.log(`☁️ Synced to Appwrite (Updated) -> Collection [${ordersCollectionId}]`, sanitizedDoc);
            } catch (updateErr) {
                if (updateErr.code === 404) {
                    await CloudSync.databases.createDocument(
                        databaseId,
                        ordersCollectionId,
                        document.id,
                        sanitizedDoc
                    );
                    console.log(`☁️ Synced to Appwrite (Created) -> Collection [${ordersCollectionId}]`, sanitizedDoc);
                } else {
                    throw updateErr;
                }
            }

            CloudSync.renderSyncBadge('live', 'Cloud Live');
        } catch (e) {
            console.error("Failed to sync document to Appwrite:", e);
            CloudSync.renderSyncBadge('error', 'Sync Error');
        }
    }
};

window.CloudSync = CloudSync;
