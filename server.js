const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// --- Czytania scraper ---

let cache = { data: null, timestamp: 0 };
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

async function fetchCzytania() {
  // Step 1: get redirect URL
  const redirectRes = await fetch('https://brewiarz.pl/dzis.php?link=c', { redirect: 'manual' });
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

  // Helper to extract a reading section
  function extractReading(anchorName, divId, type) {
    const anchorIdx = html.indexOf(`name="${anchorName}"`);
    if (anchorIdx === -1) return null;

    // Find the containing div
    const divPattern = new RegExp(`<div id="${divId}"[\\s\\S]*?</div>\\s*</td>\\s*</tr>\\s*</table>\\s*<br>\\s*</div>`);
    const divMatch = html.match(divPattern);
    if (!divMatch) return null;
    const section = divMatch[0];

    // Label (e.g. "PIERWSZE CZYTANIE")
    const labelMatch = section.match(/<b>([A-ZĘÓĄŚŁŻŹĆŃ\s]+(?:CZYTANIE|EWANGELIA|PSALM RESPONSORYJNY))/);
    const label = labelMatch ? labelMatch[1].trim() : type;

    // Subtitle
    const subtitleMatch = section.match(/font-size:8pt">\s*\n?\s*([^<]+)/);
    const subtitle = subtitleMatch ? subtitleMatch[1].trim() : '';

    // Reference (red bold text in right column)
    let reference = '';
    if (type === 'psalm') {
      const refMatch = section.match(/color:red"><b>\s*\n?\s*([\s\S]*?)\s*<\/b>/);
      reference = refMatch ? refMatch[1].replace(/<[^>]+>/g,'').trim() : '';
    } else {
      const refMatch = section.match(/color=red><div[^>]*><b>\s*\n?\s*([\s\S]*?)\s*<\/b>/)
        || section.match(/color:red"><b>\s*\n?\s*([\s\S]*?)\s*<\/b>/);
      reference = refMatch ? refMatch[1].replace(/<[^>]+>/g,'').trim() : '';
    }

    // Source (bold text like "Czytanie z Księgi...")
    const sourceMatch = section.match(/<b>(Czytanie z [^<]+|S[łl]owa Ewangelii [^<]+)<\/b>/i);
    const source = sourceMatch ? sourceMatch[1].trim() : '';

    // Refrain (psalm only)
    let refrain = '';
    if (type === 'psalm') {
      const refrainMatch = section.match(/Refren:<\/font>\s*([\s\S]*?)\s*<\//);
      refrain = refrainMatch ? refrainMatch[1].replace(/<[^>]+>/g,'').trim() : '';
    }

    // Body text from <div class=c> elements
    const bodyParts = [];
    const cDivRegex = /<div class=c>([\s\S]*?)<\/div>/g;
    let m;
    while ((m = cDivRegex.exec(section)) !== null) {
      let text = m[1]
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&laquo;/g, '«')
        .replace(/&raquo;/g, '»')
        .replace(/&#171;/g, '«')
        .replace(/&#187;/g, '»')
        .replace(/&nbsp;/g, ' ')
        .replace(/&#150;/g, '–')
        .replace(/&amp;/g, '&')
        .trim();
      if (text) bodyParts.push(text);
    }

    // For psalm, also get text from ww divs if no c divs found
    if (bodyParts.length === 0) {
      const wwRegex = /<div class=ww[^>]*>([\s\S]*?)<\/div>/g;
      while ((m = wwRegex.exec(section)) !== null) {
        let text = m[1]
          .replace(/<div[^>]*>.*?<\/div>/gi, '') // remove nested divs (premium links)
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<[^>]+>/g, '')
          .replace(/&#171;/g, '«')
          .replace(/&#187;/g, '»')
          .replace(/&nbsp;/g, ' ')
          .replace(/&#150;/g, '–')
          .replace(/&amp;/g, '&')
          .trim();
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

app.get('/api/czytania', async (req, res) => {
  try {
    const now = Date.now();
    if (cache.data && (now - cache.timestamp) < CACHE_TTL) {
      return res.json(cache.data);
    }

    const data = await fetchCzytania();
    cache = { data, timestamp: now };
    res.json(data);
  } catch (err) {
    console.error('Scraping error:', err);
    res.status(500).json({ error: 'Nie udało się pobrać czytań.' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
