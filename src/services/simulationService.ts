import type {
  Bus,
  Incident,
  LatLng,
  LineStopLink,
  StopEvent,
  SystemConfig,
  TelemetryPoint,
  TransitLine,
  Trip,
} from '../shared/types.ts';
import {
  calculateBearingDegrees,
  distanceToPolylineMeters,
  haversineMeters,
  nearestPointIndexOnPolyline,
} from './transitGeo.ts';

export interface BusRouteCursor {
  targetIdx: number;
  direction: 1 | -1;
}

export interface SimulationTickInput {
  buses: Bus[];
  lines: TransitLine[];
  lineStops: LineStopLink[];
  trips: Trip[];
  incidents: Incident[];
  stopEvents: StopEvent[];
  telemetryHistory: TelemetryPoint[];
  config: SystemConfig;
  cursors: Record<number, BusRouteCursor>;
  lastVisitedStopByBus: Record<number, number>;
  tickCount: number;
}

export interface SimulationTickOutput {
  buses: Bus[];
  trips: Trip[];
  incidents: Incident[];
  stopEvents: StopEvent[];
  telemetryHistory: TelemetryPoint[];
  newAlerts: Incident[];
}

export function stepFleetSimulation(input: SimulationTickInput): SimulationTickOutput {
  const {
    buses,
    lines,
    lineStops,
    trips,
    incidents,
    stopEvents,
    telemetryHistory,
    config,
    cursors,
    lastVisitedStopByBus,
    tickCount,
  } = input;

  if (!config.telemetryStreamEnabled) {
    return {
      buses,
      trips,
      incidents,
      stopEvents,
      telemetryHistory,
      newAlerts: [],
    };
  }

  const nowIso = new Date().toISOString();
  const lineMap = new Map<number, TransitLine>();
  for (const l of lines) lineMap.set(l.id, l);

  let nextTelemetryId =
    telemetryHistory.length > 0 ? telemetryHistory[telemetryHistory.length - 1].id + 1 : 1;
  let nextStopEventId = stopEvents.length > 0 ? stopEvents[0].id + 1 : 1;
  let nextIncidentId = incidents.length > 0 ? Math.max(...incidents.map((i) => i.id)) + 1 : 1;

  const updatedTrips = trips.map((t) => ({ ...t }));
  const addedStopEvents: StopEvent[] = [];
  const addedHistory: TelemetryPoint[] = [];
  const addedIncidents: Incident[] = [];

  const updatedBuses = buses.map((bus) => {
    if (bus.status !== 'em_operacao' || !bus.activeLineId) {
      return bus;
    }

    const line = lineMap.get(bus.activeLineId);
    if (!line || line.polyline.length < 2) return bus;

    // Initialize cursor if needed
    if (!cursors[bus.id]) {
      const nearestIdx =
        bus.lat != null && bus.lng != null
          ? nearestPointIndexOnPolyline({ lat: bus.lat, lng: bus.lng }, line.polyline)
          : 0;
      const dir: 1 | -1 = bus.activeDirection === 'volta' ? -1 : 1;
      const nextIdx = Math.max(0, Math.min(line.polyline.length - 1, nearestIdx + dir));
      cursors[bus.id] = { targetIdx: nextIdx, direction: dir };
    }

    const cursor = cursors[bus.id];
    const currentPos: LatLng =
      bus.lat != null && bus.lng != null
        ? { lat: bus.lat, lng: bus.lng }
        : line.polyline[0];

    let targetPt = line.polyline[cursor.targetIdx];
    const distToTarget = haversineMeters(currentPos, targetPt);

    // Advance vertex if close to current target
    if (distToTarget < 120) {
      let nextIdx = cursor.targetIdx + cursor.direction;
      if (nextIdx >= line.polyline.length) {
        cursor.direction = -1;
        nextIdx = Math.max(0, line.polyline.length - 2);
      } else if (nextIdx < 0) {
        cursor.direction = 1;
        nextIdx = Math.min(line.polyline.length - 1, 1);
      }
      cursor.targetIdx = nextIdx;
      targetPt = line.polyline[cursor.targetIdx];
    }

    // Move smoothly along segment (~110m-160m per tick, or gradually recover if off-route)
    const stepFraction = bus.offRoute ? 0.25 : Math.min(0.42, 135 / Math.max(135, distToTarget));
    const newLat = Number((currentPos.lat + (targetPt.lat - currentPos.lat) * stepFraction).toFixed(6));
    const newLng = Number((currentPos.lng + (targetPt.lng - currentPos.lng) * stepFraction).toFixed(6));
    const newPos: LatLng = { lat: newLat, lng: newLng };

    const movedMeters = haversineMeters(currentPos, newPos);
    const deltaKm = movedMeters > 3 && movedMeters < 3000 ? Number((movedMeters / 1000).toFixed(3)) : 0;

    // Realistic urban speed modulation in Rio corridors
    const wave = Math.sin((tickCount + bus.id * 1.7) * 0.65);
    const baseSpeed = bus.id === 2 ? 22 : bus.id === 6 ? 38 : 32;
    const speedKmh = Number(Math.max(12, Math.min(64, baseSpeed + wave * 11)).toFixed(1));
    const heading = Math.round(calculateBearingDegrees(currentPos, newPos));

    const deviationMeters = Math.round(distanceToPolylineMeters(newPos, line.polyline));
    const offRoute = deviationMeters > config.routeDeviationMeters;
    const speedExcess = speedKmh > config.speedLimitUrbanKmh;

    // Update trip mileage & stop completion
    const tripIdx = updatedTrips.findIndex((t) => t.id === bus.activeTripId);
    if (tripIdx >= 0) {
      updatedTrips[tripIdx].distanceKm = Number(
        (updatedTrips[tripIdx].distanceKm + deltaKm).toFixed(2)
      );
      updatedTrips[tripIdx].direction = cursor.direction === 1 ? 'ida' : 'volta';
    }

    // Log stop event when passing within 110m of a stop on this line
    const stopsForLine = lineStops.filter((ls) => ls.lineId === line.id && ls.direction === 'ida');
    for (const ls of stopsForLine) {
      if (!ls.stop) continue;
      const dStop = haversineMeters(newPos, { lat: ls.stop.lat, lng: ls.stop.lng });
      if (dStop <= 110 && lastVisitedStopByBus[bus.id] !== ls.stop.id) {
        lastVisitedStopByBus[bus.id] = ls.stop.id;
        addedStopEvents.push({
          id: nextStopEventId++,
          tripId: bus.activeTripId ?? 0,
          busId: bus.id,
          stopId: ls.stop.id,
          stopName: ls.stop.name,
          scheduledTime: nowIso,
          arrivalTime: nowIso,
          departureTime: nowIso,
          dwellSeconds: 22 + ((bus.id * 7 + tickCount) % 24),
          status: 'realizada',
        });
        if (tripIdx >= 0) {
          updatedTrips[tripIdx].stopsCompleted = Math.min(
            updatedTrips[tripIdx].stopsPlanned,
            updatedTrips[tripIdx].stopsCompleted + 1
          );
        }
        break;
      }
    }

    // Record telemetry history point
    addedHistory.push({
      id: nextTelemetryId++,
      busId: bus.id,
      tripId: bus.activeTripId ?? null,
      lat: newLat,
      lng: newLng,
      speedKmh,
      heading,
      offRoute,
      deviationMeters,
      speedExcess,
      recordedAt: nowIso,
    });

    // Generate incident if speed excess occurred and none open recently
    if (speedExcess) {
      const hasRecentSpeed = incidents.some(
        (inc) =>
          inc.busId === bus.id &&
          inc.type === 'excesso_velocidade' &&
          inc.status !== 'resolvida'
      );
      if (!hasRecentSpeed) {
        addedIncidents.push({
          id: nextIncidentId++,
          type: 'excesso_velocidade',
          severity: 'atencao',
          busId: bus.id,
          lineId: line.id,
          driverId: null,
          tripId: bus.activeTripId ?? null,
          lat: newLat,
          lng: newLng,
          title: `Excesso de velocidade — Veículo #${bus.unitNumber} (${Math.round(speedKmh)} km/h)`,
          description: `Velocidade registrada acima do limite urbano configurado (${config.speedLimitUrbanKmh} km/h).`,
          status: 'aberta',
          reportedByUserId: null,
          createdAt: nowIso,
          resolvedAt: null,
        });
      }
    }

    return {
      ...bus,
      lat: newLat,
      lng: newLng,
      speedKmh,
      heading,
      offRoute,
      deviationMeters,
      speedExcess,
      lastTelemetryAt: nowIso,
      gpsAvailable: true,
      currentKm: Number((bus.currentKm + deltaKm).toFixed(2)),
      activeDirection: (cursor.direction === 1 ? 'ida' : 'volta') as 'ida' | 'volta',
    };
  });

  const mergedHistory = [...telemetryHistory, ...addedHistory].slice(-600);
  const mergedStopEvents = [...addedStopEvents, ...stopEvents].slice(0, 120);
  const mergedIncidents = [...addedIncidents, ...incidents].slice(0, 120);

  return {
    buses: updatedBuses,
    trips: updatedTrips,
    incidents: mergedIncidents,
    stopEvents: mergedStopEvents,
    telemetryHistory: mergedHistory,
    newAlerts: addedIncidents,
  };
}
