/**
 * SEO Routes
 *
 * Top-level routes for crawlers and legacy URL compatibility:
 *   GET /                                — index.html
 *   GET /sitemap.xml                     — dynamic sitemap with state pages
 *   GET /pages/states/:stateName.html    — legacy slug → /html/state.html?code=XX
 *   GET /html/state_:stateCode.html      — legacy code  → /html/state.html?code=XX
 *
 * The name→code redirect uses the shared State enum so backend and frontend
 * agree on the canonical mapping.
 */

const path = require('path');
const { asyncHandler } = require('../lib/async-handler');

function mountSeo(app, { db, enums, config }) {
    // Legacy /pages/states/<slug>.html → /html/state.html?code=XX
    app.get('/pages/states/:stateName.html', (req, res) => {
        const stateName = req.params.stateName.replace(/-/g, ' ');
        const stateCode = enums.stateCodeFromName(stateName);
        if (stateCode) {
            res.redirect(301, `/html/state.html?code=${stateCode}`);
        } else {
            res.status(404).send('State not found');
        }
    });

    // Legacy /html/state_xx.html → /html/state.html?code=XX
    app.get('/html/state_:stateCode.html', (req, res) => {
        const stateCode = req.params.stateCode.toUpperCase();
        if (/^[A-Z]{2}$/.test(stateCode)) {
            res.redirect(301, `/html/state.html?code=${stateCode}`);
        } else {
            res.status(404).send('State not found');
        }
    });

    // Index page — path matches original server.js (src/public/html/index.html)
    app.get('/', (req, res) => {
        res.sendFile(path.join(__dirname, '..', 'public', 'html', 'index.html'));
    });

    // Dynamic sitemap.xml for SEO
    app.get('/sitemap.xml', asyncHandler(async (req, res) => {
        const baseUrl = config.frontendUrl || 'https://localcoffeeshop.co';
        const today = new Date().toISOString().split('T')[0];

        // Read the indexed `state` column directly. The previous
        // SUBSTR/INSTR scan of `address` was both slow and brittle for
        // non-standard address formats.
        const states = await db.all(
            `SELECT DISTINCT state AS state_code
             FROM coffee_shops
             WHERE state IS NOT NULL AND state != ''
             ORDER BY state_code`,
            [],
            'get_sitemap_states',
        );

        let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${baseUrl}/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${baseUrl}/pages/contact.html</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>
  <url>
    <loc>${baseUrl}/pages/submit.html</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>`;

        for (const state of states) {
            if (state.state_code && /^[A-Z]{2}$/.test(state.state_code)) {
                xml += `
<url>
<loc>${baseUrl}/html/state.html?code=${state.state_code}</loc>
<lastmod>${today}</lastmod>
<changefreq>weekly</changefreq>
<priority>0.8</priority>
</url>`;
            }
        }
        xml += '\n</urlset>';

        res.set('Content-Type', 'application/xml');
        res.set('Cache-Control', 'public, max-age=86400');
        res.send(xml);
    }));
}

module.exports = { mountSeo };
