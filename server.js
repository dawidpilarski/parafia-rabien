const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// --- Czytania scraper ---

let cache = { data: null, date: null };

async function fetchCzytania() {
  // Step 1: get redirect URL
  const redirectRes = await fetch('https://brewiarz.pl/dzis.php?link=c', { redirect: 'manual' });
  if(!redirectRes.ok){
    throw new Error(`Failed to fetch from brewiarz.pl. Status: ${redirectRes.status}`)
  }
  let location = redirectRes.headers.get('location');

  // If no redirect header, parse meta refresh from body
  if (!location) {
    const body = await redirectRes.text();
    const m = body.match(/URL=([^"]+)/i);
    if (m) location = m[1];
  }

  if (!location) throw new Error('Could not resolve brewiarz.pl redirect');

  const url = location.startsWith('http') ? location : `https://brewiarz.pl${location}`;

  // Step 2: fetch page with ISO-8859-2 decoding
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  const html = new TextDecoder('iso-8859-2').decode(buf);

  // Step 3: extract date and title
  const titleMatch = html.match(/font-size:\s*12pt;\s*font-weight:bold[^>]*>([^<]+)</);
  const title = titleMatch ? titleMatch[1].trim() : '';

  const dateMatch = html.match(/<title>[^-]*-\s*(\d+ \w+ \d{4})/i)
    || html.match(/<title>[^:]*:\s*([^<]+)/i);
  const date = dateMatch ? dateMatch[1].trim().replace(/:.*/,'') : '';

  // Step 4: extract readings
  const readings = [];

  function cleanHtml(text) {
    return text
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&laquo;/g, '«').replace(/&#171;/g, '«')
      .replace(/&raquo;/g, '»').replace(/&#187;/g, '»')
      .replace(/&nbsp;/g, ' ').replace(/&#150;/g, '–')
      .replace(/&amp;/g, '&').replace(/&malt;/g, '✝')
      .trim();
  }

  // Extract section HTML between div#divId and the next closing </div> at the same level
  function getSection(divId) {
    const start = html.indexOf(`id="${divId}"`);
    if (start === -1) return null;
    // Find the next div with a different id (next section) or end
    const nextDiv = html.indexOf('<div id="', start + 10);
    return html.substring(start, nextDiv > 0 ? nextDiv : start + 10000);
  }

  function extractReading(anchorName, divId, type) {
    if (html.indexOf(`name="${anchorName}"`) === -1) return null;
    const section = getSection(divId);
    if (!section) return null;

    // Label
    const labelMap = { czytanie1: 'PIERWSZE CZYTANIE', psalm: 'PSALM RESPONSORYJNY', czytanie2: 'DRUGIE CZYTANIE', ewangelia: 'EWANGELIA' };
    const label = labelMap[type] || type;

    // Subtitle (in font-size:8pt div after the label)
    const subtitleMatch = section.match(/font-size:8pt">\s*\n?\s*([^<]+)/);
    const subtitle = subtitleMatch ? subtitleMatch[1].trim() : '';

    // Reference
    let reference = '';
    if (type === 'psalm') {
      const refMatch = section.match(/color:red"><b>\s*([\s\S]*?)\s*<\/b>/);
      reference = refMatch ? cleanHtml(refMatch[1]) : '';
    } else if (type === 'ewangelia') {
      const refMatch = section.match(/color:red"><b>\s*([\s\S]*?)\s*<\/b>/);
      reference = refMatch ? cleanHtml(refMatch[1]) : '';
    } else {
      const refMatch = section.match(/color=red><div[^>]*><b>\s*([\s\S]*?)\s*<\/b>/);
      reference = refMatch ? cleanHtml(refMatch[1]) : '';
    }

    // Source
    const sourceMatch = section.match(/<b>([^<]*(?:Czytanie z|Słowa Ewangelii|Początek|Zakończenie)[^<]*)<\/b>/i)
      || section.match(/\u2720\s*<\/b><\/font>\s*([\s\S]*?)<\/b>/); // ✝ cross before source
    let source = '';
    if (sourceMatch) {
      source = cleanHtml(sourceMatch[1]);
      // The source might have the cross symbol prefix from ewangelia
      if (!source && sourceMatch[0]) source = cleanHtml(sourceMatch[0]);
    }
    // Try another pattern for ewangelia: "Słowa Ewangelii..."
    if (!source) {
      const srcMatch2 = section.match(/(Słowa Ewangelii[^<\n]+)/i)
        || section.match(/(Czytanie z [^<\n]+)/i);
      if (srcMatch2) source = cleanHtml(srcMatch2[1]);
    }

    // Refrain (psalm only)
    let refrain = '';
    if (type === 'psalm') {
      const refrainMatch = section.match(/Refren:<\/font>\s*([\s\S]*?)\s*<\//);
      refrain = refrainMatch ? cleanHtml(refrainMatch[1]) : '';
    }

    // Body text
    const bodyParts = [];

    if (type === 'psalm') {
      // Psalm verses are in table cells with padding-left:5px
      const verseRegex = /padding-left:5px[^>]*>([\s\S]*?)<\/td>/g;
      let m;
      while ((m = verseRegex.exec(section)) !== null) {
        const text = cleanHtml(m[1]).replace(/\s*\*\s*/g, ' ');
        if (text && !text.match(/^Refren:/)) bodyParts.push(text);
      }
    } else {
      // Regular readings use <div class=c>
      const cDivRegex = /<div class=c>([\s\S]*?)<\/div>/g;
      let m;
      while ((m = cDivRegex.exec(section)) !== null) {
        const text = cleanHtml(m[1]);
        if (text) bodyParts.push(text);
      }
    }

    const reading = { type, label, subtitle, reference, source, text: bodyParts.join('\n\n') };
    if (refrain) reading.refrain = refrain;
    return reading;
  }

  const r1 = extractReading('czyt1', 'defzz1', 'czytanie1');
  if (r1) readings.push(r1);

  const ps = extractReading('psalmresp', 'def3', 'psalm');
  if (ps) readings.push(ps);

  const r2 = extractReading('czyt2', 'defzx1', 'czytanie2');
  if (r2) readings.push(r2);

  const ew = extractReading('ewang', 'defzww1', 'ewangelia');
  if (ew) readings.push(ew);

  return { date, title, readings };
}

app.get('/api/ogloszenia', (_req, res) => {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'data', 'ogloszenia.json'), 'utf8');
    res.json(JSON.parse(raw));
  } catch (e) {
    res.status(500).json({ error: 'Nie udało się załadować ogłoszeń.' });
  }
});

app.get('/api/czytania', async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
    if (cache.data && cache.date === today) {
      return res.json(cache.data);
    }

    const data = await fetchCzytania();
    cache = { data, date: today };
    res.json(data);
  } catch (err) {
    console.error('Scraping error:', err);
    res.status(500).json({ error: 'Nie udało się pobrać czytań.' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
