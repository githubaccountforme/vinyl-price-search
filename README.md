# 🎵 VinylPrice — Vinyl Record Price Comparison Tool

Search Amazon, eBay, Target, Walmart, Discogs and more in one click.
Built with Node.js + Express. Ready to deploy on any hosting platform.

---

## Quick Start (run locally in 5 minutes)

### 1. Install Node.js
Download and install from https://nodejs.org (choose the "LTS" version).

### 2. Get a SerpAPI key (for retailer results)
- Go to https://serpapi.com and create a free account
- Free tier = **100 searches/month** — plenty for personal use
- For a public site with traffic, the $50/mo plan gives 5,000 searches
- Copy your API key from the dashboard

### 3. Set up the project
Open Terminal (Mac) or Command Prompt (Windows), then:

```bash
# 1. Go into the project folder
cd "Vinyl price Search tool"

# 2. Install dependencies
npm install

# 3. Create your config file
cp .env.example .env
```

Open the `.env` file in any text editor and paste in your SerpAPI key:
```
SERPAPI_KEY=paste_your_key_here
```

### 4. Run it!
```bash
npm start
```

Then open **http://localhost:3000** in your browser. That's it!

---

## How to Add Affiliate Links (Earn Money!)

Once you're ready to monetize, sign up for these free affiliate programs and
add your IDs to the `.env` file.

| Retailer  | Sign Up URL                                       | Commission    |
|-----------|---------------------------------------------------|---------------|
| **Amazon**    | https://affiliate-program.amazon.com          | 1–10%         |
| **eBay**      | https://partnernetwork.ebay.com               | 1–4%          |
| **Discogs**   | https://www.discogs.com/group/thread/867986   | Varies        |

After you get your IDs, open `.env` and fill in:
```
AMAZON_AFFILIATE_ID=yoursite-20
EBAY_AFFILIATE_ID=your_ebay_pub_id
DISCOGS_AFFILIATE_ID=your_discogs_ref
```

Restart the app and all "View Deal" links will automatically include your
affiliate tracking codes.

---

## Deploy to the Web (Share with Others)

### Option A: Render.com (Recommended — Free Tier Available)

1. Create a free account at https://render.com
2. Click **New → Web Service**
3. Connect your GitHub repo (push this folder to a new GitHub repo first)
4. Settings:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
5. Under **Environment**, add all your keys from `.env`
6. Click **Deploy** — you'll get a public URL like `https://vinylprice.onrender.com`

### Option B: Railway.app

1. Create an account at https://railway.app
2. Click **New Project → Deploy from GitHub Repo**
3. Add your environment variables in the Railway dashboard
4. Railway auto-detects Node.js and deploys automatically

### Option C: Heroku

```bash
# Install Heroku CLI, then:
heroku create your-app-name
heroku config:set SERPAPI_KEY=your_key
heroku config:set AMAZON_AFFILIATE_ID=yoursite-20
git push heroku main
```

---

## Discogs-Only Mode (Free, No API Key Needed)

If you don't want to pay for SerpAPI yet, the app still works using the
**free Discogs API**, which has great vinyl marketplace pricing data.
You won't get Amazon/Target/Walmart results, but Discogs is the most
popular vinyl marketplace anyway.

To get a free Discogs token (raises rate limits):
1. Log in at https://www.discogs.com
2. Go to **Settings → Developers**
3. Click **Generate new token**
4. Add it to `.env` as `DISCOGS_TOKEN=your_token`

---

## Project Structure

```
Vinyl price Search tool/
├── server.js          ← Backend: Express server, API calls, affiliate logic
├── package.json       ← Node.js project config & dependencies
├── .env.example       ← Template for your API keys (copy to .env)
├── .env               ← Your actual keys (never share this file!)
└── public/
    ├── index.html     ← Frontend UI
    └── app.js         ← Frontend search logic
```

---

## Customizing the Site Name / Branding

To change "VinylPrice" to your own brand name:
- Open `public/index.html`
- Find `VinylPrice` and replace with your name
- Update the `<title>` tag at the top
- Change the red accent color (`#e63946`) to your preferred color

---

## Tips for Monetization

- **Domain name:** Register a catchy `.com` like `vinylpricer.com` or `recordpricecheck.com` (~$12/yr on Namecheap)
- **SEO:** The `?q=` URL parameter means searches are shareable links — great for SEO
- **Content:** Add a blog section covering new vinyl releases to drive organic traffic
- **Email list:** Add a "Get weekly vinyl deals" email signup to build an audience

---

*Built with ❤️ for vinyl lovers.*
