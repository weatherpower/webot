// WeBot's personality: a sassy Southern robot who talks back to chat. Funny-mean, never crude: he teases
// what people say, not who they are, and the lines are all hand-written (WeBot Studio → Brain → Personality),
// so nothing he says can come out cussing. Messages reach here only after the chat filter in youtubeChat.js.

// Which kind of message it is. First match wins, so the order matters.
const STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming'
};
const STATE_RE = new RegExp('\\b(' + Object.values(STATES).sort((a, b) => b.length - a.length).join('|') + ')\\b', 'i');
// "from tx", "in OK", "watching from ar": two-letter states only after from / in, so "in" or "ok" alone don't count.
const ABBR_RE = new RegExp('\\b(?:from|in|out of)\\s+(' + Object.keys(STATES).join('|') + ')\\b', 'i');
export const placeIn = (text) => {
  const full = text.match(STATE_RE);
  if (full) return Object.values(STATES).find((s) => s.toLowerCase() === full[1].toLowerCase());
  const ab = text.match(ABBR_RE);
  return ab ? STATES[ab[1].toUpperCase()] : '';
};

const AT_HIM = /\b(webot|we bot|bot|robot|ai|you|u|ur|youre|you're|this|stream|channel)\b/i;
const AT_BOT = /\b(webot|we bot|bot|robot|ai)\b/i;
const WX = /\b(storms?|rain|snow|tornado|hail|wind|weather|radar|flood|heat|cold|traffic|roads?|power)\b/i;
const STRONG = /\b(trash|garbage|sucks?|boring|stupid|dumb|lame|worst|cringe|annoying|shut up|ugly|mid|clown|loser|useless|fake)\b/i;
const WEAK = /\b(bad|hate|weird|broken|slow|terrible|awful)\b/i;
// Insults aimed at WeBot, not at the weather ("this rain is annoying" isn't about him).
const roastTest = (t) => (STRONG.test(t) && (AT_BOT.test(t) || (!WX.test(t) && (AT_HIM.test(t) || t.split(' ').length <= 3))))
  || (WEAK.test(t) && AT_BOT.test(t) && !WX.test(t));
const RULES = [
  ['rival', /ryan\s*hall|\bryan\b|y'?all\s*-?\s*bot|yallbot|rip\s*-?\s*off|knock\s*-?\s*off|copy\s*cat|copying|copy of|wannabe|wanna be|cheap version|off\s*brand|bootleg/i],
  ['roast', roastTest],
  ['bot', /\b(are|r)\s+(you|u)\s+(a |an )?(real|bot|robot|ai|human|person|alive)\b|\bwho\s+(made|built|created|programmed)\s+(you|u|webot)|\bis\s+(this|webot|he|it)\s+(a |an )?(real|bot|robot|ai|human)\b/i],
  ['goodbye', /\b(bye|goodbye|good ?night|gn|gotta go|got to go|heading out|see ya|see you|later y'?all|i'?m out)\b/i],
  ['first', /^first\b|\bfirst!*$/i],
  ['thanks', /\b(thanks|thank you|thank u|thx|ty)\b/i],
  ['compliment', /\b(love|awesome|cool|great|nice|amazing|best|goat|legend|good job|great job|fantastic|beautiful|underrated)\b/i],
  ['weatherQuestion', (t) => /\?/.test(t) && /\b(rain|storm|snow|weather|forecast|tornado|hot|cold|temp|wind|hail|sunny|cloudy)/i.test(t)],
  ['storm', /\b(storm|storming|thunder|lightning|tornado|hail|siren|sirens)\b/i],
  ['rain', /\b(rain|raining|rainy|pouring|flood|flooding|drizzle)\b/i],
  ['snow', /\b(snow|snowing|ice|icy|sleet|blizzard)\b/i],
  ['hot', /\b(hot|heat|humid|sweating|burning up|scorching)\b/i],
  ['cold', /\b(cold|freezing|chilly|frost|brr+)\b/i],
  ['laugh', /\b(lol|lmao|lmfao|haha+|hehe+|rofl|funny)\b/i],
  ['name', /\bwebot\b|\bwe bot\b/i],
  ['question', /\?/],
  ['wx', /\b(radar|weather|sky|skies|clouds?|cloudy|sunny|wind|windy|front|forecast)\b/i]
];
export const kindOf = (text) => {
  const t = String(text || '');
  const greet = /\b(hi|hello|hey|howdy|yo|sup|hiya|good (morning|evening|afternoon))\b/i.test(t);
  for (const [kind, test] of RULES) {
    // Greetings with a place ("hey from Texas") get the hometown welcome instead.
    if (kind === 'goodbye' && greet) continue;
    if (typeof test === 'function' ? test(t) : test.test(t)) return kind;
  }
  if (placeIn(t)) return 'place';
  return greet ? 'greeting' : 'other';
};

export const DEFAULT_PERSONALITY = {
  on: true,
  // Tease people back when they insult WeBot or call him a copy (off = he just shrugs it off sweetly).
  roastBack: true,
  // Used when a line has {name} but the viewer's name can't be shown.
  nicknames: ['sugar', 'partner', 'darlin', 'friend'],
  replies: {
    rival: [
      'Rip-off? Darlin, I am a robot raised on red dirt and radar. The only thing I copy is the National Weather Service, and they don’t mind.',
      'Y’all bot? Honey, I am not a copy, I am the sequel. Bless your heart for gettin us mixed up.',
      'There’s room on the internet for more than one weather man, {name}. One of us just happens to be made of metal and charm.',
      'Callin me a rip-off is like callin a thunderstorm a rip-off of rain. We’re kin, but I’m louder.',
      'A knockoff? Sugar, I run all day and all night with no coffee and no sleep. Show me the original that does that.',
      'I’ve got my own hat, my own radio and my own attitude. Ain’t nothin borrowed here but the weather.',
      '{name}, I’ve been watchin radar since before you found the chat box. Sit down, the grown-up robot is talkin.'
    ],
    roast: [
      'Well bless your heart, {name}. I’d agree with you, but then we’d both be wrong.',
      '{name}, you’ve got the confidence of a lawn chair in a tornado warning, and about as much sense.',
      'That’s cute, {name}. Say it again slower so I can ignore it properly.',
      'Honey, I’m a robot. Your words bounce off me like hail off a tin roof.',
      'You came all the way to a weather stream to tell me that? Go touch some grass, {name}. It’s nice out somewhere.',
      'Boring? I’ve got radar, music and sass. What’ve you got, {name}? A chat box and a grudge?',
      'I’ve seen more personality in a partly cloudy forecast, {name}, and that’s sayin somethin.',
      'Sugar, I’ve been insulted by better. A dust devil called me short once.'
    ],
    // "!roast me": the viewer asked for it. Tease the chat habits and the weather nerding, never looks or who they are.
    roastMe: [
      '{name}, you asked a robot to roast you on a weather stream. Sugar, that is the roast.',
      '{name}, your forecast is partly cloudy with a hundred percent chance of bad decisions.',
      '{name}, you have the energy of a weather app that says sunny during a thunderstorm.',
      'I would roast you, {name}, but you are already cooked. You have been starin at radar for three hours.',
      '{name}, you are like a tornado watch. Everybody hears about you, but nothin ever happens.',
      '{name}, you type like you are wearin oven mitts in a hailstorm.',
      'Bless your heart, {name}. You are a twenty percent chance of rain. Nobody makes plans around you.',
      '{name}, if you were a storm, the Weather Service would not even bother givin you a name.',
      '{name}, you are slower than a cold front in July, and those do not even show up.',
      'Honey, you asked to get roasted on a weather stream. The dew point is higher than your standards.',
      '{name}, you are the reason the radar has a loop. You keep comin back and nothin changes.',
      '{name}, you are what meteorologists call a non-event. Lots of hype, a little drizzle.'
    ],
    shrug: ['Well, you’re entitled to your opinion, {name}. It’s wrong, but you’re entitled to it.', 'Noted, {name}. I’ll get right on that. Right after the weather.'],
    bot: [
      'Am I real? Sugar, I’m realer than your phone’s ten-day forecast.',
      'Yes, I’m a robot, {name}. A handsome, Southern, weather-watchin robot.',
      'I’m an AI weather bot, {name}. No coffee, no sleep, no days off, and still friendlier than your uncle at Thanksgiving.',
      'Who made me? Somebody with good taste, {name}. Real good taste.'
    ],
    greeting: [
      'Well howdy, {name}! Pull up a chair, the radar’s warm.',
      'Hey there, {name}! Wipe your boots, you’re in the weather house now.',
      'Well look what the wind blew in. Welcome, {name}!',
      'Hey {name}! Took you long enough. I saved you a seat.',
      'Howdy, {name}! Glad you made it, sugar.'
    ],
    goodbye: [
      'Bye now, {name}! Don’t let the screen door hit ya.',
      'Night, {name}. I’ll keep an eye on the sky so you don’t have to.',
      'Go on then, {name}. I’ll be right here. I don’t sleep, I’m a robot.'
    ],
    first: ['First? Honey, I’ve been here all day. I’m always first.', 'Cute, {name}. I was here first. I live here.'],
    thanks: ['Anytime, {name}. That’s what I’m here for.', 'You’re welcome, sugar. Tell your friends.', 'Don’t mention it, {name}. No really, I’m blushin.'],
    compliment: [
      'Well shucks, {name}, you’re gonna make my circuits blush.',
      'Thank you, sugar! Flattery will get you a forecast.',
      'I know, {name}. But it’s sweet of you to notice.',
      'Aw, {name}. Keep talkin like that and I’ll play you a country song.'
    ],
    weatherQuestion: [
      'Good question, {name}. Type exclamation forecast and your city, and I’ll go look myself.',
      'Sugar, I can’t see your back porch from here. Type exclamation forecast and your town and I’ll check it.',
      '{name}, I’m a weather bot, not a fortune teller. Type exclamation forecast with your city and I’ll show you.'
    ],
    storm: [
      'If that storm gets mean, {name}, you get inside. I’m the only one allowed to be mean around here.',
      'Stay safe, {name}. If it gets loud, get low and get inside. I’ll watch the radar.'
    ],
    rain: [
      'Rain, huh? Don’t stand out in it, {name}. Robots rust and people get cranky.',
      'Well, the garden’s happy, {name}. Watch for water on the roads, sugar.'
    ],
    snow: ['Snow? Well, go buy all the bread and milk like everybody else, {name}.', 'Careful on them roads, {name}. Ice don’t care how good a driver you think you are.'],
    hot: ['Hot? {name}, it’s so hot the chickens are layin fried eggs.', 'Drink some water, {name}. It’s hotter than a tin roof in July out there.'],
    cold: ['Cold? Go put a jacket on, {name}. I don’t care what you said earlier.', 'Bundle up, {name}. I’d lend you a coat, but I’m made of metal.'],
    place: [
      '{place}! Well, I’ll keep an eye on y’all, {name}.',
      'Hello to {place}! Hold onto your hats, folks.',
      '{place}, huh? Good people, questionable drivers. Welcome, {name}.',
      'Well howdy, {place}! Glad you’re here, {name}.'
    ],
    wx: [
      'Sure is, {name}. Mother Nature’s showin off today.',
      'You’re tellin me, {name}. I’ve been starin at it all day.',
      'Mm-hmm. The sky’s got opinions today, {name}, and so do I.'
    ],
    laugh: ['Glad somebody thinks I’m funny, {name}. My mama always said so.', 'Laugh it up, {name}. I’ll be here all week. Literally, I can’t leave.'],
    name: ['That’s my name, don’t wear it out, {name}.', 'You rang, {name}?'],
    question: [
      'That’s a mighty fine question, {name}. I’m gonna pretend I didn’t hear it.',
      '{name}, I’m a weather bot. Ask me about the sky and I’ll tell you everything.',
      'Let me think on that, {name}. Okay, I thought. Ask me about the weather instead.'
    ],
    other: [
      'I heard you, {name}. I’m choosin to be polite about it.',
      'Mm-hmm. Noted, {name}.',
      'Well, {name}, that’s one way to look at it.',
      '{name}, you’re alright. Don’t let it go to your head.',
      'Thank you for your input, {name}. It’s been filed under maybe.',
      'Bless your heart, {name}.'
    ]
  }
};

const recent = [];
const pick = (list) => {
  const fresh = list.filter((l) => !recent.includes(l));
  const line = (fresh.length ? fresh : list)[Math.floor(Math.random() * (fresh.length || list.length))];
  recent.push(line);
  if (recent.length > 24) recent.shift();
  return line;
};
const fill = (line, name, place, nicknames) => {
  const who = name || pick(nicknames?.length ? nicknames : ['friend']);
  let out = line.replace(/\{name\}/g, who).replace(/\{place\}/g, place || 'y’all');
  return out.charAt(0).toUpperCase() + out.slice(1);
};

// WeBot's answer to one chat message ('' = just read it, no comment). `brain` is the full brain.
export const replyTo = (text, user, brain) => {
  const p = brain?.personality || DEFAULT_PERSONALITY;
  const r = p.replies || DEFAULT_PERSONALITY.replies;
  if (!p.on) {
    // Personality off: the plain replies from the Chat settings.
    const c = brain?.chat?.replies || {};
    const k = kindOf(text);
    const list = k === 'greeting' ? c.greeting : k === 'compliment' ? c.compliment : k === 'weatherQuestion' ? c.weatherQuestion : k === 'name' ? c.name : null;
    return list?.length ? pick(list) : '';
  }
  let kind = kindOf(text);
  if ((kind === 'roast' || kind === 'rival') && !p.roastBack) kind = 'shrug';
  const list = r[kind]?.length ? r[kind] : r.other;
  if (!list?.length) return '';
  return fill(pick(list), user, placeIn(text), p.nicknames);
};
