/**
 * Pre-baked list of major Saudi Arabian populated areas (cities, towns,
 * industrial complexes). Used by the live-detection intercept-point
 * algorithm to avoid recommending an engagement that would put debris
 * over a city — without requiring the operator to mark every settlement
 * as a "sensitive area" by hand.
 *
 * `radius_km` is the approximate urban-fabric radius from the city
 * centre. The intercept algorithm treats the *edge* of that disc as the
 * safety boundary, not the centre, so a drone passing 6 km from Riyadh
 * city centre still counts as "over Riyadh" because the metro spreads
 * to ~25 km.
 *
 * Sources: city centroids from OpenStreetMap, urban radii eyeballed
 * from satellite imagery. These are good enough for a defense-grade
 * "is this point over a populated area" check at city scale; for sub-
 * neighbourhood precision, a real deployment would swap this for a
 * land-cover raster.
 */
export type PopulatedArea = {
  name: string;
  lat: number;
  lon: number;
  radius_km: number;
};

export const SAUDI_POPULATED_AREAS: PopulatedArea[] = [
  // Central
  { name: "Riyadh", lat: 24.7136, lon: 46.6753, radius_km: 25 },
  { name: "Al-Kharj", lat: 24.1503, lon: 47.3346, radius_km: 8 },
  { name: "Al-Majmaah", lat: 25.9050, lon: 45.3450, radius_km: 5 },

  // Hejaz / west
  { name: "Jeddah", lat: 21.4858, lon: 39.1925, radius_km: 20 },
  { name: "Mecca", lat: 21.3891, lon: 39.8579, radius_km: 12 },
  { name: "Medina", lat: 24.5247, lon: 39.5692, radius_km: 12 },
  { name: "Taif", lat: 21.4373, lon: 40.5127, radius_km: 10 },
  { name: "Yanbu", lat: 24.0900, lon: 38.0617, radius_km: 10 },
  { name: "Yanbu Industrial City", lat: 24.0167, lon: 38.1833, radius_km: 8 },
  { name: "Rabigh", lat: 22.7986, lon: 39.0341, radius_km: 6 },

  // Eastern province
  { name: "Dammam", lat: 26.4207, lon: 50.0888, radius_km: 15 },
  { name: "Khobar", lat: 26.2172, lon: 50.1971, radius_km: 10 },
  { name: "Dhahran", lat: 26.2361, lon: 50.0393, radius_km: 8 },
  { name: "Al-Qatif", lat: 26.5667, lon: 50.0040, radius_km: 6 },
  { name: "Jubail", lat: 27.0046, lon: 49.6585, radius_km: 12 },
  { name: "Hofuf", lat: 25.3654, lon: 49.5874, radius_km: 10 },
  { name: "Abqaiq", lat: 25.9357, lon: 49.6708, radius_km: 6 },
  { name: "Ras Tanura", lat: 26.6388, lon: 50.1583, radius_km: 6 },

  // North
  { name: "Hafr Al-Batin", lat: 28.4337, lon: 45.9601, radius_km: 8 },
  { name: "Tabuk", lat: 28.3835, lon: 36.5662, radius_km: 10 },
  { name: "Sakaka", lat: 29.9697, lon: 40.2064, radius_km: 6 },
  { name: "Arar", lat: 30.9755, lon: 41.0381, radius_km: 6 },
  { name: "Hail", lat: 27.5219, lon: 41.6907, radius_km: 8 },
  { name: "Buraydah", lat: 26.3260, lon: 43.9750, radius_km: 10 },
  { name: "Unaizah", lat: 26.0840, lon: 43.9933, radius_km: 6 },

  // South / southwest
  { name: "Abha", lat: 18.2164, lon: 42.5047, radius_km: 8 },
  { name: "Khamis Mushait", lat: 18.3092, lon: 42.7297, radius_km: 8 },
  { name: "Najran", lat: 17.4924, lon: 44.1277, radius_km: 8 },
  { name: "Jizan", lat: 16.8892, lon: 42.5511, radius_km: 6 },
  { name: "Al-Bahah", lat: 20.0129, lon: 41.4677, radius_km: 6 },

  // Military / strategic clusters worth treating as populated
  { name: "King Khalid Military City", lat: 28.4328, lon: 45.9708, radius_km: 6 },
  { name: "Prince Sultan Air Base", lat: 24.0617, lon: 47.5805, radius_km: 5 },
];
