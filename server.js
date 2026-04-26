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
            console.log(`✅ Datos cargados: ${datos.length}`);
        }
    } catch (e) { console.error('Error GeoJSON:', e.message); }
    finally { isDownloading = false; }
}

app.use(cors()); app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API Endpoints
app.get('/api/status', (req, res) => res.json({ status: 'ok', farmacias: datos.length }));

app.get('/api/guardia/hoy', async (req, res) => {
    const zonaId = req.query.z || 23;
    const url = `https://www.farmaciasdecanarias.com/?i=40&z=${zonaId}#features`;
    try {
        const response = await axios.get(url, { 
            headers: { 'User-Agent': 'Mozilla/5.0' }, 
            timeout: 10000 
        });
        const $ = cheerio.load(response.data); 
        const results = [];
        $('table tr').each((i, el) => {
            const cells = $(el).find('td');
            if (cells.length >= 2) {
                const n = $(cells[0]).text().trim();
                const d = $(cells[1]).text().trim();
                if (n && n.toLowerCase().includes('farmacia')) results.push({ nombre: n, direccion: d });
            }
        });
        res.json({ success: true, farmacias: results });
    } catch (e) { res.status(500).json({ success: false, error: 'Error scraper', detail: e.message }); }
});

app.get('/api/zonas', (req, res) => res.json({ success: true, zonas }));
app.get('/api/municipios', (req, res) => {
    const m = [...new Set(datos.map(f => f.municipio).filter(Boolean))].sort();
    res.json({ success: true, municipios: m });
});
app.get('/api/farmacias', (req, res) => res.json({ success: true, farmacias: datos }));
app.get('/api/farmacias/municipio/:m', (req, res) => {
    const m = req.params.m.toLowerCase();
    const f = datos.filter(x => x.municipio?.toLowerCase().includes(m));
    res.json({ success: true, farmacias: f });
});
app.get('/api/farmacia-random', (req, res) => {
    if (datos.length === 0) return res.status(503).json({ error: 'Sincronizando...' });
    res.json({ success: true, farmacia: datos[Math.floor(Math.random() * datos.length)] });
});

// Servir la web (usando FS para evitar errores de sendFile)
app.get('*', (req, res) => {
    const indexPath = path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.status(404).send('No se encuentra index.html en la carpeta public');
    }
});

loadDatos();
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Puerto: ${PORT}`));
