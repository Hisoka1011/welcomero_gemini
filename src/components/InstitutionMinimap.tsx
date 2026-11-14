import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  APILoadingStatus,
  APIProvider,
  AdvancedMarker,
  AdvancedMarkerAnchorPoint,
  InfoWindow,
  Map as GoogleMap,
  useAdvancedMarkerRef,
  useApiLoadingStatus,
  useMap,
  useMapsLibrary,
  type AdvancedMarkerProps,
} from '@vis.gl/react-google-maps';
import { useI18n } from '../context/useI18n';
import { getInstitutionVisual } from '../lib/institutions';
import type { Institution } from '../types';
import { Icon } from './Icon';
import { cardClass, linkClass, Notice } from './ui';

interface ResolvedLocation {
  lat: number;
  lng: number;
  placeId: string | null;
  formattedAddress: string | null;
}

interface MinimapApiResponse {
  configured?: boolean;
  locations?: Record<string, ResolvedLocation>;
  cityCenter?: ResolvedLocation | null;
  error?: string;
  status?: string;
}

const MAPS_API_KEY = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined)?.trim() ?? '';
const ATTRIBUTION_IDS = ['gmp_mcp_codeassist_v1_aistudio'];
const Z_INDEX_HOVER = 999;
const Z_INDEX_SELECTED = 1000;

function triggerQuotaExceeded() {
  window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
}

function mapsSearchUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

interface AdvancedMarkerWithRefProps extends AdvancedMarkerProps {
  onMarkerMount?: (marker: google.maps.marker.AdvancedMarkerElement) => void;
  onMarkerSelect: (marker: google.maps.marker.AdvancedMarkerElement) => void;
}

function AdvancedMarkerWithRef({
  children,
  onMarkerMount,
  onMarkerSelect,
  ...props
}: AdvancedMarkerWithRefProps) {
  const [markerRef, marker] = useAdvancedMarkerRef();

  useEffect(() => {
    if (marker && onMarkerMount) onMarkerMount(marker);
  }, [marker, onMarkerMount]);

  return (
    <AdvancedMarker
      ref={markerRef}
      onClick={() => {
        if (marker) onMarkerSelect(marker);
      }}
      {...props}
    >
      {children}
    </AdvancedMarker>
  );
}

/**
 * Fallback geocoder via Maps JS Places API (New) if the server geocoding route
 * did not return coordinates for one or more verified addresses.
 */
function PlacesAddressResolver({
  institutions,
  locations,
  cityCenter,
  loadingLocations,
  onResolved,
}: {
  institutions: Institution[];
  locations: Record<string, ResolvedLocation>;
  cityCenter: ResolvedLocation | null;
  loadingLocations: boolean;
  onResolved: (next: Record<string, ResolvedLocation>, nextCityCenter: ResolvedLocation | null) => void;
}) {
  const placesLib = useMapsLibrary('places');
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (loadingLocations || !placesLib || attemptedRef.current) return;
    const missing = institutions.filter((inst) => inst.address && !locations[inst.id]);
    if (missing.length === 0 && cityCenter) return;
    attemptedRef.current = true;

    let cancelled = false;

    async function resolveMissing() {
      const additions: Record<string, ResolvedLocation> = {};
      let resolvedCity = cityCenter;

      for (const inst of missing) {
        if (!inst.address) continue;
        try {
          const { places } = await placesLib!.Place.searchByText({
            textQuery: inst.address,
            fields: ['id', 'location', 'formattedAddress'],
            region: 'RO',
            maxResultCount: 1,
          });
          const match = places?.[0];
          if (match?.location) {
            additions[inst.id] = {
              lat: match.location.lat(),
              lng: match.location.lng(),
              placeId: match.id ?? null,
              formattedAddress: match.formattedAddress ?? inst.address,
            };
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('OVER_QUERY_LIMIT') || msg.includes('429')) {
            triggerQuotaExceeded();
            break;
          }
        }
      }

      if (!resolvedCity) {
        try {
          const { places } = await placesLib!.Place.searchByText({
            textQuery: 'Timișoara, Romania',
            fields: ['id', 'location', 'formattedAddress'],
            region: 'RO',
            maxResultCount: 1,
          });
          const match = places?.[0];
          if (match?.location) {
            resolvedCity = {
              lat: match.location.lat(),
              lng: match.location.lng(),
              placeId: match.id ?? null,
              formattedAddress: match.formattedAddress ?? null,
            };
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('OVER_QUERY_LIMIT') || msg.includes('429')) {
            triggerQuotaExceeded();
          }
        }
      }

      if (!cancelled && (Object.keys(additions).length > 0 || resolvedCity !== cityCenter)) {
        onResolved(additions, resolvedCity);
      }
    }

    void resolveMissing();
    return () => {
      cancelled = true;
    };
  }, [loadingLocations, placesLib, institutions, locations, cityCenter, onResolved]);

  return null;
}

function MapViewportController({
  mappedPositions,
  selectedId,
  locations,
  fitTrigger,
}: {
  mappedPositions: Array<{ id: string; position: ResolvedLocation }>;
  selectedId: string | null;
  locations: Record<string, ResolvedLocation>;
  fitTrigger: number;
}) {
  const map = useMap();
  const hasFittedInitial = useRef(false);

  const fitAll = useCallback(() => {
    if (!map || mappedPositions.length === 0 || typeof google === 'undefined') return;
    if (mappedPositions.length === 1) {
      map.panTo({ lat: mappedPositions[0].position.lat, lng: mappedPositions[0].position.lng });
      map.setZoom(15);
      return;
    }
    const bounds = new google.maps.LatLngBounds();
    for (const item of mappedPositions) {
      bounds.extend({ lat: item.position.lat, lng: item.position.lng });
    }
    map.fitBounds(bounds, { top: 48, right: 48, bottom: 48, left: 48 });
  }, [map, mappedPositions]);

  useEffect(() => {
    if (!map || mappedPositions.length === 0 || hasFittedInitial.current) return;
    hasFittedInitial.current = true;
    fitAll();
  }, [map, mappedPositions, fitAll]);

  useEffect(() => {
    if (fitTrigger > 0) fitAll();
  }, [fitTrigger, fitAll]);

  useEffect(() => {
    if (!map || !selectedId) return;
    const pos = locations[selectedId];
    if (!pos) return;
    map.panTo({ lat: pos.lat, lng: pos.lng });
    const currentZoom = map.getZoom() ?? 14;
    if (currentZoom < 15) map.setZoom(15);
  }, [map, selectedId, locations]);

  return null;
}

function MinimapCanvas({
  institutions,
  locations,
  cityCenter,
  selectedId,
  hoveredId,
  fitTrigger,
  loadingLocations,
  onSelectInstitution,
  onHoverInstitution,
  onJumpToCard,
  onResolvedLocations,
}: {
  institutions: Institution[];
  locations: Record<string, ResolvedLocation>;
  cityCenter: ResolvedLocation | null;
  selectedId: string | null;
  hoveredId: string | null;
  fitTrigger: number;
  loadingLocations: boolean;
  onSelectInstitution: (id: string | null) => void;
  onHoverInstitution: (id: string | null) => void;
  onJumpToCard: (id: string) => void;
  onResolvedLocations: (next: Record<string, ResolvedLocation>, nextCityCenter: ResolvedLocation | null) => void;
}) {
  const { t, loc } = useI18n();
  const status = useApiLoadingStatus();
  const [selectedMarker, setSelectedMarker] = useState<google.maps.marker.AdvancedMarkerElement | null>(null);
  const [markerInstances, setMarkerInstances] = useState<Record<string, google.maps.marker.AdvancedMarkerElement>>({});

  const registerMarker = useCallback((id: string, marker: google.maps.marker.AdvancedMarkerElement) => {
    setMarkerInstances((prev) => (prev[id] === marker ? prev : { ...prev, [id]: marker }));
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setSelectedMarker(null);
      return;
    }
    const marker = markerInstances[selectedId] ?? null;
    setSelectedMarker(marker);
  }, [selectedId, markerInstances]);

  const mappedInstitutions = useMemo(() => {
    const items = institutions
      .map((inst) => {
        const position = locations[inst.id];
        return position ? { inst, position } : null;
      })
      .filter((entry): entry is { inst: Institution; position: ResolvedLocation } => entry !== null);

    // Sort descending by latitude so southern markers render cleanly in front of northern ones.
    return items
      .sort((a, b) => b.position.lat - a.position.lat)
      .map((entry, index) => ({ ...entry, baseZIndex: index + 1 }));
  }, [institutions, locations]);

  const initialCenter = useMemo(() => {
    if (mappedInstitutions.length > 0) {
      return { lat: mappedInstitutions[0].position.lat, lng: mappedInstitutions[0].position.lng };
    }
    if (cityCenter) {
      return { lat: cityCenter.lat, lng: cityCenter.lng };
    }
    return null;
  }, [mappedInstitutions, cityCenter]);

  const selectedInstitution = useMemo(
    () => (selectedId ? institutions.find((i) => i.id === selectedId) ?? null : null),
    [institutions, selectedId],
  );

  if (status === APILoadingStatus.FAILED || status === APILoadingStatus.AUTH_FAILURE) {
    return (
      <Notice tone="warning" role="status">
        {t('inst.minimap.unavailable')}
      </Notice>
    );
  }

  return (
    <div className="relative h-[340px] w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100 sm:h-[380px]">
      <PlacesAddressResolver
        institutions={institutions}
        locations={locations}
        cityCenter={cityCenter}
        loadingLocations={loadingLocations}
        onResolved={onResolvedLocations}
      />

      {!initialCenter ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted">
          <div className="skeleton h-8 w-8 rounded-full" aria-hidden="true" />
          <p>{loadingLocations ? t('inst.minimap.loading') : t('inst.minimap.unavailable')}</p>
        </div>
      ) : (
        <GoogleMap
          mapId="DEMO_MAP_ID"
          defaultCenter={initialCenter}
          defaultZoom={14}
          gestureHandling="cooperative"
          mapTypeControl={false}
          streetViewControl={false}
          fullscreenControl={true}
          internalUsageAttributionIds={ATTRIBUTION_IDS}
          style={{ width: '100%', height: '100%' }}
          onClick={() => onSelectInstitution(null)}
        >
          <MapViewportController
            mappedPositions={mappedInstitutions.map(({ inst, position }) => ({ id: inst.id, position }))}
            selectedId={selectedId}
            locations={locations}
            fitTrigger={fitTrigger}
          />

          {mappedInstitutions.map(({ inst, position, baseZIndex }) => {
            const visual = getInstitutionVisual(inst.id);
            const isSelected = selectedId === inst.id;
            const isHovered = hoveredId === inst.id;
            const zIndex = isSelected ? Z_INDEX_SELECTED : isHovered ? Z_INDEX_HOVER : baseZIndex;

            return (
              <AdvancedMarkerWithRef
                key={inst.id}
                position={{ lat: position.lat, lng: position.lng }}
                title={loc(inst.name)}
                zIndex={zIndex}
                anchorPoint={AdvancedMarkerAnchorPoint.BOTTOM}
                onMouseEnter={() => onHoverInstitution(inst.id)}
                onMouseLeave={() => onHoverInstitution(null)}
                onMarkerMount={(marker) => registerMarker(inst.id, marker)}
                onMarkerSelect={(marker) => {
                  registerMarker(inst.id, marker);
                  onSelectInstitution(inst.id);
                }}
              >
                <div
                  className={`group flex flex-col items-center transition-transform duration-150 ${
                    isSelected ? 'scale-110' : isHovered ? 'scale-105' : ''
                  }`}
                >
                  <div
                    className={`flex items-center gap-1.5 rounded-full border-2 px-2.5 py-1.5 text-white shadow-md ${
                      isSelected ? 'ring-4 ring-brand-200' : ''
                    }`}
                    style={{ backgroundColor: visual.pinBg, borderColor: '#ffffff' }}
                  >
                    <Icon name={visual.icon} className="size-4" />
                    <span className="max-w-[8rem] truncate text-xs font-bold leading-none">
                      {t(visual.shortKey)}
                    </span>
                  </div>
                  <div
                    className="h-2.5 w-2.5 -mt-1.5 rotate-45 border-r-2 border-b-2 border-white"
                    style={{ backgroundColor: visual.pinBg }}
                    aria-hidden="true"
                  />
                </div>
              </AdvancedMarkerWithRef>
            );
          })}

          {selectedInstitution && selectedMarker && locations[selectedInstitution.id] ? (
            <InfoWindow
              anchor={selectedMarker}
              pixelOffset={[0, -8]}
              maxWidth={290}
              onCloseClick={() => onSelectInstitution(null)}
            >
              <div className="space-y-2 p-1 text-ink">
                <div className="flex items-start gap-2">
                  <span
                    className={`mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-lg border ${getInstitutionVisual(selectedInstitution.id).badgeClass}`}
                  >
                    <Icon name={getInstitutionVisual(selectedInstitution.id).icon} className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold leading-snug text-brand-900">
                      {loc(selectedInstitution.name)}
                    </h3>
                    {selectedInstitution.address ? (
                      <p className="mt-0.5 text-xs text-muted">{selectedInstitution.address}</p>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-1 text-xs">
                  {selectedInstitution.address ? (
                    <a
                      href={mapsSearchUrl(selectedInstitution.address)}
                      target="_blank"
                      rel="noreferrer noopener"
                      className={linkClass}
                    >
                      {t('inst.maps')}
                    </a>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => onJumpToCard(selectedInstitution.id)}
                    className="font-semibold text-brand-700 underline underline-offset-2 hover:text-brand-900"
                  >
                    {t('inst.minimap.viewDetails')}
                  </button>
                </div>
              </div>
            </InfoWindow>
          ) : null}
        </GoogleMap>
      )}
    </div>
  );
}

export function InstitutionMinimap({
  institutions,
  selectedId,
  onSelectInstitution,
  onJumpToCard,
}: {
  institutions: Institution[];
  selectedId: string | null;
  onSelectInstitution: (id: string | null) => void;
  onJumpToCard: (id: string) => void;
}) {
  const { t, loc, lang } = useI18n();
  const [locations, setLocations] = useState<Record<string, ResolvedLocation>>({});
  const [cityCenter, setCityCenter] = useState<ResolvedLocation | null>(null);
  const [loadingLocations, setLoadingLocations] = useState(true);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [fitTrigger, setFitTrigger] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadLocations() {
      setLoadingLocations(true);
      try {
        const res = await fetch('/api/institutions-map');
        const data = (await res.json().catch(() => null)) as MinimapApiResponse | null;
        if (res.status === 429 || data?.status === 'RESOURCE_EXHAUSTED' || data?.error === 'quota_exceeded') {
          triggerQuotaExceeded();
        }
        if (!cancelled && res.ok && data) {
          if (data.locations) setLocations(data.locations);
          if (data.cityCenter) setCityCenter(data.cityCenter);
        }
      } catch {
        // Fallback to client-side Places API resolution inside APIProvider
      } finally {
        if (!cancelled) setLoadingLocations(false);
      }
    }

    void loadLocations();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleResolvedLocations = useCallback(
    (additions: Record<string, ResolvedLocation>, nextCityCenter: ResolvedLocation | null) => {
      if (Object.keys(additions).length > 0) {
        setLocations((prev) => ({ ...prev, ...additions }));
      }
      if (nextCityCenter) {
        setCityCenter((prev) => prev ?? nextCityCenter);
      }
    },
    [],
  );

  const mapInstitutions = useMemo(
    () => institutions.filter((inst) => !inst.placeholder),
    [institutions],
  );

  const unverifiedInstitutions = useMemo(
    () => mapInstitutions.filter((inst) => !inst.address),
    [mapInstitutions],
  );

  return (
    <section aria-labelledby="inst-minimap-title" className={`${cardClass} space-y-4`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="inst-minimap-title" className="flex items-center gap-2 text-lg font-bold text-brand-900">
            <Icon name="mapPin" className="size-5 text-brand-700" />
            {t('inst.minimap.title')}
          </h2>
          <p className="mt-1 text-sm text-muted">{t('inst.minimap.subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            onSelectInstitution(null);
            setFitTrigger((n) => n + 1);
          }}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-brand-700 bg-white px-3 py-1.5 text-sm font-semibold text-brand-800 hover:bg-brand-50"
        >
          <Icon name="locate" className="size-4" />
          {t('inst.minimap.showAll')}
        </button>
      </div>

      {/* Institutional buildings/offices shown on the minimap with icons */}
      <ul className="flex flex-wrap gap-2" aria-label={t('inst.minimap.title')}>
        {mapInstitutions.map((inst) => {
          const visual = getInstitutionVisual(inst.id);
          const hasAddress = Boolean(inst.address);
          const isSelected = selectedId === inst.id;
          return (
            <li key={inst.id}>
              <button
                type="button"
                onClick={() => {
                  if (hasAddress) {
                    onSelectInstitution(inst.id);
                  } else {
                    onSelectInstitution(inst.id);
                    onJumpToCard(inst.id);
                  }
                }}
                onMouseEnter={() => setHoveredId(inst.id)}
                onMouseLeave={() => setHoveredId(null)}
                aria-pressed={isSelected}
                className={`inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-start text-sm font-medium transition-colors ${
                  isSelected
                    ? 'border-brand-700 bg-brand-50 text-brand-900 ring-2 ring-brand-200'
                    : 'border-slate-200 bg-white text-ink hover:border-brand-300 hover:bg-slate-50'
                }`}
              >
                <span
                  className={`inline-flex size-6 shrink-0 items-center justify-center rounded-md border ${visual.badgeClass}`}
                >
                  <Icon name={visual.icon} className="size-3.5" />
                </span>
                <span>{t(visual.shortKey)}</span>
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
                    hasAddress ? 'bg-emerald-100 text-emerald-900' : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {hasAddress ? t('inst.minimap.pinned') : t('inst.minimap.noAddress')}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {MAPS_API_KEY ? (
        <APIProvider apiKey={MAPS_API_KEY} libraries={['marker', 'places']} language={lang} region="RO">
          <MinimapCanvas
            institutions={mapInstitutions}
            locations={locations}
            cityCenter={cityCenter}
            selectedId={selectedId}
            hoveredId={hoveredId}
            fitTrigger={fitTrigger}
            loadingLocations={loadingLocations}
            onSelectInstitution={onSelectInstitution}
            onHoverInstitution={setHoveredId}
            onJumpToCard={onJumpToCard}
            onResolvedLocations={handleResolvedLocations}
          />
        </APIProvider>
      ) : (
        <Notice tone="warning" role="status">
          {t('inst.minimap.unavailable')}
        </Notice>
      )}

      {unverifiedInstitutions.length > 0 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
          <h3 className="text-xs font-bold uppercase tracking-wide text-muted">
            {t('inst.minimap.unverifiedTitle')}
          </h3>
          <div className="mt-2.5 grid gap-3 sm:grid-cols-2">
            {unverifiedInstitutions.map((inst) => {
              const visual = getInstitutionVisual(inst.id);
              const isSelected = selectedId === inst.id;
              return (
                <div
                  key={inst.id}
                  className={`flex items-start gap-3 rounded-lg border bg-white p-3 ${
                    isSelected ? 'border-brand-600 ring-2 ring-brand-200' : 'border-slate-200'
                  }`}
                >
                  <span
                    className={`mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg border ${visual.badgeClass}`}
                  >
                    <Icon name={visual.icon} className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-brand-900">{loc(inst.name)}</p>
                    <p className="mt-0.5 text-xs text-muted">{t('inst.notVerified')}</p>
                    <div className="mt-2 flex flex-wrap gap-3 text-xs">
                      <button
                        type="button"
                        onClick={() => onJumpToCard(inst.id)}
                        className={linkClass}
                      >
                        {t('inst.minimap.viewDetails')}
                      </button>
                      <a
                        href={inst.website}
                        target="_blank"
                        rel="noreferrer noopener"
                        className={linkClass}
                        dir="ltr"
                      >
                        {inst.website.replace('https://', '')}
                      </a>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}
