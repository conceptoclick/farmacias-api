const express = require('express');
const cors = require('cors');
const axios = require('axios');
const zonas = require('./src/zonas');

const app = express();
const PORT = process.env.PORT || 3000;
let datos = [];

async function loadDatos() {
    try {
        console.log('⬇️ Descargando datos de datos.tenerife.es...');
        const response = await axios.get('https://datos.tenerife.es/ckan/dataset/7d98949a-1e2f-4bdc-9280-83b81da0be35/resource/6f60e50a-8ef7-4f12-80b1-1e8c0aa2a1c6/download/centros-medicos-farmacias-y-servicios-sanitarios-en-tenerife.json', { timeout: 30000 });
        if (response.data) {
            datos = response.data.filter(f => f.actividad_tipo === 'FARMACIA');
            console.log('✅ Datos: ' + datos.length + ' farmacias');
        }
    } catch (e) { console.log('⚠️ Error:', e.message); datos = []; }
}

app.use(cors());
app.use(express.json());

app.get('/api/zonas', (req, res) => res.json({ success: true, total: zonas.length, zonas }));
app.get('/api/zonas/:id', (req, res) => { const z = zonas.find(z => z.id === req.params.id); if (!z) return res.status(404).json({ error: 'Zona no encontrada' }); res.json({ success: true, zona: z }); });
app.get('/api/guardia/hoy', async (req, res) => {
    const cheerio = require('cheerio');
    try {
        const response = await axios.get('https://www.farmaciasdecanarias.com', { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 });
        const $ = cheerio.load(response.data);
        const results = [];
        $('.pharma-item, .farmacia-item, .resultado, .card').each((i, el) => {
            const n = $(el).find('.nombre, h3, .titulo').first().text().trim();
            const d = $(el).find('.direccion, .direc').text().trim();
            if (n) results.push({ nombre: n, direccion: d });
        });
        res.json({ success: true, fecha: new Date().toISOString().split('T')[0], fuente: 'farmaciasdecanarias.com', total: results.length, farmacias: results });
    } catch (e) { res.json({ success: false, error: e.message }); }
});
app.get('/api/guardia/zona/:zona', (req, res) => {
    const zonaId = req.params.zona.toLowerCase();
    const zona = zonas.find(z => z.id.toLowerCase() === zonaId || z.nombre.toLowerCase().includes(zonaId));
    if (!zona) return res.status(404).json({ success: false, error: 'Zona no encontrada', zonasDisponibles: zonas.map(z => z.id) });
    const f = datos.filter(x => { const dir = (x.direccion_nombre_via || '').toLowerCase(); const bar = (x.municipio_nombre || '').toLowerCase(); return zona.barrios.some(b => dir.includes(b.toLowerCase()) || bar.includes(b.toLowerCase())); });
    res.json({ success: true, zona: zona.nombre, zonaId: zona.id, fecha: new Date().toISOString().split('T')[0], total: f.length, farmacias: f.map(x => ({ nombre: x.nombre, direccion: x.direccion_nombre_via + ' ' + x.direccion_numero, telefono: x.telefono, municipio: x.municipio_nombre, coordenadas: { lat: x.latitud, lng: x.longitud } })) });
});
app.get('/api/farmacias', (req, res) => res.json({ success: true, total: datos.length, farmacias: datos }));
app.get('/api/farmacias/:codigo', (req, res) => { const f = datos.find(x => x.identificador === req.params.codigo); if (!f) return res.status(404).json({ error: 'No encontrada' }); res.json(f); });
app.get('/api/municipios', (req, res) => { const m = [...new Set(datos.map(f => f.municipio_nombre).filter(Boolean))]; res.json({ success: true, total: m.length, municipios: m }); });
app.get('/api/farmacias/municipio/:m', (req, res) => { const m = req.params.m.toLowerCase(); const f = datos.filter(x => x.municipio_nombre?.toLowerCase().includes(m)); res.json({ success: true, total: f.length, farmacias: f }); });
app.get('/api/status', (req, res) => res.json({ status: 'ok', farmacias: datos.length, zonas: zonas.length, timestamp: new Date().toISOString() }));

loadDatos().then(() => app.listen(PORT, () => console.log('🧪 API Farmacias Guardia Tenerife - http://localhost:' + PORT)));