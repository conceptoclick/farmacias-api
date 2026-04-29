const fs = require('fs');
const data = JSON.parse(fs.readFileSync('src/full_data.json', 'utf8'));

const cleaned = data.features
    .filter(f => f.properties && f.properties.actividad_tipo === 'farmacia')
    .map(f => ({
        nombre: f.properties.nombre,
        direccion: (f.properties.direccion_nombre_via || '') + ' ' + (f.properties.direccion_numero || ''),
        municipio: f.properties.municipio_nombre,
        lat: parseFloat(f.properties.latitud),
        lng: parseFloat(f.properties.longitud),
        telefono: f.properties.telefono
    }));

fs.writeFileSync('src/farmacias_maestras.json', JSON.stringify(cleaned, null, 2));
console.log(`✅ Creado farmacias_maestras.json con ${cleaned.length} entradas.`);
