const axios = require('axios');
const cheerio = require('cheerio');

async function testScraper() {
    try {
        console.log("Testing Zone 11...");
        const resp = await axios.get('https://www.farmaciasdecanarias.com/FAR/scripts/getFarmacias.php?q=11', { 
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const $ = cheerio.load(resp.data);
        const rows = $('tr');
        console.log(`Found ${rows.length} rows.`);
        rows.each((i, el) => {
            const cells = $(el).find('td');
            console.log(`Row ${i}: ${cells.length} cells.`);
            if (cells.length >= 4) {
                console.log(`  Name: ${$(cells[0]).text().trim()}`);
                console.log(`  Schedule: ${$(cells[3]).text().trim()}`);
            }
        });
    } catch (e) {
        console.error(e);
    }
}

testScraper();
