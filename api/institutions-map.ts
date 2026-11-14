import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface GeocodedLocation {
  lat: number;
  lng: number;
  placeId: string | null;
  formattedAddress: string | null;
}

interface InstitutionRow {
  id: string;
  address: string | null;
  placeholder?: boolean;
}

interface CacheEntry {
  value: GeocodedLocation;
  expiresAt: number;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const geocodeCache: Record<string, CacheEntry> = {};

class QuotaError extends Error {}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function getApiKey(): string {
  return (process.env.VITE_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '').trim();
}

async function geocodeV4(address: string, apiKey: string): Promise<GeocodedLocation | null> {
  const url = `https://geocode.googleapis.com/v4/geocode/address/${encodeURIComponent(address)}?regionCode=ro`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'results.placeId,results.location,results.formattedAddress',
      'X-Goog-Maps-Solution-ID': 'gmp_mcp_codeassist_v1_aistudio',
    },
    signal: AbortSignal.timeout(10_000),
  });

  const data = (await response.json().catch(() => null)) as {
    error?: { status?: string; code?: number };
    results?: Array<{
      placeId?: string;
      formattedAddress?: string;
      location?: { latitude?: number; longitude?: number };
    }>;
  } | null;

  if (response.status === 429 || data?.error?.status === 'RESOURCE_EXHAUSTED') {
    throw new QuotaError('RESOURCE_EXHAUSTED');
  }

  if (!response.ok) return null;

  const first = data?.results?.[0];
  const lat = first?.location?.latitude;
  const lng = first?.location?.longitude;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;

  return {
    lat,
    lng,
    placeId: typeof first?.placeId === 'string' ? first.placeId : null,
    formattedAddress: typeof first?.formattedAddress === 'string' ? first.formattedAddress : null,
  };
}

async function geocodeStandard(address: string, apiKey: string): Promise<GeocodedLocation | null> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&region=ro&key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, {
    method: 'GET',
    signal: AbortSignal.timeout(10_000),
  });

  const data = (await response.json().catch(() => null)) as {
    status?: string;
    results?: Array<{
      place_id?: string;
      formatted_address?: string;
      geometry?: { location?: { lat?: number; lng?: number } };
    }>;
  } | null;

  if (response.status === 429 || data?.status === 'OVER_QUERY_LIMIT') {
    throw new QuotaError('OVER_QUERY_LIMIT');
  }

  if (!response.ok || data?.status !== 'OK') return null;

  const first = data.results?.[0];
  const lat = first?.geometry?.location?.lat;
  const lng = first?.geometry?.location?.lng;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;

  return {
    lat,
    lng,
    placeId: typeof first?.place_id === 'string' ? first.place_id : null,
    formattedAddress: typeof first?.formatted_address === 'string' ? first.formatted_address : null,
  };
}

async function resolveAddress(address: string, apiKey: string): Promise<GeocodedLocation | null> {
  const now = Date.now();
  const cached = geocodeCache[address];
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const v4 = await geocodeV4(address, apiKey);
  const resolved = v4 ?? (await geocodeStandard(address, apiKey));
  if (resolved) {
    geocodeCache[address] = { value: resolved, expiresAt: now + CACHE_TTL_MS };
  }
  return resolved;
}

export async function GET(): Promise<Response> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return json({ configured: false, locations: {}, cityCenter: null }, 503);
  }

  const institutionsPath = join(process.cwd(), 'src', 'data', 'institutions.json');
  const institutions = JSON.parse(readFileSync(institutionsPath, 'utf8')) as InstitutionRow[];

  const locations: Record<string, GeocodedLocation> = {};
  let cityCenter: GeocodedLocation | null = null;

  try {
    const entries = institutions.filter(
      (inst) => !inst.placeholder && typeof inst.address === 'string' && inst.address.trim().length > 0,
    );
    const results = await Promise.all(
      entries.map(async (inst) => {
        const resolved = await resolveAddress(inst.address!, apiKey);
        return [inst.id, resolved] as const;
      }),
    );

    for (const [id, loc] of results) {
      if (loc) locations[id] = loc;
    }

    cityCenter = await resolveAddress('Timișoara, Romania', apiKey);
  } catch (err) {
    if (err instanceof QuotaError) {
      return json({ error: 'quota_exceeded', status: 'RESOURCE_EXHAUSTED' }, 429);
    }
    return json({ error: 'geocoding_failed' }, 502);
  }

  return json({ configured: true, locations, cityCenter });
}
