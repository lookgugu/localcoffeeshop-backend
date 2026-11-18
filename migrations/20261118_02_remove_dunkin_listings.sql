-- Migration: Remove Dunkin' / Dunkin' Donuts chain listings
-- Created: 2026-11-18
--
-- The directory is for independent, local coffee shops, but the seed data
-- included 369 Dunkin' / Dunkin' Donuts locations (including co-branded
-- Dunkin / Baskin Robbins locations). This removes all 369 of them, each
-- matched on id AND name AND address so it can never remove a different shop.
-- Runs after 20261030_01, so each id is the copy it kept.
--
-- coffee_shops_fts is not touched: see 20261030_01.
--
-- Forward-only, like the 20261017, 20261030 and 20261118_01 migrations: no
-- down section, so `migrate.js down` refuses rather than resurrecting
-- removed listings.

-- migration:up

DELETE FROM coffee_shops
WHERE (id, name, address) IN (VALUES
    (513, 'Dunkin''', '9218 FL-228, Macclenny, FL 32063, USA'), -- chain
    (514, 'Dunkin''', '1480 US-331, Defuniak Springs, FL 32435, USA'), -- chain
    (515, 'Dunkin''', '610 N Orange Ave, Green Cove Springs, FL 32043, USA'), -- chain
    (516, 'Dunkin''', '3504 U.S. Hwy 27 S, Sebring, FL 33870, USA'), -- chain
    (517, 'Dunkin''', '5216 Hardware Pl, Sebring, FL 33872, USA'), -- chain
    (518, 'Dunkin''', '13149 US-301, Dade City, FL 33525, USA'), -- chain
    (519, 'Dunkin''', '201 US Hwy 27 N, Avon Park, FL 33825, USA'), -- chain
    (520, 'Dunkin''', '6011 SE Abshier Blvd, Belleview, FL 34420, USA'), -- chain
    (521, 'Dunkin''', '1401 Reid St, Palatka, FL 32177, USA'), -- chain
    (522, 'Dunkin''', '631 NE 5th St, Crystal River, FL 34429, USA'), -- chain
    (523, 'Dunkin''', '631 S Walnut St, Starke, FL 32091, USA'), -- chain
    (524, 'Dunkin''', '599 S Stone Way, Inverness, FL 34453, USA'), -- chain
    (525, 'Dunkin''', '15689 Southern Blvd, Loxahatchee Groves, FL 33470, USA'), -- chain
    (526, 'Dunkin''', '722 US-1, Tequesta, FL 33469, USA'), -- chain
    (527, 'Dunkin''', '1042 S 6th Ave, Wauchula, FL 33873, USA'), -- chain
    (528, 'Dunkin''', '715 W Main St, Inverness, FL 34450, USA'), -- chain
    (529, 'Dunkin''', '1400 S Main St, Belle Glade, FL 33430, USA'), -- chain
    (1809, 'Dunkin''', '524 Independence Blvd, Hardeeville, SC 29927, USA'), -- chain
    (1810, 'Dunkin''', 'In Pilot Travel Center, 15976 Whyte Hardee Blvd, Hardeeville, SC 29927, USA'), -- chain
    (1811, 'Dunkin''', '1089 S Fourth St, Hartsville, SC 29550, USA'), -- chain
    (1812, 'Dunkin''', 'The Markette, 6515 E Palmetto St Store #20, Florence, SC 29506, USA'), -- chain
    (1813, 'Dunkin''', '4727 Forest Dr, Columbia, SC 29206, USA'), -- chain
    (1814, 'Dunkin''', '1504 SC-38, Latta, SC 29565, USA'), -- chain
    (1815, 'Dunkin''', '1457 Bells Hwy, Walterboro, SC 29488, USA'), -- chain
    (1816, 'Dunkin''', '709 Radford Blvd, Dillon, SC 29536, USA'), -- chain
    (1817, 'Dunkin''', '1014 Edgefield Rd, North Augusta, SC 29860, USA'), -- chain
    (2272, 'Dunkin''', '2708 Pine St, Arkadelphia, AR 71923, USA'), -- chain
    (2813, 'Dunkin''', '601 Legion Rd, Denton, MD 21629, USA'), -- chain
    (2814, 'Dunkin''', '5603 Riverdale Rd, Riverdale Park, MD 20737, USA'), -- chain
    (2815, 'Dunkin''', '103 Silo Hill Pkwy, Emmitsburg, MD 21727, USA'), -- chain
    (2816, 'Dunkin''', '130 Frederick Rd Suite A, Thurmont, MD 21788, USA'), -- chain
    (2817, 'Dunkin''', '500 E Baltimore St, Taneytown, MD 21787, USA'), -- chain
    (2818, 'Dunkin''', '30415 Umes Blvd, Princess Anne, MD 21853, USA'), -- chain
    (2819, 'Dunkin''', '7903 Annapolis Rd, Lanham, MD 20706, USA'), -- chain
    (2820, 'Dunkin''', 'Frostburg Plaza Shopping Center, 10711 New Georges Creek Rd SW, Frostburg, MD 21532, USA'), -- chain
    (2821, 'Dunkin''', '130 N. East Rd, NE Plaza, North East, MD 21901, USA'), -- chain
    (2822, 'Dunkin''', '3125 Joseph Biggs Memorial Hwy, North East, MD 21901, USA'), -- chain
    (3643, 'Dunkin''', '101 Canton Rd, Wintersville, OH 43953, USA'), -- chain
    (3644, 'Dunkin''', 'Shell Gas Station, 1718 OH-60, Vermilion, OH 44089, USA'), -- chain
    (3645, 'Dunkin''', '568 W Marion St, Mt Gilead, OH 43338, USA'), -- chain
    (3646, 'Dunkin''', '15679 OH-170, East Liverpool, OH 43920, USA'), -- chain
    (3647, 'Dunkin''', '1987 Sunset Blvd, Steubenville, OH 43952, USA'), -- chain
    (3648, 'Dunkin''', '750 State Rte 97 W, Bellville, OH 44813, USA'), -- chain
    (3649, 'Dunkin''', '233 S 2nd St, Coshocton, OH 43812, USA'), -- chain
    (3650, 'Dunkin''', '2222 E Prospect Rd, Ashtabula, OH 44004, USA'), -- chain
    (3651, 'Dunkin''', '1150 S Broadway, Geneva, OH 44041, USA'), -- chain
    (3652, 'Dunkin''', '3299 Niles Cortland Rd NE, Cortland, OH 44410, USA'), -- chain
    (3653, 'Dunkin''', '7742 Lakeshore Blvd, Mentor, OH 44060, USA'), -- chain
    (3654, 'Dunkin''', '499 OH-103, Bluffton, OH 45817, USA'), -- chain
    (3655, 'Dunkin’', '905 Apollo Dr, Wapakoneta, OH 45895, USA'), -- chain
    (5109, 'Dunkin''', '1798 N Sandhills Blvd Ste A, Aberdeen, NC 28315, USA'), -- chain
    (5131, 'Dunkin''', '716 NC-24, Albemarle, NC 28001, USA'), -- chain
    (5349, 'Dunkin''', '801 NC-211, Candor, NC 27229, USA'), -- chain
    (5443, 'Dunkin''', '925 Sunset Ave, Clinton, NC 28328, USA'), -- chain
    (5460, 'Dunkin''', '1343 Rock Barn Rd NE, Conover, NC 28613, USA'), -- chain
    (5461, 'Dunkin''', '112 Thornburg Dr SE, Conover, NC 28613, USA'), -- chain
    (5525, 'Dunkin''', '1510 W Ehringhaus St, Elizabeth City, NC 27909, USA'), -- chain
    (5526, 'Dunkin''', '3845 Conlon Way Suite A, Elizabeth City, NC 27909, USA'), -- chain
    (5821, 'Dunkin''', '1000 Truckstop Rd, Kenly, NC 27542, USA'), -- chain
    (5865, 'Dunkin''', '1201 S Main St, Laurinburg, NC 28352, USA'), -- chain
    (6032, 'Dunkin''', '2424 S Croatan Hwy, Nags Head, NC 27959, USA'), -- chain
    (6053, 'Dunkin''', '120 Taberna Way, New Bern, NC 28562, USA'), -- chain
    (6054, 'Dunkin''', '2315 Neuse Blvd, New Bern, NC 28560, USA'), -- chain
    (6178, 'Dunkin''', '1640 Julian R Allsbrook Hwy Suite 27, Roanoke Rapids, NC 27870, USA'), -- chain
    (6186, 'Dunkin''', '1501 E Broad Ave Suite A, Rockingham, NC 28379, USA'), -- chain
    (6392, 'Dunkin''', '1170 Dellwood Rd, Waynesville, NC 28786, USA'), -- chain
    (6417, 'Dunkin''', '1006 Smyrna Dr, Whiteville, NC 28472, USA'), -- chain
    (7027, 'Dunkin''', '27050 Telegraph Rd, Flat Rock, MI 48134, USA'), -- chain
    (7028, 'Dunkin''', '1253 10th Ave, Menominee, MI 49858, USA'), -- chain
    (7029, 'Dunkin''', '10511 Red Arrow Hwy, Bridgman, MI 49106, USA'), -- chain
    (8045, 'Dunkin''', '10410 McCorkle Ave, Marmet, WV 25315, USA'), -- chain
    (8046, 'Dunkin''', '250 Three Springs Dr, Weirton, WV 26062, USA'), -- chain
    (8047, 'Dunkin''', '33 W Virginia Way, Ranson, WV 25438, USA'), -- chain
    (8048, 'Dunkin''', '2001 Sutton Ln, Sutton, WV 26601, USA'), -- chain
    (8049, 'Dunkin''', '2005 Harper Rd, Beckley, WV 25801, USA'), -- chain
    (8050, 'Dunkin''', 'In Exxon Gas Station, 4223 Robert C Byrd Dr, Beckley, WV 25801, USA'), -- chain
    (8051, 'Dunkin''', '18 Walmart Dr, Moundsville, WV 26041, USA'), -- chain
    (8843, 'Dunkin''', '131 North St, Calais, ME 04619, USA'), -- chain
    (10486, 'Dunkin''', '100 Paul Bunyan Dr S, Bemidji, MN 56601, USA'), -- chain
    (11539, 'Dunkin''', '832 Voluntown Rd In Valero, Griswold, CT 06351, USA'), -- chain
    (12130, 'Dunkin''', '2601 Hwy 49 W, Pleasant View, TN 37146, USA'), -- chain
    (12131, 'Dunkin''', '502 Gordonsville Hwy, Gordonsville, TN 38563, USA'), -- chain
    (12132, 'Dunkin''', '757 N Main St, Crossville, TN 38555, USA'), -- chain
    (12133, 'Dunkin''', '4234 US-127, Crossville, TN 38571, USA'), -- chain
    (12134, 'Dunkin''', '1021 US-321, Lenoir City, TN 37771, USA'), -- chain
    (12135, 'Dunkin''', '640 Dixie Lee Ave, Monteagle, TN 37356, USA'), -- chain
    (12136, 'Dunkin’', '770 US-51 BYP, Dyersburg, TN 38024, USA'), -- chain
    (13201, 'Dunkin''', '2804 20th Ave, Valley, AL 36854, USA'), -- chain
    (13202, 'Dunkin''', '1600 Co Rd 437, Cullman, AL 35055, USA'), -- chain
    (13203, 'Dunkin''', '1609 Woodward Ave, Muscle Shoals, AL 35661, USA'), -- chain
    (13204, 'Dunkin''', '3352 Rainbow Dr, Rainbow City, AL 35906, USA'), -- chain
    (13205, 'Dunkin''', '901 Glenn Blvd SW, Fort Payne, AL 35967, USA'), -- chain
    (14541, 'Dunkin''', '1030 W Fulton St, Waupaca, WI 54981, USA'), -- chain
    (14542, 'Dunkin''', '2121 8th St S, Wisconsin Rapids, WI 54494, USA'), -- chain
    (14543, 'Dunkin''', '404 West Main St, Waunakee, WI 53597, USA'), -- chain
    (14544, 'Dunkin''', '3005 Vlg Pk Dr, Plover, WI 54467, USA'), -- chain
    (14545, 'Dunkin''', '609 WI-54, Black River Falls, WI 54615, USA'), -- chain
    (14546, 'Dunkin''', '245 US-151 BUS Suite 100, Platteville, WI 53818, USA'), -- chain
    (14547, 'Dunkin''', '10 Viking Dr, Reedsburg, WI 53959, USA'), -- chain
    (14548, 'Dunkin''', '1287 N Main St, River Falls, WI 54022, USA'), -- chain
    (14549, 'Dunkin''', '69 Commerce St, Wisconsin Dells, WI 53965, USA'), -- chain
    (14550, 'Dunkin''', '2415 Wisconsin Dells Pkwy, Wisconsin Dells, WI 53965, USA'), -- chain
    (14551, 'Dunkin''', '1209A E Green Bay St, Shawano, WI 54166, USA'), -- chain
    (14552, 'Dunkin''', '2320 WI-25, Menomonie, WI 54751, USA'), -- chain
    (14553, 'Dunkin''', '90 Riverside Square, Prairie du Chien, WI 53821, USA'), -- chain
    (14554, 'Dunkin''', '1825 N Superior Ave, Tomah, WI 54660, USA'), -- chain
    (15804, 'Dunkin', '1270 Big A Rd, Toccoa, GA 30577, USA'), -- chain
    (15805, 'Dunkin''', '589 Battlefield Pkwy, Fort Oglethorpe, GA 30742, USA'), -- chain
    (15806, 'Dunkin''', '8116 Wells St, Senoia, GA 30276, USA'), -- chain
    (15807, 'Dunkin''', '706 E 1st St, Vidalia, GA 30474, USA'), -- chain
    (15808, 'Dunkin''', '604 Elbert St, Elberton, GA 30635, USA'), -- chain
    (15809, 'Dunkin''', '487 Washington St, Clarkesville, GA 30523, USA'), -- chain
    (15810, 'Dunkin''', '539 Hwy 441, Clayton, GA 30525, USA'), -- chain
    (15811, 'Dunkin''', '3629 Mundy Mill Rd, Oakwood, GA 30566, USA'), -- chain
    (15812, 'Dunkin''', '1966 N Columbia St Suite 12, Milledgeville, GA 31061, USA'), -- chain
    (15813, 'Dunkin''', '3068 Panola Rd #1, Lithonia, GA 30038, USA'), -- chain
    (15814, 'Dunkin''', '135 Commerce Dr, Villa Rica, GA 30180, USA'), -- chain
    (15815, 'Dunkin''', '95 Liberty Rd, Villa Rica, GA 30180, USA'), -- chain
    (15816, 'Dunkin''', '364 Mirror Lake Blvd Suite 401, Villa Rica, GA 30180, USA'), -- chain
    (15817, 'Dunkin''', '14177 Jones St, Lavonia, GA 30553, USA'), -- chain
    (15818, 'Dunkin''', '4152 Atlanta Hwy, Loganville, GA 30052, USA'), -- chain
    (15819, 'Dunkin''', '2630 Old Winder Hwy, Braselton, GA 30517, USA'), -- chain
    (15820, 'Dunkin''', '541 W Oglethorpe Hwy, Hinesville, GA 31313, USA'), -- chain
    (15821, 'Dunkin''', '16 Bracketts Way, Blairsville, GA 30512, USA'), -- chain
    (15822, 'Dunkin''', '1523 Veterans Pkwy Suite A, Columbus, GA 31901, USA'), -- chain
    (15823, 'Dunkin''', '1097 US-19, Thomaston, GA 30286, USA'), -- chain
    (15824, 'Dunkin''', '385 S Main St, Hiawassee, GA 30546, USA'), -- chain
    (15825, 'Dunkin''', '7201 GA-21, Port Wentworth, GA 31407, USA'), -- chain
    (15826, 'Dunkin''', '600 Howard Simmons Rd, Ellijay, GA 30540, USA'), -- chain
    (15827, 'Dunkin''', '100 12th St Suite A, Rincon, GA 31326, USA'), -- chain
    (15828, 'Dunkin''', '2403 Plant Ave, Waycross, GA 31501, USA'), -- chain
    (16846, 'Dunkin''', '1660 E Commercial Ave, Lowell, IN 46356, USA'), -- chain
    (16847, 'Dunkin''', '1230 W McClain Ave, Scottsburg, IN 47170, USA'), -- chain
    (16848, 'Dunkin''', '300 W 30th St, Connersville, IN 47331, USA'), -- chain
    (16849, 'Dunkin''', '1371 Joliet St, Dyer, IN 46311, USA'), -- chain
    (16850, 'Dunkin''', '100 W Eads Pkwy, Lawrenceburg, IN 47025, USA'), -- chain
    (16851, 'Dunkin''', '701 Plaza Dr, Chesterton, IN 46304, USA'), -- chain
    (18189, 'Dunkin''', '1880 N Westwood Blvd, Poplar Bluff, MO 63901, USA'), -- chain
    (19307, 'Dunkin''', '300 S Water St, Kittanning, PA 16201, USA'), -- chain
    (19308, 'Dunkin''', '1769 N Susquehanna Trail, Selinsgrove, PA 17870, USA'), -- chain
    (19309, 'Dunkin''', '219 W Front St, Berwick, PA 18603, USA'), -- chain
    (19310, 'Dunkin''', '200 W Sunbury St, Shamokin, PA 17872, USA'), -- chain
    (19311, 'Dunkin''', '611 E Main St, Middleburg, PA 17842, USA'), -- chain
    (19312, 'Dunkin''', '4 N Caln Rd, Coatesville, PA 19320, USA'), -- chain
    (19313, 'Dunkin''', '702 North Blakely Street, Dunmore, PA 18512, USA'), -- chain
    (19314, 'Dunkin''', '2705 Edgmont Ave, Brookhaven, PA 19015, USA'), -- chain
    (19315, 'Dunkin''', '4580 Edgmont Ave, Brookhaven, PA 19015, USA'), -- chain
    (19316, 'Dunkin''', '92 Bridge St, Lehighton, PA 18235, USA'), -- chain
    (19317, 'Dunkin''', '5 MacDade Blvd, Collingdale, PA 19023, USA'), -- chain
    (19318, 'Dunkin''', '4612 US-209, Elizabethville, PA 17023, USA'), -- chain
    (19319, 'Dunkin''', '600 N Derr Dr, Lewisburg, PA 17837, USA'), -- chain
    (19320, 'Dunkin''', '406 US-15, Dillsburg, PA 17019, USA'), -- chain
    (19321, 'Dunkin''', '627 Walnut St, Danville, PA 17821, USA'), -- chain
    (19322, 'Dunkin''', '101 Broad St, Delaware Water Gap, PA 18327, USA'), -- chain
    (19323, 'Dunkin''', '271 Market St Unit 1, Lemoyne, PA 17043, USA'), -- chain
    (19324, 'Dunkin''', '2527 US-6, Hawley, PA 18428, USA'), -- chain
    (19325, 'Dunkin''', '364 Hallstead Plaza, Hallstead, PA 18822, USA'), -- chain
    (19326, 'Dunkin''', '479 S Pennsylvania Ave, Centre Hall, PA 16828, USA'), -- chain
    (19327, 'Dunkin''', '301 US-19, Zelienople, PA 16063, USA'), -- chain
    (19328, 'Dunkin''', '107 E Main St, Bath, PA 18014, USA'), -- chain
    (19329, 'Dunkin''', 'Gerrity''s Shopping Plza, 801 Wyoming Ave, Pittston, PA 18643, USA'), -- chain
    (19330, 'Dunkin''', 'RR#1, Rte 6, Wyalusing, PA 18853, USA'), -- chain
    (19331, 'Dunkin''', '382 York Ave, Towanda, PA 18848, USA'), -- chain
    (19332, 'Dunkin''', '30 E Southern Ave, Williamsport, PA 17702, USA'), -- chain
    (19333, 'Dunkin''', '3132 Pleasant Valley Blvd, Altoona, PA 16602, USA'), -- chain
    (19334, 'Dunkin''', 'In Sunoco Gas Station, 48 PA-93, West Hazleton, PA 18202, USA'), -- chain
    (19335, 'Dunkin''', '1100 Chester Pike, Sharon Hill, PA 19079, USA'), -- chain
    (19336, 'Dunkin''', '10470 U.S. 522 S, Lewistown, PA 17044, USA'), -- chain
    (19337, 'Dunkin''', '927 S State St, Clarks Summit, PA 18411, USA'), -- chain
    (19338, 'Dunkin''', '848 Nazareth Pike, Nazareth, PA 18064, USA'), -- chain
    (19339, 'Dunkin''', '653 E Broad St, Souderton, PA 18964, USA'), -- chain
    (19340, 'Dunkin''', '420 Bellefonte Ave, Lock Haven, PA 17745, USA'), -- chain
    (19341, 'Dunkin''', '1424 S Main St, Mansfield, PA 16933, USA'), -- chain
    (19342, 'Dunkin''', '38 Sterling Rd, Mt Pocono, PA 18344, USA'), -- chain
    (19343, 'Dunkin''', '174 Harvest Ln, Pocono Summit, PA 18346, USA'), -- chain
    (19344, 'Dunkin''', '861 York Rd, Gettysburg, PA 17325, USA'), -- chain
    (19345, 'Dunkin''', '110 Burrell Plz, Lower Burrell, PA 15068, USA'), -- chain
    (19346, 'Dunkin''', '97 Nason Dr, Roaring Spring, PA 16673, USA'), -- chain
    (19347, 'Dunkin''', '855 S Broadway, Wind Gap, PA 18091, USA'), -- chain
    (19348, 'Dunkin''', '1918 Minno Dr Lower Yoder, Johnstown, PA 15905, USA'), -- chain
    (19349, 'Dunkin''', '439 Blue Valley Dr, Bangor, PA 18013, USA'), -- chain
    (19350, 'Dunkin''', '1669 Oakland Ave, Indiana, PA 15701, USA'), -- chain
    (19351, 'Dunkin''', '134 N Mill St, New Castle, PA 16101, USA'), -- chain
    (19352, 'Dunkin''', '1439 Scalp Ave, Johnstown, PA 15904, USA'), -- chain
    (19353, 'Dunkin''', '33A Narrows Shopping Center, Edwardsville, PA 18704, USA'), -- chain
    (19354, 'Dunkin''', '3525 Birney Ave, Moosic, PA 18507, USA'), -- chain
    (19355, 'Dunkin''', '413 Claude A Lord Blvd, Pottsville, PA 17901, USA'), -- chain
    (19356, 'Dunkin''', '3 Westwood Ctr, Pottsville, PA 17901, USA'), -- chain
    (19357, 'Dunkin''', '7503 Admiral Peary Hwy, Cresson, PA 16630, USA'), -- chain
    (19358, 'Dunkin''', '4030 Chestnut St, Emmaus, PA 18049, USA'), -- chain
    (19359, 'Dunkin''', '549 S Main St, Shrewsbury, PA 17361, USA'), -- chain
    (19360, 'Dunkin''', '1251 Scranton Carbondale Hwy, Scranton, PA 18508, USA'), -- chain
    (19361, 'Dunkin''', '400 Main St, Pennsburg, PA 18073, USA'), -- chain
    (19362, 'Dunkin''', '2525 5th Ave, McKeesport, PA 15132, USA'), -- chain
    (19363, 'Dunkin''', '1876 Delmar Dr, Folcroft, PA 19032, USA'), -- chain
    (19364, 'Dunkin''', '614 Grow Ave, Montrose, PA 18801, USA'), -- chain
    (19365, 'Dunkin''', '400 Terry Rich Blvd, St Clair, PA 17970, USA'), -- chain
    (19366, 'Dunkin''', '179 N Plaza Access Rd, Somerset, PA 15501, USA'), -- chain
    (19367, 'Dunkin''', '415 S Broad St, Grove City, PA 16127, USA'), -- chain
    (19368, 'Dunkin''', '1380 E Penn St, Muncy, PA 17756, USA'), -- chain
    (19369, 'Dunkin''', '2241 Lancaster Pike, Shillington, PA 19607, USA'), -- chain
    (19370, 'Dunkin''', '5007 Bristol Pike, Bristol, PA 19007, USA'), -- chain
    (19371, 'Dunkin''', '7 Main St, Wellsboro, PA 16901, USA'), -- chain
    (19372, 'Dunkin''', '304 S Main St, Slippery Rock, PA 16057, USA'), -- chain
    (19373, 'Dunkin''', '2 W Bridge St, Morrisville, PA 19067, USA'), -- chain
    (19374, 'Dunkin''', '395 W Trenton Ave, Morrisville, PA 19067, USA'), -- chain
    (19375, 'Dunkin''', '325 S Best Ave, Walnutport, PA 18088, USA'), -- chain
    (19376, 'Dunkin''', '200 Sierra Dr, Altoona, PA 16601, USA'), -- chain
    (19377, 'Dunkin''', '110 E Main St, Kutztown, PA 19530, USA'), -- chain
    (19378, 'Dunkin''', '122 Walnut Bottom Rd, Shippensburg, PA 17257, USA'), -- chain
    (19379, 'Dunkin''', '1871 Old Main Dr Shippensburg University, Shippensburg, PA 17257, USA'), -- chain
    (19380, 'Dunkin''', 'In Sunoco Gas Station, 308 S Main St, Pittston, PA 18640, USA'), -- chain
    (19381, 'Dunkin''', '101 S Keystone Ave, Sayre, PA 18840, USA'), -- chain
    (19382, 'Dunkin''', '949 N Elmira St, Sayre, PA 18840, USA'), -- chain
    (19383, 'Dunkin''', '2 Lane Hill Rd, Tunkhannock, PA 18657, USA'), -- chain
    (19384, 'Dunkin''', '1183 N 4th St, Sunbury, PA 17801, USA'), -- chain
    (19385, 'Dunkin''', '107 E Harford St, Milford, PA 18337, USA'), -- chain
    (21278, 'Dunkin''', '16189 S Sunshine Blvd, Eloy, AZ 85131, USA'), -- chain
    (22000, 'Dunkin''', '455 S Broadway, Gloucester City, NJ 08030, USA'), -- chain
    (22001, 'Dunkin''', '18 Sycamore Ave, Little Silver, NJ 07739, USA'), -- chain
    (22002, 'Dunkin''', '51 Main St, Ogdensburg, NJ 07439, USA'), -- chain
    (22003, 'Dunkin''', '9 NJ-36, Keansburg, NJ 07734, USA'), -- chain
    (22004, 'Dunkin''', '171 Main St, Keansburg, NJ 07734, USA'), -- chain
    (22005, 'Dunkin''', '7 NJ-71, Spring Lake, NJ 07762, USA'), -- chain
    (22006, 'Dunkin''', '107 NJ-35, Keyport, NJ 07735, USA'), -- chain
    (22007, 'Dunkin''', '709 N Black Horse Park, Haddon Heights, NJ 08035, USA'), -- chain
    (22008, 'Dunkin''', '257 South Ave, Fanwood, NJ 07023, USA'), -- chain
    (22009, 'Dunkin''', '25 US-206, Stanhope, NJ 07874, USA'), -- chain
    (22010, 'Dunkin''', '1161 NJ-23, Kinnelon, NJ 07405, USA'), -- chain
    (22011, 'Dunkin''', '99 Borelli Blvd, Paulsboro, NJ 08066, USA'), -- chain
    (22012, 'Dunkin''', '42 Hopatchung Rd, Hopatcong, NJ 07843, USA'), -- chain
    (22013, 'Dunkin''', '1277 Blackwood-Clementon Rd, Clementon, NJ 08021, USA'), -- chain
    (22014, 'Dunkin''', '106 White Horse Pike, Clementon, NJ 08021, USA'), -- chain
    (22015, 'Dunkin''', 'All American Plaza, 327 Slapes Corner Rd, Carneys Point Township, NJ 08069, USA'), -- chain
    (22016, 'Dunkin''', '610 Mantua Ave, Woodbury, NJ 08096, USA'), -- chain
    (22017, 'Dunkin''', '12 Green Pond Rd, Rockaway, NJ 07866, USA'), -- chain
    (22018, 'Dunkin''', '434 Main St, Spotswood, NJ 08884, USA'), -- chain
    (22019, 'Dunkin''', '1100 Mantua Pike, Wenonah, NJ 08090, USA'), -- chain
    (22020, 'Dunkin''', '75 Main St, South River, NJ 08882, USA'), -- chain
    (22021, 'Dunkin''', '1 W Hampton St, Pemberton, NJ 08068, USA'), -- chain
    (22022, 'Dunkin''', '201 E Main St, Tuckerton, NJ 08087, USA'), -- chain
    (22023, 'Dunkin''', '411 New Rd, Somers Point, NJ 08244, USA'), -- chain
    (22024, 'Dunkin''', '404 W Union Ave, Bound Brook, NJ 08805, USA'), -- chain
    (22025, 'Dunkin''', '109 E Main St Ste 111, Bound Brook, NJ 08805, USA'), -- chain
    (22026, 'Dunkin''', '260 US-130, Bordentown, NJ 08505, USA'), -- chain
    (22027, 'Dunkin''', '1111 US-322, Swedesboro, NJ 08085, USA'), -- chain
    (22028, 'Dunkin''', '435 Boulevard, Hasbrouck Heights, NJ 07604, USA'), -- chain
    (22029, 'Dunkin''', '330 W 8th St, Ship Bottom, NJ 08008, USA'), -- chain
    (22030, 'Dunkin''', '10 Rt 46 E, Netcong, NJ 07857, USA'), -- chain
    (22031, 'Dunkin''', '744 S Harding Hwy, Buena, NJ 08310, USA'), -- chain
    (22032, 'Dunkin''', '1029 NJ-34, Aberdeen Township, NJ 07747, USA'), -- chain
    (22033, 'Dunkin''', '156 NJ-31, Washington, NJ 07882, USA'), -- chain
    (22034, 'Dunkin''', '118 US-9, Pine Beach, NJ 08741, USA'), -- chain
    (22035, 'Dunkin''', 'Bjs Wholesale Club, 110 NJ-23, Riverdale, NJ 07457, USA'), -- chain
    (22036, 'Dunkin''', '72 Hamburg Turnpike, Riverdale, NJ 07457, USA'), -- chain
    (23072, 'Dunkin''', '109 Wapello St S, Mediapolis, IA 52637, USA'), -- chain
    (24677, 'Dunkin''', '24468 Lee Hwy, Abingdon, VA 24211, USA'), -- chain
    (24678, 'Dunkin''', '1318 E Lee Hwy, Wytheville, VA 24382, USA'), -- chain
    (24679, 'Dunkin''', '202 S Commerce Ave, Front Royal, VA 22630, USA'), -- chain
    (24680, 'Dunkin''', '114 South St, Front Royal, VA 22630, USA'), -- chain
    (24681, 'Dunkin''', '9886 Winchester Rd, Front Royal, VA 22630, USA'), -- chain
    (24682, 'Dunkin''', '1616 Tappahannock Blvd, Tappahannock, VA 22560, USA'), -- chain
    (25251, 'Dunkin''', '1103 S Main St, Andrews, TX 79714, USA'), -- chain
    (26268, 'Dunkin''', 'In Pilot Travel Center, 2000 FM 1488, Hempstead, TX 77445, USA'), -- chain
    (26535, 'Dunkin''', '4405 TX-42, Kilgore, TX 75662, USA'), -- chain
    (26770, 'Dunkin''', '901 RM 1431 Ste 100, Marble Falls, TX 78654, USA'), -- chain
    (26909, 'Dunkin''', 'Travel Center, 1955 N Kings Hwy, Nash, TX 75569, USA'), -- chain
    (26950, 'Dunkin''', '3032 Farm to Market Rd 720, Oak Point, TX 75068, USA'), -- chain
    (27006, 'Dunkin''', 'In Pilot Travel Center, 2500 S Bickley Ave, Pecos, TX 79772, USA'), -- chain
    (27606, 'Dunkin''', '580 N Main St, Vidor, TX 77662, USA'), -- chain
    (27809, 'Dunkin''', '15 E Plain St, Wayland, MA 01778, USA'), -- chain
    (28021, 'Dunkin''', '5 Union St, North Adams, MA 01247, USA'), -- chain
    (28339, 'Dunkin''', '386 E Main St, Southbridge, MA 01550, USA'), -- chain
    (28340, 'Dunkin''', '419-423 Main St, Southbridge, MA 01550, USA'), -- chain
    (28347, 'Dunkin''', '80 Main St, Carver, MA 02330, USA'), -- chain
    (28552, 'Dunkin''', '2410 High St, Crescent Springs, KY 41017, USA'), -- chain
    (28553, 'Dunkin''', '59 Broadway St, Dry Ridge, KY 41035, USA'), -- chain
    (28554, 'Dunkin''', '509 E Broadway St, Campbellsville, KY 42718, USA'), -- chain
    (29150, 'Dunkin''', '33364 Pennsylvania Ave, Bethany Beach, DE 19930, USA'), -- chain
    (29151, 'Dunkin''', '500 Bridgeville Hwy, Seaford, DE 19973, USA'), -- chain
    (30093, 'Dunkin / Baskin Robins', '3608 Vollmer Rd, Flossmoor, IL 60422, USA'), -- chain
    (30094, 'Dunkin Donuts/Baskin Robbins', '1 Marilla Park Rd, Streator, IL 61364, USA'), -- chain
    (30095, 'Dunkin''', '1400 W 127th St, Calumet Park, IL 60827, USA'), -- chain
    (30096, 'Dunkin''', '13661 Cicero Ave, Crestwood, IL 60445, USA'), -- chain
    (30097, 'Dunkin''', '4361 W 127th St, Alsip, IL 60803, USA'), -- chain
    (30098, 'Dunkin''', '12150 S Cicero Ave, Alsip, IL 60803, USA'), -- chain
    (30099, 'Dunkin''', '11843 S Pulaski Rd, Alsip, IL 60803, USA'), -- chain
    (30100, 'Dunkin''', '510 Auburn Dr A, Island Lake, IL 60042, USA'), -- chain
    (30101, 'Dunkin''', '780 N Main St, Elburn, IL 60119, USA'), -- chain
    (30102, 'Dunkin''', '892 S Main Street, East Dundee, IL 60118, USA'), -- chain
    (30103, 'Dunkin''', '6008 N Illinois St, Fairview Heights, IL 62208, USA'), -- chain
    (30104, 'Dunkin''', '23841 W Eames St, Channahon, IL 60410, USA'), -- chain
    (30105, 'Dunkin''', '1121 S Dixie Hwy Suite 3, Beecher, IL 60401, USA'), -- chain
    (30106, 'Dunkin''', '39090 US-41 Unit C, Wadsworth, IL 60083, USA'), -- chain
    (30107, 'Dunkin''', '11849 SW Hwy, Palos Heights, IL 60463, USA'), -- chain
    (30108, 'Dunkin''', '112 E Bethel Dr, Bourbonnais, IL 60914, USA'), -- chain
    (30109, 'Dunkin''', '8 US-12, Fox Lake, IL 60020, USA'), -- chain
    (30110, 'Dunkin''', '4632 Lincoln Hwy, Matteson, IL 60443, USA'), -- chain
    (30111, 'Dunkin''', '820 W Jackson St, Macomb, IL 61455, USA'), -- chain
    (30112, 'Dunkin''', '2377 N Bloomington St Suite B, Streator, IL 61364, USA'), -- chain
    (30113, 'Dunkin''', '8147 Joliet Rd, McCook, IL 60525, USA'), -- chain
    (30114, 'Dunkin''', '402 S Century Blvd, Rantoul, IL 61866, USA'), -- chain
    (30115, 'Dunkin''', '106 N Ridge Rd, Minooka, IL 60447, USA'), -- chain
    (30116, 'Dunkin''', '2081 Ridge Rd #125, Minooka, IL 60447, USA'), -- chain
    (30117, 'Dunkin''', '916 Northwest Hwy, Fox River Grove, IL 60021, USA'), -- chain
    (30118, 'Dunkin''', '1204 N Elmhurst Rd, Prospect Heights, IL 60070, USA'), -- chain
    (30119, 'Dunkin''', '1220 18th Street Suite 120, Silvis, IL 61282, USA'), -- chain
    (30120, 'Dunkin''', '5757 W Monee Manhattan Rd, Monee, IL 60449, USA'), -- chain
    (30121, 'Dunkin''', '369 E Rollins Rd, Round Lake Beach, IL 60073, USA'), -- chain
    (30122, 'Dunkin''', '4740 N River Rd, Schiller Park, IL 60176, USA'), -- chain
    (30123, 'Dunkin''', '9280 Irving Park Rd, Schiller Park, IL 60176, USA'), -- chain
    (30124, 'Dunkin''', '10131 W Grand Ave, Franklin Park, IL 60131, USA'), -- chain
    (30125, 'Dunkin''', '120 W Ashland St, Morton, IL 61550, USA'), -- chain
    (30126, 'Dunkin''', '3937 Sauk Trail, Richton Park, IL 60471, USA'), -- chain
    (30127, 'Dunkin''', '1004 W Irving Park Rd, Bensenville, IL 60106, USA'), -- chain
    (30128, 'Dunkin''', '1100 IL-83, Bensenville, IL 60106, USA'), -- chain
    (30129, 'Dunkin''', '3980 IL-22, Long Grove, IL 60047, USA'), -- chain
    (30130, 'Dunkin''', '454 Riverstone Pkwy, Kankakee, IL 60901, USA'), -- chain
    (30131, 'Dunkin''', '315 E Higgins Rd, Gilberts, IL 60136, USA'), -- chain
    (31483, 'Dunkin''', '100 Norfleet Dr, Senatobia, MS 38668, USA'), -- chain
    (32407, 'Dunkin''', '95 Saratoga Ave, South Glens Falls, NY 12803, USA'), -- chain
    (32408, 'Dunkin''', '1008 NY-29A, Gloversville, NY 12078, USA'), -- chain
    (32409, 'Dunkin''', '9032 N Seneca St, Weedsport, NY 13166, USA'), -- chain
    (32410, 'Dunkin''', '2501 Corning Rd, Elmira Heights, NY 14903, USA'), -- chain
    (32411, 'Dunkin''', '33 E Lincoln Ave, Village of Pelham, NY 10803, USA'), -- chain
    (32412, 'Dunkin''', '11378 Maple Ridge Rd, Medina, NY 14103, USA'), -- chain
    (32413, 'Dunkin''', '4179 Lakeville Rd, Geneseo, NY 14454, USA'), -- chain
    (32414, 'Dunkin''', 'In Gas Station, 4310 Lakeville Rd, Geneseo, NY 14454, USA'), -- chain
    (32415, 'Dunkin''', '8 Rock Island St, Gouverneur, NY 13642, USA'), -- chain
    (32416, 'Dunkin''', '125 Victory Hwy, Painted Post, NY 14870, USA'), -- chain
    (32417, 'Dunkin''', '371 S Main St, Massena, NY 13662, USA'), -- chain
    (32418, 'Dunkin''', '40 First St, Ilion, NY 13357, USA'), -- chain
    (32419, 'Dunkin''', '1147 Paterson St, Ogdensburg, NY 13669, USA'), -- chain
    (32420, 'Dunkin''', '182 Saw Mill River Rd, Elmsford, NY 10523, USA'), -- chain
    (32421, 'Dunkin''', '91 E Main St, Elmsford, NY 10523, USA'), -- chain
    (32422, 'Dunkin''', '135 Park St, Owego, NY 13827, USA'), -- chain
    (32423, 'Dunkin''', '122 W Main St, Chateaugay, NY 12920, USA'), -- chain
    (32424, 'Dunkin''', '1695 NY-38, Moravia, NY 13118, USA'), -- chain
    (32425, 'Dunkin''', '370 Plandome Rd, Manhasset, NY 11030, USA'), -- chain
    (32426, 'Dunkin''', '2001 College Ave, Elmira, NY 14901, USA'), -- chain
    (32427, 'Dunkin''', '301 Madison Ave, Elmira, NY 14901, USA'), -- chain
    (32428, 'Dunkin''', '1050 NY-36, Hornell, NY 14843, USA'), -- chain
    (32429, 'Dunkin''', '14 N Airmont Rd, Suffern, NY 10901, USA'), -- chain
    (32430, 'Dunkin''', '262 NY-59, Suffern, NY 10901, USA'), -- chain
    (32431, 'Dunkin''', '116 W Main St, Honeoye Falls, NY 14472, USA'), -- chain
    (32432, 'Dunkin''', '3682 NY-30, Broadalbin, NY 12025, USA'), -- chain
    (32433, 'Dunkin''', '70 Teneyck Ave, Greenwood Lake, NY 10925, USA'), -- chain
    (32434, 'Dunkin''', '1669 Montauk Hwy, Bellport, NY 11713, USA'), -- chain
    (32435, 'Dunkin''', 'Bjs Wholesale Club, 790 Sunrise Hwy, Bellport, NY 11713, USA'), -- chain
    (32436, 'Dunkin''', '2877 E Main St, Parish, NY 13131, USA'), -- chain
    (32437, 'Dunkin''', '1582 US-9, Wappingers Falls, NY 12590, USA'), -- chain
    (32438, 'Dunkin''', '3 Spaulding Ave, Malone, NY 12953, USA'), -- chain
    (32439, 'Dunkin''', '3414 US-11, Malone, NY 12953, USA'), -- chain
    (32440, 'Dunkin''', '1165 NY-374, Dannemora, NY 12929, USA'), -- chain
    (32441, 'Dunkin''', '40 Rte 9W, West Haverstraw, NY 10993, USA'), -- chain
    (32442, 'Dunkin''', '311 S Franklin St, Watkins Glen, NY 14891, USA'), -- chain
    (32443, 'Dunkin''', '9924 NY-408, Dalton, NY 14836, USA'), -- chain
    (32444, 'Dunkin''', '306 Fayette St, Manlius, NY 13104, USA'), -- chain
    (32445, 'Dunkin''', '900 E Genesee St, Chittenango, NY 13037, USA'), -- chain
    (32446, 'Dunkin''', '106 Park Pl, Schoharie, NY 12157, USA'), -- chain
    (32447, 'Dunkin''', '267 S Ridge St, Rye Brook, NY 10573, USA'), -- chain
    (32448, 'Dunkin''', '7535 W Ridge Rd, Brockport, NY 14420, USA'), -- chain
    (32449, 'Dunkin''', '2244 Downer St, Baldwinsville, NY 13027, USA'), -- chain
    (32450, 'Dunkin''', '125 Conhocton St, Corning, NY 14830, USA'), -- chain
    (32451, 'Dunkin''', '291 E Main St, Port Jervis, NY 12771, USA'), -- chain
    (32452, 'Dunkin''', '601 Jericho Turnpike, New Hyde Park, NY 11040, USA'), -- chain
    (32453, 'Dunkin''', '1600 Hillside Ave., New Hyde Park, NY 11040, USA'), -- chain
    (32454, 'Dunkin''', '3242 NY-417, Olean, NY 14760, USA'), -- chain
    (32455, 'Dunkin''', '9475 Airport Plaza, Dansville, NY 14437, USA') -- chain
);
