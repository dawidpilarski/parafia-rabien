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

// --- Facebook feed ---

let fbCache = { data: null, timestamp: null };
const FB_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const FACEBOOK_PAGE_ID = process.env.FACEBOOK_PAGE_ID || '100086143224757';
const FACEBOOK_PAGE_TOKEN = process.env.FACEBOOK_PAGE_TOKEN;

async function notifyError(message){
  const url = "https://fanatic-muskrat.pikapod.net/webhook-test/801b977a-8085-407b-a063-30f45d6c8afc"
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain'
    },
    body: message
  })

  if (!response.ok){
    console.log(`Couldn't notify about an error, because request failed. status: ${response.status}, body: ${response.body}`)
  }
}

async function fetchCzytania() {
  try {
    const res = await fetch('https://opoka.org.pl/liturgia/');
    const html = await res.text();
    const $ = cheerio.load(html);

    // Extract date: "2 marca"
    const dayNum = $('.data-wrapper .data').text().trim();
    const month = $('.data-wrapper .miesiac').text().trim();
    const date = `${dayNum} ${month}`;

    // Liturgical period as title
    const title = $('.period_name').text().trim();

    // Reading number labels
    const ordinals = ['PIERWSZE', 'DRUGIE', 'TRZECIE', 'CZWARTE', 'PIĄTE', 'SZÓSTE', 'SIÓDME'];

    const readings = [];
    let czytCount = 0;

    $('.sekcja.dwa .subsec').each((_, el) => {
      const cls = $(el).attr('class') || '';

      // Skip werset (verse before gospel)
      if (cls.includes('werset')) return;

      const isPsalm = cls.includes('psalm');
      const isEwangelia = cls.includes('ewangelia');
      const isCzyt = /\bczyt\d+\b/.test(cls);

      if (!isPsalm && !isEwangelia && !isCzyt) return;

      const reference = $(el).find('.siglum').text().trim();

      // Skip entries without a reference (e.g. homily links)
      if (!reference) return;

      // Get the content div (the div that is not h2 and not .siglum)
      const contentDiv = $(el).find('div').not('.siglum').not('h2').last();
      const rawHtml = contentDiv.html() || '';

      // Split on double <br> to get paragraphs
      const paragraphs = rawHtml
        .split(/<\/br><\/br>|<br\s*\/?><br\s*\/?>|<\/br>\s*<\/br>/gi)
        .map(p => p.replace(/<[^>]+>/g, '').trim())
        .filter(Boolean);

      if (isPsalm) {
        // First paragraph has siglum details + refrain; extract just the refrain
        // Format: "Ps 95 (94), 1-2. 6-7c. 7d-9 (R.: por. 7d-8a)Słysząc głos..."
        let refrain = paragraphs[0] || '';
        const rIdx = refrain.indexOf('(R.:');
        if (rIdx !== -1) {
          const closeParen = refrain.indexOf(')', rIdx + 4);
          refrain = closeParen !== -1 ? refrain.slice(closeParen + 1).trim() : refrain.slice(rIdx + 4).trim();
        } else if (refrain.startsWith(reference)) {
          refrain = refrain.slice(reference.length).trim();
        }
        // Filter out refrain repetitions from body, keep stanzas
        const stanzas = paragraphs.slice(1).filter(p => p !== refrain);
        readings.push({
          type: 'psalm',
          label: 'PSALM RESPONSORYJNY',
          subtitle: '',
          reference,
          source: '',
          text: stanzas.join('\n\n'),
          refrain,
        });
      } else if (isEwangelia) {
        const source = paragraphs[0] || '';
        const text = paragraphs.slice(1).join('\n\n');
        readings.push({
          type: 'ewangelia',
          label: 'EWANGELIA',
          subtitle: '',
          reference,
          source,
          text,
        });
      } else {
        // czytanie
        czytCount++;
        const source = paragraphs[0] || '';
        const text = paragraphs.slice(1).join('\n\n');
        readings.push({
          type: `czytanie${czytCount}`,
          label: `${ordinals[czytCount - 1] || czytCount + '.'} CZYTANIE`,
          subtitle: '',
          reference,
          source,
          text,
        });
      }
    });

    return { date, title, readings };
  } catch (err) {
    console.error('fetchCzytania error:', err);
    throw err;
  }
}

async function fetchFacebookFeed() {
  const fields = 'message,story,full_picture,permalink_url,created_time';
  const url = `https://graph.facebook.com/v21.0/${FACEBOOK_PAGE_ID}/posts` +
    `?fields=${fields}&limit=10&access_token=${FACEBOOK_PAGE_TOKEN}`;

  const res = await fetch(url);
  const json = await res.json();

  if (json.error) throw new Error(`Facebook API: ${json.error.message}`);

  const posts = (json.data || [])
    .filter(p => p.message || p.story)
    .map(p => ({
      message: p.message || p.story || '',
      image: p.full_picture || null,
      url: p.permalink_url || null,
      date: p.created_time || null,
    }));

  return { posts };
}

app.get('/api/facebook-feed', async (_req, res) => {
  if (!FACEBOOK_PAGE_TOKEN) {
    return res.status(503).json({ error: 'Facebook feed nie jest skonfigurowany.' });
  }

  const now = Date.now();
  if (fbCache.data && fbCache.timestamp && (now - fbCache.timestamp < FB_CACHE_TTL_MS)) {
    return res.json(fbCache.data);
  }

  try {
    const data = await fetchFacebookFeed();
    fbCache = { data, timestamp: now };
    res.json(data);
  } catch (err) {
    console.error('Facebook feed error:', err);
    notifyError(`Nie udało się pobrać aktualności z Facebooka. ${err}`);
    res.status(500).json({ error: 'Nie udało się pobrać aktualności z Facebooka.' });
  }
});

app.get('/api/okresy-liturgiczne', (_req, res) => {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'data', 'okresy-liturgiczne.json'), 'utf8');
    res.json(JSON.parse(raw));
  } catch (e) {
    notifyError(`Nie udało się załadować okresów liturgicznych. ${e}`)
    res.status(500).json({ error: 'Nie udało się załadować okresów liturgicznych.' });
  }
});

app.get('/api/ogloszenia', (_req, res) => {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'data', 'ogloszenia.json'), 'utf8');
    res.json(JSON.parse(raw));
  } catch (e) {
    notifyError(`Nie udało się załadować ogłoszeń. ${e}`)
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
    if (!data.readings || data.readings.length === 0) {
      throw new Error('No readings parsed from source page');
    }
    cache = { data, date: today };
    res.json(data);
  } catch (err) {
    console.error('Scraping error: ', err);
    notifyError(`Nie udało się pobrać czytań. ${err}`)
    res.status(500).json({ error: 'Nie udało się pobrać czytań.' });
  }
});

module.exports = {
  notifyError,
  fetchCzytania,
  fetchFacebookFeed,
}

if (require.main == module){
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}
