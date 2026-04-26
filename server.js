const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const zonas = require('./src/zonas');

const app = express();
const PORT = process.env.PORT || 3000;

let datos = [];
let isDownloading = false;

// Mapa de IDs de zonas para el scraper externo
const ZONAS_IDS = {
    "santa-cruz": 23,
    "la-laguna": 24,
    "adeje-arona": 1,
    "puerto-cruz": 22
};

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
            console.log(`✅ Base de datos lista.`);
        }
    } catch (e) { console.error('Error GeoJSON:', e.message); }
    finally { isDownloading = false; }
}

app.use(cors()); app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/status', (req, res) => res.json({ status: 'ok', farmacias: datos.length, zonas: zonas.length }));

app.get('/api/guardia/hoy', async (req, res) => {
    // Usamos Santa Cruz (23) como zona por defecto si no se especifica
    const zonaId = req.query.z || 23; 
    const url = `https://www.farmaciasdecanarias.com/?i=40&z=${zonaId}#features`;
    
    try {
        const cheerio = require('cheerio');
        const response = await axios.get(url, { 
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Referer': 'https://www.farmaciasdecanarias.com/'
            }, 
            timeout: 15000 
        });
        
        const $ = cheerio.load(response.data); 
        const results = [];
        
        // La nueva estructura usa una tabla dentro de #txtHint o similar
        $('table tr').each((i, el) => {
            const cells = $(el).find('td');
            if (cells.length >= 2) {
                const n = $(cells[0]).text().trim();
                const d = $(cells[1]).text().trim();
                if (n && n.toLowerCase().includes('farmacia')) {
                    results.push({ nombre: n, direccion: d });
                }
            }
        });

        // Si la tabla falló, intentamos el selector antiguo por si acaso
        if (results.length === 0) {
            $('.pharma-item, .card, .resultado').each((i, el) => {
                const n = $(el).find('h3, .nombre').first().text().trim();
                const d = $(el).find('.direccion, p').first().text().trim();
                if (n) results.push({ nombre: n, direccion: d });
            });
        }

        res.json({ success: true, zonaId, total: results.length, farmacias: results });
    } catch (e) { 
        res.status(500).json({ success: false, error: 'Error en el scraper', detail: e.message }); 
    }
});

app.get('/api/zonas', (req, res) => res.json({ success: true, zonas }));

app.get('/api/municipios', (req, res) => {
    const m = [...new Set(datos.map(f => f.municipio).filter(Boolean))].sort();
    res.json({ success: true, total: m.length, municipios: m });
});

app.get('/api/farmacias', (req, res) => res.json({ success: true, total: datos.length, farmacias: datos }));

app.get('/api/farmacias/municipio/:m', (req, res) => {
    const m = req.params.m.toLowerCase();
    const f = datos.filter(x => x.municipio?.toLowerCase().includes(m));
    res.json({ success: true, total: f.length, farmacias: f });
});

app.get('/api/farmacia-random', (req, res) => {
    if (datos.length === 0) return res.status(503).json({ error: 'Sincronizando...' });
    const f = datos[Math.floor(Math.random() * datos.length)];
    res.json({ success: true, farmacia: f });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

loadDatos();
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Servidor en puerto ${PORT}`));
