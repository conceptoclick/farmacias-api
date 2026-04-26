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
        }
    } catch (e) { console.error('Error GeoJSON:', e.message); }
    finally { isDownloading = false; }
}

app.use(cors()); app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/status', (req, res) => res.json({ status: 'ok', farmacias: datos.length }));

// --- NUEVO ENDPOINT: GUARDIAS CERCANAS ---
app.get('/api/guardia/cerca', async (req, res) => {
    const userLat = parseFloat(req.query.lat);
    const userLng = parseFloat(req.query.lng);
    const radio = parseFloat(req.query.radio) || 15; // 15km por defecto

    if (!userLat || !userLng) return res.status(400).json({ error: 'Faltan parámetros lat y lng' });

    // Zonas clave para cobertura total de Tenerife
    const zonasAConsultar = [33, 24, 1, 22, 13, 8]; 
    
    try {
        const fetchPromises = zonasAConsultar.map(z => 
            axios.get(`https://www.farmaciasdecanarias.com/FAR/scripts/getFarmacias.php?q=${z}`, { timeout: 10000 }).catch(e => null)
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
                        const info = { 
                            nombre: n.replace(/\t|\n/g, ' ').trim(), 
                            direccion: $(cells[1]).text().trim(),
                            telefono: $(cells[2]).text().trim()
                        };
                        uniqueGuardias.set(normalizeName(n), info);
                    }
                }
            });
        });

        // Cruce de datos con coordenadas
        const results = [];
        uniqueGuardias.forEach((info, normName) => {
            // Buscamos coincidencia en nuestra base de datos local
            const match = datos.find(d => {
                const dNorm = normalizeName(d.nombre);
                return dNorm.includes(normName) || normName.includes(dNorm);
            });
            
            if (match) {
                const dist = calculateDistance(userLat, userLng, match.lat, match.lng);
                if (dist <= radio) {
                    results.push({ 
                        ...info, 
                        lat: match.lat, 
                        lng: match.lng, 
                        distanciaKm: Math.round(dist * 100) / 100,
                        municipio: match.municipio
                    });
                }
            }
        });

        res.json({ 
            success: true, 
            filtros: { lat: userLat, lng: userLng, radioKm: radio },
            total: results.length, 
            farmacias: results.sort((a, b) => a.distanciaKm - b.distanciaKm) 
        });
    } catch (e) {
        res.status(500).json({ error: 'Error en búsqueda geoespacial', detail: e.message });
    }
});

// Mantener el resto de endpoints...
app.get('/api/guardia/hoy', async (req, res) => {
    const zonaId = req.query.z || 33;
    const url = `https://www.farmaciasdecanarias.com/FAR/scripts/getFarmacias.php?q=${zonaId}`;
    try {
        const response = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 });
        const $ = cheerio.load(response.data); 
        const results = [];
        $('tr').each((i, el) => {
            const cells = $(el).find('td');
            if (cells.length >= 2) {
                const n = $(cells[0]).text().trim();
                const d = $(cells[1]).text().trim();
                if (n && n.length > 5 && !n.includes('NOMBRE')) {
                    results.push({ nombre: n, direccion: d });
                }
            }
        });
        res.json({ success: true, zonaId, total: results.length, farmacias: results });
    } catch (e) { res.status(500).json({ success: false, error: 'Error scraper' }); }
});

app.get('/api/zonas', (req, res) => res.json({ success: true, total: zonas.length, zonas }));
app.get('/api/municipios', (req, res) => res.json({ success: true, municipios: [...new Set(datos.map(f => f.municipio).filter(Boolean))].sort() }));
app.get('/api/farmacias', (req, res) => res.json({ success: true, farmacias: datos }));
app.get('/api/farmacias/municipio/:m', (req, res) => {
    const m = req.params.m.toLowerCase();
    const f = datos.filter(x => x.municipio?.toLowerCase().includes(m));
    res.json({ success: true, farmacias: f });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

loadDatos();
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 API Pro en puerto ${PORT}`));
