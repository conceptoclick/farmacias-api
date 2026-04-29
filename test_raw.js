const axios = require('axios');
const cheerio = require('cheerio');

async function testZona31() {
    try {
        console.log('Test zona 31 (Granadilla de Abona)...');
        const r = await axios.get('https://www.farmaciasdecanarias.com/FAR/scripts/getFarmacias.php?q=31', { 
            timeout: 20000, 
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        
        console.log('Status:', r.status);
        console.log('Length:', r.data.length);
        console.log('\nContenido completo:\n');
        console.log(r.data);
        
    } catch(e) {
        console.error('ERROR:', e.code, e.message);
        if(e.response) console.log('Response status:', e.response.status);
    }
}

testZona31();
