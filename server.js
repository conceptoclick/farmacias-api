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

// URLs de fuentes de guardias
const GUARDIA_URLS = {
    primaria: 'https://www.farmaciasdecanarias.com/FAR/scripts/getFarmacias.php',
    secundaria: 'https://farmaciatenerife.com/farmacias-de-guardia/'
};

// Funciones de utilidad para Geolocalización
function calculateDistance(lat1, lon1, lat2, lon2) {
    // Validar coordenadas para evitar NaN
    if (isNaN(lat1) || isNaN(lon1) || isNaN(lat2) || isNaN(lon2)) {
        return Infinity;
    }
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

async function geocodeAddress(address, municipio = "") {
    const fullAddress = `${address}${municipio ? ', ' + municipio : ''}, Tenerife, Canarias, España`;
    if (geocodeCache.has(fullAddress)) return geocodeCache.get(fullAddress);
    
    try {
        const query = encodeURIComponent(fullAddress);
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${query}&limit=1`;
        const response = await axios.get(url, { 
            headers: { 
                'User-Agent': 'Mozilla/5.0 (compatible; FarmaciasTenerifeBot/1.3; +https://github.com/farmacias-tenerife)',
                'Accept-Language': 'es-ES,es;q=0.9',
                'Accept': 'application/json'
            },
            timeout: 5000 
        });
        
        if (response.data && response.data.length > 0) {
            const lat = parseFloat(response.data[0].lat);
            const lon = parseFloat(response.data[0].lon);
            
            // Validar que las coordenadas sean números válidos
            if (isNaN(lat) || isNaN(lon)) {
                console.log(`⚠️ Coordenadas inválidas para "${fullAddress}"`);
                return null;
            }
            
            const coords = { lat, lng: lon };
            geocodeCache.set(fullAddress, coords);
            return coords;
        }
    } catch (e) {
        console.log(`⚠️ Error geocodificando "${fullAddress}": ${e.message}`);
    }
    return null;
}

// Función modular para scrapear una lista específica de zonas (con rate limiting mejorado)
async function fetchGuardiasDeZonas(zoneIds) {
    console.log(`🔍 Iniciando scraping de ${zoneIds.length} zonas...`);
    
    const results = [];
    const seen = new Set();
    let totalRows = 0;

    for (const z of zoneIds) {
        try {
            const response = await axios.get(`${GUARDIA_URLS.primaria}?q=${z}`, { 
                headers: { 
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml',
                    'Accept-Language': 'es-ES,es;q=0.9',
                    'Referer': 'https://www.farmaciasdecanarias.com/'
                },
                timeout: 15000 
            });
            
            console.log(`✅ Zona ${z}: ${response.status === 200 ? 'OK' : 'Error'}`);
            
            if (!response.data) continue;
            
            const $ = cheerio.load(response.data);
            const rows = $('table.tg tr');
            console.log(`📊 Zona ${z}: ${rows.length} filas encontradas`);
            
            rows.each((i, el) => {
                const cells = $(el).find('td');
                totalRows++;
                
                // Necesitamos al menos 4 celdas (nombre, dirección, teléfono, horario)
                if (cells.length >= 4) {
                    const nombreRaw = $(cells[0]).html()?.trim() || '';
                    const nombreSinImg = nombreRaw.replace(/<img[^>]*>/gi, '').trim();
                    
                    if (nombreSinImg && nombreSinImg.length > 5 && !nombreSinImg.includes('NOMBRE')) {
                        const nombreLimpio = nombreSinImg.replace(/\t|\n/g, ' ').replace(/\s+/g, ' ').trim();
                        const norm = normalizeName(nombreLimpio);
                        
                        // Extraer coordenadas del enlace de Google Maps si existen
                        let lat = null, lng = null;
                        const mapCell = $(cells[4]).find('a');
                        const mapLink = mapCell.attr('href') || '';
                        const coordsMatch = mapLink.match(/q=([\d.-]+),([\d.-]+)/);
                        if (coordsMatch) {
                            lat = parseFloat(coordsMatch[1]);
                            lng = parseFloat(coordsMatch[2]);
                        }
                        
                        const farmaciaKey = `${norm}-${$(cells[1]).text().trim()}`;
                        
                        if (!seen.has(farmaciaKey)) {
                            seen.add(farmaciaKey);
                            results.push({
                                nombre: nombreLimpio,
                                direccion: $(cells[1]).text().trim().replace(/\s+/g, ' '),
                                telefono: $(cells[2])?.text()?.trim() || "---",
                                horario: $(cells[3])?.text()?.trim() || "",
                                lat,
                                lng,
                                norm,
                                zonaId: z
                            });
                        }
                    }
                }
            });
            
            // Pequeño delay entre peticiones para evitar rate limiting
            await new Promise(resolve => setTimeout(resolve, 200));
            
        } catch (err) {
            console.log(`❌ Zona ${z}: ${err.message}`);
        }
    }
    
    console.log(`📋 Scraping completado: ${totalRows} filas procesadas, ${results.length} farmacias únicas encontradas`);
    return results;
}

// Función para obtener zonas relevantes basadas en ubicación (North/South/Metro)
function getNearestZones(lat, lng) {
    // Clasificación rápida por coordenadas aproximadas de Tenerife
    // Norte: > 28.3, Metro: > -16.35, Sur: < 28.2
    if (lat < 28.25) return [31, 32, 23, 21, 25, 27, 28, 29, 30]; // Sur (Arona, Adeje, San Miguel...)
    if (lng > -16.35) return [33, 24, 1, 22, 13, 8]; // Metro (SC, Laguna, Rosario...)
    return [2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16, 17]; // Norte
}

// Función para refrescar el caché de guardias (Background Task)
async function updateGuardiasCache() {
    if (isRefreshing) return;
    isRefreshing = true;
    console.log("🔄 Refrescando caché completo de la isla...");

    const todasLasZonas = [
        33, 24, 1, 22, 13, 8, 2, 3, 4, 5, 6, 7, 9, 10,  
        11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 23, 25,  
        26, 27, 28, 29, 30, 31, 32, 34, 35
    ]; 
    
    try {
        const rawGuardias = await fetchGuardiasDeZonas(todasLasZonas);
        const processedList = [];

        for (const info of rawGuardias) {
            const match = datos.find(d => {
                const dNorm = normalizeName(d.nombre);
                return dNorm === info.norm || dNorm.includes(info.norm) || info.norm.includes(dNorm);
            });
            
            if (match) {
                processedList.push({ ...info, lat: match.lat, lng: match.lng, municipio: match.municipio });
            } else {
                // Geocodificación inteligente en el refresco completo
                await new Promise(r => setTimeout(r, 1000)); // Respetar rate limits
                const coords = await geocodeAddress(info.direccion);
                if (coords) {
                    processedList.push({ ...info, lat: coords.lat, lng: coords.lng, municipio: "Localizada por GPS" });
                }
            }
        }

        cacheGuardias = processedList;
        lastUpdate = new Date().toISOString();
        console.log(`✅ Caché actualizado: ${cacheGuardias.length} farmacias.`);
    } catch (e) {
        console.error('❌ Error refrescando caché:', e);
    } finally {
        isRefreshing = false;
    }
}

// Refrescar cada 60 minutos (con delay inicial para evitar picos)
setTimeout(() => {
    setInterval(updateGuardiasCache, 60 * 60 * 1000);
}, Math.random() * 300000); // Delay aleatorio de 0-5 min al inicio

// --- ENDPOINT: GUARDIAS CERCANAS (Optimizado con Fallback Live) ---
app.get('/api/guardia/cerca', async (req, res) => {
    const userLat = parseFloat(req.query.lat);
    const userLng = parseFloat(req.query.lng);
    const radio = parseFloat(req.query.radio) || 15;

    // Validación estricta de coordenadas para Tenerife
    if (isNaN(userLat) || isNaN(userLng) || 
        userLat < 27.5 || userLat > 29 || 
        userLng < -17 || userLng > -15.5) {
        return res.status(400).json({ 
            error: 'Coordenadas inválidas. lat y lng deben estar en el rango de Tenerife (27.5-29, -17 a -15.5)' 
        });
    }

    let searchData = cacheGuardias;

    // SI EL CACHÉ ESTÁ VACÍO (Cold Start), hacemos un scrape RÁPIDO solo de la zona del usuario
    if (searchData.length === 0) {
        console.log("⚡ Caché vacío, realizando búsqueda live rápida para el usuario...");
        const relevantZones = getNearestZones(userLat, userLng);
        const liveRaw = await fetchGuardiasDeZonas(relevantZones);
        
        searchData = liveRaw.map(info => {
            const match = datos.find(d => {
                const dNorm = normalizeName(d.nombre);
                return dNorm === info.norm || dNorm.includes(info.norm) || info.norm.includes(dNorm);
            });
            if (match) return { ...info, lat: match.lat, lng: match.lng, municipio: match.municipio };
            return null;
        }).filter(Boolean);

        // Disparar el refresco completo de la isla en segundo plano (sin await)
        updateGuardiasCache();
    }

    const results = searchData
        .map(f => {
            const dist = calculateDistance(userLat, userLng, f.lat, f.lng);
            return { ...f, distanciaKm: Math.round(dist * 100) / 100 };
        })
        .filter(f => isFinite(f.distanciaKm) && f.distanciaKm <= radio)
        .sort((a, b) => a.distanciaKm - b.distanciaKm);

    res.json({ 
        success: true, 
        isFallback: cacheGuardias.length === 0,
        total: results.length, 
        lastUpdate,
        filtros: { lat: userLat, lng: userLng, radioKm: radio },
        farmacias: results
    });
});

app.get('/api/guardia/hoy', async (req, res) => {
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
