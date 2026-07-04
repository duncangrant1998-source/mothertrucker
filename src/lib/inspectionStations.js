import { supabase } from './supabase';

/**
 * Triggers the `sync-inspection-stations` Supabase Edge Function, which fetches
 * all truck inspection stations from the Ontario 511 API (server-side, since
 * 511on.ca does not send CORS headers and cannot be called from the browser)
 * and upserts them into the Supabase `inspection_stations` table.
 * @returns {Promise<number>} number of stations saved
 */
export async function fetchOntarioInspectionStations() {
  try {
    const { data, error } = await supabase.functions.invoke('sync-inspection-stations');

    if (error) {
      throw error;
    }
    if (data?.error) {
      throw new Error(data.error);
    }

    return data?.count || 0;
  } catch (error) {
    console.error('Failed to fetch/save Ontario inspection stations:', error);
    return 0;
  }
}

/**
 * Returns inspection stations within the bounding box of a route,
 * sorted by distance from the start point.
 */
export async function getStationsNearRoute(startLat, startLng, endLat, endLng) {
  try {
    const minLat = Math.min(startLat, endLat);
    const maxLat = Math.max(startLat, endLat);
    const minLng = Math.min(startLng, endLng);
    const maxLng = Math.max(startLng, endLng);

    const { data, error } = await supabase
      .from('inspection_stations')
      .select('*')
      .gte('latitude', minLat)
      .lte('latitude', maxLat)
      .gte('longitude', minLng)
      .lte('longitude', maxLng);

    if (error) {
      throw error;
    }

    const stations = data || [];

    return stations
      .map((station) => ({
        ...station,
        distanceFromStart: haversineDistanceKm(
          startLat,
          startLng,
          station.latitude,
          station.longitude
        ),
      }))
      .sort((a, b) => a.distanceFromStart - b.distanceFromStart);
  } catch (error) {
    console.error('Failed to fetch inspection stations near route:', error);
    return [];
  }
}

function haversineDistanceKm(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}
