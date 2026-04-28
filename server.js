// PARCHE PARA RENDER (Soluciona "File is not defined" en Node 18)
if (typeof File === 'undefined') {
    global.File = class File extends (global.Blob || Array) {
        constructor(parts, filename, options = {}) {
            super(parts, options);
            this.name = filename;
            this.lastModified = options.lastModified || Date.now();
        }
    };
}

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const cheerio = require('cheerio');
const zonas = require('./src/zonas');

const app = express();
const PORT = process.env.PORT || 3000;

let datos = [];
let isDownloading = false;
let cacheGuardias = [];
let lastUpdate = null;
let isRefreshing = false;

// Funciones de utilidad para Geolocalización
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function normalizeName(name) {
    if (!name) return "";
    return name.toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/lcda\.|lcdo\.|farmacia|titular|d\.|da\./gi, '')
        .replace(/[^a-z0-9]/gi, '')
        .trim();
}

async function loadDatos() {
    if (isDownloading) return;
    isDownloading = true;
    try {
        const response = await axios.get('https://datos.tenerife.es/ckan/dataset/7d98949a-1e2f-4bdc-9280-83b81da0be35/resource/cc411345-4269-4e73-84d6-edb8a9598886/download/centros-medicos-farmacias-y-servicios-sanitarios-en-tenerife.geojson', { timeout: 30000 });
        if (response.data && response.data.features) {
            datos = response.data.features
                .filter(f => f.properties && f.properties.actividad_tipo === 'farmacia')
                .map(f => ({
                    nombre: f.properties.nombre, 
                    direccion: (f.properties.direccion_nombre_via || '') + ' ' + (f.properties.direccion_numero || ''),
                    municipio: f.properties.municipio_nombre,
                    lat: parseFloat(f.properties.latitud), 
                    lng: parseFloat(f.properties.longitud),
                    telefono: f.properties.telefono
                }));
            console.log(`✅ Base de datos cargada: ${datos.length} farmacias.`);
            
            // Una vez cargada la base de datos, refrescamos las guardias
            updateGuardiasCache();
        }
    } catch (e) { console.error('Error GeoJSON:', e.message); }
    finally { isDownloading = false; }
}

app.use(cors()); app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/status', (req, res) => res.json({ 
    status: 'ok', 
    farmacias: datos.length, 
    guardiasCached: cacheGuardias.length,
    lastUpdate,
    isRefreshing
}));

// Cache temporal para evitar saturar servicios de geocodificación
const geocodeCache = new Map();

async function geocodeAddress(address) {
    if (geocodeCache.has(address)) return geocodeCache.get(address);
    try {
        // Mejoramos la query añadiendo "Canarias" para mayor precisión
        const query = encodeURIComponent(address + ", Tenerife, Canarias, España");
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${query}&limit=1`;
        const response = await axios.get(url, { 
            headers: { 'User-Agent': 'FarmaciasTenerifeAPI/1.1 (conceptoclick)' },
            timeout: 5000 
        });
        if (response.data && response.data.length > 0) {
            const coords = {
                lat: parseFloat(response.data[0].lat),
                lng: parseFloat(response.data[0].lon)
            };
            geocodeCache.set(address, coords);
            return coords;
        }
    } catch (e) {
        console.log(`⚠️ Error geocodificando "${address}": ${e.message}`);
    }
    return null;
}

// Función para refrescar el caché de guardias (Background Task)
async function updateGuardiasCache() {
    if (isRefreshing) return;
    isRefreshing = true;
    console.log("🔄 Refrescando caché de farmacias de guardia...");

    const zonasAConsultar = [
        33, 24, 1, 22, 13, 8, 2, 3, 4, 5, 6, 7, 9, 10,  
        11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 23, 25,  
        26, 27, 28, 29, 30, 31, 32, 34, 35
    ]; 
    
    try {
        const fetchPromises = zonasAConsultar.map(z => 
            axios.get(`https://www.farmaciasdecanarias.com/FAR/scripts/getFarmacias.php?q=${z}`, { 
                headers: { 'User-Agent': 'Mozilla/5.0' },
                timeout: 8000 
            }).catch(e => null)
        );
        
        const responses = await Promise.all(fetchPromises);
        const uniqueGuardias = new Map();

        responses.forEach(resp => {
            if (!resp || !resp.data) return;
            const $ = cheerio.load(resp.data);
            $('tr').each((i, el) => {
                const cells = $(el).find('td');
                if (cells.length >= 2) {
                    const n = $(cells[0]).text().trim();
                    if (n && n.length > 5 && !n.includes('NOMBRE')) {
                        const nombreLimpio = n.replace(/\t|\n/g, ' ').replace(/\s+/g, ' ').trim();
                        const norm = normalizeName(nombreLimpio);
                        if (!uniqueGuardias.has(norm)) {
                            uniqueGuardias.set(norm, { 
                                nombre: nombreLimpio, 
                                direccion: $(cells[1]).text().trim().replace(/\s+/g, ' '),
                                telefono: $(cells[2])?.text()?.trim() || "---"
                            });
                        }
                    }
                }
            });
        });

        const updatedList = [];
        for (const [normName, info] of uniqueGuardias) {
            let lat, lng, municipio;

            const match = datos.find(d => {
                const dNorm = normalizeName(d.nombre);
                return dNorm === normName || dNorm.includes(normName) || normName.includes(dNorm);
            });
            
            if (match) {
                lat = match.lat;
                lng = match.lng;
                municipio = match.municipio;
            } else {
                // Fallback: Geocodificación (con delay para no saturar Nominatim)
                await new Promise(r => setTimeout(r, 1000)); // 1 req/sec limit
                const coords = await geocodeAddress(info.direccion);
                if (coords) {
                    lat = coords.lat;
                    lng = coords.lng;
                    municipio = "Localizada por GPS";
                }
            }

            if (lat && lng) {
                updatedList.push({ ...info, lat, lng, municipio: municipio || "Tenerife" });
            }
        }

        cacheGuardias = updatedList;
        lastUpdate = new Date().toISOString();
        console.log(`✅ Caché actualizado: ${cacheGuardias.length} farmacias de guardia.`);
    } catch (e) {
        console.error('❌ Error refrescando caché:', e);
    } finally {
        isRefreshing = false;
    }
}

// Refrescar cada 60 minutos
setInterval(updateGuardiasCache, 60 * 60 * 1000);

// --- ENDPOINT: GUARDIAS CERCANAS (Instantáneo) ---
app.get('/api/guardia/cerca', async (req, res) => {
    const userLat = parseFloat(req.query.lat);
    const userLng = parseFloat(req.query.lng);
    const radio = parseFloat(req.query.radio) || 15;

    if (isNaN(userLat) || isNaN(userLng)) {
        return res.status(400).json({ error: 'Faltan parámetros lat y lng válidos' });
    }

    if (cacheGuardias.length === 0 && isRefreshing) {
        return res.status(503).json({ error: 'Sincronizando datos, reintenta en unos segundos' });
    }

    const results = cacheGuardias
        .map(f => {
            const dist = calculateDistance(userLat, userLng, f.lat, f.lng);
            return { ...f, distanciaKm: Math.round(dist * 100) / 100 };
        })
        .filter(f => f.distanciaKm <= radio)
        .sort((a, b) => a.distanciaKm - b.distanciaKm);

    res.json({ 
        success: true, 
        filtros: { lat: userLat, lng: userLng, radioKm: radio },
        total: results.length, 
        lastUpdate,
        farmacias: results
    });
});

app.get('/api/guardia/hoy', async (req, res) => {
    // Mantener compatibilidad pero servir desde el cache global si es posible
    res.json({ success: true, total: cacheGuardias.length, farmacias: cacheGuardias });
});

app.get('/api/zonas', (req, res) => res.json({ success: true, total: zonas.length, zonas }));
app.get('/api/municipios', (req, res) => res.json({ success: true, municipios: [...new Set(datos.map(f => f.municipio).filter(Boolean))].sort() }));
app.get('/api/farmacias', (req, res) => res.json({ success: true, farmacias: datos }));

app.get('/api/farmacia-random', (req, res) => {
    if (datos.length === 0) return res.status(503).json({ error: 'Datos no listos' });
    const random = datos[Math.floor(Math.random() * datos.length)];
    res.json({ success: true, farmacia: random });
});

app.get('/api/farmacias/municipio/:m', (req, res) => {
    const m = req.params.m.toLowerCase();
    const f = datos.filter(x => x.municipio?.toLowerCase().includes(m));
    res.json({ success: true, farmacias: f });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

loadDatos();
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 API Pro en puerto ${PORT}`));
