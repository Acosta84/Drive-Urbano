export const UserRole = {
  ADMIN_GERAL: 'admin_geral',
  GESTOR_OPERACIONAL: 'gestor_operacional',
  SUPERVISOR: 'supervisor',
  FISCAL: 'fiscal',
  GESTOR_FROTA: 'gestor_frota',
  GESTOR_MOTORISTAS: 'gestor_motoristas',
  ANALISTA: 'analista',
  PASSAGEIRO: 'passageiro',
} as const;

export type UserRoleType = (typeof UserRole)[keyof typeof UserRole];

export const ROLE_LABELS: Record<UserRoleType, string> = {
  admin_geral: 'Administrador Geral',
  gestor_operacional: 'Gestor Operacional',
  supervisor: 'Supervisor',
  fiscal: 'Fiscal de Transporte',
  gestor_frota: 'Responsável pela Frota',
  gestor_motoristas: 'Responsável pelos Motoristas',
  analista: 'Analista de Relatórios',
  passageiro: 'Passageiro',
};

export type Permission =
  | 'dashboard:view'
  | 'monitoring:view'
  | 'fleet:manage'
  | 'drivers:manage'
  | 'lines:manage'
  | 'trips:manage'
  | 'incidents:manage'
  | 'maintenance:manage'
  | 'reports:view'
  | 'gps:ingest'
  | 'notices:manage'
  | 'complaints:manage'
  | 'users:manage'
  | 'config:manage'
  | 'audit:view';

export const ROLE_PERMISSIONS: Record<UserRoleType, Permission[]> = {
  admin_geral: [
    'dashboard:view',
    'monitoring:view',
    'fleet:manage',
    'drivers:manage',
    'lines:manage',
    'trips:manage',
    'incidents:manage',
    'maintenance:manage',
    'reports:view',
    'gps:ingest',
    'notices:manage',
    'complaints:manage',
    'users:manage',
    'config:manage',
    'audit:view',
  ],
  gestor_operacional: [
    'dashboard:view',
    'monitoring:view',
    'fleet:manage',
    'drivers:manage',
    'lines:manage',
    'trips:manage',
    'incidents:manage',
    'maintenance:manage',
    'reports:view',
    'gps:ingest',
    'notices:manage',
    'complaints:manage',
    'audit:view',
  ],
  supervisor: [
    'dashboard:view',
    'monitoring:view',
    'trips:manage',
    'incidents:manage',
    'notices:manage',
    'complaints:manage',
    'reports:view',
  ],
  fiscal: [
    'dashboard:view',
    'monitoring:view',
    'trips:manage',
    'incidents:manage',
    'complaints:manage',
  ],
  gestor_frota: [
    'dashboard:view',
    'monitoring:view',
    'fleet:manage',
    'maintenance:manage',
    'reports:view',
  ],
  gestor_motoristas: [
    'dashboard:view',
    'monitoring:view',
    'drivers:manage',
    'trips:manage',
    'reports:view',
  ],
  analista: ['dashboard:view', 'monitoring:view', 'reports:view', 'audit:view'],
  passageiro: [],
};

export interface LatLng {
  lat: number;
  lng: number;
}

export interface NotificationPrefs {
  delays: boolean;
  routeChanges: boolean;
  scheduleChanges: boolean;
  operationalIssues: boolean;
  vehicleUnavailable: boolean;
  favoritesOnly: boolean;
}

export interface UserProfile {
  id: number;
  name: string;
  email: string;
  role: UserRoleType;
  active: boolean;
  accessibilityNeeds: boolean;
  notificationPrefs: NotificationPrefs;
  createdAt: string;
}

export type BusStatus =
  | 'disponivel'
  | 'em_operacao'
  | 'em_manutencao'
  | 'quebrado'
  | 'retirado'
  | 'inativo';

export interface Bus {
  id: number;
  unitNumber: string;
  plate: string;
  model: string;
  manufacturer: string;
  year: number;
  capacity: number;
  accessible: boolean;
  currentKm: number;
  status: BusStatus;
  trackerDeviceId: string;
  createdAt: string;
  // Live telemetry merged fields
  lat?: number | null;
  lng?: number | null;
  speedKmh?: number | null;
  heading?: number | null;
  offRoute?: boolean;
  deviationMeters?: number | null;
  speedExcess?: boolean;
  lastTelemetryAt?: string | null;
  gpsAvailable?: boolean;
  activeLineId?: number | null;
  activeLineCode?: string | null;
  activeDriverName?: string | null;
  activeTripId?: number | null;
  activeDirection?: 'ida' | 'volta' | null;
}

export interface Driver {
  id: number;
  name: string;
  cpfMasked: string;
  licenseNumber: string;
  phone: string;
  status: 'ativo' | 'inativo' | 'em_viagem';
  assignedBusId: number | null;
  assignedLineId: number | null;
  createdAt: string;
}

export interface Stop {
  id: number;
  code: string;
  name: string;
  neighborhood: string;
  address: string;
  lat: number;
  lng: number;
  accessible: boolean;
  shelter: boolean;
  createdAt: string;
}

export interface LineStopLink {
  id: number;
  lineId: number;
  stopId: number;
  sequence: number;
  direction: 'ida' | 'volta';
  scheduledOffsetMin: number;
  stop?: Stop;
}

export interface TransitLine {
  id: number;
  code: string;
  name: string;
  origin: string;
  destination: string;
  description: string;
  operatingHours: string;
  operatingDays: string;
  frequencyMin: number;
  accessible: boolean;
  color: string;
  scheduledKm: number;
  polyline: LatLng[];
  scheduledDepartures: string[];
  active: boolean;
  createdAt: string;
  stops?: LineStopLink[];
}

export interface Trip {
  id: number;
  lineId: number;
  busId: number;
  driverId: number;
  direction: 'ida' | 'volta';
  scheduledDeparture: string;
  actualDeparture: string | null;
  scheduledArrival: string;
  actualArrival: string | null;
  status: 'programada' | 'em_andamento' | 'concluida' | 'atrasada' | 'cancelada' | 'interrompida';
  delayMinutes: number;
  delayReason: string | null;
  distanceKm: number;
  stopsCompleted: number;
  stopsPlanned: number;
  lineCode?: string;
  lineName?: string;
  busUnitNumber?: string;
  driverName?: string;
}

export interface StopEvent {
  id: number;
  tripId: number;
  busId: number;
  stopId: number | null;
  stopName: string;
  scheduledTime: string | null;
  arrivalTime: string;
  departureTime: string | null;
  dwellSeconds: number;
  status: 'realizada' | 'nao_realizada' | 'nao_programada';
}

export interface Incident {
  id: number;
  type:
    | 'atraso'
    | 'desvio_rota'
    | 'excesso_velocidade'
    | 'falha_mecanica'
    | 'parada_nao_programada';
  severity: 'critica' | 'atencao' | 'info';
  busId: number | null;
  lineId: number | null;
  driverId: number | null;
  tripId: number | null;
  lat: number | null;
  lng: number | null;
  title: string;
  description: string;
  status: 'aberta' | 'em_tratamento' | 'resolvida';
  reportedByUserId: number | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface MaintenanceLog {
  id: number;
  busId: number;
  reason: string;
  responsible: string;
  status: 'em_andamento' | 'concluida';
  startedAt: string;
  endedAt: string | null;
  authorizedByUserId: number | null;
  notes: string;
}

export interface Notice {
  id: number;
  title: string;
  category:
    | 'interrupcao'
    | 'desvio'
    | 'obra'
    | 'operacional'
    | 'alteracao_temporaria'
    | 'comunicado';
  message: string;
  affectedLineIds: number[];
  startTime: string;
  expectedNormalization: string | null;
  active: boolean;
  createdAt: string;
}

export interface Complaint {
  id: number;
  protocol: string;
  userId: number | null;
  lineId: number | null;
  busId: number | null;
  driverName: string | null;
  occurredAt: string;
  category: string;
  description: string;
  attachmentName: string | null;
  status: 'recebida' | 'em_analise' | 'respondida' | 'encerrada';
  resolutionNote: string | null;
  createdAt: string;
}

export interface Rating {
  id: number;
  userId: number | null;
  lineId: number;
  busId: number | null;
  serviceQuality: number;
  punctuality: number;
  vehicleCondition: number;
  cleanliness: number;
  comfort: number;
  overall: number;
  comment: string;
  createdAt: string;
}

export interface FavoriteItem {
  id: number;
  userId: number;
  targetType: 'line' | 'stop' | 'destination' | 'route';
  targetId: string;
  label: string;
  meta: Record<string, unknown>;
  createdAt: string;
}

export interface FrequentDestination {
  id: string;
  name: string;
  neighborhood: string;
  stopId: number;
  lat: number;
  lng: number;
  category: string;
}

export interface AuditLog {
  id: number;
  userId: number | null;
  userName: string;
  userRole: string;
  action: string;
  entityType: string;
  entityId: string;
  details: string;
  createdAt: string;
}

export interface SystemConfig {
  delayToleranceMinutes: number;
  routeDeviationMeters: number;
  speedLimitUrbanKmh: number;
  speedLimitCorridorKmh: number;
  gpsRetentionDays: number;
  gpsStaleSeconds: number;
  telemetryStreamEnabled: boolean;
}

export type ArrivalStatus = 'chegando' | 'no_horario' | 'atrasado' | 'indisponivel';

export interface ArrivalPrediction {
  busId: number;
  unitNumber: string;
  lineId: number;
  lineCode: string;
  lineName: string;
  lineColor: string;
  direction: string;
  accessible: boolean;
  available: boolean;
  arrivalStatus: ArrivalStatus;
  unavailableReason?: string;
  etaMinutes: number | null;
  estimatedArrivalIso: string | null;
  distanceMeters: number | null;
  speedKmh: number | null;
  vehicleStatus: string;
  offRoute: boolean;
}

export interface PlannedTripLeg {
  type: 'walk' | 'bus';
  lineId?: number;
  lineCode?: string;
  lineName?: string;
  lineColor?: string;
  accessible?: boolean;
  fromName: string;
  toName: string;
  from: LatLng;
  to: LatLng;
  distanceMeters: number;
  durationMinutes: number;
  stopsCount?: number;
  scheduledDeparture?: string;
  polyline: LatLng[];
}

export interface PlannedTripOption {
  id: string;
  transfers: number;
  totalMinutes: number;
  walkMinutes: number;
  totalDistanceMeters: number;
  accessible: boolean;
  legs: PlannedTripLeg[];
}

export type ReportPeriod = 'diario' | 'semanal' | 'mensal';

export interface DashboardMetrics {
  totalBuses: number;
  busesInOperation: number;
  busesStopped: number;
  busesMaintenance: number;
  activeDrivers: number;
  tripsInProgress: number;
  tripsCompleted: number;
  tripsDelayed: number;
  vehiclesOffRoute: number;
  openIncidents: number;
  totalMileageKm: number;
  punctualityRate: number;
  averageRating: number;
  hourlyPunctuality: { hour: string; onTime: number; delayed: number }[];
  lineMileage: { code: string; plannedKm: number; actualKm: number }[];
}

export interface TelemetryPoint {
  id: number;
  busId: number;
  tripId: number | null;
  lat: number;
  lng: number;
  speedKmh: number;
  heading: number;
  offRoute: boolean;
  deviationMeters: number;
  speedExcess: boolean;
  recordedAt: string;
}
