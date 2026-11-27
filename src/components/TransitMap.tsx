import React, { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import { LocateFixed, Minus, Plus } from 'lucide-react';
import type { Bus, LatLng, PlannedTripOption, Stop, TransitLine } from '../shared/types.ts';

export interface PolylineOverlaySpec {
  id: string;
  path: LatLng[];
  color: string;
  weight?: number;
  opacity?: number;
  dashed?: boolean;
}

interface TransitMapProps {
  center?: LatLng;
  zoom?: number;
  lines?: TransitLine[];
  stops?: Stop[];
  buses?: Bus[];
  userLocation?: LatLng | null;
  selectedBusId?: number | null;
  selectedStopId?: number | null;
  selectedLineId?: number | null;
  plannedTrip?: PlannedTripOption | null;
  walkingTargetStop?: Stop | null;
  extraPolylines?: PolylineOverlaySpec[];
  editableVertices?: LatLng[];
  playbackPoint?: LatLng | null;
  onSelectBus?: (bus: Bus) => void;
  onSelectStop?: (stop: Stop) => void;
  onMapClick?: (pos: LatLng) => void;
  className?: string;
}

const RIO_DEFAULT_CENTER: LatLng = { lat: -22.921, lng: -43.192 };

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export const TransitMap: React.FC<TransitMapProps> = ({
  center = RIO_DEFAULT_CENTER,
  zoom = 13,
  lines = [],
  stops = [],
  buses = [],
  userLocation = null,
  selectedBusId = null,
  selectedStopId = null,
  selectedLineId = null,
  plannedTrip = null,
  walkingTargetStop = null,
  extraPolylines = [],
  editableVertices = [],
  playbackPoint = null,
  onSelectBus,
  onSelectStop,
  onMapClick,
  className = 'h-[420px] w-full',
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const linesLayerRef = useRef<L.LayerGroup | null>(null);
  const stopsLayerRef = useRef<L.LayerGroup | null>(null);
  const busesLayerRef = useRef<L.LayerGroup | null>(null);
  const overlayLayerRef = useRef<L.LayerGroup | null>(null);
  const busMarkersRef = useRef<Map<number, L.Marker>>(new Map());

  const onSelectBusRef = useRef(onSelectBus);
  const onSelectStopRef = useRef(onSelectStop);
  const onMapClickRef = useRef(onMapClick);
  onSelectBusRef.current = onSelectBus;
  onSelectStopRef.current = onSelectStop;
  onMapClickRef.current = onMapClick;

  const lineColorMap = useMemo(() => {
    const m = new Map<number, string>();
    for (const l of lines) m.set(l.id, l.color);
    return m;
  }, [lines]);

  // Initialize Leaflet OpenStreetMap instance once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [center.lat, center.lng],
      zoom,
      zoomControl: false,
      attributionControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19,
    }).addTo(map);

    linesLayerRef.current = L.layerGroup().addTo(map);
    stopsLayerRef.current = L.layerGroup().addTo(map);
    busesLayerRef.current = L.layerGroup().addTo(map);
    overlayLayerRef.current = L.layerGroup().addTo(map);

    map.on('click', (e: L.LeafletMouseEvent) => {
      if (onMapClickRef.current) {
        onMapClickRef.current({
          lat: Number(e.latlng.lat.toFixed(6)),
          lng: Number(e.latlng.lng.toFixed(6)),
        });
      }
    });

    mapRef.current = map;

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize({ animate: false });
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      busMarkersRef.current.clear();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Synchronize camera view smoothly when center/zoom props change explicitly
  const lastViewKeyRef = useRef<string>('');
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const key = `${center.lat.toFixed(4)},${center.lng.toFixed(4)},${zoom}`;
    if (key !== lastViewKeyRef.current) {
      lastViewKeyRef.current = key;
      map.setView([center.lat, center.lng], zoom, { animate: true });
    }
  }, [center, zoom]);

  // Build polyline specs
  const polylineSpecs = useMemo<PolylineOverlaySpec[]>(() => {
    const specs: PolylineOverlaySpec[] = [];

    for (const line of lines) {
      if (selectedLineId && line.id !== selectedLineId) continue;
      if (line.polyline.length >= 2) {
        specs.push({
          id: `line-${line.id}`,
          path: line.polyline,
          color: line.color || '#E8C547',
          weight: selectedLineId === line.id ? 6 : 4,
          opacity: selectedLineId === line.id ? 0.95 : 0.72,
        });
      }
    }

    if (plannedTrip) {
      plannedTrip.legs.forEach((leg, i) => {
        specs.push({
          id: `plan-${i}`,
          path: leg.polyline,
          color: leg.type === 'walk' ? '#292D26' : leg.lineColor || '#A8D929',
          weight: leg.type === 'walk' ? 4 : 6,
          opacity: 0.95,
          dashed: leg.type === 'walk',
        });
      });
    }

    if (userLocation && walkingTargetStop) {
      specs.push({
        id: 'walk-to-stop',
        path: [userLocation, { lat: walkingTargetStop.lat, lng: walkingTargetStop.lng }],
        color: '#292D26',
        weight: 4,
        opacity: 0.88,
        dashed: true,
      });
    }

    for (const ep of extraPolylines) {
      specs.push(ep);
    }

    if (editableVertices.length >= 2) {
      specs.push({
        id: 'editable-route',
        path: editableVertices,
        color: '#A8D929',
        weight: 5,
        opacity: 0.95,
      });
    }

    return specs;
  }, [
    lines,
    selectedLineId,
    plannedTrip,
    userLocation,
    walkingTargetStop,
    extraPolylines,
    editableVertices,
  ]);

  // Render polylines
  useEffect(() => {
    const layer = linesLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    for (const spec of polylineSpecs) {
      if (spec.path.length < 2) continue;
      L.polyline(
        spec.path.map((pt) => [pt.lat, pt.lng] as [number, number]),
        {
          color: spec.color,
          weight: spec.weight ?? 4,
          opacity: spec.opacity ?? 0.85,
          dashArray: spec.dashed ? '6 8' : undefined,
          lineCap: 'round',
          lineJoin: 'round',
        }
      ).addTo(layer);
    }
  }, [polylineSpecs]);

  // Render stops
  useEffect(() => {
    const layer = stopsLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    for (const stop of stops) {
      const isSelected = selectedStopId === stop.id;
      const bg = isSelected ? '#A8D929' : '#FFFDF8';
      const border = isSelected ? '#292D26' : 'rgba(41,45,38,0.45)';
      const ring = isSelected ? 'box-shadow:0 0 0 3px rgba(168,217,41,0.45);transform:scale(1.1);' : 'box-shadow:0 2px 6px rgba(41,45,38,0.16);';

      const icon = L.divIcon({
        className: 'transit-stop-marker',
        iconSize: [52, 22],
        iconAnchor: [26, 11],
        html: `<div style="display:inline-flex;align-items:center;gap:3px;background:${bg};color:#292D26;border:1.5px solid ${border};border-radius:8px;padding:2px 6px;font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;white-space:nowrap;${ring}">
          <span style="width:6px;height:6px;border-radius:9999px;background:#292D26;display:inline-block;"></span>
          <span>${escapeHtml(stop.code)}</span>
          ${stop.accessible ? '<span title="Acessível" style="font-size:9px;opacity:0.8">♿</span>' : ''}
        </div>`,
      });

      const marker = L.marker([stop.lat, stop.lng], {
        icon,
        zIndexOffset: isSelected ? 700 : 100,
      });

      marker.bindPopup(
        `<div style="min-width:175px;font-family:'Plus Jakarta Sans',sans-serif;">
          <div style="font-weight:700;font-size:13px;color:#292D26;">${escapeHtml(stop.code)} · ${escapeHtml(stop.name)}</div>
          <div style="font-size:11px;color:#74766C;margin-top:2px;">${escapeHtml(stop.address)}</div>
          <div style="font-size:11px;color:#292D26;margin-top:4px;">${stop.accessible ? 'Ponto acessível' : 'Acessibilidade parcial'} · ${stop.shelter ? 'Com abrigo' : 'Sem abrigo'}</div>
        </div>`
      );

      marker.on('click', () => {
        onSelectStopRef.current?.(stop);
      });

      marker.addTo(layer);
    }
  }, [stops, selectedStopId]);

  // Render & smoothly animate moving buses
  useEffect(() => {
    const layer = busesLayerRef.current;
    if (!layer) return;

    const validBuses = buses.filter((b) => b.lat != null && b.lng != null);
    const activeIds = new Set(validBuses.map((b) => b.id));

    // Remove buses no longer rendered
    for (const [id, marker] of busMarkersRef.current.entries()) {
      if (!activeIds.has(id)) {
        layer.removeLayer(marker);
        busMarkersRef.current.delete(id);
      }
    }

    for (const bus of validBuses) {
      const isSelected = selectedBusId === bus.id;
      const lineColor = bus.activeLineId ? lineColorMap.get(bus.activeLineId) : undefined;

      const bgColor = bus.offRoute
        ? '#D9534F'
        : bus.speedExcess
          ? '#E99A36'
          : bus.status === 'em_operacao'
            ? lineColor || '#E8C547'
            : '#74766C';

      const textColor =
        bus.offRoute || bus.status !== 'em_operacao' || bgColor === '#7C3AED' || bgColor === '#2563EB' || bgColor === '#DC2626' || bgColor === '#059669' || bgColor === '#0D9488'
          ? '#FFFFFF'
          : '#292D26';

      const selRing = isSelected
        ? 'box-shadow:0 0 0 3px #A8D929,0 4px 12px rgba(41,45,38,0.28);transform:scale(1.12);'
        : 'box-shadow:0 3px 10px rgba(41,45,38,0.24);';

      const icon = L.divIcon({
        className: 'transit-bus-marker',
        iconSize: [68, 26],
        iconAnchor: [34, 13],
        html: `<div style="display:inline-flex;align-items:center;gap:4px;background:${bgColor};color:${textColor};border:2px solid #292D26;border-radius:10px;padding:2px 7px;font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;white-space:nowrap;${selRing}">
          <span>${bus.offRoute ? '!' : '🚌'}</span>
          <span>${escapeHtml(bus.activeLineCode || bus.unitNumber)}</span>
          <span style="font-size:9px;opacity:0.9">#${escapeHtml(bus.unitNumber)}</span>
        </div>`,
      });

      const popupHtml = `<div style="min-width:190px;font-family:'Plus Jakarta Sans',sans-serif;">
        <div style="font-weight:700;font-size:13px;color:#292D26;">Veículo #${escapeHtml(bus.unitNumber)} · Linha ${escapeHtml(bus.activeLineCode || 'Garagem')}</div>
        <div style="font-size:11px;color:#74766C;margin-top:2px;">${escapeHtml(bus.activeDriverName || 'Sem motorista escalado')}</div>
        <div style="font-size:11px;color:#292D26;margin-top:4px;font-family:'JetBrains Mono',monospace;">
          ${Math.round(bus.speedKmh ?? 0)} km/h · ${bus.offRoute ? `Fora da rota (${bus.deviationMeters ?? 0}m)` : 'No itinerário'}
        </div>
        <div style="font-size:11px;color:#74766C;margin-top:2px;">${bus.accessible ? 'Veículo acessível (PCD)' : 'Veículo convencional'}</div>
      </div>`;

      const existing = busMarkersRef.current.get(bus.id);
      if (existing) {
        existing.setLatLng([bus.lat!, bus.lng!]);
        existing.setIcon(icon);
        existing.setZIndexOffset(isSelected ? 1000 : 500);
        existing.setPopupContent(popupHtml);
      } else {
        const marker = L.marker([bus.lat!, bus.lng!], {
          icon,
          zIndexOffset: isSelected ? 1000 : 500,
        });
        marker.bindPopup(popupHtml);
        marker.on('click', () => {
          onSelectBusRef.current?.(bus);
        });
        marker.addTo(layer);
        busMarkersRef.current.set(bus.id, marker);
      }
    }
  }, [buses, selectedBusId, lineColorMap]);

  // Render user location, editable vertices, and playback point
  useEffect(() => {
    const layer = overlayLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    if (userLocation) {
      const userIcon = L.divIcon({
        className: 'transit-user-marker',
        iconSize: [28, 28],
        iconAnchor: [14, 14],
        html: `<div style="width:28px;height:28px;border-radius:9999px;background:rgba(168,217,41,0.35);display:flex;align-items:center;justify-content:center;">
          <div style="width:14px;height:14px;border-radius:9999px;background:#292D26;border:2.5px solid #A8D929;box-shadow:0 2px 6px rgba(0,0,0,0.25);"></div>
        </div>`,
      });
      L.marker([userLocation.lat, userLocation.lng], { icon: userIcon, zIndexOffset: 900 })
        .bindPopup('<div style="font-size:12px;font-weight:700;">Sua localização simulada</div>')
        .addTo(layer);
    }

    editableVertices.forEach((pt, idx) => {
      const vtxIcon = L.divIcon({
        className: 'transit-vertex-marker',
        iconSize: [24, 24],
        iconAnchor: [12, 12],
        html: `<div style="width:24px;height:24px;border-radius:9999px;background:#A8D929;border:2px solid #292D26;color:#292D26;font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;">${idx + 1}</div>`,
      });
      L.marker([pt.lat, pt.lng], { icon: vtxIcon, zIndexOffset: 750 }).addTo(layer);
    });

    if (playbackPoint) {
      const pbIcon = L.divIcon({
        className: 'transit-playback-marker',
        iconSize: [30, 30],
        iconAnchor: [15, 15],
        html: `<div style="width:30px;height:30px;border-radius:9999px;background:#E8C547;border:2.5px solid #292D26;color:#292D26;display:flex;align-items:center;justify-content:center;font-size:13px;box-shadow:0 4px 10px rgba(0,0,0,0.25);">🚌</div>`,
      });
      L.marker([playbackPoint.lat, playbackPoint.lng], { icon: pbIcon, zIndexOffset: 950 }).addTo(
        layer
      );
    }
  }, [userLocation, editableVertices, playbackPoint]);

  const handleZoomIn = () => {
    mapRef.current?.zoomIn();
  };

  const handleZoomOut = () => {
    mapRef.current?.zoomOut();
  };

  const handleRecenter = () => {
    const target = userLocation ?? center ?? RIO_DEFAULT_CENTER;
    mapRef.current?.setView([target.lat, target.lng], 13, { animate: true });
  };

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-[#292D26]/12 bg-[#EAE1CF] ${className}`}
    >
      <div ref={containerRef} className="h-full w-full z-0" />

      {/* Clean Custom Map Controls */}
      <div className="absolute right-3 top-3 z-[400] flex flex-col gap-1.5">
        <button
          type="button"
          onClick={handleZoomIn}
          aria-label="Aproximar mapa"
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#292D26]/15 bg-[#FFFDF8]/95 text-[#292D26] shadow-sm hover:bg-[#E8C547] transition-colors cursor-pointer"
        >
          <Plus className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={handleZoomOut}
          aria-label="Afastar mapa"
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#292D26]/15 bg-[#FFFDF8]/95 text-[#292D26] shadow-sm hover:bg-[#E8C547] transition-colors cursor-pointer"
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={handleRecenter}
          aria-label="Centralizar mapa"
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#292D26]/15 bg-[#FFFDF8]/95 text-[#292D26] shadow-sm hover:bg-[#A8D929] transition-colors cursor-pointer"
        >
          <LocateFixed className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};
