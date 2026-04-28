const axios = require('axios');
const cheerio = require('cheerio');

async function testHomepage() {
    try {
        const r = await axios.get('https://www.farmaciasdecanarias.com/', { 
            timeout: 15000, 
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        
        const $ = cheerio.load(r.data);
        console.log('=== ENLACES DE ZONAS ENCONTRADOS ===\n');
        
        $('a').each((i, el) => {
            const href = $(el).attr('href');
            const text = $(el).text().trim();
            if(href && href.includes('q=')) {
                console.log(`Zona: ${text}`);
                console.log(`URL: ${href}`);
                console.log('---');
            }
        });
        
    } catch(e) {
        console.error('ERROR:', e.message);
    }
}

testHomepage();
