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

app.get('/api/status', (req, res) => res.json({ status: 'ok', farmacias: datos.length }));

app.get('/api/guardia/hoy', async (req, res) => {
    const zonaId = req.query.z || 23;
    const url = `https://www.farmaciasdecanarias.com/?i=40&z=${zonaId}#features`;
    try {
        const response = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 });
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
app.get('/api/municipios', (req, res) => res.json({ success: true, municipios: [...new Set(datos.map(f => f.municipio).filter(Boolean))].sort() }));
app.get('/api/farmacias', (req, res) => res.json({ success: true, farmacias: datos }));

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

loadDatos();
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Puerto: ${PORT}`));
