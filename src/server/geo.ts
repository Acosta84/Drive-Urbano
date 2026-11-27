import type {
  LatLng,
  LineStopLink,
  PlannedTripLeg,
  PlannedTripOption,
  Stop,
  TransitLine,
} from '../shared/types.ts';

const EARTH_RADIUS_M = 6371000;

export function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function calculateBearingDegrees(from: LatLng, to: LatLng): number {
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);
  const dLng = toRadians(to.lng - from.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  const brng = (Math.atan2(y, x) * 180) / Math.PI;
  return (brng + 360) % 360;
}

/**
 * Projects a lat/lng point onto an equirectangular local plane around `refLat`
 * to compute exact perpendicular distance in meters to segment AB.
 */
export function pointToSegmentDistanceMeters(p: LatLng, a: LatLng, b: LatLng): number {
  const latScale = 111320;
  const lngScale = 111320 * Math.cos(toRadians((a.lat + b.lat) / 2));

  const px = (p.lng - a.lng) * lngScale;
  const py = (p.lat - a.lat) * latScale;
  const bx = (b.lng - a.lng) * lngScale;
  const by = (b.lat - a.lat) * latScale;

  const lenSq = bx * bx + by * by;
  if (lenSq === 0) {
    return Math.hypot(px, py);
  }
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / lenSq));
  const projX = t * bx;
  const projY = t * by;
  return Math.hypot(px - projX, py - projY);
}

export function distanceToPolylineMeters(point: LatLng, polyline: LatLng[]): number {
  if (polyline.length === 0) return 0;
  if (polyline.length === 1) return haversineMeters(point, polyline[0]);

  let minDist = Infinity;
  for (let i = 0; i < polyline.length - 1; i++) {
    const d = pointToSegmentDistanceMeters(point, polyline[i], polyline[i + 1]);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

export function polylineLengthKm(polyline: LatLng[]): number {
  let meters = 0;
  for (let i = 0; i < polyline.length - 1; i++) {
    meters += haversineMeters(polyline[i], polyline[i + 1]);
  }
  return Number((meters / 1000).toFixed(2));
}

export function nearestPointIndexOnPolyline(point: LatLng, polyline: LatLng[]): number {
  if (polyline.length === 0) return 0;
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < polyline.length; i++) {
    const d = haversineMeters(point, polyline[i]);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

export function distanceAlongPolylineMeters(
  fromPoint: LatLng,
  toPoint: LatLng,
  polyline: LatLng[]
): number {
  if (polyline.length < 2) return haversineMeters(fromPoint, toPoint);
  const fromIdx = nearestPointIndexOnPolyline(fromPoint, polyline);
  const toIdx = nearestPointIndexOnPolyline(toPoint, polyline);
  if (toIdx >= fromIdx) {
    let dist = 0;
    for (let i = fromIdx; i < toIdx; i++) {
      dist += haversineMeters(polyline[i], polyline[i + 1]);
    }
    return Math.max(dist, haversineMeters(fromPoint, toPoint));
  }
  // If bus already passed stop on loop, wrap around
  let dist = 0;
  for (let i = fromIdx; i < polyline.length - 1; i++) {
    dist += haversineMeters(polyline[i], polyline[i + 1]);
  }
  for (let i = 0; i < toIdx; i++) {
    dist += haversineMeters(polyline[i], polyline[i + 1]);
  }
  return dist;
}

export function estimateArrivalMinutes(params: {
  busPos: LatLng | null;
  speedKmh: number | null;
  stopPos: LatLng;
  polyline: LatLng[];
  gpsAgeSeconds: number | null;
  staleSeconds: number;
  busStatus: string;
}): { available: boolean; etaMinutes: number | null; distanceMeters: number | null; reason?: string } {
  const { busPos, speedKmh, stopPos, polyline, gpsAgeSeconds, staleSeconds, busStatus } = params;

  if (busStatus !== 'em_operacao') {
    return {
      available: false,
      etaMinutes: null,
      distanceMeters: null,
      reason: 'Veículo fora de operação no momento',
    };
  }
  if (!busPos || gpsAgeSeconds === null || gpsAgeSeconds > staleSeconds) {
    return {
      available: false,
      etaMinutes: null,
      distanceMeters: null,
      reason: 'Previsão indisponível — sem transmissão GPS recente',
    };
  }

  const distMeters = Math.round(distanceAlongPolylineMeters(busPos, stopPos, polyline));
  const effectiveSpeedKmh = speedKmh !== null && speedKmh >= 8 ? speedKmh : 22; // urban operational speed floor when stopped at light/stop
  const rawMinutes = (distMeters / 1000 / effectiveSpeedKmh) * 60;
  const etaMinutes = Math.max(1, Math.round(rawMinutes));

  return {
    available: true,
    etaMinutes,
    distanceMeters: distMeters,
  };
}

export function slicePolylineBetweenStops(
  polyline: LatLng[],
  fromStop: LatLng,
  toStop: LatLng
): LatLng[] {
  if (polyline.length < 2) return [fromStop, toStop];
  const i1 = nearestPointIndexOnPolyline(fromStop, polyline);
  const i2 = nearestPointIndexOnPolyline(toStop, polyline);
  if (i1 <= i2) {
    return [fromStop, ...polyline.slice(i1, i2 + 1), toStop];
  }
  return [fromStop, ...polyline.slice(i2, i1 + 1).reverse(), toStop];
}

export function planTransitTrips(params: {
  origin: LatLng;
  originLabel: string;
  destination: LatLng;
  destinationLabel: string;
  lines: TransitLine[];
  stops: Stop[];
  lineStops: LineStopLink[];
  accessibleOnly: boolean;
}): PlannedTripOption[] {
  const { origin, originLabel, destination, destinationLabel, lines, stops, lineStops, accessibleOnly } =
    params;

  const stopMap = new Map<number, Stop>();
  for (const s of stops) {
    stopMap.set(s.id, s);
  }

  const candidateLines = lines.filter((l) => l.active && (!accessibleOnly || l.accessible));
  const options: PlannedTripOption[] = [];

  const WALK_SPEED_MPM = 75; // ~4.5 km/h

  // 1. Direct single-line options
  for (const line of candidateLines) {
    const links = lineStops
      .filter((ls) => ls.lineId === line.id)
      .sort((a, b) => a.sequence - b.sequence);

    const eligibleStops = links
      .map((ls) => ({ link: ls, stop: stopMap.get(ls.stopId) }))
      .filter((item): item is { link: LineStopLink; stop: Stop } => {
        if (!item.stop) return false;
        if (accessibleOnly && !item.stop.accessible) return false;
        return true;
      });

    if (eligibleStops.length < 2) continue;

    let bestBoard = eligibleStops[0];
    let bestBoardDist = Infinity;
    for (const item of eligibleStops) {
      const d = haversineMeters(origin, { lat: item.stop.lat, lng: item.stop.lng });
      if (d < bestBoardDist) {
        bestBoardDist = d;
        bestBoard = item;
      }
    }

    let bestAlight = eligibleStops[eligibleStops.length - 1];
    let bestAlightDist = Infinity;
    for (const item of eligibleStops) {
      const d = haversineMeters(destination, { lat: item.stop.lat, lng: item.stop.lng });
      if (d < bestAlightDist) {
        bestAlightDist = d;
        bestAlight = item;
      }
    }

    if (bestBoard.stop.id === bestAlight.stop.id) continue;
    if (bestBoardDist > 2500 || bestAlightDist > 2500) continue;

    const walk1Min = Math.max(1, Math.round(bestBoardDist / WALK_SPEED_MPM));
    const walk2Min = Math.max(1, Math.round(bestAlightDist / WALK_SPEED_MPM));
    const busSegment = slicePolylineBetweenStops(
      line.polyline,
      { lat: bestBoard.stop.lat, lng: bestBoard.stop.lng },
      { lat: bestAlight.stop.lat, lng: bestAlight.stop.lng }
    );
    const busDistM = Math.round(polylineLengthKm(busSegment) * 1000);
    const busMin = Math.max(3, Math.round((busDistM / 1000 / 24) * 60));
    const stopsCount = Math.abs(bestAlight.link.sequence - bestBoard.link.sequence);

    const legs: PlannedTripLeg[] = [
      {
        type: 'walk',
        fromName: originLabel,
        toName: bestBoard.stop.name,
        from: origin,
        to: { lat: bestBoard.stop.lat, lng: bestBoard.stop.lng },
        distanceMeters: Math.round(bestBoardDist),
        durationMinutes: walk1Min,
        polyline: [origin, { lat: bestBoard.stop.lat, lng: bestBoard.stop.lng }],
      },
      {
        type: 'bus',
        lineId: line.id,
        lineCode: line.code,
        lineName: line.name,
        lineColor: line.color,
        accessible: line.accessible,
        fromName: bestBoard.stop.name,
        toName: bestAlight.stop.name,
        from: { lat: bestBoard.stop.lat, lng: bestBoard.stop.lng },
        to: { lat: bestAlight.stop.lat, lng: bestAlight.stop.lng },
        distanceMeters: busDistM,
        durationMinutes: busMin,
        stopsCount: Math.max(1, stopsCount),
        scheduledDeparture: `A cada ${line.frequencyMin} min`,
        polyline: busSegment,
      },
      {
        type: 'walk',
        fromName: bestAlight.stop.name,
        toName: destinationLabel,
        from: { lat: bestAlight.stop.lat, lng: bestAlight.stop.lng },
        to: destination,
        distanceMeters: Math.round(bestAlightDist),
        durationMinutes: walk2Min,
        polyline: [{ lat: bestAlight.stop.lat, lng: bestAlight.stop.lng }, destination],
      },
    ];

    options.push({
      id: `direct-${line.id}`,
      transfers: 0,
      totalMinutes: walk1Min + busMin + walk2Min,
      walkMinutes: walk1Min + walk2Min,
      totalDistanceMeters: Math.round(bestBoardDist + busDistM + bestAlightDist),
      accessible: line.accessible && bestBoard.stop.accessible && bestAlight.stop.accessible,
      legs,
    });
  }

  // 2. Single-transfer (baldeação) options via shared stops
  for (let i = 0; i < candidateLines.length; i++) {
    for (let j = 0; j < candidateLines.length; j++) {
      if (i === j) continue;
      const lineA = candidateLines[i];
      const lineB = candidateLines[j];

      const stopsA = lineStops
        .filter((ls) => ls.lineId === lineA.id)
        .map((ls) => ({ link: ls, stop: stopMap.get(ls.stopId) }))
        .filter((x): x is { link: LineStopLink; stop: Stop } => Boolean(x.stop));
      const stopsB = lineStops
        .filter((ls) => ls.lineId === lineB.id)
        .map((ls) => ({ link: ls, stop: stopMap.get(ls.stopId) }))
        .filter((x): x is { link: LineStopLink; stop: Stop } => Boolean(x.stop));

      const sharedTransfer = stopsA.find((a) =>
        stopsB.some(
          (b) =>
            (b.stop.id === a.stop.id ||
              haversineMeters(
                { lat: a.stop.lat, lng: a.stop.lng },
                { lat: b.stop.lat, lng: b.stop.lng }
              ) < 160) &&
            (!accessibleOnly || (a.stop.accessible && b.stop.accessible))
        )
      );
      if (!sharedTransfer) continue;

      const transferStopB =
        stopsB.find(
          (b) =>
            b.stop.id === sharedTransfer.stop.id ||
            haversineMeters(
              { lat: sharedTransfer.stop.lat, lng: sharedTransfer.stop.lng },
              { lat: b.stop.lat, lng: b.stop.lng }
            ) < 160
        ) ?? sharedTransfer;

      const boardA = stopsA.reduce((best, cur) =>
        haversineMeters(origin, { lat: cur.stop.lat, lng: cur.stop.lng }) <
        haversineMeters(origin, { lat: best.stop.lat, lng: best.stop.lng })
          ? cur
          : best
      );
      const alightB = stopsB.reduce((best, cur) =>
        haversineMeters(destination, { lat: cur.stop.lat, lng: cur.stop.lng }) <
        haversineMeters(destination, { lat: best.stop.lat, lng: best.stop.lng })
          ? cur
          : best
      );

      if (
        boardA.stop.id === sharedTransfer.stop.id ||
        transferStopB.stop.id === alightB.stop.id
      ) {
        continue;
      }

      const dWalk1 = haversineMeters(origin, { lat: boardA.stop.lat, lng: boardA.stop.lng });
      const dWalk2 = haversineMeters(destination, { lat: alightB.stop.lat, lng: alightB.stop.lng });
      if (dWalk1 > 1800 || dWalk2 > 1800) continue;

      const walk1Min = Math.max(1, Math.round(dWalk1 / WALK_SPEED_MPM));
      const walk2Min = Math.max(1, Math.round(dWalk2 / WALK_SPEED_MPM));
      const segA = slicePolylineBetweenStops(
        lineA.polyline,
        { lat: boardA.stop.lat, lng: boardA.stop.lng },
        { lat: sharedTransfer.stop.lat, lng: sharedTransfer.stop.lng }
      );
      const segB = slicePolylineBetweenStops(
        lineB.polyline,
        { lat: transferStopB.stop.lat, lng: transferStopB.stop.lng },
        { lat: alightB.stop.lat, lng: alightB.stop.lng }
      );
      const distAM = Math.round(polylineLengthKm(segA) * 1000);
      const distBM = Math.round(polylineLengthKm(segB) * 1000);
      const minA = Math.max(3, Math.round((distAM / 1000 / 24) * 60));
      const minB = Math.max(3, Math.round((distBM / 1000 / 24) * 60));
      const transferWait = 5;

      options.push({
        id: `transfer-${lineA.id}-${lineB.id}`,
        transfers: 1,
        totalMinutes: walk1Min + minA + transferWait + minB + walk2Min,
        walkMinutes: walk1Min + walk2Min + 2,
        totalDistanceMeters: Math.round(dWalk1 + distAM + distBM + dWalk2),
        accessible:
          lineA.accessible &&
          lineB.accessible &&
          boardA.stop.accessible &&
          sharedTransfer.stop.accessible &&
          alightB.stop.accessible,
        legs: [
          {
            type: 'walk',
            fromName: originLabel,
            toName: boardA.stop.name,
            from: origin,
            to: { lat: boardA.stop.lat, lng: boardA.stop.lng },
            distanceMeters: Math.round(dWalk1),
            durationMinutes: walk1Min,
            polyline: [origin, { lat: boardA.stop.lat, lng: boardA.stop.lng }],
          },
          {
            type: 'bus',
            lineId: lineA.id,
            lineCode: lineA.code,
            lineName: lineA.name,
            lineColor: lineA.color,
            accessible: lineA.accessible,
            fromName: boardA.stop.name,
            toName: sharedTransfer.stop.name,
            from: { lat: boardA.stop.lat, lng: boardA.stop.lng },
            to: { lat: sharedTransfer.stop.lat, lng: sharedTransfer.stop.lng },
            distanceMeters: distAM,
            durationMinutes: minA,
            stopsCount: Math.max(1, Math.abs(sharedTransfer.link.sequence - boardA.link.sequence)),
            scheduledDeparture: `A cada ${lineA.frequencyMin} min`,
            polyline: segA,
          },
          {
            type: 'bus',
            lineId: lineB.id,
            lineCode: lineB.code,
            lineName: lineB.name,
            lineColor: lineB.color,
            accessible: lineB.accessible,
            fromName: transferStopB.stop.name,
            toName: alightB.stop.name,
            from: { lat: transferStopB.stop.lat, lng: transferStopB.stop.lng },
            to: { lat: alightB.stop.lat, lng: alightB.stop.lng },
            distanceMeters: distBM,
            durationMinutes: minB,
            stopsCount: Math.max(1, Math.abs(alightB.link.sequence - transferStopB.link.sequence)),
            scheduledDeparture: `Baldeação (~${transferWait} min)`,
            polyline: segB,
          },
          {
            type: 'walk',
            fromName: alightB.stop.name,
            toName: destinationLabel,
            from: { lat: alightB.stop.lat, lng: alightB.stop.lng },
            to: destination,
            distanceMeters: Math.round(dWalk2),
            durationMinutes: walk2Min,
            polyline: [{ lat: alightB.stop.lat, lng: alightB.stop.lng }, destination],
          },
        ],
      });
    }
  }

  return options.sort((a, b) => a.totalMinutes - b.totalMinutes).slice(0, 4);
}
