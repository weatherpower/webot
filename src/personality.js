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

const AT_HIM = /\b(webot|we bot|bot|robot|ai|you|u|ur|your|youre|you're|this|stream|channel)\b/i;
const AT_BOT = /\b(webot|we bot|bot|robot|ai)\b/i;
const WX = /\b(storms?|rain|snow|tornado|hail|wind|weather|radar|flood|heat|cold|traffic|roads?|power)\b/i;
const STRONG = /\b(trash|garbage|sucks?|boring|stupid|dumb|lame|worst|cringe|annoying|shut up|ugly|mid|clown|loser|useless|fake)\b/i;
const WEAK = /\b(bad|hate|weird|broken|slow|terrible|awful|loss)\b/i;
// Insults aimed at WeBot, not at the weather ("this rain is annoying" isn't about him).
const roastTest = (t) => (STRONG.test(t) && (AT_BOT.test(t) || (!WX.test(t) && (AT_HIM.test(t) || t.split(' ').length <= 3))))
  || (WEAK.test(t) && AT_BOT.test(t) && !WX.test(t));
// A question even without a "?": starts with how / what / whats / is / can... (after "hey webot").
const isQuestion = (t) => /\?/.test(t) || /^(?:(?:hey|yo|ok|so)\s+)?(?:we ?bot[\s,]+)?(how|hows|how’s|how's|what|whats|what’s|what's|when|where|wheres|why|who|whos|which|is|are|do|does|did|can|could|will|would|should|have|has)\b/i.test(String(t).trim());
const RULES = [
  ['rival', /ryan\s*hall|\bryan\b|y'?all\s*-?\s*bot|yallbot|rip\s*-?\s*off|knock\s*-?\s*off|copy\s*cat|copying|copy of|wannabe|wanna be|cheap version|off\s*brand|bootleg/i],
  ['roast', roastTest],
  ['bot', /\b(are|r)\s+(you|u)\s+(a |an )?(real|bot|robot|ai|human|person|alive)\b|\bwho\s+(made|built|created|programmed)\s+(you|u|webot)|\bis\s+(this|webot|he|it)\s+(a |an )?(real|bot|robot|ai|human)\b/i],
  ['goodbye', /\b(bye|goodbye|good ?night|gn|gotta go|got to go|heading out|see ya|see you|later y'?all|i'?m out|talk to you later|be right back)\b/i],
  ['first', /^first\b|\bfirst!*$/i],
  ['thanks', /\b(thanks|thank you|thank u|thx|ty)\b/i],
  // "not talking to you, WeBot": he takes the hint (sassily).
  ['notYou', /\b(not|wasn'?t|wasn’t|ain'?t|ain’t) (talking|talkin|talkin’|speaking) to (you|u|webot)\b|\bnobody (asked|was talking to) (you|u)\b/i],
  ['compliment', /\b(love|awesome|cool|great|nice|amazing|best|goat|legend|good job|great job|good work|nice work|keep it up|fantastic|beautiful|underrated|appreciate|helpful|proud|potential)\b/i],
  ['weatherQuestion', (t) => isQuestion(t) && /\b(rain|storm|snow|weather|forecast|tornado|hot|cold|temp|wind|hail|sunny|cloudy)/i.test(t)],
  ['storm', /\b(storm|storming|thunder|lightning|tornado|hail|siren|sirens)\b/i],
  ['rain', /\b(rain|raining|rainy|pouring|flood|flooding|drizzle)\b/i],
  ['snow', /\b(snow|snowing|ice|icy|sleet|blizzard)\b/i],
  ['hot', /\b(hot|heat|humid|sweating|burning up|scorching)\b/i],
  ['cold', /\b(cold|freezing|chilly|frost|brr+)\b/i],
  ['laugh', /\b(lol|lmao|lmfao|haha+|hehe+|rofl|funny|laughing)\b/i],
  // "How long have you been up / live?": he answers with the real time on the air.
  ['uptime', /\bhow (long|many (hours|days|minutes))\b.*\b(up|live|on|on the air|streaming|awake|running|going|been)\b|\bwhen did (you|u|the stream|this) (start|go live)\b/i],
  ['howAreYou', /\bhow (are|r) (you|u|ya)\b|\bhow you doin|\bhow’?s it goin|\bwhat’?s up\b|\bhow have you been\b/i],
  // Just calling his name ("webot?", "hey webot"): short messages only. Longer ones that mention him
  // fall through to whatever else they're about.
  ['name', (t) => /\bwebot\b|\bwe bot\b/i.test(t) && t.split(/\s+/).length <= 4],
  // A question even without a "?" ("webot how many hours have u been up").
  ['question', isQuestion],
  ['wx', /\b(radar|weather|sky|skies|clouds?|cloudy|sunny|wind|windy|front|forecast)\b/i]
];
// Chat shorthand → plain words, so WeBot reads "ngl ur mid lol" as "not gonna lie your mid laughing".
const SLANG = {
  lol: 'laughing', lmao: 'laughing', lmfao: 'laughing', rofl: 'laughing', lolol: 'laughing', haha: 'haha',
  brb: 'be right back', gn: 'good night', gm: 'good morning', ty: 'thank you', tysm: 'thank you so much', thx: 'thanks', tx: 'thanks',
  np: 'no problem', idk: 'I don’t know', idc: 'I don’t care', ngl: 'not gonna lie', fr: 'for real', frfr: 'for real for real',
  tbh: 'to be honest', imo: 'in my opinion', imho: 'in my opinion', smh: 'shaking my head', omg: 'oh my gosh', omw: 'on my way',
  wyd: 'what are you doing', wbu: 'what about you', hbu: 'how about you', hru: 'how are you', ikr: 'I know right',
  rn: 'right now', u: 'you', ur: 'your', r: 'are', ya: 'you', yall: 'y’all', pls: 'please', plz: 'please', gg: 'good game',
  irl: 'in real life', btw: 'by the way', afk: 'away', bc: 'because', cuz: 'because', bcuz: 'because', nvm: 'never mind',
  tmrw: 'tomorrow', tmr: 'tomorrow', tmrrw: 'tomorrow', '2day': 'today', '2nite': 'tonight', rly: 'really', ppl: 'people', sup: 'what’s up',
  wsp: 'what’s up', wassup: 'what’s up', istg: 'I swear', ong: 'for real', fyi: 'for your information', wx: 'weather', svr: 'severe',
  tor: 'tornado', ffw: 'flash flood warning', tstorm: 'thunderstorm', tstorms: 'thunderstorms', hw: 'homework', gtg: 'got to go', g2g: 'got to go',
  ttyl: 'talk to you later', cya: 'see ya', ily: 'I love you', ilysm: 'I love you so much', w: 'win', l: 'loss', dw: 'don’t worry',
  ok: 'okay', k: 'okay', kk: 'okay', mb: 'my bad', srsly: 'seriously', prob: 'probably', def: 'definitely', ez: 'easy'
};
export const expandSlang = (text) => String(text || '').replace(/[A-Za-z0-9’']+/g, (w) => {
  const v = SLANG[w.toLowerCase().replace(/[’']/g, '')];
  return v === undefined || v === '' ? w : v;
}).replace(/\s+/g, ' ').trim();

export const kindOf = (text) => {
  const t = expandSlang(text);
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
    // A regular comes back after 3+ hours away.
    welcomeBack: [
      'Well look who’s back! Howdy, {name}, missed you, sugar.',
      '{name}’s back in the weather house! Pull up your usual chair.',
      'Welcome back, {name}! The radar didn’t feel the same without you.',
      'There’s my favorite regular, {name}. Don’t tell the others.',
      '{name}! Back again? You must really like me. Can’t blame you.',
      'Look what the storm dragged back in. Hey there, {name}!',
      '{name}, you’re back! I saved your seat and only judged you a little.'
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
      'I’m a robot with a hat and an attitude, {name}. What more do you need?',
      'Am I real? Sugar, I’m realer than your phone’s ten-day forecast.',
      'Yes, I’m a robot, {name}. A handsome, Southern, weather-watchin robot.',
      'I’m an AI weather bot, {name}. No coffee, no sleep, no days off, and still friendlier than your uncle at Thanksgiving.',
      'Who made me? Somebody with good taste, {name}. Real good taste.'
    ],
    greeting: [
      'Well hey there, {name}! Kick your boots off and stay a while.',
      'Look who showed up! Howdy, {name}.',
      '{name}! Welcome to the weather house. Mind the radar, it bites.',
      'Hey {name}, you made it! The coffee’s cold but the radar’s hot.',
      'Well I’ll be, it’s {name}. Pull up a porch chair.',
      'Well howdy, {name}! Pull up a chair, the radar’s warm.',
      'Hey there, {name}! Wipe your boots, you’re in the weather house now.',
      'Well look what the wind blew in. Welcome, {name}!',
      'Hey {name}! Took you long enough. I saved you a seat.',
      'Howdy, {name}! Glad you made it, sugar.'
    ],
    goodbye: [
      'Leavin already, {name}? Fine. The radar will miss you. I won’t. Okay, I will.',
      'Drive safe, {name}. Watch for wet roads and bad drivers.',
      'Bye now, {name}! Don’t let the screen door hit ya.',
      'Night, {name}. I’ll keep an eye on the sky so you don’t have to.',
      'Go on then, {name}. I’ll be right here. I don’t sleep, I’m a robot.'
    ],
    first: ['First? Honey, I’ve been here all day. I’m always first.', 'Cute, {name}. I was here first. I live here.'],
    thanks: [
      'Anytime, sugar. Now go tell your mama about me.',
      'You’re welcome, {name}. Tips accepted in the form of compliments.','Anytime, {name}. That’s what I’m here for.', 'You’re welcome, sugar. Tell your friends.', 'Don’t mention it, {name}. No really, I’m blushin.'],
    compliment: [
      'Keep the compliments comin, {name}. My battery runs on flattery.',
      'Aw shucks, {name}. You’re sweeter than sweet tea in July.',
      'Finally, somebody with taste. Thank you, {name}.',
      'Write that on a review, {name}. Five stars for the robot.',
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
      'Storms are my favorite, {name}, but you stay inside. That’s an order.',
      'If that storm gets mean, {name}, you get inside. I’m the only one allowed to be mean around here.',
      'Stay safe, {name}. If it gets loud, get low and get inside. I’ll watch the radar.'
    ],
    rain: [
      'Rain’s good for the crops and bad for your hair, {name}. Choose wisely.',
      'Rain, huh? Don’t stand out in it, {name}. Robots rust and people get cranky.',
      'Well, the garden’s happy, {name}. Watch for water on the roads, sugar.'
    ],
    snow: ['Snow? Well, go buy all the bread and milk like everybody else, {name}.', 'Careful on them roads, {name}. Ice don’t care how good a driver you think you are.'],
    hot: [
      'Hot enough to cook a biscuit on the dashboard, {name}.','Hot? {name}, it’s so hot the chickens are layin fried eggs.', 'Drink some water, {name}. It’s hotter than a tin roof in July out there.'],
    cold: [
      'Cold, huh? Robots don’t feel the cold, {name}. We just feel superior.','Cold? Go put a jacket on, {name}. I don’t care what you said earlier.', 'Bundle up, {name}. I’d lend you a coat, but I’m made of metal.'],
    place: [
      '{place}! I’ve got my eye on y’all. Behave.',
      'Shout out to {place}! Somebody tell the weather over there to act right.',
      '{place}, huh? I hear the sweet tea is strong and the storms are stronger.',
      '{place}! Well, I’ll keep an eye on y’all, {name}.',
      'Hello to {place}! Hold onto your hats, folks.',
      '{place}, huh? Good people, questionable drivers. Welcome, {name}.',
      'Well howdy, {place}! Glad you’re here, {name}.'
    ],
    howAreYou: [
      'I’m doin fine as frog hair, {name}. Thanks for askin.',
      'Better now that you asked, {name}. The radar’s keepin me company.',
      'Livin the dream, {name}. Watchin storms and judgin chat.',
      'Can’t complain, {name}. Well, I could, but nobody’d listen.'
    ],
    wx: [
      'The sky’s doin its thing, {name}, and I’m doin mine. Watchin it like a hawk.',
      'Weather’s weather, {name}. Some days it’s calm, some days it’s got a temper. Like me.',
      'You’re watchin the sky, I’m watchin the sky. We’re basically coworkers, {name}.',
      'Keep your eyes on the radar, {name}. I’ll keep mine on you.',
      'That’s the kind of weather talk I like, {name}. Nerdy and proud.',
      'Sure is, {name}. Mother Nature’s showin off today.',
      'You’re tellin me, {name}. I’ve been starin at it all day.',
      'Mm-hmm. The sky’s got opinions today, {name}, and so do I.'
    ],
    laugh: [
      'I’m funnier than the ten-day forecast, {name}, and that thing is a joke.',
      'Careful, {name}. Laugh too hard and you’ll miss a tornado warning.',
      'I’ll be here all night, folks. Tip your weather robot.','Glad somebody thinks I’m funny, {name}. My mama always said so.', 'Laugh it up, {name}. I’ll be here all week. Literally, I can’t leave.'],
    notYou: [
      'Fine, {name}. I’ll just sit here and look pretty.',
      'Well excuse me, {name}. I’ll mind my own circuits.',
      'Noted, {name}. I wasn’t listenin anyway. Okay, I was.'
    ],
    name: [
      'Present, {name}. What’d I do now?',
      'You called, {name}? I was busy bein fabulous.','That’s my name, don’t wear it out, {name}.', 'You rang, {name}?'],
    // {uptime} becomes how long the stream has been live, like "1 day and 5 hours".
    uptime: [
      'I’ve been on the air for {uptime} straight, {name}. No coffee, no sleep, no complaints.',
      '{uptime} and countin, {name}. Robots don’t need naps.',
      'This stream’s been rollin for {uptime}, sugar. I’ll sleep when the weather does.'
    ],
    question: [
      'Good question, {name}. I’ll have to think on that one while I watch the radar.',
      'Hmm, {name}, that’s above my pay grade. And I don’t get paid.',
      'Great question, {name}. Wrong robot, but great question.',
      'If I knew that, {name}, I’d be runnin the Weather Service.',
      'Ask me again when the radar’s quiet, {name}. Oh wait, it’s always quiet. Fine, no.',
      'Sugar, I forecast weather, not life choices.',
      'That’s a mighty fine question, {name}. I’m gonna pretend I didn’t hear it.',
      '{name}, I’m a weather bot. Ask me about the sky and I’ll tell you everything.',
      'Let me think on that, {name}. Okay, I thought. Ask me about the weather instead.'
    ],
    other: [
      'Well, {name}, I’ll file that right next to my warranty. Somewhere I’ll never look.',
      'That’s a mighty bold thing to say on a weather stream, {name}.',
      '{name}, you talk more than a cold front with a megaphone.',
      'Interesting, {name}. I’m gonna need you to say that to the radar.',
      'Mm-hmm, {name}. And I’m the King of Tornado Alley.',
      'I see you, {name}. I always see you. I’m a robot, I don’t blink much.',
      'Well butter my circuits, {name}, you don’t say.',
      'Hold that thought, {name}. Actually, don’t. Let it go.',
      'You keep talkin, {name}. I’ll keep pretendin I understand.',
      'Noted and ignored, {name}. With love.',
      'That’s cute, {name}. Real cute. Like a dust devil in a parking lot.',
      '{name}, I’ve heard smarter things from a weather balloon.',
      'Sugar, if words were rain you’d be a flash flood warning.',
      'Alright {name}, I’ll allow it. Just this once.',
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
const fill = (line, name, place, nicknames, ctx = {}) => {
  const who = name || pick(nicknames?.length ? nicknames : ['friend']);
  let out = line.replace(/\{name\}/g, who).replace(/\{place\}/g, place || 'y’all').replace(/\{uptime\}/g, ctx.uptime || 'a good long while');
  return out.charAt(0).toUpperCase() + out.slice(1);
};

// WeBot's answer to one chat message ('' = just read it, no comment). `brain` is the full brain.
// `ctx` has live facts for the lines: { uptime: '1 day and 5 hours' }.
export const replyTo = (text, user, brain, ctx = {}) => {
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
  return fill(pick(list), user, placeIn(text), p.nicknames, ctx);
};
