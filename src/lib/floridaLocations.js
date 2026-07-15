// Geocoding lookup for common intermodal / Florida logistics points.
// Returns { lat, lng } for a city/port string, or null if unknown.
// Kept static + offline for reliability (no external API, no credits).

const LOCATIONS = {
  // ── Florida ports & cities ───────────────────────────────────────
  'miami': [25.7617, -80.1918],
  'portmiami': [25.7790, -80.1767],
  'miami port': [25.7790, -80.1767],
  'port everglades': [26.0894, -80.1213],
  'everglades': [26.0894, -80.1213],
  'fort lauderdale': [26.1224, -80.1373],
  'ft lauderdale': [26.1224, -80.1373],
  'hollywood': [26.0112, -80.1467],
  'davie': [26.0626, -80.2331],
  'pompano beach': [26.2379, -80.1248],
  'boca raton': [26.3683, -80.1289],
  'delray beach': [26.4615, -80.0731],
  'boynton beach': [26.5254, -80.0665],
  'west palm beach': [26.7153, -80.0534],
  'wpb': [26.7153, -80.0534],
  'palm beach': [26.7153, -80.0534],
  'port palm beach': [26.7700, -80.0470],
  'palm beach port': [26.7700, -80.0470],
  'naples': [26.1420, -81.7946],
  'marco island': [25.9407, -81.7198],
  'fort myers': [26.6406, -81.8723],
  'ft myers': [26.6406, -81.8723],
  'cape coral': [26.5629, -82.0134],
  'homestead': [25.4687, -80.4829],
  'hialeah': [25.8576, -80.2785],
  'doral': [25.8195, -80.3459],
  'medley': [25.8581, -80.3267],
  'kendall': [26.6715, -80.3165],
  'coral gables': [25.7215, -80.2684],
  'key west': [24.5551, -81.7800],
  'key largo': [25.0865, -80.4473],
  'melbourne': [28.0836, -80.6081],
  'vero beach': [27.6386, -80.3973],
  'fort pierce': [27.4467, -80.3256],
  'port canaveral': [28.4166, -80.6189],
  'canaveral': [28.4166, -80.6189],
  'titusville': [28.6122, -80.8073],
  'daytona beach': [29.2108, -81.0228],
  'st augustine': [29.8947, -81.3145],
  'saint augustine': [29.8947, -81.3145],
  'jacksonville': [30.3322, -81.6557],
  'jax': [30.3322, -81.6557],
  'jaxport': [30.3962, -81.6398],
  'jacksonville port': [30.3962, -81.6398],
  'gainesville': [29.6516, -82.3248],
  'ocala': [29.1872, -82.1326],
  'tallahassee': [30.4383, -84.2807],
  'panama city': [30.1588, -85.6602],
  'pensacola': [30.4213, -87.2169],
  'tampa': [27.9506, -82.4572],
  'tampa port': [27.9400, -82.4400],
  'port manatee': [27.6400, -82.5600],
  'lakeland': [28.0395, -81.9498],
  'orlando': [28.5383, -81.3792],
  'kissimmee': [28.2920, -81.4076],
  'sarasota': [27.3364, -82.5307],
  'bradenton': [27.4989, -82.5748],
  'st petersburg': [27.7676, -82.6403],
  'saint petersburg': [27.7676, -82.6403],
  'clearwater': [27.9659, -82.8001],
  // ── Southeast / neighboring ───────────────────────────────────────
  'savannah': [32.0809, -81.0912],
  'savannah port': [32.0809, -81.0912],
  'garden city': [32.0950, -81.1567],
  'brunswick': [31.1499, -81.4912],
  'charleston': [32.7765, -79.9311],
  'charleston port': [32.7812, -79.9255],
  'atlanta': [33.7490, -84.3880],
  'macon': [32.8407, -83.6324],
  'valdosta': [30.8332, -83.2785],
  'mobile': [30.6944, -88.0430],
  'mobile port': [30.6944, -88.0430],
  'montgomery': [32.3792, -86.3020],
  'birmingham': [33.5186, -86.8104],
  'huntsville': [34.7257, -86.5872],
  'nashville': [36.1627, -86.7816],
  'memphis': [35.1495, -90.0490],
  'little rock': [34.7465, -92.2896],
  // ── East Coast ports ─────────────────────────────────────────────
  'wilmington': [34.2257, -77.9447],
  'wilmington port': [34.2275, -77.9558],
  'norfolk': [36.8508, -76.2859],
  'norfolk port': [36.9120, -76.3350],
  'newport news': [36.8529, -76.4133],
  'richmond': [37.5407, -77.4360],
  'baltimore': [39.2904, -76.6122],
  'baltimore port': [39.2720, -76.5820],
  'philadelphia': [39.9526, -75.1652],
  'philadelphia port': [39.9050, -75.1410],
  'allentown': [40.6023, -75.4734],
  'harrisburg': [40.2732, -76.8867],
  'pittsburgh': [40.4406, -79.9959],
  'new york': [40.7128, -74.0060],
  'new york port': [40.6800, -74.0450],
  'ny nj port': [40.6800, -74.0450],
  'newark': [40.7357, -74.1723],
  'newark port': [40.6680, -74.1640],
  'elizabeth': [40.6637, -74.2107],
  'bayonne': [40.6687, -74.1131],
  'jersey city': [40.7178, -74.0431],
  'boston': [42.3601, -71.0589],
  'boston port': [42.3650, -71.0400],
  'hartford': [41.7658, -72.6734],
  'providence': [41.8240, -71.4128],
  // ── Midwest / South ───────────────────────────────────────────────
  'cleveland': [41.4993, -81.6944],
  'detroit': [42.3314, -83.0458],
  'chicago': [41.8781, -87.6298],
  'indianapolis': [39.7684, -86.1581],
  'columbus': [39.9612, -82.9988],
  'cincinnati': [39.1031, -84.5120],
  'louisville': [38.2527, -85.7585],
  'st louis': [38.6270, -90.1994],
  'kansas city': [39.0997, -94.5786],
  'oklahoma city': [35.4676, -97.5164],
  'denver': [39.7392, -104.9903],
  'dallas': [32.7767, -96.7970],
  'houston': [29.7604, -95.3698],
  'houston port': [29.6967, -95.0244],
  'galveston': [29.3013, -94.7977],
  'san antonio': [29.4241, -98.4936],
  'austin': [30.2672, -97.7431],
  'el paso': [31.7619, -106.4850],
  // ── West / other ──────────────────────────────────────────────────
  'los angeles': [34.0522, -118.2437],
  'la': [34.0522, -118.2437],
  'long beach': [33.7701, -118.1937],
  'oakland': [37.8044, -122.2712],
  'seattle': [47.6062, -122.3321],
  'portland': [45.5152, -122.6784],
  'phoenix': [33.4484, -112.0740],
  'las vegas': [36.1699, -115.1398],
  'salt lake city': [40.7608, -111.8910],
  'albuquerque': [35.0844, -106.6504],
};

function normalize(s) {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    .replace(/,?\s*(fl|fla|florida|usa|us)\b/g, '')
    .replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function geocode(raw) {
  if (!raw) return null;
  const key = normalize(raw);
  if (!key) return null;
  if (LOCATIONS[key]) {
    const [lat, lng] = LOCATIONS[key];
    return { lat, lng };
  }
  // try "contains" — handle "port miami", "miami fl", etc.
  const found = Object.keys(LOCATIONS).find((k) => key.includes(k) || k.includes(key));
  if (found) {
    const [lat, lng] = LOCATIONS[found];
    return { lat, lng };
  }
  return null;
}

export default geocode;