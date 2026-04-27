const elements = {
    endpointBtns: document.querySelectorAll('.endpoint-btn'),
    jsonViewer: document.getElementById('json-viewer'),
    currentUrl: document.getElementById('current-url'),
    refreshBtn: document.getElementById('refresh-btn'),
    copyBtn: document.getElementById('copy-btn'),
    paramValue: document.getElementById('param-value'),
    runParamBtn: document.getElementById('run-param-btn'),
    responseMeta: document.getElementById('response-meta'),
    apiStatus: document.getElementById('api-status'),
    statTotal: document.getElementById('stat-total'),
    statZonas: document.getElementById('stat-zonas'),
    tabBtns: document.querySelectorAll('.tab-btn'),
    tabContents: document.querySelectorAll('.tab-content')
};

let activeEndpoint = '/api/status';
let map, markerLayer;

// Initialize
async function init() {
    setupEventListeners();
    initMap();
    await fetchData(activeEndpoint);
    await updateStats();
}

function initMap() {
    map = L.map('map').setView([28.2916, -16.6291], 10);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap'
    }).addTo(map);
    markerLayer = L.layerGroup().addTo(map);
}

function setupEventListeners() {
    elements.endpointBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            elements.endpointBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeEndpoint = btn.dataset.url;
            fetchData(activeEndpoint);
        });
    });

    elements.tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            elements.tabBtns.forEach(b => b.classList.remove('active'));
            elements.tabContents.forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(`${tab}-tab`).classList.add('active');
            if (tab === 'map') {
                setTimeout(() => map.invalidateSize(), 100);
            }
        });
    });

    elements.refreshBtn.addEventListener('click', () => fetchData(activeEndpoint));

    elements.copyBtn.addEventListener('click', () => {
        const text = elements.jsonViewer.textContent;
        navigator.clipboard.writeText(text).then(() => {
            const icon = elements.copyBtn.querySelector('i');
            icon.classList.replace('far', 'fas');
            icon.classList.replace('fa-copy', 'fa-check');
            setTimeout(() => {
                icon.classList.replace('fas', 'far');
                icon.classList.replace('fa-check', 'fa-copy');
            }, 2000);
        });
    });

    elements.runParamBtn.addEventListener('click', () => runParameterizedQuery());
    elements.paramValue.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') runParameterizedQuery();
    });
}

async function fetchData(url) {
    const startTime = performance.now();
    elements.currentUrl.textContent = url;
    elements.jsonViewer.textContent = '// Cargando datos de la API...';
    elements.jsonViewer.style.opacity = '0.5';

    try {
        const response = await fetch(url);
        const contentType = response.headers.get("content-type");
        
        if (!response.ok && response.status === 503) {
            elements.jsonViewer.textContent = '// El servidor está sincronizando datos todavía. Un momento...';
            return;
        }

        if (!contentType || !contentType.includes("application/json")) {
            const text = await response.text();
            elements.jsonViewer.textContent = `// Error del Servidor (No JSON):\n${text.substring(0, 500)}`;
            elements.apiStatus.innerHTML = `<span class="pulse" style="background: #ef4444"></span> Error`;
            return;
        }
        
        const duration = Math.round(performance.now() - startTime);
        const data = await response.json();

        elements.jsonViewer.textContent = JSON.stringify(data, null, 4);
        elements.jsonViewer.style.opacity = '1';
        elements.responseMeta.textContent = `Status: ${response.status} ${response.statusText} | Time: ${duration} ms`;
        
        elements.apiStatus.innerHTML = `<span class="pulse" style="background: var(--primary)"></span> API Online`;
        
        updateMap(data);
    } catch (error) {
        elements.jsonViewer.textContent = `// El servidor de Render está despertando o hay un problema de red.\n// Reintentando en 5 segundos...`;
        elements.jsonViewer.style.opacity = '0.7';
        elements.apiStatus.innerHTML = `<span class="pulse" style="background: #f59e0b"></span> Despertando...`;
        setTimeout(() => fetchData(url), 5000);
    }
}

function updateMap(data) {
    markerLayer.clearLayers();
    let pharmacies = [];

    if (data.farmacias && Array.isArray(data.farmacias)) {
        pharmacies = data.farmacias;
    } else if (Array.isArray(data)) {
        pharmacies = data;
    }

    // Si hay filtros de ubicación en la respuesta, marcar el centro
    if (data.filtros && data.filtros.lat && data.filtros.lng) {
        L.circle([data.filtros.lat, data.filtros.lng], {
            radius: (data.filtros.radioKm || 1) * 1000,
            color: 'var(--primary)',
            fillOpacity: 0.1,
            dashArray: '5, 10'
        }).addTo(markerLayer);
        
        L.marker([data.filtros.lat, data.filtros.lng], {
            icon: L.divIcon({
                className: 'user-marker',
                html: '<i class="fas fa-street-view" style="color: white; font-size: 20px;"></i>',
                iconSize: [20, 20]
            })
        }).bindPopup("Tu búsqueda").addTo(markerLayer);
    }

    if (pharmacies.length > 0) {
        pharmacies.forEach(f => {
            const lat = f.latitud || (f.coordenadas && f.coordenadas.lat) || f.lat;
            const lng = f.longitud || (f.coordenadas && f.coordenadas.lng) || f.lng;
            if (lat && lng) {
                const marker = L.marker([lat, lng]).bindPopup(`
                    <div style="color: black">
                        <strong>${f.nombre}</strong><br>
                        ${f.direccion || f.direccion_nombre_via || ''}<br>
                        ${f.distanciaKm ? `<b>Distancia:</b> ${f.distanciaKm} km<br>` : ''}
                        <small>${f.telefono || ''}</small>
                    </div>
                `);
                markerLayer.addLayer(marker);
            }
        });

        if (markerLayer.getLayers().length > 0) {
            const group = new L.featureGroup(markerLayer.getLayers());
            map.fitBounds(group.getBounds().pad(0.1));
        }
    }
}

async function updateStats() {
    try {
        const res = await fetch('/api/status');
        const data = await res.json();
        if (data.status === 'ok') {
            elements.statTotal.textContent = data.farmacias || 0;
            elements.statZonas.textContent = data.zonas || 0;
        }
    } catch (e) {
        console.error('Stats error:', e);
    }
}

function runParameterizedQuery() {
    const val = elements.paramValue.value.trim();
    if (!val) return;
    let target = `/api/farmacias/municipio/${val}`;
    if (val.includes('-')) target = `/api/guardia/zona/${val}`;
    elements.endpointBtns.forEach(b => b.classList.remove('active'));
    activeEndpoint = target;
    fetchData(target);
}

init();
