import 'dotenv/config';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { WebSocket, WebSocketServer } from 'ws';
import {
  UserRole,
  type ArrivalPrediction,
  type BusStatus,
  type DashboardMetrics,
  type LatLng,
  type UserRoleType,
} from './src/shared/types.ts';
import {
  createSession,
  hasAdminClaimed,
  hashPassword,
  logAudit,
  mapUserRow,
  optionalAuth,
  requireAuth,
  requirePermission,
  verifyPassword,
  type AuthRequest,
} from './src/server/auth.ts';
import {
  db,
  getSystemConfig,
  listAuditLogs,
  listBusesWithTelemetry,
  listComplaints,
  listDrivers,
  listFavorites,
  listIncidents,
  listLineStops,
  listLines,
  listMaintenanceLogs,
  listNotices,
  listRatings,
  listStopEvents,
  listStops,
  listTelemetryHistory,
  listTrips,
  setSystemConfig,
} from './src/server/db.ts';
import {
  calculateBearingDegrees,
  distanceToPolylineMeters,
  estimateArrivalMinutes,
  haversineMeters,
  nearestPointIndexOnPolyline,
  planTransitTrips,
  polylineLengthKm,
} from './src/server/geo.ts';

const PORT = 3000;
const app = express();
app.use(express.json({ limit: '2mb' }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

function broadcastWs(event: string, payload: unknown): void {
  const data = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

wss.on('connection', (ws) => {
  ws.send(
    JSON.stringify({
      event: 'connected',
      payload: { buses: listBusesWithTelemetry(), notices: listNotices(true) },
      timestamp: new Date().toISOString(),
    })
  );
});

// Track previous stop proximity to avoid duplicate stop_events
const lastBusStopVisited: Record<number, number> = {};

interface IngestTelemetryInput {
  busId?: number;
  trackerDeviceId?: string;
  lat: number;
  lng: number;
  speedKmh: number;
  heading?: number;
  tripId?: number | null;
  recordedAt?: string;
}

function ingestTelemetryPacket(input: IngestTelemetryInput) {
  const cfg = getSystemConfig();
  const busRow = input.busId
    ? (db.prepare('SELECT * FROM buses WHERE id = ?').get(input.busId) as Record<string, unknown> | undefined)
    : (db
        .prepare('SELECT * FROM buses WHERE tracker_device_id = ?')
        .get(input.trackerDeviceId ?? '') as Record<string, unknown> | undefined);

  if (!busRow) {
    throw new Error('Veículo ou dispositivo rastreador não encontrado.');
  }

  const busId = Number(busRow.id);
  const recordedAt = input.recordedAt ?? new Date().toISOString();

  // Active trip lookup
  const tripRow = (input.tripId
    ? db.prepare('SELECT * FROM trips WHERE id = ?').get(input.tripId)
    : db
        .prepare(
          "SELECT * FROM trips WHERE bus_id = ? AND status IN ('em_andamento', 'atrasada') ORDER BY id DESC LIMIT 1"
        )
        .get(busId)) as Record<string, unknown> | undefined;

  const tripId = tripRow ? Number(tripRow.id) : null;
  const lineId = tripRow ? Number(tripRow.line_id) : null;

  let deviationMeters = 0;
  let offRoute = false;

  if (lineId) {
    const lineRow = db.prepare('SELECT polyline_json FROM lines WHERE id = ?').get(lineId) as
      | { polyline_json: string }
      | undefined;
    if (lineRow) {
      try {
        const polyline: LatLng[] = JSON.parse(lineRow.polyline_json);
        if (polyline.length >= 2) {
          deviationMeters = Math.round(
            distanceToPolylineMeters({ lat: input.lat, lng: input.lng }, polyline)
          );
          offRoute = deviationMeters > cfg.routeDeviationMeters;
        }
      } catch {
        // ignore invalid polyline JSON
      }
    }
  }

  const speedExcess = input.speedKmh > cfg.speedLimitUrbanKmh;

  // Incremental mileage from previous telemetry point
  const prevRow = db
    .prepare('SELECT lat, lng FROM gps_telemetry WHERE bus_id = ? ORDER BY recorded_at DESC, id DESC LIMIT 1')
    .get(busId) as { lat: number; lng: number } | undefined;

  let deltaKm = 0;
  if (prevRow) {
    const meters = haversineMeters(
      { lat: prevRow.lat, lng: prevRow.lng },
      { lat: input.lat, lng: input.lng }
    );
    if (meters > 5 && meters < 5000) {
      deltaKm = Number((meters / 1000).toFixed(3));
      db.prepare('UPDATE buses SET current_km = ROUND(current_km + ?, 3) WHERE id = ?').run(
        deltaKm,
        busId
      );
      if (tripId) {
        db.prepare('UPDATE trips SET distance_km = ROUND(distance_km + ?, 3) WHERE id = ?').run(
          deltaKm,
          tripId
        );
      }
    }
  }

  const heading =
    input.heading ??
    (prevRow
      ? Math.round(
          calculateBearingDegrees(
            { lat: prevRow.lat, lng: prevRow.lng },
            { lat: input.lat, lng: input.lng }
          )
        )
      : 0);

  db.prepare(
    `INSERT INTO gps_telemetry (bus_id, trip_id, lat, lng, speed_kmh, heading, off_route, deviation_meters, speed_excess, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    busId,
    tripId,
    input.lat,
    input.lng,
    Number(input.speedKmh.toFixed(1)),
    heading,
    offRoute ? 1 : 0,
    deviationMeters,
    speedExcess ? 1 : 0,
    recordedAt
  );

  // Automatic incident generation (throttled to avoid spamming open identical incidents)
  if (offRoute) {
    const existingOpen = db
      .prepare(
        "SELECT id FROM incidents WHERE bus_id = ? AND type = 'desvio_rota' AND status != 'resolvida' LIMIT 1"
      )
      .get(busId) as { id: number } | undefined;
    if (!existingOpen) {
      const info = db
        .prepare(
          `INSERT INTO incidents (type, severity, bus_id, line_id, trip_id, lat, lng, title, description, status, created_at)
           VALUES ('desvio_rota', 'critica', ?, ?, ?, ?, ?, ?, ?, 'aberta', ?)`
        )
        .run(
          busId,
          lineId,
          tripId,
          input.lat,
          input.lng,
          `Veículo #${busRow.unit_number} fora da rota (${deviationMeters}m)`,
          `Desvio geográfico detectado a ${deviationMeters}m do itinerário programado (tolerância: ${cfg.routeDeviationMeters}m).`,
          recordedAt
        );
      broadcastWs('alert:created', {
        id: Number(info.lastInsertRowid),
        type: 'desvio_rota',
        severity: 'critica',
        busId,
        lineId,
        title: `Veículo #${busRow.unit_number} fora da rota (${deviationMeters}m)`,
      });
    }
  }

  if (speedExcess) {
    const existingSpeed = db
      .prepare(
        "SELECT id FROM incidents WHERE bus_id = ? AND type = 'excesso_velocidade' AND status != 'resolvida' AND created_at > ? LIMIT 1"
      )
      .get(busId, new Date(Date.now() - 120000).toISOString()) as { id: number } | undefined;
    if (!existingSpeed) {
      const info = db
        .prepare(
          `INSERT INTO incidents (type, severity, bus_id, line_id, trip_id, lat, lng, title, description, status, created_at)
           VALUES ('excesso_velocidade', 'atencao', ?, ?, ?, ?, ?, ?, ?, 'aberta', ?)`
        )
        .run(
          busId,
          lineId,
          tripId,
          input.lat,
          input.lng,
          `Excesso de velocidade — Veículo #${busRow.unit_number} (${Math.round(input.speedKmh)} km/h)`,
          `Velocidade registrada acima do limite operacional configurado (${cfg.speedLimitUrbanKmh} km/h).`,
          recordedAt
        );
      broadcastWs('alert:created', {
        id: Number(info.lastInsertRowid),
        type: 'excesso_velocidade',
        severity: 'atencao',
        busId,
        lineId,
        title: `Excesso de velocidade — Veículo #${busRow.unit_number}`,
      });
    }
  }

  // Automatic stop arrival logging if within 95m of a stop on the active line
  if (tripId && lineId) {
    const links = listLineStops(lineId);
    for (const ls of links) {
      if (!ls.stop) continue;
      const d = haversineMeters({ lat: input.lat, lng: input.lng }, { lat: ls.stop.lat, lng: ls.stop.lng });
      if (d <= 95 && lastBusStopVisited[busId] !== ls.stop.id) {
        lastBusStopVisited[busId] = ls.stop.id;
        db.prepare(
          `INSERT INTO stop_events (trip_id, bus_id, stop_id, stop_name, scheduled_time, arrival_time, departure_time, dwell_seconds, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'realizada')`
        ).run(tripId, busId, ls.stop.id, ls.stop.name, recordedAt, recordedAt, recordedAt, 28);
        db.prepare('UPDATE trips SET stops_completed = MIN(stops_planned, stops_completed + 1) WHERE id = ?').run(
          tripId
        );
        break;
      }
    }
  }

  const buses = listBusesWithTelemetry();
  const updatedBus = buses.find((b) => b.id === busId);
  broadcastWs('telemetry:update', { bus: updatedBus });
  return updatedBus;
}

// Background GPS tracker simulation stream for active vehicles 1..5 when enabled
// Note: Bus #5009 (id 6) is intentionally left without live GPS unless manually sent via /api/gps/ingest
// to keep real "Previsão indisponível" operational behavior verifiable.
const busRouteProgress: Record<number, { idx: number; dir: 1 | -1 }> = {
  1: { idx: 2, dir: 1 },
  2: { idx: 4, dir: -1 },
  3: { idx: 3, dir: 1 },
  4: { idx: 2, dir: -1 },
  5: { idx: 3, dir: 1 },
};

setInterval(() => {
  try {
    const cfg = getSystemConfig();
    if (!cfg.telemetryStreamEnabled) return;

    const buses = listBusesWithTelemetry();
    const lines = listLines(false);
    const lineMap = new Map<number, (typeof lines)[number]>();
    for (const l of lines) lineMap.set(l.id, l);

    for (const bus of buses) {
      // Only stream buses 1..5 that are em_operacao and have an active line
      if (bus.id === 6) continue;
      if (bus.status !== 'em_operacao' || !bus.activeLineId) continue;
      const line = lineMap.get(bus.activeLineId);
      if (!line || line.polyline.length < 2) continue;

      if (!busRouteProgress[bus.id]) {
        const curIdx =
          bus.lat != null && bus.lng != null
            ? nearestPointIndexOnPolyline({ lat: bus.lat, lng: bus.lng }, line.polyline)
            : 0;
        busRouteProgress[bus.id] = { idx: curIdx, dir: 1 };
      }

      const prog = busRouteProgress[bus.id];
      const nextIdx = prog.idx + prog.dir;
      if (nextIdx >= line.polyline.length) {
        prog.dir = -1;
        prog.idx = Math.max(0, line.polyline.length - 2);
      } else if (nextIdx < 0) {
        prog.dir = 1;
        prog.idx = Math.min(line.polyline.length - 1, 1);
      } else {
        prog.idx = nextIdx;
      }

      const targetPt = line.polyline[prog.idx];
      const curLat = bus.lat ?? targetPt.lat;
      const curLng = bus.lng ?? targetPt.lng;
      // Interpolate 38% toward next vertex for smooth street movement
      const newLat = curLat + (targetPt.lat - curLat) * 0.38;
      const newLng = curLng + (targetPt.lng - curLng) * 0.38;
      const speedKmh = 24 + ((bus.id * 7 + Date.now() / 1000) % 18);

      ingestTelemetryPacket({
        busId: bus.id,
        lat: Number(newLat.toFixed(6)),
        lng: Number(newLng.toFixed(6)),
        speedKmh: Number(speedKmh.toFixed(1)),
        tripId: bus.activeTripId ?? null,
      });
    }
  } catch (err) {
    console.error('GPS telemetry tick error:', err);
  }
}, 4500);

// ----------------- AUTH & RBAC ROUTES -----------------

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

app.get('/api/auth/bootstrap-status', (_req, res) => {
  res.json({
    adminClaimed: hasAdminClaimed(),
    passcodeConfigured: Boolean(process.env.ADMIN_PASSCODE && process.env.ADMIN_PASSCODE.trim().length > 0),
  });
});

app.post('/api/auth/bootstrap-admin', (req, res) => {
  try {
    const { name, email, password } = req.body ?? {};
    if (!name || !email || !password || String(password).length < 6) {
      res.status(400).json({ error: 'Informe nome, e-mail e senha com pelo menos 6 caracteres.' });
      return;
    }
    if (hasAdminClaimed()) {
      res.status(409).json({ error: 'Conta de administrador geral já foi configurada.' });
      return;
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const passwordHash = hashPassword(String(password));
    const now = new Date().toISOString();

    const info = db
      .prepare(
        `INSERT INTO users (name, email, password_hash, role, active, created_at)
         VALUES (?, ?, ?, 'admin_geral', 1, ?)`
      )
      .run(String(name).trim(), cleanEmail, passwordHash, now);

    const userRow = db
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(Number(info.lastInsertRowid)) as Record<string, unknown>;
    const user = mapUserRow(userRow);
    const token = createSession(user.id);
    logAudit(user, 'BOOTSTRAP_ADMIN', 'user', user.id, `Administrador geral inicial configurado (${cleanEmail}).`);
    res.status(201).json({ token, user });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao configurar administrador.';
    res.status(400).json({ error: message });
  }
});

app.post('/api/auth/register', (req, res) => {
  try {
    const { name, email, password, accessibilityNeeds } = req.body ?? {};
    if (!name || !email || !password || String(password).length < 6) {
      res.status(400).json({ error: 'Nome, e-mail e senha (mínimo 6 caracteres) são obrigatórios.' });
      return;
    }
    const cleanEmail = String(email).trim().toLowerCase();
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
    if (existing) {
      res.status(409).json({ error: 'Já existe uma conta cadastrada com este e-mail.' });
      return;
    }

    const passwordHash = hashPassword(String(password));
    const now = new Date().toISOString();
    const info = db
      .prepare(
        `INSERT INTO users (name, email, password_hash, role, active, accessibility_needs, created_at)
         VALUES (?, ?, ?, 'passageiro', 1, ?, ?)`
      )
      .run(String(name).trim(), cleanEmail, passwordHash, accessibilityNeeds ? 1 : 0, now);

    const userRow = db
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(Number(info.lastInsertRowid)) as Record<string, unknown>;
    const user = mapUserRow(userRow);
    const token = createSession(user.id);
    res.status(201).json({ token, user });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao cadastrar usuário.';
    res.status(400).json({ error: message });
  }
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    res.status(400).json({ error: 'E-mail e senha são obrigatórios.' });
    return;
  }
  const cleanEmail = String(email).trim().toLowerCase();
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail) as
    | Record<string, unknown>
    | undefined;

  const envPasscode = process.env.ADMIN_PASSCODE?.trim();
  if (envPasscode && password === envPasscode) {
    if (row && String(row.role) === UserRole.ADMIN_GERAL && Boolean(row.active)) {
      const user = mapUserRow(row);
      const token = createSession(user.id);
      res.json({ token, user });
      return;
    }
    if (!row && !hasAdminClaimed()) {
      const info = db
        .prepare(
          `INSERT INTO users (name, email, password_hash, role, active, created_at)
           VALUES ('Administrador Geral', ?, ?, 'admin_geral', 1, ?)`
        )
        .run(cleanEmail, hashPassword(envPasscode), new Date().toISOString());
      const newRow = db
        .prepare('SELECT * FROM users WHERE id = ?')
        .get(Number(info.lastInsertRowid)) as Record<string, unknown>;
      const user = mapUserRow(newRow);
      const token = createSession(user.id);
      res.json({ token, user });
      return;
    }
  }

  if (!row || !Boolean(row.active)) {
    res.status(401).json({ error: 'Credenciais inválidas ou conta inativa.' });
    return;
  }

  if (!verifyPassword(String(password), String(row.password_hash))) {
    res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    return;
  }

  const user = mapUserRow(row);
  const token = createSession(user.id);
  res.json({ token, user });
});

app.post('/api/auth/logout', requireAuth, (req: AuthRequest, res) => {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(header.slice(7).trim());
  }
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req: AuthRequest, res) => {
  res.json({ user: req.user });
});

app.patch('/api/auth/me/preferences', requireAuth, (req: AuthRequest, res) => {
  const { accessibilityNeeds, notificationPrefs, name } = req.body ?? {};
  const userId = req.user!.id;
  if (typeof accessibilityNeeds === 'boolean') {
    db.prepare('UPDATE users SET accessibility_needs = ? WHERE id = ?').run(
      accessibilityNeeds ? 1 : 0,
      userId
    );
  }
  if (notificationPrefs && typeof notificationPrefs === 'object') {
    db.prepare('UPDATE users SET notification_prefs_json = ? WHERE id = ?').run(
      JSON.stringify(notificationPrefs),
      userId
    );
  }
  if (typeof name === 'string' && name.trim().length >= 2) {
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name.trim(), userId);
  }
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as Record<string, unknown>;
  res.json({ user: mapUserRow(row) });
});

// ----------------- PASSENGER & PUBLIC TRANSIT API (SAME SOURCE OF TRUTH) -----------------

app.get('/api/overview', (_req, res) => {
  const lines = listLines(true);
  const stops = listStops();
  const buses = listBusesWithTelemetry();
  const notices = listNotices(true);
  const config = getSystemConfig();
  const ratings = listRatings();

  const avgRating =
    ratings.length > 0
      ? Number((ratings.reduce((acc, r) => acc + r.overall, 0) / ratings.length).toFixed(1))
      : 0;

  res.json({
    lines,
    stops,
    buses,
    notices,
    config,
    ratingsCount: ratings.length,
    averageRating: avgRating,
  });
});

app.get('/api/stops/nearby', (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const radiusMeters = Number(req.query.radiusMeters ?? 1500);
  const accessibleOnly = req.query.accessibleOnly === 'true';

  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    res.status(400).json({ error: 'Coordenadas lat e lng inválidas.' });
    return;
  }

  const allStops = listStops().filter((s) => !accessibleOnly || s.accessible);
  const allLineStops = listLineStops();
  const lines = listLines(false);
  const lineMap = new Map<number, (typeof lines)[number]>();
  for (const l of lines) lineMap.set(l.id, l);

  const nearby = allStops
    .map((stop) => {
      const distanceMeters = Math.round(haversineMeters({ lat, lng }, { lat: stop.lat, lng: stop.lng }));
      const servingLines = allLineStops
        .filter((ls) => ls.stopId === stop.id)
        .map((ls) => lineMap.get(ls.lineId))
        .filter((l): l is NonNullable<typeof l> => Boolean(l));
      const uniqueLines = Array.from(new Map(servingLines.map((l) => [l.id, l])).values());
      return {
        ...stop,
        distanceMeters,
        walkMinutes: Math.max(1, Math.round(distanceMeters / 75)),
        lines: uniqueLines,
      };
    })
    .filter((s) => s.distanceMeters <= radiusMeters)
    .sort((a, b) => a.distanceMeters - b.distanceMeters);

  res.json({ stops: nearby });
});

app.get('/api/stops/:id/arrivals', (req, res) => {
  const stopId = Number(req.params.id);
  const stops = listStops();
  const stop = stops.find((s) => s.id === stopId);
  if (!stop) {
    res.status(404).json({ error: 'Ponto de ônibus não encontrado.' });
    return;
  }

  const cfg = getSystemConfig();
  const allLines = listLines(false);
  const lineMap = new Map<number, (typeof allLines)[number]>();
  for (const l of allLines) lineMap.set(l.id, l);

  const lineStopIds = Array.from(
    new Set(listLineStops().filter((ls) => ls.stopId === stopId).map((ls) => ls.lineId))
  );
  const buses = listBusesWithTelemetry();
  const nowMs = Date.now();

  const predictions: ArrivalPrediction[] = [];

  for (const lineId of lineStopIds) {
    const line = lineMap.get(lineId);
    if (!line) continue;

    const lineBuses = buses.filter((b) => b.activeLineId === lineId);
    if (lineBuses.length === 0) {
      predictions.push({
        busId: 0,
        unitNumber: '—',
        lineId: line.id,
        lineCode: line.code,
        lineName: line.name,
        lineColor: line.color,
        direction: line.destination,
        accessible: line.accessible,
        available: false,
        arrivalStatus: 'indisponivel',
        unavailableReason: 'Previsão indisponível — nenhum veículo ativo nesta linha no momento',
        etaMinutes: null,
        estimatedArrivalIso: null,
        distanceMeters: null,
        speedKmh: null,
        vehicleStatus: 'sem_veiculo',
        offRoute: false,
      });
      continue;
    }

    for (const bus of lineBuses) {
      const gpsAgeSeconds = bus.lastTelemetryAt
        ? (nowMs - new Date(bus.lastTelemetryAt).getTime()) / 1000
        : null;

      const est = estimateArrivalMinutes({
        busPos: bus.lat != null && bus.lng != null ? { lat: bus.lat, lng: bus.lng } : null,
        speedKmh: bus.speedKmh ?? null,
        stopPos: { lat: stop.lat, lng: stop.lng },
        polyline: line.polyline,
        gpsAgeSeconds,
        staleSeconds: cfg.gpsStaleSeconds,
        busStatus: bus.status,
      });

      predictions.push({
        busId: bus.id,
        unitNumber: bus.unitNumber,
        lineId: line.id,
        lineCode: line.code,
        lineName: line.name,
        lineColor: line.color,
        direction: bus.activeDirection === 'volta' ? line.origin : line.destination,
        accessible: bus.accessible,
        available: est.available,
        arrivalStatus: !est.available
          ? 'indisponivel'
          : (est.etaMinutes ?? 99) <= 4
            ? 'chegando'
            : 'no_horario',
        unavailableReason: est.reason,
        etaMinutes: est.etaMinutes,
        estimatedArrivalIso:
          est.etaMinutes !== null ? new Date(nowMs + est.etaMinutes * 60000).toISOString() : null,
        distanceMeters: est.distanceMeters,
        speedKmh: bus.speedKmh ?? null,
        vehicleStatus: bus.status,
        offRoute: Boolean(bus.offRoute),
      });
    }
  }

  predictions.sort((a, b) => {
    if (a.available && !b.available) return -1;
    if (!a.available && b.available) return 1;
    return (a.etaMinutes ?? 999) - (b.etaMinutes ?? 999);
  });

  res.json({ stop, predictions });
});

app.post('/api/trips/plan', (req, res) => {
  const { origin, originLabel, destination, destinationLabel, accessibleOnly } = req.body ?? {};
  if (
    !origin ||
    typeof origin.lat !== 'number' ||
    typeof origin.lng !== 'number' ||
    !destination ||
    typeof destination.lat !== 'number' ||
    typeof destination.lng !== 'number'
  ) {
    res.status(400).json({ error: 'Origem e destino com coordenadas válidas são obrigatórios.' });
    return;
  }

  const options = planTransitTrips({
    origin,
    originLabel: String(originLabel || 'Origem selecionada'),
    destination,
    destinationLabel: String(destinationLabel || 'Destino selecionado'),
    lines: listLines(false),
    stops: listStops(),
    lineStops: listLineStops(),
    accessibleOnly: Boolean(accessibleOnly),
  });

  res.json({ options });
});

app.get('/api/notices', (req, res) => {
  const all = req.query.all === '1';
  res.json({ notices: listNotices(!all) });
});

app.get('/api/favorites', requireAuth, (req: AuthRequest, res) => {
  res.json({ favorites: listFavorites(req.user!.id) });
});

app.post('/api/favorites', requireAuth, (req: AuthRequest, res) => {
  const { targetType, targetId, label, meta } = req.body ?? {};
  if (!targetType || !targetId || !label) {
    res.status(400).json({ error: 'targetType, targetId e label são obrigatórios.' });
    return;
  }
  const existing = db
    .prepare('SELECT id FROM favorites WHERE user_id = ? AND target_type = ? AND target_id = ?')
    .get(req.user!.id, String(targetType), String(targetId));
  if (existing) {
    res.json({ favorites: listFavorites(req.user!.id) });
    return;
  }
  db.prepare(
    `INSERT INTO favorites (user_id, target_type, target_id, label, meta_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    req.user!.id,
    String(targetType),
    String(targetId),
    String(label),
    JSON.stringify(meta ?? {}),
    new Date().toISOString()
  );
  res.status(201).json({ favorites: listFavorites(req.user!.id) });
});

app.delete('/api/favorites/:id', requireAuth, (req: AuthRequest, res) => {
  db.prepare('DELETE FROM favorites WHERE id = ? AND user_id = ?').run(
    Number(req.params.id),
    req.user!.id
  );
  res.json({ favorites: listFavorites(req.user!.id) });
});

app.get('/api/complaints', optionalAuth, (req: AuthRequest, res) => {
  if (req.user && req.user.role !== UserRole.PASSAGEIRO) {
    res.json({ complaints: listComplaints() });
    return;
  }
  if (req.user) {
    res.json({ complaints: listComplaints(req.user.id) });
    return;
  }
  res.json({ complaints: [] });
});

app.get('/api/complaints/track/:protocol', (req, res) => {
  const row = db
    .prepare('SELECT * FROM complaints WHERE UPPER(protocol) = UPPER(?)')
    .get(String(req.params.protocol).trim()) as Record<string, unknown> | undefined;
  if (!row) {
    res.status(404).json({ error: 'Protocolo não encontrado.' });
    return;
  }
  res.json({
    complaint: {
      id: Number(row.id),
      protocol: String(row.protocol),
      lineId: row.line_id ? Number(row.line_id) : null,
      busId: row.bus_id ? Number(row.bus_id) : null,
      driverName: row.driver_name ? String(row.driver_name) : null,
      occurredAt: String(row.occurred_at),
      category: String(row.category),
      description: String(row.description),
      attachmentName: row.attachment_name ? String(row.attachment_name) : null,
      status: String(row.status),
      resolutionNote: row.resolution_note ? String(row.resolution_note) : null,
      createdAt: String(row.created_at),
    },
  });
});

app.post('/api/complaints', optionalAuth, (req: AuthRequest, res) => {
  const { lineId, busId, driverName, occurredAt, category, description, attachmentName } = req.body ?? {};
  if (!category || !description || String(description).trim().length < 5) {
    res.status(400).json({ error: 'Informe o tipo de ocorrência e a descrição detalhada.' });
    return;
  }
  const seq = Math.floor(1000 + Math.random() * 8999);
  const protocol = `URB-${new Date().getFullYear()}-${seq}`;
  const now = new Date().toISOString();

  const info = db
    .prepare(
      `INSERT INTO complaints (protocol, user_id, line_id, bus_id, driver_name, occurred_at, category, description, attachment_name, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'recebida', ?)`
    )
    .run(
      protocol,
      req.user?.id ?? null,
      lineId ? Number(lineId) : null,
      busId ? Number(busId) : null,
      driverName ? String(driverName) : null,
      occurredAt ? String(occurredAt) : now,
      String(category),
      String(description).trim(),
      attachmentName ? String(attachmentName) : null,
      now
    );

  broadcastWs('complaint:created', { protocol, category });
  res.status(201).json({
    id: Number(info.lastInsertRowid),
    protocol,
    status: 'recebida',
    createdAt: now,
  });
});

app.get('/api/ratings', (_req, res) => {
  const ratings = listRatings();
  const count = ratings.length;
  const avg = (fn: (r: (typeof ratings)[number]) => number) =>
    count > 0 ? Number((ratings.reduce((a, r) => a + fn(r), 0) / count).toFixed(2)) : 0;

  res.json({
    ratings,
    summary: {
      count,
      overall: avg((r) => r.overall),
      serviceQuality: avg((r) => r.serviceQuality),
      punctuality: avg((r) => r.punctuality),
      vehicleCondition: avg((r) => r.vehicleCondition),
      cleanliness: avg((r) => r.cleanliness),
      comfort: avg((r) => r.comfort),
    },
  });
});

app.post('/api/ratings', optionalAuth, (req: AuthRequest, res) => {
  const {
    lineId,
    busId,
    serviceQuality,
    punctuality,
    vehicleCondition,
    cleanliness,
    comfort,
    overall,
    comment,
  } = req.body ?? {};
  if (!lineId) {
    res.status(400).json({ error: 'Selecione a linha avaliada.' });
    return;
  }
  const clamp = (v: unknown) => Math.max(1, Math.min(5, Math.round(Number(v) || 5)));
  const sq = clamp(serviceQuality);
  const pu = clamp(punctuality);
  const vc = clamp(vehicleCondition);
  const cl = clamp(cleanliness);
  const co = clamp(comfort);
  const ov = overall ? clamp(overall) : Math.round((sq + pu + vc + cl + co) / 5);

  const info = db
    .prepare(
      `INSERT INTO ratings (user_id, line_id, bus_id, service_quality, punctuality, vehicle_condition, cleanliness, comfort, overall, comment, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.user?.id ?? null,
      Number(lineId),
      busId ? Number(busId) : null,
      sq,
      pu,
      vc,
      cl,
      co,
      ov,
      String(comment ?? '').trim(),
      new Date().toISOString()
    );

  res.status(201).json({ id: Number(info.lastInsertRowid), overall: ov });
});

// ----------------- GPS INGEST & TELEMETRY -----------------

app.post('/api/gps/ingest', requireAuth, requirePermission('gps:ingest'), (req: AuthRequest, res) => {
  try {
    const { busId, trackerDeviceId, lat, lng, speedKmh, heading, tripId } = req.body ?? {};
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      res.status(400).json({ error: 'Coordenadas lat e lng numéricas são obrigatórias.' });
      return;
    }
    const updatedBus = ingestTelemetryPacket({
      busId: busId ? Number(busId) : undefined,
      trackerDeviceId: trackerDeviceId ? String(trackerDeviceId) : undefined,
      lat,
      lng,
      speedKmh: Number(speedKmh ?? 0),
      heading: heading !== undefined ? Number(heading) : undefined,
      tripId: tripId ? Number(tripId) : null,
    });
    logAudit(
      req.user,
      'GPS_INGEST',
      'bus',
      updatedBus?.id ?? busId ?? '',
      `Pacote GPS recebido (${lat.toFixed(5)}, ${lng.toFixed(5)}, ${Math.round(Number(speedKmh ?? 0))} km/h).`
    );
    res.json({ bus: updatedBus });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Erro ao processar telemetria.' });
  }
});

app.get(
  '/api/telemetry/history/:busId',
  requireAuth,
  requirePermission('monitoring:view'),
  (req, res) => {
    const busId = Number(req.params.busId);
    const limit = Math.min(500, Math.max(10, Number(req.query.limit ?? 120)));
    res.json({ history: listTelemetryHistory(busId, limit) });
  }
);

// ----------------- ADMIN OPERATIONAL ROUTES -----------------

app.get('/api/admin/dashboard', requireAuth, requirePermission('dashboard:view'), (_req, res) => {
  const buses = listBusesWithTelemetry();
  const drivers = listDrivers();
  const trips = listTrips();
  const incidents = listIncidents();
  const lines = listLines(false);
  const ratings = listRatings();

  const totalBuses = buses.length;
  const busesInOperation = buses.filter((b) => b.status === 'em_operacao').length;
  const busesStopped = buses.filter(
    (b) => b.status === 'disponivel' || b.status === 'retirado' || b.status === 'inativo'
  ).length;
  const busesMaintenance = buses.filter(
    (b) => b.status === 'em_manutencao' || b.status === 'quebrado'
  ).length;
  const activeDrivers = drivers.filter((d) => d.status !== 'inativo').length;
  const tripsInProgress = trips.filter(
    (t) => t.status === 'em_andamento' || t.status === 'atrasada'
  ).length;
  const tripsCompleted = trips.filter((t) => t.status === 'concluida').length;
  const tripsDelayed = trips.filter(
    (t) => t.status === 'atrasada' || t.delayMinutes > getSystemConfig().delayToleranceMinutes
  ).length;
  const vehiclesOffRoute = buses.filter((b) => b.offRoute && b.status === 'em_operacao').length;
  const openIncidents = incidents.filter((i) => i.status !== 'resolvida').length;
  const totalMileageKm = Number(
    trips.reduce((sum, t) => sum + t.distanceKm, 0).toFixed(1)
  );
  const evaluatedTrips = trips.filter((t) => t.status !== 'programada' && t.status !== 'cancelada');
  const onTimeTrips = evaluatedTrips.filter(
    (t) => t.delayMinutes <= getSystemConfig().delayToleranceMinutes
  ).length;
  const punctualityRate =
    evaluatedTrips.length > 0 ? Math.round((onTimeTrips / evaluatedTrips.length) * 100) : 100;
  const averageRating =
    ratings.length > 0
      ? Number((ratings.reduce((acc, r) => acc + r.overall, 0) / ratings.length).toFixed(1))
      : 0;

  const lineMileage = lines.map((l) => {
    const lineTrips = trips.filter((t) => t.lineId === l.id);
    const actualKm = Number(lineTrips.reduce((s, t) => s + t.distanceKm, 0).toFixed(1));
    const plannedKm = Number((Math.max(1, lineTrips.length) * l.scheduledKm).toFixed(1));
    return { code: l.code, plannedKm, actualKm };
  });

  // Hourly punctuality buckets derived from trips
  const buckets: Record<string, { onTime: number; delayed: number }> = {};
  for (const t of trips) {
    const d = new Date(t.scheduledDeparture);
    const hour = `${String(d.getHours()).padStart(2, '0')}h`;
    if (!buckets[hour]) buckets[hour] = { onTime: 0, delayed: 0 };
    if (t.delayMinutes > getSystemConfig().delayToleranceMinutes || t.status === 'atrasada') {
      buckets[hour].delayed += 1;
    } else {
      buckets[hour].onTime += 1;
    }
  }
  const hourlyPunctuality = Object.entries(buckets)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([hour, v]) => ({ hour, ...v }));

  const metrics: DashboardMetrics = {
    totalBuses,
    busesInOperation,
    busesStopped,
    busesMaintenance,
    activeDrivers,
    tripsInProgress,
    tripsCompleted,
    tripsDelayed,
    vehiclesOffRoute,
    openIncidents,
    totalMileageKm,
    punctualityRate,
    averageRating,
    hourlyPunctuality,
    lineMileage,
  };

  res.json({ metrics });
});

// Fleet CRUD
app.get('/api/admin/buses', requireAuth, requirePermission('monitoring:view'), (_req, res) => {
  res.json({ buses: listBusesWithTelemetry() });
});

app.post('/api/admin/buses', requireAuth, requirePermission('fleet:manage'), (req: AuthRequest, res) => {
  try {
    const {
      unitNumber,
      plate,
      model,
      manufacturer,
      year,
      capacity,
      accessible,
      currentKm,
      status,
      trackerDeviceId,
    } = req.body ?? {};
    if (!unitNumber || !plate || !model || !manufacturer) {
      res.status(400).json({ error: 'Número de identificação, placa, modelo e fabricante são obrigatórios.' });
      return;
    }
    const info = db
      .prepare(
        `INSERT INTO buses (unit_number, plate, model, manufacturer, year, capacity, accessible, current_km, status, tracker_device_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        String(unitNumber).trim(),
        String(plate).trim().toUpperCase(),
        String(model).trim(),
        String(manufacturer).trim(),
        Number(year ?? new Date().getFullYear()),
        Number(capacity ?? 80),
        accessible !== false ? 1 : 0,
        Number(currentKm ?? 0),
        String(status ?? 'disponivel'),
        String(trackerDeviceId || `GPS-TRK-${unitNumber}`),
        new Date().toISOString()
      );
    logAudit(req.user, 'CREATE_BUS', 'bus', Number(info.lastInsertRowid), `Ônibus #${unitNumber} (${plate}) cadastrado.`);
    res.status(201).json({ buses: listBusesWithTelemetry() });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Erro ao cadastrar veículo.' });
  }
});

app.patch('/api/admin/buses/:id', requireAuth, requirePermission('fleet:manage'), (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const { status, accessible, capacity, model, manufacturer, currentKm, trackerDeviceId } = req.body ?? {};
  const existing = db.prepare('SELECT * FROM buses WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Veículo não encontrado.' });
    return;
  }
  db.prepare(
    `UPDATE buses SET
      status = COALESCE(?, status),
      accessible = COALESCE(?, accessible),
      capacity = COALESCE(?, capacity),
      model = COALESCE(?, model),
      manufacturer = COALESCE(?, manufacturer),
      current_km = COALESCE(?, current_km),
      tracker_device_id = COALESCE(?, tracker_device_id)
     WHERE id = ?`
  ).run(
    status ?? null,
    typeof accessible === 'boolean' ? (accessible ? 1 : 0) : null,
    capacity !== undefined ? Number(capacity) : null,
    model ?? null,
    manufacturer ?? null,
    currentKm !== undefined ? Number(currentKm) : null,
    trackerDeviceId ?? null,
    id
  );
  logAudit(req.user, 'UPDATE_BUS', 'bus', id, `Veículo #${existing.unit_number} atualizado (status: ${status ?? existing.status}).`);
  const buses = listBusesWithTelemetry();
  broadcastWs('fleet:updated', { buses });
  res.json({ buses });
});

// Drivers CRUD
app.get('/api/admin/drivers', requireAuth, requirePermission('monitoring:view'), (_req, res) => {
  res.json({ drivers: listDrivers() });
});

app.post('/api/admin/drivers', requireAuth, requirePermission('drivers:manage'), (req: AuthRequest, res) => {
  const { name, cpfMasked, licenseNumber, phone, assignedBusId, assignedLineId } = req.body ?? {};
  if (!name || !licenseNumber) {
    res.status(400).json({ error: 'Nome e número da CNH são obrigatórios.' });
    return;
  }
  const info = db
    .prepare(
      `INSERT INTO drivers (name, cpf_masked, license_number, phone, status, assigned_bus_id, assigned_line_id, created_at)
       VALUES (?, ?, ?, ?, 'ativo', ?, ?, ?)`
    )
    .run(
      String(name).trim(),
      String(cpfMasked || '***.000.000-**'),
      String(licenseNumber).trim(),
      String(phone || ''),
      assignedBusId ? Number(assignedBusId) : null,
      assignedLineId ? Number(assignedLineId) : null,
      new Date().toISOString()
    );
  logAudit(req.user, 'CREATE_DRIVER', 'driver', Number(info.lastInsertRowid), `Motorista ${name} cadastrado.`);
  res.status(201).json({ drivers: listDrivers() });
});

app.patch('/api/admin/drivers/:id', requireAuth, requirePermission('drivers:manage'), (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const { name, phone, licenseNumber, status, assignedBusId, assignedLineId } = req.body ?? {};
  db.prepare(
    `UPDATE drivers SET
      name = COALESCE(?, name),
      phone = COALESCE(?, phone),
      license_number = COALESCE(?, license_number),
      status = COALESCE(?, status),
      assigned_bus_id = ?,
      assigned_line_id = ?
     WHERE id = ?`
  ).run(
    name ?? null,
    phone ?? null,
    licenseNumber ?? null,
    status ?? null,
    assignedBusId !== undefined ? (assignedBusId ? Number(assignedBusId) : null) : null,
    assignedLineId !== undefined ? (assignedLineId ? Number(assignedLineId) : null) : null,
    id
  );
  logAudit(req.user, 'UPDATE_DRIVER', 'driver', id, `Motorista #${id} atualizado.`);
  res.json({ drivers: listDrivers() });
});

// Lines & Stops CRUD + Map Itinerary Editing
app.post('/api/admin/stops', requireAuth, requirePermission('lines:manage'), (req: AuthRequest, res) => {
  try {
    const { code, name, address, lat, lng, accessible, shelter } = req.body ?? {};
    if (!code || !name || typeof lat !== 'number' || typeof lng !== 'number') {
      res.status(400).json({ error: 'Código, nome e coordenadas lat/lng do ponto são obrigatórios.' });
      return;
    }
    const info = db
      .prepare(
        `INSERT INTO stops (code, name, address, lat, lng, accessible, shelter, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        String(code).trim().toUpperCase(),
        String(name).trim(),
        String(address || 'Logradouro urbano'),
        lat,
        lng,
        accessible !== false ? 1 : 0,
        shelter !== false ? 1 : 0,
        new Date().toISOString()
      );
    logAudit(req.user, 'CREATE_STOP', 'stop', Number(info.lastInsertRowid), `Ponto ${code} - ${name} cadastrado.`);
    res.status(201).json({ stops: listStops() });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Erro ao cadastrar ponto.' });
  }
});

app.post('/api/admin/lines', requireAuth, requirePermission('lines:manage'), (req: AuthRequest, res) => {
  try {
    const {
      code,
      name,
      origin,
      destination,
      description,
      operatingHours,
      operatingDays,
      frequencyMin,
      accessible,
      color,
      polyline,
      stopIds,
    } = req.body ?? {};
    if (!code || !name || !origin || !destination) {
      res.status(400).json({ error: 'Código, nome, origem e destino da linha são obrigatórios.' });
      return;
    }
    const poly: LatLng[] = Array.isArray(polyline) ? polyline : [];
    const km = poly.length >= 2 ? polylineLengthKm(poly) : 5.0;

    const info = db
      .prepare(
        `INSERT INTO lines (code, name, origin, destination, description, operating_hours, operating_days, frequency_min, accessible, color, scheduled_km, polyline_json, active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
      )
      .run(
        String(code).trim().toUpperCase(),
        String(name).trim(),
        String(origin).trim(),
        String(destination).trim(),
        String(description ?? ''),
        String(operatingHours || '05:00 - 23:30'),
        String(operatingDays || 'Todos os dias'),
        Number(frequencyMin ?? 15),
        accessible !== false ? 1 : 0,
        String(color || '#D97706'),
        km,
        JSON.stringify(poly),
        new Date().toISOString()
      );

    const lineId = Number(info.lastInsertRowid);
    if (Array.isArray(stopIds)) {
      const insertLink = db.prepare(
        "INSERT INTO line_stops (line_id, stop_id, sequence, direction, scheduled_offset_min) VALUES (?, ?, ?, 'ida', ?)"
      );
      stopIds.forEach((sid: number, idx: number) => {
        insertLink.run(lineId, Number(sid), idx + 1, idx * 4);
      });
    }

    logAudit(req.user, 'CREATE_LINE', 'line', lineId, `Linha ${code} - ${name} criada.`);
    res.status(201).json({ lines: listLines(true) });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Erro ao criar linha.' });
  }
});

app.patch('/api/admin/lines/:id', requireAuth, requirePermission('lines:manage'), (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const {
    name,
    origin,
    destination,
    description,
    operatingHours,
    operatingDays,
    frequencyMin,
    accessible,
    color,
    polyline,
    stopIds,
    active,
  } = req.body ?? {};

  const existing = db.prepare('SELECT * FROM lines WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Linha não encontrada.' });
    return;
  }

  let nextPolyJson: string | null = null;
  let nextKm: number | null = null;
  if (Array.isArray(polyline)) {
    nextPolyJson = JSON.stringify(polyline);
    nextKm = polyline.length >= 2 ? polylineLengthKm(polyline) : Number(existing.scheduled_km);
  }

  db.prepare(
    `UPDATE lines SET
      name = COALESCE(?, name),
      origin = COALESCE(?, origin),
      destination = COALESCE(?, destination),
      description = COALESCE(?, description),
      operating_hours = COALESCE(?, operating_hours),
      operating_days = COALESCE(?, operating_days),
      frequency_min = COALESCE(?, frequency_min),
      accessible = COALESCE(?, accessible),
      color = COALESCE(?, color),
      polyline_json = COALESCE(?, polyline_json),
      scheduled_km = COALESCE(?, scheduled_km),
      active = COALESCE(?, active)
     WHERE id = ?`
  ).run(
    name ?? null,
    origin ?? null,
    destination ?? null,
    description ?? null,
    operatingHours ?? null,
    operatingDays ?? null,
    frequencyMin !== undefined ? Number(frequencyMin) : null,
    typeof accessible === 'boolean' ? (accessible ? 1 : 0) : null,
    color ?? null,
    nextPolyJson,
    nextKm,
    typeof active === 'boolean' ? (active ? 1 : 0) : null,
    id
  );

  if (Array.isArray(stopIds)) {
    db.prepare('DELETE FROM line_stops WHERE line_id = ?').run(id);
    const insertLink = db.prepare(
      "INSERT INTO line_stops (line_id, stop_id, sequence, direction, scheduled_offset_min) VALUES (?, ?, ?, 'ida', ?)"
    );
    stopIds.forEach((sid: number, idx: number) => {
      insertLink.run(id, Number(sid), idx + 1, idx * 4);
    });
  }

  logAudit(req.user, 'UPDATE_LINE', 'line', id, `Linha ${existing.code} e/ou itinerário atualizados.`);
  const lines = listLines(true);
  broadcastWs('lines:updated', { lines });
  res.json({ lines });
});

// Trips & Departure/Arrival Control & Delay Management
app.get('/api/admin/trips', requireAuth, requirePermission('monitoring:view'), (_req, res) => {
  res.json({ trips: listTrips() });
});

app.post('/api/admin/trips', requireAuth, requirePermission('trips:manage'), (req: AuthRequest, res) => {
  const { lineId, busId, driverId, direction, scheduledDeparture, scheduledArrival } = req.body ?? {};
  if (!lineId || !busId || !driverId) {
    res.status(400).json({ error: 'Linha, veículo e motorista são obrigatórios.' });
    return;
  }
  const now = new Date();
  const schedDep = scheduledDeparture ?? now.toISOString();
  const schedArr = scheduledArrival ?? new Date(now.getTime() + 32 * 60000).toISOString();
  const stopsPlanned = listLineStops(Number(lineId)).length || 4;

  const info = db
    .prepare(
      `INSERT INTO trips (line_id, bus_id, driver_id, direction, scheduled_departure, actual_departure, scheduled_arrival, status, delay_minutes, distance_km, stops_completed, stops_planned)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'em_andamento', 0, 0, 0, ?)`
    )
    .run(
      Number(lineId),
      Number(busId),
      Number(driverId),
      direction === 'volta' ? 'volta' : 'ida',
      schedDep,
      now.toISOString(),
      schedArr,
      stopsPlanned
    );

  db.prepare("UPDATE buses SET status = 'em_operacao' WHERE id = ?").run(Number(busId));
  db.prepare("UPDATE drivers SET status = 'em_viagem', assigned_bus_id = ?, assigned_line_id = ? WHERE id = ?").run(
    Number(busId),
    Number(lineId),
    Number(driverId)
  );

  // Seed initial GPS point at line origin if bus has none
  const line = listLines(false).find((l) => l.id === Number(lineId));
  if (line && line.polyline.length > 0) {
    ingestTelemetryPacket({
      busId: Number(busId),
      lat: line.polyline[0].lat,
      lng: line.polyline[0].lng,
      speedKmh: 24,
      tripId: Number(info.lastInsertRowid),
    });
  }

  logAudit(req.user, 'START_TRIP', 'trip', Number(info.lastInsertRowid), `Viagem iniciada na linha #${lineId} com veículo #${busId}.`);
  res.status(201).json({ trips: listTrips(), buses: listBusesWithTelemetry() });
});

app.patch('/api/admin/trips/:id', requireAuth, requirePermission('trips:manage'), (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const { status, delayMinutes, delayReason, busId, driverId } = req.body ?? {};
  const existing = db.prepare('SELECT * FROM trips WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Viagem não encontrada.' });
    return;
  }

  const nowIso = new Date().toISOString();
  const cfg = getSystemConfig();
  let computedDelay = delayMinutes !== undefined ? Number(delayMinutes) : Number(existing.delay_minutes);
  let nextStatus = status ?? String(existing.status);

  if (nextStatus === 'concluida' && !existing.actual_arrival) {
    const diffMin = Math.round(
      (Date.now() - new Date(String(existing.scheduled_arrival)).getTime()) / 60000
    );
    computedDelay = Math.max(0, diffMin);
    db.prepare('UPDATE trips SET actual_arrival = ? WHERE id = ?').run(nowIso, id);
    db.prepare("UPDATE drivers SET status = 'ativo' WHERE id = ?").run(Number(existing.driver_id));
  }

  if (computedDelay > cfg.delayToleranceMinutes && nextStatus === 'em_andamento') {
    nextStatus = 'atrasada';
  }

  db.prepare(
    `UPDATE trips SET
      status = ?,
      delay_minutes = ?,
      delay_reason = COALESCE(?, delay_reason),
      bus_id = COALESCE(?, bus_id),
      driver_id = COALESCE(?, driver_id)
     WHERE id = ?`
  ).run(
    nextStatus,
    computedDelay,
    delayReason ?? null,
    busId ? Number(busId) : null,
    driverId ? Number(driverId) : null,
    id
  );

  if (computedDelay > cfg.delayToleranceMinutes && delayReason) {
    db.prepare(
      `INSERT INTO incidents (type, severity, bus_id, line_id, driver_id, trip_id, title, description, status, reported_by_user_id, created_at)
       VALUES ('atraso', 'atencao', ?, ?, ?, ?, ?, ?, 'aberta', ?, ?)`
    ).run(
      Number(existing.bus_id),
      Number(existing.line_id),
      Number(existing.driver_id),
      id,
      `Atraso registrado (${computedDelay} min) — Viagem #${id}`,
      String(delayReason),
      req.user!.id,
      nowIso
    );
  }

  logAudit(req.user, 'UPDATE_TRIP', 'trip', id, `Viagem #${id} atualizada para ${nextStatus} (atraso: ${computedDelay} min).`);
  res.json({ trips: listTrips() });
});

// Stop Events
app.get('/api/admin/stop-events', requireAuth, requirePermission('monitoring:view'), (req, res) => {
  const tripId = req.query.tripId ? Number(req.query.tripId) : undefined;
  res.json({ stopEvents: listStopEvents(tripId) });
});

app.post('/api/admin/stop-events', requireAuth, requirePermission('trips:manage'), (req: AuthRequest, res) => {
  const { tripId, busId, stopId, stopName, dwellSeconds, status } = req.body ?? {};
  if (!tripId || !busId || !stopName) {
    res.status(400).json({ error: 'tripId, busId e stopName são obrigatórios.' });
    return;
  }
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO stop_events (trip_id, bus_id, stop_id, stop_name, scheduled_time, arrival_time, departure_time, dwell_seconds, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    Number(tripId),
    Number(busId),
    stopId ? Number(stopId) : null,
    String(stopName),
    now,
    now,
    now,
    Number(dwellSeconds ?? 30),
    String(status || 'nao_programada')
  );
  logAudit(req.user, 'LOG_STOP_EVENT', 'stop_event', tripId, `Parada "${stopName}" (${status || 'nao_programada'}) registrada.`);
  res.status(201).json({ stopEvents: listStopEvents() });
});

// Incidents
app.get('/api/admin/incidents', requireAuth, requirePermission('monitoring:view'), (_req, res) => {
  res.json({ incidents: listIncidents() });
});

app.patch('/api/admin/incidents/:id', requireAuth, requirePermission('incidents:manage'), (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const { status } = req.body ?? {};
  const resolvedAt = status === 'resolvida' ? new Date().toISOString() : null;
  db.prepare('UPDATE incidents SET status = ?, resolved_at = COALESCE(?, resolved_at) WHERE id = ?').run(
    String(status),
    resolvedAt,
    id
  );
  logAudit(req.user, 'UPDATE_INCIDENT', 'incident', id, `Ocorrência #${id} alterada para ${status}.`);
  res.json({ incidents: listIncidents() });
});

// Maintenance & Fleet Breakdown Removal (4.15)
app.get('/api/admin/maintenance', requireAuth, requirePermission('monitoring:view'), (_req, res) => {
  res.json({ maintenance: listMaintenanceLogs() });
});

app.post('/api/admin/maintenance/breakdown', requireAuth, requirePermission('maintenance:manage'), (req: AuthRequest, res) => {
  const { busId, reason, responsible, targetStatus, notes } = req.body ?? {};
  if (!busId || !reason || !responsible) {
    res.status(400).json({ error: 'Veículo, motivo e responsável são obrigatórios.' });
    return;
  }
  const bId = Number(busId);
  const nextBusStatus: BusStatus =
    targetStatus === 'em_manutencao' || targetStatus === 'retirado' ? targetStatus : 'quebrado';
  const now = new Date().toISOString();

  db.prepare('UPDATE buses SET status = ? WHERE id = ?').run(nextBusStatus, bId);

  const affectedTrips = db
    .prepare("SELECT id, line_id FROM trips WHERE bus_id = ? AND status IN ('em_andamento', 'atrasada', 'programada')")
    .all(bId) as { id: number; line_id: number }[];

  for (const t of affectedTrips) {
    db.prepare("UPDATE trips SET status = 'interrompida', delay_reason = ? WHERE id = ?").run(
      `Veículo retirado de circulação: ${reason}`,
      t.id
    );
  }

  const info = db
    .prepare(
      `INSERT INTO maintenance_logs (bus_id, reason, responsible, status, started_at, authorized_by_user_id, notes)
       VALUES (?, ?, ?, 'em_andamento', ?, ?, ?)`
    )
    .run(bId, String(reason), String(responsible), now, req.user!.id, String(notes ?? ''));

  const busRow = db.prepare('SELECT unit_number FROM buses WHERE id = ?').get(bId) as { unit_number: string };
  db.prepare(
    `INSERT INTO incidents (type, severity, bus_id, line_id, title, description, status, reported_by_user_id, created_at)
     VALUES ('falha_mecanica', 'critica', ?, ?, ?, ?, 'aberta', ?, ?)`
  ).run(
    bId,
    affectedTrips[0]?.line_id ?? null,
    `Veículo #${busRow.unit_number} retirado (${nextBusStatus})`,
    `${reason}. Viagens afetadas: ${affectedTrips.length}. Responsável: ${responsible}.`,
    req.user!.id,
    now
  );

  logAudit(
    req.user,
    'VEHICLE_BREAKDOWN',
    'bus',
    bId,
    `Veículo #${busRow.unit_number} marcado como ${nextBusStatus}. ${affectedTrips.length} viagem(ns) afetada(s).`
  );
  broadcastWs('fleet:updated', { buses: listBusesWithTelemetry() });

  res.status(201).json({
    maintenanceId: Number(info.lastInsertRowid),
    affectedTripsCount: affectedTrips.length,
    affectedLineIds: Array.from(new Set(affectedTrips.map((t) => t.line_id))),
    maintenance: listMaintenanceLogs(),
    buses: listBusesWithTelemetry(),
    trips: listTrips(),
  });
});

app.patch('/api/admin/maintenance/:id/complete', requireAuth, requirePermission('maintenance:manage'), (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const { authorizeReturnToService, notes } = req.body ?? {};
  const logRow = db.prepare('SELECT * FROM maintenance_logs WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!logRow) {
    res.status(404).json({ error: 'Registro de manutenção não encontrado.' });
    return;
  }
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE maintenance_logs SET status = 'concluida', ended_at = ?, authorized_by_user_id = ?, notes = COALESCE(?, notes) WHERE id = ?"
  ).run(now, req.user!.id, notes ?? null, id);

  if (authorizeReturnToService) {
    db.prepare("UPDATE buses SET status = 'disponivel' WHERE id = ?").run(Number(logRow.bus_id));
  }
  logAudit(
    req.user,
    'COMPLETE_MAINTENANCE',
    'maintenance',
    id,
    `Manutenção #${id} finalizada${authorizeReturnToService ? ' e veículo liberado para operação' : ''}.`
  );
  res.json({ maintenance: listMaintenanceLogs(), buses: listBusesWithTelemetry() });
});

// Notices & Complaints Management
app.post('/api/admin/notices', requireAuth, requirePermission('notices:manage'), (req: AuthRequest, res) => {
  const { title, category, message, affectedLineIds, expectedNormalization } = req.body ?? {};
  if (!title || !category || !message) {
    res.status(400).json({ error: 'Título, categoria e mensagem são obrigatórios.' });
    return;
  }
  const now = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO notices (title, category, message, affected_line_ids_json, start_time, expected_normalization, active, created_by_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
    )
    .run(
      String(title),
      String(category),
      String(message),
      JSON.stringify(Array.isArray(affectedLineIds) ? affectedLineIds : []),
      now,
      expectedNormalization || null,
      req.user!.id,
      now
    );

  logAudit(req.user, 'CREATE_NOTICE', 'notice', Number(info.lastInsertRowid), `Aviso publicado: ${title}`);
  const notices = listNotices(true);
  broadcastWs('notice:created', { notices });
  res.status(201).json({ notices: listNotices(false) });
});

app.patch('/api/admin/notices/:id', requireAuth, requirePermission('notices:manage'), (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const { active } = req.body ?? {};
  db.prepare('UPDATE notices SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
  logAudit(req.user, 'TOGGLE_NOTICE', 'notice', id, `Aviso #${id} ${active ? 'ativado' : 'arquivado'}.`);
  broadcastWs('notice:created', { notices: listNotices(true) });
  res.json({ notices: listNotices(false) });
});

app.patch('/api/admin/complaints/:id', requireAuth, requirePermission('complaints:manage'), (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const { status, resolutionNote } = req.body ?? {};
  db.prepare('UPDATE complaints SET status = COALESCE(?, status), resolution_note = COALESCE(?, resolution_note) WHERE id = ?').run(
    status ?? null,
    resolutionNote ?? null,
    id
  );
  logAudit(req.user, 'UPDATE_COMPLAINT', 'complaint', id, `Reclamação #${id} atualizada para ${status}.`);
  res.json({ complaints: listComplaints() });
});

// Users & RBAC Management
app.get('/api/admin/users', requireAuth, requirePermission('users:manage'), (_req, res) => {
  const rows = db.prepare('SELECT * FROM users ORDER BY id DESC').all() as Record<string, unknown>[];
  res.json({ users: rows.map(mapUserRow) });
});

app.post('/api/admin/users', requireAuth, requirePermission('users:manage'), (req: AuthRequest, res) => {
  try {
    const { name, email, password, role } = req.body ?? {};
    if (!name || !email || !password || !role) {
      res.status(400).json({ error: 'Nome, e-mail, senha e perfil RBAC são obrigatórios.' });
      return;
    }
    const validRoles = Object.values(UserRole) as string[];
    if (!validRoles.includes(String(role))) {
      res.status(400).json({ error: 'Perfil RBAC inválido.' });
      return;
    }
    const cleanEmail = String(email).trim().toLowerCase();
    const info = db
      .prepare(
        `INSERT INTO users (name, email, password_hash, role, active, created_at)
         VALUES (?, ?, ?, ?, 1, ?)`
      )
      .run(String(name).trim(), cleanEmail, hashPassword(String(password)), String(role), new Date().toISOString());

    logAudit(req.user, 'CREATE_USER', 'user', Number(info.lastInsertRowid), `Usuário ${cleanEmail} criado com perfil ${role}.`);
    const rows = db.prepare('SELECT * FROM users ORDER BY id DESC').all() as Record<string, unknown>[];
    res.status(201).json({ users: rows.map(mapUserRow) });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Erro ao criar usuário.' });
  }
});

app.patch('/api/admin/users/:id', requireAuth, requirePermission('users:manage'), (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const { role, active } = req.body ?? {};
  db.prepare('UPDATE users SET role = COALESCE(?, role), active = COALESCE(?, active) WHERE id = ?').run(
    role ?? null,
    typeof active === 'boolean' ? (active ? 1 : 0) : null,
    id
  );
  logAudit(req.user, 'UPDATE_USER_RBAC', 'user', id, `Permissões/status do usuário #${id} alterados.`);
  const rows = db.prepare('SELECT * FROM users ORDER BY id DESC').all() as Record<string, unknown>[];
  res.json({ users: rows.map(mapUserRow) });
});

// Config & Audit & Reports
app.get('/api/admin/config', requireAuth, requirePermission('dashboard:view'), (_req, res) => {
  res.json({ config: getSystemConfig() });
});

app.patch('/api/admin/config', requireAuth, requirePermission('config:manage'), (req: AuthRequest, res) => {
  const next = setSystemConfig(req.body ?? {});
  logAudit(req.user, 'UPDATE_CONFIG', 'system_config', 'global', `Parâmetros operacionais atualizados.`);
  res.json({ config: next });
});

app.get('/api/admin/audit', requireAuth, requirePermission('audit:view'), (_req, res) => {
  res.json({ logs: listAuditLogs() });
});

app.get('/api/admin/reports', requireAuth, requirePermission('reports:view'), (req, res) => {
  const type = String(req.query.type ?? 'geral');
  const lineId = req.query.lineId ? Number(req.query.lineId) : null;
  const busId = req.query.busId ? Number(req.query.busId) : null;

  const trips = listTrips().filter(
    (t) => (!lineId || t.lineId === lineId) && (!busId || t.busId === busId)
  );
  const incidents = listIncidents().filter(
    (i) => (!lineId || i.lineId === lineId) && (!busId || i.busId === busId)
  );
  const buses = listBusesWithTelemetry().filter((b) => !busId || b.id === busId);
  const lines = listLines(false).filter((l) => !lineId || l.id === lineId);
  const drivers = listDrivers();
  const stopEvents = listStopEvents();
  const ratings = listRatings();

  res.json({
    generatedAt: new Date().toISOString(),
    type,
    trips,
    incidents,
    buses,
    lines,
    drivers,
    stopEvents,
    ratings,
  });
});

// ----------------- VITE / STATIC HOSTING -----------------

async function startServer(): Promise<void> {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`MobiliCidade server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
