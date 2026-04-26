const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const cheerio = require('cheerio'); // Movido arriba para mayor eficiencia
const zonas = require('./src/zonas');

const app = express();
const PORT = process.env.PORT || 3000;
let datos = [];
let isDownloading = false;

async function loadDatos() {
    if (isDownloading) return;
    isDownloading = true;
    try {
        console.log('⬇️ Descargando base de datos de farmacias...');
        const response = await axios.get('https://datos.tenerife.es/ckan/dataset/7d98949a-1e2f-4bdc-9280-83b81da0be35/resource/cc411345-4269-4e73-84d6-edb8a9598886/download/centros-medicos-farmacias-y-servicios-sanitarios-en-tenerife.geojson', { 
            timeout: 30000,
            headers: { 'Accept-Encoding': 'gzip' } 
        });
        if (response.data && response.data.features) {
            datos = response.data.features
                .filter(f => f.properties.actividad_tipo === 'farmacia')
                .map(f => ({
                    nombre: f.properties.nombre, 
                    direccion_nombre_via: f.properties.direccion_nombre_via, 
                    direccion_numero: f.properties.direccion_numero,
                    municipio_nombre: f.properties.municipio_nombre, 
                    telefono: f.properties.telefono,
                    latitud: f.properties.latitud, 
                    longitud: f.properties.longitud
                }));
            console.log(`✅ Base de datos lista: ${datos.length} farmacias.`);
        }
    } catch (e) { 
        console.error('⚠️ Error cargando GeoJSON:', e.message);
        setTimeout(loadDatos, 60000); 
    } finally {
        isDownloading = false;
    }
}

app.use(cors()); 
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.get('/api/status', (req, res) => {
    res.json({ status: 'ok', loading: isDownloading, farmacias: datos.length, zones: zonas.length });
});

app.get('/api/guardia/hoy', async (req, res) => {
    console.log('🔍 Iniciando scrape de guardias hoy...');
    try {
        const response = await axios.get('https://www.farmaciasdecanarias.com', { 
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }, 
            timeout: 8000 
        });
        
        const $ = cheerio.load(response.data); 
        const results = [];
        
        $('.pharma-item, .farmacia-item, .card, .resultado').each((i, el) => { 
            const n = $(el).find('.nombre, h3, .titulo, strong').first().text().trim(); 
            const d = $(el).find('.direccion, .direc, p').first().text().trim(); 
            if (n && n.length > 3) results.push({ nombre: n, direccion: d }); 
        });

        console.log(`✅ Scrape finalizado: ${results.length} encontradas.`);
        res.json({ success: true, total: results.length, farmacias: results });
    } catch (e) { 
        console.error('❌ Error en scrape:', e.message);
        res.status(500).json({ success: false, error: 'No se pudo obtener datos de la fuente externa', detail: e.message }); 
    }
});

app.get('/api/farmacia-random', (req, res) => {
    if (datos.length === 0) return res.status(503).json({ error: 'Cargando datos...' });
    const f = datos[Math.floor(Math.random() * datos.length)];
    res.json({ success: true, farmacia: f });
});

app.get('/api/zonas', (req, res) => res.json({ success: true, total: zonas.length, zonas }));
app.get('/api/farmacias', (req, res) => res.json({ success: true, total: datos.length, farmacias: datos }));

loadDatos();
app.listen(PORT, () => console.log(`🚀 Servidor en puerto ${PORT}`));
