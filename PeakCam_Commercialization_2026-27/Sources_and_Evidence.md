# Source & Evidence Register

Research date: September 9, 2026. Sources are current where retrievable. Public contact routes are not confirmed buying authority or deliverability. Exact rates, rules and staff roles should be rechecked before commitment.

| ID | Source | URL | Evidence / limitation |
| --- | --- | --- | --- |
| A01 | Audited dependency manifest | https://github.com/jaredschueler07/peakcam/blob/61c5f264a6e16c827ff2a7a8654dd6d5a07e809d/package.json | Connected GitHub read; declared dependencies, not tests executed |
| A02 | Audited camera catalog | https://github.com/jaredschueler07/peakcam/blob/61c5f264a6e16c827ff2a7a8654dd6d5a07e809d/data/resorts.json | Connected GitHub read; three resorts, five entries, two placeholders |
| A03 | Audited camera renderer | https://github.com/jaredschueler07/peakcam/blob/61c5f264a6e16c827ff2a7a8654dd6d5a07e809d/components/cams/CamEmbed.tsx | Connected GitHub read; external links/raw image/iframe; no server proxy |
| A04 | Audited page metadata and analytics | https://github.com/jaredschueler07/peakcam/blob/61c5f264a6e16c827ff2a7a8654dd6d5a07e809d/app/layout.tsx | Connected GitHub read; instrumentation present, usage not retrieved |
| A05 | Audited product documentation | https://github.com/jaredschueler07/peakcam/blob/61c5f264a6e16c827ff2a7a8654dd6d5a07e809d/CLAUDE.md | Connected GitHub read; architecture description cross-checked against files |
| A06 | Production website | https://www.peakcam.io | Vercel read returned HTTP 200; HTML inspection only, not interactive mobile testing |
| M01 | OpenSnow official current pricing | https://support.opensnow.com/subscription/how-much-does-opensnow-cost | Base $49.99/year; Premium $99.99/year |
| M02 | OnTheSnow app | https://www.onthesnow.com/news/mobile/ | Free reports, cameras, favorites and powder alerts; vendor coverage claims |
| M03 | OnTheSnow iOS popularity indicator | https://apps.apple.com/us/app/onthesnow-ski-snow-report/id300412347 | App rating count is a storefront snapshot, NOT active users |
| M04 | Snow-Forecast membership | https://www.snow-forecast.com/pages/membership.php | Free/premium forecast distinction |
| M05 | Snow-Forecast localized pricing | https://www.snow-forecast.com/pages/rewards | Currency and checkout region affect displayed price |
| M06 | 2025–26 preliminary skier visits | https://www.snow-forecast.com/whiteroom/us-skier-visits-drop-dramatically-after-poor-snowfall-winter-in-the-west/ | May 6 2026 trade coverage of NSAA: 52.6m visits; secondary, preliminary, not unique skiers |
| M07 | Prior-season industry context | https://www.forbes.com/sites/michellebruton/2025/05/30/us-ski-resorts-had-second-best-season-on-record-in-202425/ | 2024–25 61.5m visits; do not confuse season or visits with people |
| V01 | Vercel pricing | https://vercel.com/pricing | Public list pricing; actual PeakCam plan and bills not obtained |
| V02 | Vercel Flat Rate CDN GA September 8 2026 | https://vercel.com/changelog/flat-rate-cdn-is-now-ga-for-pro-teams | Pro includes 1m requests/1TB; additional $20 10m/50TB, $100 50m/50TB; team level; existing teams must switch |
| V03 | Vercel fair use | https://vercel.com/docs/limits/fair-use-guidelines | Hobby noncommercial; commercial deployment must use appropriate plan |
| V04 | Stripe payments pricing | https://stripe.com/pricing | Standard US domestic cards 2.9% + $0.30; other fees and taxes possible |
| V05 | Stripe Billing pricing | https://stripe.com/billing/pricing | Billing additional usage fee; not included in simple one-time invoice assumption |
| V06 | Open-Meteo pricing and commercial terms | https://open-meteo.com/en/pricing | Free hosted API noncommercial; paid subscription and attribution for commercial service; dollar quote not verified |
| V07 | Journey minimum requirements | https://journeymv.zendesk.com/hc/en-us/articles/24633185741723-Journey-Minimum-Requirements | Updated August 14 2026; 1,000 premium sessions/30 days plus qualitative requirements; not guaranteed acceptance |
| L01 | IRS free EIN application | https://www.irs.gov/businesses/small-businesses-self-employed/get-an-employer-identification-number | Free direct from IRS; form entity before applying for its EIN |
| L02 | IRS single-member LLC treatment | https://www.irs.gov/businesses/small-businesses-self-employed/single-member-limited-liability-companies | Default disregarded entity absent election; not automatic tax savings |
| L03 | Illinois LLC instructions — illustrative state only | https://www.ilsos.gov/departments/business-services/organization/llc-instructions.html | $150 standard formation; $250 expedited; founder operating state NOT established |
| L04 | FinCEN BOI current rule | https://www.fincen.gov/boi | August 2026 final rule exempts US-created entities; foreign-company rules differ |
| L05 | FTC negative-option rulemaking March 2026 | https://www.ftc.gov/news-events/news/press-releases/2026/03/ftc-seeks-public-comment-response-advance-notice-proposed-rulemaking-regarding-negative-option | 2024 rule vacated; 2026 proceeding not a final nationwide click-to-cancel rule |
| L06 | California automatic renewal law alert | https://oag.ca.gov/news/press-releases/attorney-general-bonta-issues-consumer-alert-california%E2%80%99s-automatic-renewal-law | Rules effective July 1 2025; consent, notices and cancellation obligations |
| L07 | California CCPA guidance | https://www.oag.ca.gov/privacy/ccpa | Applicability requires threshold and data-practice analysis; do not assume all small sites exempt |
| L08 | FTC CAN-SPAM compliance | https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business | B2B commercial email covered; accurate sender, postal address and opt-out |
| L09 | FTC advertising disclosures | https://www.ftc.gov/business-guidance/resources/disclosures-101-social-media-influencers | Clear conspicuous material-connection disclosures |
| L10 | FTC COPPA rule | https://www.ftc.gov/legal-library/browse/rules/childrens-online-privacy-protection-rule-coppa | Child-directed services and actual knowledge; under-13 personal information |
| L11 | DOJ website accessibility | https://www.ada.gov/resources/web-guidance/ | Private business accessibility and public-entity rules must not be conflated |
| L12 | USPTO trademark fees | https://www.uspto.gov/trademarks/trademark-fee-information | Base application $350/class; additional fees possible; no clearance opinion performed |
| L13 | Embedding copyright legal analysis | https://www.msk.com/newsroom-alerts-embedding-copyright | Secondary legal analysis; server test is not a blanket national embedding safe harbor |
| L14 | YouTube developer policy guide | https://developers.google.com/youtube/terms/developer-policies-guide | Applies where using YouTube API services; preserve player restrictions and branding; check embed terms too |
| L15 | US government copyright caveats | https://www.doi.gov/copyright | Government works may be public domain; third-party content and marks can remain protected |
| G01 | Google scaled-content policy explanation | https://blog.google/products-and-platforms/products/search/google-search-update-march-2024/ | Do not mass-publish low-value pages for rankings |
| P01 | Roundshot sharing partner announcement June 30 2026 | https://www.roundshot.com/en/messages.html/21/news/946 | Real upstream distribution precedent; NOT approval for PeakCam |
| P02 | Ski.com affiliate program | https://www.ski.com/affiliates | Real publisher program; commission and acceptance not verified for PeakCam |
| P03 | evo affiliate program | https://www.evo.com/pages/affiliate-program | Public program; 5% and 30-day terms subject to contract and exclusions |
| P04 | Backcountry affiliate program | https://www.backcountry.com/info/affiliate-program | 8% base / 30 days published; not all purchases necessarily eligible |
| P05 | Expedia Group affiliate program | https://www.affiliates.expediagroup.com/ | Up to 4% qualifying bookings; actual product/account rules control |
| P06 | Booking.com current affiliate signup | https://www.booking.com/affiliate-program/v2/index.html | Current signup route; no historical commission-share tiers assumed |
| P07 | Weston affiliate program | https://westonbackcountry.com/pages/weston-affiliate-program | 6% / 30 days through AvantLink, subject to approval |
| P08 | Snow Peak affiliate program | https://www.snowpeak.com/pages/affiliates | Content partners 6%, coupon partners 2%, 30 days |
| P09 | DiscoverCars affiliate economics | https://www.discovercars.com/pl/affiliate | 70% rental PROFIT and 30% Full Coverage revenue, not 70% booking price |
| P10 | GoPro localized affiliate terms | https://gopro.com/en/dk/legal/gopro-affiliate-program | 3% on localized official page; US terms need recheck |
| P11 | CamStreamer integrator directory | https://camstreamer.com/partners | Integrators are discovery leads, NOT verified ski-resort clients or footage licensors |
| M08 | SnowStash camera-centric resort page | https://snowstash.com/usa/california/sugar-bowl/snow-cams | Observed web-camera page, angle descriptions and trip modules; pricing/traffic not verified |

## Organization-level contact sources

| CRM ID | Organization | Public contact / program source | Additional evidence | Verification caveat |
| --- | --- | --- | --- | --- |
| PC-001 | Loveland Ski Area | https://skiloveland.com/media-center/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-002 | Monarch Mountain | https://skimonarch.com/contact-us/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-003 | Ski Cooper | https://www.skicooper.com/contact-us/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-004 | Sunlight Mountain Resort | https://sunlightmtn.com/media-link/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-005 | Granby Ranch | https://granbyranch.com/contact-us/ | https://granbyranch.com/news/granby-faq/general-customer-inquiries/ | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-006 | Wolf Creek Ski Area | https://wolfcreekski.com/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-007 | Arapahoe Basin | https://www.arapahoebasin.com/contact-us/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-008 | Powderhorn Mountain Resort | https://www.powderhorn.com/contact/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-009 | Purgatory Resort | https://www.purgatory.ski/contact-us/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-010 | Sipapu Ski and Summer Resort | https://www.sipapu.ski/contact-us/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-011 | Taos Ski Valley | https://www.skitaos.com/contact | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-012 | Sugar Bowl Resort | https://www.sugarbowl.com/contact | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-013 | Big Powderhorn Mountain Resort | https://bigpowderhorn.net/contact-us/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-014 | Eldora Mountain Resort | https://business.boulderchamber.com/active-member-directory/Details/eldora-mountain-resort-3330316 | N/A | Public directory/business-profile route; reverify with organization |
| PC-015 | Bogus Basin | https://bogusbasin.org/about-bogus/contact/ | https://bogusbasin.org/about-bogus/culture/bogus-basin-hosts-summer-season-finale/ | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-016 | Bridger Bowl | https://bridgerbowl.com/contact/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-017 | Lost Trail Ski Area | https://losttrail.com/lost-trail-policies/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-018 | Brundage Mountain | https://brundage.com/media/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-019 | Magic Mountain | https://www.magicmtn.com/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-020 | Mad River Glen | https://skivermont.com/pr-contacts | N/A | Public directory/business-profile route; reverify with organization |
| PC-021 | Jay Peak Resort | https://skivermont.com/pr-contacts | N/A | Public directory/business-profile route; reverify with organization |
| PC-022 | Killington Resort | https://skivermont.com/pr-contacts | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-023 | Middlebury Snowbowl | https://skivermont.com/pr-contacts | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-024 | Vail Resorts | https://www.vailresorts.com/contact/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-025 | Alterra Mountain Company | https://www.alterramtn.co/en/become-a-partner | https://www.alterramtn.co/en/contact-us | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-026 | Boyne Resorts | https://www.boyneresorts.com/contact | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-027 | Mountain Capital Partners | https://www.mcp.ski/contact | https://www.mcp.ski/people | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-028 | Pacific Group Resorts | https://www.pgri.us/contact/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-029 | Aspen Skiing Company / Aspen Snowmass | https://www.aspensnowmass.com/discover/guest-services | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-030 | Roundshot / Seitz Phototechnik AG | https://www.roundshot.com/en/messages.html/21/news/946 | https://www.roundshot.com/en | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-031 | HDOnTap | https://sales.hdontap.com/contact-us/ | https://sales.hdontap.com/streaming-faqs/ | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-032 | Panomax GmbH | https://www.panomax.com/en | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-033 | EarthCam | https://www.earthcam.com/company/contact.php | https://www.earthcam.net/referral/ | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-034 | Ski.com | https://www.ski.com/affiliates | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-035 | evo | https://www.evo.com/pages/affiliate-program | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-036 | Ski Butlers | https://www.skibutlers.com/contact | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-037 | Christy Sports | https://www.christysports.com/on/demandware.store/Sites-ChristySports_US-Site/en_US/ContactUs-Landing | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-038 | Expedia Group Affiliate Program | https://www.affiliates.expediagroup.com/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-039 | DiscoverCars.com | https://www.discovercars.com/affiliate | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-040 | GetYourGuide | https://partner.getyourguide.support/hc/en-us/articles/23082933149981-How-to-get-started-with-the-Affiliate-Program-as-a-Creator | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-041 | Colorado Ski Country USA | https://www.coloradoski.com/media-room/ | https://www.coloradoski.com/contact/ | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-042 | Visit Glenwood Springs | https://visitglenwood.com/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-043 | Breckenridge Tourism Office / GoBreck | https://gobreck.com/media/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-044 | Ski Utah | https://www.skiutah.com/about/about-us/raelene-davis/ | https://www.skiutah.com/media-room/Press-Room | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-045 | Blue River Sports | https://www.summitchamber.org/connections/78492-blue-river-sports/ | https://www.colorado.com/breckenridge/winter-activities/equipment-rentals/blue-river-sports | Public directory/business-profile route; reverify with organization |
| PC-046 | Mountain View Sports | https://mountainviewsports.com/store-location/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-047 | SummitCove Lodging | https://www.trustpilot.com/review/summitcove.com | N/A | Public directory/business-profile route; reverify with organization |
| PC-048 | Breckenridge Brewery & Pub | https://www.breckbrew.com/visit/breckenridge/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-049 | Blue Sky Ski Rentals | https://www.blueskyski.net/privacy-policy/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-050 | SnowBrains | https://snowbrains.com/contact/ | https://www.linkedin.com/company/snowbrains/ | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-051 | The Storm Skiing Journal and Podcast | https://www.stormskiing.com/p/ask-me-anything | N/A | Stale first-party source; reverify before sending |
| PC-052 | Uncover Colorado | https://www.uncovercolorado.com/contact/ | https://www.uncovercolorado.com/advertise-with-uncover-colorado/ | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-053 | Glade Optics | https://www.shopglade.com/pages/contact-us | https://www.shopglade.com/pages/become-a-rep | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-054 | PeakRankings | https://www.peakrankings.com/about | https://www.linkedin.com/in/sam-weintraub/ | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-055 | Newschoolers | https://www.newschoolers.com/advertise | https://www.newschoolers.com/contact | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-056 | FREESKIER / Storm Mountain Media | https://www.freeskier.com/contact-us | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-057 | Summit Skier | https://summitskier.com/contact-us/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-058 | Schussbaumer Ski Club | https://schuss.clubexpress.com/content.aspx?club_id=942033&page_id=4 | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-059 | Colorado Mountain Club | https://www.cmc.org/view | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-060 | Freeskier Society | https://www.freeskiersociety.com/new-page | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-061 | Ski & Snowboard Club Vail | https://discovervail.com/businesses/ski-snowboard-club-vail/ | N/A | Public directory/business-profile route; reverify with organization |
| PC-062 | Visit Park City | https://www.visitparkcity.com/media/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-063 | Steamboat Springs Chamber | https://www.steamboatchamber.com/about-us/board-staff/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-064 | Jackson Hole Chamber of Commerce | https://www.jacksonholechamber.com/about-us/chamber-staff/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-065 | Ski Vermont | https://skivermont.com/contact | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-066 | Visit California | https://industry.visitcalifornia.com/contact-us | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-067 | Travel Oregon | https://industry.traveloregon.com/about/contact/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-068 | Visit Idaho | https://visitidaho.org/contact-us/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-069 | Backcountry | https://www.backcountry.com/info/affiliate-program | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-070 | Snow Peak USA | https://www.snowpeak.com/pages/affiliates | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-071 | Stio | https://www.stio.com/pages/contact-us | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-072 | Weston | https://westonbackcountry.com/pages/weston-affiliate-program | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-073 | Ski The East | https://www.skitheeast.net/pages/faq | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-074 | Wildhorn Outfitters | https://www.wildhornoutfitters.com/pages/contact-us | https://www.linkedin.com/company/wildhorn-outfitters | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-075 | Open-Meteo | https://open-meteo.com/en/pricing | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-076 | Visit Lake Tahoe / Lake Tahoe Visitors Authority | https://visitlaketahoe.com/media-and-pr/media/ | https://visitlaketahoe.com/about-us/ | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-077 | Utah Office of Tourism / Visit Utah | https://www.visitutah.com/fr-fr/contact | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-078 | Indy Pass | https://www.indyskipass.com/contact | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-079 | Mountain Collective | https://mountaincollective.com/support-contact/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-080 | CamStreamer | https://camstreamer.com/about-us | https://camstreamer.com/become-partner | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-081 | feratel media technologies | https://www.feratel.com/en/contact-us | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-082 | IPCamLive | https://web.ipcamlive.com/ | https://web.ipcamlive.com/pricing | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-083 | POWDR | https://www.visitparkcity.com/listing/powdr/30108/ | N/A | Public directory/business-profile route; reverify with organization |
| PC-084 | GoPro | https://gopro.com/en/dk/legal/gopro-affiliate-program | https://gopro.com/en/us/legal/gopro-affiliate-program | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-085 | Summit Express | https://wtd.summitexpress.com/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-086 | Alpine Luxury Limo | https://alpineluxurylimo.com/contact | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-087 | SnowPak | https://www.snowpak.com/about | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-088 | Hestra Gloves USA | https://www.hestragloves.us/pages/contact-us | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-089 | Yakima | https://yakima.com/pages/contact-us | https://yakimasupport.zendesk.com/hc/en-us/articles/360006717572-Media-Requests | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-090 | Dakine | https://www.dakine.com/pages/contact | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-091 | CanDat Systems | https://camstreamer.com/partners | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-092 | Dotworkz Systems | https://camstreamer.com/partners | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-093 | Netwavz | https://camstreamer.com/partners | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-094 | Aspen Chamber Resort Association | https://aspenchamber.org/about/contact-us/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-095 | Snowmass Tourism | https://www.gosnowmass.com/about-us/media/media-photos/ | https://www.gosnowmass.com/about-us/media/ | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-096 | Colorado Tourism Office | https://www.colorado.com/media-room | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-097 | Visit Big Sky | https://www.visitbigsky.com/contact/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-098 | Visit Montana | https://visitmt.com/contact-us | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-099 | Allianz Partners / Allianz Travel Insurance | https://www.allianztravelinsurance.com/about | https://www.allianztravelinsurance.com/about/partners.htm | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-100 | Booking.com | https://www.booking.com/affiliate-program/v2/index.html | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
