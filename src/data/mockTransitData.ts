import type {
  AuditLog,
  Bus,
  Complaint,
  Driver,
  FavoriteItem,
  FrequentDestination,
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
import { polylineLengthKm } from '../services/transitGeo.ts';

export const RIO_CENTER: LatLng = { lat: -22.9122, lng: -43.2003 };

export interface MockDatabaseSnapshot {
  config: SystemConfig;
  stops: Stop[];
  lines: TransitLine[];
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
}

export function createInitialMockDatabase(): MockDatabaseSnapshot {
  const now = new Date();
  const isoNow = now.toISOString();
  const minsAgo = (m: number) => new Date(now.getTime() - m * 60000).toISOString();
  const minsAhead = (m: number) => new Date(now.getTime() + m * 60000).toISOString();

  const config: SystemConfig = {
    delayToleranceMinutes: 5,
    routeDeviationMeters: 190,
    speedLimitUrbanKmh: 60,
    speedLimitCorridorKmh: 70,
    gpsRetentionDays: 90,
    gpsStaleSeconds: 180,
    telemetryStreamEnabled: true,
  };

  // 30 Pontos de Ônibus reais na cidade do Rio de Janeiro
  const rawStops: Omit<Stop, 'id' | 'createdAt'>[] = [
    // Centro & Porto (1..7)
    { code: 'RJ-01', name: 'Terminal Praça XV', neighborhood: 'Centro', address: 'Praça XV de Novembro, s/n', lat: -22.9035, lng: -43.1731, accessible: true, shelter: true },
    { code: 'RJ-02', name: 'Igreja da Candelária / Av. Pres. Vargas', neighborhood: 'Centro', address: 'Av. Presidente Vargas, 200', lat: -22.9012, lng: -43.1788, accessible: true, shelter: true },
    { code: 'RJ-03', name: 'Central do Brasil', neighborhood: 'Centro', address: 'Praça Cristiano Ottoni, s/n', lat: -22.9041, lng: -43.1912, accessible: true, shelter: true },
    { code: 'RJ-04', name: 'Cinelândia / Teatro Municipal', neighborhood: 'Centro', address: 'Av. Rio Branco, 241', lat: -22.9107, lng: -43.1763, accessible: true, shelter: true },
    { code: 'RJ-05', name: 'Arcos da Lapa', neighborhood: 'Lapa', address: 'Av. Mem de Sá, 45', lat: -22.9134, lng: -43.1806, accessible: true, shelter: true },
    { code: 'RJ-06', name: 'Rodoviária Novo Rio', neighborhood: 'Santo Cristo', address: 'Av. Francisco Bicalho, 1', lat: -22.8994, lng: -43.2089, accessible: true, shelter: true },
    { code: 'RJ-07', name: 'Praça Mauá / Museu do Amanhã', neighborhood: 'Centro', address: 'Av. Rodrigues Alves, 10', lat: -22.8959, lng: -43.1801, accessible: true, shelter: true },

    // Zona Sul (8..20)
    { code: 'RJ-08', name: 'Metrô Glória', neighborhood: 'Glória', address: 'Rua do Catete, 36', lat: -22.9198, lng: -43.1767, accessible: true, shelter: true },
    { code: 'RJ-09', name: 'Palácio do Catete', neighborhood: 'Catete', address: 'Rua do Catete, 153', lat: -22.9258, lng: -43.1766, accessible: true, shelter: true },
    { code: 'RJ-10', name: 'Largo do Machado', neighborhood: 'Catete / Laranjeiras', address: 'Praça Largo do Machado, 20', lat: -22.9311, lng: -43.1792, accessible: true, shelter: true },
    { code: 'RJ-11', name: 'Aterro do Flamengo / Posto 2', neighborhood: 'Flamengo', address: 'Av. Infante Dom Henrique, 310', lat: -22.9345, lng: -43.1739, accessible: true, shelter: false },
    { code: 'RJ-12', name: 'Praia de Botafogo / Metrô', neighborhood: 'Botafogo', address: 'Praia de Botafogo, 340', lat: -22.9469, lng: -43.1825, accessible: true, shelter: true },
    { code: 'RJ-13', name: 'Praia Vermelha / Urca', neighborhood: 'Urca', address: 'Praça General Tibúrcio, s/n', lat: -22.9551, lng: -43.1656, accessible: true, shelter: true },
    { code: 'RJ-14', name: 'Shopping RioSul / Túnel Novo', neighborhood: 'Botafogo', address: 'Av. Lauro Sodré, 445', lat: -22.9569, lng: -43.1768, accessible: true, shelter: true },
    { code: 'RJ-15', name: 'Cardeal Arcoverde / Copacabana', neighborhood: 'Copacabana', address: 'Av. Nossa Sra. de Copacabana, 252', lat: -22.9647, lng: -43.1791, accessible: true, shelter: true },
    { code: 'RJ-16', name: 'Av. Atlântica / Siqueira Campos', neighborhood: 'Copacabana', address: 'Av. Atlântica, 2100', lat: -22.9693, lng: -43.1821, accessible: true, shelter: true },
    { code: 'RJ-17', name: 'Posto 5 / Copacabana', neighborhood: 'Copacabana', address: 'Av. Nossa Sra. de Copacabana, 1080', lat: -22.9781, lng: -43.1892, accessible: true, shelter: true },
    { code: 'RJ-18', name: 'Praça General Osório', neighborhood: 'Ipanema', address: 'Rua Visconde de Pirajá, 96', lat: -22.9847, lng: -43.1977, accessible: true, shelter: true },
    { code: 'RJ-19', name: 'Lagoa Rodrigo de Freitas / Fonte da Saudade', neighborhood: 'Lagoa', address: 'Av. Epitácio Pessoa, 1500', lat: -22.9658, lng: -43.2041, accessible: false, shelter: true },
    { code: 'RJ-20', name: 'Jardim Botânico / Parque Lage', neighborhood: 'Jardim Botânico', address: 'Rua Jardim Botânico, 414', lat: -22.9614, lng: -43.2124, accessible: true, shelter: true },

    // Grande Tijuca & Zona Norte (21..30)
    { code: 'RJ-21', name: 'Praça da Bandeira', neighborhood: 'Praça da Bandeira', address: 'Av. Presidente Vargas, 3100', lat: -22.9102, lng: -43.2145, accessible: true, shelter: true },
    { code: 'RJ-22', name: 'São Cristóvão / Quinta da Boa Vista', neighborhood: 'São Cristóvão', address: 'Av. Pedro II, 290', lat: -22.9049, lng: -43.2216, accessible: true, shelter: true },
    { code: 'RJ-23', name: 'Estádio do Maracanã / UERJ', neighborhood: 'Maracanã', address: 'Av. Maracanã, 380', lat: -22.9121, lng: -43.2298, accessible: true, shelter: true },
    { code: 'RJ-24', name: 'Metrô Afonso Pena', neighborhood: 'Tijuca', address: 'Rua Dr. Satamini, 160', lat: -22.9182, lng: -43.2185, accessible: true, shelter: true },
    { code: 'RJ-25', name: 'Metrô São Francisco Xavier', neighborhood: 'Tijuca', address: 'Rua Conde de Bonfim, 180', lat: -22.9209, lng: -43.2239, accessible: true, shelter: true },
    { code: 'RJ-26', name: 'Praça Saens Peña', neighborhood: 'Tijuca', address: 'Rua Conde de Bonfim, 360', lat: -22.9242, lng: -43.2323, accessible: true, shelter: true },
    { code: 'RJ-27', name: 'Metrô Uruguai', neighborhood: 'Tijuca', address: 'Rua Conde de Bonfim, 685', lat: -22.9317, lng: -43.2392, accessible: true, shelter: true },
    { code: 'RJ-28', name: 'Terminal Usina / Alto da Boa Vista', neighborhood: 'Usina', address: 'Rua Conde de Bonfim, 1210', lat: -22.9389, lng: -43.2496, accessible: false, shelter: true },
    { code: 'RJ-29', name: 'Boulevard 28 de Setembro / Vila Isabel', neighborhood: 'Vila Isabel', address: 'Blvd. 28 de Setembro, 280', lat: -22.9163, lng: -43.2464, accessible: true, shelter: true },
    { code: 'RJ-30', name: 'Praça Edmundo Rego / Grajaú', neighborhood: 'Grajaú', address: 'Praça Edmundo Rego, 40', lat: -22.9234, lng: -43.2582, accessible: false, shelter: false },
  ];

  const stops: Stop[] = rawStops.map((s, idx) => ({
    ...s,
    id: idx + 1,
    createdAt: isoNow,
  }));

  // 6 Linhas de ônibus no Rio de Janeiro com cores distintas e itinerários completos
  const linesSpec: {
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
    stopIds: number[];
    departures: string[];
  }[] = [
    {
      id: 1,
      code: '101',
      name: 'Centro — Copacabana (Via Aterro / Botafogo)',
      origin: 'Terminal Praça XV',
      destination: 'Posto 5 / Copacabana',
      description: 'Corredor Zona Sul ligando o Centro Histórico, Glória, Flamengo e Botafogo até Copacabana.',
      operatingHours: '05:00 - 23:50',
      operatingDays: 'Todos os dias',
      frequencyMin: 8,
      accessible: true,
      color: '#D97706',
      stopIds: [1, 4, 8, 11, 12, 14, 15, 16, 17],
      departures: ['08:00', '08:08', '08:16', '08:24', '08:32', '08:40'],
    },
    {
      id: 2,
      code: '204',
      name: 'Tijuca — Copacabana (Via Túnel Rebouças)',
      origin: 'Praça Saens Peña',
      destination: 'Praça General Osório',
      description: 'Ligação expressa entre Grande Tijuca, Lagoa, Copacabana e Ipanema pelo Túnel Rebouças.',
      operatingHours: '05:15 - 23:30',
      operatingDays: 'Todos os dias',
      frequencyMin: 10,
      accessible: true,
      color: '#2563EB',
      stopIds: [26, 25, 24, 21, 19, 17, 18],
      departures: ['08:05', '08:15', '08:25', '08:35', '08:45', '08:55'],
    },
    {
      id: 3,
      code: '309',
      name: 'Central do Brasil — Jardim Botânico',
      origin: 'Central do Brasil',
      destination: 'Jardim Botânico / Parque Lage',
      description: 'Atendimento pelo eixo Lapa, Catete, Largo do Machado, Botafogo, Lagoa e Jardim Botânico.',
      operatingHours: '05:00 - 23:40',
      operatingDays: 'Todos os dias',
      frequencyMin: 12,
      accessible: true,
      color: '#059669',
      stopIds: [3, 5, 8, 9, 10, 12, 19, 20],
      departures: ['08:00', '08:12', '08:24', '08:36', '08:48', '09:00'],
    },
    {
      id: 4,
      code: '415',
      name: 'Usina (Tijuca) — Praça XV (Via Maracanã)',
      origin: 'Terminal Usina / Alto da Boa Vista',
      destination: 'Terminal Praça XV',
      description: 'Eixo tradicional da Conde de Bonfim ligando a Tijuca ao Maracanã, Pres. Vargas e Praça XV.',
      operatingHours: '04:50 - 00:00',
      operatingDays: 'Todos os dias',
      frequencyMin: 9,
      accessible: true,
      color: '#7C3AED',
      stopIds: [28, 27, 26, 23, 21, 3, 2, 1],
      departures: ['08:02', '08:11', '08:20', '08:29', '08:38', '08:47'],
    },
    {
      id: 5,
      code: '474',
      name: 'Grajaú / São Cristóvão — Ipanema',
      origin: 'Praça Edmundo Rego / Grajaú',
      destination: 'Praça General Osório',
      description: 'Interligação Norte–Sul passando por Vila Isabel, Maracanã, São Cristóvão, Lapa e Ipanema.',
      operatingHours: '05:20 - 23:15',
      operatingDays: 'Segunda a Sábado',
      frequencyMin: 14,
      accessible: false,
      color: '#DC2626',
      stopIds: [30, 29, 23, 22, 5, 10, 15, 18],
      departures: ['08:00', '08:14', '08:28', '08:42', '08:56', '09:10'],
    },
    {
      id: 6,
      code: '584',
      name: 'Rodoviária Novo Rio — Praia Vermelha / Urca',
      origin: 'Rodoviária Novo Rio',
      destination: 'Praia Vermelha / Urca',
      description: 'Integração rodoviária e turística percorrendo Praça Mauá, Candelária, Glória, Botafogo e Urca.',
      operatingHours: '05:30 - 23:00',
      operatingDays: 'Todos os dias',
      frequencyMin: 15,
      accessible: true,
      color: '#0D9488',
      stopIds: [6, 7, 2, 4, 8, 12, 14, 13],
      departures: ['08:00', '08:15', '08:30', '08:45', '09:00', '09:15'],
    },
  ];

  const lineStops: LineStopLink[] = [];
  let linkIdCounter = 1;

  const lines: TransitLine[] = linesSpec.map((spec) => {
    const polyline: LatLng[] = spec.stopIds.map((sid) => {
      const st = stops[sid - 1];
      return { lat: st.lat, lng: st.lng };
    });

    const idaLinks: LineStopLink[] = spec.stopIds.map((sid, idx) => {
      const link: LineStopLink = {
        id: linkIdCounter++,
        lineId: spec.id,
        stopId: sid,
        sequence: idx + 1,
        direction: 'ida',
        scheduledOffsetMin: idx * 5,
        stop: stops[sid - 1],
      };
      lineStops.push(link);
      return link;
    });

    // Also include volta stop sequence
    [...spec.stopIds].reverse().forEach((sid, idx) => {
      lineStops.push({
        id: linkIdCounter++,
        lineId: spec.id,
        stopId: sid,
        sequence: idx + 1,
        direction: 'volta',
        scheduledOffsetMin: idx * 5,
        stop: stops[sid - 1],
      });
    });

    return {
      id: spec.id,
      code: spec.code,
      name: spec.name,
      origin: spec.origin,
      destination: spec.destination,
      description: spec.description,
      operatingHours: spec.operatingHours,
      operatingDays: spec.operatingDays,
      frequencyMin: spec.frequencyMin,
      accessible: spec.accessible,
      color: spec.color,
      scheduledKm: polylineLengthKm(polyline),
      polyline,
      scheduledDepartures: spec.departures,
      active: true,
      createdAt: isoNow,
      stops: idaLinks,
    };
  });

  // 8 Motoristas coerentes
  const drivers: Driver[] = [
    { id: 1, name: 'Carlos Eduardo Silva', cpfMasked: '***.412.889-**', licenseNumber: 'CNH-D 84920112', phone: '(21) 99124-3301', status: 'em_viagem', assignedBusId: 1, assignedLineId: 1, createdAt: isoNow },
    { id: 2, name: 'Mariana Oliveira Costa', cpfMasked: '***.729.104-**', licenseNumber: 'CNH-E 73819204', phone: '(21) 98451-9920', status: 'em_viagem', assignedBusId: 2, assignedLineId: 1, createdAt: isoNow },
    { id: 3, name: 'Roberto Almeida Santos', cpfMasked: '***.553.210-**', licenseNumber: 'CNH-D 62910443', phone: '(21) 97230-1184', status: 'em_viagem', assignedBusId: 3, assignedLineId: 2, createdAt: isoNow },
    { id: 4, name: 'Fernanda Souza Lima', cpfMasked: '***.881.345-**', licenseNumber: 'CNH-E 51029384', phone: '(21) 99612-7741', status: 'em_viagem', assignedBusId: 4, assignedLineId: 3, createdAt: isoNow },
    { id: 5, name: 'João Pedro Ferreira', cpfMasked: '***.194.662-**', licenseNumber: 'CNH-D 94018273', phone: '(21) 98119-5502', status: 'em_viagem', assignedBusId: 5, assignedLineId: 4, createdAt: isoNow },
    { id: 6, name: 'Luciana Mendes Pereira', cpfMasked: '***.309.771-**', licenseNumber: 'CNH-D 38291047', phone: '(21) 99344-6610', status: 'em_viagem', assignedBusId: 6, assignedLineId: 5, createdAt: isoNow },
    { id: 7, name: 'Ricardo Gomes Nogueira', cpfMasked: '***.612.408-**', licenseNumber: 'CNH-E 19283746', phone: '(21) 97511-2239', status: 'em_viagem', assignedBusId: 7, assignedLineId: 6, createdAt: isoNow },
    { id: 8, name: 'Patrícia Barbosa Rocha', cpfMasked: '***.904.115-**', licenseNumber: 'CNH-D 56473829', phone: '(21) 98802-4418', status: 'ativo', assignedBusId: 8, assignedLineId: 2, createdAt: isoNow },
  ];

  // Helper to get coordinates along a line stop index
  const stopCoord = (stopId: number): LatLng => ({
    lat: stops[stopId - 1].lat,
    lng: stops[stopId - 1].lng,
  });

  // 12 Ônibus coerentes (8 em_operacao, 2 disponivel, 1 em_manutencao, 1 quebrado)
  const buses: Bus[] = [
    {
      id: 1,
      unitNumber: '1042',
      plate: 'RIO-4A21',
      model: 'Millennium V',
      manufacturer: 'Caio',
      year: 2024,
      capacity: 82,
      accessible: true,
      currentKm: 34210.5,
      status: 'em_operacao',
      trackerDeviceId: 'GPS-RIO-1042',
      createdAt: isoNow,
      ...stopCoord(11),
      speedKmh: 34,
      heading: 175,
      offRoute: false,
      deviationMeters: 12,
      speedExcess: false,
      lastTelemetryAt: minsAgo(0.1),
      gpsAvailable: true,
      activeLineId: 1,
      activeLineCode: '101',
      activeDriverName: drivers[0].name,
      activeTripId: 1,
      activeDirection: 'ida',
    },
    {
      id: 2,
      unitNumber: '1048',
      plate: 'RIO-4A88',
      model: 'Millennium V',
      manufacturer: 'Caio',
      year: 2024,
      capacity: 82,
      accessible: true,
      currentKm: 29840.2,
      status: 'em_operacao',
      trackerDeviceId: 'GPS-RIO-1048',
      createdAt: isoNow,
      ...stopCoord(15),
      speedKmh: 21,
      heading: 15,
      offRoute: false,
      deviationMeters: 18,
      speedExcess: false,
      lastTelemetryAt: minsAgo(0.1),
      gpsAvailable: true,
      activeLineId: 1,
      activeLineCode: '101',
      activeDriverName: drivers[1].name,
      activeTripId: 2,
      activeDirection: 'volta',
    },
    {
      id: 3,
      unitNumber: '2015',
      plate: 'RJB-9B15',
      model: 'Torino S',
      manufacturer: 'Marcopolo',
      year: 2023,
      capacity: 76,
      accessible: true,
      currentKm: 51200.0,
      status: 'em_operacao',
      trackerDeviceId: 'GPS-RIO-2015',
      createdAt: isoNow,
      ...stopCoord(21),
      speedKmh: 39,
      heading: 168,
      offRoute: false,
      deviationMeters: 9,
      speedExcess: false,
      lastTelemetryAt: minsAgo(0.1),
      gpsAvailable: true,
      activeLineId: 2,
      activeLineCode: '204',
      activeDriverName: drivers[2].name,
      activeTripId: 3,
      activeDirection: 'ida',
    },
    {
      id: 4,
      unitNumber: '3021',
      plate: 'RJC-2C21',
      model: 'Apache Vip V',
      manufacturer: 'Caio',
      year: 2023,
      capacity: 80,
      accessible: true,
      currentKm: 44810.8,
      status: 'em_operacao',
      trackerDeviceId: 'GPS-RIO-3021',
      createdAt: isoNow,
      ...stopCoord(10),
      speedKmh: 29,
      heading: 190,
      offRoute: false,
      deviationMeters: 15,
      speedExcess: false,
      lastTelemetryAt: minsAgo(0.1),
      gpsAvailable: true,
      activeLineId: 3,
      activeLineCode: '309',
      activeDriverName: drivers[3].name,
      activeTripId: 4,
      activeDirection: 'ida',
    },
    {
      id: 5,
      unitNumber: '4010',
      plate: 'RJD-7D10',
      model: 'e-Bus Elétrico',
      manufacturer: 'BYD / Marcopolo',
      year: 2025,
      capacity: 86,
      accessible: true,
      currentKm: 12450.0,
      status: 'em_operacao',
      trackerDeviceId: 'GPS-RIO-4010',
      createdAt: isoNow,
      ...stopCoord(23),
      speedKmh: 36,
      heading: 108,
      offRoute: false,
      deviationMeters: 11,
      speedExcess: false,
      lastTelemetryAt: minsAgo(0.1),
      gpsAvailable: true,
      activeLineId: 4,
      activeLineCode: '415',
      activeDriverName: drivers[4].name,
      activeTripId: 5,
      activeDirection: 'ida',
    },
    {
      id: 6,
      unitNumber: '4742',
      plate: 'RJE-5E42',
      model: 'Gran Via Midi',
      manufacturer: 'Mascarello',
      year: 2021,
      capacity: 62,
      accessible: false,
      currentKm: 87320.4,
      status: 'em_operacao',
      trackerDeviceId: 'GPS-RIO-4742',
      createdAt: isoNow,
      // Intentionally slightly off-route near São Cristóvão to show live deviation alert
      lat: -22.9078,
      lng: -43.2181,
      speedKmh: 42,
      heading: 132,
      offRoute: true,
      deviationMeters: 245,
      speedExcess: false,
      lastTelemetryAt: minsAgo(0.2),
      gpsAvailable: true,
      activeLineId: 5,
      activeLineCode: '474',
      activeDriverName: drivers[5].name,
      activeTripId: 6,
      activeDirection: 'ida',
    },
    {
      id: 7,
      unitNumber: '5841',
      plate: 'RJF-8F41',
      model: 'Torino S',
      manufacturer: 'Marcopolo',
      year: 2024,
      capacity: 78,
      accessible: true,
      currentKm: 23180.6,
      status: 'em_operacao',
      trackerDeviceId: 'GPS-RIO-5841',
      createdAt: isoNow,
      ...stopCoord(12),
      speedKmh: 31,
      heading: 145,
      offRoute: false,
      deviationMeters: 8,
      speedExcess: false,
      lastTelemetryAt: minsAgo(0.1),
      gpsAvailable: true,
      activeLineId: 6,
      activeLineCode: '584',
      activeDriverName: drivers[6].name,
      activeTripId: 7,
      activeDirection: 'ida',
    },
    {
      id: 8,
      unitNumber: '2049',
      plate: 'RJB-2G49',
      model: 'e-Bus Elétrico',
      manufacturer: 'BYD / Marcopolo',
      year: 2025,
      capacity: 86,
      accessible: true,
      currentKm: 9640.0,
      status: 'em_operacao',
      trackerDeviceId: 'GPS-RIO-2049',
      createdAt: isoNow,
      ...stopCoord(17),
      speedKmh: 33,
      heading: 342,
      offRoute: false,
      deviationMeters: 10,
      speedExcess: false,
      lastTelemetryAt: minsAgo(0.1),
      gpsAvailable: true,
      activeLineId: 2,
      activeLineCode: '204',
      activeDriverName: drivers[7].name,
      activeTripId: 8,
      activeDirection: 'volta',
    },
    {
      id: 9,
      unitNumber: '1055',
      plate: 'RIO-4A55',
      model: 'Millennium V',
      manufacturer: 'Caio',
      year: 2024,
      capacity: 82,
      accessible: true,
      currentKm: 19400.0,
      status: 'disponivel',
      trackerDeviceId: 'GPS-RIO-1055',
      createdAt: isoNow,
      lat: -22.9035,
      lng: -43.1731,
      speedKmh: 0,
      heading: 0,
      offRoute: false,
      deviationMeters: 0,
      speedExcess: false,
      lastTelemetryAt: minsAgo(5),
      gpsAvailable: false,
      activeLineId: null,
      activeLineCode: null,
      activeDriverName: null,
      activeTripId: null,
      activeDirection: null,
    },
    {
      id: 10,
      unitNumber: '3092',
      plate: 'RJC-3H92',
      model: 'Apache Vip V',
      manufacturer: 'Caio',
      year: 2023,
      capacity: 80,
      accessible: true,
      currentKm: 41890.0,
      status: 'disponivel',
      trackerDeviceId: 'GPS-RIO-3092',
      createdAt: isoNow,
      lat: -22.9041,
      lng: -43.1912,
      speedKmh: 0,
      heading: 0,
      offRoute: false,
      deviationMeters: 0,
      speedExcess: false,
      lastTelemetryAt: minsAgo(8),
      gpsAvailable: false,
      activeLineId: null,
      activeLineCode: null,
      activeDriverName: null,
      activeTripId: null,
      activeDirection: null,
    },
    {
      id: 11,
      unitNumber: '3044',
      plate: 'RJC-2C44',
      model: 'Apache Vip IV',
      manufacturer: 'Caio',
      year: 2020,
      capacity: 78,
      accessible: true,
      currentKm: 112500.0,
      status: 'em_manutencao',
      trackerDeviceId: 'GPS-RIO-3044',
      createdAt: isoNow,
      lat: -22.8994,
      lng: -43.2089,
      speedKmh: 0,
      heading: 0,
      offRoute: false,
      deviationMeters: 0,
      speedExcess: false,
      lastTelemetryAt: minsAgo(140),
      gpsAvailable: false,
      activeLineId: null,
      activeLineCode: null,
      activeDriverName: null,
      activeTripId: null,
      activeDirection: null,
    },
    {
      id: 12,
      unitNumber: '4033',
      plate: 'RJD-7D33',
      model: 'Torino Express',
      manufacturer: 'Marcopolo',
      year: 2021,
      capacity: 92,
      accessible: false,
      currentKm: 95400.0,
      status: 'quebrado',
      trackerDeviceId: 'GPS-RIO-4033',
      createdAt: isoNow,
      lat: -22.9102,
      lng: -43.2145,
      speedKmh: 0,
      heading: 0,
      offRoute: false,
      deviationMeters: 0,
      speedExcess: false,
      lastTelemetryAt: minsAgo(55),
      gpsAvailable: false,
      activeLineId: null,
      activeLineCode: null,
      activeDriverName: null,
      activeTripId: null,
      activeDirection: null,
    },
  ];

  // Viagens em andamento + concluídas
  const trips: Trip[] = [
    { id: 1, lineId: 1, busId: 1, driverId: 1, direction: 'ida', scheduledDeparture: minsAgo(16), actualDeparture: minsAgo(15), scheduledArrival: minsAhead(16), actualArrival: null, status: 'em_andamento', delayMinutes: 1, delayReason: null, distanceKm: 4.1, stopsCompleted: 4, stopsPlanned: 9, lineCode: '101', lineName: lines[0].name, busUnitNumber: '1042', driverName: drivers[0].name },
    { id: 2, lineId: 1, busId: 2, driverId: 2, direction: 'volta', scheduledDeparture: minsAgo(24), actualDeparture: minsAgo(17), scheduledArrival: minsAhead(11), actualArrival: null, status: 'atrasada', delayMinutes: 7, delayReason: 'Retenção na Av. N. Sra. de Copacabana', distanceKm: 3.4, stopsCompleted: 3, stopsPlanned: 9, lineCode: '101', lineName: lines[0].name, busUnitNumber: '1048', driverName: drivers[1].name },
    { id: 3, lineId: 2, busId: 3, driverId: 3, direction: 'ida', scheduledDeparture: minsAgo(14), actualDeparture: minsAgo(14), scheduledArrival: minsAhead(22), actualArrival: null, status: 'em_andamento', delayMinutes: 0, delayReason: null, distanceKm: 3.6, stopsCompleted: 3, stopsPlanned: 7, lineCode: '204', lineName: lines[1].name, busUnitNumber: '2015', driverName: drivers[2].name },
    { id: 4, lineId: 3, busId: 4, driverId: 4, direction: 'ida', scheduledDeparture: minsAgo(18), actualDeparture: minsAgo(17), scheduledArrival: minsAhead(17), actualArrival: null, status: 'em_andamento', delayMinutes: 1, delayReason: null, distanceKm: 4.2, stopsCompleted: 4, stopsPlanned: 8, lineCode: '309', lineName: lines[2].name, busUnitNumber: '3021', driverName: drivers[3].name },
    { id: 5, lineId: 4, busId: 5, driverId: 5, direction: 'ida', scheduledDeparture: minsAgo(15), actualDeparture: minsAgo(15), scheduledArrival: minsAhead(19), actualArrival: null, status: 'em_andamento', delayMinutes: 0, delayReason: null, distanceKm: 3.9, stopsCompleted: 4, stopsPlanned: 8, lineCode: '415', lineName: lines[3].name, busUnitNumber: '4010', driverName: drivers[4].name },
    { id: 6, lineId: 5, busId: 6, driverId: 6, direction: 'ida', scheduledDeparture: minsAgo(22), actualDeparture: minsAgo(14), scheduledArrival: minsAhead(14), actualArrival: null, status: 'atrasada', delayMinutes: 8, delayReason: 'Desvio operacional na região de São Cristóvão', distanceKm: 4.8, stopsCompleted: 4, stopsPlanned: 8, lineCode: '474', lineName: lines[4].name, busUnitNumber: '4742', driverName: drivers[5].name },
    { id: 7, lineId: 6, busId: 7, driverId: 7, direction: 'ida', scheduledDeparture: minsAgo(20), actualDeparture: minsAgo(19), scheduledArrival: minsAhead(12), actualArrival: null, status: 'em_andamento', delayMinutes: 1, delayReason: null, distanceKm: 5.5, stopsCompleted: 5, stopsPlanned: 8, lineCode: '584', lineName: lines[5].name, busUnitNumber: '5841', driverName: drivers[6].name },
    { id: 8, lineId: 2, busId: 8, driverId: 8, direction: 'volta', scheduledDeparture: minsAgo(10), actualDeparture: minsAgo(10), scheduledArrival: minsAhead(26), actualArrival: null, status: 'em_andamento', delayMinutes: 0, delayReason: null, distanceKm: 2.3, stopsCompleted: 2, stopsPlanned: 7, lineCode: '204', lineName: lines[1].name, busUnitNumber: '2049', driverName: drivers[7].name },

    // Concluídas no turno
    { id: 9, lineId: 1, busId: 1, driverId: 1, direction: 'volta', scheduledDeparture: minsAgo(135), actualDeparture: minsAgo(134), scheduledArrival: minsAgo(96), actualArrival: minsAgo(95), status: 'concluida', delayMinutes: 1, delayReason: null, distanceKm: lines[0].scheduledKm, stopsCompleted: 9, stopsPlanned: 9, lineCode: '101', lineName: lines[0].name, busUnitNumber: '1042', driverName: drivers[0].name },
    { id: 10, lineId: 2, busId: 3, driverId: 3, direction: 'volta', scheduledDeparture: minsAgo(125), actualDeparture: minsAgo(118), scheduledArrival: minsAgo(84), actualArrival: minsAgo(76), status: 'concluida', delayMinutes: 8, delayReason: 'Fluxo intenso no Túnel Rebouças', distanceKm: lines[1].scheduledKm, stopsCompleted: 7, stopsPlanned: 7, lineCode: '204', lineName: lines[1].name, busUnitNumber: '2015', driverName: drivers[2].name },
    { id: 11, lineId: 3, busId: 4, driverId: 4, direction: 'volta', scheduledDeparture: minsAgo(115), actualDeparture: minsAgo(115), scheduledArrival: minsAgo(78), actualArrival: minsAgo(77), status: 'concluida', delayMinutes: 0, delayReason: null, distanceKm: lines[2].scheduledKm, stopsCompleted: 8, stopsPlanned: 8, lineCode: '309', lineName: lines[2].name, busUnitNumber: '3021', driverName: drivers[3].name },
    { id: 12, lineId: 4, busId: 5, driverId: 5, direction: 'volta', scheduledDeparture: minsAgo(160), actualDeparture: minsAgo(158), scheduledArrival: minsAgo(120), actualArrival: minsAgo(118), status: 'concluida', delayMinutes: 2, delayReason: null, distanceKm: lines[3].scheduledKm, stopsCompleted: 8, stopsPlanned: 8, lineCode: '415', lineName: lines[3].name, busUnitNumber: '4010', driverName: drivers[4].name },
  ];

  // Stop events
  const stopEvents: StopEvent[] = [
    { id: 1, tripId: 1, busId: 1, stopId: 1, stopName: 'Terminal Praça XV', scheduledTime: minsAgo(16), arrivalTime: minsAgo(15), departureTime: minsAgo(15), dwellSeconds: 42, status: 'realizada' },
    { id: 2, tripId: 1, busId: 1, stopId: 4, stopName: 'Cinelândia / Teatro Municipal', scheduledTime: minsAgo(11), arrivalTime: minsAgo(11), departureTime: minsAgo(10), dwellSeconds: 36, status: 'realizada' },
    { id: 3, tripId: 1, busId: 1, stopId: 8, stopName: 'Metrô Glória', scheduledTime: minsAgo(6), arrivalTime: minsAgo(6), departureTime: minsAgo(5), dwellSeconds: 29, status: 'realizada' },
    { id: 4, tripId: 2, busId: 2, stopId: 17, stopName: 'Posto 5 / Copacabana', scheduledTime: minsAgo(24), arrivalTime: minsAgo(17), departureTime: minsAgo(17), dwellSeconds: 58, status: 'realizada' },
    { id: 5, tripId: 5, busId: 5, stopId: 26, stopName: 'Praça Saens Peña', scheduledTime: minsAgo(7), arrivalTime: minsAgo(7), departureTime: minsAgo(6), dwellSeconds: 33, status: 'realizada' },
    { id: 6, tripId: 6, busId: 6, stopId: 22, stopName: 'São Cristóvão / Quinta da Boa Vista', scheduledTime: minsAgo(6), arrivalTime: minsAgo(4), departureTime: minsAgo(4), dwellSeconds: 45, status: 'nao_programada' },
  ];

  // Ocorrências
  const incidents: Incident[] = [
    {
      id: 1,
      type: 'desvio_rota',
      severity: 'critica',
      busId: 6,
      lineId: 5,
      driverId: 6,
      tripId: 6,
      lat: -22.9078,
      lng: -43.2181,
      title: 'Veículo #4742 fora da rota (245m)',
      description: 'Desvio temporário na região de São Cristóvão devido a interdição parcial na Av. Pedro II.',
      status: 'aberta',
      reportedByUserId: null,
      createdAt: minsAgo(6),
      resolvedAt: null,
    },
    {
      id: 2,
      type: 'atraso',
      severity: 'atencao',
      busId: 2,
      lineId: 1,
      driverId: 2,
      tripId: 2,
      lat: stopCoord(15).lat,
      lng: stopCoord(15).lng,
      title: 'Atraso de 7 min na Linha 101 — Copacabana',
      description: 'Veículo #1048 com retenção no corredor da Av. Nossa Senhora de Copacabana.',
      status: 'aberta',
      reportedByUserId: null,
      createdAt: minsAgo(9),
      resolvedAt: null,
    },
    {
      id: 3,
      type: 'falha_mecanica',
      severity: 'critica',
      busId: 12,
      lineId: 4,
      driverId: null,
      tripId: null,
      lat: stopCoord(21).lat,
      lng: stopCoord(21).lng,
      title: 'Recolhimento preventivo — Veículo #4033',
      description: 'Alerta no sistema pneumático próximo à Praça da Bandeira. Substituição acionada.',
      status: 'em_tratamento',
      reportedByUserId: null,
      createdAt: minsAgo(45),
      resolvedAt: null,
    },
  ];

  // Manutenção
  const maintenanceLogs: MaintenanceLog[] = [
    {
      id: 1,
      busId: 11,
      reason: 'Revisão preventiva de freios e elevador PCD',
      responsible: 'Garagem Central Santo Cristo',
      status: 'em_andamento',
      startedAt: minsAgo(180),
      endedAt: null,
      authorizedByUserId: null,
      notes: 'Substituição de pastilhas dianteiras e aferição da plataforma elevatória.',
    },
    {
      id: 2,
      busId: 12,
      reason: 'Diagnóstico do compressor pneumático',
      responsible: 'Equipe Técnica Norte',
      status: 'em_andamento',
      startedAt: minsAgo(45),
      endedAt: null,
      authorizedByUserId: null,
      notes: 'Aguardando troca da válvula reguladora de pressão.',
    },
  ];

  // Avisos operacionais
  const notices: Notice[] = [
    {
      id: 1,
      title: 'Desvio temporário na Linha 474 em São Cristóvão',
      category: 'desvio',
      message: 'Devido a manutenção viária na Av. Pedro II, os coletivos da linha 474 seguem pela alça da Praça da Bandeira com acréscimo médio de 6 min.',
      affectedLineIds: [5],
      startTime: minsAgo(40),
      expectedNormalization: minsAhead(150),
      active: true,
      createdAt: minsAgo(40),
    },
    {
      id: 2,
      title: 'Faixa reversível no Aterro do Flamengo e Copacabana',
      category: 'alteracao_temporaria',
      message: 'Linhas 101 e 584 operam com embarque priorizado nas baias centrais da Praia de Botafogo até as 11h.',
      affectedLineIds: [1, 6],
      startTime: minsAgo(95),
      expectedNormalization: minsAhead(90),
      active: true,
      createdAt: minsAgo(95),
    },
    {
      id: 3,
      title: 'Frota 100% elétrica e acessível na Linha 415 e 204',
      category: 'comunicado',
      message: 'Os novos ônibus elétricos #4010 e #2049 já circulam com piso baixo, ar-condicionado e rampa automatizada.',
      affectedLineIds: [2, 4],
      startTime: minsAgo(260),
      expectedNormalization: null,
      active: true,
      createdAt: minsAgo(260),
    },
    {
      id: 4,
      title: 'Interrupção parcial de parada na Lagoa (RJ-19)',
      category: 'interrupcao',
      message: 'Obras de drenagem na Av. Epitácio Pessoa deslocam temporariamente o embarque da linha 309 em 60 metros à frente.',
      affectedLineIds: [3],
      startTime: minsAgo(150),
      expectedNormalization: minsAhead(200),
      active: true,
      createdAt: minsAgo(150),
    },
  ];

  // Histórico simulado de reclamações
  const complaints: Complaint[] = [
    {
      id: 1,
      protocol: 'RIO-2026-1042',
      userId: 1,
      lineId: 1,
      busId: 2,
      driverName: 'Mariana Oliveira Costa',
      occurredAt: minsAgo(120),
      category: 'Atraso excessivo',
      description: 'Coletivo 101 demorou 12 minutos além do horário previsto no ponto Cardeal Arcoverde.',
      attachmentName: null,
      status: 'em_analise',
      resolutionNote: 'Equipe de fiscalização verificando retenção registrada na Av. N. Sra. de Copacabana.',
      createdAt: minsAgo(110),
    },
    {
      id: 2,
      protocol: 'RIO-2026-0894',
      userId: 1,
      lineId: 4,
      busId: 5,
      driverName: 'João Pedro Ferreira',
      occurredAt: minsAgo(1440),
      category: 'Acessibilidade / Rampa',
      description: 'Solicitação de verificação da sinalização tátil no ponto do Maracanã.',
      attachmentName: 'foto_ponto_maracana.jpg',
      status: 'respondida',
      resolutionNote: 'Vistoria concluída pela equipe de infraestrutura e reposição agendada para esta semana.',
      createdAt: minsAgo(1400),
    },
  ];

  // Avaliações iniciais
  const ratings: Rating[] = [
    { id: 1, userId: 1, lineId: 1, busId: 1, serviceQuality: 5, punctuality: 5, vehicleCondition: 5, cleanliness: 5, comfort: 4, overall: 5, comment: 'Previsão de chegada no Aterro bateu exatamente com o horário exibido.', createdAt: minsAgo(75) },
    { id: 2, userId: 1, lineId: 2, busId: 8, serviceQuality: 5, punctuality: 5, vehicleCondition: 5, cleanliness: 5, comfort: 5, overall: 5, comment: 'Ônibus elétrico muito silencioso e rampa PCD funcionou perfeitamente.', createdAt: minsAgo(50) },
    { id: 3, userId: 1, lineId: 5, busId: 6, serviceQuality: 4, punctuality: 3, vehicleCondition: 3, cleanliness: 4, comfort: 3, overall: 3, comment: 'Desvio em São Cristóvão aumentou um pouco o tempo até o Centro.', createdAt: minsAgo(35) },
  ];

  // Favoritos iniciais para demonstração imediata
  const favorites: FavoriteItem[] = [
    { id: 1, userId: 1, targetType: 'line', targetId: '1', label: '101 · Centro — Copacabana', meta: { code: '101', color: '#D97706' }, createdAt: minsAgo(300) },
    { id: 2, userId: 1, targetType: 'line', targetId: '2', label: '204 · Tijuca — Copacabana', meta: { code: '204', color: '#2563EB' }, createdAt: minsAgo(280) },
    { id: 3, userId: 1, targetType: 'stop', targetId: '4', label: 'Cinelândia / Teatro Municipal (RJ-04)', meta: { code: 'RJ-04' }, createdAt: minsAgo(250) },
    { id: 4, userId: 1, targetType: 'stop', targetId: '15', label: 'Cardeal Arcoverde / Copacabana (RJ-15)', meta: { code: 'RJ-15' }, createdAt: minsAgo(240) },
    { id: 5, userId: 1, targetType: 'destination', targetId: 'dest-copacabana', label: 'Copacabana — Posto 5', meta: { stopId: 17, lat: -22.9781, lng: -43.1892 }, createdAt: minsAgo(200) },
  ];

  const frequentDestinations: FrequentDestination[] = [
    { id: 'dest-copacabana', name: 'Copacabana (Posto 5)', neighborhood: 'Copacabana', stopId: 17, lat: -22.9781, lng: -43.1892, category: 'Trabalho / Lazer' },
    { id: 'dest-pracaxv', name: 'Terminal Praça XV', neighborhood: 'Centro', stopId: 1, lat: -22.9035, lng: -43.1731, category: 'Centro' },
    { id: 'dest-maracana', name: 'Estádio do Maracanã', neighborhood: 'Maracanã', stopId: 23, lat: -22.9121, lng: -43.2298, category: 'Universidade / Lazer' },
    { id: 'dest-urca', name: 'Praia Vermelha / Urca', neighborhood: 'Urca', stopId: 13, lat: -22.9551, lng: -43.1656, category: 'Lazer' },
  ];

  // Histórico de localização GPS pré-populado para cada ônibus em operação
  const telemetryHistory: TelemetryPoint[] = [];
  let telId = 1;
  for (const bus of buses) {
    if (!bus.activeLineId) continue;
    const line = lines.find((l) => l.id === bus.activeLineId);
    if (!line) continue;
    const pts = line.polyline.slice(0, Math.min(line.polyline.length, 6));
    pts.forEach((pt, idx) => {
      telemetryHistory.push({
        id: telId++,
        busId: bus.id,
        tripId: bus.activeTripId ?? null,
        lat: pt.lat,
        lng: pt.lng,
        speedKmh: 24 + ((bus.id * 5 + idx * 3) % 19),
        heading: 145,
        offRoute: bus.id === 6 && idx === pts.length - 1,
        deviationMeters: bus.id === 6 && idx === pts.length - 1 ? 245 : 11,
        speedExcess: false,
        recordedAt: minsAgo((pts.length - idx) * 2),
      });
    });
  }

  const auditLogs: AuditLog[] = [
    {
      id: 1,
      userId: 1,
      userName: 'Coordenação CCO Rio',
      userRole: 'admin_geral',
      action: 'DEMO_INIT',
      entityType: 'system',
      entityId: 'rio-mvp',
      details: 'Base demonstrativa do Rio de Janeiro inicializada com 12 ônibus, 8 motoristas, 6 linhas e 30 pontos.',
      createdAt: minsAgo(30),
    },
  ];

  return {
    config,
    stops,
    lines,
    lineStops,
    buses,
    drivers,
    trips,
    stopEvents,
    incidents,
    maintenanceLogs,
    notices,
    complaints,
    ratings,
    favorites,
    frequentDestinations,
    telemetryHistory,
    auditLogs,
  };
}
