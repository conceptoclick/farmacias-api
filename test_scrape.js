const axios = require('axios');
const cheerio = require('cheerio');

async function testScrape() {
    try {
        console.log('Conectando a farmaciasdecanarias.com zona 31...');
        const response = await axios.get('https://www.farmaciasdecanarias.com/FAR/scripts/getFarmacias.php?q=31', { 
            timeout: 10000, 
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        
        const $ = cheerio.load(response.data);
        console.log('HTML Length:', response.data.length);
        console.log('\n=== FARMACIAS ZONA 31 (Granadilla de Abona) ===\n');
        
        let count = 0;
        $('tr').each((i, el) => {
            const cells = $(el).find('td');
            if (cells.length >= 2) {
                const nombre = $(cells[0]).text().trim();
                const direccion = $(cells[1]).text().trim();
                const tlf = $(cells[2])?.text()?.trim() || '---';
                const horario = $(cells[3])?.text()?.trim() || '---';
                
                if (nombre && nombre.indexOf('NOMBRE') === -1) {
                    count++;
                    console.log(`${count}. ${nombre}`);
                    console.log(`   Dirección: ${direccion}`);
                    console.log(`   Teléfono: ${tlf}`);
                    console.log(`   Horario: ${horario}`);
                    console.log('');
                }
            }
        });
        
        console.log(`Total farmacías encontradas: ${count}`);
    } catch (e) {
        console.error('Error:', e.message);
    }
}

testScrape();
