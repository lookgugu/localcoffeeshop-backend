-- Migration: Remove Starbucks chain listings
-- Created: 2026-11-18
--
-- The directory is for independent, local coffee shops, but the seed data
-- included 1,234 Starbucks locations (including licensed grocery/campus kiosks
-- and "We Proudly Serve Starbucks" counters). This removes all 1,234 of them,
-- each matched on id AND name AND address so it can never remove a different
-- shop. Runs after 20261030_01, so each id is the copy it kept.
--
-- coffee_shops_fts is not touched: see 20261030_01.
--
-- Forward-only, like the 20261017 and 20261030 migrations: no down section, so
-- `migrate.js down` refuses rather than resurrecting removed listings.

-- migration:up

DELETE FROM coffee_shops
WHERE (id, name, address) IN (VALUES
    (1284, 'Starbucks', '1490 Overseas Hwy, Marathon, FL 33050, USA'), -- chain
    (1285, 'Starbucks', '9200 FL-228, Macclenny, FL 32063, USA'), -- chain
    (1286, 'Starbucks', '1380 E John Sims Pkwy, Niceville, FL 32578, USA'), -- chain
    (1287, 'Starbucks', '500 N Congress Ave, Lake Park, FL 33403, USA'), -- chain
    (1288, 'Starbucks', '9560 Harding Ave, Surfside, FL 33154, USA'), -- chain
    (1289, 'Starbucks', '622 Hugh Adams Rd, Defuniak Springs, FL 32435, USA'), -- chain
    (1290, 'Starbucks', '3180 Tampa Rd, Oldsmar, FL 34677, USA'), -- chain
    (1291, 'Starbucks', '716 U.S. 27/441, Lady Lake, FL 32159, USA'), -- chain
    (1292, 'Starbucks', '1080 N Collier Blvd, Marco Island, FL 34145, USA'), -- chain
    (1293, 'Starbucks', '1453 Sadler Rd, Fernandina Beach, FL 32034, USA'), -- chain
    (1294, 'Starbucks', '76 E Palm Dr, Florida City, FL 33034, USA'), -- chain
    (1295, 'Starbucks', '11091 Southern Blvd, Royal Palm Beach, FL 33411, USA'), -- chain
    (1296, 'Starbucks', '10155 Okeechobee Blvd, Royal Palm Beach, FL 33411, USA'), -- chain
    (1297, 'Starbucks', '1768 US Hwy 27 N, Sebring, FL 33870, USA'), -- chain
    (1298, 'Starbucks', 'Loch Leven Landing, 19021 US-441, Mt Dora, FL 32757, USA'), -- chain
    (1299, 'Starbucks', '17450 US-441, Mt Dora, FL 32757, USA'), -- chain
    (1300, 'Starbucks', '5435 US-19, New Port Richey, FL 34652, USA'), -- chain
    (1301, 'Starbucks', '84001 Overseas Hwy, Islamorada, FL 33036, USA'), -- chain
    (1302, 'Starbucks', '100 Mattie M Kelly Blvd, Destin, FL 32541, USA'), -- chain
    (1303, 'Starbucks', '250 E Miracle Strip Pkwy, Mary Esther, FL 32569, USA'), -- chain
    (1304, 'Starbucks', '200 Crandon Blvd, Key Biscayne, FL 33149, USA'), -- chain
    (1305, 'Starbucks', '1963 Park Ave Suite 100, Orange Park, FL 32073, USA'), -- chain
    (1306, 'Starbucks', '306 US-17 #92, Longwood, FL 32750, USA'), -- chain
    (1307, 'Starbucks', '301 W Cocoa Beach Causeway, Cocoa Beach, FL 32931, USA'), -- chain
    (1308, 'Starbucks', '4001 N Atlantic Ave, Cocoa Beach, FL 32931, USA'), -- chain
    (1309, 'Starbucks', '52 Curtiss Pkwy, Miami Springs, FL 33166, USA'), -- chain
    (1310, 'Starbucks', '850 S Sun Dr, Lake Mary, FL 32746, USA'), -- chain
    (1311, 'Starbucks', 'The Shoppes at Harbour Pointe, 100 Main St, Safety Harbor, FL 34695, USA'), -- chain
    (1312, 'Starbucks', '346 Gulf Breeze Pkwy, Gulf Breeze, FL 32561, USA'), -- chain
    (2083, 'Starbucks', '131 Brooks Willis Dr, Hardeeville, SC 29927, USA'), -- chain
    (2084, 'Starbucks', '2702 Gentry Memorial Hwy, Pickens, SC 29671, USA'), -- chain
    (2085, 'Starbucks', '502 Ann St, Pickens, SC 29671, USA'), -- chain
    (2086, 'Starbucks', '211 Ingle''S Pl, Seneca, SC 29678, USA'), -- chain
    (2087, 'Starbucks', '1795 Whiskey Rd, Aiken, SC 29803, USA'), -- chain
    (2088, 'Starbucks', '1943 Whiskey Rd, Aiken, SC 29803, USA'), -- chain
    (2089, 'Starbucks', '2200 Chesnee Hwy, Spartanburg, SC 29303, USA'), -- chain
    (2090, 'Starbucks', '2375 Chesnee Hwy, Spartanburg, SC 29303, USA'), -- chain
    (2091, 'Starbucks', '1216 Wilson Rd, Newberry, SC 29108, USA'), -- chain
    (2092, 'Starbucks', '180 Scenic Plaza Dr, West Union, SC 29696, USA'), -- chain
    (2093, 'Starbucks', '1 Klugh Ave, Clemson, SC 29634, USA'), -- chain
    (2094, 'Starbucks', '727 Knox Abbott Dr, Cayce, SC 29033, USA'), -- chain
    (2095, 'Starbucks', '3047 Charleston Hwy, Cayce, SC 29172, USA'), -- chain
    (2096, 'Starbucks', '7467 Woodrow St, Irmo, SC 29063, USA'), -- chain
    (2097, 'Starbucks', '1245 Lake Murray Blvd, Irmo, SC 29063, USA'), -- chain
    (2098, 'Starbucks', '1185 Dutch Fork Rd, Irmo, SC 29063, USA'), -- chain
    (2099, 'Starbucks', '1501 W Floyd Baker Blvd, Gaffney, SC 29341, USA'), -- chain
    (2100, 'Starbucks', '250 McCarter Rd, Fountain Inn, SC 29644, USA'), -- chain
    (2101, 'Starbucks', '1851 26, Landrum, SC 29356, USA'), -- chain
    (2102, 'Starbucks', '555 E Cheves St, Florence, SC 29502, USA'), -- chain
    (2103, 'Starbucks', '2007 Boundary St, Beaufort, SC 29902, USA'), -- chain
    (2104, 'Starbucks', '30 Krieger Ct, Travelers Rest, SC 29690, USA'), -- chain
    (2105, 'Starbucks', '181 Westfield St, Hartsville, SC 29550, USA'), -- chain
    (2106, 'Starbucks', '10172 Ocean Hwy, Pawleys Island, SC 29585, USA'), -- chain
    (2107, 'Starbucks', '1925 Mountain Laurel Ct, Florence, SC 29505, USA'), -- chain
    (2108, 'Starbucks', '3009 Millwood Ave, Columbia, SC 29205, USA'), -- chain
    (2109, 'Starbucks', '2106 W Lucas St, Florence, SC 29501, USA'), -- chain
    (2110, 'Starbucks', '1911 W Palmetto St, Florence, SC 29501, USA'), -- chain
    (2111, 'Starbucks', '471 University Pkwy, Aiken, SC 29801, USA'), -- chain
    (2112, 'Starbucks', '5650 Lee Rd, Columbia, SC 29206, USA'), -- chain
    (2113, 'Starbucks', '1750 SC-160, Fort Mill, SC 29708, USA'), -- chain
    (2114, 'Starbucks', 'Baxter Town Village, 926 Market St, Fort Mill, SC 29708, USA'), -- chain
    (2115, 'Starbucks', '200 E Church St, Batesburg-Leesville, SC 29070, USA'), -- chain
    (2116, 'Starbucks', '469 N U.S. Hwy 52, Moncks Corner, SC 29461, USA'), -- chain
    (2117, 'Starbucks', '1588 Bells Hwy, Walterboro, SC 29488, USA'), -- chain
    (2118, 'Starbucks', '762 N Main St, Woodruff, SC 29388, USA'), -- chain
    (2119, 'Starbucks', '1062 Edgefield Rd, North Augusta, SC 29860, USA'), -- chain
    (2263, 'Starbucks Coffee', 'Greenbrier, AR 72058, USA'), -- chain
    (2274, 'Starbucks', '1100 Henderson St, Arkadelphia, AR 71999, USA'), -- chain
    (2298, 'Starbucks', '20701 I-30 Frontage Rd, Benton, AR 72022, USA'), -- chain
    (2541, 'Starbucks', '2031 Oliver Lancaster Blvd, Malvern, AR 72104, USA'), -- chain
    (2634, 'Starbucks', '2220 E Parkway Dr, Russellville, AR 72802, USA'), -- chain
    (2657, 'Starbucks', '3555 US-412, Siloam Springs, AR 72761, USA'), -- chain
    (2672, 'Starbucks', '3912 N State Line Ave, Texarkana, AR 71854, USA'), -- chain
    (3035, 'Starbucks', '8254 Ocean Gateway, Easton, MD 21601, USA'), -- chain
    (3036, 'Starbucks', '8223 Elliott Rd, Easton, MD 21601, USA'), -- chain
    (3037, 'Starbucks', '28539 Marlboro Ave, Easton, MD 21601, USA'), -- chain
    (3038, 'Starbucks', 'Greenbriar Shopping Center, 225 Brierhill Dr, Bel Air, MD 21015, USA'), -- chain
    (3039, 'Starbucks', '5000 Bradley Blvd, Chevy Chase, MD 20815, USA'), -- chain
    (3040, 'Starbucks', '580 Marketplace Dr, Bel Air, MD 21014, USA'), -- chain
    (3041, 'Starbucks', '1200 Agora Dr, Bel Air, MD 21014, USA'), -- chain
    (3042, 'Starbucks', '563 Baltimore Pike, Bel Air, MD 21014, USA'), -- chain
    (3043, 'Starbucks', '31 Denton Plaza, Denton, MD 21629, USA'), -- chain
    (3044, 'Starbucks', '4501 Van Buren St, Riverdale, MD 20737, USA'), -- chain
    (3045, 'Starbucks', '24 Rising Sun Town Center, Rising Sun, MD 21911, USA'), -- chain
    (3046, 'Starbucks', 'Shopping Center, 6675 Crain Hwy, La Plata, MD 20646, USA'), -- chain
    (3047, 'Starbucks', '60 Shining Willow Way, La Plata, MD 20646, USA'), -- chain
    (3048, 'Starbucks', 'Carrollton Shopping Center, 8498 Annapolis Rd, New Carrollton, MD 20784, USA'), -- chain
    (3049, 'Starbucks', '101 Braddock Rd, Frostburg, MD 21532, USA'), -- chain
    (3050, 'Starbucks', '999 Middelton Rd, Aberdeen, MD 21001, USA'), -- chain
    (4291, 'Starbucks', '226 E Perkins Ave, Sandusky, OH 44870, USA'), -- chain
    (4292, 'Starbucks', '4912 Milan Rd, Sandusky, OH 44870, USA'), -- chain
    (4293, 'Starbucks', '310 E Broad St, Pataskala, OH 43062, USA'), -- chain
    (4294, 'Starbucks', 'Market Square, 8869 Brecksville Rd, Brecksville, OH 44141, USA'), -- chain
    (4295, 'Starbucks', '4343 E Royalton Rd, Broadview Heights, OH 44147, USA'), -- chain
    (4296, 'Starbucks', '6130 Gender Rd, Canal Winchester, OH 43110, USA'), -- chain
    (4297, 'Starbucks', '264 S Hollywood Blvd, Steubenville, OH 43952, USA'), -- chain
    (4298, 'Starbucks', '7305 OH-37, Sunbury, OH 43074, USA'), -- chain
    (4299, 'Starbucks', '125 Bluebell Dr SW, New Philadelphia, OH 44663, USA'), -- chain
    (4300, 'Starbucks', '6780 Pearl Rd, Middleburg Heights, OH 44130, USA'), -- chain
    (4301, 'Starbucks', '30480 Lakeshore Blvd, Willowick, OH 44095, USA'), -- chain
    (4302, 'Starbucks', '65 N Main St, Chagrin Falls, OH 44022, USA'), -- chain
    (4303, 'Starbucks', '22841 Chagrin Blvd, Beachwood, OH 44122, USA'), -- chain
    (4304, 'Starbucks', '1465 E Mall Dr, Holland, OH 43528, USA'), -- chain
    (4305, 'Starbucks', '7059 Orchard Centre Dr, Holland, OH 43528, USA'), -- chain
    (4306, 'Starbucks', '4409 Hills and Dales Rd NE, Canton, OH 44708, USA'), -- chain
    (4307, 'Starbucks', 'Legacy Crossing, 130 McMahan Blvd, Marion, OH 43302, USA'), -- chain
    (4308, 'Starbucks', '1428 Marion-Waldo Rd, Marion, OH 43302, USA'), -- chain
    (4309, 'Starbucks', '4001 Hamilton Cleves Pike Rd, OH-128, Cleves, OH 45002, USA'), -- chain
    (4310, 'Starbucks', '2801 W Market St, Fairlawn, OH 44333, USA'), -- chain
    (4311, 'Starbucks', '3770 S Hamilton Rd, Groveport, OH 43125, USA'), -- chain
    (4312, 'Starbucks', '832 W Maple St, Hartville, OH 44632, USA'), -- chain
    (4313, 'Starbucks', '16292 Dresden Ave, East Liverpool, OH 43920, USA'), -- chain
    (4314, 'Starbucks', '3540 Burbank Rd, Wooster, OH 44691, USA'), -- chain
    (4315, 'Starbucks', '1060 Ashland Rd, Mansfield, OH 44905, USA'), -- chain
    (4316, 'Starbucks', '1055 Sugarbush Dr, Ashland, OH 44805, USA'), -- chain
    (4317, 'Starbucks', '220 Waverly Plaza, Waverly, OH 45690, USA'), -- chain
    (4318, 'Starbucks', '255 Center St, Chardon, OH 44024, USA'), -- chain
    (4319, 'Starbucks', '400 Corwin Nixon Blvd, South Lebanon, OH 45065, USA'), -- chain
    (4320, 'Starbucks', '636 Corwin Nixon Blvd, South Lebanon, OH 45065, USA'), -- chain
    (4321, 'Starbucks', '4546 Boardman-Canfield Rd, Canfield, OH 44406, USA'), -- chain
    (4322, 'Starbucks', '501 W Dussel Dr, Maumee, OH 43537, USA'), -- chain
    (4323, 'Starbucks', '21747 Co Rd M, West Unity, OH 43570, USA'), -- chain
    (4324, 'Starbucks', '21738 Co Rd M50, West Unity, OH 43570, USA'), -- chain
    (4325, 'Starbucks', '50789 Valley Plaza Dr, St Clairsville, OH 43950, USA'), -- chain
    (4326, 'Starbucks', 'Ohio Valley Mall Complex, 67965 Mall Ring Rd, St Clairsville, OH 43950, USA'), -- chain
    (4327, 'Starbucks', '1500 Lexington Ave, Mansfield, OH 44907, USA'), -- chain
    (4328, 'Starbucks', '1340 N Main St, North Canton, OH 44720, USA'), -- chain
    (4329, 'Starbucks', '534 S Main St, Ada, OH 45810, USA'), -- chain
    (4330, 'Starbucks', '2801 West Bancroft Street SA1280, Toledo, OH 43606, USA'), -- chain
    (4331, 'Starbucks', '7827 Reynolds Rd, Mentor, OH 44060, USA'), -- chain
    (4332, 'Starbucks', '9669 Mentor Ave, Mentor, OH 44060, USA'), -- chain
    (4333, 'Starbucks', '46402 Ohio Turnpike, Toll road, Amherst, OH 44001, USA'), -- chain
    (4334, 'Starbucks', '1381 Bellefontaine St, Wapakoneta, OH 45895, USA'), -- chain
    (4335, 'Starbucks', '5880 SOM Ctr Rd, Willoughby, OH 44094, USA'), -- chain
    (4336, 'Starbucks', '36575 Euclid Ave, Willoughby, OH 44094, USA'), -- chain
    (4337, 'Starbucks', '36195 Euclid Ave, Willoughby, OH 44094, USA'), -- chain
    (4338, 'Starbucks', '548 Clinton Ave, Washington Court House, OH 43160, USA'), -- chain
    (4339, 'Starbucks', '9712 Singletary Drive Streetsboro Commons, Streetsboro, OH 44241, USA'), -- chain
    (4340, 'Starbucks', '1144 OH-303, Streetsboro, OH 44241, USA'), -- chain
    (5017, 'Starbucks', '3703 B, Oak Ave, Fort Wainwright, AK 99703, USA'), -- chain
    (5018, 'Starbucks', '2685 Mill Bay Rd, Kodiak, AK 99615, USA'), -- chain
    (5019, 'Starbucks', '90 Sterling Hwy, Homer, AK 99603, USA'), -- chain
    (5020, 'Starbucks', '2417 Tongass Ave, Ketchikan, AK 99901, USA'), -- chain
    (5021, 'Starbucks', '43981 Sterling Hwy, Soldotna, AK 99669, USA'), -- chain
    (5022, 'Starbucks', '43843 Sterling Hwy, Soldotna, AK 99669, USA'), -- chain
    (5023, 'Starbucks in Safeway', '10576 Kenai Spur Hwy, Kenai, AK 99611, USA'), -- chain
    (5258, 'Starbucks', '550 NC-9, Black Mountain, NC 28711, USA'), -- chain
    (5300, 'Starbucks', '192 Asheville Hwy, Brevard, NC 28712, USA'), -- chain
    (5301, 'Starbucks', '710 N Broad St, Brevard, NC 28712, USA'), -- chain
    (5330, 'Starbucks', '2727 S Church St, Burlington, NC 27215, USA'), -- chain
    (5331, 'Starbucks', 'University Commons, 1447 University Dr, Burlington, NC 27215, USA'), -- chain
    (5332, 'Starbucks', 'Colonial Mall, 451 Huffman Mill Rd, Burlington, NC 27215, USA'), -- chain
    (5352, 'Starbucks', '101 W B McLean Dr, Cape Carteret, NC 28584, USA'), -- chain
    (5361, 'Starbucks', '400 Mill Creek Rd, Carthage, NC 28327, USA'), -- chain
    (5500, 'Starbucks', '818 E Cumberland St, Dunn, NC 28334, USA'), -- chain
    (5536, 'Starbucks', '109 Tanglewood Pkwy, Elizabeth City, NC 27909, USA'), -- chain
    (5548, 'Starbucks', '543 CC Camp Rd, Elkin, NC 28621, USA'), -- chain
    (5599, 'Starbucks', '182 Sparks Dr, Forest City, NC 28043, USA'), -- chain
    (5600, 'Starbucks', '765 S Church St, Forest City, NC 28043, USA'), -- chain
    (5745, 'Starbucks', '2209 N Main St, High Point, NC 27262, USA'), -- chain
    (5772, 'Starbucks', '2941 Town Center Dr, Hope Mills, NC 28348, USA'), -- chain
    (5773, 'Starbucks', '3063 N Main St, Hope Mills, NC 28348, USA'), -- chain
    (5786, 'Starbucks', '6610 Old Monroe Rd, Indian Trail, NC 28079, USA'), -- chain
    (5787, 'Starbucks Indian Trail', '13731 E Independence Blvd, Indian Trail, NC 28079, USA'), -- chain
    (5829, 'Starbucks', '1901 N Croatan Hwy, Kill Devil Hills, NC 27948, USA'), -- chain
    (5830, 'Starbucks', '1208 S Croatan Hwy, Kill Devil Hills, NC 27948, USA'), -- chain
    (5831, 'Starbucks', '2012 S Croatan Hwy, Kill Devil Hills, NC 27948, USA'), -- chain
    (5867, 'Starbucks Laurinburg', '892 McColl Road, Hwy 401 Bypass South, Laurinburg, NC 28352, USA'), -- chain
    (5875, 'Starbucks', '3572 Leland Town Center Dr, Leland, NC 28451, USA'), -- chain
    (5889, 'Starbucks', '346 Blowing Rock Blvd, Lenoir, NC 28645, USA'), -- chain
    (5905, 'Starbucks', '11602 Red Bridge Rd, Locust, NC 28097, USA'), -- chain
    (5938, 'Starbucks', '1351 Chestnut Ln, Matthews, NC 28104, USA'), -- chain
    (5990, 'Starbucks', 'Crystal Coast Plaza, 5000 US-70, Morehead City, NC 28557, USA'), -- chain
    (6014, 'Starbucks', '1996 Rockford St, Mt Airy, NC 27030, USA'), -- chain
    (6028, 'Starbucks', '2060 US-19, Murphy, NC 28906, USA'), -- chain
    (6062, 'Starbucks', '2032 Waterscape Wy, New Bern, NC 28562, USA'), -- chain
    (6063, 'Starbucks', '3182 Dr. M.L.K. Jr Blvd, New Bern, NC 28562, USA'), -- chain
    (6092, 'Starbucks', '1684 NC-68, Oak Ridge, NC 27310, USA'), -- chain
    (6120, 'Starbucks', '270 Ivey Ln, Pinehurst, NC 28374, USA'), -- chain
    (6121, 'Starbucks', '305 Ivey Ln, Pinehurst, NC 28374, USA'), -- chain
    (6201, 'Starbucks', '731 Sutter''s Creek Blvd, Rocky Mount, NC 27804, USA'), -- chain
    (6253, 'Starbucks', '131 Tucker Dr, Shelby, NC 28152, USA'), -- chain
    (6254, 'Starbucks', '1650 W Dixon Blvd, Shelby, NC 28152, USA'), -- chain
    (6255, 'Starbucks', '1114 E Dixon Blvd, Shelby, NC 28152, USA'), -- chain
    (6277, 'Starbucks', '305 Carolina Grn Pkwy, Southern Pines, NC 28387, USA'), -- chain
    (6285, 'Starbucks', '5597-A North Croatan Highway Marketplace at, Southern Shores, NC 27949, USA'), -- chain
    (6342, 'Starbucks', '390 Walmart Plaza, UNIT A, Sylva, NC 28779, USA'), -- chain
    (6398, 'Starbucks', '201 Barber Blvd, Waynesville, NC 28786, USA'), -- chain
    (6399, 'Starbucks Coffee', '1678 Brown Ave, Waynesville, NC 28786, USA'), -- chain
    (6407, 'Starbucks', '6008 Taylor Rd, Wendell, NC 27591, USA'), -- chain
    (6409, 'Starbucks', '6350 Weddington Rd, Wesley Chapel, NC 28104, USA'), -- chain
    (6421, 'Starbucks', '1211 N JK Powell Blvd, Whiteville, NC 28472, USA'), -- chain
    (6426, 'Starbucks', '6405 Burlington Rd, Whitsett, NC 27377, USA'), -- chain
    (6468, 'Starbucks', '5019 Raleigh Rd Pkwy W, Wilson, NC 27896, USA'), -- chain
    (6469, 'Starbucks', '3401 Raleigh Rd Pkwy W, Wilson, NC 27896, USA'), -- chain
    (6502, 'Starbucks', '4100 Humber Dr, Winterville, NC 28590, USA'), -- chain
    (6555, 'Starbucks', '890 W Williams Ave, Fallon, NV 89406, USA'), -- chain
    (6556, 'Starbucks', '101 Wendover Blvd, West Wendover, NV 89883, USA'), -- chain
    (7614, 'Starbucks', '12720 S Saginaw St, Grand Blanc, MI 48439, USA'), -- chain
    (7615, 'Starbucks', '3960 44th St SW, Grandville, MI 49418, USA'), -- chain
    (7616, 'Starbucks', '3130 44th St SW, Grandville, MI 49418, USA'), -- chain
    (7617, 'Starbucks', '590 S Lapeer Rd, Orion Twp, MI 48362, USA'), -- chain
    (7618, 'Starbucks', '426 N Beacon Blvd, Grand Haven, MI 49417, USA'), -- chain
    (7619, 'Starbucks', '8503 Davison Rd, Davison, MI 48423, USA'), -- chain
    (7620, 'Starbucks', '8610 34 Rd, Cadillac, MI 49601, USA'), -- chain
    (7621, 'Starbucks', '1411 S Main St, Eaton Rapids, MI 48827, USA'), -- chain
    (7622, 'Starbucks', '1277 M-36, Pinckney, MI 48169, USA'), -- chain
    (7623, 'Starbucks', '319 N Lincoln Rd, Escanaba, MI 49829, USA'), -- chain
    (7624, 'Starbucks', '1175 Allegan St, Plainwell, MI 49080, USA'), -- chain
    (7625, 'Starbucks', '1747 Benzie Hwy, Benzonia, MI 49616, USA'), -- chain
    (7626, 'Starbucks', '4528 E Ludington Ave US-10, Ludington, MI 49431, USA'), -- chain
    (7627, 'Starbucks', '312 S Huron Ave, Mackinaw City, MI 49701, USA'), -- chain
    (7628, 'Starbucks', '6677 Dixie Hwy, Independence Township, MI 48346, USA'), -- chain
    (7629, 'Starbucks', '430 N Lake St, Boyne City, MI 49712, USA'), -- chain
    (7630, 'Starbucks', '302 E Main St, Northville, MI 48167, USA'), -- chain
    (7631, 'Starbucks', '425 N Center St, Northville, MI 48167, USA'), -- chain
    (7632, 'Starbucks', '1221 Demille Rd, Lapeer, MI 48446, USA'), -- chain
    (7633, 'Starbucks', '116 N Whittaker St, New Buffalo, MI 49117, USA'), -- chain
    (7634, 'Starbucks', '17030 Kercheval Ave, Grosse Pointe, MI 48230, USA'), -- chain
    (7635, 'Starbucks', '720 S 11th St, Niles, MI 49120, USA'), -- chain
    (7636, 'Starbucks', '1341 Victories Ln, Petoskey, MI 49770, USA'), -- chain
    (7637, 'Starbucks', '4678 Red Arrow Hwy, Stevensville, MI 49127, USA'), -- chain
    (7638, 'Starbucks', '23555 Allen Rd, Woodhaven, MI 48183, USA'), -- chain
    (7639, 'Starbucks', '22850 Allen Rd, Woodhaven, MI 48183, USA'), -- chain
    (7640, 'Starbucks', '20861 Mack Ave, Grosse Pointe Woods, MI 48236, USA'), -- chain
    (7641, 'Starbucks', '805 Campus Dr, Big Rapids, MI 49307, USA'), -- chain
    (7642, 'Starbucks', '1125 M-32, Alpena, MI 49707, USA'), -- chain
    (7643, 'Starbucks', '17056 Fort St, Riverview, MI 48193, USA'), -- chain
    (7644, 'Starbucks', '4075 32nd Ave, Hudsonville, MI 49426, USA'), -- chain
    (7645, 'Starbucks', '6480 28th Ave, Hudsonville, MI 49426, USA'), -- chain
    (7646, 'Starbucks', '56151 M-51, Dowagiac, MI 49047, USA'), -- chain
    (7647, 'Starbucks', '2275 E Main St, Owosso, MI 48867, USA'), -- chain
    (7648, 'Starbucks', '151 W Grand River Ave, Williamston, MI 48895, USA'), -- chain
    (7649, 'Starbucks Coffee', '20645 Gibraltar Rd, Brownstown Township, MI 48183, USA'), -- chain
    (8206, 'Starbucks', '96 Maccorkle Ave SW, South Charleston, WV 25303, USA'), -- chain
    (8207, 'Starbucks', '200 Mount Dechantal Rd, Wheeling, WV 26003, USA'), -- chain
    (8208, 'Starbucks', '100 St Thomas Dr, Weirton, WV 26062, USA'), -- chain
    (8209, 'Starbucks', '207 Cabela Dr, Triadelphia, WV 26059, USA'), -- chain
    (8210, 'Starbucks', '3320 MacCorkle Ave SE, Charleston, WV 25304, USA'), -- chain
    (8211, 'Starbucks', '190 Flowing Springs Rd, Charles Town, WV 25414, USA'), -- chain
    (8212, 'Starbucks', '58 Somerset Blvd, Charles Town, WV 25414, USA'), -- chain
    (8213, 'Starbucks', '1100 Fledderjohn Rd, Charleston, WV 25314, USA'), -- chain
    (8214, 'Starbucks', '300 Cabela Dr, Valley Grove, WV 26060, USA'), -- chain
    (8215, 'Starbucks', '30 RHL Blvd, South Charleston, WV 25309, USA'), -- chain
    (8216, 'Starbucks', '2809 Mountaineer Blvd, Charleston, WV 25309, USA'), -- chain
    (8217, 'Starbucks', '112 Kanawha Blvd E, Charleston, WV 25301, USA'), -- chain
    (8218, 'Starbucks', '241 Emily Dr, Clarksburg, WV 26301, USA'), -- chain
    (8219, 'Starbucks', '23 Skidmore Ln, Sutton, WV 26601, USA'), -- chain
    (8220, 'Starbucks', '3572 Teays Valley Road, Hurricane, WV 25526, USA'), -- chain
    (8221, 'Starbucks', '301 Merchant Walk, Summersville, WV 26651, USA'), -- chain
    (8222, 'Starbucks', '308 Galleria Plaza, Beckley, WV 25801, USA'), -- chain
    (8691, 'Starbucks', '6519 Main St, Bonners Ferry, ID 83805, USA'), -- chain
    (8692, 'Starbucks', '4023 Yellowstone Ave #1, Chubbuck, ID 83202, USA'), -- chain
    (8693, 'Starbucks', '937 E Main St, Burley, ID 83318, USA'), -- chain
    (8694, 'Starbucks', '132 E Lake St, McCall, ID 83638, USA'), -- chain
    (8695, 'Starbucks', '911 N Main St, Hailey, ID 83333, USA'), -- chain
    (8696, 'Starbucks', '491 Sun Valley Rd, Ketchum, ID 83340, USA'), -- chain
    (8891, 'Starbucks', '23 University Dr, Presque Isle, ME 04769, USA'), -- chain
    (8928, 'Starbucks', 'Vineyard Plaza Shopping Center, 1075 Vine St, Healdsburg, CA 95448, USA'), -- chain
    (8930, 'Starbucks', 'Graham Plaza, 219 Mt Hermon Rd, Scotts Valley, CA 95066, USA'), -- chain
    (8934, 'Starbucks', 'Golden Cove Shopping Center, 31202 Palos Verdes Dr W, Rancho Palos Verdes, CA 90275, USA'), -- chain
    (8937, 'Starbucks', 'Stone Creek Village, 441 Canyon Del Rey Blvd, Del Rey Oaks, CA 93940, USA'), -- chain
    (8939, 'Starbucks', 'Coast Shopping Center, 501 5 Cities Dr, Pismo Beach, CA 93449, USA'), -- chain
    (8944, 'Starbucks', 'Strawflower Village Shopping Center, 80 Cabrillo Hwy N, Half Moon Bay, CA 94019, USA'), -- chain
    (8958, 'Starbucks', '27 N Main St STE A, Angels Camp, CA 95222, USA'), -- chain
    (8992, 'Starbucks', '1211 E Grand Ave, Arroyo Grande, CA 93420, USA'), -- chain
    (9025, 'Starbucks', '42140 Big Bear Blvd, Big Bear Lake, CA 92315, USA'), -- chain
    (9036, 'Starbucks', '235 E Hwy 246, Buellton, CA 93427, USA'), -- chain
    (9037, 'Starbucks', '222 E Hwy 246, Buellton, CA 93427, USA'), -- chain
    (9046, 'Starbucks', '13104 Santa Nella Blvd, CA-33, Gustine, CA 95322, USA'), -- chain
    (9051, 'Starbucks', '9678 California City Blvd, California City, CA 93505, USA'), -- chain
    (9054, 'Starbucks', '1166 Calimesa Blvd, Calimesa, CA 92320, USA'), -- chain
    (9055, 'Starbucks', '1032 Cherry Valley Blvd, Calimesa, CA 92320, USA'), -- chain
    (9085, 'Starbucks', '5436 Carpinteria Ave, Carpinteria, CA 93013, USA'), -- chain
    (9099, 'Starbucks', '120 E Robertson Blvd, Chowchilla, CA 93610, USA'), -- chain
    (9107, 'Starbucks', '15885 Dam Rd, Clearlake, CA 95422, USA'), -- chain
    (9108, 'Starbucks', '14922 Olympic Dr, Clearlake, CA 95422, USA'), -- chain
    (9116, 'Starbucks', '1198 S Cloverdale Blvd, Cloverdale, CA 95425, USA'), -- chain
    (9118, 'Starbucks', '113 W Polk St, Coalinga, CA 93210, USA'), -- chain
    (9119, 'Starbucks', '25246 W Dorris Ave, Coalinga, CA 93210, USA'), -- chain
    (9121, 'Starbucks', '990 Serramonte Blvd, Colma, CA 94014, USA'), -- chain
    (9122, 'Starbucks', '5001 Junipero Serra Blvd, Colma, CA 94014, USA'), -- chain
    (9123, 'Starbucks', '1241 E Washington St, Colton, CA 92324, USA'), -- chain
    (9124, 'Starbucks', '1181 S Mt Vernon Ave, Colton, CA 92324, USA'), -- chain
    (9140, 'Starbucks', '960 Orange Ave, Coronado, CA 92118, USA'), -- chain
    (9149, 'Starbucks', '137 Corte Madera Town Center, Corte Madera, CA 94925, USA'), -- chain
    (9155, 'Starbucks', '640 E Cotati Ave, Cotati, CA 94931, USA'), -- chain
    (9191, 'Starbucks', '815 Canyon Del Rey Blvd, Del Rey Oaks, CA 93940, USA'), -- chain
    (9220, 'Starbucks', '530 N Sepulveda Blvd, El Segundo, CA 90245, USA'), -- chain
    (9238, 'Starbucks', '1255 Lillian Ave, Escalon, CA 95320, USA'), -- chain
    (9258, 'Starbucks', '576 S Main St, Fort Bragg, CA 95437, USA'), -- chain
    (9274, 'Starbucks', '22220 Barton Rd, Grand Terrace, CA 92313, USA'), -- chain
    (9311, 'Starbucks', '12161 E Carson St, Hawaiian Gardens, CA 90716, USA'), -- chain
    (9326, 'Starbucks', '1115 Vine St, Healdsburg, CA 95448, USA'), -- chain
    (9344, 'Starbucks', '1303 Hermosa Ave, Hermosa Beach, CA 90254, USA'), -- chain
    (9359, 'Starbucks', '15716 Arrow Hwy, Irwindale, CA 91706, USA'), -- chain
    (9362, 'Starbucks', '11248 Old Ml Ln, Jackson, CA 95642, USA'), -- chain
    (9369, 'Starbucks', '14025 W Whitesbridge Ave, Kerman, CA 93630, USA'), -- chain
    (9375, 'Starbucks', '969 Sierra St, Kingsburg, CA 93631, USA'), -- chain
    (9376, 'Starbucks', '301 Sierra St, Kingsburg, CA 93631, USA'), -- chain
    (9383, 'Starbucks', '1800 W Whittier Blvd, La Habra, CA 90631, USA'), -- chain
    (9391, 'Starbucks', '5014 Orangethorpe Ave, La Palma, CA 90623, USA'), -- chain
    (9411, 'Starbucks', '1801 Larkspur Landing Cir, Larkspur, CA 94939, USA'), -- chain
    (9421, 'Starbucks', '25705 Barton Rd, Loma Linda, CA 92354, USA'), -- chain
    (9450, 'Starbucks', '6099 Horseshoe Bar Rd, Loomis, CA 95650, USA'), -- chain
    (9453, 'Starbucks', '3575 Katella Ave, Los Alamitos, CA 90720, USA'), -- chain
    (9457, 'Starbucks', '5252 Katella Ave, Los Alamitos, CA 90720, USA'), -- chain
    (9530, 'Starbucks', '30765 Pacific Coast Hwy, Malibu, CA 90265, USA'), -- chain
    (9533, 'Starbucks', '3900 Cross Creek Rd, Malibu, CA 90265, USA'), -- chain
    (9534, 'Starbucks', '23755 Malibu Rd W, Malibu, CA 90265, USA'), -- chain
    (9536, 'Starbucks', '24255 Pacific Coast Hwy, Malibu, CA 90263, USA'), -- chain
    (9537, 'Starbucks', '29211 Heathercliff Rd, Malibu, CA 90265, USA'), -- chain
    (9549, 'Starbucks', '481 Old Mammoth Rd, Mammoth Lakes, CA 93546, USA'), -- chain
    (9557, 'Starbucks', '2935 Main St, Mammoth Lakes, CA 93546, USA'), -- chain
    (9587, 'Starbucks', '110 Strawberry Village, Mill Valley, CA 94941, USA'), -- chain
    (9588, 'Starbucks', '800 Strawberry Village #205, Mill Valley, CA 94941, USA'), -- chain
    (9606, 'Starbucks', '1355 Moraga Way, Moraga, CA 94556, USA'), -- chain
    (9607, 'Starbucks', '470 Moraga Rd, Moraga, CA 94556, USA'), -- chain
    (9619, 'Starbucks', '730 Quintana Rd, Morro Bay, CA 93442, USA'), -- chain
    (9631, 'Starbucks', '301 W Lake St, Mt Shasta, CA 96067, USA'), -- chain
    (9672, 'Starbucks', '11534 N Ventura Ave, Ojai, CA 93023, USA'), -- chain
    (9679, 'Starbucks', '110 Frances Ln, Orland, CA 95963, USA'), -- chain
    (9691, 'Starbucks', '100 Country Club Gate Center, Pacific Grove, CA 93950, USA'), -- chain
    (9692, 'Starbucks', '1212 Forest Ave, Pacific Grove, CA 93950, USA'), -- chain
    (9715, 'Starbucks', '13640 Manning Ave, Parlier, CA 93648, USA'), -- chain
    (9730, 'Starbucks', '1315 Pinole Valley Rd, Pinole, CA 94564, USA'), -- chain
    (9732, 'Starbucks', '1540 Fitzgerald Dr, Pinole, CA 94564, USA'), -- chain
    (9733, 'Starbucks', '1400 Fitzgerald Dr, Pinole, CA 94564, USA'), -- chain
    (9767, 'Starbucks', '40101 Monterey Ave, Rancho Mirage, CA 92270, USA'), -- chain
    (9768, 'Starbucks', '42500 Bob Hope Dr, Rancho Mirage, CA 92270, USA'), -- chain
    (9778, 'Starbucks', '525 Adobe Rd, Red Bluff, CA 96080, USA'), -- chain
    (9782, 'Starbucks', '265 Antelope Blvd, Red Bluff, CA 96080, USA'), -- chain
    (9890, 'Starbucks', '2265 Huntington Dr, San Marino, CA 91108, USA'), -- chain
    (9934, 'Starbucks', '110 Donahue St, Sausalito, CA 94965, USA'), -- chain
    (9936, 'Starbucks', '180 Donahue St, Sausalito, CA 94965, USA'), -- chain
    (9939, 'Starbucks', '260 Mt Hermon Rd, Scotts Valley, CA 95066, USA'), -- chain
    (9956, 'Starbucks', '1 Kersting Ct, Sierra Madre, CA 91024, USA'), -- chain
    (9969, 'Starbucks', '691 Lomas Santa Fe Dr, Solana Beach, CA 92075, USA'), -- chain
    (10010, 'Starbucks', 'Shopping Center, South Main Plaza, 1058 S Main St, Red Bluff, CA 96080, USA'), -- chain
    (10037, 'Starbucks', '2970 Main St, Susanville, CA 96130, USA'), -- chain
    (10040, 'Starbucks', '2980 Main St, Susanville, CA 96130, USA'), -- chain
    (10049, 'Starbucks', '300 Tucker Rd, Tehachapi, CA 93561, USA'), -- chain
    (10051, 'Starbucks', '1007 Voyager Dr, Tehachapi, CA 93561, USA'), -- chain
    (10052, 'Starbucks', '775 Tucker Rd, Tehachapi, CA 93561, USA'), -- chain
    (10086, 'Starbucks', '11355 Deerfield Dr, Truckee, CA 96161, USA'), -- chain
    (10118, 'Starbucks', '1855 Shastina Dr, Weed, CA 96094, USA'), -- chain
    (10143, 'Starbucks', '845 S Main St, Willits, CA 95490, USA'), -- chain
    (10145, 'Starbucks', '788 S Main St, Willits, CA 95490, USA'), -- chain
    (10150, 'Starbucks', '505 N Humboldt Ave, Willows, CA 95988, USA'), -- chain
    (10158, 'Starbucks', '1805 Fort Jones Rd, Yreka, CA 96097, USA'), -- chain
    (10939, 'Starbucks', '1715 Lor Ray Dr, North Mankato, MN 56003, USA'), -- chain
    (10940, 'Starbucks', '975 Co Rd E East, Vadnais Heights, MN 55127, USA'), -- chain
    (10941, 'Starbucks', '1016 Hwy 96 E, Vadnais Heights, MN 55127, USA'), -- chain
    (10942, 'Starbucks', '5950 Nova Scotia Ave, Oak Park Heights, MN 55082, USA'), -- chain
    (10943, 'Starbucks', '5801 Neal Ave N, Oak Park Heights, MN 55082, USA'), -- chain
    (10944, 'Starbucks', '5980 Neal Ave N #800, Oak Park Heights, MN 55082, USA'), -- chain
    (10945, 'Starbucks', '8155 Hwy 65 NE, Spring Lake Park, MN 55432, USA'), -- chain
    (10946, 'Starbucks', '3505 Bottineau Blvd, Robbinsdale, MN 55422, USA'), -- chain
    (10947, 'Starbucks', '3503 Bottineau Blvd, Robbinsdale, MN 55422, USA'), -- chain
    (10948, 'Starbucks', '875 E Main St, Waconia, MN 55387, USA'), -- chain
    (10949, 'Starbucks', '10720 W 10th St, Waconia, MN 55387, USA'), -- chain
    (10950, 'Starbucks', '151 Tyler Rd N, Red Wing, MN 55066, USA'), -- chain
    (10951, 'Starbucks', '1315 Old W Main St, Red Wing, MN 55066, USA'), -- chain
    (10952, 'Starbucks', '1267 W Broadway Ave Suite 100, Forest Lake, MN 55025, USA'), -- chain
    (10953, 'Starbucks', '2100 Paul Bunyan Dr NW, Bemidji, MN 56601, USA'), -- chain
    (10954, 'Starbucks', '1811 Paul Bunyan Dr NW, Bemidji, MN 56601, USA'), -- chain
    (10955, 'Starbucks', '124 2nd Street South Marketplace of, Waite Park, MN 56387, USA'), -- chain
    (10956, 'Starbucks', '5330 St Croix Trail, North Branch, MN 55056, USA'), -- chain
    (10957, 'Starbucks', '4404 MN-29, Alexandria, MN 56308, USA'), -- chain
    (10958, 'Starbucks', '440 Water St, Excelsior, MN 55331, USA'), -- chain
    (10959, 'Starbucks', '217 Washington St NE, Brainerd, MN 56401, USA'), -- chain
    (10960, 'Starbucks', '1872 Madison Ave, Mankato, MN 56001, USA'), -- chain
    (10961, 'Starbucks Coffee', '1002 Old Minnesota Ave, St Peter, MN 56082, USA'), -- chain
    (11490, 'Starbucks', '20 W Main St, Ansonia, CT 06401, USA'), -- chain
    (11544, 'Starbucks', 'Big Y Plaza, 985 A Poquonnock Rd, Groton, CT 06340, USA'), -- chain
    (11545, 'Starbucks', '220 12, Groton, CT 06340, USA'), -- chain
    (11851, 'Starbucks', '11 Andrews Rd, Somersworth, NH 03878, USA'), -- chain
    (12499, 'Starbucks', '123 US-25W, Dandridge, TN 37725, USA'), -- chain
    (12500, 'Starbucks', '4726 Traders Way, Thompson''s Station, TN 37179, USA'), -- chain
    (12501, 'Starbucks', '741 Dolly Parton Pkwy, Sevierville, TN 37862, USA'), -- chain
    (12502, 'Starbucks', '1645 Parkway, Sevierville, TN 37862, USA'), -- chain
    (12503, 'Starbucks', '7202 Maynardville Hwy, Knoxville, TN 37918, USA'), -- chain
    (12504, 'Starbucks', '1200 W Jackson Blvd, Jonesborough, TN 37659, USA'), -- chain
    (12505, 'Starbucks', '2491 US-441, Pigeon Forge, TN 37863, USA'), -- chain
    (12506, 'Starbucks', '3064 Teaster Ln, Pigeon Forge, TN 37863, USA'), -- chain
    (12507, 'Starbucks', '220 Wears Valley Rd, Pigeon Forge, TN 37863, USA'), -- chain
    (12508, 'Starbucks', '6053 Artesian Circle Lee Hwy &, I-75, Collegedale, TN 37363, USA'), -- chain
    (12509, 'Starbucks', '1667 Ooltewah Ringgold Rd, Ooltewah, TN 37363, USA'), -- chain
    (12510, 'Starbucks', '1756 Ooltewah Ringgold Rd, Ooltewah, TN 37363, USA'), -- chain
    (12511, 'Starbucks', '265 Highland Square, Crossville, TN 38555, USA'), -- chain
    (12512, 'Starbucks', '2008 Genesis Rd, Crossville, TN 38555, USA'), -- chain
    (12513, 'Starbucks', '1820 Roane State Hwy, Harriman, TN 37748, USA'), -- chain
    (12514, 'Starbucks', '5287 Airline Road, Airline and, Milton Wilson Dr, Arlington, TN 38002, USA'), -- chain
    (12515, 'Starbucks', '903 Parkway #101, Gatlinburg, TN 37738, USA'), -- chain
    (12516, 'Starbucks', '1219 East Pkwy Hwy 321, Gatlinburg, TN 37738, USA'), -- chain
    (12517, 'Starbucks', '1180 West Ave, Crossville, TN 38557, USA'), -- chain
    (12518, 'Starbucks', '8507 TN-3, Millington, TN 38053, USA'), -- chain
    (12519, 'Starbucks', '514 Main St, Kimball, TN 37347, USA'), -- chain
    (12520, 'Starbucks', '1305 Oak Ridge Turnpike, Oak Ridge, TN 37830, USA'), -- chain
    (12521, 'Starbucks', '330 Cartwright Street, Long Hollow Pike I65, Goodlettsville, TN 37072, USA'), -- chain
    (12522, 'Starbucks', '123 Northcreek Blvd, Goodlettsville, TN 37072, USA'), -- chain
    (12523, 'Starbucks', '870 US-321, Lenoir City, TN 37771, USA'), -- chain
    (12524, 'Starbucks', '2845 E Andrew Johnson Hwy, Greeneville, TN 37745, USA'), -- chain
    (12525, 'Starbucks', '4344 Maynardville Hwy, Maynardville, TN 37807, USA'), -- chain
    (12526, 'Starbucks', '2055 Airport Hwy, Alcoa, TN 37701, USA'), -- chain
    (12527, 'Starbucks', '646 Winfield Dunn Pkwy, Sevierville, TN 37876, USA'), -- chain
    (12528, 'Starbucks in Ingles Market', '768 W Elk Ave, Elizabethton, TN 37643, USA'), -- chain
    (12967, 'Starbucks', '2100n Broadway Ave, Yankton, SD 57078, USA'), -- chain
    (12968, 'Starbucks', '555 Lower Main St, Deadwood, SD 57732, USA'), -- chain
    (12969, 'Starbucks', '1606 North Ave, Spearfish, SD 57783, USA'), -- chain
    (12970, 'Starbucks Coffee', '525 W Cherry St, Vermillion, SD 57069, USA'), -- chain
    (13497, 'Starbucks', '1108 Ross Clark Cir, Dothan, AL 36301, USA'), -- chain
    (13498, 'Starbucks', '2218 Ross Clark Cir, Dothan, AL 36301, USA'), -- chain
    (13499, 'Starbucks', '1045 Ross Clark Cir, Dothan, AL 36301, USA'), -- chain
    (13500, 'Starbucks', '104 Rock Bridge Rd, Dothan, AL 36303, USA'), -- chain
    (13501, 'Starbucks', '4601 Montgomery Hwy, Dothan, AL 36303, USA'), -- chain
    (13502, 'Starbucks', '3820 Gulf Shores Pkwy, Gulf Shores, AL 36542, USA'), -- chain
    (13503, 'Starbucks', '11460 US-431, Guntersville, AL 35976, USA'), -- chain
    (13504, 'Starbucks', '811 S Eufaula Ave, Eufaula, AL 36027, USA'), -- chain
    (13505, 'Starbucks', '87 McS Blvd, Sylacauga, AL 35150, USA'), -- chain
    (13506, 'Starbucks', '1879 Cherokee Ave SW, Cullman, AL 35055, USA'), -- chain
    (13507, 'Starbucks', 'Daleville, AL 36322, USA'), -- chain
    (13508, 'Starbucks', '2401 Dr John Haynes Dr Ste. E, Pell City, AL 35125, USA'), -- chain
    (13509, 'Starbucks', '155 Poarch Rd, Atmore, AL 36502, USA'), -- chain
    (13510, 'Starbucks', '2588 Cobbs Ford Rd, Prattville, AL 36066, USA'), -- chain
    (13511, 'Starbucks', '3489 Lowery Pkwy, Fultondale, AL 35068, USA'), -- chain
    (13512, 'Starbucks', '659 Fieldstown Rd, Gardendale, AL 35071, USA'), -- chain
    (13513, 'Starbucks', '2105 7th St S, Clanton, AL 35045, USA'), -- chain
    (13514, 'Starbucks', '1724 W Grand Ave, Gadsden, AL 35904, USA'), -- chain
    (13515, 'Starbucks', '720 Gilbert Ferry Rd SE, Gadsden, AL 35904, USA'), -- chain
    (13516, 'Starbucks', '23029 John T Reid Pkwy, Scottsboro, AL 35769, USA'), -- chain
    (13517, 'Starbucks', '30350 AL-181, Spanish Fort, AL 36527, USA'), -- chain
    (13518, 'Starbucks', '6830 Jubilee Pkwy, Daphne, AL 36526, USA'), -- chain
    (13519, 'Starbucks', '1402 Industrial Pkwy, Saraland, AL 36571, USA'), -- chain
    (13520, 'Starbucks', '25773 Perdido Beach Blvd, Orange Beach, AL 36561, USA'), -- chain
    (14033, 'Starbucks', '500 E 3rd St, Alliance, NE 69301, USA'), -- chain
    (14034, 'Starbucks', '8351 Barmettler Dr, La Vista, NE 68128, USA'), -- chain
    (14035, 'Starbucks', '1401 Frontage Rd, Scottsbluff, NE 69361, USA'), -- chain
    (14036, 'Starbucks', '601 Broadway, Scottsbluff, NE 69361, USA'), -- chain
    (14037, 'Starbucks', '3010 23rd St, Columbus, NE 68601, USA'), -- chain
    (14038, 'Starbucks', '16418 Westside Dr, Plattsmouth, NE 68048, USA'), -- chain
    (14039, 'Starbucks', '840 E 23rd St, Fremont, NE 68025, USA'), -- chain
    (14040, 'Starbucks', '1220 E 23rd St #100, Fremont, NE 68025, USA'), -- chain
    (14041, 'Starbucks', '2501 Cornhusker Dr, South Sioux City, NE 68776, USA'), -- chain
    (15148, 'Starbucks', '885 S Rochester St, Mukwonago, WI 53149, USA'), -- chain
    (15149, 'Starbucks', '1080 W Fulton St, Waupaca, WI 54981, USA'), -- chain
    (15150, 'Starbucks', '4085 WI-28, Sheboygan Falls, WI 53085, USA'), -- chain
    (15151, 'Starbucks', '685 W Main St, Lake Geneva, WI 53147, USA'), -- chain
    (15152, 'Starbucks', '2806 Schofield Ave, Schofield, WI 54476, USA'), -- chain
    (15153, 'Starbucks', '2707 Schofield Ave, Schofield, WI 54476, USA'), -- chain
    (15154, 'Starbucks', '1830 8th St S, Wisconsin Rapids, WI 54494, USA'), -- chain
    (15155, 'Starbucks', '1885 County Rd ES, East Troy, WI 53120, USA'), -- chain
    (15156, 'Starbucks', '410 S Ashland Ave, Sturgeon Bay, WI 54235, USA'), -- chain
    (15157, 'Starbucks', '309 E Kort St, Rothschild, WI 54474, USA'), -- chain
    (15158, 'Starbucks', '10204 Park Plaza, Rothschild, WI 54474, USA'), -- chain
    (15159, 'Starbucks', '1601 Progressive Pkwy, Platteville, WI 53818, USA'), -- chain
    (15160, 'Starbucks', '383 W Brown Deer Rd, Fox Point, WI 53217, USA'), -- chain
    (15161, 'Starbucks', '2340 Roosevelt Rd, Marinette, WI 54143, USA'), -- chain
    (15162, 'Starbucks', '708 N Main St, River Falls, WI 54022, USA'), -- chain
    (15163, 'Starbucks', 'n65w24950 Main St, Sussex, WI 53089, USA'), -- chain
    (15164, 'Starbucks', '302 E Silver Spring Dr, Whitefish Bay, WI 53217, USA'), -- chain
    (15165, 'Starbucks', '1440 Capitol Dr, Pewaukee, WI 53072, USA'), -- chain
    (15166, 'Starbucks', '5199 S 76th St, Greendale, WI 53129, USA'), -- chain
    (15167, 'Starbucks', '75 Gasser Rd, Lake Delton, WI 53940, USA'), -- chain
    (15168, 'Starbucks', '320 State Hwy 13, Wisconsin Dells, WI 53965, USA'), -- chain
    (15169, 'Starbucks', '1680 S Appleton Rd, Menasha, WI 54952, USA'), -- chain
    (15170, 'Starbucks', '795 WI-136, Baraboo, WI 53913, USA'), -- chain
    (15171, 'Starbucks', 'W61N306 Washington Ave # 104, Cedarburg, WI 53012, USA'), -- chain
    (15172, 'Starbucks', '2430 S Oneida St, Ashwaubenon, WI 54304, USA'), -- chain
    (15173, 'Starbucks', '1001 Cormier Rd, Ashwaubenon, WI 54304, USA'), -- chain
    (15174, 'Starbucks', '1250 W Sunset Dr, Waukesha, WI 53189, USA'), -- chain
    (15175, 'Starbucks', '21755 Longview Dr, Waukesha, WI 53186, USA'), -- chain
    (15176, 'Starbucks', '2000 Freedom Rd, Little Chute, WI 54140, USA'), -- chain
    (15177, 'Starbucks', '1360A Pabst Farms Cir, Oconomowoc, WI 53066, USA'), -- chain
    (15178, 'Starbucks', '13330 Washington Ave, Mt Pleasant, WI 53177, USA'), -- chain
    (15179, 'Starbucks', '1431 N Broadway St, Menomonie, WI 54751, USA'), -- chain
    (15180, 'Starbucks', '281 N Edwards Blvd, Lake Geneva, WI 53147, USA'), -- chain
    (15181, 'Starbucks', '660 N Edwards Blvd, Lake Geneva, WI 53147, USA'), -- chain
    (15182, 'Starbucks', '120 Crossroads Dr, Plover, WI 54467, USA'), -- chain
    (15183, 'Starbucks', '297 Eisenhower Pkwy, Rhinelander, WI 54501, USA'), -- chain
    (15184, 'Starbucks', '2401 Coulee Rd, Hudson, WI 54016, USA'), -- chain
    (15185, 'Starbucks', '1001 Pearson Dr, Hudson, WI 54016, USA'), -- chain
    (15186, 'Starbucks', '224 Buan St, Tomah, WI 54660, USA'), -- chain
    (15424, 'UWSP Common Ground Cafe - Starbucks', '2101 4th Ave, Stevens Point, WI 54481, USA'), -- chain
    (16231, 'Roberts Café - Starbucks', '1100 SE 2nd St, Cochran, GA 31014, USA'), -- chain
    (16294, 'Starbucks', '1400 Patten Rd, Lookout Mountain, GA 30750, USA'), -- chain
    (16295, 'Starbucks', 'Battlefield and Kellerhals, 3008 Battlefield Pkwy, Fort Oglethorpe, GA 30742, USA'), -- chain
    (16296, 'Starbucks', '5865 Spout Springs Rd, Flowery Branch, GA 30542, USA'), -- chain
    (16297, 'Starbucks', '1211 16th Ave E, Cordele, GA 31015, USA'), -- chain
    (16298, 'Starbucks', '2109 E 1st St, Vidalia, GA 30474, USA'), -- chain
    (16299, 'Starbucks', '903 Elbert St, Elberton, GA 30635, USA'), -- chain
    (16300, 'Starbucks', '53 Exchange St, Richmond Hill, GA 31324, USA'), -- chain
    (16301, 'Starbucks', '199 E Louise St, Clarkesville, GA 30523, USA'), -- chain
    (16302, 'Starbucks', '3707 Mundy Mill Rd, Oakwood, GA 30566, USA'), -- chain
    (16303, 'Starbucks', '1758 Washington Rd, Thomson, GA 30824, USA'), -- chain
    (16304, 'Starbucks', '2400 N Columbia St, Milledgeville, GA 31061, USA'), -- chain
    (16305, 'Starbucks', '2809 N Columbia St, Milledgeville, GA 31061, USA'), -- chain
    (16306, 'Starbucks', '341 Northside Drive West, Statesboro, GA 30458, USA'), -- chain
    (16307, 'Starbucks', '378 Marketplace Pkwy, Dawsonville, GA 30534, USA'), -- chain
    (16308, 'Starbucks', '3380 Buford Dr Suite 300, Buford, GA 30519, USA'), -- chain
    (16309, 'Starbucks', '2925 Buford Dr Suite 620, Buford, GA 30519, USA'), -- chain
    (16310, 'Starbucks', '505 Dacula Rd, Dacula, GA 30019, USA'), -- chain
    (16311, 'Starbucks', '485 Dacula Rd, Dacula, GA 30019, USA'), -- chain
    (16312, 'Starbucks', '1000 E Franklin St, Hartwell, GA 30643, USA'), -- chain
    (16313, 'Starbucks', '20 E Franklin St, Hartwell, GA 30643, USA'), -- chain
    (16314, 'Starbucks', '4920 Bill Gardner Pkwy, Locust Grove, GA 30248, USA'), -- chain
    (16315, 'Starbucks', '4837 Bill Gardner Pkwy, Locust Grove, GA 30248, USA'), -- chain
    (16316, 'Starbucks', '700 Carrollton Villa Rica Highway, GA-61, Villa Rica, GA 30180, USA'), -- chain
    (16317, 'Starbucks', '110 S Chestatee St, Dahlonega, GA 30533, USA'), -- chain
    (16318, 'Starbucks', '1305 St Augustine Rd, Valdosta, GA 31601, USA'), -- chain
    (16319, 'Starbucks', '916 Loganville Hwy, Bethlehem, GA 30620, USA'), -- chain
    (16320, 'Starbucks', '4910 Jimmy Lee Smith Pkwy, Hiram, GA 30141, USA'), -- chain
    (16321, 'Starbucks', '5220 Jimmy Lee Smith Pkwy, Hiram, GA 30141, USA'), -- chain
    (16322, 'Starbucks', '14461 GA-17, Lavonia, GA 30553, USA'), -- chain
    (16323, 'Starbucks', '4743 Atlanta Hwy, Loganville, GA 30052, USA'), -- chain
    (16324, 'Starbucks', '4270 Athens Hwy, Loganville, GA 30052, USA'), -- chain
    (16325, 'Starbucks', '5748 Old Winder Hwy, Braselton, GA 30517, USA'), -- chain
    (16326, 'Starbucks', '849 W Oglethorpe Hwy #110, Hinesville, GA 31313, USA'), -- chain
    (16327, 'Starbucks', '5385 Campbellton Fairburn Rd, Fairburn, GA 30213, USA'), -- chain
    (16328, 'Starbucks', '7920 Senoia Rd, Fairburn, GA 30213, USA'), -- chain
    (16329, 'Starbucks', '222 Meridian Dr, Grovetown, GA 30813, USA'), -- chain
    (16330, 'Starbucks', '43B Hwy 515 W, Blairsville, GA 30512, USA'), -- chain
    (16331, 'Starbucks', '7026 Ruffie Wy, Midland, GA 31820, USA'), -- chain
    (16332, 'Starbucks', '1204 US-82, Tifton, GA 31793, USA'), -- chain
    (16333, 'Starbucks', '730 N Church St, Thomaston, GA 30286, USA'), -- chain
    (16334, 'Starbucks', '216 Carpenters Cove Ln, Cornelia, GA 30531, USA'), -- chain
    (16335, 'Starbucks', '1604 US-441, Cornelia, GA 30531, USA'), -- chain
    (16336, 'Starbucks', '94 N Main St, Hiawassee, GA 30546, USA'), -- chain
    (16337, 'Starbucks', '1025 East-West Connector #510, Austell, GA 30106, USA'), -- chain
    (16338, 'Starbucks', '879 Joe Frank Harris Pkwy SE, Cartersville, GA 30120, USA'), -- chain
    (16339, 'Starbucks', '605 E Main St, Cartersville, GA 30121, USA'), -- chain
    (16340, 'Starbucks', '511 N Veterans Pkwy, Moultrie, GA 31788, USA'), -- chain
    (16341, 'Starbucks', '60 Highland Crossing S, East Ellijay, GA 30540, USA'), -- chain
    (16342, 'Starbucks', '100 Old Orchard Square, East Ellijay, GA 30540, USA'), -- chain
    (16343, 'Starbucks', '429 S Columbia Ave, Rincon, GA 31326, USA'), -- chain
    (16344, 'Starbucks', '1606 Memorial Dr, Waycross, GA 31501, USA'), -- chain
    (16345, 'Starbucks', '1908 Memorial Dr, Waycross, GA 31501, USA'), -- chain
    (16346, 'Starbucks', '1112 Big A Rd, Toccoa, GA 30577, USA'), -- chain
    (17233, 'Sisters Cafe at Manchester University (WPS Starbucks)', '604 E College Ave, North Manchester, IN 46962, USA'), -- chain
    (17249, 'Starbucks', '3900 E Bristol St, Elkhart, IN 46514, USA'), -- chain
    (17250, 'Starbucks', '2 E Washington St, Greencastle, IN 46135, USA'), -- chain
    (17251, 'Starbucks', '6321 Crawfordsville Rd, Speedway, IN 46224, USA'), -- chain
    (17252, 'Starbucks', '15251 W Sater St, Daleville, IN 47334, USA'), -- chain
    (17253, 'Starbucks', '6939 W Broadway, McCordsville, IN 46055, USA'), -- chain
    (17254, 'Starbucks', 'South Pointe Crossing, 4900 S US Hwy 41, Terre Haute, IN 47802, USA'), -- chain
    (17255, 'Starbucks', '871 Joliet St, Dyer, IN 46311, USA'), -- chain
    (17256, 'Starbucks', '805 Joliet St, Dyer, IN 46311, USA'), -- chain
    (17257, 'Starbucks', '1502 S Washington St, Crawfordsville, IN 47933, USA'), -- chain
    (17258, 'Starbucks', '4970 Beaner Blvd, Gas City, IN 46933, USA'), -- chain
    (17259, 'Starbucks', '4235 Scatterfield Rd, Anderson, IN 46013, USA'), -- chain
    (17260, 'Starbucks', '1845 Scatterfield Rd, Anderson, IN 46012, USA'), -- chain
    (17261, 'Starbucks', '381 Indian Boundary Rd, Chesterton, IN 46304, USA'), -- chain
    (17262, 'Starbucks', '747 Indian Boundary Rd, Chesterton, IN 46304, USA'), -- chain
    (17263, 'Starbucks', '242 N Oakland Ave, Nappanee, IN 46550, USA'), -- chain
    (17264, 'Starbucks', '7755 State St, Newburgh, IN 47630, USA'), -- chain
    (17265, 'Starbucks', '9919 Pointe View Dr, Newburgh, IN 47630, USA'), -- chain
    (17266, 'Starbucks', '3420 E Market St, Logansport, IN 46947, USA'), -- chain
    (17665, 'Starbucks', '11464 Olive Blvd, Creve Coeur, MO 63141, USA'), -- chain
    (17666, 'Starbucks', '11481 Olive Blvd, Creve Coeur, MO 63141, USA'), -- chain
    (17720, 'Starbucks', '901 Valley Creek Dr, Farmington, MO 63640, USA'), -- chain
    (17727, 'Starbucks', '1003 W Gannon Dr, Festus, MO 63028, USA'), -- chain
    (17755, 'Starbucks', '1140 NW Buckner Tarsney Rd, Grain Valley, MO 64029, USA'), -- chain
    (17756, 'Starbucks at Price Chopper', '1191 NE Mcquerry Rd, Grain Valley, MO 64029, USA'), -- chain
    (17786, 'Starbucks', '1703 N, 1703 Rte 291, Harrisonville, MO 64701, USA'), -- chain
    (17861, 'Starbucks', '3324 S Rangeline Rd, Joplin, MO 64804, USA'), -- chain
    (17942, 'Starbucks', '500 N Baltimore St, Kirksville, MO 63501, USA'), -- chain
    (17964, 'Starbucks', '6319 Ronald Reagan Dr, Lake St Louis, MO 63367, USA'), -- chain
    (18045, 'Starbucks of Marshfield', '759 W Washington St, Marshfield, MO 65706, USA'), -- chain
    (18065, 'Starbucks', '2150 E Cleveland Ave, Monett, MO 65708, USA'), -- chain
    (18123, 'Starbucks', '3815 Hwy 54, Osage Beach, MO 65065, USA'), -- chain
    (18124, 'Starbucks', '3880 Hwy D, Osage Beach, MO 65065, USA'), -- chain
    (18125, 'Starbucks', '929 Hwy D, Osage Beach, MO 65065, USA'), -- chain
    (18176, 'Starbucks', '2600 Ensign Hill Dr, Platte City, MO 64079, USA'), -- chain
    (18193, 'Starbucks', '1337 N Westwood Blvd, Poplar Bluff, MO 63901, USA'), -- chain
    (18243, 'Starbucks', '1900 N Bishop Ave, Rolla, MO 65401, USA'), -- chain
    (18293, 'Starbucks', '995 NW Plz Dr, St Ann, MO 63074, USA'), -- chain
    (18333, 'Starbucks', '322 State Hwy Z, St Robert, MO 65584, USA'), -- chain
    (18418, 'Starbucks', '797 Eagle Ct, Sullivan, MO 63080, USA'), -- chain
    (18461, 'Starbucks', '800 N Maguire St, Warrensburg, MO 64093, USA'), -- chain
    (18462, 'Starbucks', '114 W South St Suite 115, Warrensburg, MO 64093, USA'), -- chain
    (18463, 'Starbucks', '511 S Holden St, Warrensburg, MO 64093, USA'), -- chain
    (18474, 'Starbucks', '1901 Rabbit Trail Dr, Washington, MO 63090, USA'), -- chain
    (18483, 'Starbucks', '300 Ichord Ave, Waynesville, MO 65583, USA'), -- chain
    (18493, 'Starbucks', '1400 South Madison Street, Madison and, 14th St, Webb City, MO 64870, USA'), -- chain
    (18514, 'Starbucks', '1100 N Kentucky Ave, West Plains, MO 65775, USA'), -- chain
    (19488, 'Flatz (We Proudly Serve Starbucks)', '250 University Ave, California, PA 15419, USA'), -- chain
    (19940, 'Logan Square Starbucks', '6542 Lower York Road, Logan Square, New Hope, PA 18938, USA'), -- chain
    (20507, 'Starbucks', '1028 Freeport Rd, Pittsburgh, PA 15238, USA'), -- chain
    (20508, 'Starbucks', '4A E Bridge St, New Hope, PA 18938, USA'), -- chain
    (20509, 'Starbucks', '2825 Freeport Rd, Pittsburgh, PA 15238, USA'), -- chain
    (20510, 'Starbucks', '2044 Springwood Rd, York, PA 17403, USA'), -- chain
    (20511, 'Starbucks', 'Trainers Corner Shopping Center, 262 N West End Blvd, Quakertown, PA 18951, USA'), -- chain
    (20512, 'Starbucks', '270 West Bridge St, West Homestead, PA 15120, USA'), -- chain
    (20513, 'Starbucks', '360 E Waterfront Dr, Homestead, PA 15120, USA'), -- chain
    (20514, 'Starbucks', '514 University Ave, Selinsgrove, PA 17870, USA'), -- chain
    (20515, 'Starbucks', '746 Old York Rd, Jenkintown, PA 19046, USA'), -- chain
    (20516, 'Starbucks', '271 Dekalb Pike, North Wales, PA 19454, USA'), -- chain
    (20517, 'Starbucks', '921 Magill Dr, Irwin, PA 15642, USA'), -- chain
    (20518, 'Starbucks', '8931 Lincoln Hwy Rte 30, Irwin, PA 15642, USA'), -- chain
    (20519, 'Starbucks', '1033 N Ctr Ave, Somerset, PA 15501, USA'), -- chain
    (20520, 'Starbucks', '4816 Edgmont Ave, Brookhaven, PA 19015, USA'), -- chain
    (20521, 'Starbucks', '1241 Blakeslee Blvd Dr E, Lehighton, PA 18235, USA'), -- chain
    (20522, 'Starbucks', '18461 Smock Hwy, Meadville, PA 16335, USA'), -- chain
    (20523, 'Starbucks', '200 Tarentum Bridge Rd, New Kensington, PA 15068, USA'), -- chain
    (20524, 'Starbucks', '911 Heritage Dr, Elverson, PA 19520, USA'), -- chain
    (20525, 'Starbucks', '244 Hardwood Dr, Lewisburg, PA 17837, USA'), -- chain
    (20526, 'Starbucks', '7431 Westbranch Hwy, Lewisburg, PA 17837, USA'), -- chain
    (20527, 'Starbucks', '235 Hampton Ave, Punxsutawney, PA 15767, USA'), -- chain
    (20528, 'Starbucks', '830 N U.S. 15, Dillsburg, PA 17019, USA'), -- chain
    (20529, 'Starbucks', '10 College Ave Suite 1, Factoryville, PA 18419, USA'), -- chain
    (20530, 'Starbucks', '1140 Commerce Blvd, Dickson City, PA 18519, USA'), -- chain
    (20531, 'Starbucks', '1152 Commerce Blvd, Dickson City, PA 18519, USA'), -- chain
    (20532, 'Starbucks', '1717 Lebanon Church Rd, West Mifflin, PA 15236, USA'), -- chain
    (20533, 'Starbucks', '1450 Kenneth Rd, York, PA 17408, USA'), -- chain
    (20534, 'Starbucks', '303 Arsenal Rd, York, PA 17402, USA'), -- chain
    (20535, 'Starbucks', '206 Seven Fields Blvd, Seven Fields, PA 16046, USA'), -- chain
    (20536, 'Starbucks', '596 3rd St, Beaver, PA 15009, USA'), -- chain
    (20537, 'Starbucks', '503 Commons Dr P, Oxford, PA 19363, USA'), -- chain
    (20538, 'Starbucks', 'Pennsylvania Turnpike Toll road Btween exits 11&12, Westbound, 1152 Shed Rd, Bedford, PA 15522, USA'), -- chain
    (20539, 'Starbucks', '840 E Main St, Ephrata, PA 17522, USA'), -- chain
    (20540, 'Starbucks', '1278 S Market St, Elizabethtown, PA 17022, USA'), -- chain
    (20541, 'Starbucks', '501 E Baltimore Ave, Media, PA 19063, USA'), -- chain
    (20542, 'Starbucks', '100 Hazel Ln, Sewickley, PA 15143, USA'), -- chain
    (20543, 'Starbucks', '425 Beaver St, Sewickley, PA 15143, USA'), -- chain
    (20544, 'Starbucks', '25 Main St, Hellertown, PA 18055, USA'), -- chain
    (20545, 'Starbucks', '260 Cumberland Pkwy, Mechanicsburg, PA 17055, USA'), -- chain
    (20546, 'Starbucks', '455 Carnegie Blvd, Malvern, PA 19355, USA'), -- chain
    (20547, 'Starbucks', '260 Old Morehall Rd, Malvern, PA 19355, USA'), -- chain
    (20548, 'Starbucks', '3342 E State St, Hermitage, PA 16148, USA'), -- chain
    (20549, 'Starbucks', '2079 E State St, Hermitage, PA 16148, USA'), -- chain
    (20550, 'Starbucks', '879 E Baltimore Pike, Kennett Square, PA 19348, USA'), -- chain
    (20551, 'Starbucks', '2610 Pleasant Valley Rd, York, PA 17402, USA'), -- chain
    (20552, 'Starbucks', '212 Park Hills Plaza, Altoona, PA 16602, USA'), -- chain
    (20553, 'Starbucks', '113 Woodbine St, Hazleton, PA 18202, USA'), -- chain
    (20554, 'Starbucks', '275 Pauline Dr, York, PA 17402, USA'), -- chain
    (20555, 'Starbucks', '2685 S Queen St, York, PA 17402, USA'), -- chain
    (20556, 'Starbucks', '325 W Freedom Ave, Burnham, PA 17009, USA'), -- chain
    (20557, 'Starbucks', '51 Erford Rd, Camp Hill, PA 17011, USA'), -- chain
    (20558, 'Starbucks', '1106 Carlisle Rd, Camp Hill, PA 17011, USA'), -- chain
    (20559, 'Starbucks', '1131 Northern Blvd, Clarks Summit, PA 18411, USA'), -- chain
    (20560, 'Starbucks', '760 W Main St, PA-113, Souderton, PA 18964, USA'), -- chain
    (20561, 'Starbucks', 'Shoppes at Rostraver, 128 Pricedale Rd, Belle Vernon, PA 15012, USA'), -- chain
    (20562, 'Starbucks', '1275 York Road Peebles Plaza, Gettysburg, PA 17325, USA'), -- chain
    (20563, 'Starbucks', '118 Wagner Rd, Monaca, PA 15061, USA'), -- chain
    (20564, 'Starbucks', '87 Wagner Rd, Monaca, PA 15061, USA'), -- chain
    (20565, 'Starbucks', '690 E Main St, Waynesboro, PA 17268, USA'), -- chain
    (20566, 'Starbucks', '100 Diamond Wy, Royersford, PA 19468, USA'), -- chain
    (20567, 'Starbucks', '33 W Ridge Pike, Royersford, PA 19468, USA'), -- chain
    (20568, 'Starbucks', '3007 Washington Pike, Bridgeville, PA 15017, USA'), -- chain
    (20569, 'Starbucks', '1031 Washington Pike, Bridgeville, PA 15017, USA'), -- chain
    (20570, 'Starbucks', '1597 Washington Pike, Collier Town Square Dr, Bridgeville, PA 15017, USA'), -- chain
    (20571, 'Starbucks', '256 Danner Rd, Jim Thorpe, PA 18229, USA'), -- chain
    (20572, 'Starbucks', '1232 Keystone Industrial Park Rd, Dunmore, PA 18512, USA'), -- chain
    (20573, 'Starbucks', '115 Brown St, East Stroudsburg, PA 18301, USA'), -- chain
    (20574, 'Starbucks', '100 Eisenhower Dr, Hanover, PA 17331, USA'), -- chain
    (20575, 'Starbucks', '109 Town Centre Drive Richland Town Centre, Johnstown, PA 15904, USA'), -- chain
    (20576, 'Starbucks', '1011 Shoppes Blvd, Moosic, PA 18507, USA'), -- chain
    (20577, 'Starbucks', '200 Prospect St, East Stroudsburg, PA 18301, USA'), -- chain
    (20578, 'Starbucks', '260 Normal St, East Stroudsburg, PA 18301, USA'), -- chain
    (20579, 'Starbucks', '120 Matthew Dr, Uniontown, PA 15401, USA'), -- chain
    (20580, 'Starbucks', '710 W Main St, Uniontown, PA 15401, USA'), -- chain
    (20581, 'Starbucks', '14605 Mount Airy Rd, Shrewsbury, PA 17361, USA'), -- chain
    (20582, 'Starbucks', '501 Marketplace Boulevard, Selinsgrove, PA 17870, USA'), -- chain
    (20583, 'Starbucks', '255 Bessemer Rd, Mt Pleasant, PA 15666, USA'), -- chain
    (20584, 'Starbucks', '410 S Lycoming Mall Rd, Muncy, PA 17756, USA'), -- chain
    (20585, 'Starbucks', '170 S Lycoming Mall Rd, Muncy, PA 17756, USA'), -- chain
    (20586, 'Starbucks', '1 Terminal Dr, Middletown, PA 17057, USA'), -- chain
    (20587, 'Starbucks', 'at West Main, 884 W Main St, Lansdale, PA 19446, USA'), -- chain
    (20588, 'Starbucks', '2701 Sharky''s Drive A, Latrobe, PA 15650, USA'), -- chain
    (20589, 'Starbucks', '3175 Cape Horn Rd, Red Lion, PA 17356, USA'), -- chain
    (20590, 'Starbucks', '1 Morrow Way, Slippery Rock, PA 16057, USA'), -- chain
    (20591, 'Starbucks', 'E Pennsylvania Tpke, Toll road Milepost 247.4, Middletown, PA 17057, USA'), -- chain
    (20592, 'Starbucks', '1 N Main St, Yardley, PA 19067, USA'), -- chain
    (20593, 'Starbucks', '15200 Kutztown Rd, Kutztown, PA 19530, USA'), -- chain
    (20594, 'Starbucks', '6543 US-22, Delmont, PA 15626, USA'), -- chain
    (20595, 'Starbucks', '40 Shippensburg Shopping Center, Shippensburg, PA 17257, USA'), -- chain
    (20596, 'Starbucks', '5124 East Pittsburgh Street, US-30, Greensburg, PA 15601, USA'), -- chain
    (20597, 'Starbucks', 'Trinity Point Shopping Center, 110 Trinity Point Dr, Washington, PA 15301, USA'), -- chain
    (20598, 'Starbucks', 'Basin St. Shopping Center, 154 Academy St, Williamsport, PA 17701, USA'), -- chain
    (20599, 'Starbucks', '745 Main St, Stroudsburg, PA 18360, USA'), -- chain
    (20600, 'Starbucks - Widener University Only', 'East 14th Street, University Center, One University Pl, Chester, PA 19013, USA'), -- chain
    (20601, 'Starbucks at McNairy Library', '9 N George St, Millersville, PA 17551, USA'), -- chain
    (20602, 'Starbucks Coffee', '1 Lincoln Square, Gettysburg, PA 17325, USA'), -- chain
    (21418, 'Starbucks', '525 N 99th Ave, Tolleson, AZ 85353, USA'), -- chain
    (21419, 'Starbucks', 'Kokopelli Plaza, 1620 AZ-260, Camp Verde, AZ 86322, USA'), -- chain
    (21420, 'Starbucks', '401 AZ-260, Payson, AZ 85541, USA'), -- chain
    (21421, 'Starbucks', '230 AZ-260, Payson, AZ 85541, USA'), -- chain
    (21422, 'Starbucks', '142 AZ-260, Payson, AZ 85541, USA'), -- chain
    (21423, 'Starbucks', '2125 US-70, Thatcher, AZ 85552, USA'), -- chain
    (21424, 'Starbucks', '515 E Wickenburg Way, Wickenburg, AZ 85390, USA'), -- chain
    (21425, 'Starbucks', '1999 W Wickenburg Way, Wickenburg, AZ 85390, USA'), -- chain
    (21426, 'Starbucks', '5104 N Dysart Rd #400, Litchfield Park, AZ 85340, USA'), -- chain
    (21427, 'Starbucks', '13840 W Camelback Rd #20, Litchfield Park, AZ 85340, USA'), -- chain
    (21428, 'Starbucks', '1375 North Litchfield Road, Palm Valley Pavilions, Goodyear, AZ 85395, USA'), -- chain
    (21429, 'Starbucks', '5310 E Carefree Hwy, Cave Creek, AZ 85331, USA'), -- chain
    (21430, 'Starbucks', '4815 E Carefree Hwy, Cave Creek, AZ 85331, USA'), -- chain
    (21431, 'Starbucks', '29455 N Cave Creek Rd, Cave Creek, AZ 85331, USA'), -- chain
    (21432, 'Starbucks', '1900 W Thatcher Blvd, Safford, AZ 85546, USA'), -- chain
    (21433, 'Starbucks', '421 N White Mountain Rd, Show Low, AZ 85901, USA'), -- chain
    (21434, 'Starbucks', '900 W Deuce of Clubs, Show Low, AZ 85901, USA'), -- chain
    (21435, 'Starbucks', '36889 N Tom Darlington Dr, Carefree, AZ 85377, USA'), -- chain
    (22586, 'Starbucks', '450 US-206, Chester, NJ 07930, USA'), -- chain
    (22587, 'Starbucks', '1139 White Horse Rd, Voorhees Township, NJ 08043, USA'), -- chain
    (22588, 'Starbucks', '84 E Main St, Mendham, NJ 07945, USA'), -- chain
    (22589, 'Starbucks', 'Daibes Square at Northvale, 271b Livingston St, Northvale, NJ 07647, USA'), -- chain
    (22590, 'Starbucks', '710 Bloomfield Ave, Glen Ridge, NJ 07028, USA'), -- chain
    (22591, 'Starbucks', '1006 Mantua Pike, Woodbury Heights, NJ 08097, USA'), -- chain
    (22592, 'Starbucks', '800 Denow Rd, Pennington, NJ 08534, USA'), -- chain
    (22593, 'Starbucks', '45 Wanaque Avenue, Pompton Lakes Towne Square, Pompton Lakes, NJ 07442, USA'), -- chain
    (22594, 'Starbucks', '80 Morristown Rd, Bernardsville, NJ 07924, USA'), -- chain
    (22595, 'Starbucks', '353 NJ-37, Toms River, NJ 08753, USA'), -- chain
    (22596, 'Starbucks', '1320 Van Horne Rd Rt. 206, Princeton, NJ 08540, USA'), -- chain
    (22597, 'Starbucks', '1260 Springfield Ave, New Providence, NJ 07974, USA'), -- chain
    (22598, 'Starbucks', '1061 Asbury Ave, Ocean City, NJ 08226, USA'), -- chain
    (22599, 'Starbucks', '216 Old Tappan Rd, Old Tappan, NJ 07675, USA'), -- chain
    (22600, 'Starbucks', '94 NJ-23, Riverdale, NJ 07457, USA'), -- chain
    (22601, 'Starbucks', '1198 US-22, Phillipsburg, NJ 08865, USA'), -- chain
    (22602, 'Starbucks', '146 South St, Freehold, NJ 07728, USA'), -- chain
    (22603, 'Starbucks', '4800 Park Blvd, Wildwood, NJ 08260, USA'), -- chain
    (22604, 'Starbucks', '8005 Ventnor Ave, Margate City, NJ 08402, USA'), -- chain
    (22605, 'Starbucks', '957 US-9, South Amboy, NJ 08879, USA'), -- chain
    (22606, 'Starbucks', '178 NJ-35, Eatontown, NJ 07724, USA'), -- chain
    (22607, 'Starbucks', '675 Woodbury Glassboro Rd, Sewell, NJ 08080, USA'), -- chain
    (22608, 'Starbucks', '400 Ryders Ln, Milltown, NJ 08850, USA'), -- chain
    (22609, 'Starbucks', '184 Columbia Turnpike, Florham Park, NJ 07932, USA'), -- chain
    (22610, 'Starbucks', '300 NJ-18, East Brunswick, NJ 08816, USA'), -- chain
    (22611, 'Starbucks', '550 Myrtle Ave, Boonton, NJ 07005, USA'), -- chain
    (22612, 'Starbucks', 'Ocean Heights Plaza, 55 Bethel Rd, Somers Point, NJ 08244, USA'), -- chain
    (22613, 'Starbucks', 'ACME Commons at Bordentown, 282 Dunns Mill Rd, Bordentown, NJ 08505, USA'), -- chain
    (22614, 'Starbucks', '320 E Jimmie Leeds Rd, Absecon, NJ 08205, USA'), -- chain
    (22615, 'Starbucks', '813 Riverview Dr, Totowa, NJ 07512, USA'), -- chain
    (22616, 'Starbucks', '1 Premium Outlets Blvd, Tinton Falls, NJ 07753, USA'), -- chain
    (22617, 'Starbucks', '100 US-9, Englishtown, NJ 07726, USA'), -- chain
    (22618, 'Starbucks', '55 US-9, Manalapan Township, NJ 07726, USA'), -- chain
    (22619, 'Starbucks', '96 Meadow Rd, Rutherford, NJ 07070, USA'), -- chain
    (22620, 'Starbucks', '10 NJ-17, East Rutherford, NJ 07073, USA'), -- chain
    (22621, 'Starbucks', '1666 US-22, Watchung, NJ 07069, USA'), -- chain
    (22622, 'Starbucks', '79 Vervalen St, Closter, NJ 07624, USA'), -- chain
    (22623, 'Starbucks', '457 River Road Edgewater Commons, Edgewater, NJ 07020, USA'), -- chain
    (22624, 'Starbucks', '68 US-46, Hackettstown, NJ 07840, USA'), -- chain
    (22625, 'Starbucks', '1885 NJ-57, Hackettstown, NJ 07840, USA'), -- chain
    (22626, 'Starbucks', '145 W Main St Unit A1, Somerville, NJ 08876, USA'), -- chain
    (22627, 'Starbucks', '5000 Wellington Ave, Ventnor City, NJ 08406, USA'), -- chain
    (22628, 'Starbucks', '744 Bloomfield Ave, West Caldwell, NJ 07006, USA'), -- chain
    (22629, 'Starbucks', 'Main Street Village, 265 Main St, Matawan, NJ 07747, USA'), -- chain
    (22630, 'Starbucks', '4-6 White St, Red Bank, NJ 07701, USA'), -- chain
    (23448, 'Starbucks', '2606 Avenue L, Fort Madison, IA 52627, USA'), -- chain
    (23449, 'Starbucks', '905 Lincoln Hwy, Carroll, IA 51401, USA'), -- chain
    (23450, 'Starbucks', '2255 E 1st St, Grimes, IA 50111, USA'), -- chain
    (23451, 'Starbucks', '10175 University Ave, Clive, IA 50325, USA'), -- chain
    (23452, 'Starbucks', '11084 Hickman Rd, Clive, IA 50325, USA'), -- chain
    (23453, 'Starbucks', '1281 Eagle Ridge Rd, Le Claire, IA 52753, USA'), -- chain
    (23454, 'Starbucks', '1111 8th St, Boone, IA 50036, USA'), -- chain
    (23455, 'Starbucks', '5237 Cumming Ave, Cumming, IA 50061, USA'), -- chain
    (23456, 'Starbucks', '3570 4th St SW, Mason City, IA 50401, USA'), -- chain
    (23457, 'Starbucks', '1300 W Burlington Ave, Fairfield, IA 52556, USA'), -- chain
    (23458, 'Starbucks', '915 Centrum Dr, Decorah, IA 52101, USA'), -- chain
    (23459, 'Starbucks', '1025 N Quincy Ave, Ottumwa, IA 52501, USA'), -- chain
    (23460, 'Starbucks', '1500 18th St, Spirit Lake, IA 51360, USA'), -- chain
    (23461, 'Starbucks Coffee', '11 Hwy 1 W, Iowa City, IA 52246, USA'), -- chain
    (24210, 'Starbucks', '719 E Valley Rd, Basalt, CO 81621, USA'), -- chain
    (24211, 'Starbucks', '250 E Valley Rd, El Jebel, CO 81623, USA'), -- chain
    (24212, 'Starbucks', '905 CO-133, Carbondale, CO 81623, USA'), -- chain
    (24213, 'Starbucks', '19590 US-24, Woodland Park, CO 80863, USA'), -- chain
    (24214, 'Starbucks', '1101 US-24, Woodland Park, CO 80863, USA'), -- chain
    (24215, 'Starbucks', '246 Rainbow Dr, Silverthorne, CO 80498, USA'), -- chain
    (24216, 'Starbucks', '715 Blue River Pkwy, Silverthorne, CO 80498, USA'), -- chain
    (24217, 'Starbucks', '1300 Dexter St, Fort Lupton, CO 80621, USA'), -- chain
    (24218, 'Starbucks', '980 N 10 Mile Dr, Frisco, CO 80443, USA'), -- chain
    (24219, 'Starbucks', 'Retail Center, 2900 Colorado Blvd, Idaho Springs, CO 80452, USA'), -- chain
    (24220, 'Starbucks', '2115 Grand Ave, Glenwood Springs, CO 81601, USA'), -- chain
    (24221, 'Starbucks', '1410 Grand Ave, Glenwood Springs, CO 81601, USA'), -- chain
    (24222, 'Starbucks', '110 W Meadows, Glenwood Springs, CO 81601, USA'), -- chain
    (24223, 'Starbucks', '1045 S 1st St, Bennett, CO 80102, USA'), -- chain
    (24224, 'Starbucks', '8000 E Belleview Ave, Greenwood Village, CO 80111, USA'), -- chain
    (24225, 'Starbucks', '165 Country Center Dr, Pagosa Springs, CO 81147, USA'), -- chain
    (24226, 'Starbucks', '225 Anglers Dr, Steamboat Springs, CO 80487, USA'), -- chain
    (24227, 'Starbucks', '1303 Royal Gorge Blvd, Cañon City, CO 81212, USA'), -- chain
    (24228, 'Starbucks', '1703 Fremont Dr, Cañon City, CO 81212, USA'), -- chain
    (24229, 'Starbucks', '11169 E I-25 Frontage Rd, Longmont, CO 80504, USA'), -- chain
    (24230, 'Starbucks', '4541 Weitzel Street, Timnath, CO 80547, USA'), -- chain
    (24231, 'Starbucks', '532 Raptor Rd, Fruita, CO 81521, USA'), -- chain
    (24232, 'Starbucks', '506 Castle Pines Pkwy, Castle Pines, CO 80108, USA'), -- chain
    (24233, 'Starbucks', '624 CO-105, Monument, CO 80132, USA'), -- chain
    (24234, 'Starbucks', 'People''s National Bank, 541 CO-105, Monument, CO 80132, USA'), -- chain
    (24235, 'Starbucks', '103 Market St, Eagle, CO 81631, USA'), -- chain
    (24236, 'Starbucks', '180 S Frontage Rd W, Vail, CO 81657, USA'), -- chain
    (24237, 'Starbucks', '2109 N Frontage Rd W, Vail, CO 81657, USA'), -- chain
    (24238, 'Starbucks', '2131 N Frontage Rd W, Vail, CO 81657, USA'), -- chain
    (24239, 'Starbucks', '900 Airport Rd, Rifle, CO 81650, USA'), -- chain
    (24240, 'Starbucks', '1320 Railroad Ave, Rifle, CO 81650, USA'), -- chain
    (24241, 'Starbucks', '85 Parsenn Rd, Winter Park, CO 80482, USA'), -- chain
    (24242, 'Starbucks', '620 W Platte Ave, Fort Morgan, CO 80701, USA'), -- chain
    (24243, 'Starbucks', '10300 Federal Blvd, Federal Heights, CO 80260, USA'), -- chain
    (24244, 'Starbucks', '37500 S Lincoln Ave E, U.S. Hwy 40, Steamboat Springs, CO 80488, USA'), -- chain
    (24245, 'Starbucks', '232 G St, Salida, CO 81201, USA'), -- chain
    (24246, 'Starbucks', '1301 Main St, Alamosa, CO 81101, USA'), -- chain
    (24247, 'Starbucks', '151 Market St, Alamosa, CO 81101, USA'), -- chain
    (24248, 'Starbucks', '1310 Main St, Alamosa, CO 81101, USA'), -- chain
    (24249, 'Starbucks', '508 E Main St, Cortez, CO 81321, USA'), -- chain
    (25005, 'Starbucks', '801 E Main St, Radford, VA 24142, USA'), -- chain
    (25006, 'Starbucks', '603 Wood Ave E, Big Stone Gap, VA 24219, USA'), -- chain
    (25007, 'Starbucks', '207 Woodland Dr SW, Wise, VA 24293, USA'), -- chain
    (25008, 'Starbucks', '5560 Dickenson Hwy, Clintwood, VA 24228, USA'), -- chain
    (25009, 'Starbucks', 'Park South, 790 Southpark Blvd, Colonial Heights, VA 23834, USA'), -- chain
    (25010, 'Starbucks', '3007 Boulevard, Colonial Heights, VA 23834, USA'), -- chain
    (25011, 'Starbucks', '1701 Tyler Ave, Radford, VA 24141, USA'), -- chain
    (25012, 'Starbucks', '5748 Union Mill Rd, Centreville, VA 20124, USA'), -- chain
    (25013, 'Starbucks', '131 Town Run Ln, Stephens City, VA 22655, USA'), -- chain
    (25014, 'Starbucks', '1000 Leatherwood Ln, Bluefield, VA 24605, USA'), -- chain
    (25015, 'Starbucks', '955a E Stuart Dr, Galax, VA 24333, USA'), -- chain
    (25016, 'Starbucks', '10683 Sudley Manor Dr, Manassas, VA 20109, USA'), -- chain
    (25017, 'Starbucks', '3004 US Hwy 23 S, Weber City, VA 24290, USA'), -- chain
    (25018, 'Starbucks', '105 Purcellville Gateway Dr, Purcellville, VA 20132, USA'), -- chain
    (25019, 'Starbucks', '8699 Sudley Rd, Manassas, VA 20110, USA'), -- chain
    (25020, 'Starbucks', '9642 Liberia Avenue, Signal Hill Rd, Manassas, VA 20110, USA'), -- chain
    (25021, 'Starbucks', '3616 Old Halifax Rd, South Boston, VA 24592, USA'), -- chain
    (25022, 'Starbucks', 'Commons Shopping Center, 198 Commonwealth Dr, Wytheville, VA 24382, USA'), -- chain
    (25023, 'Starbucks', '10 Crooked Run Plaza, Front Royal, VA 22630, USA'), -- chain
    (25024, 'Starbucks', '200 Remount Rd, Front Royal, VA 22630, USA'), -- chain
    (25025, 'Starbucks', 'Power Center, 125 Riverton Commons Dr, Front Royal, VA 22630, USA'), -- chain
    (25264, 'Starbucks', '140 FM 1069, Aransas Pass, TX 78336, USA'), -- chain
    (25385, 'Starbucks', '480 NW Pkwy St, Azle, TX 76020, USA'), -- chain
    (25386, 'Starbucks', '727 Boyd Rd, Azle, TX 76020, USA'), -- chain
    (25407, 'Starbucks', '501 B State Hwy 71, Bastrop, TX 78602, USA'), -- chain
    (25430, 'Starbucks', '3702 Ranch Rd 620 S, Bee Cave, TX 78738, USA'), -- chain
    (25460, 'Starbucks', '2231 State Hwy 121, Bonham, TX 75418, USA'), -- chain
    (25466, 'Starbucks', '1371 W Wilson St, Borger, TX 79007, USA'), -- chain
    (25480, 'Starbucks', '2150 10th St, Bridgeport, TX 76426, USA'), -- chain
    (25516, 'Starbucks', '302 E Commerce St, Brownwood, TX 76801, USA'), -- chain
    (25541, 'Starbucks', '15295 N Interstate 35 Frontage Rd, Buda, TX 78610, USA'), -- chain
    (25555, 'Starbucks', '109 Old Boerne Rd, Bulverde, TX 78163, USA'), -- chain
    (25567, 'Starbucks', '204 N Water St, Burnet, TX 78611, USA'), -- chain
    (25616, 'Starbucks', '1805 Ave F NW, Childress, TX 79201, USA'), -- chain
    (25627, 'Starbucks', '255 Marina Bay Dr, Clear Lake Shores, TX 77565, USA'), -- chain
    (25651, 'Starbucks', '800 Dixie Dr, Clute, TX 77531, USA'), -- chain
    (25744, 'Starbucks', '1176 E Loop 304, Crockett, TX 75835, USA'), -- chain
    (25819, 'Starbucks', '1601 N Cockrell Hill Rd, Dallas, TX 75211, USA'), -- chain
    (25841, 'Starbucks', '802 US-90, Dayton, TX 77535, USA'), -- chain
    (25851, 'Starbucks', '8075 Spencer Hwy, Deer Park, TX 77536, USA'), -- chain
    (25852, 'Starbucks', '3705 Center St, Deer Park, TX 77536, USA'), -- chain
    (25901, 'Starbucks', '108 US-290, Dripping Springs, TX 78620, USA'), -- chain
    (25907, 'Starbucks', '117 Early Blvd, Early, TX 76802, USA'), -- chain
    (25975, 'Starbucks', '601 E 5th St, Ferris, TX 75125, USA'), -- chain
    (25986, 'Starbucks', '664 10th St, Floresville, TX 78114, USA'), -- chain
    (26049, 'Starbucks', '132 W Loop 820 S, Fort Worth, TX 76108, USA'), -- chain
    (26063, 'Starbucks', '905 N Brazosport Blvd, Freeport, TX 77541, USA'), -- chain
    (26086, 'Starbucks', '502 W California St, Gainesville, TX 76240, USA'), -- chain
    (26137, 'Starbucks', '2325 E Austin St, Giddings, TX 78942, USA'), -- chain
    (26142, 'Starbucks', 'US Hwy 271 N, Gilmer, TX 75644, USA'), -- chain
    (26173, 'Starbucks', '413 East US Hwy 377, Granbury, TX 76048, USA'), -- chain
    (26174, 'Starbucks', '3907 East US Hwy 377, Granbury, TX 76049, USA'), -- chain
    (26175, 'Starbucks', '3915 East US Hwy 377, Granbury, TX 76049, USA'), -- chain
    (26204, 'Starbucks', '3990 Twin City Hwy, Groves, TX 77619, USA'), -- chain
    (26207, 'Starbucks', '1118 W Main St, Gun Barrel City, TX 75156, USA'), -- chain
    (26222, 'Starbucks', '201 E Central Texas Expy Bldg 3, Harker Heights, TX 76548, USA'), -- chain
    (26240, 'Starbucks', '1816 W Tyler Ave, Harlingen, TX 78550, USA'), -- chain
    (26255, 'Starbucks', '1634 S Market St, Hearne, TX 77859, USA'), -- chain
    (26275, 'Starbucks', '711 W 1st St, Hereford, TX 79045, USA'), -- chain
    (26276, 'Starbucks', '4600 Swisher Rd, Hickory Creek, TX 75065, USA'), -- chain
    (26295, 'Starbucks', '281 90 E East, Hondo, TX 78861, USA'), -- chain
    (26407, 'Starbucks', '2970 Fort Worth Hwy, Hudson Oaks, TX 76087, USA'), -- chain
    (26419, 'Starbucks', '4830 Wilson Rd, Humble, TX 77396, USA'), -- chain
    (26420, 'Starbucks', '1501 Farm to Market 1960 Bypass Rd E, Humble, TX 77338, USA'), -- chain
    (26421, 'Starbucks', '20777 US-59, Humble, TX 77338, USA'), -- chain
    (26422, 'Starbucks', '8446 FM 1960, Humble, TX 77338, USA'), -- chain
    (26445, 'Starbucks', '307 SW Access Rd, Iowa Park, TX 76367, USA'), -- chain
    (26457, 'Starbucks', '109 Slowbes Wy, Jarrell, TX 76537, USA'), -- chain
    (26476, 'Starbucks', '1036 S Broadway St Suite 200, Joshua, TX 76058, USA'), -- chain
    (26512, 'Starbucks', '250 175 110, Kaufman, TX 75142, USA'), -- chain
    (26519, 'Starbucks', '301 Kipp Ave, Kemah, TX 77565, USA'), -- chain
    (26520, 'Starbucks', '255 FM Rd 518 East, Kemah, TX 77565, USA'), -- chain
    (26582, 'Starbucks', '4273 Purple Heart Trail, I-35, Lacy Lakeview, TX 76705, USA'), -- chain
    (26584, 'Starbucks', '7708 Lohman Ford Rd, Lago Vista, TX 78645, USA'), -- chain
    (26593, 'Starbucks', '104 Nolan Ryan Expy, State Hwy 288, Lake Jackson, TX 77566, USA'), -- chain
    (26604, 'Starbucks', '2301 Ranch Rd 620 S, Lakeway, TX 78734, USA'), -- chain
    (26611, 'Starbucks', '108 N Key Ave, Lampasas, TX 76550, USA'), -- chain
    (26619, 'Starbucks', '875 S State Hwy 78, Lavon, TX 75166, USA'), -- chain
    (26643, 'Starbucks', '511 College Ave, Levelland, TX 79336, USA'), -- chain
    (26644, 'Starbucks', '812 College Ave, Levelland, TX 79336, USA'), -- chain
    (26658, 'Starbucks', '13055 W State Hwy 29, Liberty Hill, TX 78642, USA'), -- chain
    (26665, 'Starbucks', '521 S Main St, Lindale, TX 75771, USA'), -- chain
    (26666, 'Starbucks', '13815 US Hwy 69 N, Lindale, TX 75706, USA'), -- chain
    (26775, 'Starbucks', '301 Gateway N, Marble Falls, TX 78654, USA'), -- chain
    (26821, 'Starbucks', '11707 W Airport Blvd, Meadows Place, TX 77477, USA'), -- chain
    (26830, 'Starbucks', '3939 E Expressway 83, Mercedes, TX 78570, USA'), -- chain
    (26831, 'Starbucks', '3839 E Expressway 83, Mercedes, TX 78570, USA'), -- chain
    (26841, 'Starbucks', '702 E Milam St, Mexia, TX 76667, USA'), -- chain
    (26859, 'Starbucks', '3703 US-180, Mineral Wells, TX 76067, USA'), -- chain
    (26880, 'Starbucks', '9209 Eagle Dr #100, Mont Belvieu, TX 77523, USA'), -- chain
    (26920, 'Starbucks', '3610 FM 365, Nederland, TX 77627, USA'), -- chain
    (26951, 'Starbucks', '2960 Farm to Market Rd 720, Oak Point, TX 75068, USA'), -- chain
    (26984, 'Starbucks', '1608 N Hobart St, Pampa, TX 79065, USA'), -- chain
    (27003, 'Starbucks', '1804 W Comal St, Pearsall, TX 78061, USA'), -- chain
    (27008, 'Starbucks', '2856 S Cedar St, Pecos, TX 79772, USA'), -- chain
    (27010, 'Starbucks', '2101 US-83, Penitas, TX 78576, USA'), -- chain
    (27056, 'Starbucks', '1754 E Ocean Blvd, TX-100, Port Isabel, TX 78578, USA'), -- chain
    (27060, 'Starbucks', '926 TX-35, Port Lavaca, TX 77979, USA'), -- chain
    (27090, 'Starbucks Coffee', '100 Sharaf Ave, Red Oak, TX 75154, USA'), -- chain
    (27118, 'Starbucks', '4533 E US Hwy 83, Rio Grande City, TX 78582, USA'), -- chain
    (27341, 'Starbucks', '2013 Meyer St, Sealy, TX 77474, USA'), -- chain
    (27350, 'Starbucks', '18358 North Fwy Interstate 45, Shenandoah, TX 77384, USA'), -- chain
    (27357, 'Starbucks', 'Shafer Plaza Shopping Center, 2918 N Hwy 75, Sherman, TX 75090, USA'), -- chain
    (27417, 'Starbucks', '700 E Hwy 199, Springtown, TX 76082, USA'), -- chain
    (27424, 'Starbucks', '3613 S Main St, Stafford, TX 77477, USA'), -- chain
    (27494, 'Starbucks', 'Shopping Center, 2507 Richmond Rd, Texarkana, TX 75503, USA'), -- chain
    (27546, 'Starbucks', '28103 Tomball Pkwy, Tomball, TX 77375, USA'), -- chain
    (27552, 'Starbucks', '101 Trophy Lake Dr, Trophy Club, TX 76262, USA'), -- chain
    (27553, 'Starbucks', '501 Trophy Lake Dr, Trophy Club, TX 76262, USA'), -- chain
    (27586, 'Starbucks', '505 E Main St, Uvalde, TX 78801, USA'), -- chain
    (27592, 'Starbucks', '135 FM314, Van, TX 75790, USA'), -- chain
    (27671, 'Starbucks', '22119 Purple Heart Trl I-35, West, TX 76691, USA'), -- chain
    (27725, 'Starbucks', '101 Willow Bend Dr, Willow Park, TX 76008, USA'), -- chain
    (27808, 'Starbucks', '44 Main St, Wayland, MA 01778, USA'), -- chain
    (27898, 'Starbucks', '470 Washington St, Brighton, MA 02135, USA'), -- chain
    (27934, 'Starbucks', '23 Market Square, Newburyport, MA 01950, USA'), -- chain
    (28140, 'Starbucks', '770 Chief Justice Cushing Hwy, Cohasset, MA 02025, USA'), -- chain
    (28241, 'Starbucks', '411 Massachusetts Ave, Acton, MA 01720, USA'), -- chain
    (28272, 'Starbucks', '300 Market Dr, Athol, MA 01331, USA'), -- chain
    (28315, 'Starbucks', '109 Northampton St, Easthampton, MA 01027, USA'), -- chain
    (28815, 'Starbucks', '2150 Dixie Hwy, Fort Mitchell, KY 41017, USA'), -- chain
    (28816, 'Starbucks', '429 University Dr, Prestonsburg, KY 41653, USA'), -- chain
    (28817, 'Starbucks', '1910 Cumberland Falls Hwy, Corbin, KY 40701, USA'), -- chain
    (28818, 'Starbucks', '102 Jane St, Berea, KY 40403, USA'), -- chain
    (28819, 'Starbucks', '69 Broadway St, Dry Ridge, KY 41035, USA'), -- chain
    (28820, 'Starbucks', '5929 Timber Ridge Dr, Prospect, KY 40059, USA'), -- chain
    (28821, 'Starbucks', '9205 US-42, Prospect, KY 40059, USA'), -- chain
    (28822, 'Starbucks', '1201 Winchester Ave, Ashland, KY 41101, USA'), -- chain
    (28823, 'Starbucks', '7203 Hwy 329, Crestwood, KY 40014, USA'), -- chain
    (28824, 'Starbucks', '102 W John Rowan Blvd, Bardstown, KY 40004, USA'), -- chain
    (28825, 'Starbucks', '174 Keystone Crossing Drive, Shepherdsville, KY 40165, USA'), -- chain
    (28826, 'Starbucks', '210 Cassady Blvd, Pikeville, KY 41501, USA'), -- chain
    (28827, 'Starbucks', '2478 US-421, Harlan, KY 40831, USA'), -- chain
    (28828, 'Starbucks', '475 Hampton Way, Morehead, KY 40351, USA'), -- chain
    (28829, 'Starbucks', '150 University Blvd, Morehead, KY 40351, USA'), -- chain
    (28830, 'Starbucks', '375 Crossroads Blvd, Cold Spring, KY 41076, USA'), -- chain
    (29190, 'Starbucks', '38670 Sussex Hwy, Delmar, DE 19940, USA'), -- chain
    (29191, 'Starbucks', '28662 Dupont Blvd, Millsboro, DE 19966, USA'), -- chain
    (29192, 'Starbucks', '23481 Sussex Hwy, Seaford, DE 19973, USA'), -- chain
    (29193, 'Starbucks', '301 Rehoboth Ave, Rehoboth Beach, DE 19971, USA'), -- chain
    (29194, 'Starbucks', '38069 Town Center Dr, Millville, DE 19967, USA'), -- chain
    (29195, 'Starbucks', '1350 S Dupont Blvd, Smyrna, DE 19977, USA'), -- chain
    (29504, 'Starbucks', '7285 Hwy 2 E, Columbia Falls, MT 59912, USA'), -- chain
    (29505, 'Starbucks', '146 S Shore Rte, Polson, MT 59860, USA'), -- chain
    (29506, 'Starbucks', '50205 3rd Ave E, Polson, MT 59860, USA'), -- chain
    (30903, 'Starbucks', '620 Northwest Hwy, Cary, IL 60013, USA'), -- chain
    (30904, 'Starbucks', '1251 State St, Lemont, IL 60439, USA'), -- chain
    (30905, 'Starbucks', '13460 Archer Ave, Lemont, IL 60439, USA'), -- chain
    (30906, 'Starbucks', '15850 S 94th Ave, Orland Park, IL 60462, USA'), -- chain
    (30907, 'Starbucks', 'Jewel-Osco, 9350 W 159th St, Orland Park, IL 60462, USA'), -- chain
    (30908, 'Starbucks', '2050 W Orchard Rd, North Aurora, IL 60542, USA'), -- chain
    (30909, 'Starbucks', '1076 N 7th St, Rochelle, IL 61068, USA'), -- chain
    (30910, 'Starbucks', '990 N Kinzie Ave, Bradley, IL 60915, USA'), -- chain
    (30911, 'Starbucks', '944 N Kinzie Ave, Bradley, IL 60915, USA'), -- chain
    (30912, 'Starbucks', '910 N Kinzie Ave, Bradley, IL 60915, USA'), -- chain
    (30913, 'Starbucks', '5036 N Big Hollow Rd, Peoria, IL 61615, USA'), -- chain
    (30914, 'Starbucks', '5001 N Big Hollow Rd, Peoria, IL 61615, USA'), -- chain
    (30915, 'Starbucks', '9219 N Lindbergh Dr, Peoria, IL 61615, USA'), -- chain
    (30916, 'Starbucks', '2999 S Waukegan Rd, Bannockburn, IL 60015, USA'), -- chain
    (30917, 'Starbucks', '1615 N Kinzie Ave N SR 50, Bourbonnais, IL 60914, USA'), -- chain
    (30918, 'Starbucks', '960 US-51, Forsyth, IL 62535, USA'), -- chain
    (30919, 'Starbucks', '2407 W 22nd St, Oak Brook, IL 60523, USA'), -- chain
    (30920, 'Starbucks', '11054 Bob Burton Way, West Frankfort, IL 62896, USA'), -- chain
    (30921, 'Starbucks', '515 Village Center Dr, Burr Ridge, IL 60527, USA'), -- chain
    (30922, 'Starbucks', '800 N Main St, Elburn, IL 60119, USA'), -- chain
    (30923, 'Starbucks', '203 N 8th St, West Dundee, IL 60118, USA'), -- chain
    (30924, 'Starbucks', '2714 Walton Wy, Marion, IL 62959, USA'), -- chain
    (30925, 'Starbucks', '1704 W Deyoung St, Marion, IL 62959, USA'), -- chain
    (30926, 'Starbucks', '3000 W Deyoung St, Marion, IL 62959, USA'), -- chain
    (30927, 'Starbucks', '4701 N Illinois St, Fairview Heights, IL 62208, USA'), -- chain
    (30928, 'Starbucks', '10860 Lincoln Trail, Fairview Heights, IL 62208, USA'), -- chain
    (30929, 'Starbucks', '4570 Rosecrans Rd, IL-173, Zion, IL 60099, USA'), -- chain
    (30930, 'Starbucks', '26919 W Eames St, Channahon, IL 60410, USA'), -- chain
    (30931, 'Starbucks', '3760 Vollmer Rd, Flossmoor, IL 60422, USA'), -- chain
    (30932, 'Starbucks', '7202 119th St, Palos Heights, IL 60463, USA'), -- chain
    (30933, 'Starbucks', '1634 IL-50, Bourbonnais, IL 60914, USA'), -- chain
    (30934, 'Starbucks', '1 University Ave, Bourbonnais, IL 60914, USA'), -- chain
    (30935, 'Starbucks', '532 Main St NW, Bourbonnais, IL 60914, USA'), -- chain
    (30936, 'Starbucks', '4800 211th St Suite D, Matteson, IL 60443, USA'), -- chain
    (30937, 'Starbucks', '17860 Halsted St, Homewood, IL 60430, USA'), -- chain
    (30938, 'Starbucks', '800 Broadview Village Square, Broadview, IL 60155, USA'), -- chain
    (30939, 'Starbucks', '2842 S 17th Ave, Broadview, IL 60155, USA'), -- chain
    (30940, 'Starbucks', '1600 E Jackson, Macomb, IL 61455, USA'), -- chain
    (30941, 'Starbucks', 'Cantera Commons, 28341 W Diehl Rd, Warrenville, IL 60555, USA'), -- chain
    (30942, 'Starbucks', '28201 Diehl Rd, Warrenville, IL 60555, USA'), -- chain
    (30943, 'Starbucks', '1723 Homer M Adams Pkwy, Alton, IL 62002, USA'), -- chain
    (30944, 'Starbucks', '1023 Charleston Ave E, Mattoon, IL 61938, USA'), -- chain
    (30945, 'Starbucks', '581 W 14th St, Chicago Heights, IL 60411, USA'), -- chain
    (30946, 'Starbucks', '2399 N Bloomington St, Streator, IL 61364, USA'), -- chain
    (30947, 'Starbucks', '415 S 42nd St, Mt Vernon, IL 62864, USA'), -- chain
    (30948, 'Starbucks', '4323 Broadway St, Mt Vernon, IL 62864, USA'), -- chain
    (30949, 'Starbucks', 'University Drive Morris Univ Ctr Campus, Box #1, Edwardsville, IL 62025, USA'), -- chain
    (30950, 'Starbucks', '38 LaGrange Rd, La Grange, IL 60525, USA'), -- chain
    (30951, 'Starbucks', '801 W Champaign Ave, Rantoul, IL 61866, USA'), -- chain
    (30952, 'Starbucks', '330 W Irving Park Rd, Wood Dale, IL 60191, USA'), -- chain
    (30953, 'Starbucks', '201 E Bidwell St, Taylorville, IL 62568, USA'), -- chain
    (30954, 'Starbucks', '541 Bob Blair Rd, Minooka, IL 60447, USA'), -- chain
    (30955, 'Starbucks', '2051 Ridge Rd, Minooka, IL 60447, USA'), -- chain
    (30956, 'Starbucks', '9564 S Western Ave, Evergreen Park, IL 60805, USA'), -- chain
    (30957, 'Starbucks', '800 Northwest Hwy, Fox River Grove, IL 60021, USA'), -- chain
    (30958, 'Starbucks', '8359 W Grand Ave, River Grove, IL 60171, USA'), -- chain
    (30959, 'Starbucks', '102 Biesterfield Rd, Elk Grove Village, IL 60007, USA'), -- chain
    (30960, 'Starbucks', '18 N Waukegan Rd, Lake Bluff, IL 60044, USA'), -- chain
    (30961, 'Starbucks', 'Target, 975 Rockland Rd, Lake Bluff, IL 60044, USA'), -- chain
    (30962, 'Starbucks', '7737 W 95th St Unit A, Hickory Hills, IL 60457, USA'), -- chain
    (30963, 'Starbucks', '195 W Rand Rd, Mt Prospect, IL 60056, USA'), -- chain
    (30964, 'Starbucks', '1312 John Deere Expy, Silvis, IL 61282, USA'), -- chain
    (30965, 'Starbucks', '566 Chestnut St Space 3-4, Winnetka, IL 60093, USA'), -- chain
    (30966, 'Starbucks', '1411 W Hwy 50, O''Fallon, IL 62269, USA'), -- chain
    (30967, 'Starbucks', '2030 E Main St, Galesburg, IL 61401, USA'), -- chain
    (30968, 'Starbucks', '1071 W Carl Sandburg Dr, Galesburg, IL 61401, USA'), -- chain
    (30969, 'Starbucks', '1910 N Henderson St, Galesburg, IL 61401, USA'), -- chain
    (30970, 'Starbucks', '1904 N Barron Blvd, IL-83, Round Lake Beach, IL 60073, USA'), -- chain
    (30971, 'Starbucks', '750 E Rollins Rd, Round Lake Beach, IL 60073, USA'), -- chain
    (30972, 'Starbucks', '2925 Barrington Rd, Hoffman Estates, IL 60192, USA'), -- chain
    (30973, 'Starbucks', '1048 Maple Ave, Lisle, IL 60532, USA'), -- chain
    (30974, 'Starbucks', '9801 Irving Park Rd, Schiller Park, IL 60176, USA'), -- chain
    (30975, 'Starbucks', '1200 W Main St, Peoria, IL 61606, USA'), -- chain
    (30976, 'Starbucks', '7167 Kingery Hwy, Willowbrook, IL 60527, USA'), -- chain
    (30977, 'Starbucks', '7601 Kingery Hwy, Willowbrook, IL 60527, USA'), -- chain
    (30978, 'Starbucks', '2800 Mannheim Rd, Franklin Park, IL 60131, USA'), -- chain
    (30979, 'Starbucks', '1001 W Jackson St, Morton, IL 61550, USA'), -- chain
    (30980, 'Starbucks', '133 E Courtland St, Morton, IL 61550, USA'), -- chain
    (30981, 'Starbucks', '4871 Sauk Trail, Richton Park, IL 60471, USA'), -- chain
    (30982, 'Starbucks', '1700 Ave of Mid-America, Effingham, IL 62401, USA'), -- chain
    (30983, 'Starbucks', '23230 Volbrecht Rd, Crete, IL 60417, USA'), -- chain
    (30984, 'Starbucks', '4400 N Harlem Ave, Norridge, IL 60706, USA'), -- chain
    (30985, 'Starbucks', '4050 N Harlem Ave, Norridge, IL 60706, USA'), -- chain
    (30986, 'Starbucks', '1127 S York Rd, Bensenville, IL 60106, USA'), -- chain
    (30987, 'Starbucks', '31600 N US Hwy 12, Lakemoor, IL 60051, USA'), -- chain
    (30988, 'Starbucks', '4196-A IL-83, Long Grove, IL 60047, USA'), -- chain
    (30989, 'Starbucks', '101 W Main St, Barrington, IL 60010, USA'), -- chain
    (30990, 'Starbucks', '120 S Northwest Hwy, Barrington, IL 60010, USA'), -- chain
    (30991, 'Starbucks', '34354 US-45, Third Lake, IL 60030, USA'), -- chain
    (30992, 'Starbucks', '950 Sheridan Rd, Highwood, IL 60040, USA'), -- chain
    (30993, 'Starbucks', '33 S Washington St, Hinsdale, IL 60521, USA'), -- chain
    (30994, 'Starbucks', 'Wild Oats Center, 500 E Ogden Ave, Hinsdale, IL 60521, USA'), -- chain
    (30995, 'Starbucks Reserve Roastery', '646 Michigan Ave, Chicago, IL 60611, USA'), -- chain
    (31618, 'Starbucks', '112 Edgewood Dr, McComb, MS 39648, USA'), -- chain
    (31619, 'Starbucks', '3158 Bienville Blvd, Ocean Springs, MS 39564, USA'), -- chain
    (31620, 'Starbucks', '1021 Casino Center Dr, Tunica Resorts, MS 38664, USA'), -- chain
    (31621, 'Starbucks', '1088 Evelyn Gandy Pkwy, Petal, MS 39465, USA'), -- chain
    (31622, 'Starbucks', '629 E Commerce St I-55, Hernando, MS 38632, USA'), -- chain
    (31623, 'Starbucks', '2380 Mt Pleasant Rd, Hernando, MS 38632, USA'), -- chain
    (31624, 'Starbucks', '170 Promenade Blvd, Flowood, MS 39232, USA'), -- chain
    (31625, 'Starbucks', '263 Ridge Way, Flowood, MS 39232, USA'), -- chain
    (33545, 'Starbucks', '7500 Commons Blvd, Victor, NY 14564, USA'), -- chain
    (33546, 'Starbucks', '195 Mill Rd, Westhampton Beach, NY 11978, USA'), -- chain
    (33547, 'Starbucks', '7963 Jericho Turnpike, Woodbury, NY 11797, USA'), -- chain
    (33548, 'Starbucks', '399 S Oyster Bay Rd, Plainview, NY 11803, USA'), -- chain
    (33549, 'Starbucks', '1400 Union Tpke, New Hyde Park, NY 11040, USA'), -- chain
    (33550, 'Starbucks', '1596 Union Tpke, North New Hyde Park, NY 11040, USA'), -- chain
    (33551, 'Starbucks', '1 College Cir, Geneseo, NY 14454, USA'), -- chain
    (33552, 'Starbucks', '373 Willis Ave, Roslyn Heights, NY 11577, USA'), -- chain
    (33553, 'Starbucks', '5 Locey Ln, Harriman, NY 10926, USA'), -- chain
    (33554, 'Starbucks', 'Parkway Plaza, 10 Muar St, Canandaigua, NY 14424, USA'), -- chain
    (33555, 'Starbucks', '1336 Peninsula Blvd, Hewlett, NY 11557, USA'), -- chain
    (33556, 'Starbucks', '121 Secatogue Ave, Farmingdale, NY 11735, USA'), -- chain
    (33557, 'Starbucks', '65 Shore Rd, Port Washington, NY 11050, USA'), -- chain
    (33558, 'Starbucks', '72 Main St, Port Washington, NY 11050, USA'), -- chain
    (33559, 'Starbucks', '290 E Main St, Elmsford, NY 10523, USA'), -- chain
    (33560, 'Starbucks', '3657 Genesee St, Syracuse, NY 13219, USA'), -- chain
    (33561, 'Starbucks', '1100 Northern Blvd, Manhasset, NY 11030, USA'), -- chain
    (33562, 'Starbucks', '375 Plandome Rd, Manhasset, NY 11030, USA'), -- chain
    (33563, 'Starbucks', '24 State St, Pittsford, NY 14534, USA'), -- chain
    (33564, 'Starbucks', 'County Rd 64, Elmira, NY 14814, USA'), -- chain
    (33565, 'Starbucks', '4770 Transit Rd, Depew, NY 14043, USA'), -- chain
    (33566, 'Starbucks', '4920 Transit Rd, Depew, NY 14043, USA'), -- chain
    (33567, 'Starbucks', '1 Wall St, Huntington, NY 11743, USA'), -- chain
    (33568, 'Starbucks', '17 Soundview Market Pl, Port Washington, NY 11050, USA'), -- chain
    (33569, 'Starbucks', '528 Smith Haven Mall, Lake Grove, NY 11755, USA'), -- chain
    (33570, 'Starbucks', '5622 Amanda Ln, Orchard Park, NY 14127, USA'), -- chain
    (33571, 'Starbucks', '1 State, Alfred, NY 14802, USA'), -- chain
    (33572, 'Starbucks', '334 NY-212, Saugerties, NY 12477, USA'), -- chain
    (33573, 'Starbucks', '41 S Moger Ave, Mt Kisco, NY 10549, USA'), -- chain
    (33574, 'Starbucks', '944 Fairmount Ave, Jamestown, NY 14701, USA'), -- chain
    (33575, 'Starbucks', '246 NY-25A, Setauket- East Setauket, NY 11733, USA'), -- chain
    (33576, 'Starbucks', '6726 US-9, Rhinebeck, NY 12572, USA'), -- chain
    (33577, 'Starbucks', '371 Sunrise Highway North Service Road, Waverly Ave, Patchogue, NY 11772, USA'), -- chain
    (33578, 'Starbucks', '159 W Main St, Patchogue, NY 11772, USA'), -- chain
    (33579, 'Starbucks', '1557 Albany Post Rd, Wappingers Falls, NY 12590, USA'), -- chain
    (33580, 'Starbucks', '1454 US-9, Lake George, NY 12845, USA'), -- chain
    (33581, 'Starbucks', '1641 County Rd 64, Horseheads, NY 14845, USA'), -- chain
    (33582, 'Starbucks', '600 White Plains Rd, Tarrytown, NY 10591, USA'), -- chain
    (33583, 'Starbucks', 'Ransley Square, 11 US-9, Fishkill, NY 12524, USA'), -- chain
    (33584, 'Starbucks', '351 Merrick Rd, Amityville, NY 11701, USA'), -- chain
    (33585, 'Starbucks', '803 Broadway, Amityville, NY 11701, USA'), -- chain
    (33586, 'Starbucks', 'Retail Center, 7567 Oswego Rd Rt. 57, Liverpool, NY 13090, USA'), -- chain
    (33587, 'Starbucks', '215 North Airmont Road, Square #59, Airmont, NY 10901, USA'), -- chain
    (33588, 'Starbucks', '251-05 Jamaica Ave, Queens, NY 11426, USA'), -- chain
    (33589, 'Starbucks', '3701 Express Dr S, Islandia, NY 11749, USA'), -- chain
    (33590, 'Starbucks', '29 Park Pl, Bronxville, NY 10708, USA'), -- chain
    (33591, 'Starbucks', '118 S Ridge St, Rye Brook, NY 10573, USA'), -- chain
    (33592, 'Starbucks', '108 Clowes Ave, Goshen, NY 10924, USA'), -- chain
    (33593, 'Starbucks', '6 Great Neck Rd, Great Neck Plaza, NY 11021, USA'), -- chain
    (33594, 'Starbucks', '2576 NY-5S, Little Falls, NY 13365, USA'), -- chain
    (33595, 'Starbucks', '2691, Empire State Trl, Little Falls, NY 13365, USA'), -- chain
    (33596, 'Starbucks', '108 Ravine Pkwy, Oneonta, NY 13820, USA'), -- chain
    (33597, 'Starbucks', '55 Northern Blvd, Great Neck, NY 11021, USA'), -- chain
    (33598, 'Starbucks', '653 Hillside Ave., New Hyde Park, NY 11040, USA'), -- chain
    (33599, 'Starbucks', '316 Rockaway Turnpike, Cedarhurst, NY 11516, USA'), -- chain
    (33600, 'Starbucks', '2810 W State St, Olean, NY 14760, USA'), -- chain
    (33601, 'Starbucks Reserve Roastery New York', '61 9th Ave, New York, NY 10011, USA'), -- chain
    (34369, 'Starbucks', '1005 W Coulter Ave, Powell, WY 82435, USA'), -- chain
    (34370, 'Starbucks', '2409 Plaza St, Rawlins, WY 82301, USA'), -- chain
    (34371, 'Starbucks', '1825 17th St, Cody, WY 82414, USA'), -- chain
    (34372, 'Starbucks', '118 Westland Way, Rock Springs, WY 82901, USA'), -- chain
    (34373, 'Starbucks', '1165 W Main St, Lander, WY 82520, USA'), -- chain
    (34935, 'Starbucks', '1590 NE 3rd St, Prineville, OR 97754, USA'), -- chain
    (34936, 'Starbucks', '1270 N Bayshore Dr, Coos Bay, OR 97420, USA'), -- chain
    (34937, 'Starbucks', '230 E Johnson Ave, Coos Bay, OR 97420, USA'), -- chain
    (34938, 'Starbucks', '2045 Newmark Ave, Coos Bay, OR 97420, USA'), -- chain
    (34939, 'Starbucks', '1625 W Central Ave, Sutherlin, OR 97479, USA'), -- chain
    (34940, 'Starbucks', '1525 W Main St, Molalla, OR 97038, USA'), -- chain
    (34941, 'Starbucks', '31330 OR-213, Molalla, OR 97038, USA'), -- chain
    (34942, 'Starbucks', '2500 N Main Ave, Tillamook, OR 97141, USA'), -- chain
    (34943, 'Starbucks', '210 Ivy Ave, Tillamook, OR 97141, USA'), -- chain
    (34944, 'Starbucks', '2230 N Main Ave, Tillamook, OR 97141, USA'), -- chain
    (34945, 'Starbucks', '25691 SE Stark St, Troutdale, OR 97060, USA'), -- chain
    (34946, 'Starbucks', '1882 E Baseline St, Cornelius, OR 97113, USA'), -- chain
    (34947, 'Starbucks', '19574 Molalla Ave, Oregon City, OR 97045, USA'), -- chain
    (34948, 'Starbucks', '1535 N First Ave, Stayton, OR 97383, USA'), -- chain
    (34949, 'Starbucks', '52001 Columbia River Hwy, Scappoose, OR 97056, USA'), -- chain
    (34950, 'Starbucks', '51501 Columbia River Hwy, Scappoose, OR 97056, USA'), -- chain
    (34951, 'Starbucks', '80 NE Cedar St, Madras, OR 97741, USA'), -- chain
    (34952, 'Starbucks', '709 Southgate, Pendleton, OR 97801, USA'), -- chain
    (34953, 'Starbucks', '203 SW 20th St, Pendleton, OR 97801, USA'), -- chain
    (34954, 'Starbucks', '1040 E Marina Dr, Hood River, OR 97031, USA'), -- chain
    (34955, 'Starbucks', '2712 Island Ave, La Grande, OR 97850, USA'), -- chain
    (34956, 'Starbucks', '2111 Adams Ave, La Grande, OR 97850, USA'), -- chain
    (34957, 'Starbucks', '2298 Gable Rd, St Helens, OR 97051, USA'), -- chain
    (35486, 'Starbucks', '18671 W Kellogg Dr, Goddard, KS 67052, USA'), -- chain
    (35487, 'Starbucks', '18731 W Kellogg Dr, Goddard, KS 67052, USA'), -- chain
    (35488, 'Starbucks', '1609 S Kansas Ave, Newton, KS 67114, USA'), -- chain
    (35489, 'Starbucks', '225 Cloud Ave, Andover, KS 67002, USA'), -- chain
    (35490, 'Starbucks', '4200 Shawnee Mission Pkwy, Fairway, KS 66205, USA'), -- chain
    (35491, 'Starbucks', '540 South 129th Street, Bonner Springs, KS 66012, USA'), -- chain
    (35492, 'Starbucks', '120 E 19th St, Ottawa, KS 66067, USA'), -- chain
    (35493, 'Starbucks', '2160 S Princeton Cir Dr, Ottawa, KS 66067, USA'), -- chain
    (35494, 'Starbucks', '2205 N 14th Ave #100, Dodge City, KS 67801, USA'), -- chain
    (35648, 'Starbucks', '568 W 14716 S, Bluffdale, UT 84065, USA'), -- chain
    (35656, 'Starbucks', '422 W 500 S, Bountiful, UT 84010, USA'), -- chain
    (35657, 'Starbucks', '555 S 200 W, Bountiful, UT 84010, USA'), -- chain
    (35677, 'Starbucks', '9946 N 4800 W, Cedar Hills, UT 84062, USA'), -- chain
    (35726, 'Starbucks', '744 N Main St, Heber City, UT 84032, USA'), -- chain
    (35727, 'Starbucks', '705 S Main St, Heber City, UT 84032, USA'), -- chain
    (35765, 'Starbucks', '8545 N Commerce Dr, Lake Point, UT 84074, USA'), -- chain
    (35793, 'Starbucks', 'Parking in the back, 37 N Main St, Logan, UT 84321, USA'), -- chain
    (35794, 'Starbucks', '4420 N 175 E, Logan, UT 84321, USA'), -- chain
    (35795, 'Starbucks', '724 Main St, Logan, UT 84321, USA'), -- chain
    (35835, 'Starbucks', '425 S Main St, Moab, UT 84532, USA'), -- chain
    (35846, 'Starbucks', '1620 N Main St, North Logan, UT 84341, USA'), -- chain
    (35907, 'Starbucks Coffee', '1926 Pleasant Grove Blvd, Pleasant Grove, UT 84062, USA'), -- chain
    (35913, 'Starbucks', '760 W Price River Dr, Price, UT 84501, USA'), -- chain
    (36020, 'Starbucks', '1024 N Main St, Tooele, UT 84074, USA'), -- chain
    (36055, 'Starbucks', '616 W 2600 S, Woods Cross, UT 84010, USA'), -- chain
    (36056, 'Starbucks', '680 W 2600 S, Woods Cross, UT 84087, USA'), -- chain
    (36456, 'Starbucks', '111 Celebrity Dr, Broussard, LA 70518, USA'), -- chain
    (36457, 'Starbucks', '1210 Albertson Pkwy, Broussard, LA 70518, USA'), -- chain
    (36458, 'Starbucks', '777 Coushatta Dr, Kinder, LA 70648, USA'), -- chain
    (36459, 'Starbucks', '1300 Sterlington Rd, Monroe, LA 71203, USA'), -- chain
    (36460, 'Starbucks', '10161 Florida Blvd, Walker, LA 70785, USA'), -- chain
    (36461, 'Starbucks', 'Center North, 5161 Citrus Blvd, Elmwood, LA 70123, USA'), -- chain
    (36462, 'Starbucks', '612 N Canal Blvd, Thibodaux, LA 70301, USA'), -- chain
    (36463, 'Starbucks', '2367 S Range Ave, Denham Springs, LA 70726, USA'), -- chain
    (36464, 'Starbucks', '31669 LA-16, Denham Springs, LA 70726, USA'), -- chain
    (36465, 'Starbucks', '27810 Juban Rd, Denham Springs, LA 70726, USA'), -- chain
    (36466, 'Starbucks', '2335 N Parkerson Ave, Crowley, LA 70526, USA'), -- chain
    (36467, 'Starbucks', '1200 Cooktown Rd, Ruston, LA 71270, USA'), -- chain
    (36468, 'Starbucks', '320 Keyser Ave, Natchitoches, LA 71457, USA'), -- chain
    (37334, 'Starbucks', '1406 E Yelm Ave, Yelm, WA 98597, USA'), -- chain
    (37335, 'Starbucks', '937 W Yelm Ave, Yelm, WA 98597, USA'), -- chain
    (37336, 'Starbucks', '804 W 1st St, Cle Elum, WA 98922, USA'), -- chain
    (37337, 'Starbucks', '518 S 1st St, Selah, WA 98942, USA'), -- chain
    (37338, 'Starbucks', '512 S 1st St, Selah, WA 98942, USA'), -- chain
    (37339, 'Starbucks', '8082 WA-539, Lynden, WA 98264, USA'), -- chain
    (37340, 'Starbucks', '8071 Guide Meridian Rd, Lynden, WA 98264, USA'), -- chain
    (37341, 'Starbucks', '5001 Olympic Dr, Gig Harbor, WA 98335, USA'), -- chain
    (37342, 'Starbucks', '1250 Basin St SW, Ephrata, WA 98823, USA'), -- chain
    (37343, 'Starbucks', '1150 Basin St NW, Ephrata, WA 98823, USA'), -- chain
    (37344, 'Starbucks', '26304 NE Big Rock Rd, Duvall, WA 98019, USA'), -- chain
    (37345, 'Starbucks', '903 Douglas Munro Blvd, Cle Elum, WA 98922, USA'), -- chain
    (37346, 'Starbucks', '10510 W Sunset Hwy, Airway Heights, WA 99001, USA'), -- chain
    (37347, 'Starbucks', '711 E 1st Ave, Toppenish, WA 98948, USA'), -- chain
    (37348, 'Starbucks', '613 S 6th St, Sunnyside, WA 98944, USA'), -- chain
    (37349, 'Starbucks', '31722 E Eugene St, Carnation, WA 98014, USA'), -- chain
    (37350, 'Starbucks', '391 N Main St, Colville, WA 99114, USA'), -- chain
    (37351, 'Starbucks', 'Fidalgo Square, 1720 Commercial Ave, Anacortes, WA 98221, USA'), -- chain
    (37352, 'Starbucks', '1531 NW Louisiana Ave, Chehalis, WA 98532, USA'), -- chain
    (37353, 'Starbucks', '1100 S Market Blvd, Chehalis, WA 98532, USA'), -- chain
    (37354, 'Starbucks', 'The Valley Mall Plaza, 500 A Valley Mall Pkwy, East Wenatchee, WA 98802, USA'), -- chain
    (37355, 'Starbucks', '1290 Rush Rd B, Napavine, WA 98532, USA'), -- chain
    (37356, 'Starbucks', '13780 NE 175th St, Woodinville, WA 98072, USA'), -- chain
    (37357, 'Starbucks', '17600 140th Ave NE, Woodinville, WA 98072, USA'), -- chain
    (37358, 'Starbucks', '442 W Sims Way, Port Townsend, WA 98368, USA'), -- chain
    (37359, 'Starbucks', '103 W Galbreath Way, Ritzville, WA 99169, USA'), -- chain
    (37360, 'Starbucks', '2623 Bickford Ave, Snohomish, WA 98290, USA'), -- chain
    (37361, 'Starbucks', '607 Omache Dr, Omak, WA 98841, USA'), -- chain
    (37362, 'Starbucks', '1095 W Washington St, Sequim, WA 98382, USA'), -- chain
    (37363, 'Starbucks', '4756 Pacific Hwy E, Fife, WA 98424, USA'), -- chain
    (37364, 'Starbucks', '5217 20th St E, Fife, WA 98424, USA'), -- chain
    (37365, 'Starbucks', '5151 Borgen Blvd North, Gig Harbor, WA 98332, USA'), -- chain
    (37366, 'Starbucks', '291 C St, Washougal, WA 98671, USA'), -- chain
    (37367, 'Starbucks', '34812 SE Douglas St, Snoqualmie, WA 98065, USA'), -- chain
    (37368, 'Starbucks', '10 Merlot Dr, Prosser, WA 99350, USA'), -- chain
    (37369, 'Starbucks', '100 N Minor Rd, Kelso, WA 98626, USA'), -- chain
    (37370, 'Starbucks', '411 Three Rivers Dr, Kelso, WA 98626, USA'), -- chain
    (37371, 'Starbucks', '205 Three Rivers Dr, Kelso, WA 98626, USA'), -- chain
    (37372, 'Starbucks', '1614 S Canyon Rd, Ellensburg, WA 98926, USA'), -- chain
    (37373, 'Starbucks', '215 Whitesell St NW, Orting, WA 98360, USA'), -- chain
    (37374, 'Starbucks Coffee Company', '903 Douglas Munro Blvd, Cle Elum, WA 98922, USA'), -- chain
    (37375, 'Starbucks North Lot', '8090 WA-539, Lynden, WA 98264, USA'), -- chain
    (37897, 'Starbucks', '2442 Main St NE, Los Lunas, NM 87031, USA'), -- chain
    (37898, 'Starbucks', '1905 W Main St, Artesia, NM 88210, USA'), -- chain
    (37899, 'Starbucks', '2B NM-344, Edgewood, NM 87015, USA'), -- chain
    (37900, 'Starbucks', '401 N Main St, Belen, NM 87002, USA'), -- chain
    (37901, 'Starbucks', '415 N Main Ave, Aztec, NM 87410, USA'), -- chain
    (37902, 'Starbucks', '2722 Sudderth Dr, Ruidoso, NM 88345, USA'), -- chain
    (37903, 'Starbucks', '170 US-550, Bernalillo, NM 87004, USA'), -- chain
    (37904, 'Starbucks', '1404 N Riverside Dr, Española, NM 87532, USA'), -- chain
    (37905, 'Starbucks', '224 Paseo Del Pueblo Sur, Taos, NM 87571, USA'), -- chain
    (38069, 'Starbucks at Ranger Market', '709 Oklahoma Blvd, Alva, OK 73717, USA'), -- chain
    (38083, 'Starbucks', '911 Holiday Dr, Ardmore, OK 73401, USA'), -- chain
    (38087, 'Starbucks', '2020 S Mississippi Ave, Atoka, OK 74525, USA'), -- chain
    (38125, 'Starbucks', '272 OK-259A, Broken Bow, OK 74728, USA'), -- chain
    (38146, 'Starbucks', '2304 S 4th St, Chickasha, OK 73018, USA'), -- chain
    (38150, 'Starbucks', '14307 NE 23rd St, Choctaw, OK 73020, USA'), -- chain
    (38160, 'Starbucks', '1100 S Lynn Riggs Blvd, Claremore, OK 74017, USA'), -- chain
    (38265, 'Starbucks', '12111 Vancouver Ave, Glenpool, OK 74033, USA'), -- chain
    (38349, 'Starbucks', '1325 Tanglewood Dr, McAlester, OK 74501, USA'), -- chain
    (38474, 'Starbucks', '1820 S Wood Dr, Okmulgee, OK 74447, USA'), -- chain
    (38485, 'Starbucks', '50 Ballard Rd, Pauls Valley, OK 73075, USA'), -- chain
    (38571, 'Starbucks', '3286 Cherokee Springs Rd, Tahlequah, OK 74464, USA'), -- chain
    (38618, 'Starbucks', '208 Blake Dr, Wagoner, OK 74467, USA') -- chain
);
