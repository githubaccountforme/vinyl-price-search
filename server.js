// ============================================================
//  Vinyl Price Search — Backend Server
//  Searches Google Shopping (via SerpAPI) + Discogs marketplace
// ============================================================

require('dotenv').config();
const express    = require('express');
const axios      = require('axios');
const nodemailer = require('nodemailer');
const cron       = require('node-cron');
const db         = require('./db');

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

// ── Email (SendGrid HTTP API) ──────────────────────────────────

async function sendEmail({ to, subject, html }) {
  const apiKey  = process.env.EMAIL_PASS;
  const from    = process.env.EMAIL_FROM || process.env.EMAIL_USER;
  if (!apiKey || !from) {
    console.warn('[email] EMAIL_PASS or EMAIL_FROM not set — skipping');
    return;
  }
  await axios.post('https://api.sendgrid.com/v3/mail/send', {
    personalizations: [{ to: [{ email: to }] }],
    from:             { email: from, name: 'VinylPrice Alerts' },
    subject,
    content:          [{ type: 'text/html', value: html }],
  }, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  });
}

async function sendPriceAlert({ to, itemTitle, query, oldPrice, newPrice, buyUrl, unsubToken }) {
  const siteUrl    = process.env.SITE_URL || 'https://vinyl-price-search.onrender.com';
  const unsubUrl   = `${siteUrl}/unsubscribe?token=${unsubToken}`;
  const searchUrl  = `${siteUrl}/?q=${encodeURIComponent(query)}`;
  const savings    = oldPrice && newPrice ? (oldPrice - newPrice).toFixed(2) : null;
  const priceLine  = newPrice ? `$${newPrice.toFixed(2)}` : 'a new low';
  const savingLine = savings > 0 ? `<span style="color:#27ae60">You save $${savings}!</span>` : '';

  await sendEmail({
    to,
    subject: `💰 Price drop: "${itemTitle}" is now ${priceLine}`,
    html: `
      <div style="font-family:Inter,sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#fff;border-radius:12px;border:1px solid #eee;">
        <div style="text-align:center;margin-bottom:24px;">
          <span style="display:inline-block;background:#e63946;color:#fff;font-weight:800;font-size:18px;padding:8px 18px;border-radius:8px;">
            🎵 VinylPrice
          </span>
        </div>
        <h2 style="font-size:20px;color:#1a1a1a;margin-bottom:8px;">Price drop alert!</h2>
        <p style="color:#555;font-size:15px;line-height:1.6;margin-bottom:20px;">
          <strong>${itemTitle}</strong> just dropped to <strong style="color:#e63946;font-size:18px;">${priceLine}</strong>.
          ${savingLine}
        </p>
        <div style="text-align:center;margin-bottom:24px;">
          <a href="${buyUrl}" style="background:#e63946;color:#fff;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:700;font-size:15px;display:inline-block;">
            View Best Price →
          </a>
        </div>
        <p style="text-align:center;margin-bottom:8px;">
          <a href="${searchUrl}" style="color:#888;font-size:13px;">See all prices for "${query}"</a>
        </p>
        <hr style="border:none;border-top:1px solid #f0f0f0;margin:20px 0;">
        <p style="color:#ccc;font-size:11px;text-align:center;">
          You're receiving this because you set a price alert on VinylPrice.<br>
          <a href="${unsubUrl}" style="color:#ccc;">Unsubscribe from this alert</a>
        </p>
      </div>
    `,
  });
}

// ── Watchlist Routes ─────────────────────────────────────────

// POST /api/watchlist  — add a new price alert
app.post('/api/watchlist', async (req, res) => {
  const { email, query, itemTitle, alertBelow, lastPrice } = req.body;
  if (!email || !query || !itemTitle) {
    return res.status(400).json({ error: 'email, query, and itemTitle are required.' });
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  try {
    const { id, token } = db.addWatch({ email, query, itemTitle, alertBelow, lastPrice });

    // Respond immediately — don't block on email sending
    res.json({ ok: true, id });

    // Send confirmation email in the background (non-blocking)
    const siteUrl  = process.env.SITE_URL || 'https://vinyl-price-search.onrender.com';
    const unsubUrl = `${siteUrl}/unsubscribe?token=${token}`;
    sendEmail({
      to:      email,
      subject: `✅ Price alert set for "${itemTitle}"`,
      html: `
        <div style="font-family:Inter,sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#fff;border-radius:12px;border:1px solid #eee;">
          <div style="text-align:center;margin-bottom:20px;">
            <span style="background:#e63946;color:#fff;font-weight:800;font-size:18px;padding:8px 18px;border-radius:8px;display:inline-block;">🎵 VinylPrice</span>
          </div>
          <h2 style="font-size:18px;color:#1a1a1a;">Your price alert is set!</h2>
          <p style="color:#555;font-size:14px;line-height:1.6;margin-top:10px;">
            We'll email you at <strong>${email}</strong> when <strong>${itemTitle}</strong>
            ${alertBelow ? `drops below <strong>$${parseFloat(alertBelow).toFixed(2)}</strong>` : 'drops in price'}.
          </p>
          <p style="color:#aaa;font-size:12px;margin-top:24px;text-align:center;">
            <a href="${unsubUrl}" style="color:#aaa;">Cancel this alert</a>
          </p>
        </div>
      `,
    }).catch(err => console.error('[email] Confirmation send failed:', err.message));
  } catch (err) {
    console.error('Watchlist error:', err.message);
    res.status(500).json({ error: 'Failed to save alert. Please try again.' });
  }
});

// GET /unsubscribe?token=xxx  — one-click unsubscribe
app.get('/unsubscribe', (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).send('Invalid link.');
  const removed = db.removeByToken(token);
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>Unsubscribed — VinylPrice</title>
    <style>body{font-family:sans-serif;text-align:center;padding:60px 20px;color:#555;}
    a{color:#e63946;}</style></head>
    <body>
      <h2>${removed ? '✅ Alert removed' : 'Link already used'}</h2>
      <p>${removed ? "You won't receive any more alerts for this record." : "This unsubscribe link has already been used."}</p>
      <p><a href="/">← Back to VinylPrice</a></p>
    </body>
    </html>
  `);
});

// ── Price Check Job ───────────────────────────────────────────

async function runPriceChecks() {
  const watches = db.getDueWatches();
  if (watches.length === 0) return;
  console.log(`[price-check] Checking ${watches.length} watchlist item(s)…`);

  for (const watch of watches) {
    try {
      const [shopping, discogs] = await Promise.allSettled([
        searchGoogleShopping(watch.query),
        searchDiscogs(watch.query),
      ]);
      const all = [
        ...(shopping.status === 'fulfilled' ? shopping.value : []),
        ...(discogs.status  === 'fulfilled' ? discogs.value  : []),
      ].filter(r => r.priceRaw !== null);

      if (all.length === 0) { db.updateChecked(watch.id, watch.last_price); continue; }

      all.sort((a, b) => a.priceRaw - b.priceRaw);
      const bestPrice = all[0].priceRaw;
      const bestUrl   = all[0].url;

      db.updateChecked(watch.id, bestPrice);

      // Decide whether to alert:
      // a) user set a target price and we're now at or below it, OR
      // b) no target set but price dropped 10%+ from when they set the alert
      const shouldAlert =
        (watch.alert_below !== null && bestPrice <= watch.alert_below) ||
        (watch.alert_below === null && watch.last_price !== null && bestPrice <= watch.last_price * 0.9);

      if (shouldAlert) {
        console.log(`[price-check] Alert! ${watch.item_title}: $${bestPrice} (was $${watch.last_price})`);
        await sendPriceAlert({
          to:         watch.email,
          itemTitle:  watch.item_title,
          query:      watch.query,
          oldPrice:   watch.last_price,
          newPrice:   bestPrice,
          buyUrl:     bestUrl,
          unsubToken: watch.token,
        });
        db.markAlerted(watch.id);
        db.updateChecked(watch.id, bestPrice);
      }
    } catch (err) {
      console.error(`[price-check] Error checking "${watch.query}":`, err.message);
    }
  }
}

// Run price checks every day at 9 AM
cron.schedule('0 9 * * *', () => {
  console.log('[price-check] Daily job starting…');
  runPriceChecks().catch(console.error);
});

// Also run once shortly after startup (catches up if server was sleeping)
setTimeout(() => runPriceChecks().catch(console.error), 10000);

// ── Start ─────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🎵 Vinyl Price Search is running!`);
  console.log(`   Open http://localhost:${PORT} in your browser\n`);
});
