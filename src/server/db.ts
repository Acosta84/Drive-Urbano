import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  AuditLog,
  Bus,
  Complaint,
  Driver,
  FavoriteItem,
  Incident,
  LatLng,
  LineStopLink,
  MaintenanceLog,
  Notice,
  Rating,
  Stop,
  StopEvent,
  SystemConfig,
  TelemetryPoint,
  TransitLine,
  Trip,
} from '../shared/types.ts';

const dataDir = path.resolve(process.cwd(), '.data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

export const db = new DatabaseSync(path.join(dataDir, 'mobility.db'));

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'passageiro',
    active INTEGER NOT NULL DEFAULT 1,
    accessibility_needs INTEGER NOT NULL DEFAULT 0,
    notification_prefs_json TEXT NOT NULL DEFAULT '{"delays":true,"routeChanges":true,"scheduleChanges":true,"operationalIssues":true,"vehicleUnavailable":true,"favoritesOnly":false}',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS buses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    unit_number TEXT NOT NULL UNIQUE,
    plate TEXT NOT NULL UNIQUE,
    model TEXT NOT NULL,
    manufacturer TEXT NOT NULL,
    year INTEGER NOT NULL,
    capacity INTEGER NOT NULL,
    accessible INTEGER NOT NULL DEFAULT 1,
    current_km REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'disponivel',
    tracker_device_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    origin TEXT NOT NULL,
    destination TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    operating_hours TEXT NOT NULL,
    operating_days TEXT NOT NULL,
    frequency_min INTEGER NOT NULL DEFAULT 12,
    accessible INTEGER NOT NULL DEFAULT 1,
    color TEXT NOT NULL DEFAULT '#E8C547',
    scheduled_km REAL NOT NULL DEFAULT 10,
    polyline_json TEXT NOT NULL DEFAULT '[]',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS drivers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    cpf_masked TEXT NOT NULL,
    license_number TEXT NOT NULL,
    phone TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ativo',
    assigned_bus_id INTEGER REFERENCES buses(id) ON DELETE SET NULL,
    assigned_line_id INTEGER REFERENCES lines(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS stops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    accessible INTEGER NOT NULL DEFAULT 1,
    shelter INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS line_stops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    line_id INTEGER NOT NULL REFERENCES lines(id) ON DELETE CASCADE,
    stop_id INTEGER NOT NULL REFERENCES stops(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL,
    direction TEXT NOT NULL DEFAULT 'ida',
    scheduled_offset_min INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS trips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    line_id INTEGER NOT NULL REFERENCES lines(id) ON DELETE CASCADE,
    bus_id INTEGER NOT NULL REFERENCES buses(id) ON DELETE CASCADE,
    driver_id INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    direction TEXT NOT NULL DEFAULT 'ida',
    scheduled_departure TEXT NOT NULL,
    actual_departure TEXT,
    scheduled_arrival TEXT NOT NULL,
    actual_arrival TEXT,
    status TEXT NOT NULL DEFAULT 'programada',
    delay_minutes INTEGER NOT NULL DEFAULT 0,
    delay_reason TEXT,
    distance_km REAL NOT NULL DEFAULT 0,
    stops_completed INTEGER NOT NULL DEFAULT 0,
    stops_planned INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS gps_telemetry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bus_id INTEGER NOT NULL REFERENCES buses(id) ON DELETE CASCADE,
    trip_id INTEGER REFERENCES trips(id) ON DELETE SET NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    speed_kmh REAL NOT NULL DEFAULT 0,
    heading REAL NOT NULL DEFAULT 0,
    off_route INTEGER NOT NULL DEFAULT 0,
    deviation_meters REAL NOT NULL DEFAULT 0,
    speed_excess INTEGER NOT NULL DEFAULT 0,
    recorded_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS stop_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    bus_id INTEGER NOT NULL REFERENCES buses(id) ON DELETE CASCADE,
    stop_id INTEGER REFERENCES stops(id) ON DELETE SET NULL,
    stop_name TEXT NOT NULL,
    scheduled_time TEXT,
    arrival_time TEXT NOT NULL,
    departure_time TEXT,
    dwell_seconds INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'realizada'
  );

  CREATE TABLE IF NOT EXISTS incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    severity TEXT NOT NULL,
    bus_id INTEGER REFERENCES buses(id) ON DELETE SET NULL,
    line_id INTEGER REFERENCES lines(id) ON DELETE SET NULL,
    driver_id INTEGER REFERENCES drivers(id) ON DELETE SET NULL,
    trip_id INTEGER REFERENCES trips(id) ON DELETE SET NULL,
    lat REAL,
    lng REAL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'aberta',
    reported_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    resolved_at TEXT
  );

  CREATE TABLE IF NOT EXISTS maintenance_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bus_id INTEGER NOT NULL REFERENCES buses(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    responsible TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'em_andamento',
    started_at TEXT NOT NULL,
    ended_at TEXT,
    authorized_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    notes TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS notices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    message TEXT NOT NULL,
    affected_line_ids_json TEXT NOT NULL DEFAULT '[]',
    start_time TEXT NOT NULL,
    expected_normalization TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS complaints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    protocol TEXT NOT NULL UNIQUE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    line_id INTEGER REFERENCES lines(id) ON DELETE SET NULL,
    bus_id INTEGER REFERENCES buses(id) ON DELETE SET NULL,
    driver_name TEXT,
    occurred_at TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    attachment_name TEXT,
    status TEXT NOT NULL DEFAULT 'recebida',
    resolution_note TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    line_id INTEGER NOT NULL REFERENCES lines(id) ON DELETE CASCADE,
    bus_id INTEGER REFERENCES buses(id) ON DELETE SET NULL,
    service_quality INTEGER NOT NULL,
    punctuality INTEGER NOT NULL,
    vehicle_condition INTEGER NOT NULL,
    cleanliness INTEGER NOT NULL,
    comfort INTEGER NOT NULL,
    overall INTEGER NOT NULL,
    comment TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    label TEXT NOT NULL,
    meta_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS system_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    user_name TEXT NOT NULL,
    user_role TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    details TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_telemetry_bus_time ON gps_telemetry(bus_id, recorded_at DESC);
  CREATE INDEX IF NOT EXISTS idx_trips_status ON trips(status);
  CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
  CREATE INDEX IF NOT EXISTS idx_stops_lat_lng ON stops(lat, lng);
  CREATE INDEX IF NOT EXISTS idx_line_stops_line ON line_stops(line_id, sequence);
`);

function seedIfEmpty(): void {
  const countRow = db.prepare('SELECT COUNT(*) AS cnt FROM lines').get() as { cnt: number };
  if (countRow.cnt > 0) return;

  const now = new Date();
  const isoNow = now.toISOString();
  const minsAgo = (m: number) => new Date(now.getTime() - m * 60000).toISOString();
  const minsAhead = (m: number) => new Date(now.getTime() + m * 60000).toISOString();

  // Config defaults
  const defaultConfigs: [string, string][] = [
    ['delayToleranceMinutes', '5'],
    ['routeDeviationMeters', '180'],
    ['speedLimitUrbanKmh', '60'],
    ['speedLimitCorridorKmh', '70'],
    ['gpsRetentionDays', '90'],
    ['gpsStaleSeconds', '180'],
    ['telemetryStreamEnabled', '1'],
  ];
  const insertCfg = db.prepare('INSERT OR IGNORE INTO system_config (key, value) VALUES (?, ?)');
  for (const [k, v] of defaultConfigs) {
    insertCfg.run(k, v);
  }

  // Stops along central São Paulo urban grid (authentic geographic points)
  const stopsSeed = [
    { code: 'P-101', name: 'Terminal Praça da Sé', address: 'Praça da Sé, 100 - Centro', lat: -23.5505, lng: -46.6333, accessible: 1, shelter: 1 },
    { code: 'P-102', name: 'Estação Anhangabaú', address: 'Av. Prestes Maia, 240 - Centro', lat: -23.5476, lng: -46.6388, accessible: 1, shelter: 1 },
    { code: 'P-103', name: 'Rua da Consolação / Mackenzie', address: 'R. da Consolação, 930 - Consolação', lat: -23.5472, lng: -46.6512, accessible: 1, shelter: 1 },
    { code: 'P-104', name: 'Metrô Paulista / Consolação', address: 'Av. Paulista, 2100 - Bela Vista', lat: -23.5561, lng: -46.6621, accessible: 1, shelter: 1 },
    { code: 'P-105', name: 'MASP / Trianon', address: 'Av. Paulista, 1578 - Bela Vista', lat: -23.5614, lng: -46.6559, accessible: 1, shelter: 1 },
    { code: 'P-106', name: 'Av. Paulista / Brigadeiro', address: 'Av. Paulista, 735 - Bela Vista', lat: -23.5685, lng: -46.6481, accessible: 1, shelter: 1 },
    { code: 'P-107', name: 'Terminal Paraíso', address: 'R. Vergueiro, 1465 - Paraíso', lat: -23.5754, lng: -46.6408, accessible: 1, shelter: 1 },
    { code: 'P-108', name: 'Metrô Vila Mariana', address: 'Av. Prof. Noé Azevedo, 255 - Vila Mariana', lat: -23.5895, lng: -46.6347, accessible: 1, shelter: 1 },
    { code: 'P-109', name: 'Parque Ibirapuera Portão 3', address: 'Av. Pedro Álvares Cabral, s/n', lat: -23.5874, lng: -46.6576, accessible: 1, shelter: 1 },
    { code: 'P-110', name: 'Av. Brasil / Jardins', address: 'Av. Brasil, 1120 - Jardim América', lat: -23.5718, lng: -46.6688, accessible: 1, shelter: 0 },
    { code: 'P-111', name: 'Av. Rebouças / Oscar Freire', address: 'Av. Rebouças, 1850 - Pinheiros', lat: -23.5632, lng: -46.6745, accessible: 1, shelter: 1 },
    { code: 'P-112', name: 'Terminal Pinheiros', address: 'R. Capri, 145 - Pinheiros', lat: -23.5673, lng: -46.7019, accessible: 1, shelter: 1 },
    { code: 'P-113', name: 'Faria Lima / Iguatemi', address: 'Av. Brig. Faria Lima, 2232 - Jardim Paulistano', lat: -23.5764, lng: -46.6873, accessible: 1, shelter: 1 },
    { code: 'P-114', name: 'Moema / Av. Ibirapuera', address: 'Av. Ibirapuera, 2400 - Moema', lat: -23.6032, lng: -46.6624, accessible: 1, shelter: 1 },
    { code: 'P-115', name: 'Terminal Barra Funda', address: 'Av. Auro Soares de Moura Andrade, 664', lat: -23.5255, lng: -46.6675, accessible: 1, shelter: 1 },
    { code: 'P-116', name: 'Pacaembu / Av. Arnolfo Azevedo', address: 'Praça Charles Miller, s/n', lat: -23.5476, lng: -46.6652, accessible: 0, shelter: 0 },
    { code: 'P-117', name: 'Higienópolis / Angélica', address: 'Av. Angélica, 1106 - Higienópolis', lat: -23.5432, lng: -46.6578, accessible: 1, shelter: 1 },
    { code: 'P-118', name: 'Liberdade / Praça Japonesa', address: 'Av. da Liberdade, 412 - Liberdade', lat: -23.5554, lng: -46.6356, accessible: 0, shelter: 1 },
  ];

  const insertStop = db.prepare(`
    INSERT INTO stops (code, name, address, lat, lng, accessible, shelter, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const s of stopsSeed) {
    insertStop.run(s.code, s.name, s.address, s.lat, s.lng, s.accessible, s.shelter, isoNow);
  }

  // Lines with multi-point polylines matching the stop coordinates
  const linesSeed: {
    code: string;
    name: string;
    origin: string;
    destination: string;
    description: string;
    hours: string;
    days: string;
    freq: number;
    accessible: number;
    color: string;
    km: number;
    stopIndices: number[]; // 1-based stop IDs
  }[] = [
    {
      code: '101A',
      name: 'Expresso Paulista — Sé',
      origin: 'Terminal Praça da Sé',
      destination: 'Terminal Paraíso',
      description: 'Corredor central ligando o Centro Histórico ao eixo da Avenida Paulista e Paraíso.',
      hours: '05:00 - 23:45',
      days: 'Todos os dias',
      freq: 8,
      accessible: 1,
      color: '#D97706',
      km: 6.8,
      stopIndices: [1, 2, 3, 4, 5, 6, 7],
    },
    {
      code: '204B',
      name: 'Circular Jardins — Pinheiros',
      origin: 'Metrô Paulista / Consolação',
      destination: 'Terminal Pinheiros',
      description: 'Atendimento transversal conectando Consolação, Rebouças, Faria Lima e Terminal Pinheiros.',
      hours: '05:30 - 23:30',
      days: 'Segunda a Domingo',
      freq: 10,
      accessible: 1,
      color: '#2563EB',
      km: 8.4,
      stopIndices: [4, 11, 12, 13, 10, 5, 4],
    },
    {
      code: '308C',
      name: 'Troncal Vila Mariana — Centro',
      origin: 'Metrô Vila Mariana',
      destination: 'Terminal Praça da Sé',
      description: 'Ligação rápida pelo corredor Vergueiro / Liberdade entre Zona Sul e Centro.',
      hours: '04:45 - 00:00',
      days: 'Todos os dias',
      freq: 9,
      accessible: 1,
      color: '#059669',
      km: 6.2,
      stopIndices: [8, 7, 18, 1],
    },
    {
      code: '412E',
      name: 'Barra Funda — Ibirapuera',
      origin: 'Terminal Barra Funda',
      destination: 'Moema / Av. Ibirapuera',
      description: 'Linha estrutural interbairros passando por Higienópolis, Pacaembu, Paulista e Parque Ibirapuera.',
      hours: '05:15 - 23:15',
      days: 'Segunda a Sábado',
      freq: 14,
      accessible: 1,
      color: '#7C3AED',
      km: 11.6,
      stopIndices: [15, 17, 16, 4, 10, 9, 14],
    },
    {
      code: '515N',
      name: 'Alimentador Paraíso — Moema',
      origin: 'Terminal Paraíso',
      destination: 'Moema / Av. Ibirapuera',
      description: 'Conexão direta entre Terminal Paraíso, Vila Mariana, Parque Ibirapuera e Moema.',
      hours: '06:00 - 22:30',
      days: 'Todos os dias',
      freq: 15,
      accessible: 0,
      color: '#B45309',
      km: 5.9,
      stopIndices: [7, 8, 9, 14],
    },
  ];

  const insertLine = db.prepare(`
    INSERT INTO lines (code, name, origin, destination, description, operating_hours, operating_days, frequency_min, accessible, color, scheduled_km, polyline_json, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `);
  const insertLineStop = db.prepare(`
    INSERT INTO line_stops (line_id, stop_id, sequence, direction, scheduled_offset_min)
    VALUES (?, ?, ?, 'ida', ?)
  `);

  for (const l of linesSeed) {
    const polyline: LatLng[] = l.stopIndices.map((sid) => {
      const st = stopsSeed[sid - 1];
      return { lat: st.lat, lng: st.lng };
    });
    const info = insertLine.run(
      l.code,
      l.name,
      l.origin,
      l.destination,
      l.description,
      l.hours,
      l.days,
      l.freq,
      l.accessible,
      l.color,
      l.km,
      JSON.stringify(polyline),
      isoNow
    );
    const lineId = Number(info.lastInsertRowid);
    l.stopIndices.forEach((sid, idx) => {
      insertLineStop.run(lineId, sid, idx + 1, idx * 4);
    });
  }

  // Buses
  const busesSeed = [
    { unit: '1042', plate: 'FXP-4A21', model: 'Millennium V', manufacturer: 'Caio', year: 2024, cap: 82, acc: 1, km: 34210.5, status: 'em_operacao', tracker: 'GPS-TRK-1042' },
    { unit: '1048', plate: 'FXP-4A88', model: 'Millennium V', manufacturer: 'Caio', year: 2024, cap: 82, acc: 1, km: 29840.2, status: 'em_operacao', tracker: 'GPS-TRK-1048' },
    { unit: '2015', plate: 'GTR-9B15', model: 'Torino S', manufacturer: 'Marcopolo', year: 2023, cap: 76, acc: 1, km: 51200.0, status: 'em_operacao', tracker: 'GPS-TRK-2015' },
    { unit: '3021', plate: 'HLM-2C21', model: 'Apache Vip V', manufacturer: 'Caio', year: 2023, cap: 80, acc: 1, km: 44810.8, status: 'em_operacao', tracker: 'GPS-TRK-3021' },
    { unit: '4010', plate: 'KMN-7D10', model: 'e-Bus Elétrico', manufacturer: 'BYD / Marcopolo', year: 2025, cap: 86, acc: 1, km: 12450.0, status: 'em_operacao', tracker: 'GPS-TRK-4010' },
    { unit: '5009', plate: 'JPR-5E09', model: 'Gran Via Midi', manufacturer: 'Mascarello', year: 2021, cap: 62, acc: 0, km: 87320.4, status: 'em_operacao', tracker: 'GPS-TRK-5009' },
    { unit: '1055', plate: 'FXP-4A55', model: 'Millennium V', manufacturer: 'Caio', year: 2024, cap: 82, acc: 1, km: 19400.0, status: 'disponivel', tracker: 'GPS-TRK-1055' },
    { unit: '2090', plate: 'GTR-9B90', model: 'Torino S', manufacturer: 'Marcopolo', year: 2022, cap: 76, acc: 1, km: 64110.0, status: 'disponivel', tracker: 'GPS-TRK-2090' },
    { unit: '3044', plate: 'HLM-2C44', model: 'Apache Vip IV', manufacturer: 'Caio', year: 2020, cap: 78, acc: 1, km: 112500.0, status: 'em_manutencao', tracker: 'GPS-TRK-3044' },
    { unit: '4033', plate: 'KMN-7D33', model: 'Torino Express', manufacturer: 'Marcopolo', year: 2021, cap: 92, acc: 1, km: 95400.0, status: 'quebrado', tracker: 'GPS-TRK-4033' },
  ];

  const insertBus = db.prepare(`
    INSERT INTO buses (unit_number, plate, model, manufacturer, year, capacity, accessible, current_km, status, tracker_device_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const b of busesSeed) {
    insertBus.run(b.unit, b.plate, b.model, b.manufacturer, b.year, b.cap, b.acc, b.km, b.status, b.tracker, isoNow);
  }

  // Drivers
  const driversSeed = [
    { name: 'Carlos Eduardo Silva', cpf: '***.412.889-**', lic: 'CNH-D 84920112', phone: '(11) 99124-3301', status: 'em_viagem', busId: 1, lineId: 1 },
    { name: 'Mariana Oliveira Costa', cpf: '***.729.104-**', lic: 'CNH-E 73819204', phone: '(11) 98451-9920', status: 'em_viagem', busId: 2, lineId: 1 },
    { name: 'Roberto Almeida Santos', cpf: '***.553.210-**', lic: 'CNH-D 62910443', phone: '(11) 97230-1184', status: 'em_viagem', busId: 3, lineId: 2 },
    { name: 'Fernanda Souza Lima', cpf: '***.881.345-**', lic: 'CNH-E 51029384', phone: '(11) 99612-7741', status: 'em_viagem', busId: 4, lineId: 3 },
    { name: 'João Pedro Ferreira', cpf: '***.194.662-**', lic: 'CNH-D 94018273', phone: '(11) 98119-5502', status: 'em_viagem', busId: 5, lineId: 4 },
    { name: 'Luciana Mendes Pereira', cpf: '***.309.771-**', lic: 'CNH-D 38291047', phone: '(11) 99344-6610', status: 'em_viagem', busId: 6, lineId: 5 },
    { name: 'Ricardo Gomes Nogueira', cpf: '***.612.408-**', lic: 'CNH-E 19283746', phone: '(11) 97511-2239', status: 'ativo', busId: 7, lineId: 2 },
    { name: 'Patricia Barbosa Rocha', cpf: '***.904.115-**', lic: 'CNH-D 56473829', phone: '(11) 98802-4418', status: 'ativo', busId: 8, lineId: 3 },
  ];

  const insertDriver = db.prepare(`
    INSERT INTO drivers (name, cpf_masked, license_number, phone, status, assigned_bus_id, assigned_line_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const d of driversSeed) {
    insertDriver.run(d.name, d.cpf, d.lic, d.phone, d.status, d.busId, d.lineId, isoNow);
  }

  // Active and recent trips
  const insertTrip = db.prepare(`
    INSERT INTO trips (line_id, bus_id, driver_id, direction, scheduled_departure, actual_departure, scheduled_arrival, actual_arrival, status, delay_minutes, delay_reason, distance_km, stops_completed, stops_planned)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // 6 active trips + 4 completed historical trips
  insertTrip.run(1, 1, 1, 'ida', minsAgo(18), minsAgo(17), minsAhead(14), null, 'em_andamento', 1, null, 3.8, 3, 7);
  insertTrip.run(1, 2, 2, 'volta', minsAgo(25), minsAgo(18), minsAhead(8), null, 'atrasada', 7, 'Congestionamento na Av. Paulista', 4.4, 4, 7);
  insertTrip.run(2, 3, 3, 'ida', minsAgo(14), minsAgo(14), minsAhead(22), null, 'em_andamento', 0, null, 3.1, 2, 7);
  insertTrip.run(3, 4, 4, 'ida', minsAgo(10), minsAgo(10), minsAhead(16), null, 'em_andamento', 0, null, 2.5, 2, 4);
  insertTrip.run(4, 5, 5, 'ida', minsAgo(22), minsAgo(21), minsAhead(24), null, 'em_andamento', 1, null, 5.4, 3, 7);
  insertTrip.run(5, 6, 6, 'ida', minsAgo(12), minsAgo(12), minsAhead(15), null, 'em_andamento', 0, null, 1.9, 1, 4);

  // Completed trips for analytics
  insertTrip.run(1, 1, 1, 'ida', minsAgo(140), minsAgo(139), minsAgo(105), minsAgo(104), 'concluida', 1, null, 6.8, 7, 7);
  insertTrip.run(2, 3, 3, 'volta', minsAgo(130), minsAgo(124), minsAgo(90), minsAgo(82), 'concluida', 8, 'Obra na Av. Rebouças', 8.4, 7, 7);
  insertTrip.run(3, 4, 4, 'volta', minsAgo(110), minsAgo(110), minsAgo(80), minsAgo(79), 'concluida', 0, null, 6.2, 4, 4);
  insertTrip.run(4, 5, 5, 'volta', minsAgo(180), minsAgo(179), minsAgo(132), minsAgo(130), 'concluida', 2, null, 11.6, 7, 7);

  // Seed initial GPS telemetry for buses 1..5 (bus 6 intentionally has stale/missing telemetry > 10 mins ago to showcase real unavailability state!)
  const insertTelemetry = db.prepare(`
    INSERT INTO gps_telemetry (bus_id, trip_id, lat, lng, speed_kmh, heading, off_route, deviation_meters, speed_excess, recorded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const busInitialPositions: { busId: number; tripId: number; pts: { lat: number; lng: number; spd: number }[] }[] = [
    {
      busId: 1,
      tripId: 1,
      pts: [
        { lat: -23.5505, lng: -46.6333, spd: 28 },
        { lat: -23.5476, lng: -46.6388, spd: 32 },
        { lat: -23.5472, lng: -46.6512, spd: 34 },
        { lat: -23.5522, lng: -46.6572, spd: 29 },
      ],
    },
    {
      busId: 2,
      tripId: 2,
      pts: [
        { lat: -23.5754, lng: -46.6408, spd: 24 },
        { lat: -23.5685, lng: -46.6481, spd: 19 },
        { lat: -23.5645, lng: -46.6524, spd: 18 },
      ],
    },
    {
      busId: 3,
      tripId: 3,
      pts: [
        { lat: -23.5561, lng: -46.6621, spd: 30 },
        { lat: -23.5632, lng: -46.6745, spd: 38 },
        { lat: -23.5655, lng: -46.6892, spd: 35 },
      ],
    },
    {
      busId: 4,
      tripId: 4,
      pts: [
        { lat: -23.5895, lng: -46.6347, spd: 27 },
        { lat: -23.5754, lng: -46.6408, spd: 31 },
        { lat: -23.5651, lng: -46.6381, spd: 33 },
      ],
    },
    {
      busId: 5,
      tripId: 5,
      pts: [
        { lat: -23.5255, lng: -46.6675, spd: 36 },
        { lat: -23.5432, lng: -46.6578, spd: 34 },
        { lat: -23.5561, lng: -46.6621, spd: 28 },
      ],
    },
  ];

  for (const bp of busInitialPositions) {
    bp.pts.forEach((p, idx) => {
      const mAgo = (bp.pts.length - 1 - idx) * 2;
      insertTelemetry.run(bp.busId, bp.tripId, p.lat, p.lng, p.spd, 215, 0, 14, 0, minsAgo(mAgo));
    });
  }
  // Bus 6 has stale GPS from 15 minutes ago -> tests "Previsão indisponível" honestly
  insertTelemetry.run(6, 6, -23.5754, -46.6408, 0, 180, 0, 0, 0, minsAgo(15));

  // Seed stop events
  const insertStopEvent = db.prepare(`
    INSERT INTO stop_events (trip_id, bus_id, stop_id, stop_name, scheduled_time, arrival_time, departure_time, dwell_seconds, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertStopEvent.run(1, 1, 1, 'Terminal Praça da Sé', minsAgo(18), minsAgo(18), minsAgo(17), 45, 'realizada');
  insertStopEvent.run(1, 1, 2, 'Estação Anhangabaú', minsAgo(14), minsAgo(14), minsAgo(13), 38, 'realizada');
  insertStopEvent.run(1, 1, 3, 'Rua da Consolação / Mackenzie', minsAgo(9), minsAgo(9), minsAgo(8), 42, 'realizada');
  insertStopEvent.run(2, 2, 7, 'Terminal Paraíso', minsAgo(25), minsAgo(20), minsAgo(18), 65, 'realizada');

  // Seed incidents
  const insertIncident = db.prepare(`
    INSERT INTO incidents (type, severity, bus_id, line_id, driver_id, trip_id, lat, lng, title, description, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertIncident.run(
    'atraso',
    'atencao',
    2,
    1,
    2,
    2,
    -23.5645,
    -46.6524,
    'Atraso de 7 min na Linha 101A',
    'Veículo #1048 operando com atraso devido a retenção no cruzamento da Av. Paulista com Brigadeiro.',
    'aberta',
    minsAgo(8)
  );
  insertIncident.run(
    'falha_mecanica',
    'critica',
    10,
    4,
    null,
    null,
    -23.5476,
    -46.6652,
    'Falha no sistema pneumático — Veículo #4033',
    'Veículo recolhido preventivamente após alerta no painel pneumático. Viagem reprogramada.',
    'em_tratamento',
    minsAgo(45)
  );

  // Seed maintenance log
  db.prepare(`
    INSERT INTO maintenance_logs (bus_id, reason, responsible, status, started_at, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(9, 'Revisão preventiva de freios e elevador PCD', 'Oficina Central Norte', 'em_andamento', minsAgo(180), 'Troca de pastilhas e calibração da plataforma de acessibilidade.');

  // Seed notices
  const insertNotice = db.prepare(`
    INSERT INTO notices (title, category, message, affected_line_ids_json, start_time, expected_normalization, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?)
  `);
  insertNotice.run(
    'Obra de recapeamento na Av. Rebouças',
    'obra',
    'Trecho próximo à Rua Oscar Freire opera em faixa reduzida. A linha 204B pode registrar acréscimo de 5 a 8 minutos no tempo de percurso.',
    JSON.stringify([2]),
    minsAgo(120),
    minsAhead(240),
    minsAgo(120)
  );
  insertNotice.run(
    'Operação monitorada com veículos 100% acessíveis na Linha 101A',
    'comunicado',
    'Toda a frota escalada para o corredor Paulista–Sé conta com piso baixo e plataforma elevatória ativa.',
    JSON.stringify([1]),
    minsAgo(360),
    null,
    minsAgo(360)
  );

  // Seed ratings
  const insertRating = db.prepare(`
    INSERT INTO ratings (line_id, bus_id, service_quality, punctuality, vehicle_condition, cleanliness, comfort, overall, comment, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertRating.run(1, 1, 5, 4, 5, 5, 4, 5, 'Ônibus silencioso, ar-condicionado funcionando e previsão no mapa bateu exato.', minsAgo(90));
  insertRating.run(2, 3, 4, 3, 4, 4, 4, 4, 'Bom atendimento, mas trecho da Rebouças estava lento por causa da obra.', minsAgo(60));
  insertRating.run(4, 5, 5, 5, 5, 5, 5, 5, 'Veículo elétrico muito confortável e rampa PCD ágil.', minsAgo(40));

  // Seed sample complaint
  db.prepare(`
    INSERT INTO complaints (protocol, line_id, bus_id, driver_name, occurred_at, category, description, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'URB-2026-0101',
    2,
    3,
    'Roberto Almeida Santos',
    minsAgo(95),
    'Atraso excessivo',
    'Atraso de 8 minutos na passagem pelo ponto da Rebouças devido à obra.',
    'em_analise',
    minsAgo(80)
  );
}

seedIfEmpty();

export function getSystemConfig(): SystemConfig {
  const rows = db.prepare('SELECT key, value FROM system_config').all() as { key: string; value: string }[];
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  return {
    delayToleranceMinutes: Number(map.delayToleranceMinutes ?? 5),
    routeDeviationMeters: Number(map.routeDeviationMeters ?? 180),
    speedLimitUrbanKmh: Number(map.speedLimitUrbanKmh ?? 60),
    speedLimitCorridorKmh: Number(map.speedLimitCorridorKmh ?? 70),
    gpsRetentionDays: Number(map.gpsRetentionDays ?? 90),
    gpsStaleSeconds: Number(map.gpsStaleSeconds ?? 180),
    telemetryStreamEnabled: map.telemetryStreamEnabled !== '0',
  };
}

export function setSystemConfig(partial: Partial<SystemConfig>): SystemConfig {
  const upsert = db.prepare('INSERT INTO system_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [k, v] of Object.entries(partial)) {
    if (v === undefined) continue;
    upsert.run(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
  }
  return getSystemConfig();
}

export function listStops(): Stop[] {
  const rows = db.prepare('SELECT * FROM stops ORDER BY code ASC').all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: Number(r.id),
    code: String(r.code),
    name: String(r.name),
    neighborhood: String(r.neighborhood ?? 'Centro'),
    address: String(r.address),
    lat: Number(r.lat),
    lng: Number(r.lng),
    accessible: Boolean(r.accessible),
    shelter: Boolean(r.shelter),
    createdAt: String(r.created_at),
  }));
}

export function listLineStops(lineId?: number): LineStopLink[] {
  const stops = listStops();
  const stopById = new Map<number, Stop>();
  for (const s of stops) stopById.set(s.id, s);

  const sql = lineId
    ? 'SELECT * FROM line_stops WHERE line_id = ? ORDER BY sequence ASC'
    : 'SELECT * FROM line_stops ORDER BY line_id ASC, sequence ASC';
  const rows = (lineId ? db.prepare(sql).all(lineId) : db.prepare(sql).all()) as Record<string, unknown>[];

  return rows.map((r) => ({
    id: Number(r.id),
    lineId: Number(r.line_id),
    stopId: Number(r.stop_id),
    sequence: Number(r.sequence),
    direction: String(r.direction) as 'ida' | 'volta',
    scheduledOffsetMin: Number(r.scheduled_offset_min),
    stop: stopById.get(Number(r.stop_id)),
  }));
}

export function listLines(includeStops = false): TransitLine[] {
  const rows = db.prepare('SELECT * FROM lines ORDER BY code ASC').all() as Record<string, unknown>[];
  const allLinks = includeStops ? listLineStops() : [];

  return rows.map((r) => {
    const id = Number(r.id);
    let polyline: LatLng[] = [];
    try {
      polyline = JSON.parse(String(r.polyline_json));
    } catch {
      polyline = [];
    }
    return {
      id,
      code: String(r.code),
      name: String(r.name),
      origin: String(r.origin),
      destination: String(r.destination),
      description: String(r.description),
      operatingHours: String(r.operating_hours),
      operatingDays: String(r.operating_days),
      frequencyMin: Number(r.frequency_min),
      accessible: Boolean(r.accessible),
      color: String(r.color),
      scheduledKm: Number(r.scheduled_km),
      polyline,
      scheduledDepartures: [],
      active: Boolean(r.active),
      createdAt: String(r.created_at),
      stops: includeStops ? allLinks.filter((ls) => ls.lineId === id) : undefined,
    };
  });
}

export function listBusesWithTelemetry(): Bus[] {
  const cfg = getSystemConfig();
  const nowMs = Date.now();

  const rows = db.prepare(`
    SELECT
      b.*,
      t.lat AS last_lat,
      t.lng AS last_lng,
      t.speed_kmh AS last_speed,
      t.heading AS last_heading,
      t.off_route AS last_off_route,
      t.deviation_meters AS last_deviation,
      t.speed_excess AS last_speed_excess,
      t.recorded_at AS last_recorded_at,
      tr.id AS active_trip_id,
      tr.direction AS active_direction,
      l.id AS active_line_id,
      l.code AS active_line_code,
      d.name AS active_driver_name
    FROM buses b
    LEFT JOIN gps_telemetry t ON t.id = (
      SELECT id FROM gps_telemetry gt WHERE gt.bus_id = b.id ORDER BY gt.recorded_at DESC, gt.id DESC LIMIT 1
    )
    LEFT JOIN trips tr ON tr.id = (
      SELECT id FROM trips tp WHERE tp.bus_id = b.id AND tp.status IN ('em_andamento', 'atrasada') ORDER BY tp.id DESC LIMIT 1
    )
    LEFT JOIN lines l ON l.id = tr.line_id
    LEFT JOIN drivers d ON d.id = tr.driver_id
    ORDER BY b.unit_number ASC
  `).all() as Record<string, unknown>[];

  return rows.map((r) => {
    const lastRecorded = r.last_recorded_at ? String(r.last_recorded_at) : null;
    const ageSec = lastRecorded ? (nowMs - new Date(lastRecorded).getTime()) / 1000 : Infinity;
    const status = String(r.status) as Bus['status'];
    const gpsAvailable =
      status === 'em_operacao' &&
      r.last_lat !== null &&
      r.last_lng !== null &&
      ageSec <= cfg.gpsStaleSeconds;

    return {
      id: Number(r.id),
      unitNumber: String(r.unit_number),
      plate: String(r.plate),
      model: String(r.model),
      manufacturer: String(r.manufacturer),
      year: Number(r.year),
      capacity: Number(r.capacity),
      accessible: Boolean(r.accessible),
      currentKm: Number(r.current_km),
      status,
      trackerDeviceId: String(r.tracker_device_id),
      createdAt: String(r.created_at),
      lat: r.last_lat !== null && r.last_lat !== undefined ? Number(r.last_lat) : null,
      lng: r.last_lng !== null && r.last_lng !== undefined ? Number(r.last_lng) : null,
      speedKmh: r.last_speed !== null && r.last_speed !== undefined ? Number(r.last_speed) : null,
      heading: r.last_heading !== null && r.last_heading !== undefined ? Number(r.last_heading) : null,
      offRoute: Boolean(r.last_off_route),
      deviationMeters:
        r.last_deviation !== null && r.last_deviation !== undefined ? Number(r.last_deviation) : null,
      speedExcess: Boolean(r.last_speed_excess),
      lastTelemetryAt: lastRecorded,
      gpsAvailable,
      activeLineId: r.active_line_id ? Number(r.active_line_id) : null,
      activeLineCode: r.active_line_code ? String(r.active_line_code) : null,
      activeDriverName: r.active_driver_name ? String(r.active_driver_name) : null,
      activeTripId: r.active_trip_id ? Number(r.active_trip_id) : null,
      activeDirection:
        r.active_direction === 'volta'
          ? 'volta'
          : r.active_direction === 'ida'
            ? 'ida'
            : null,
    };
  });
}

export function listDrivers(): Driver[] {
  const rows = db.prepare('SELECT * FROM drivers ORDER BY name ASC').all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    cpfMasked: String(r.cpf_masked),
    licenseNumber: String(r.license_number),
    phone: String(r.phone),
    status: String(r.status) as Driver['status'],
    assignedBusId: r.assigned_bus_id ? Number(r.assigned_bus_id) : null,
    assignedLineId: r.assigned_line_id ? Number(r.assigned_line_id) : null,
    createdAt: String(r.created_at),
  }));
}

export function listTrips(): Trip[] {
  const rows = db.prepare(`
    SELECT t.*, l.code AS line_code, l.name AS line_name, b.unit_number AS bus_unit_number, d.name AS driver_name
    FROM trips t
    JOIN lines l ON l.id = t.line_id
    JOIN buses b ON b.id = t.bus_id
    JOIN drivers d ON d.id = t.driver_id
    ORDER BY t.id DESC
    LIMIT 150
  `).all() as Record<string, unknown>[];

  return rows.map((r) => ({
    id: Number(r.id),
    lineId: Number(r.line_id),
    busId: Number(r.bus_id),
    driverId: Number(r.driver_id),
    direction: String(r.direction) as 'ida' | 'volta',
    scheduledDeparture: String(r.scheduled_departure),
    actualDeparture: r.actual_departure ? String(r.actual_departure) : null,
    scheduledArrival: String(r.scheduled_arrival),
    actualArrival: r.actual_arrival ? String(r.actual_arrival) : null,
    status: String(r.status) as Trip['status'],
    delayMinutes: Number(r.delay_minutes),
    delayReason: r.delay_reason ? String(r.delay_reason) : null,
    distanceKm: Number(r.distance_km),
    stopsCompleted: Number(r.stops_completed),
    stopsPlanned: Number(r.stops_planned),
    lineCode: String(r.line_code),
    lineName: String(r.line_name),
    busUnitNumber: String(r.bus_unit_number),
    driverName: String(r.driver_name),
  }));
}

export function listIncidents(): Incident[] {
  const rows = db.prepare('SELECT * FROM incidents ORDER BY id DESC LIMIT 150').all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: Number(r.id),
    type: String(r.type) as Incident['type'],
    severity: String(r.severity) as Incident['severity'],
    busId: r.bus_id ? Number(r.bus_id) : null,
    lineId: r.line_id ? Number(r.line_id) : null,
    driverId: r.driver_id ? Number(r.driver_id) : null,
    tripId: r.trip_id ? Number(r.trip_id) : null,
    lat: r.lat !== null && r.lat !== undefined ? Number(r.lat) : null,
    lng: r.lng !== null && r.lng !== undefined ? Number(r.lng) : null,
    title: String(r.title),
    description: String(r.description),
    status: String(r.status) as Incident['status'],
    reportedByUserId: r.reported_by_user_id ? Number(r.reported_by_user_id) : null,
    createdAt: String(r.created_at),
    resolvedAt: r.resolved_at ? String(r.resolved_at) : null,
  }));
}

export function listMaintenanceLogs(): MaintenanceLog[] {
  const rows = db.prepare('SELECT * FROM maintenance_logs ORDER BY id DESC LIMIT 100').all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: Number(r.id),
    busId: Number(r.bus_id),
    reason: String(r.reason),
    responsible: String(r.responsible),
    status: String(r.status) as MaintenanceLog['status'],
    startedAt: String(r.started_at),
    endedAt: r.ended_at ? String(r.ended_at) : null,
    authorizedByUserId: r.authorized_by_user_id ? Number(r.authorized_by_user_id) : null,
    notes: String(r.notes),
  }));
}

export function listNotices(activeOnly = false): Notice[] {
  const sql = activeOnly
    ? 'SELECT * FROM notices WHERE active = 1 ORDER BY id DESC'
    : 'SELECT * FROM notices ORDER BY id DESC';
  const rows = db.prepare(sql).all() as Record<string, unknown>[];
  return rows.map((r) => {
    let ids: number[] = [];
    try {
      ids = JSON.parse(String(r.affected_line_ids_json));
    } catch {
      ids = [];
    }
    return {
      id: Number(r.id),
      title: String(r.title),
      category: String(r.category) as Notice['category'],
      message: String(r.message),
      affectedLineIds: ids,
      startTime: String(r.start_time),
      expectedNormalization: r.expected_normalization ? String(r.expected_normalization) : null,
      active: Boolean(r.active),
      createdAt: String(r.created_at),
    };
  });
}

export function listComplaints(userId?: number): Complaint[] {
  const sql = userId
    ? 'SELECT * FROM complaints WHERE user_id = ? ORDER BY id DESC'
    : 'SELECT * FROM complaints ORDER BY id DESC LIMIT 150';
  const rows = (userId ? db.prepare(sql).all(userId) : db.prepare(sql).all()) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: Number(r.id),
    protocol: String(r.protocol),
    userId: r.user_id ? Number(r.user_id) : null,
    lineId: r.line_id ? Number(r.line_id) : null,
    busId: r.bus_id ? Number(r.bus_id) : null,
    driverName: r.driver_name ? String(r.driver_name) : null,
    occurredAt: String(r.occurred_at),
    category: String(r.category),
    description: String(r.description),
    attachmentName: r.attachment_name ? String(r.attachment_name) : null,
    status: String(r.status) as Complaint['status'],
    resolutionNote: r.resolution_note ? String(r.resolution_note) : null,
    createdAt: String(r.created_at),
  }));
}

export function listRatings(): Rating[] {
  const rows = db.prepare('SELECT * FROM ratings ORDER BY id DESC LIMIT 150').all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: Number(r.id),
    userId: r.user_id ? Number(r.user_id) : null,
    lineId: Number(r.line_id),
    busId: r.bus_id ? Number(r.bus_id) : null,
    serviceQuality: Number(r.service_quality),
    punctuality: Number(r.punctuality),
    vehicleCondition: Number(r.vehicle_condition),
    cleanliness: Number(r.cleanliness),
    comfort: Number(r.comfort),
    overall: Number(r.overall),
    comment: String(r.comment),
    createdAt: String(r.created_at),
  }));
}

export function listStopEvents(tripId?: number): StopEvent[] {
  const sql = tripId
    ? 'SELECT * FROM stop_events WHERE trip_id = ? ORDER BY id DESC'
    : 'SELECT * FROM stop_events ORDER BY id DESC LIMIT 150';
  const rows = (tripId ? db.prepare(sql).all(tripId) : db.prepare(sql).all()) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: Number(r.id),
    tripId: Number(r.trip_id),
    busId: Number(r.bus_id),
    stopId: r.stop_id ? Number(r.stop_id) : null,
    stopName: String(r.stop_name),
    scheduledTime: r.scheduled_time ? String(r.scheduled_time) : null,
    arrivalTime: String(r.arrival_time),
    departureTime: r.departure_time ? String(r.departure_time) : null,
    dwellSeconds: Number(r.dwell_seconds),
    status: String(r.status) as StopEvent['status'],
  }));
}

export function listFavorites(userId: number): FavoriteItem[] {
  const rows = db.prepare('SELECT * FROM favorites WHERE user_id = ? ORDER BY id DESC').all(userId) as Record<string, unknown>[];
  return rows.map((r) => {
    let meta: Record<string, unknown> = {};
    try {
      meta = JSON.parse(String(r.meta_json));
    } catch {
      meta = {};
    }
    return {
      id: Number(r.id),
      userId: Number(r.user_id),
      targetType: String(r.target_type) as FavoriteItem['targetType'],
      targetId: String(r.target_id),
      label: String(r.label),
      meta,
      createdAt: String(r.created_at),
    };
  });
}

export function listAuditLogs(): AuditLog[] {
  const rows = db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 200').all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: Number(r.id),
    userId: r.user_id ? Number(r.user_id) : null,
    userName: String(r.user_name),
    userRole: String(r.user_role),
    action: String(r.action),
    entityType: String(r.entity_type),
    entityId: String(r.entity_id),
    details: String(r.details),
    createdAt: String(r.created_at),
  }));
}

export function listTelemetryHistory(busId: number, limit = 120): TelemetryPoint[] {
  const rows = db
    .prepare('SELECT * FROM gps_telemetry WHERE bus_id = ? ORDER BY recorded_at ASC, id ASC LIMIT ?')
    .all(busId, limit) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: Number(r.id),
    busId: Number(r.bus_id),
    tripId: r.trip_id ? Number(r.trip_id) : null,
    lat: Number(r.lat),
    lng: Number(r.lng),
    speedKmh: Number(r.speed_kmh),
    heading: Number(r.heading),
    offRoute: Boolean(r.off_route),
    deviationMeters: Number(r.deviation_meters),
    speedExcess: Boolean(r.speed_excess),
    recordedAt: String(r.recorded_at),
  }));
}
