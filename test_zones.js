const axios = require('axios');
const cheerio = require('cheerio');

async function testAllZones() {
    // Zonas del sur de Tenerife
    const zoneIds = [31, 32, 23, 27, 28, 29, 30];
    const zoneNames = {
        31: 'San Miguel y Granadilla',
        32: 'Arico y Fasnia',
        23: 'Güímar - Arafo',
        27: 'Adeje',
        28: 'Arona',
        29: 'Guía de Isora y Santiago del Teide',
        30: 'San Miguel y Granadilla (otra)'
    };
    
    console.log('=== PROBANDO ZONAS DEL SUR DE TENERIFE ===\n');
    
    for (const id of zoneIds) {
        try {
            const r = await axios.get(`https://www.farmaciasdecanarias.com/FAR/scripts/getFarmacias.php?q=${id}`, { 
                timeout: 10000, 
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });
            
            const $ = cheerio.load(r.data);
            let count = 0;
            const farmacias = [];
            
            $('tr').each((i, el) => {
                const cells = $(el).find('td');
                if (cells.length >= 4) {
                    const nombre = $(cells[0]).text().trim();
                    const direccion = $(cells[1]).text().trim();
                    const tlf = $(cells[2])?.text()?.trim() || '---';
                    const horario = $(cells[3])?.text()?.trim() || '---';
                    
                    if (nombre && nombre.indexOf('NOMBRE') === -1) {
                        count++;
                        farmacias.push({ nombre, direccion, tlf, horario });
                    }
                }
            });
            
            console.log(`Zona ${id} (${zoneNames[id] || 'Desconocida'}): ${count} farmacias`);
            if (count > 0) {
                farmacias.forEach((f, i) => {
                    console.log(`  ${i+1}. ${f.nombre} - ${f.direccion} [${f.horario}]`);
                });
            }
            console.log('');
            
            // Delay para evitar rate limiting
            await new Promise(resolve => setTimeout(resolve, 500));
            
        } catch(e) {
            console.log(`Zona ${id}: ERROR - ${e.message}\n`);
        }
    }
}

testAllZones();
