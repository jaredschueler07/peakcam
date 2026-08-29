/**
 * Hand-curated write-ups for the most-searched resorts, layered above the
 * data-derived copy in lib/resort-copy.ts. Editorial rules:
 *
 * - Evergreen only. No snow numbers, no "this season" — live figures come from
 *   the data-derived block and would rot here.
 * - Every sentence must say something a skier would actually tell a friend.
 *   Cut any sentence that could describe fifty other resorts.
 * - Widely-established facts only (terrain character, geography, what the
 *   place is known for). No invented statistics.
 */

export interface ResortEditorial {
  /** 2-4 sentences of evergreen character copy, shown before the data block. */
  intro: string;
}

export const RESORT_EDITORIAL: Record<string, ResortEditorial> = {
  vail: {
    intro:
      "Vail is one of the largest single ski areas in the United States, and its scale is the point: the front side is groomed cruiser country, while the famous Back Bowls open up treeless, wide-open terrain that turns any storm day into an event. Blue Sky Basin, further back still, keeps a quieter, more wooded feel. It is a big, polished, expensive operation, and the Back Bowls are the reason people pay for it.",
  },
  "aspen-snowmass": {
    intro:
      "Aspen Snowmass is four mountains on one pass: Snowmass for sheer size and family terrain, Aspen Mountain (Ajax) rising straight out of town with no beginner runs at all, Aspen Highlands for the hike-to Highland Bowl, and Buttermilk for learning and the X Games superpipe. The town itself is half the identity — a Victorian mining grid that went upscale, with serious skiing directly above it.",
  },
  "park-city": {
    intro:
      "Park City is the largest lift-served resort in the United States since its merger with Canyons, and it sits closer to a major airport than almost any comparable mountain — Salt Lake City is under an hour away. The terrain skews friendly and rolling rather than fearsome, which, combined with a real town at the base, makes it one of the easiest big-mountain trips to actually pull off.",
  },
  "jackson-hole": {
    intro:
      "Jackson Hole's reputation rests on sustained, honest steepness — Corbet's Couloir is the postcard, but it is the everyday pitch of the terrain off the tram that sets the place apart. The aerial tram climbs over 4,000 vertical feet in one ride, and the resort sits hard against Grand Teton National Park. There is a real beginner pod at the base, but the tram face is not where anyone takes a first ski day.",
  },
  "whistler-blackcomb": {
    intro:
      "Whistler Blackcomb is the biggest ski resort in North America — two full-sized mountains linked by the Peak 2 Peak gondola, with alpine bowls, glacier skiing, and a mile of vertical. The snow is coastal — deep and frequent, sometimes heavy. The walkable village at the base is the model most later purpose-built villages chased, and the 2010 Olympics upgraded the highway and the hardware; the skiing was already the draw.",
  },
  mammoth: {
    intro:
      "Mammoth Mountain is a dormant volcano in California's Eastern Sierra with one of the longest seasons in the country — big snow years have kept lifts spinning into summer. The summit ridgeline is steep chutes; the lower mountain is long intermediate runs. It sits about five hours from Los Angeles up US-395, so Friday night and Sunday afternoon are the ugly hours, and midweek is quiet.",
  },
  breckenridge: {
    intro:
      "Breckenridge pairs one of Colorado's most complete historic mining towns with five interconnected peaks, and its high alpine terrain is some of the loftiest lift-served skiing in North America — the Imperial Express is among the highest chairlifts on the continent. The altitude is real: the base sits near 9,600 feet. Main Street after the lifts close is the other half of the experience.",
  },
  "palisades-tahoe": {
    intro:
      "Palisades Tahoe — the resort formerly known as Squaw Valley, host of the 1960 Winter Olympics — is Lake Tahoe's big-mountain proving ground. KT-22 is one of the most storied chairlifts in skiing, serving steep, rocky, creative terrain that shaped generations of freeskiers. A base-to-base gondola now links it with the Alpine Meadows side, which offers the same Sierra snow with a fraction of the scene.",
  },
  "big-sky": {
    intro:
      "Big Sky's signature is Lone Peak: a tram to an 11,166-foot summit where every way down is rated advanced or expert and, on a clear day, the view takes in Montana, Wyoming, and Idaho. Under the peak the ski area covers more than 5,800 acres, which still skis quieter than the Colorado names on most weekdays. It is a long way from a major airport, and the cold snaps are serious.",
  },
  killington: {
    intro:
      "Killington is the East's volume leader — the most terrain in Vermont, seven peaks, and a snowmaking system aggressive enough to open in October and push the season toward June, which earned it the 'Beast of the East' name. The terrain is more varied than its cruiser reputation suggests, from the bumps of Outer Limits to tight Vermont trees. Après on the Killington Road is its own institution.",
  },
  stowe: {
    intro:
      "Stowe is New England skiing at its most classic: Mount Mansfield, Vermont's highest peak, the narrow and unforgiving Front Four trails cut in the 1930s, and a white-steepled village that looks the way postcards claim Vermont looks. When Mansfield is holding snow, the Front Four and the trees off them are as good as anything in the East.",
  },
  alta: {
    intro:
      "Alta is a skiers-only holdout in Utah's Little Cottonwood Canyon, and one of the snowiest lift-served places on Earth — the canyon regularly measures over 500 inches a year of famously light powder. The culture is deliberately old-school: no snowboarding, lodges instead of a village, and terrain that rewards traversing and hiking. Alta shares a high-alpine boundary and a combined ticket with neighboring Snowbird, and skiing both in a day is the point of the canyon.",
  },
  "ski-portillo": {
    intro:
      "Portillo is South America's most storied ski resort: a single yellow hotel beside Laguna del Inca in the Chilean Andes, no village, no day-trip crowds, and a guest list capped at about 450. National alpine race teams have trained here for decades during the northern-hemisphere summer. Its slingshot va-et-vient lifts, which haul skiers up avalanche-prone faces five abreast, exist almost nowhere else.",
  },
  "valle-nevado": {
    intro:
      "Valle Nevado is a purpose-built resort in the Andes above Santiago, French in style: high, treeless bowls with a village at roughly 9,900 feet. An on-snow connection links it with neighboring La Parva and El Colorado, though access depends on ticket and conditions. For northern skiers it is the classic July-to-September trip — about 46 kilometers from Santiago, considerably longer when winter traffic and chain controls stack up.",
  },
  "cerro-catedral": {
    intro:
      "Cerro Catedral sits above Bariloche — a lake town of chocolate shops with a Swiss-Argentine accent — and is Argentina's largest ski resort. The upper mountain is granite spires and wind-scoured alpine terrain; the lower mountain runs through lenga forest with Nahuel Huapi Lake in view the whole way down.",
  },
  "las-lenas": {
    intro:
      "Las Leñas is the big-mountain legend of Argentina: a remote outpost in Mendoza province whose Marte chairlift unlocks enormous, steep, avalanche-managed terrain that draws expedition-minded skiers from both hemispheres. When Marte spins and the snow is right, the freeride terrain rivals anything lift-served on the planet. Storms and wind close Marte often; the days after it reopens are the ones people fly for.",
  },
  telluride: {
    intro:
      "Telluride pairs a preserved Victorian mining town in a box canyon with some of Colorado's most dramatic lift-served terrain — Palmyra Peak's hike-to lines drop over the San Juans' most jagged skyline. A free gondola links the historic town to Mountain Village — unusual in that it runs as actual public transit, not a lift ticket. Crowds stay thinner than at the I-70 resorts because it is a long way from any hub airport; most visitors fly into Montrose and drive.",
  },
  snowbird: {
    intro:
      "Snowbird shares Little Cottonwood Canyon's outrageous snowfall with neighboring Alta but takes the opposite cultural approach: snowboarders welcome, brutalist concrete lodging, and a 125-passenger tram straight up to Hidden Peak. Under the tram, the Cirque and the chutes off Peruvian Gulch are as steep as anything lift-served in Utah; Gad Valley is the mellower escape. Spring at Snowbird is legendary; the season routinely stretches deep into May.",
  },
  heavenly: {
    intro:
      "Heavenly straddles the California-Nevada line above South Lake Tahoe, and its defining feature is the view: long groomers that seem to pour straight into the largest alpine lake in North America. The terrain splits personalities by state — Nevada's Mott and Killebrew Canyons hold the serious steeps. At Stateline the base is casinos, not a faux-Tyrolean village.",
  },
  steamboat: {
    intro:
      "Steamboat trademarked the term 'Champagne Powder' for the light, dry snow that stacks up in its aspen glades — tree skiing is the mountain's calling card more than steeps. The town below is a ranching community that predates the resort, and it has produced more winter Olympians than any other town in North America.",
  },
};
