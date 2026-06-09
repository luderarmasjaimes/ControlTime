/**
 * Mapping of mining companies to their geographical coordinates (Lat/Lng)
 * to provide a centered view in the Map Capture Pro.
 */
export const MINING_LOCATIONS = {
  'antamina': { lat: -9.549, lng: -77.054, zoom: 15 },
  'minera antamina': { lat: -9.549, lng: -77.054, zoom: 15 },
  'compania minera antamina': { lat: -9.549, lng: -77.054, zoom: 15 },
  
  'cerro verde': { lat: -16.536, lng: -71.583, zoom: 14 },
  'minera cerro verde': { lat: -16.536, lng: -71.583, zoom: 14 },
  
  'yanacocha': { lat: -6.983, lng: -78.508, zoom: 14 },
  'minera yanacocha': { lat: -6.983, lng: -78.508, zoom: 14 },
  
  'las bambas': { lat: -14.167, lng: -72.333, zoom: 14 },
  'minera las bambas': { lat: -14.167, lng: -72.333, zoom: 14 },
  
  'toquepala': { lat: -17.2464, lng: -70.612, zoom: 13 },
  'southern peru': { lat: -17.2464, lng: -70.612, zoom: 13 },
  'southern peru copper corporation': { lat: -17.2464, lng: -70.612, zoom: 13 },
  
  'cuajone': { lat: -17.033, lng: -70.783, zoom: 14 },
  
  'antapaccay': { lat: -14.867, lng: -71.367, zoom: 14 },
  'minera antapaccay': { lat: -14.867, lng: -71.367, zoom: 14 },
  
  'raura': { lat: -10.45, lng: -76.75, zoom: 14 },
  'minera raura': { lat: -10.45, lng: -76.75, zoom: 14 },
  
  'volcan': { lat: -10.68, lng: -76.25, zoom: 14 },
  'compania minera volcan': { lat: -10.68, lng: -76.25, zoom: 14 },

  'quellaveco': { lat: -17.112, lng: -70.625, zoom: 14 },
  'anglo american quellaveco': { lat: -17.112, lng: -70.625, zoom: 14 },

  'buenaventura': { lat: -12.115, lng: -76.995, zoom: 14 },
  'chinalco': { lat: -11.595, lng: -76.195, zoom: 14 },
  'chinalco peru': { lat: -11.595, lng: -76.195, zoom: 14 },

  'shougang': { lat: -15.185, lng: -75.145, zoom: 14 },
  'shougang hierro peru': { lat: -15.185, lng: -75.145, zoom: 14 },

  'cerro verde': { lat: -16.536, lng: -71.583, zoom: 14 },
  'sociedad minera cerro verde': { lat: -16.536, lng: -71.583, zoom: 14 },
};

let remoteLocations = null;

export async function initMiningLocations() {
  try {
    const res = await fetch('/api/config/mining-locations');
    if (res.ok) {
      const data = await res.json();
      remoteLocations = data.reduce((acc, loc) => {
        const key = loc.company_name.toLowerCase().trim()
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9\s]/g, '');
        acc[key] = { lat: loc.latitude, lng: loc.longitude, zoom: loc.zoom || 14 };
        return acc;
      }, {});
      console.log('[MiningLocations] Sync complete:', data.length, 'sites loaded.');
    }
  } catch (err) {
    console.warn('[MiningLocations] Sync failed, using local fallback.', err);
  }
}

export function getMiningLocation(companyName) {
  if (!companyName) return null;
  
  // Normalize: lowercase, remove accents, trim
  let cleanName = companyName.toLowerCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '');

  const locations = remoteLocations || MINING_LOCATIONS;

  // Try exact match first
  if (locations[cleanName]) return locations[cleanName];

  // Try partial match
  const keys = Object.keys(locations);
  const bestKey = keys.find(k => cleanName.includes(k) || k.includes(cleanName));
  
  return bestKey ? locations[bestKey] : null;
}
