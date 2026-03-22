-- ============================================================
-- Seed: 002_additional_resorts.sql
-- Sprint 2 / Task s2-8 — Add 55 more ski resorts
-- Run via: psql $DATABASE_URL -f supabase/seeds/002_additional_resorts.sql
-- Or: npm run import-resorts:standalone  (reads data/resorts.csv instead)
-- ============================================================
-- Adds resorts across CO, UT, CA, WA, OR, MT, ID, WY, NM,
-- NY, VT, NH, MA, PA, VA, MD, MI, WI, MN, AZ, and BC.
-- snotel_station_id is included where a nearby NRCS station
-- is known (id format: plain integer string, state looked up
-- by the snotel-sync script as {id}:{state}:SNTL).
-- ============================================================

insert into resorts (name, slug, state, region, lat, lng, website_url, cam_page_url, snotel_station_id, is_active)
values
  -- Colorado (4 new)
  ('Purgatory Resort',           'purgatory',        'CO', 'San Juan Mountains',  37.6294, -107.8636, 'https://www.purgatoryresort.com',       'https://www.purgatoryresort.com/mountain/webcams',                              null,   true),
  ('Eldora Mountain Resort',     'eldora',           'CO', 'Front Range',         39.9386, -105.5839, 'https://www.eldora.com',                'https://www.eldora.com/mountain/conditions/webcams',                            null,   true),
  ('Sunlight Mountain Resort',   'sunlight',         'CO', 'Elk Mountains',       39.4581, -107.4231, 'https://sunlightmtn.com',               'https://sunlightmtn.com/mountain-webcam',                                       null,   true),
  ('Granby Ranch Ski Area',      'granby-ranch',     'CO', 'Grand County',        40.0728, -105.8933, 'https://granbyranch.com',               'https://granbyranch.com/webcam',                                                null,   true),

  -- Utah (4 new)
  ('Snowbasin Resort',           'snowbasin',        'UT', 'Northern Wasatch',    41.2161, -111.8564, 'https://www.snowbasin.com',             'https://www.snowbasin.com/mountain-information/webcams',                        '1070', true),
  ('Powder Mountain',            'powder-mountain',  'UT', 'Northern Wasatch',    41.3825, -111.7817, 'https://www.powdermountain.com',        'https://www.powdermountain.com/webcams',                                        null,   true),
  ('Brian Head Resort',          'brian-head',       'UT', 'Southern Utah',       37.6944, -112.8442, 'https://brianhead.com',                 'https://brianhead.com/webcams',                                                 null,   true),
  ('Sundance Mountain Resort',   'sundance',         'UT', 'Wasatch Range',       40.3928, -111.5897, 'https://www.sundanceresort.com',        'https://www.sundanceresort.com/webcams',                                        null,   true),

  -- California (5 new)
  ('June Mountain',              'june-mountain',    'CA', 'Eastern Sierra',      37.7683, -119.0761, 'https://www.junemountain.com',          'https://www.mammothmountain.com/on-the-mountain/june-mountain-webcam',          '1132', true),
  ('China Peak Mountain Resort', 'china-peak',       'CA', 'Central Sierra',      37.2319, -119.1561, 'https://skichinapeak.com',              'https://skichinapeak.com/webcams',                                              null,   true),
  ('Mt. Baldy Ski Lifts',        'mt-baldy',         'CA', 'Southern California', 34.2664, -117.6467, 'https://www.mtbaldy.com',               'https://www.mtbaldy.com/webcam',                                                null,   true),
  ('Snow Valley Mountain Resort','snow-valley',      'CA', 'Southern California', 34.2361, -117.0481, 'https://www.snow-valley.com',           'https://www.snow-valley.com/mountain-conditions/webcams',                      null,   true),
  ('Tahoe Donner Downhill Ski Area','tahoe-donner',  'CA', 'Lake Tahoe',          39.3786, -120.2597, 'https://tahoedonner.com',               'https://tahoedonner.com/amenities/downhill-skiing/',                            null,   true),

  -- Washington (4 new)
  ('Mt. Baker Ski Area',         'mt-baker',         'WA', 'North Cascades',      48.8561, -121.6722, 'https://www.mtbakerskiarea.com',        'https://www.mtbakerskiarea.com/conditions/webcams',                             '1011', true),
  ('White Pass Ski Area',        'white-pass',       'WA', 'Cascade Range',       46.6417, -121.3908, 'https://skiwhitepass.com',              'https://skiwhitepass.com/plan-your-visit/mountain-cams/',                       null,   true),
  ('49 Degrees North Mountain Resort','49-degrees-north','WA','Selkirk Mountains',48.4369, -117.4547, 'https://www.ski49n.com',                'https://www.ski49n.com/mountain/webcams',                                       null,   true),
  ('Ski Bluewood',               'ski-bluewood',     'WA', 'Blue Mountains',      46.1631, -117.8358, 'https://www.bluewood.com',              'https://www.bluewood.com/webcam',                                               null,   true),

  -- Oregon (3 new)
  ('Hoodoo Ski Area',            'hoodoo',           'OR', 'Cascade Range',       44.4028, -121.8617, 'https://hoodoo.com',                   'https://hoodoo.com/web-cams/',                                                  null,   true),
  ('Willamette Pass Resort',     'willamette-pass',  'OR', 'Cascade Range',       43.5931, -122.0508, 'https://willamettepass.com',            'https://willamettepass.com/webcam',                                             null,   true),
  ('Mt. Ashland Ski Area',       'mt-ashland',       'OR', 'Cascade Range',       42.0731, -122.7053, 'https://www.mtashland.com',             'https://www.mtashland.com/webcam',                                              null,   true),

  -- Montana (3 new)
  ('Whitefish Mountain Resort',  'whitefish',        'MT', 'Glacier Country',     48.4789, -114.3569, 'https://skiwhitefish.com',              'https://skiwhitefish.com/mountain/webcams',                                     '960',  true),
  ('Bridger Bowl Ski Area',      'bridger-bowl',     'MT', 'Gallatin Range',      45.8150, -110.9036, 'https://www.bridgerbowl.com',           'https://www.bridgerbowl.com/mountain-report/webcams',                           null,   true),
  ('Red Lodge Mountain',         'red-lodge',        'MT', 'Beartooth Range',     45.1606, -109.3547, 'https://www.redlodgemountain.com',      'https://www.redlodgemountain.com/mountain-report/webcams',                      null,   true),

  -- Idaho (2 new)
  ('Brundage Mountain Resort',   'brundage',         'ID', 'West-Central Idaho',  44.8236, -116.4189, 'https://brundage.com',                 'https://brundage.com/webcam',                                                   null,   true),
  ('Lookout Pass Ski Area',      'lookout-pass',     'ID', 'Bitterroot Mountains',47.4631, -115.7092, 'https://skilookout.com',               'https://skilookout.com/webcam',                                                 null,   true),

  -- Wyoming (1 new)
  ('Snow King Mountain',         'snow-king',        'WY', 'Teton Range',         43.4769, -110.7614, 'https://www.snowkingmountain.com',      'https://www.snowkingmountain.com/webcams',                                      null,   true),

  -- New Mexico (3 new)
  ('Angel Fire Resort',          'angel-fire',       'NM', 'Moreno Valley',       36.3903, -105.2878, 'https://www.angelfireresort.com',       'https://www.angelfireresort.com/webcams',                                       null,   true),
  ('Red River Ski Area',         'red-river',        'NM', 'Sangre de Cristo',    36.7056, -105.4028, 'https://redriverskiarea.com',           'https://redriverskiarea.com/cam',                                               null,   true),
  ('Ski Apache',                 'ski-apache',       'NM', 'Sacramento Mountains',33.4744, -105.7800, 'https://www.skiapache.com',             'https://www.skiapache.com/webcam',                                              null,   true),

  -- New York (5 new)
  ('Whiteface Mountain',         'whiteface',        'NY', 'Adirondacks',         44.3669,  -73.9033, 'https://www.whiteface.com',             'https://www.whiteface.com/webcam',                                              null,   true),
  ('Gore Mountain',              'gore',             'NY', 'Adirondacks',         43.6739,  -74.0036, 'https://www.goremountain.com',          'https://www.goremountain.com/webcam',                                           null,   true),
  ('Hunter Mountain',            'hunter',           'NY', 'Catskills',           42.1822,  -74.2103, 'https://www.huntermtn.com',             'https://www.huntermtn.com/webcam',                                              null,   true),
  ('Windham Mountain',           'windham',          'NY', 'Catskills',           42.2986,  -74.2447, 'https://windhammountain.com',           'https://windhammountain.com/webcam',                                            null,   true),
  ('Belleayre Mountain',         'belleayre',        'NY', 'Catskills',           42.1478,  -74.5039, 'https://www.belleayre.com',             'https://www.belleayre.com/webcam',                                              null,   true),

  -- Vermont (3 new)
  ('Mount Snow',                 'mount-snow',       'VT', 'Southern Vermont',    42.9631,  -72.9156, 'https://www.mountsnow.com',             'https://www.mountsnow.com/the-mountain/mountain-conditions/mountain-cams.aspx', null,   true),
  ('Pico Mountain',              'pico',             'VT', 'Green Mountains',     43.5961,  -72.8353, 'https://www.picomountain.com',          'https://www.picomountain.com/the-mountain/mountain-conditions/webcams',          null,   true),
  ('Smugglers'' Notch Resort',   'smugglers-notch',  'VT', 'Northern Vermont',    44.5592,  -72.7897, 'https://www.smuggs.com',                'https://www.smuggs.com/pages/winter/snowreport/',                               null,   true),

  -- New Hampshire (3 new)
  ('Wildcat Mountain',           'wildcat',          'NH', 'White Mountains',     44.2572,  -71.2381, 'https://www.skiwildcat.com',            'https://www.skiwildcat.com/webcams',                                            null,   true),
  ('Cranmore Mountain Resort',   'cranmore',         'NH', 'White Mountains',     44.0578,  -71.0839, 'https://www.cranmore.com',              'https://www.cranmore.com/webcam',                                               null,   true),
  ('Attitash Mountain Resort',   'attitash',         'NH', 'White Mountains',     44.0833,  -71.2219, 'https://www.attitash.com',              'https://www.attitash.com/the-mountain/mountain-conditions/mountain-cams.aspx',  null,   true),

  -- Massachusetts (2 new)
  ('Jiminy Peak Mountain Resort','jiminy-peak',      'MA', 'Berkshires',          42.6947,  -73.1853, 'https://www.jiminypeak.com',            'https://www.jiminypeak.com/mountain/webcam',                                    null,   true),
  ('Wachusett Mountain Ski Area','wachusett',        'MA', 'Central Massachusetts',42.4869, -71.8725, 'https://www.wachusett.com',             'https://www.wachusett.com/webcam',                                              null,   true),

  -- Pennsylvania (2 new)
  ('Seven Springs Mountain Resort','seven-springs',  'PA', 'Laurel Highlands',    39.9428,  -79.2906, 'https://www.7springs.com',              'https://www.7springs.com/webcam',                                               null,   true),
  ('Camelback Mountain Resort',  'camelback',        'PA', 'Pocono Mountains',    41.0833,  -75.3561, 'https://www.camelbackresort.com',       'https://www.camelbackresort.com/mountain/webcam',                               null,   true),

  -- Virginia / Maryland (2 new)
  ('Wintergreen Resort',         'wintergreen',      'VA', 'Blue Ridge Mountains',37.9639,  -79.0603, 'https://www.wintergreenresort.com',     'https://www.wintergreenresort.com/webcam',                                      null,   true),
  ('Wisp Resort',                'wisp',             'MD', 'Appalachians',        39.5108,  -79.3661, 'https://www.wispresort.com',            'https://www.wispresort.com/webcam',                                             null,   true),

  -- Michigan (3 new)
  ('Boyne Mountain Resort',      'boyne-mountain',   'MI', 'Northern Michigan',   45.1664,  -84.9328, 'https://www.boynemountain.com',         'https://www.boynemountain.com/the-mountain/webcams',                            null,   true),
  ('Nub''s Nob Ski Area',        'nubs-nob',         'MI', 'Northern Michigan',   45.3856,  -84.8556, 'https://www.nubsnob.com',               'https://www.nubsnob.com/webcam',                                                null,   true),
  ('Marquette Mountain',         'marquette-mountain','MI','Upper Peninsula',     46.5564,  -87.3986, 'https://marquettemountain.com',         'https://marquettemountain.com/webcam',                                          null,   true),

  -- Wisconsin (1 new)
  ('Granite Peak Ski Area',      'granite-peak',     'WI', 'Rib Mountain',        44.9131,  -89.6736, 'https://www.skigranitepeak.com',        'https://www.skigranitepeak.com/webcam',                                         null,   true),

  -- Minnesota (2 new)
  ('Lutsen Mountains',           'lutsen',           'MN', 'North Shore',         47.6578,  -90.6975, 'https://www.lutsen.com',                'https://www.lutsen.com/mountain-conditions/webcams',                            null,   true),
  ('Spirit Mountain',            'spirit-mountain',  'MN', 'Duluth',              46.7342,  -92.2219, 'https://www.spiritmt.com',              'https://www.spiritmt.com/webcam',                                               null,   true),

  -- Arizona (1 new)
  ('Arizona Snowbowl',           'arizona-snowbowl', 'AZ', 'San Francisco Peaks', 35.3342, -111.7111, 'https://www.arizonasnowbowl.com',       'https://www.arizonasnowbowl.com/webcam',                                        null,   true),

  -- British Columbia (2 new)
  ('Sun Peaks Resort',           'sun-peaks',        'BC', 'Thompson-Okanagan',   50.8831, -119.8872, 'https://www.sunpeaksresort.com',        'https://www.sunpeaksresort.com/mountain-info/webcams',                          null,   true),
  ('Big White Ski Resort',       'big-white',        'BC', 'Okanagan Highlands',  49.7272, -118.9358, 'https://www.bigwhite.com',              'https://www.bigwhite.com/webcam',                                               null,   true)

on conflict (slug) do nothing;
