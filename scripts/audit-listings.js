#!/usr/bin/env node

/**
 * Flag coffee_shops listings whose names say they are not coffee shops
 * (restaurants, bars, breweries, grills, hotels, markets, gas stations,
 * juice/ice-cream shops, fast-food chains).
 *
 * Usage:
 *   DB_PATH=./data/coffee_shops.db node scripts/audit-listings.js            # CSV to stdout
 *   DB_PATH=./data/coffee_shops.db node scripts/audit-listings.js --sql      # (id, name, address) VALUES rows
 *
 * The table stores no place type, so this works from the name alone and is
 * deliberately conservative: a name with any coffee word ("Café & Pizza"),
 * or an ambiguous one (bakeries, donut and bagel shops, bookstores, museums
 * and other institutions whose café carries their name, "Something's
 * Brewing"), is never flagged. Only the lowest id of each duplicate
 * (name, address) group is reported, the copy 20261030_01 keeps.
 *
 * migrations/20261030_02_remove_non_coffee_listings.sql was generated with
 * --sql; later removals go in a new migration.
 */

const sqlite3 = require('sqlite3');

const COFFEE = /\b(coffee|cof+e+|cafe?s?|cafecito|caffeine|nitro|caffe|kaffe|kaff?ie?ne|kof+ee|kafe|kofi|espresso|roast(er|ers|ery|ing|ed)?|beans?|brew(s|ed|house|haus)?|latte|java|joe|mocha|cappuccino|perk|grind|cup|mug|drip|pour|barista|kopi|tea(house)?|boba|starbucks|dunkin|peet'?s|tim hortons|caribou|dutch bros|scooter'?s|biggby|black rifle|blue bottle|philz|la colombe|intelligentsia|stumptown|gregorys|pavement|ziggi'?s|7 brew|pj'?s|human bean|black rock|aroma joe|crema|coffeehouse|coffeeshop)\b/i;
const AMBIGUOUS = /\b(bakery|bakeries|bake shop|bakehouse|bakers?|donuts?|doughnuts?|bagels?|krispy kreme|panera|books?|bookstore|booksellers?|museum|library|university|college|school|hospital|church|theat(er|re)|cinema|brewing)\b/i;
const BEER_BREWING = /\b(brewing (co|company)|brewery|brewpub|beer)\b/i;
const NOT_COFFEE = [
    ['restaurant', /\b(restaurant|ristorante|trattoria|osteria|steakhouse|steak ?house|chophouse|table|eatery|brasserie|supper club)\b/i],
    ['bar/alcohol', /\b(brewing (co|company)|bar|pub|tavern|saloon|taproom|tap ?house|tap room|brewery|brewpub|beer|ale ?house|wine|winery|vineyard|cocktails?|lounge|spirits|distillery|cidery|speakeasy|biergarten|beer garden)\b/i],
    ['food', /\b(grill|grille|bbq|barbe?que|smokehouse|burgers?|pizza|pizzeria|wings|taco|taqueria|cantina|sushi|ramen|pho|noodle|thai|chinese|hibachi|teriyaki|mexican|indian|curry|kebab|gyro|shawarma|subs?|sandwich shop|chicken|seafood|oyster|crab|lobster|fish|steak)\b/i],
    ['lodging/venue', /\b(hotel|inn|motel|resort|suites|lodge|casino|golf|country club|bowling)\b/i],
    ['retail/services', /\b(gas|fuel|exxon|chevron|sunoco|citgo|speedway|wawa|sheetz|7-eleven|circle k|walmart|target|costco|kroger|safeway|grocery|supermarket|market|pharmacy|cvs|walgreens|hardware|salon|spa|barber|nails|gym|fitness|bank|insurance|realty|auto|tire|car wash|laundromat|florist|antiques?|flea)\b/i],
    ['juice/dessert', /\b(juice|smoothies?|acai|kombucha|dairy bar|ice cream|frozen yogurt|yogurt|gelato|creamery)\b/i],
    ['chain', /\b(mcdonald'?s|burger king|wendy'?s|taco bell|subway|chick-fil-a|sonic|arby'?s|jack in the box|ihop|denny'?s|waffle house|cracker barrel|bob evans|perkins)\b/i],
];

/** Accents off ("Café" -> "Cafe") so \b boundaries work, curly apostrophes straightened. */
function normalize(name) {
    return name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[‘’]/g, "'");
}

/** The categories that say `name` is not a coffee shop, or null to keep it. */
function classify(name) {
    const n = normalize(name);
    if (COFFEE.test(n)) return null;
    if (AMBIGUOUS.test(n) && !BEER_BREWING.test(n)) return null;
    const hits = NOT_COFFEE.filter(([, re]) => re.test(n)).map(([category]) => category);
    return hits.length ? hits : null;
}

const sqlString = (s) => `'${String(s).replace(/'/g, "''")}'`;
const csvField = (s) => `"${String(s).replace(/"/g, '""')}"`;

function main() {
    const db = new sqlite3.Database(process.env.DB_PATH || './coffee_shops.db', sqlite3.OPEN_READONLY);
    db.all('SELECT MIN(id) AS id, name, address, state FROM coffee_shops GROUP BY lower(name), address ORDER BY id', (err, rows) => {
        if (err) {
            console.error(err.message);
            process.exit(1);
        }
        const flagged = rows.map((r) => ({ ...r, categories: classify(r.name) })).filter((r) => r.categories);
        if (process.argv.includes('--sql')) {
            const last = flagged.length - 1;
            for (const [i, r] of flagged.entries()) {
                console.log(`    (${r.id}, ${sqlString(r.name)}, ${sqlString(r.address)})${i < last ? ',' : ''} -- ${r.categories.join(', ')}`);
            }
        } else {
            console.log('id,state,name,address,categories');
            for (const r of flagged) console.log([r.id, r.state, r.name, r.address, r.categories.join('; ')].map(csvField).join(','));
        }
        console.error(`${flagged.length} of ${rows.length} unique listings flagged`);
        db.close();
    });
}

module.exports = { classify, normalize };

if (require.main === module) main();
