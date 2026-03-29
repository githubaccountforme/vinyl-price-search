// ============================================================
//  Vinyl Price Search — Backend Server
//  Searches Google Shopping (via SerpAPI) + Discogs marketplace
// ============================================================

require('dotenv').config();
const express = require('express');
const axios   = require('axios');

const app = express();
app.use(express.static('public'));
app.use(express.json());

// ── Affiliate IDs ────────────────────────────────────────────
// Fill these in once you've signed up for each affiliate program.
// You can also set them as environment variables.
const AFFILIATE = {
  amazon:  process.env.AMAZON_AFFILIATE_ID  || '',   // e.g. "yoursite-20"
  ebay:    process.env.EBAY_AFFILIATE_ID    || '',   // eBay Partner Network publisher ID
  discogs: process.env.DISCOGS_AFFILIATE_ID || '',   // Discogs affiliate ref
};

// ── Helpers ──────────────────────────────────────────────────

function parsePrice(str) {
  if (!str) return null;
  const m = String(str).replace(/,/g, '').match(/[\d]+\.?\d*/);
  return m ? parseFloat(m[0]) : null;
}

function retailerFromUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const map = {
      'amazon.com':      'Amazon',
      'ebay.com':        'eBay',
      'target.com':      'Target',
      'walmart.com':     'Walmart',
      'bestbuy.com':     'Best Buy',
      'discogs.com':     'Discogs',
      'shop.com':        'Shop.com',
      'recordstore.co.uk': 'Record Store UK',
    };
    for (const [k, v] of Object.entries(map)) {
      if (host.includes(k)) return v;
    }
    return host;
  } catch {
    return 'Online Store';
  }
}

function addAffiliateParam(url, retailer) {
  try {
    if (retailer === 'Amazon' && AFFILIATE.amazon) {
      const u = new URL(url);
      u.searchParams.set('tag', AFFILIATE.amazon);
      return u.toString();
    }
    if (retailer === 'eBay' && AFFILIATE.ebay) {
      return `https://rover.ebay.com/rover/1/711-53200-19255-0/1?pub=${AFFILIATE.ebay}&campid=5338273189&toolid=10001&mpre=${encodeURIComponent(url)}`;
    }
    return url;
  } catch {
    return url;
  }
}

// ── SerpAPI — Google Shopping ─────────────────────────────────

async function searchGoogleShopping(query) {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) {
    console.warn('SERPAPI_KEY not set — skipping Google Shopping results');
    return [];
  }

  const res = await axios.get('https://serpapi.com/search', {
    params: {
      engine:  'google_shopping',
      q:       `${query} vinyl record LP`,
      api_key: apiKey,
      num:     20,
    },
    timeout: 15000,
  });

  const items = res.data.shopping_results || [];
  return items.map(item => {
    // SerpAPI returns a `source` field (retailer name) directly — use it
    const retailer = item.source || retailerFromUrl(item.link || '');

    // Validate the link is a real absolute URL; fall back to a Google Shopping search
    let rawLink = item.link || '';
    if (!rawLink.startsWith('http')) {
      rawLink = `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(item.title || query)}`;
    }
    const url = addAffiliateParam(rawLink, retailer);

    return {
      source:    retailer,
      title:     item.title,
      price:     item.price,
      priceRaw:  parsePrice(item.price),
      image:     item.thumbnail || null,
      url,
      condition: item.second_hand_condition || 'New',
      rating:    item.rating    || null,
      reviews:   item.reviews   || null,
      badge:     null,
    };
  });
}

// ── Discogs API ───────────────────────────────────────────────

async function searchDiscogs(query) {
  const token = process.env.DISCOGS_TOKEN;   // optional but raises rate limits
  const headers = { 'User-Agent': 'VinylPriceSearch/1.0' };

  // Step 1: full-text search for vinyl releases
  const searchRes = await axios.get('https://api.discogs.com/database/search', {
    params: {
      q:        query,
      type:     'release',
      format:   'vinyl',
      per_page: 8,
      ...(token ? { token } : {}),
    },
    headers,
    timeout: 10000,
  });

  const releases = searchRes.data.results || [];

  // Step 2: fetch marketplace stats for the first 5 results (parallel)
  const enriched = await Promise.allSettled(
    releases.slice(0, 5).map(async release => {
      const statsRes = await axios.get(
        `https://api.discogs.com/marketplace/stats/${release.id}`,
        { headers, params: token ? { token } : {}, timeout: 8000 }
      );
      const stats   = statsRes.data;
      const lowest  = stats.lowest_price;

      let discogsUrl = `https://www.discogs.com/sell/release/${release.id}`;
      if (AFFILIATE.discogs) discogsUrl += `?ev=rb&ref=${AFFILIATE.discogs}`;

      return {
        source:     'Discogs',
        title:      release.title,
        price:      lowest ? `$${lowest.value.toFixed(2)}` : 'Check Discogs',
        priceRaw:   lowest ? lowest.value : null,
        image:      release.thumb || null,
        url:        discogsUrl,
        condition:  'Used (varies)',
        numForSale: stats.num_for_sale || 0,
        year:       release.year  || null,
        label:      (release.label || [])[0] || null,
        badge:      null,
      };
    })
  );

  return enriched
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value);
}

// ── Route ─────────────────────────────────────────────────────

app.get('/api/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Please provide a search query.' });

  try {
    const [shopping, discogs] = await Promise.allSettled([
      searchGoogleShopping(q),
      searchDiscogs(q),
    ]);

    const shoppingResults = shopping.status  === 'fulfilled' ? shopping.value  : [];
    const discogsResults  = discogs.status   === 'fulfilled' ? discogs.value   : [];

    const all = [...shoppingResults, ...discogsResults];

    // Sort by price (nulls last)
    all.sort((a, b) => {
      if (a.priceRaw === null) return 1;
      if (b.priceRaw === null) return -1;
      return a.priceRaw - b.priceRaw;
    });

    // Mark the lowest-priced result
    const firstWithPrice = all.find(r => r.priceRaw !== null);
    if (firstWithPrice) firstWithPrice.badge = 'Best Price';

    res.json({ results: all, query: q, total: all.length });
  } catch (err) {
    console.error('Search error:', err.message);
    res.status(500).json({ error: 'Search failed. Please try again.' });
  }
});

// ── Start ─────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🎵 Vinyl Price Search is running!`);
  console.log(`   Open http://localhost:${PORT} in your browser\n`);
});
