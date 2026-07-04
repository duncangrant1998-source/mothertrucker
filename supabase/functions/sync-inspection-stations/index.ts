import { createClient } from 'jsr:@supabase/supabase-js@2';

const ONTARIO_511_INSPECTION_STATIONS_URL = 'https://511on.ca/api/v2/get/inspectionstations';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function normalizeStation(raw: Record<string, unknown>) {
  const id = raw.Id;
  if (id === undefined || id === null || id === '') return null;

  return {
    id: String(id),
    name: raw.Name ?? null,
    highway: raw.Highway ?? null,
    direction: raw.Direction ?? null,
    region: raw.Location ?? null,
    latitude: raw.Latitude ?? null,
    longitude: raw.Longitude ?? null,
    phone: raw.Phone ?? null,
    information: raw.Information ?? null,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get('ONTARIO_511_API_KEY');
    const url = new URL(ONTARIO_511_INSPECTION_STATIONS_URL);
    url.searchParams.set('format', 'json');
    if (apiKey) url.searchParams.set('key', apiKey);

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`Ontario 511 API request failed with status ${response.status}`);
    }

    const data = await response.json();
    console.log('Ontario 511 inspection stations raw response:', JSON.stringify(data));

    const rawStations = Array.isArray(data) ? data : data?.InspectionStations || [];
    const stations = rawStations
      .map(normalizeStation)
      .filter((station: unknown) => station !== null);

    if (stations.length === 0) {
      return new Response(JSON.stringify({ count: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { error } = await supabase
      .from('inspection_stations')
      .upsert(stations, { onConflict: 'id' });

    if (error) throw error;

    return new Response(JSON.stringify({ count: stations.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Failed to fetch/save Ontario inspection stations:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
