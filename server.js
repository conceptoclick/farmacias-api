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
const farmaciasMaestras = require('./src/farmacias_maestras.json');

const app = express();
const PORT = process.env.PORT || 3000;

let datos = [...farmaciasMaestras]; // Iniciamos con nuestra base de datos maestra
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
        .replace(/^\d+h/i, '') // Quita "24h" al principio
        .replace(/lcda\.|lcdo\.|farmacia|titular|d\.|da\./gi, '')
        .replace(/[^a-z0-9]/gi, '')
        .trim();
}

async function loadDatos() {
    if (isDownloading) return;
    isDownloading = true;
    try {
        console.log("📂 Cargando base de datos maestra...");
        // Intentamos actualizar la base de datos desde el Cabildo para ver si hay cambios
        const response = await axios.get('https://datos.tenerife.es/ckan/dataset/7d98949a-1e2f-4bdc-9280-83b81da0be35/resource/cc411345-4269-4e73-84d6-edb8a9598886/download/centros-medicos-farmacias-y-servicios-sanitarios-en-tenerife.geojson', { timeout: 15000 });
        
        if (response.data && response.data.features) {
            const freshData = response.data.features
                .filter(f => f.properties && f.properties.actividad_tipo === 'farmacia')
                .map(f => ({
                    nombre: f.properties.nombre, 
                    direccion: (f.properties.direccion_nombre_via || '') + ' ' + (f.properties.direccion_numero || ''),
                    municipio: f.properties.municipio_nombre,
                    lat: parseFloat(f.properties.latitud), 
                    lng: parseFloat(f.properties.longitud),
                    telefono: f.properties.telefono
                }));
            
            // Mezclamos: datos nuevos del Cabildo + nuestra maestra (la maestra manda en caso de conflicto)
            const map = new Map();
            [...freshData, ...farmaciasMaestras].forEach(f => {
                map.set(normalizeName(f.nombre), f);
            });
            datos = Array.from(map.values());
            console.log(`✅ Base de datos unificada: ${datos.length} farmacias totales.`);
        }
    } catch (e) { 
        console.warn('⚠️ No se pudo bajar el GeoJSON fresco, usando solo la base maestra local.');
        datos = farmaciasMaestras;
    } finally {
        isDownloading = false;
        // Lanzamos el primer refresco de guardias
        updateGuardiasCache();
    }
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
    // Limpiamos la dirección para Nominatim (quitamos local 3, pta 2, etc si ensucian mucho)
    const cleanAddress = address.split(',')[0].trim();
    const fullAddress = `${cleanAddress}${municipio ? ', ' + municipio : ''}, Tenerife, Canarias, España`;
    
    if (geocodeCache.has(fullAddress)) return geocodeCache.get(fullAddress);
    
    try {
        const query = encodeURIComponent(fullAddress);
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${query}&limit=1`;
        const response = await axios.get(url, { 
            headers: { 'User-Agent': 'FarmaciasTenerifeAPI/1.3 (conceptoclick)' },
            timeout: 5000 
        });
        
        if (response.data && response.data.length > 0) {
            const coords = {
                lat: parseFloat(response.data[0].lat),
                lng: parseFloat(response.data[0].lon)
            };
            geocodeCache.set(fullAddress, coords);
            return coords;
        }
    } catch (e) {
        console.log(`⚠️ Error geocodificando "${fullAddress}": ${e.message}`);
    }
    return null;
}

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'es-ES,es;q=0.9',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache'
};

// Función modular para scrapear una lista específica de zonas
async function fetchGuardiasDeZonas(zoneIds) {
    const results = [];
    const seen = new Set();
    
    // Procesamos de 5 en 5 para no saturar y evitar bloqueos
    for (let i = 0; i < zoneIds.length; i += 5) {
        const chunk = zoneIds.slice(i, i + 5);
        const fetchPromises = chunk.map(z => 
            axios.get(`https://www.farmaciasdecanarias.com/FAR/scripts/getFarmacias.php?q=${z}`, { 
                headers: HEADERS,
                timeout: 12000 
            }).catch(err => {
                console.log(`⚠️ Error en zona ${z}: ${err.message}`);
                return null;
            })
        );
        
        const responses = await Promise.all(fetchPromises);

        responses.forEach((resp, index) => {
            if (!resp || !resp.data) return;
            const $ = cheerio.load(resp.data);
            const rows = $('tr');
            
            rows.each((j, el) => {
                const cells = $(el).find('td');
                if (cells.length >= 3) { // Más flexible: al menos nombre, dirección y tlf
                    const cell0 = $(cells[0]);
                    const n = cell0.text().trim();
                    
                    if (n && n.length > 3 && !n.includes('NOMBRE')) {
                        const nombreLimpio = n.replace(/\t|\n/g, ' ').replace(/\s+/g, ' ').trim();
                        const norm = normalizeName(nombreLimpio);
                        
                        // Si no hay columna 4, el horario es "Desconocido"
                        const horarioRaw = cells.length >= 4 ? $(cells[3]).text().trim() : "Consultar";
                        const is24h = horarioRaw.toLowerCase().includes('24 horas') || 
                                     n.toLowerCase().includes('24h') || 
                                     cell0.find('img[alt*="24h"]').length > 0;

                        if (!seen.has(norm)) {
                            seen.add(norm);
                            results.push({ 
                                nombre: nombreLimpio.replace(/^24h/i, '').trim(), 
                                direccion: $(cells[1]).text().trim().replace(/\s+/g, ' '),
                                telefono: $(cells[2])?.text()?.trim()?.replace(/\s+/g, '') || "",
                                horario: horarioRaw,
                                is24h,
                                norm
                            });
                        }
                    }
                }
            });
        });
        // Pequeña pausa entre bloques para ser "educados" con el servidor
        if (i + 5 < zoneIds.length) await new Promise(r => setTimeout(r, 500));
    }
    return results;
}

// Función para obtener zonas relevantes basadas en ubicación (North/South/Metro)
function getNearestZones(lat, lng) {
    // Si no hay coordenadas, devolvemos las zonas clave (Metro + Sur + Norte)
    if (!lat || !lng) return [33, 31, 32, 1, 11, 24];
    
    // Zonas del SUR (incluyendo 11: San Miguel-Granadilla)
    if (lat < 28.25) return [11, 31, 32, 23, 21, 25, 27, 28, 29, 30]; 
    
    // Zonas METRO (SC, Laguna...)
    if (lng > -16.35) return [33, 24, 1, 22, 13, 8]; 
    
    // Zonas NORTE
    return [2, 3, 4, 5, 6, 7, 9, 10, 12, 14, 15, 16, 17]; 
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
                // Si no está en la DB, intentamos geolocalizar
                const muniMatch = info.direccion.match(/\(([^)]+)\)/);
                const municipioExtraido = muniMatch ? muniMatch[1] : "";
                
                await new Promise(r => setTimeout(r, 1000));
                const coords = await geocodeAddress(info.direccion, municipioExtraido);
                if (coords) {
                    processedList.push({ 
                        ...info, 
                        lat: coords.lat, 
                        lng: coords.lng, 
                        municipio: municipioExtraido || "Tenerife"
                    });
                } else {
                    processedList.push({ ...info, lat: null, lng: null, municipio: municipioExtraido || "Tenerife" });
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

// Refrescar cada 60 minutos
setInterval(updateGuardiasCache, 60 * 60 * 1000);

// --- ENDPOINT: GUARDIAS CERCANAS (Optimizado con Fallback Live) ---
app.get('/api/guardia/cerca', async (req, res) => {
    const userLat = parseFloat(req.query.lat);
    const userLng = parseFloat(req.query.lng);
    const radio = parseFloat(req.query.radio) || 10;

    if (isNaN(userLat) || isNaN(userLng)) {
        return res.status(400).json({ error: 'Faltan parámetros lat y lng válidos' });
    }

    let searchData = cacheGuardias;
    // SI EL CACHÉ ESTÁ VACÍO (Cold Start), hacemos un scrape RÁPIDO solo de la zona del usuario
    if (searchData.length === 0) {
        console.log("⚡ Caché vacío, realizando búsqueda live rápida para el usuario...");
        const relevantZones = getNearestZones(userLat, userLng);
        const liveRaw = await fetchGuardiasDeZonas(relevantZones);
        
        // LIVE FALLBACK: Procesamos todo lo que diga el scraper sin tirar nada
        searchData = liveRaw.map(info => {
            const match = datos.find(d => {
                const dNorm = normalizeName(d.nombre);
                return dNorm === info.norm || dNorm.includes(info.norm) || info.norm.includes(dNorm);
            });
            
            if (match) {
                return { ...info, lat: match.lat, lng: match.lng, municipio: match.municipio };
            }
            
            // Si no está en la maestra, NO LA TIRAMOS. La devolvemos con lat null 
            // El frontend o el sistema de geocoding se encargará de posicionarla
            return { ...info, lat: null, lng: null, municipio: "Tenerife" };
        });

        // Lanzar el refresco profundo en background
        updateGuardiasCache();
    }

    const results = searchData
        .map(f => {
            if (!f.lat || !f.lng) return { ...f, distanciaKm: 0.1, note: "Ubicación aproximada" };
            const dist = calculateDistance(userLat, userLng, f.lat, f.lng);
            return { ...f, distanciaKm: Math.round(dist * 100) / 100 };
        })
        .filter(f => f.distanciaKm <= radio)
        .sort((a, b) => a.distanciaKm - b.distanciaKm);

    res.json({ 
        success: true, 
        isFallback: cacheGuardias.length === 0,
        total: results.length, 
        lastUpdate,
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

// MEJORA: Buscador Universal (Base Maestra + Guardias en Vivo)
app.get('/api/farmacias/municipio/:m', (req, res) => {
    const query = req.params.m.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    
    // Combinamos todos los datos conocidos (Maestra + lo que hay en Cache de Guardias)
    const allKnown = [...datos];
    
    // Añadimos las de guardia que no estén en la maestra
    cacheGuardias.forEach(g => {
        const exists = allKnown.some(d => normalizeName(d.nombre) === g.norm);
        if (!exists) allKnown.push(g);
    });

    const results = allKnown.filter(x => {
        const muni = (x.municipio || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const dir = (x.direccion || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const nom = (x.nombre || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        
        // Si busca "Granadilla", incluimos Médano y San Isidro por asociación lógica
        if (query === "granadilla") {
            if (dir.includes("medano") || dir.includes("isidro") || muni.includes("granadilla")) return true;
        }
        
        return muni.includes(query) || dir.includes(query) || nom.includes(query);
    }).map(f => {
        // Marcamos cuáles están de guardia para el frontend
        const esGuardia = cacheGuardias.some(g => g.norm === normalizeName(f.nombre));
        return { ...f, esGuardia };
    });

    // Ordenar: primero las de guardia, luego por nombre
    results.sort((a, b) => (b.esGuardia - a.esGuardia) || a.nombre.localeCompare(b.nombre));

    res.json({ 
        success: true, 
        total: results.length,
        query: req.params.m,
        farmacias: results 
    });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

loadDatos();
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 API Pro en puerto ${PORT}`));
