const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const zonas = require('./src/zonas');

const app = express();
const PORT = process.env.PORT || 3000;

let datos = [];
let isDownloading = false;

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
                    lat: f.properties.latitud, 
                    lng: f.properties.longitud,
                    telefono: f.properties.telefono
                }));
            console.log(`✅ Base de datos cargada: ${datos.length} farmacias.`);
        }
    } catch (e) { console.error('Error GeoJSON:', e.message); }
    finally { isDownloading = false; }
}

app.use(cors()); app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- ENDPOINTS API ---

// 1. Status
app.get('/api/status', (req, res) => res.json({ status: 'ok', farmacias: datos.length, zonas: zonas.length }));

// 2. Guardias Hoy (Scraper)
app.get('/api/guardia/hoy', async (req, res) => {
    try {
        const cheerio = require('cheerio');
        const response = await axios.get('https://www.farmaciasdecanarias.com', { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 12000 });
        const $ = cheerio.load(response.data); const results = [];
        $('.pharma-item, .farmacia-item, .card, .resultado').each((i, el) => { 
            const n = $(el).find('h3, .nombre, .titulo').first().text().trim(); 
            const d = $(el).find('.direccion, .direc, p').first().text().trim(); 
            if (n) results.push({ nombre: n, direccion: d }); 
        });
        res.json({ success: true, total: results.length, farmacias: results });
    } catch (e) { res.status(500).json({ success: false, error: 'Error en el scraper' }); }
});

// 3. Guardias por Zona
app.get('/api/guardia/zona/:zona', (req, res) => {
    const zonaId = req.params.zona.toLowerCase();
    const zona = zonas.find(z => z.id.toLowerCase() === zonaId || z.nombre.toLowerCase().includes(zonaId));
    if (!zona) return res.status(404).json({ success: false, error: 'Zona no encontrada' });
    const f = datos.filter(x => { 
        const dir = (x.direccion || '').toLowerCase(); 
        const mun = (x.municipio || '').toLowerCase(); 
        return zona.barrios.some(b => dir.includes(b.toLowerCase()) || mun.includes(b.toLowerCase())); 
    });
    res.json({ success: true, zona: zona.nombre, total: f.length, farmacias: f });
});

// 4. Listado de Zonas
app.get('/api/zonas', (req, res) => res.json({ success: true, total: zonas.length, zonas }));

// 5. Listado de Municipios
app.get('/api/municipios', (req, res) => {
    const m = [...new Set(datos.map(f => f.municipio).filter(Boolean))].sort();
    res.json({ success: true, total: m.length, municipios: m });
});

// 6. Farmacias por Municipio
app.get('/api/farmacias/municipio/:m', (req, res) => {
    const m = req.params.m.toLowerCase();
    const f = datos.filter(x => x.municipio?.toLowerCase().includes(m));
    res.json({ success: true, total: f.length, farmacias: f });
});

// 7. Todas las Farmacias
app.get('/api/farmacias', (req, res) => res.json({ success: true, total: datos.length, farmacias: datos }));

// 8. Farmacia Aleatoria
app.get('/api/farmacia-random', (req, res) => {
    if (datos.length === 0) return res.status(503).json({ error: 'Sincronizando...' });
    const f = datos[Math.floor(Math.random() * datos.length)];
    res.json({ success: true, farmacia: f });
});

// --- RUTA WEB (AL FINAL) ---
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

loadDatos();
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 API activa en puerto ${PORT}`));
