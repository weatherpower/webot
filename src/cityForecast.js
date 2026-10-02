// City forecasts for WeatherPower Live: WeBot zooms to a random city and reads its NWS forecast.
// Every state has a few cities, so a focused stream can stay inside its state.
import { fetchLocalWeather } from './localWeather.js';

// [name, state, lat, lon]
export const FORECAST_CITIES = [
  ['Birmingham', 'AL', 33.5186, -86.8104], ['Huntsville', 'AL', 34.7304, -86.5861], ['Mobile', 'AL', 30.6954, -88.0399], ['Montgomery', 'AL', 32.3792, -86.3077],
  ['Anchorage', 'AK', 61.2181, -149.9003], ['Fairbanks', 'AK', 64.8378, -147.7164], ['Juneau', 'AK', 58.3019, -134.4197],
  ['Phoenix', 'AZ', 33.4484, -112.074], ['Tucson', 'AZ', 32.2226, -110.9747], ['Flagstaff', 'AZ', 35.1983, -111.6513], ['Yuma', 'AZ', 32.6927, -114.6277],
  ['Little Rock', 'AR', 34.7465, -92.2896], ['Fayetteville', 'AR', 36.0626, -94.1574], ['Fort Smith', 'AR', 35.3859, -94.3985], ['Jonesboro', 'AR', 35.8423, -90.7043],
  ['Los Angeles', 'CA', 34.0522, -118.2437], ['San Francisco', 'CA', 37.7749, -122.4194], ['Sacramento', 'CA', 38.5816, -121.4944], ['San Diego', 'CA', 32.7157, -117.1611], ['Fresno', 'CA', 36.7378, -119.7871], ['Redding', 'CA', 40.5865, -122.3917],
  ['Denver', 'CO', 39.7392, -104.9903], ['Colorado Springs', 'CO', 38.8339, -104.8214], ['Grand Junction', 'CO', 39.0639, -108.5506], ['Pueblo', 'CO', 38.2544, -104.6091],
  ['Hartford', 'CT', 41.7658, -72.6734], ['New Haven', 'CT', 41.3083, -72.9279],
  ['Wilmington', 'DE', 39.7391, -75.5398], ['Dover', 'DE', 39.1582, -75.5244],
  ['Washington', 'DC', 38.9072, -77.0369],
  ['Miami', 'FL', 25.7617, -80.1918], ['Orlando', 'FL', 28.5383, -81.3792], ['Tampa', 'FL', 27.9506, -82.4572], ['Jacksonville', 'FL', 30.3322, -81.6557], ['Tallahassee', 'FL', 30.4383, -84.2807], ['Pensacola', 'FL', 30.4213, -87.2169], ['Key West', 'FL', 24.5551, -81.78],
  ['Atlanta', 'GA', 33.749, -84.388], ['Savannah', 'GA', 32.0809, -81.0912], ['Macon', 'GA', 32.8407, -83.6324], ['Augusta', 'GA', 33.4735, -82.0105],
  ['Honolulu', 'HI', 21.3069, -157.8583], ['Hilo', 'HI', 19.7074, -155.0885],
  ['Boise', 'ID', 43.615, -116.2023], ['Idaho Falls', 'ID', 43.4917, -112.0339], ['Coeur d’Alene', 'ID', 47.6777, -116.7805],
  ['Chicago', 'IL', 41.8781, -87.6298], ['Springfield', 'IL', 39.7817, -89.6501], ['Peoria', 'IL', 40.6936, -89.589], ['Rockford', 'IL', 42.2711, -89.094],
  ['Indianapolis', 'IN', 39.7684, -86.1581], ['Fort Wayne', 'IN', 41.0793, -85.1394], ['Evansville', 'IN', 37.9716, -87.5711], ['South Bend', 'IN', 41.6764, -86.252],
  ['Des Moines', 'IA', 41.5868, -93.625], ['Cedar Rapids', 'IA', 41.9779, -91.6656], ['Sioux City', 'IA', 42.4963, -96.4049], ['Davenport', 'IA', 41.5236, -90.5776],
  ['Wichita', 'KS', 37.6872, -97.3301], ['Topeka', 'KS', 39.0473, -95.6752], ['Dodge City', 'KS', 37.7528, -100.0171], ['Goodland', 'KS', 39.3508, -101.7101],
  ['Louisville', 'KY', 38.2527, -85.7585], ['Lexington', 'KY', 38.0406, -84.5037], ['Bowling Green', 'KY', 36.9685, -86.4808], ['Paducah', 'KY', 37.0834, -88.6001],
  ['New Orleans', 'LA', 29.9511, -90.0715], ['Baton Rouge', 'LA', 30.4515, -91.1871], ['Shreveport', 'LA', 32.5252, -93.7502], ['Lafayette', 'LA', 30.2241, -92.0198], ['Lake Charles', 'LA', 30.2266, -93.2174],
  ['Portland', 'ME', 43.6591, -70.2568], ['Bangor', 'ME', 44.8012, -68.7778], ['Caribou', 'ME', 46.8606, -68.0122],
  ['Baltimore', 'MD', 39.2904, -76.6122], ['Hagerstown', 'MD', 39.6418, -77.72], ['Ocean City', 'MD', 38.3365, -75.0849],
  ['Boston', 'MA', 42.3601, -71.0589], ['Worcester', 'MA', 42.2626, -71.8023], ['Springfield', 'MA', 42.1015, -72.5898],
  ['Detroit', 'MI', 42.3314, -83.0458], ['Grand Rapids', 'MI', 42.9634, -85.6681], ['Lansing', 'MI', 42.7325, -84.5555], ['Marquette', 'MI', 46.5436, -87.3954], ['Traverse City', 'MI', 44.7631, -85.6206],
  ['Minneapolis', 'MN', 44.9778, -93.265], ['Duluth', 'MN', 46.7867, -92.1005], ['Rochester', 'MN', 44.0121, -92.4802], ['International Falls', 'MN', 48.6011, -93.4108],
  ['Jackson', 'MS', 32.2988, -90.1848], ['Tupelo', 'MS', 34.2576, -88.7034], ['Gulfport', 'MS', 30.3674, -89.0928], ['Hattiesburg', 'MS', 31.3271, -89.2903],
  ['Kansas City', 'MO', 39.0997, -94.5786], ['St. Louis', 'MO', 38.627, -90.1994], ['Springfield', 'MO', 37.209, -93.2923], ['Columbia', 'MO', 38.9517, -92.3341],
  ['Billings', 'MT', 45.7833, -108.5007], ['Missoula', 'MT', 46.8721, -113.994], ['Great Falls', 'MT', 47.5002, -111.3008], ['Bozeman', 'MT', 45.677, -111.0429],
  ['Omaha', 'NE', 41.2565, -95.9345], ['Lincoln', 'NE', 40.8136, -96.7026], ['North Platte', 'NE', 41.1403, -100.7601], ['Scottsbluff', 'NE', 41.8666, -103.6672],
  ['Las Vegas', 'NV', 36.1699, -115.1398], ['Reno', 'NV', 39.5296, -119.8138], ['Elko', 'NV', 40.8324, -115.7631],
  ['Manchester', 'NH', 42.9956, -71.4548], ['Concord', 'NH', 43.2081, -71.5376],
  ['Newark', 'NJ', 40.7357, -74.1724], ['Atlantic City', 'NJ', 39.3643, -74.4229], ['Trenton', 'NJ', 40.2206, -74.7597],
  ['Albuquerque', 'NM', 35.0844, -106.6504], ['Santa Fe', 'NM', 35.687, -105.9378], ['Las Cruces', 'NM', 32.3199, -106.7637], ['Roswell', 'NM', 33.3943, -104.523],
  ['New York City', 'NY', 40.7128, -74.006], ['Buffalo', 'NY', 42.8864, -78.8784], ['Albany', 'NY', 42.6526, -73.7562], ['Syracuse', 'NY', 43.0481, -76.1474], ['Rochester', 'NY', 43.1566, -77.6088],
  ['Charlotte', 'NC', 35.2271, -80.8431], ['Raleigh', 'NC', 35.7796, -78.6382], ['Asheville', 'NC', 35.5951, -82.5515], ['Wilmington', 'NC', 34.2257, -77.9447], ['Cape Hatteras', 'NC', 35.2235, -75.6346],
  ['Fargo', 'ND', 46.8772, -96.7898], ['Bismarck', 'ND', 46.8083, -100.7837], ['Minot', 'ND', 48.2325, -101.2963], ['Grand Forks', 'ND', 47.9253, -97.0329],
  ['Columbus', 'OH', 39.9612, -82.9988], ['Cleveland', 'OH', 41.4993, -81.6944], ['Cincinnati', 'OH', 39.1031, -84.512], ['Toledo', 'OH', 41.6528, -83.5379], ['Dayton', 'OH', 39.7589, -84.1916],
  ['Oklahoma City', 'OK', 35.4676, -97.5164], ['Tulsa', 'OK', 36.154, -95.9928], ['Lawton', 'OK', 34.6036, -98.3959], ['Idabel', 'OK', 33.8957, -94.8263], ['Woodward', 'OK', 36.4337, -99.3904], ['McAlester', 'OK', 34.9334, -95.7697], ['Stillwater', 'OK', 36.1156, -97.0584],
  ['Portland', 'OR', 45.5152, -122.6784], ['Eugene', 'OR', 44.0521, -123.0868], ['Medford', 'OR', 42.3265, -122.8756], ['Bend', 'OR', 44.0582, -121.3153], ['Pendleton', 'OR', 45.6721, -118.7886],
  ['Philadelphia', 'PA', 39.9526, -75.1652], ['Pittsburgh', 'PA', 40.4406, -79.9959], ['Harrisburg', 'PA', 40.2732, -76.8867], ['Erie', 'PA', 42.1292, -80.0851], ['Scranton', 'PA', 41.4089, -75.6624],
  ['Providence', 'RI', 41.824, -71.4128],
  ['Charleston', 'SC', 32.7765, -79.9311], ['Columbia', 'SC', 34.0007, -81.0348], ['Greenville', 'SC', 34.8526, -82.394], ['Myrtle Beach', 'SC', 33.6891, -78.8867],
  ['Sioux Falls', 'SD', 43.5446, -96.7311], ['Rapid City', 'SD', 44.0805, -103.231], ['Pierre', 'SD', 44.3683, -100.351], ['Aberdeen', 'SD', 45.4647, -98.4865],
  ['Nashville', 'TN', 36.1627, -86.7816], ['Memphis', 'TN', 35.1495, -90.049], ['Knoxville', 'TN', 35.9606, -83.9207], ['Chattanooga', 'TN', 35.0456, -85.3097],
  ['Dallas', 'TX', 32.7767, -96.797], ['Houston', 'TX', 29.7604, -95.3698], ['San Antonio', 'TX', 29.4241, -98.4936], ['Austin', 'TX', 30.2672, -97.7431], ['El Paso', 'TX', 31.7619, -106.485], ['Amarillo', 'TX', 35.222, -101.8313], ['Lubbock', 'TX', 33.5779, -101.8552], ['Corpus Christi', 'TX', 27.8006, -97.3964], ['Brownsville', 'TX', 25.9017, -97.4975], ['Midland', 'TX', 31.9973, -102.0779], ['Wichita Falls', 'TX', 33.9137, -98.4934], ['Tyler', 'TX', 32.3513, -95.3011],
  ['Salt Lake City', 'UT', 40.7608, -111.891], ['St. George', 'UT', 37.0965, -113.5684], ['Moab', 'UT', 38.5733, -109.5498],
  ['Burlington', 'VT', 44.4759, -73.2121], ['Montpelier', 'VT', 44.2601, -72.5754],
  ['Richmond', 'VA', 37.5407, -77.436], ['Norfolk', 'VA', 36.8508, -76.2859], ['Roanoke', 'VA', 37.271, -79.9414], ['Charlottesville', 'VA', 38.0293, -78.4767],
  ['Seattle', 'WA', 47.6062, -122.3321], ['Spokane', 'WA', 47.6588, -117.426], ['Yakima', 'WA', 46.6021, -120.5059], ['Bellingham', 'WA', 48.7519, -122.4787],
  ['Charleston', 'WV', 38.3498, -81.6326], ['Morgantown', 'WV', 39.6295, -79.9559], ['Beckley', 'WV', 37.7782, -81.1882],
  ['Milwaukee', 'WI', 43.0389, -87.9065], ['Madison', 'WI', 43.0731, -89.4012], ['Green Bay', 'WI', 44.5133, -88.0133], ['La Crosse', 'WI', 43.8014, -91.2396], ['Eau Claire', 'WI', 44.8113, -91.4985],
  ['Cheyenne', 'WY', 41.14, -104.8202], ['Casper', 'WY', 42.8666, -106.3131], ['Jackson', 'WY', 43.4799, -110.7624], ['Sheridan', 'WY', 44.7972, -106.9562]
].map(([name, state, lat, lon]) => ({ name, state, lat, lon }));

// Alaska and Hawaii only come up when the stream is focused on them.
const OFF_CONUS = new Set(['AK', 'HI']);
const TTL = 30 * 60 * 1000;
const cache = new Map();
let recent = [];

const cityKey = (c) => c.name + ',' + c.state;

export const cityForecast = async (city) => {
  const key = cityKey(city);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.body;
  const local = await fetchLocalWeather({ lat: city.lat, lon: city.lon });
  const body = {
    city: { ...city },
    timeZone: local.point.timeZone,
    office: local.point.forecastOffice.split('/').pop() || '',
    radarStation: local.point.radarStation,
    current: local.current,
    periods: local.daily.slice(0, 6),
    alerts: local.alerts.slice(0, 3).map((a) => a.event).filter(Boolean)
  };
  cache.set(key, { at: Date.now(), body });
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  return body;
};

// A random city (in `state` when the stream is focused), skipping the last dozen the show has visited.
export const randomCityForecast = async ({ state = '' } = {}) => {
  const st = /^[A-Z]{2}$/.test(state) ? state : '';
  const pool = FORECAST_CITIES.filter((c) => (st ? c.state === st : !OFF_CONUS.has(c.state)));
  if (!pool.length) {
    const error = new Error('No forecast cities for ' + st);
    error.status = 404;
    throw error;
  }
  const memory = Math.min(12, pool.length - 1);
  const fresh = pool.filter((c) => !recent.slice(-memory).includes(cityKey(c)));
  // Try a few cities in case the NWS API hiccups on one.
  const order = [...(fresh.length ? fresh : pool)].sort(() => Math.random() - 0.5).slice(0, 3);
  let lastError;
  for (const city of order) {
    try {
      const body = await cityForecast(city);
      recent = [...recent.filter((k) => k !== cityKey(city)), cityKey(city)].slice(-24);
      return body;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
};
