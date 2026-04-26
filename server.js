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
        }
    } catch (e) { console.error('Error GeoJSON:', e.message); }
    finally { isDownloading = false; }
}

app.use(cors()); app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/status', (req, res) => res.json({ status: 'ok', farmacias: datos.length }));

app.get('/api/guardia/hoy', async (req, res) => {
    const zonaId = req.query.z || 23; // 23 = Santa Cruz, 24 = La Laguna
    // DIRECCIÓN SECRETA DE DATOS (AJAX)
    const url = `https://www.farmaciasdecanarias.com/get_farmacias.php?i=40&z=${zonaId}`;
    
    try {
        const response = await axios.get(url, { 
            headers: { 
                'User-Agent': 'Mozilla/5.0',
                'Referer': 'https://www.farmaciasdecanarias.com/'
            }, 
            timeout: 10000 
        });
        
        const $ = cheerio.load(response.data); 
        const results = [];
        
        // La respuesta es un fragmento de HTML con una tabla
        $('tr').each((i, el) => {
            const cells = $(el).find('td');
            if (cells.length >= 2) {
                const n = $(cells[0]).text().trim();
                const d = $(cells[1]).text().trim();
                const t = $(cells[2]).text().trim();
                // Limpiamos el nombre de posibles ruidos
                if (n && n.length > 5 && !n.includes('NOMBRE')) {
                    results.push({ 
                        nombre: n.replace(/\t|\n/g, ' '), 
                        direccion: d.replace(/\t|\n/g, ' '),
                        telefono: t
                    });
                }
            }
        });

        res.json({ success: true, zonaId, total: results.length, farmacias: results });
    } catch (e) { 
        res.status(500).json({ success: false, error: 'Error en el motor de búsqueda', detail: e.message }); 
    }
});

app.get('/api/zonas', (req, res) => res.json({ success: true, zonas }));
app.get('/api/municipios', (req, res) => res.json({ success: true, municipios: [...new Set(datos.map(f => f.municipio).filter(Boolean))].sort() }));
app.get('/api/farmacias', (req, res) => res.json({ success: true, farmacias: datos }));

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

loadDatos();
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Puerto: ${PORT}`));
