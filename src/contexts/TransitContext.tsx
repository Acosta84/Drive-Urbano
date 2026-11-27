import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  createInitialMockDatabase,
  type MockDatabaseSnapshot,
} from '../data/mockTransitData.ts';
import {
  stepFleetSimulation,
  type BusRouteCursor,
} from '../services/simulationService.ts';
import {
  computeStopArrivals,
  distanceToPolylineMeters,
  planTransitTrips,
  polylineLengthKm,
} from '../services/transitGeo.ts';
import type {
  ArrivalPrediction,
  AuditLog,
  Bus,
  BusStatus,
  Complaint,
  DashboardMetrics,
  Driver,
  FavoriteItem,
  FrequentDestination,
  Incident,
  LatLng,
  LineStopLink,
  MaintenanceLog,
  Notice,
  PlannedTripOption,
  Rating,
  ReportPeriod,
  Stop,
  StopEvent,
  SystemConfig,
  TelemetryPoint,
  TransitLine,
  Trip,
} from '../shared/types.ts';

export interface LiveNotification {
  id: string;
  type: string;
  severity: 'critica' | 'atencao' | 'info';
  title: string;
  timestamp: string;
  lineId?: number | null;
  read: boolean;
}

interface TransitContextValue {
  lines: TransitLine[];
  stops: Stop[];
  lineStops: LineStopLink[];
  buses: Bus[];
  drivers: Driver[];
  trips: Trip[];
  stopEvents: StopEvent[];
  incidents: Incident[];
  maintenanceLogs: MaintenanceLog[];
  notices: Notice[];
  complaints: Complaint[];
  ratings: Rating[];
  favorites: FavoriteItem[];
  frequentDestinations: FrequentDestination[];
  telemetryHistory: TelemetryPoint[];
  auditLogs: AuditLog[];
  config: SystemConfig;
  averageRating: number;
  ratingsCount: number;
  loading: boolean;
  simulationRunning: boolean;
  notifications: LiveNotification[];
  getDashboardMetrics: (period?: ReportPeriod) => DashboardMetrics;
  getArrivalsForStop: (stopId: number) => ArrivalPrediction[];
  planTrips: (params: {
    origin: LatLng;
    originLabel: string;
    destination: LatLng;
    destinationLabel: string;
    accessibleOnly: boolean;
  }) => PlannedTripOption[];
  toggleSimulation: () => void;
  resetDemoData: () => void;
  markAllNotificationsRead: () => void;

  // Passenger actions
  addFavorite: (
    targetType: FavoriteItem['targetType'],
    targetId: string,
    label: string,
    meta?: Record<string, unknown>
  ) => void;
  removeFavorite: (id: number) => void;
  submitComplaint: (input: {
    lineId: number | null;
    busId: number | null;
    driverName: string | null;
    category: string;
    description: string;
    attachmentName: string | null;
  }) => Complaint;
  trackComplaint: (protocol: string) => Complaint | null;
  submitRating: (input: {
    lineId: number;
    busId: number | null;
    serviceQuality: number;
    punctuality: number;
    vehicleCondition: number;
    cleanliness: number;
    comfort: number;
    comment: string;
  }) => Rating;

  // Admin operational actions
  createBus: (input: {
    unitNumber: string;
    plate: string;
    model: string;
    manufacturer: string;
    year: number;
    capacity: number;
    accessible: boolean;
  }) => Bus;
  updateBusStatus: (busId: number, status: BusStatus) => void;
  createDriver: (input: {
    name: string;
    cpfMasked: string;
    licenseNumber: string;
    phone: string;
    assignedBusId: number | null;
    assignedLineId: number | null;
  }) => Driver;
  toggleDriverStatus: (driverId: number) => void;
  saveLine: (input: {
    id?: number | null;
    code: string;
    name: string;
    origin: string;
    destination: string;
    operatingHours: string;
    frequencyMin: number;
    color: string;
    accessible: boolean;
    polyline: LatLng[];
    stopIds: number[];
  }) => TransitLine;
  startTrip: (input: {
    lineId: number;
    busId: number;
    driverId: number;
    direction: 'ida' | 'volta';
  }) => Trip;
  updateTripStatus: (
    tripId: number,
    status: Trip['status'],
    delayMinutes?: number,
    delayReason?: string
  ) => void;
  updateIncidentStatus: (id: number, status: Incident['status']) => void;
  injectSimulatedGps: (input: {
    busId: number;
    lat: number;
    lng: number;
    speedKmh: number;
  }) => Bus | null;
  reportBreakdown: (input: {
    busId: number;
    reason: string;
    responsible: string;
    targetStatus: 'quebrado' | 'em_manutencao' | 'retirado';
  }) => number;
  completeMaintenance: (id: number) => void;
  publishNotice: (input: {
    title: string;
    category: Notice['category'];
    message: string;
    affectedLineIds: number[];
  }) => Notice;
  updateComplaintStatus: (
    id: number,
    status: Complaint['status'],
    resolutionNote?: string
  ) => void;
  updateConfig: (patch: Partial<SystemConfig>) => void;
}

const TransitContext = createContext<TransitContextValue | null>(null);

export const TransitProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [db, setDb] = useState<MockDatabaseSnapshot>(() => createInitialMockDatabase());
  const [loading] = useState(false);
  const [simulationRunning, setSimulationRunning] = useState(true);
  const [notifications, setNotifications] = useState<LiveNotification[]>(() => {
    const initial = createInitialMockDatabase();
    return [
      {
        id: 'init-alert-1',
        type: 'desvio',
        severity: 'critica',
        title: 'Veículo #4742 (Linha 474) em desvio operacional em São Cristóvão',
        timestamp: initial.incidents[0]?.createdAt ?? new Date().toISOString(),
        lineId: 5,
        read: false,
      },
      {
        id: 'init-alert-2',
        type: 'atraso',
        severity: 'atencao',
        title: 'Linha 101 com atraso médio de 7 min sentido Copacabana',
        timestamp: initial.incidents[1]?.createdAt ?? new Date().toISOString(),
        lineId: 1,
        read: false,
      },
      {
        id: 'init-alert-3',
        type: 'comunicado',
        severity: 'info',
        title: 'Frota elétrica ativa nas linhas 204 e 415 com acessibilidade total',
        timestamp: initial.notices[2]?.createdAt ?? new Date().toISOString(),
        lineId: 2,
        read: true,
      },
    ];
  });

  const cursorsRef = useRef<Record<number, BusRouteCursor>>({});
  const lastVisitedRef = useRef<Record<number, number>>({});
  const tickCountRef = useRef<number>(0);

  // Real-time fleet simulation tick every 2.5 seconds
  useEffect(() => {
    if (!simulationRunning) return;

    const timer = window.setInterval(() => {
      tickCountRef.current += 1;
      setDb((prev) => {
        const next = stepFleetSimulation({
          buses: prev.buses,
          lines: prev.lines,
          lineStops: prev.lineStops,
          trips: prev.trips,
          incidents: prev.incidents,
          stopEvents: prev.stopEvents,
          telemetryHistory: prev.telemetryHistory,
          config: prev.config,
          cursors: cursorsRef.current,
          lastVisitedStopByBus: lastVisitedRef.current,
          tickCount: tickCountRef.current,
        });

        if (next.newAlerts.length > 0) {
          setNotifications((cur) => [
            ...next.newAlerts.map((a) => ({
              id: `sim-alert-${a.id}-${Date.now()}`,
              type: a.type,
              severity: a.severity,
              title: a.title,
              timestamp: a.createdAt,
              lineId: a.lineId,
              read: false,
            })),
            ...cur.slice(0, 24),
          ]);
        }

        return {
          ...prev,
          buses: next.buses,
          trips: next.trips,
          incidents: next.incidents,
          stopEvents: next.stopEvents,
          telemetryHistory: next.telemetryHistory,
        };
      });
    }, 2500);

    return () => window.clearInterval(timer);
  }, [simulationRunning]);

  const toggleSimulation = useCallback(() => {
    setSimulationRunning((r) => !r);
  }, []);

  const resetDemoData = useCallback(() => {
    cursorsRef.current = {};
    lastVisitedRef.current = {};
    tickCountRef.current = 0;
    setDb(createInitialMockDatabase());
  }, []);

  const markAllNotificationsRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const averageRating = useMemo(() => {
    if (db.ratings.length === 0) return 0;
    const sum = db.ratings.reduce((acc, r) => acc + r.overall, 0);
    return Number((sum / db.ratings.length).toFixed(1));
  }, [db.ratings]);

  const getArrivalsForStop = useCallback(
    (stopId: number): ArrivalPrediction[] => {
      const stop = db.stops.find((s) => s.id === stopId);
      if (!stop) return [];
      return computeStopArrivals({
        stop,
        lines: db.lines,
        lineStops: db.lineStops,
        buses: db.buses,
        trips: db.trips,
        staleSeconds: db.config.gpsStaleSeconds,
        delayToleranceMinutes: db.config.delayToleranceMinutes,
      });
    },
    [db.stops, db.lines, db.lineStops, db.buses, db.trips, db.config]
  );

  const planTrips = useCallback(
    (params: {
      origin: LatLng;
      originLabel: string;
      destination: LatLng;
      destinationLabel: string;
      accessibleOnly: boolean;
    }) => {
      return planTransitTrips({
        ...params,
        lines: db.lines,
        stops: db.stops,
        lineStops: db.lineStops,
      });
    },
    [db.lines, db.stops, db.lineStops]
  );

  const getDashboardMetrics = useCallback(
    (period: ReportPeriod = 'diario'): DashboardMetrics => {
      const multiplier = period === 'diario' ? 1 : period === 'semanal' ? 7 : 30;
      const busesInOperation = db.buses.filter((b) => b.status === 'em_operacao').length;
      const busesStopped = db.buses.filter(
        (b) => b.status === 'disponivel' || b.status === 'retirado' || b.status === 'inativo'
      ).length;
      const busesMaintenance = db.buses.filter(
        (b) => b.status === 'em_manutencao' || b.status === 'quebrado'
      ).length;
      const activeDrivers = db.drivers.filter((d) => d.status !== 'inativo').length;
      const tripsInProgress = db.trips.filter(
        (t) => t.status === 'em_andamento' || t.status === 'atrasada'
      ).length;
      const tripsCompleted =
        db.trips.filter((t) => t.status === 'concluida').length * multiplier;
      const tripsDelayed =
        db.trips.filter(
          (t) => t.status === 'atrasada' || t.delayMinutes > db.config.delayToleranceMinutes
        ).length * (period === 'diario' ? 1 : Math.max(2, Math.round(multiplier * 0.7)));
      const vehiclesOffRoute = db.buses.filter(
        (b) => b.offRoute && b.status === 'em_operacao'
      ).length;
      const openIncidents = db.incidents.filter((i) => i.status !== 'resolvida').length;

      const baseMileage = db.trips.reduce((sum, t) => sum + t.distanceKm, 0);
      const totalMileageKm = Number((baseMileage * multiplier).toFixed(1));

      const evaluated = db.trips.filter(
        (t) => t.status !== 'programada' && t.status !== 'cancelada'
      );
      const onTime = evaluated.filter(
        (t) => t.delayMinutes <= db.config.delayToleranceMinutes
      ).length;
      const punctualityRate =
        evaluated.length > 0 ? Math.round((onTime / evaluated.length) * 100) : 100;

      const lineMileage = db.lines.map((l) => {
        const lineTrips = db.trips.filter((t) => t.lineId === l.id);
        const actualKm = Number(
          (lineTrips.reduce((s, t) => s + t.distanceKm, 0) * multiplier).toFixed(1)
        );
        const plannedKm = Number(
          (Math.max(1, lineTrips.length) * l.scheduledKm * multiplier).toFixed(1)
        );
        return { code: l.code, plannedKm, actualKm };
      });

      const hourlyPunctuality =
        period === 'diario'
          ? [
              { hour: '06h', onTime: 11, delayed: 1 },
              { hour: '08h', onTime: 14, delayed: 3 },
              { hour: '10h', onTime: 12, delayed: 1 },
              { hour: '12h', onTime: 13, delayed: 2 },
              { hour: '14h', onTime: 11, delayed: 1 },
              { hour: '16h', onTime: 12, delayed: 3 },
              { hour: '18h', onTime: 10, delayed: 4 },
            ]
          : period === 'semanal'
            ? [
                { hour: 'Seg', onTime: 78, delayed: 12 },
                { hour: 'Ter', onTime: 82, delayed: 9 },
                { hour: 'Qua', onTime: 79, delayed: 11 },
                { hour: 'Qui', onTime: 80, delayed: 10 },
                { hour: 'Sex', onTime: 74, delayed: 16 },
                { hour: 'Sáb', onTime: 64, delayed: 6 },
                { hour: 'Dom', onTime: 56, delayed: 4 },
              ]
            : [
                { hour: 'Sem 1', onTime: 512, delayed: 64 },
                { hour: 'Sem 2', onTime: 528, delayed: 54 },
                { hour: 'Sem 3', onTime: 519, delayed: 61 },
                { hour: 'Sem 4', onTime: 540, delayed: 49 },
              ];

      return {
        totalBuses: db.buses.length,
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
    },
    [db, averageRating]
  );

  // ---------------- PASSENGER ACTIONS ----------------

  const addFavorite = useCallback(
    (
      targetType: FavoriteItem['targetType'],
      targetId: string,
      label: string,
      meta: Record<string, unknown> = {}
    ) => {
      setDb((prev) => {
        const exists = prev.favorites.some(
          (f) => f.targetType === targetType && f.targetId === targetId
        );
        if (exists) return prev;
        const nextId = prev.favorites.length > 0 ? Math.max(...prev.favorites.map((f) => f.id)) + 1 : 1;
        const item: FavoriteItem = {
          id: nextId,
          userId: 1,
          targetType,
          targetId,
          label,
          meta,
          createdAt: new Date().toISOString(),
        };
        return { ...prev, favorites: [item, ...prev.favorites] };
      });
    },
    []
  );

  const removeFavorite = useCallback((id: number) => {
    setDb((prev) => ({
      ...prev,
      favorites: prev.favorites.filter((f) => f.id !== id),
    }));
  }, []);

  const submitComplaint = useCallback(
    (input: {
      lineId: number | null;
      busId: number | null;
      driverName: string | null;
      category: string;
      description: string;
      attachmentName: string | null;
    }): Complaint => {
      const seq = Math.floor(1000 + Math.random() * 8999);
      const protocol = `RIO-${new Date().getFullYear()}-${seq}`;
      const nowIso = new Date().toISOString();
      const created: Complaint = {
        id: Date.now(),
        protocol,
        userId: 1,
        lineId: input.lineId,
        busId: input.busId,
        driverName: input.driverName,
        occurredAt: nowIso,
        category: input.category,
        description: input.description.trim(),
        attachmentName: input.attachmentName,
        status: 'recebida',
        resolutionNote: null,
        createdAt: nowIso,
      };
      setDb((prev) => ({
        ...prev,
        complaints: [created, ...prev.complaints],
      }));
      return created;
    },
    []
  );

  const trackComplaint = useCallback(
    (protocol: string): Complaint | null => {
      const clean = protocol.trim().toUpperCase();
      return db.complaints.find((c) => c.protocol.toUpperCase() === clean) ?? null;
    },
    [db.complaints]
  );

  const submitRating = useCallback(
    (input: {
      lineId: number;
      busId: number | null;
      serviceQuality: number;
      punctuality: number;
      vehicleCondition: number;
      cleanliness: number;
      comfort: number;
      comment: string;
    }): Rating => {
      const overall = Math.round(
        (input.serviceQuality +
          input.punctuality +
          input.vehicleCondition +
          input.cleanliness +
          input.comfort) /
          5
      );
      const created: Rating = {
        id: Date.now(),
        userId: 1,
        lineId: input.lineId,
        busId: input.busId,
        serviceQuality: input.serviceQuality,
        punctuality: input.punctuality,
        vehicleCondition: input.vehicleCondition,
        cleanliness: input.cleanliness,
        comfort: input.comfort,
        overall,
        comment: input.comment.trim(),
        createdAt: new Date().toISOString(),
      };
      setDb((prev) => ({
        ...prev,
        ratings: [created, ...prev.ratings],
      }));
      return created;
    },
    []
  );

  // ---------------- ADMIN ACTIONS ----------------

  const createBus = useCallback(
    (input: {
      unitNumber: string;
      plate: string;
      model: string;
      manufacturer: string;
      year: number;
      capacity: number;
      accessible: boolean;
    }): Bus => {
      const created: Bus = {
        id: Date.now(),
        unitNumber: input.unitNumber.trim(),
        plate: input.plate.trim().toUpperCase(),
        model: input.model.trim(),
        manufacturer: input.manufacturer.trim(),
        year: input.year,
        capacity: input.capacity,
        accessible: input.accessible,
        currentKm: 0,
        status: 'disponivel',
        trackerDeviceId: `GPS-RIO-${input.unitNumber.trim()}`,
        createdAt: new Date().toISOString(),
        lat: -22.9035,
        lng: -43.1731,
        speedKmh: 0,
        heading: 0,
        offRoute: false,
        deviationMeters: 0,
        speedExcess: false,
        lastTelemetryAt: new Date().toISOString(),
        gpsAvailable: false,
        activeLineId: null,
        activeLineCode: null,
        activeDriverName: null,
        activeTripId: null,
        activeDirection: null,
      };
      setDb((prev) => ({
        ...prev,
        buses: [...prev.buses, created],
        auditLogs: [
          {
            id: Date.now(),
            userId: 1,
            userName: 'Operador Demo',
            userRole: 'admin_geral',
            action: 'CREATE_BUS',
            entityType: 'bus',
            entityId: String(created.id),
            details: `Veículo #${created.unitNumber} (${created.plate}) cadastrado.`,
            createdAt: new Date().toISOString(),
          },
          ...prev.auditLogs,
        ],
      }));
      return created;
    },
    []
  );

  const updateBusStatus = useCallback((busId: number, status: BusStatus) => {
    setDb((prev) => ({
      ...prev,
      buses: prev.buses.map((b) =>
        b.id === busId
          ? {
              ...b,
              status,
              gpsAvailable: status === 'em_operacao' ? b.gpsAvailable : false,
            }
          : b
      ),
    }));
  }, []);

  const createDriver = useCallback(
    (input: {
      name: string;
      cpfMasked: string;
      licenseNumber: string;
      phone: string;
      assignedBusId: number | null;
      assignedLineId: number | null;
    }): Driver => {
      const created: Driver = {
        id: Date.now(),
        name: input.name.trim(),
        cpfMasked: input.cpfMasked || '***.000.000-**',
        licenseNumber: input.licenseNumber.trim(),
        phone: input.phone.trim(),
        status: 'ativo',
        assignedBusId: input.assignedBusId,
        assignedLineId: input.assignedLineId,
        createdAt: new Date().toISOString(),
      };
      setDb((prev) => ({
        ...prev,
        drivers: [created, ...prev.drivers],
      }));
      return created;
    },
    []
  );

  const toggleDriverStatus = useCallback((driverId: number) => {
    setDb((prev) => ({
      ...prev,
      drivers: prev.drivers.map((d) =>
        d.id === driverId
          ? { ...d, status: d.status === 'inativo' ? 'ativo' : 'inativo' }
          : d
      ),
    }));
  }, []);

  const saveLine = useCallback(
    (input: {
      id?: number | null;
      code: string;
      name: string;
      origin: string;
      destination: string;
      operatingHours: string;
      frequencyMin: number;
      color: string;
      accessible: boolean;
      polyline: LatLng[];
      stopIds: number[];
    }): TransitLine => {
      const nowIso = new Date().toISOString();
      const km = input.polyline.length >= 2 ? polylineLengthKm(input.polyline) : 6.5;
      const lineId = input.id || Date.now();

      let savedLine!: TransitLine;

      setDb((prev) => {
        const stopById = new Map<number, Stop>();
        for (const s of prev.stops) stopById.set(s.id, s);

        let nextLinkId =
          prev.lineStops.length > 0 ? Math.max(...prev.lineStops.map((l) => l.id)) + 1 : 1;

        const newLinksIda: LineStopLink[] = input.stopIds.map((sid, idx) => ({
          id: nextLinkId++,
          lineId,
          stopId: sid,
          sequence: idx + 1,
          direction: 'ida',
          scheduledOffsetMin: idx * 5,
          stop: stopById.get(sid),
        }));

        const newLinksVolta: LineStopLink[] = [...input.stopIds].reverse().map((sid, idx) => ({
          id: nextLinkId++,
          lineId,
          stopId: sid,
          sequence: idx + 1,
          direction: 'volta',
          scheduledOffsetMin: idx * 5,
          stop: stopById.get(sid),
        }));

        const existing = prev.lines.find((l) => l.id === input.id);
        savedLine = {
          id: lineId,
          code: input.code.trim().toUpperCase(),
          name: input.name.trim(),
          origin: input.origin.trim(),
          destination: input.destination.trim(),
          description: existing?.description ?? `Itinerário ${input.origin} ↔ ${input.destination}.`,
          operatingHours: input.operatingHours,
          operatingDays: existing?.operatingDays ?? 'Todos os dias',
          frequencyMin: input.frequencyMin,
          accessible: input.accessible,
          color: input.color,
          scheduledKm: km,
          polyline: input.polyline,
          scheduledDepartures: existing?.scheduledDepartures ?? ['08:00', '08:15', '08:30', '08:45'],
          active: true,
          createdAt: existing?.createdAt ?? nowIso,
          stops: newLinksIda.length > 0 ? newLinksIda : existing?.stops,
        };

        const filteredLines = existing
          ? prev.lines.map((l) => (l.id === lineId ? savedLine : l))
          : [...prev.lines, savedLine];

        const filteredLineStops =
          newLinksIda.length > 0
            ? [
                ...prev.lineStops.filter((ls) => ls.lineId !== lineId),
                ...newLinksIda,
                ...newLinksVolta,
              ]
            : prev.lineStops;

        return {
          ...prev,
          lines: filteredLines,
          lineStops: filteredLineStops,
        };
      });

      return savedLine;
    },
    []
  );

  const startTrip = useCallback(
    (input: {
      lineId: number;
      busId: number;
      driverId: number;
      direction: 'ida' | 'volta';
    }): Trip => {
      const now = new Date();
      const nowIso = now.toISOString();
      const line = db.lines.find((l) => l.id === input.lineId);
      const bus = db.buses.find((b) => b.id === input.busId);
      const driver = db.drivers.find((d) => d.id === input.driverId);

      const created: Trip = {
        id: Date.now(),
        lineId: input.lineId,
        busId: input.busId,
        driverId: input.driverId,
        direction: input.direction,
        scheduledDeparture: nowIso,
        actualDeparture: nowIso,
        scheduledArrival: new Date(now.getTime() + 35 * 60000).toISOString(),
        actualArrival: null,
        status: 'em_andamento',
        delayMinutes: 0,
        delayReason: null,
        distanceKm: 0,
        stopsCompleted: 0,
        stopsPlanned: line?.stops?.length ?? 6,
        lineCode: line?.code,
        lineName: line?.name,
        busUnitNumber: bus?.unitNumber,
        driverName: driver?.name,
      };

      const startPt = line?.polyline[0] ?? { lat: -22.9035, lng: -43.1731 };

      setDb((prev) => ({
        ...prev,
        trips: [created, ...prev.trips],
        buses: prev.buses.map((b) =>
          b.id === input.busId
            ? {
                ...b,
                status: 'em_operacao',
                activeLineId: input.lineId,
                activeLineCode: line?.code ?? null,
                activeDriverName: driver?.name ?? null,
                activeTripId: created.id,
                activeDirection: input.direction,
                lat: startPt.lat,
                lng: startPt.lng,
                gpsAvailable: true,
                lastTelemetryAt: nowIso,
              }
            : b
        ),
        drivers: prev.drivers.map((d) =>
          d.id === input.driverId
            ? { ...d, status: 'em_viagem', assignedBusId: input.busId, assignedLineId: input.lineId }
            : d
        ),
      }));

      return created;
    },
    [db.lines, db.buses, db.drivers]
  );

  const updateTripStatus = useCallback(
    (
      tripId: number,
      status: Trip['status'],
      delayMinutes?: number,
      delayReason?: string
    ) => {
      setDb((prev) => ({
        ...prev,
        trips: prev.trips.map((t) =>
          t.id === tripId
            ? {
                ...t,
                status,
                delayMinutes: delayMinutes ?? t.delayMinutes,
                delayReason: delayReason ?? t.delayReason,
                actualArrival: status === 'concluida' ? new Date().toISOString() : t.actualArrival,
              }
            : t
        ),
      }));
    },
    []
  );

  const updateIncidentStatus = useCallback((id: number, status: Incident['status']) => {
    setDb((prev) => ({
      ...prev,
      incidents: prev.incidents.map((inc) =>
        inc.id === id
          ? {
              ...inc,
              status,
              resolvedAt: status === 'resolvida' ? new Date().toISOString() : inc.resolvedAt,
            }
          : inc
      ),
    }));
  }, []);

  const injectSimulatedGps = useCallback(
    (input: { busId: number; lat: number; lng: number; speedKmh: number }): Bus | null => {
      let resultBus: Bus | null = null;
      const nowIso = new Date().toISOString();

      setDb((prev) => {
        const target = prev.buses.find((b) => b.id === input.busId);
        if (!target) return prev;

        const line = prev.lines.find((l) => l.id === target.activeLineId);
        const deviationMeters =
          line && line.polyline.length >= 2
            ? Math.round(distanceToPolylineMeters({ lat: input.lat, lng: input.lng }, line.polyline))
            : 0;
        const offRoute = deviationMeters > prev.config.routeDeviationMeters;
        const speedExcess = input.speedKmh > prev.config.speedLimitUrbanKmh;

        const updatedBus: Bus = {
          ...target,
          lat: input.lat,
          lng: input.lng,
          speedKmh: input.speedKmh,
          offRoute,
          deviationMeters,
          speedExcess,
          gpsAvailable: target.status === 'em_operacao',
          lastTelemetryAt: nowIso,
        };
        resultBus = updatedBus;

        const newIncidents = [...prev.incidents];
        if (offRoute) {
          const inc: Incident = {
            id: Date.now(),
            type: 'desvio_rota',
            severity: 'critica',
            busId: target.id,
            lineId: target.activeLineId ?? null,
            driverId: null,
            tripId: target.activeTripId ?? null,
            lat: input.lat,
            lng: input.lng,
            title: `Veículo #${target.unitNumber} fora da rota (${deviationMeters}m)`,
            description: `Desvio geográfico simulado a ${deviationMeters}m do itinerário.`,
            status: 'aberta',
            reportedByUserId: null,
            createdAt: nowIso,
            resolvedAt: null,
          };
          newIncidents.unshift(inc);
          setNotifications((cur) => [
            {
              id: `inj-dev-${Date.now()}`,
              type: 'desvio_rota',
              severity: 'critica',
              title: inc.title,
              timestamp: nowIso,
              lineId: target.activeLineId,
              read: false,
            },
            ...cur.slice(0, 24),
          ]);
        }

        if (speedExcess) {
          const inc: Incident = {
            id: Date.now() + 1,
            type: 'excesso_velocidade',
            severity: 'atencao',
            busId: target.id,
            lineId: target.activeLineId ?? null,
            driverId: null,
            tripId: target.activeTripId ?? null,
            lat: input.lat,
            lng: input.lng,
            title: `Excesso de velocidade — Veículo #${target.unitNumber} (${Math.round(input.speedKmh)} km/h)`,
            description: `Velocidade simulada acima do limite urbano (${prev.config.speedLimitUrbanKmh} km/h).`,
            status: 'aberta',
            reportedByUserId: null,
            createdAt: nowIso,
            resolvedAt: null,
          };
          newIncidents.unshift(inc);
        }

        const nextTelId =
          prev.telemetryHistory.length > 0
            ? prev.telemetryHistory[prev.telemetryHistory.length - 1].id + 1
            : 1;

        return {
          ...prev,
          buses: prev.buses.map((b) => (b.id === input.busId ? updatedBus : b)),
          incidents: newIncidents,
          telemetryHistory: [
            ...prev.telemetryHistory,
            {
              id: nextTelId,
              busId: target.id,
              tripId: target.activeTripId ?? null,
              lat: input.lat,
              lng: input.lng,
              speedKmh: input.speedKmh,
              heading: target.heading ?? 0,
              offRoute,
              deviationMeters,
              speedExcess,
              recordedAt: nowIso,
            },
          ],
        };
      });

      return resultBus;
    },
    []
  );

  const reportBreakdown = useCallback(
    (input: {
      busId: number;
      reason: string;
      responsible: string;
      targetStatus: 'quebrado' | 'em_manutencao' | 'retirado';
    }): number => {
      const nowIso = new Date().toISOString();
      let affected = 0;

      setDb((prev) => {
        const bus = prev.buses.find((b) => b.id === input.busId);
        const affectedTrips = prev.trips.filter(
          (t) =>
            t.busId === input.busId &&
            (t.status === 'em_andamento' || t.status === 'atrasada')
        );
        affected = affectedTrips.length;

        const log: MaintenanceLog = {
          id: Date.now(),
          busId: input.busId,
          reason: input.reason,
          responsible: input.responsible || 'Equipe Técnica',
          status: 'em_andamento',
          startedAt: nowIso,
          endedAt: null,
          authorizedByUserId: 1,
          notes: `Status alterado para ${input.targetStatus}.`,
        };

        const inc: Incident = {
          id: Date.now() + 2,
          type: 'falha_mecanica',
          severity: 'critica',
          busId: input.busId,
          lineId: bus?.activeLineId ?? null,
          driverId: null,
          tripId: null,
          lat: bus?.lat ?? null,
          lng: bus?.lng ?? null,
          title: `Manutenção / Falha — Veículo #${bus?.unitNumber ?? input.busId}`,
          description: input.reason,
          status: 'em_tratamento',
          reportedByUserId: 1,
          createdAt: nowIso,
          resolvedAt: null,
        };

        return {
          ...prev,
          buses: prev.buses.map((b) =>
            b.id === input.busId
              ? {
                  ...b,
                  status: input.targetStatus,
                  gpsAvailable: false,
                  speedKmh: 0,
                  activeLineId: null,
                  activeLineCode: null,
                  activeTripId: null,
                }
              : b
          ),
          trips: prev.trips.map((t) =>
            t.busId === input.busId && (t.status === 'em_andamento' || t.status === 'atrasada')
              ? { ...t, status: 'interrompida' }
              : t
          ),
          maintenanceLogs: [log, ...prev.maintenanceLogs],
          incidents: [inc, ...prev.incidents],
        };
      });

      return affected;
    },
    []
  );

  const completeMaintenance = useCallback((id: number) => {
    const nowIso = new Date().toISOString();
    setDb((prev) => {
      const log = prev.maintenanceLogs.find((m) => m.id === id);
      return {
        ...prev,
        maintenanceLogs: prev.maintenanceLogs.map((m) =>
          m.id === id ? { ...m, status: 'concluida', endedAt: nowIso } : m
        ),
        buses: log
          ? prev.buses.map((b) => (b.id === log.busId ? { ...b, status: 'disponivel' } : b))
          : prev.buses,
      };
    });
  }, []);

  const publishNotice = useCallback(
    (input: {
      title: string;
      category: Notice['category'];
      message: string;
      affectedLineIds: number[];
    }): Notice => {
      const nowIso = new Date().toISOString();
      const created: Notice = {
        id: Date.now(),
        title: input.title.trim(),
        category: input.category,
        message: input.message.trim(),
        affectedLineIds: input.affectedLineIds,
        startTime: nowIso,
        expectedNormalization: new Date(Date.now() + 2 * 3600000).toISOString(),
        active: true,
        createdAt: nowIso,
      };
      setDb((prev) => ({
        ...prev,
        notices: [created, ...prev.notices],
      }));
      setNotifications((cur) => [
        {
          id: `notice-${created.id}`,
          type: 'comunicado',
          severity: input.category === 'interrupcao' ? 'critica' : 'info',
          title: created.title,
          timestamp: nowIso,
          lineId: input.affectedLineIds[0] ?? null,
          read: false,
        },
        ...cur.slice(0, 24),
      ]);
      return created;
    },
    []
  );

  const updateComplaintStatus = useCallback(
    (id: number, status: Complaint['status'], resolutionNote?: string) => {
      setDb((prev) => ({
        ...prev,
        complaints: prev.complaints.map((c) =>
          c.id === id
            ? {
                ...c,
                status,
                resolutionNote: resolutionNote !== undefined ? resolutionNote : c.resolutionNote,
              }
            : c
        ),
      }));
    },
    []
  );

  const updateConfig = useCallback((patch: Partial<SystemConfig>) => {
    setDb((prev) => ({
      ...prev,
      config: { ...prev.config, ...patch },
    }));
  }, []);

  return (
    <TransitContext.Provider
      value={{
        lines: db.lines,
        stops: db.stops,
        lineStops: db.lineStops,
        buses: db.buses,
        drivers: db.drivers,
        trips: db.trips,
        stopEvents: db.stopEvents,
        incidents: db.incidents,
        maintenanceLogs: db.maintenanceLogs,
        notices: db.notices,
        complaints: db.complaints,
        ratings: db.ratings,
        favorites: db.favorites,
        frequentDestinations: db.frequentDestinations,
        telemetryHistory: db.telemetryHistory,
        auditLogs: db.auditLogs,
        config: db.config,
        averageRating,
        ratingsCount: db.ratings.length,
        loading,
        simulationRunning,
        notifications,
        getDashboardMetrics,
        getArrivalsForStop,
        planTrips,
        toggleSimulation,
        resetDemoData,
        markAllNotificationsRead,
        addFavorite,
        removeFavorite,
        submitComplaint,
        trackComplaint,
        submitRating,
        createBus,
        updateBusStatus,
        createDriver,
        toggleDriverStatus,
        saveLine,
        startTrip,
        updateTripStatus,
        updateIncidentStatus,
        injectSimulatedGps,
        reportBreakdown,
        completeMaintenance,
        publishNotice,
        updateComplaintStatus,
        updateConfig,
      }}
    >
      {children}
    </TransitContext.Provider>
  );
};

export function useTransit(): TransitContextValue {
  const ctx = useContext(TransitContext);
  if (!ctx) throw new Error('useTransit must be used inside TransitProvider');
  return ctx;
}
