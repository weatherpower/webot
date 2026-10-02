export const sampleWarning = {
  title: 'TORNADO WARNING IN WISCONSIN',
  event: 'Tornado Warning',
  state: 'Wisconsin',
  office: 'KMKX',
  expiresAt: '2026-06-24T21:15:00.000Z',
  issuedAt: '2026-06-24T20:27:00.000Z',
  timezone: 'America/Chicago',
  hazards: {
    label: 'Tornado',
    value: 'Radar indicated',
    subtext: 'Take shelter now',
    hail: '',
    hailSubtext: ''
  },
  impacts: {
    people: 85078,
    homes: 36545
  },
  sourceText: 'WEATHER SPOTTERS REPORTED FUNNEL CLOUD - MOVING NW AT 23 MPH',
  whatToDo: 'Move to the lowest floor of a sturdy building immediately. Stay away from windows. If outdoors with no shelter, lie flat in a low spot and cover your head.',
  polygon: [
    [-89.18, 42.73],
    [-88.95, 42.68],
    [-89.02, 42.51],
    [-89.30, 42.60],
    [-89.38, 42.71],
    [-89.18, 42.73]
  ],
  center: [-89.12, 42.62],
  zoom: 8.8,
  radar: {
    mode: 'both',
    site: 'MKX',
    siteName: 'Milwaukee/Sullivan'
  },
  parameters: {
    tornadoDetection: ['RADAR INDICATED'],
    tornadoDamageThreat: ['CONSIDERABLE']
  },
  locations: ['Janesville', 'Beloit', 'Whitewater'],
  postText: 'Tornado Warning in Wisconsin until 4:15 PM CDT. Take shelter now.'
};
