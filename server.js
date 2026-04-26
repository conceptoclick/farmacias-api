const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const zonas = require('./src/zonas');

const app = express();
// Render suele usar el puerto que viene en la variable PORT
const PORT = process.env.PORT || 3000;

let datos = [];
let isDownloading = false;

// Función de carga ultra-optimizada
async function loadDatos() {
    if (isDownloading) return;
    isDownloading = true;
    console.log('--- SISTEMA INICIANDO ---');
    try {
        const response = await axios.get('https://datos.tenerife.es/ckan/dataset/7d98949a-1e2f-4bdc-9280-83b81da0be35/resource/cc411345-4269-4e73-84d6-edb8a9598886/download/centros-medicos-farmacias-y-servicios-sanitarios-en-tenerife.geojson', { 
            timeout: 30000,
            headers: { 'Accept-Encoding': 'gzip' } 
        });
        
        if (response.data && response.data.features) {
            // Liberamos memoria filtrando solo lo esencial inmediatamente
            datos = response.data.features
                .filter(f => f.properties && f.properties.actividad_tipo === 'farmacia')
                .map(f => ({
                    nombre: f.properties.nombre, 
                    direccion: (f.properties.direccion_nombre_via || '') + ' ' + (f.properties.direccion_numero || ''),
                    municipio: f.properties.municipio_nombre,
                    lat: f.properties.latitud, 
                    lng: f.properties.longitud
                }));
            console.log(`✅ ${datos.length} farmacias en memoria.`);
        }
    } catch (e) { 
        console.error('⚠️ Error cargando datos:', e.message);
    } finally {
        isDownloading = false;
    }
}

app.use(cors()); 
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/status', (req, res) => {
    const mem = process.memoryUsage();
    res.json({ 
        status: 'ok', 
        farmacias: datos.length, 
        memoria: `${Math.round(mem.rss / 1024 / 1024)}MB`,
        timestamp: new Date().toISOString() 
    });
});

app.get('/api/guardia/hoy', async (req, res) => {
    try {
        // Carga diferida de cheerio para no saturar el arranque
        const cheerio = require('cheerio');
        const response = await axios.get('https://www.farmaciasdecanarias.com', { 
            headers: { 'User-Agent': 'Mozilla/5.0' }, 
            timeout: 10000 
        });
        const $ = cheerio.load(response.data); 
        const results = [];
        $('.pharma-item, .farmacia-item, .card, .resultado').each((i, el) => { 
            const n = $(el).find('.nombre, h3, .titulo').first().text().trim(); 
            const d = $(el).find('.direccion, .direc').first().text().trim(); 
            if (n) results.push({ nombre: n, direccion: d }); 
        });
        res.json({ success: true, farmacias: results });
    } catch (e) { 
        res.status(500).json({ success: false, error: 'Error en el scraper' }); 
    }
});

app.get('/api/zonas', (req, res) => res.json({ success: true, zonas }));

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Iniciamos carga en segundo plano
loadDatos();

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor escuchando en puerto ${PORT}`);
});
