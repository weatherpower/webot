// WeBot's weather encyclopedia: hand-written facts about famous storms, records and how weather works.
// When a chat message asks about one of these (src/personality.js replyTo), WeBot answers with the fact
// instead of a joke. Hand-written on purpose: no AI text on stream, so it's accurate and never cusses.
// Each entry: k = what chat might say (checked on the slang-expanded text), a = answers (one is picked).
// Keep answers under ~270 characters (the stream caps a reply at 300). {name} = the viewer.
// Order matters: specific events first, general topics last.

// A hurricane named like a person (Andrew, Maria…): only when chat clearly means the storm.
const storm = (name, year) => new RegExp(`\\bhurricane ${name}\\b|\\b${name}\\b.*\\b(hurricane|storm|flood\\w*|landfall|hit|${year})\\b|\\b(what|when|where|how bad) (was|is|did) ${name}\\b`, 'i');

export const FACTS = [
  /* ---------- famous tornadoes ---------- */
  { k: /\bidabel\b.*\b(tornado|2022|ef4|storm)|\b(tornado|2022|ef4)\b.*\bidabel\b/i, a: [
    'Home turf, {name}. On November 4, 2022, an EF4 tornado tore right through Idabel, Oklahoma. Homes leveled, folks hurt, and this town dusted itself off and rebuilt. That’s McCurtain County for ya.'
  ] },
  { k: /\btri[- ]?state\b/i, a: [
    'The Tri-State Tornado, March 18, 1925. It tore across Missouri, Illinois and Indiana for about 219 miles and killed 695 people. Still the deadliest tornado in United States history, {name}.'
  ] },
  { k: /\bjoplin\b/i, a: [
    'Joplin, Missouri, May 22, 2011. An EF5 nearly a mile wide went right through town and killed 158 people. Deadliest US tornado since 1947 and the costliest single tornado ever recorded.'
  ] },
  { k: /\bel reno\b/i, a: [
    'El Reno, Oklahoma, May 31, 2013: the widest tornado ever measured, 2.6 miles across. Radar caught winds near 300 mph, yet it was rated EF3 since it mostly hit open fields. It killed 8, including researcher Tim Samaras and his team.'
  ] },
  { k: /\bmoore\b|\bbridge creek\b|\bmay 3(rd)?,? 1999\b/i, a: [
    'Moore, Oklahoma has been hit more than its share. May 3, 1999: an F5 with radar-measured winds around 300 mph, and the first Tornado Emergency ever issued. May 20, 2013: an EF5 killed 24, including 7 children at Plaza Towers Elementary.'
  ] },
  { k: /\bgreensburg\b/i, a: [
    'Greensburg, Kansas, May 4, 2007. The very first EF5 on the new Enhanced Fujita Scale, about 1.7 miles wide, and it wiped out roughly 95% of the town. They rebuilt it as one of the greenest towns in America.'
  ] },
  { k: /\bjarrell\b/i, a: [
    'Jarrell, Texas, May 27, 1997. A slow-moving F5 sat on the Double Creek Estates neighborhood and swept homes clean off their slabs. 27 people died. One of the most violent tornadoes ever surveyed.'
  ] },
  { k: /\bmayfield\b|\b(december|dec) (10|11)(th)?,? 2021\b|\bwestern kentucky\b.*tornado|\bquad[- ]?state\b/i, a: [
    'December 10, 2021: a rare December outbreak. One EF4 tracked about 165 miles across western Kentucky and wrecked downtown Mayfield, killing 57. Tornadoes don’t care what month it is, {name}.'
  ] },
  { k: /\brolling fork\b/i, a: [
    'Rolling Fork, Mississippi, March 24, 2023. A nighttime EF4 hit the little Delta town and killed 17. Night tornadoes are the worst kind, sugar. Keep your phone loud and a weather radio handy.'
  ] },
  { k: /\bgreenfield\b/i, a: [
    'Greenfield, Iowa, May 21, 2024. An EF4 hit the town, and a research radar truck measured winds of about 309 to 318 mph, among the fastest ever recorded on Earth.'
  ] },
  { k: /\bsuper ?outbreak\b|\b(april|apr) 27(th)?,? 2011\b|\b1974\b.*tornado|\btornado\b.*\b1974\b|\bxenia\b|\btuscaloosa\b|\bhackleburg\b/i, a: [
    'Two Super Outbreaks, {name}. April 3–4, 1974: 148 tornadoes in 13 states, over 300 killed, Xenia, Ohio flattened. April 25–28, 2011: about 360 tornadoes, the biggest outbreak ever recorded, over 300 killed, Alabama hit hardest.'
  ] },
  { k: /\b(deadliest|worst|biggest|strongest|widest|fastest) tornado/i, a: [
    'Deadliest: the Tri-State Tornado, 1925, 695 killed. Widest: El Reno, 2013, 2.6 miles. Fastest winds: about 300 mph or more, measured by radar in Moore 1999 and Greenfield 2024. Mother Nature don’t play, {name}.'
  ] },

  /* ---------- hurricanes ---------- */
  { k: /\bgalveston\b|\b1900\b.*hurricane|hurricane.*\b1900\b/i, a: [
    'The Galveston Hurricane, September 8, 1900. A Category 4 surge buried the island and killed somewhere between 6,000 and 12,000 people, the deadliest natural disaster in US history. Afterward they built a seawall and raised the whole city.'
  ] },
  { k: /\bkatrina\b/i, a: [
    'Hurricane Katrina, August 29, 2005. It came ashore as a Category 3, but the surge broke New Orleans’ levees and flooded about 80% of the city. Around 1,400 to 1,800 people died. One of the costliest storms ever.'
  ] },
  { k: storm('harvey', 2017), a: [
    'Hurricane Harvey, 2017. Hit Texas as a Category 4 near Rockport, then parked over Houston for days. Over 60 inches of rain fell near Nederland, the most from any tropical storm in US history. Biblical flooding, {name}.'
  ] },
  { k: storm('helene', 2024), a: [
    'Hurricane Helene, September 26, 2024. Landed as a Category 4 in Florida’s Big Bend, then drowned the mountains of western North Carolina around Asheville. Over 230 people died, the deadliest mainland hurricane since Katrina.'
  ] },
  { k: storm('milton', 2024), a: [
    'Hurricane Milton, October 2024. It blew up to a 180 mph Category 5 in the Gulf in about a day, then hit Siesta Key, Florida as a Category 3 and spun up dozens of tornadoes ahead of it. Wild storm, {name}.'
  ] },
  { k: storm('camille', 1969), a: [
    'Hurricane Camille, August 17, 1969. A Category 5 that slammed the Mississippi coast with a storm surge around 24 feet. One of only a handful of Category 5s to ever hit the US.'
  ] },
  { k: storm('andrew', 1992), a: [
    'Hurricane Andrew, August 24, 1992. A Category 5 that flattened Homestead, Florida, south of Miami. It changed building codes all over Florida.'
  ] },
  { k: new RegExp(storm('michael', 2018).source + '|\\bmexico beach\\b', 'i'), a: [
    'Hurricane Michael, October 10, 2018. Hit Mexico Beach, Florida with 160 mph winds, the first Category 5 to hit the US since Andrew in 1992. Mexico Beach was nearly wiped off the map.'
  ] },
  { k: new RegExp(storm('maria', 2017).source + '|\\bpuerto rico\\b.*\\bhurricane\\b', 'i'), a: [
    'Hurricane Maria, September 2017. A Category 4 that knocked out power to all of Puerto Rico for months. Researchers estimated about 2,975 deaths in the aftermath.'
  ] },
  { k: /\blabor day hurricane\b|\b1935\b.*hurricane/i, a: [
    'The 1935 Labor Day Hurricane hit the Florida Keys with a pressure of 892 millibars, the strongest landfall in US history. Over 400 people died, many of them World War I veterans working on the highway.'
  ] },
  { k: /\bokeechobee\b|\b1928\b.*hurricane/i, a: [
    'The 1928 Okeechobee Hurricane pushed Lake Okeechobee right over its banks and killed around 2,500 people in Florida. That’s why there’s a huge dike around the lake today.'
  ] },
  { k: storm('patricia', 2015), a: [
    'Hurricane Patricia, 2015, off Mexico: sustained winds of 215 mph, the strongest ever measured in the Western Hemisphere. Luckily it weakened fast before landfall.'
  ] },
  { k: /\b(deadliest|worst|biggest|strongest|costliest) hurricane/i, a: [
    'Deadliest US hurricane: Galveston, 1900, 6,000 to 12,000 killed. Strongest US landfall: the 1935 Labor Day storm. Strongest winds anywhere in this hemisphere: Patricia, 215 mph. Costliest: Katrina and Harvey, neck and neck.'
  ] },

  /* ---------- floods, winter, heat, wind ---------- */
  { k: /\bjohnstown\b/i, a: [
    'The Johnstown Flood, May 31, 1889. After heavy rain, the South Fork Dam broke above Johnstown, Pennsylvania and a wall of water killed 2,209 people. One of America’s worst disasters.'
  ] },
  { k: /\b(hill country|guadalupe|kerr ?ville|kerr county|camp mystic)\b|\bjuly 4(th)?,? 2025\b/i, a: [
    'July 4, 2025, Texas Hill Country. Overnight storms sent the Guadalupe River up over 20 feet in under an hour. More than 130 people were lost, including girls at Camp Mystic. Please, y’all: turn around, don’t drown.'
  ] },
  { k: /\bdust ?bowl\b|\bblack sunday\b/i, a: [
    'The Dust Bowl, 1930s: drought plus plowed-up prairie turned the Plains into a dust machine. Black Sunday, April 14, 1935, a wall of dust turned day into night across the Oklahoma and Texas panhandles.'
  ] },
  { k: /\b(blizzard|great blizzard) of 1888\b|\b1888\b/i, a: [
    'The Great Blizzard of 1888, March 11–14. Up to 50 inches of snow and huge drifts buried the Northeast, and about 400 people died. It’s one reason New York put its subway underground.'
  ] },
  { k: /\bstorm of the century\b|\b1993\b.*(storm|blizzard|superstorm)|\bsuperstorm\b/i, a: [
    'The 1993 Storm of the Century, March 12–14. One giant storm from Cuba to Canada: blizzards, tornadoes, snow on the Florida Panhandle, and around 300 people killed.'
  ] },
  { k: /\b(texas|2021)\b.*\b(freeze|winter storm|power grid|blackout|uri)\b|\b(winter storm )?uri\b|\bfebruary 2021\b/i, a: [
    'February 2021, Winter Storm Uri. Arctic air froze Texas, the power grid nearly collapsed and millions sat in the dark for days. Over 200 Texans died. Ice is no joke down here, {name}.'
  ] },
  { k: /\bderecho\b/i, a: [
    'A derecho is a long line of straight-line wind damage, at least about 400 miles long. The big one was August 10, 2020 in Iowa: gusts around 140 mph and over $11 billion in damage. Basically a hurricane made of thunderstorms.'
  ] },

  /* ---------- records ---------- */
  { k: /\b(hottest|highest temp\w*)\b.*\b(ever|record|recorded|world|earth|planet|place)\b|\brecord high\b|\bdeath valley\b/i, a: [
    'The hottest temperature ever recorded on Earth is 134°F at Death Valley, California, on July 10, 1913. Some scientists question that one, but either way, Death Valley wins every summer, {name}.'
  ] },
  { k: /\b(coldest|lowest temp\w*)\b.*\b(ever|record|recorded|world|earth|planet|place)\b|\brecord low\b|\bvostok\b/i, a: [
    'The coldest ever measured on Earth: −128.6°F at Vostok Station, Antarctica, July 21, 1983. In the US it’s −80°F at Prospect Creek, Alaska, in 1971. My circuits are shiverin’ just sayin it.'
  ] },
  { k: /\b(fastest|strongest|highest|record) (wind|gust)|\bwind (record|gust record)\b|\bmount washington\b/i, a: [
    'The fastest gust ever measured not counting tornadoes is 253 mph on Barrow Island, Australia, during Cyclone Olivia in 1996. For years the record was 231 mph on Mount Washington, New Hampshire, in 1934.'
  ] },
  { k: /\b(biggest|largest|record) hail|\bvivian\b/i, a: [
    'The biggest hailstone in US history fell in Vivian, South Dakota on July 23, 2010: 8 inches across and almost 2 pounds. That’s not hail, {name}, that’s a bowling ball.'
  ] },
  { k: /\b(wettest|rainiest|most rain)\b/i, a: [
    'The wettest place on Earth is around Mawsynram, India, with about 467 inches of rain a year. In the US, Harvey dropped over 60 inches on Texas in one storm.'
  ] },

  /* ---------- how weather works ---------- */
  { k: /\b(how|why) (do|does|are|is|did)\b.*\btornado(es)?\b.*\b(form|happen|made|start|work|spin)|\btornado(es)?\b.*\b(form|formed|forming)\b/i, a: [
    'Tornadoes need warm, moist air down low, cold dry air up high, and winds that change speed and direction with height. That shear makes the updraft spin, which is a supercell, and sometimes that spin gets stretched down to the ground.'
  ] },
  { k: /\bsupercell\b/i, a: [
    'A supercell is a thunderstorm with a rotating updraft called a mesocyclone. They make most of the strong tornadoes, the giant hail and the worst winds. The royalty of thunderstorms, {name}.'
  ] },
  { k: /\b(watch|warning)\b.*\b(difference|vs|versus|or)\b|\b(difference|vs|versus)\b.*\bwatch\b.*\bwarning\b|\bwhat('?s| is) a (tornado |severe )?(watch|warning)\b/i, a: [
    'A watch means the ingredients are there, so be ready. A warning means it’s happening or about to, so take cover now. Watch is the groceries on the counter; warning is supper on the table, {name}.'
  ] },
  { k: /\btornado emergency\b|\bpds\b|\bparticularly dangerous\b/i, a: [
    'A Tornado Emergency is the highest alert the Weather Service has: a big, confirmed tornado heading for a town. The first one was issued May 3, 1999 for Moore and Oklahoma City. A PDS watch or warning means particularly dangerous situation.'
  ] },
  { k: /\bdry ?line\b/i, a: [
    'The dryline is the line between moist Gulf air and dry desert air, usually out in west Texas and Oklahoma in spring. Storms love to fire right along it.'
  ] },
  { k: /\bhook echo\b|\bdebris ball\b|\bcouplet\b|\btds\b|\bvelocity\b/i, a: [
    'On radar, a hook echo is rain wrapping around a spinning storm. On velocity, red and green right next to each other is a couplet: wind blowing both ways, meaning rotation. A debris ball means the tornado is lofting stuff it has destroyed.'
  ] },
  { k: /\b(how does|what is|what'?s) (a |the )?(doppler|radar)\b|\bnexrad\b/i, a: [
    'Weather radar sends out pulses and listens for the echo off rain and hail. Doppler also tells which way stuff is moving, toward or away, which is how forecasters spot rotation. The US network is called NEXRAD, about 160 radars.'
  ] },
  { k: /\bsaffir|\bhurricane (category|categories|scale)\b|\bcategory [1-5]\b|\bwhat category\b|\bcategor(y|ies)\b.*\bhurricane/i, a: [
    'Hurricane categories, {name}: Cat 1 is 74 to 95 mph, Cat 2 is 96 to 110, Cat 3 is 111 to 129, Cat 4 is 130 to 156, and Cat 5 is 157 or more. Cat 3 and up is a major hurricane. But water kills more people than wind.'
  ] },
  { k: /\b(typhoon|cyclone)s?\b.*\b(hurricane|difference|same)\b|\bhurricane\b.*\b(typhoon|cyclone)\b/i, a: [
    'Same storm, different zip code. In the Atlantic and eastern Pacific it’s a hurricane, in the western Pacific a typhoon, and in the Indian Ocean and down south a cyclone.'
  ] },
  { k: /\bstorm surge\b|\bsurge\b/i, a: [
    'Storm surge is ocean water shoved onshore by a hurricane’s winds. It’s usually the deadliest part of a hurricane. That’s why they say hide from wind, run from water.'
  ] },
  { k: /\b(el ni[nñ]o|la ni[nñ]a|enso)\b/i, a: [
    'El Niño means a warm tropical Pacific, which usually brings a wetter winter to the southern US. La Niña means a cool Pacific, which usually brings a drier, warmer winter down here and busier Atlantic hurricane seasons.'
  ] },
  { k: /\bpolar vortex\b/i, a: [
    'The polar vortex is a big swirl of cold air that normally stays up over the North Pole. When it wobbles or splits, that Arctic air comes spilling south and we all freeze.'
  ] },
  { k: /\bjet ?stream\b/i, a: [
    'The jet stream is a river of fast wind about 6 to 9 miles up, sometimes over 200 mph. It steers storms around the country, and it’s a big ingredient for severe weather.'
  ] },
  { k: /\b(how|why|what)\b.*\b(hail)\b/i, a: [
    'Hail grows when strong updrafts toss ice up and down inside a storm, picking up layers of ice each trip. The stronger the updraft, the bigger the hail. Cut one open and you can count the rings.'
  ] },
  { k: /\b(how|why|what)\b.*\blightning\b|\blightning\b.*\b(hot|work|made|safe)/i, a: [
    'Lightning is a giant spark from charge building up in storm clouds. It heats the air to around 50,000°F, about five times hotter than the surface of the sun. When thunder roars, go indoors, {name}.'
  ] },
  { k: /\b(flash flood|flooding)\b.*\b(safe|drive|deep|car)\b|\bturn around\b/i, a: [
    'Turn around, don’t drown. Six inches of moving water can knock you down, and about a foot can float a car. Most flood deaths happen in vehicles. That road ain’t worth it, sugar.'
  ] },
  { k: /\b(where|what)\b.*\b(safe|safest|hide|shelter)\b.*\btornado|\btornado (safety|shelter)\b/i, a: [
    'Tornado safety: get to the lowest floor, in an interior room away from windows. A basement or storm shelter is best. Put on a helmet if you have one. Mobile homes and cars aren’t safe, so leave early for sturdy shelter.'
  ] },
  { k: /\btornado alley\b|\bdixie alley\b/i, a: [
    'Tornado Alley is the southern and central Plains, like Oklahoma, Kansas and north Texas. Dixie Alley is the Southeast, like Mississippi, Alabama and Tennessee, where tornadoes hide in trees, rain and the dark. We’re right where the two meet, {name}.'
  ] },
  { k: /\bfujita\b.*\b(who|ted|man)\b|\bmr\.? tornado\b|\bted fujita\b/i, a: [
    'Dr. Ted Fujita, “Mr. Tornado,” from the University of Chicago, made the F-scale in 1971 and discovered microbursts. The Enhanced Fujita Scale, the fajita scale, replaced it in 2007.'
  ] },
  { k: /\bmicroburst\b|\bdownburst\b/i, a: [
    'A microburst is a blast of air crashing down out of a storm and spreading out, sometimes over 100 mph. It can flatten trees like a tornado, but all in one direction.'
  ] },
  { k: /\b(wall|shelf) cloud\b/i, a: [
    'A wall cloud hangs down under a storm’s updraft and can rotate, so watch it. A shelf cloud is on the front edge of the storm’s outflow, which means wind and rain are coming but usually no tornado. Wall means watch, shelf means shove.'
  ] },
  { k: /\bdew ?point\b/i, a: [
    'The dew point tells you how much moisture is in the air. Over 60 feels sticky, over 70 feels like soup. High dew points are fuel for big storms.'
  ] },
  { k: /\bheat index\b|\bwind ?chill\b/i, a: [
    'Heat index is how hot it feels when humidity stops your sweat from cooling you. Wind chill is how cold it feels on bare skin when wind strips your heat away. Either one can hurt you, {name}.'
  ] },
  { k: /\blake[- ]effect\b/i, a: [
    'Lake-effect snow happens when cold air blows over warmer Great Lakes water, picks up moisture and dumps it downwind in narrow bands. Some towns get feet while the next town over gets nothing.'
  ] },
  { k: /\bthunder ?snow\b/i, a: [
    'Thundersnow is a thunderstorm with snow instead of rain. It’s rare, and it usually means snow is coming down at 2 or more inches an hour.'
  ] },
  { k: /\bhaboob\b/i, a: [
    'A haboob is a wall of dust pushed out ahead of a thunderstorm’s outflow. Common in Arizona and west Texas. If you’re driving, pull aside, stay alive.'
  ] },
  { k: /\bmammatus\b/i, a: [
    'Mammatus are those bubbly, pouch-looking clouds under a storm’s anvil. Sinking cold air makes them. They look evil, but by themselves they’re harmless.'
  ] },
  { k: /\bwhy is the sky blue\b|\bsky (is )?blue\b/i, a: [
    'Sunlight bounces off air molecules, and blue light scatters way more than red. So blue comes at you from every direction. At sunset the light travels farther, the blue gets scattered out, and you get those oranges and reds.'
  ] },
  { k: /\brainbow\b/i, a: [
    'A rainbow happens when sunlight bends through raindrops and splits into colors. The sun has to be behind you and the rain in front of you. No pot of gold though, I checked.'
  ] },
  { k: /\b(first|history of)\b.*\b(tornado forecast|tornado warning|weather service|nws)\b|\btinker\b/i, a: [
    'The first tornado forecast was made March 25, 1948 at Tinker Air Force Base in Oklahoma by Fawbush and Miller, and a tornado hit the base that night. The Weather Service started in 1870 and got its current name in 1970.'
  ] },
  { k: /\bspc\b|\bstorm prediction center\b|\bnorman,? (oklahoma|ok)\b/i, a: [
    'The Storm Prediction Center is in Norman, Oklahoma. They issue the severe outlooks and the tornado and severe thunderstorm watches for the whole country. The local Weather Service offices issue the warnings.'
  ] },
  { k: /\btwisters?\b.*\b(movie|film)\b|\b(movie|film)\b.*\btwisters?\b/i, a: [
    'Twister came out in 1996 and inspired a whole generation of storm chasers. Twisters came out in 2024. Flying cows are about the only realistic part, {name}. Okay, not really.'
  ] }
];

// "Is this person asking about something?": a question, or words like tell/explain/know/remember.
const ASKING = /\?|\b(what|who|when|where|why|how|which)(s|'s|’s)?\b|\b(tell|explain|know|remember|heard|history|is it true|facts?)\b/i;

// The fact WeBot would answer with, or null. `text` should already be slang-expanded.
export const factFor = (text, pick) => {
  const t = String(text || '');
  if (!t.trim()) return null;
  const hit = FACTS.find((f) => f.k.test(t));
  if (!hit) return null;
  // Short mentions ("katrina", "tri-state tornado") count too; long chatter needs to be asking.
  if (!ASKING.test(t) && t.split(/\s+/).length > 6) return null;
  return pick ? pick(hit.a) : hit.a[0];
};
