const theme = (name, primary, primaryDark, accent, rgb, type = name.toLowerCase().replace(/\s+/g, '-')) => ({
  name,
  primary,
  primaryDark,
  accent,
  rgb,
  polygon: accent,
  type
});

export const warningThemes = {
  tornado: theme('Tornado', '#e40000', '#7b0000', '#ff1919', '228, 0, 0', 'tornado'),
  pdsTornado: theme('PDS Tornado', '#ff3fb6', '#8a145a', '#ff80d2', '255, 63, 182', 'pds-tornado'),
  pdsTornadoWatch: theme('PDS Tornado Watch', '#e6009d', '#78004f', '#ff70c8', '230, 0, 157', 'pds-tornado-watch'),
  severeThunderstorm: theme('Severe Thunderstorm', '#ffd400', '#8a6900', '#ffe45e', '255, 212, 0', 'severe-thunderstorm'),
  considerableThunderstorm: theme('Considerable Severe Thunderstorm', '#ffd400', '#8a6900', '#ffec7a', '255, 212, 0', 'considerable-thunderstorm'),
  destructiveThunderstorm: theme('Destructive Thunderstorm', '#ffd400', '#8a6900', '#fff176', '255, 212, 0', 'destructive-thunderstorm'),
  pdsSevereThunderstormWatch: theme('PDS Severe Thunderstorm Watch', '#d90078', '#73003f', '#ff6db8', '217, 0, 120', 'pds-severe-thunderstorm-watch'),
  discussion: theme('SPC Discussion', '#e40000', '#7b0000', '#ff4d4d', '228, 0, 0', 'spc-discussion'),
  outlook: theme('SPC Outlook', '#ff8a00', '#7d3f00', '#ffb347', '255, 138, 0', 'spc-outlook'),
  hurricane: theme('Hurricane', '#d90032', '#730019', '#ff315d', '217, 0, 50', 'hurricane'),
  hurricaneWatch: theme('Hurricane Watch', '#e6009d', '#78004f', '#ff66c4', '230, 0, 157', 'hurricane-watch'),
  tropicalStorm: theme('Tropical Storm', '#ff6a00', '#8a3100', '#ffad42', '255, 106, 0', 'tropical-storm'),
  tropicalStormWatch: theme('Tropical Storm Watch', '#f4c400', '#806400', '#ffe25c', '244, 196, 0', 'tropical-storm-watch'),
  stormSurge: theme('Storm Surge', '#7048e8', '#35198a', '#a98cff', '112, 72, 232', 'storm-surge'),
  stormSurgeWatch: theme('Storm Surge Watch', '#2779d9', '#103c7c', '#70b5ff', '39, 121, 217', 'storm-surge-watch'),
  extremeWind: theme('Extreme Wind', '#a60024', '#510011', '#ff345f', '166, 0, 36', 'extreme-wind'),
  tropicalStatement: theme('Tropical Cyclone', '#008e9f', '#004851', '#3ee4ed', '0, 142, 159', 'tropical-cyclone'),
  flashFlood: theme('Flash Flood', '#14a84a', '#075723', '#42e06f', '20, 168, 74', 'flash-flood'),
  flood: theme('Flood', '#16a34a', '#075728', '#5cff88', '22, 163, 74', 'flood'),
  freeze: theme('Freeze', '#483d8b', '#2a2356', '#b9a8ff', '72, 61, 139', 'freeze'),
  winter: theme('Winter', '#15a2ff', '#064f7d', '#8bd8ff', '21, 162, 255', 'winter'),
  fire: theme('Fire', '#d000ff', '#620078', '#ff54d7', '208, 0, 255', 'fire'),
  marine: theme('Marine', '#5a4dff', '#211a86', '#8b83ff', '90, 77, 255', 'marine'),
  wind: theme('Wind', '#f97316', '#813305', '#ffae57', '249, 115, 22', 'wind'),
  statement: theme('Special Weather Statement', '#7c8dff', '#24317a', '#b5c1ff', '124, 141, 255', 'special-weather-statement'),
  forecast: theme('Daily Forecast', '#198bd7', '#063e75', '#65d2ff', '25, 139, 215', 'daily-forecast'),
  default: theme('Weather', '#8896b8', '#30384f', '#b8c0d8', '136, 150, 184', 'weather')
};

export const classifyAlert = ({ event = '', headline = '', description = '', instruction = '', parameters = {}, severity = '' } = {}) => {
  const lower = String(event).toLowerCase();
  const text = [event, headline, description, instruction, severity].filter(Boolean).join(' ').toLowerCase();
  const firstParam = (key) => {
    const value = parameters?.[key];
    return Array.isArray(value) ? String(value[0] || '') : String(value || '');
  };
  const thunderstormDamageThreat = firstParam('thunderstormDamageThreat').toLowerCase();
  const tornadoDamageThreat = firstParam('tornadoDamageThreat').toLowerCase();
  const flashFloodDamageThreat = firstParam('flashFloodDamageThreat').toLowerCase();
  const isWatch = lower.includes('watch');
  const isSevereThunderstorm = lower.includes('severe thunderstorm');
  const isEmergency = /\b(tornado|flash flood|flood)\s+emergenc(y|ies)\b/.test(text) ||
    tornadoDamageThreat.includes('catastrophic') ||
    flashFloodDamageThreat.includes('catastrophic');
  const isPds = /\bpds\b|particularly dangerous situation/.test(text) ||
    (lower.includes('tornado') && tornadoDamageThreat.includes('considerable'));
  const isDestructive = isSevereThunderstorm && (
    thunderstormDamageThreat.includes('destructive') ||
    /\bdestructive\b/.test(text)
  );
  const isConsiderable = isSevereThunderstorm && !isDestructive && (
    thunderstormDamageThreat.includes('considerable') ||
    /\bconsiderable\b/.test(text)
  );

  let family = 'weather';
  let theme = warningThemes.default;
  if (lower.includes('daily forecast')) {
    family = 'forecast';
    theme = warningThemes.forecast;
  } else if (lower.includes('tornado')) {
    family = 'tornado';
    theme = isPds && isWatch
      ? warningThemes.pdsTornadoWatch
      : isPds || isEmergency
        ? warningThemes.pdsTornado
        : warningThemes.tornado;
  } else if (lower.includes('mesoscale discussion')) {
    family = 'discussion';
    theme = warningThemes.discussion;
  } else if (lower.includes('outlook')) {
    family = 'outlook';
    theme = warningThemes.outlook;
  } else if (lower.includes('severe thunderstorm')) {
    family = 'severe';
    theme = isPds && isWatch
      ? warningThemes.pdsSevereThunderstormWatch
      : isDestructive
      ? warningThemes.destructiveThunderstorm
      : isConsiderable
        ? warningThemes.considerableThunderstorm
        : warningThemes.severeThunderstorm;
  } else if (lower.includes('hurricane') || lower.includes('typhoon')) {
    family = 'hurricane';
    theme = isWatch ? warningThemes.hurricaneWatch : warningThemes.hurricane;
  } else if (lower.includes('tropical storm')) {
    family = 'tropical-storm';
    theme = isWatch ? warningThemes.tropicalStormWatch : warningThemes.tropicalStorm;
  } else if (lower.includes('storm surge')) {
    family = 'storm-surge';
    theme = isWatch ? warningThemes.stormSurgeWatch : warningThemes.stormSurge;
  } else if (lower.includes('extreme wind')) {
    family = 'extreme-wind';
    theme = warningThemes.extremeWind;
  } else if (lower.includes('tropical cyclone') || lower.includes('post-tropical cyclone')) {
    family = 'tropical-cyclone';
    theme = warningThemes.tropicalStatement;
  } else if (lower.includes('flash flood')) {
    family = 'flash-flood';
    theme = warningThemes.flashFlood;
  } else if (lower.includes('flood')) {
    family = 'flood';
    theme = warningThemes.flood;
  } else if (/\b(freeze|frost|extreme cold|cold weather)\b/i.test(lower)) {
    family = 'winter';
    theme = warningThemes.freeze;
  } else if (lower.includes('winter') || lower.includes('blizzard') || lower.includes('snow') || lower.includes('ice')) {
    family = 'winter';
    theme = warningThemes.winter;
  } else if (lower.includes('fire') || lower.includes('red flag')) {
    family = 'fire';
    theme = warningThemes.fire;
  } else if (lower.includes('marine')) {
    family = 'marine';
    theme = warningThemes.marine;
  } else if (lower.includes('wind')) {
    family = 'wind';
    theme = warningThemes.wind;
  } else if (lower.includes('special weather statement')) {
    family = 'statement';
    theme = warningThemes.statement;
  }

  const isTropical = ['hurricane', 'tropical-storm', 'storm-surge', 'extreme-wind', 'tropical-cyclone'].includes(family);
  const isPdsWatch = isPds && isWatch;
  const alertTag = isEmergency
    ? 'EMERGENCY'
    : isPdsWatch
      ? 'PDS WATCH'
    : isPds
      ? 'PDS EMERGENCY'
      : isDestructive
        ? 'DESTRUCTIVE'
        : isConsiderable
          ? 'CONSIDERABLE'
          : isWatch
            ? 'WATCH'
            : isTropical && lower.includes('warning')
              ? 'WARNING'
              : isTropical
                ? 'ADVISORY'
                : family === 'outlook'
                  ? 'OUTLOOK'
                  : '';

  return {
    family,
    isWatch,
    isWarning: lower.includes('warning'),
    isTropical,
    isEmergency,
    isPds,
    isPdsWatch,
    isDestructive,
    isConsiderable,
    isDiscussion: family === 'discussion',
    isOutlook: family === 'outlook',
    isForecast: family === 'forecast',
    alertTag,
    renderAsGif: isEmergency && lower.includes('tornado'),
    theme
  };
};

export const themeForAlert = (alert = {}) => classifyAlert(alert).theme;

export const themeForEvent = (event = '') => {
  return classifyAlert({ event }).theme;
};

export const defaultRadarModeForEvent = (event = '') => {
  const lower = String(event).toLowerCase();
  if (lower.includes('watch')) return 'reflectivity';
  if (lower.includes('tornado') || lower.includes('severe thunderstorm')) return 'both';
  if (/\b(hurricane|tropical storm|storm surge|extreme wind|typhoon|tropical cyclone)\b/.test(lower)) return 'reflectivity';
  if (lower.includes('flash flood') || lower.includes('flood')) return 'reflectivity';
  return 'reflectivity';
};
