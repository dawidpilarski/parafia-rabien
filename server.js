const express = require('express');
const path = require('path');
const fs = require('fs');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// --- Czytania scraper ---

let cache = { data: null, date: null };

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

  let currentUrl = location.startsWith('http') ? location : `https://brewiarz.pl${location}`;

  // Step 2: fetch page with ISO-8859-2 decoding
  async function fetchAndDecode(fetchUrl) {
    const r = await fetch(fetchUrl);
    const b = await r.arrayBuffer();
    return new TextDecoder('iso-8859-2').decode(b);
  }

  let html = await fetchAndDecode(currentUrl);

  // Handle selection page when multiple reading options exist
  if (html.includes('WYBIERZ OFICJUM')) {
    const $sel = cheerio.load(html);
    const firstLink = $sel('a[href*="index.php3?l="]').first().attr('href');
    if (!firstLink) throw new Error('No reading option found on selection page');
    currentUrl = new URL(firstLink, currentUrl).href;
    html = await fetchAndDecode(currentUrl);
  }

  // Handle JS redirect (var s = "czyt.php3"; location.href=...)
  const jsRedirect = html.match(/var s = "([^"]+)";\s*location\.href/);
  if (jsRedirect) {
    currentUrl = new URL(jsRedirect[1], currentUrl).href;
    html = await fetchAndDecode(currentUrl);
  }

  // Step 3: parse DOM
  const $ = cheerio.load(html);

  // Step 4: extract date and liturgical title
  // <title>.:ILG:. - 1 marca 2026: CZYTANIA LITURGICZNE</title>
  const titleTag = $('title').text();
  const date = titleTag.split(' - ')[1]?.split(':')[0]?.trim() ?? '';
  // feast name is in the bold 12pt div
  const title = $('[style*="font-size: 12pt"][style*="font-weight:bold"]').first().text().trim();

  // Step 5: extract readings
  const readings = [];

  const labelMap = {
    czytanie1: 'PIERWSZE CZYTANIE',
    psalm:     'PSALM RESPONSORYJNY',
    czytanie2: 'DRUGIE CZYTANIE',
    ewangelia: 'EWANGELIA',
  };

  function extractReading(anchorName, divId, type) {
    if ($(`a[name="${anchorName}"]`).length === 0) return null;

    const section = $(`#${divId}`);
    if (!section.length) return null;

    const label = labelMap[type] || type;

    // Subtitle: small text below the reading title (only for czytania, not psalm/ewangelia)
    const subtitle = (type === 'czytanie1' || type === 'czytanie2')
      ? section.find('[style*="font-size:8pt"]').first().text().trim()
      : '';

    // Reference: bold text in the right-hand header cell
    const reference = section.find('tr').first().find('td').last().find('b').first().text().trim();

    // Source: first <b> in .ww whose text contains a book reference phrase
    let source = '';
    section.find('.ww b').each((_, el) => {
      if (source) return;
      const text = $(el).text().trim();
      if (/Czytanie z|Słowa Ewangelii|Początek|Zakończenie/i.test(text)) {
        source = text.replace(/^[✠\s]+/, '').trim();
      }
    });

    let refrain = '';
    const bodyParts = [];

    if (type === 'psalm') {
      // Refrain: text of the <b> element that contains "Refren:"
      const refrainFont = section.find('font[color="red"]').filter((_, el) =>
        $(el).text().trim() === 'Refren:'
      ).first();
      refrain = refrainFont.parent().text().replace(/^Refren:\s*/i, '').trim();

      // Verses: each <td style="...padding-left:5px..."> is one verse line.
      // the other type of td is verse number in Bible
      // Stanzas are separated by a <br><br> at the end of the last line.
      const stanzas = [[]];
      section.find('td[style*="padding-left:5px"]').each((_, el) => {
        const raw = $(el).html() || '';
        const isStanzaEnd = (raw.match(/<br/gi) || []).length >= 2;
        const text = $(el).text().replace(/\*/g, '').trim();
        if (!text || /^Refren:/i.test(text)) {
          if (stanzas[stanzas.length - 1].length > 0) stanzas.push([]);
          return;
        }
        stanzas[stanzas.length - 1].push(text);
        if (isStanzaEnd) stanzas.push([]);
      });
      for (const stanza of stanzas) {
        if (stanza.length > 0) bodyParts.push(stanza.join('\n'));
      }
    } else {
      // Body paragraphs are in <div class="c"> elements
      section.find('div.c').each((_, el) => {
        const text = $(el).text().trim();
        if (text) bodyParts.push(text);
      });
    }

    const reading = { type, label, subtitle, reference, source, text: bodyParts.join('\n\n') };
    if (refrain) reading.refrain = refrain;
    return reading;
  }

  const r1 = extractReading('czyt1',     'defzz1',  'czytanie1');
  if (r1) readings.push(r1);

  const ps = extractReading('psalmresp', 'def3',    'psalm');
  if (ps) readings.push(ps);

  const r2 = extractReading('czyt2',     'defzx1',  'czytanie2');
  if (r2) readings.push(r2);

  const ew = extractReading('ewang',     'defzww1', 'ewangelia');
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
