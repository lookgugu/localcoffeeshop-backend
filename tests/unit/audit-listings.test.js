/**
 * Unit Tests for scripts/audit-listings.js, which generated the removal list
 * in migrations/20261030_02_remove_non_coffee_listings.sql.
 */

const { classify } = require('../../scripts/audit-listings');

describe('classify(name)', () => {
  it.each([
    ['Woods Hill Table', ['restaurant']],
    ["Lucky's Steakhouse", ['restaurant']], // "tea" inside a word is not tea
    ['Backroads Bar & Grill', ['bar/alcohol', 'food']],
    ['Whitman Brewing Company', ['bar/alcohol']],
    ["McDonald's", ['chain']],
    ['Circle K', ['retail/services']],
    ['Iron Creek Inn & Suites', ['lodging/venue']],
    ['Riviera Creamery', ['juice/dessert']],
  ])('flags %s', (name, categories) => {
    expect(classify(name)).toEqual(categories);
  });

  it.each([
    // Coffee words win, including accented and misspelled ones.
    'Haute Coffee',
    'Mamale Café & Pizza Bar',
    "Leopold's Books Bar Caffè",
    'Kylies Kaffiene bar',
    'The Nitro Bar',
    'Main Streets Market & Cafe',
    // Coffee stems inside a word (Codex review on #14).
    'Steamworks Coffeebar and Eatery',
    'Hook & Ladder Coffees & Wine Co.',
    'Red Rambler Coffees & Ramblin’ Red’s Brewing Co.',
    'KentJava Bar',
    'Cocoa Beanery At Hershey Lodge',
    'Teapioca Lounge',
    'King Kong Milktea & Smoothie Morrow',
    // Ambiguous: kept for a person to judge.
    "Something's Brewing Too",
    'Panera Bread',
    'Krispy Kreme',
    "Massimo’s Italian Bakery Lemoyne",
    'River Reader Bookstore',
    'Swedish Hill at Aspen Art Museum',
    // No signal either way.
    'Nashoba Brook Bakery',
    'Concord Teacakes',
  ])('keeps %s', (name) => {
    expect(classify(name)).toBeNull();
  });
});
