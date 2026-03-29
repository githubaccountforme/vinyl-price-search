// ── VinylPrice — Frontend ──────────────────────────────────────

const form        = document.getElementById('search-form');
const input       = document.getElementById('search-input');
const searchBtn   = document.getElementById('search-btn');
const statusEl    = document.getElementById('status');
const statusText  = document.getElementById('status-text');
const errorBox    = document.getElementById('error-box');
const header      = document.getElementById('results-header');
const grid        = document.getElementById('results-grid');
const emptyState  = document.getElementById('empty-state');
const queryLabel  = document.getElementById('query-display');
const sortSelect  = document.getElementById('sort-select');
const featureStrip = document.getElementById('feature-strip');

let currentResults = [];

// ── Retailer color map ───────────────────────────────────────
const RETAILER_COLORS = {
  'Amazon':           '#FF9900',
  'eBay':             '#E53238',
  'Target':           '#CC0000',
  'Walmart':          '#0071CE',
  'Best Buy':         '#003B64',
  'Discogs':          '#a38b6d',
  'Record Store UK':  '#7c3aed',
};
function retailerColor(name) {
  return RETAILER_COLORS[name] || '#555';
}

// ── Render results ───────────────────────────────────────────
function renderResults(results) {
  grid.innerHTML = '';

  if (!results.length) {
    emptyState.style.display = 'block';
    header.style.display     = 'none';
    return;
  }

  emptyState.style.display = 'none';
  header.style.display     = 'flex';

  results.forEach(item => {
    const card = document.createElement('div');
    card.className = 'card' + (item.badge === 'Best Price' ? ' best-price' : '');

    // Badge
    const badgeHtml = item.badge
      ? `<div class="card-badge">✓ ${item.badge}</div>`
      : '';

    // Image
    const imgHtml = item.image
      ? `<img src="${escHtml(item.image)}" alt="${escHtml(item.title)}" loading="lazy" onerror="this.parentElement.innerHTML='<svg class=no-img viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'white\\' stroke-width=\\'1\\'><circle cx=\\'12\\' cy=\\'12\\' r=\\'10\\'/><circle cx=\\'12\\' cy=\\'12\\' r=\\'3\\'/></svg>'" />`
      : `<svg class="no-img" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/></svg>`;

    // Price display
    const priceHtml = item.priceRaw !== null
      ? `<span class="price">$${item.priceRaw.toFixed(2)}</span>`
      : `<span class="price no-price">${escHtml(item.price || 'See site')}</span>`;

    // Stars
    let starsHtml = '';
    if (item.rating) {
      const full  = Math.floor(item.rating);
      const frac  = item.rating - full >= 0.5 ? '½' : '';
      const empty = 5 - full - (frac ? 1 : 0);
      starsHtml = `
        <div class="rating">
          ${'★'.repeat(full)}${frac}${'☆'.repeat(empty)}
          <span style="color:#666;margin-left:4px">${item.rating.toFixed(1)}${item.reviews ? ` (${item.reviews.toLocaleString()})` : ''}</span>
        </div>`;
    }

    // Meta chips
    const chips = [];
    if (item.condition) chips.push(escHtml(item.condition));
    if (item.year)      chips.push(escHtml(String(item.year)));
    if (item.label)     chips.push(escHtml(item.label));
    if (item.numForSale) chips.push(`${item.numForSale} for sale`);
    const chipsHtml = chips.length
      ? `<div class="card-meta">${chips.map(c => `<span class="meta-chip">${c}</span>`).join('')}</div>`
      : '';

    card.innerHTML = `
      ${badgeHtml}
      <div class="card-image">${imgHtml}</div>
      <div class="card-body">
        <div class="retailer-row">
          <span class="retailer-dot" style="background:${retailerColor(item.source)}"></span>
          <span class="retailer-name">${escHtml(item.source)}</span>
        </div>
        <div class="card-title">${escHtml(item.title)}</div>
        ${chipsHtml}
        ${starsHtml}
      </div>
      <div class="card-footer">
        ${priceHtml}
        <a class="buy-btn" href="${escHtml(item.url)}" target="_blank" rel="noopener noreferrer">
          View Deal →
        </a>
      </div>
    `;

    grid.appendChild(card);
  });
}

// ── Sorting ──────────────────────────────────────────────────
function applySort(results, mode) {
  const sorted = [...results];
  if (mode === 'price-asc') {
    sorted.sort((a, b) => {
      if (a.priceRaw === null) return 1;
      if (b.priceRaw === null) return -1;
      return a.priceRaw - b.priceRaw;
    });
  } else if (mode === 'price-desc') {
    sorted.sort((a, b) => {
      if (a.priceRaw === null) return 1;
      if (b.priceRaw === null) return -1;
      return b.priceRaw - a.priceRaw;
    });
  } else if (mode === 'source') {
    sorted.sort((a, b) => a.source.localeCompare(b.source));
  }
  return sorted;
}

sortSelect.addEventListener('change', () => {
  if (currentResults.length) {
    renderResults(applySort(currentResults, sortSelect.value));
  }
});

// ── Search ───────────────────────────────────────────────────
async function doSearch(query) {
  if (!query.trim()) return;

  // Reset UI
  errorBox.style.display = 'none';
  emptyState.style.display = 'none';
  header.style.display = 'none';
  grid.innerHTML = '';
  if (featureStrip) featureStrip.style.display = 'none';
  statusEl.style.display = 'block';
  statusText.textContent = 'Searching across retailers…';
  searchBtn.disabled = true;

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const data = await res.json();

    statusEl.style.display = 'none';
    searchBtn.disabled = false;

    if (!res.ok) {
      showError(data.error || 'Something went wrong. Please try again.');
      return;
    }

    queryLabel.textContent = data.query;
    currentResults = data.results || [];
    renderResults(applySort(currentResults, sortSelect.value));

    // Scroll to results smoothly
    header.scrollIntoView({ behavior: 'smooth', block: 'start' });

  } catch (err) {
    statusEl.style.display = 'none';
    searchBtn.disabled = false;
    showError('Could not reach the server. Make sure the app is running.');
  }
}

form.addEventListener('submit', e => {
  e.preventDefault();
  const q = input.value.trim();
  if (q) doSearch(q);
});

// Pre-fill from URL ?q= param
const urlQ = new URLSearchParams(location.search).get('q');
if (urlQ) {
  input.value = urlQ;
  doSearch(urlQ);
}

// ── Helpers ──────────────────────────────────────────────────
function showError(msg) {
  errorBox.textContent = '⚠️  ' + msg;
  errorBox.style.display = 'block';
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
