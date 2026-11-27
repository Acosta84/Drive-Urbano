import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { jsPDF } from 'jspdf';
import {
  Activity,
  AlertTriangle,
  Bus as BusIcon,
  Clock,
  Download,
  FileText,
  History,
  Map as MapIcon,
  Megaphone,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Route as RouteIcon,
  Settings,
  Users,
  Wrench,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useTransit } from '../contexts/TransitContext.tsx';
import { RIO_CENTER } from '../data/mockTransitData.ts';
import {
  ROLE_LABELS,
  UserRole,
  type Bus,
  type BusStatus,
  type LatLng,
  type Notice,
  type ReportPeriod,
  type TransitLine,
  type UserRoleType,
} from '../shared/types.ts';
import {
  FleetDistributionChart,
  MileageComparisonChart,
  PunctualityChart,
} from './Charts.tsx';
import { TransitMap } from './TransitMap.tsx';

type AdminSection =
  | 'dashboard'
  | 'monitoring'
  | 'fleet'
  | 'drivers'
  | 'lines'
  | 'trips'
  | 'incidents'
  | 'history'
  | 'maintenance'
  | 'notices_complaints'
  | 'reports'
  | 'config';

const BUS_STATUS_LABELS: Record<BusStatus, string> = {
  disponivel: 'Disponível',
  em_operacao: 'Em operação',
  em_manutencao: 'Em manutenção',
  quebrado: 'Quebrado',
  retirado: 'Retirado',
  inativo: 'Inativo',
};

const PERIOD_LABELS: Record<ReportPeriod, string> = {
  diario: 'Diário',
  semanal: 'Semanal',
  mensal: 'Mensal',
};

export const AdminPanel: React.FC<{ onSwitchToPassenger: () => void }> = ({
  onSwitchToPassenger,
}) => {
  const { user, adminDemoRole, setAdminDemoRole, can } = useAuth();
  const {
    lines,
    stops,
    buses,
    drivers,
    trips,
    stopEvents,
    incidents,
    maintenanceLogs,
    notices,
    complaints,
    telemetryHistory,
    auditLogs,
    config,
    simulationRunning,
    getDashboardMetrics,
    toggleSimulation,
    resetDemoData,
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
  } = useTransit();

  const [section, setSection] = useState<AdminSection>('dashboard');
  const [reportPeriod, setReportPeriod] = useState<ReportPeriod>('diario');
  const [toast, setToast] = useState<string | null>(null);

  // Monitoring & GPS Simulator
  const [selectedBusId, setSelectedBusId] = useState<number | null>(null);
  const [gpsBusId, setGpsBusId] = useState<string>('1');
  const [gpsLat, setGpsLat] = useState<string>(String(RIO_CENTER.lat));
  const [gpsLng, setGpsLng] = useState<string>(String(RIO_CENTER.lng));
  const [gpsSpeed, setGpsSpeed] = useState<string>('38');

  // Fleet Form
  const [busFilter, setBusFilter] = useState<string>('todos');
  const [newBusUnit, setNewBusUnit] = useState('');
  const [newBusPlate, setNewBusPlate] = useState('');
  const [newBusModel, setNewBusModel] = useState('Marcopolo Torino');
  const [newBusMaker, setNewBusMaker] = useState('Mercedes-Benz');
  const [newBusYear, setNewBusYear] = useState('2025');
  const [newBusCap, setNewBusCap] = useState('82');
  const [newBusAcc, setNewBusAcc] = useState(true);

  // Driver Form
  const [drvName, setDrvName] = useState('');
  const [drvCpf, setDrvCpf] = useState('***.458.912-**');
  const [drvLic, setDrvLic] = useState('');
  const [drvPhone, setDrvPhone] = useState('(21) 99');
  const [drvBusId, setDrvBusId] = useState('');
  const [drvLineId, setDrvLineId] = useState('');

  // Line & Itinerary Map Editor
  const [editingLineId, setEditingLineId] = useState<number | null>(null);
  const [lineCode, setLineCode] = useState('');
  const [lineName, setLineName] = useState('');
  const [lineOrigin, setLineOrigin] = useState('');
  const [lineDest, setLineDest] = useState('');
  const [lineHours, setLineHours] = useState('05:00 - 23:30');
  const [lineFreq, setLineFreq] = useState('12');
  const [lineColor, setLineColor] = useState('#D97706');
  const [lineAcc, setLineAcc] = useState(true);
  const [lineVertices, setLineVertices] = useState<LatLng[]>([]);
  const [lineStopIds, setLineStopIds] = useState<number[]>([]);

  // Trips & Delays
  const [tripLineId, setTripLineId] = useState('1');
  const [tripBusId, setTripBusId] = useState('8');
  const [tripDriverId, setTripDriverId] = useState('1');
  const [tripDir, setTripDir] = useState<'ida' | 'volta'>('ida');
  const [delayModalTripId, setDelayModalTripId] = useState<number | null>(null);
  const [delayMinutesInput, setDelayMinutesInput] = useState('12');
  const [delayReasonInput, setDelayReasonInput] = useState('Tráfego intenso na Av. Brasil');

  // Incidents filter
  const [incidentFilter, setIncidentFilter] = useState<string>('todos');

  // GPS History Playback
  const [histBusId, setHistBusId] = useState<string>('1');
  const [histIdx, setHistIdx] = useState<number>(0);
  const [histPlaying, setHistPlaying] = useState<boolean>(false);

  // Maintenance / Breakdown
  const [brkBusId, setBrkBusId] = useState('1');
  const [brkReason, setBrkReason] = useState('');
  const [brkResponsible, setBrkResponsible] = useState('Oficina Central São Cristóvão');
  const [brkStatus, setBrkStatus] = useState<'quebrado' | 'em_manutencao' | 'retirado'>(
    'em_manutencao'
  );

  // Notices & Complaints
  const [noticeTitle, setNoticeTitle] = useState('');
  const [noticeCategory, setNoticeCategory] = useState<Notice['category']>('operacional');
  const [noticeMessage, setNoticeMessage] = useState('');
  const [noticeLineId, setNoticeLineId] = useState('');
  const [compNotes, setCompNotes] = useState<Record<number, string>>({});

  // Reports
  const [reportType, setReportType] = useState('viagens');
  const [reportLineId, setReportLineId] = useState('');

  // Config draft
  const [configDraft, setConfigDraft] = useState(config);
  useEffect(() => {
    setConfigDraft(config);
  }, [config]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 4000);
  }, []);

  const metrics = useMemo(
    () => getDashboardMetrics(reportPeriod),
    [getDashboardMetrics, reportPeriod]
  );

  const selectedBus = useMemo(
    () => buses.find((b) => b.id === selectedBusId) ?? buses[0] ?? null,
    [buses, selectedBusId]
  );

  // Filtered GPS History points for selected bus
  const histPoints = useMemo(() => {
    const bId = Number(histBusId);
    return telemetryHistory.filter((t) => t.busId === bId);
  }, [telemetryHistory, histBusId]);

  useEffect(() => {
    setHistIdx(Math.max(0, histPoints.length - 1));
    setHistPlaying(false);
  }, [histBusId]);

  useEffect(() => {
    if (!histPlaying || histPoints.length === 0) return;
    const t = window.setInterval(() => {
      setHistIdx((prev) => {
        if (prev + 1 >= histPoints.length) {
          setHistPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, 550);
    return () => window.clearInterval(t);
  }, [histPlaying, histPoints.length]);

  // Actions
  const handleSendGpsPacket = (
    overrideLat?: number,
    overrideLng?: number,
    overrideSpeed?: number
  ) => {
    const bus = injectSimulatedGps({
      busId: Number(gpsBusId),
      lat: overrideLat ?? Number(gpsLat),
      lng: overrideLng ?? Number(gpsLng),
      speedKmh: overrideSpeed ?? Number(gpsSpeed),
    });
    if (bus) {
      showToast(
        `Telemetria atualizada para #${bus.unitNumber}: ${Math.round(bus.speedKmh ?? 0)} km/h${
          bus.offRoute ? ` (Desvio ${bus.deviationMeters}m!)` : ''
        }`
      );
    }
  };

  const handleSimulateDeviation = () => {
    const target = buses.find((b) => b.id === Number(gpsBusId)) ?? buses[0];
    if (!target || target.lat == null || target.lng == null) return;
    const devLat = Number((target.lat + 0.0055).toFixed(6));
    const devLng = Number((target.lng - 0.0052).toFixed(6));
    setGpsLat(String(devLat));
    setGpsLng(String(devLng));
    handleSendGpsPacket(devLat, devLng, 44);
  };

  const handleSimulateSpeedExcess = () => {
    const target = buses.find((b) => b.id === Number(gpsBusId)) ?? buses[0];
    if (!target || target.lat == null || target.lng == null) return;
    setGpsSpeed('76');
    handleSendGpsPacket(target.lat, target.lng, 76);
  };

  const handleCreateBus = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBusUnit.trim() || !newBusPlate.trim()) return;
    const created = createBus({
      unitNumber: newBusUnit,
      plate: newBusPlate,
      model: newBusModel,
      manufacturer: newBusMaker,
      year: Number(newBusYear) || 2025,
      capacity: Number(newBusCap) || 80,
      accessible: newBusAcc,
    });
    setNewBusUnit('');
    setNewBusPlate('');
    showToast(`Veículo #${created.unitNumber} cadastrado na frota demonstrativa.`);
  };

  const handleCreateDriver = (e: React.FormEvent) => {
    e.preventDefault();
    if (!drvName.trim() || !drvLic.trim()) return;
    const created = createDriver({
      name: drvName,
      cpfMasked: drvCpf,
      licenseNumber: drvLic,
      phone: drvPhone,
      assignedBusId: drvBusId ? Number(drvBusId) : null,
      assignedLineId: drvLineId ? Number(drvLineId) : null,
    });
    setDrvName('');
    setDrvLic('');
    showToast(`Motorista ${created.name} cadastrado.`);
  };

  const loadLineIntoEditor = (line: TransitLine) => {
    setEditingLineId(line.id);
    setLineCode(line.code);
    setLineName(line.name);
    setLineOrigin(line.origin);
    setLineDest(line.destination);
    setLineHours(line.operatingHours);
    setLineFreq(String(line.frequencyMin));
    setLineColor(line.color);
    setLineAcc(line.accessible);
    setLineVertices(line.polyline);
    setLineStopIds((line.stops ?? []).map((s) => s.stopId));
  };

  const handleSaveLine = (e: React.FormEvent) => {
    e.preventDefault();
    if (!lineCode.trim() || !lineName.trim()) return;
    const saved = saveLine({
      id: editingLineId,
      code: lineCode,
      name: lineName,
      origin: lineOrigin || 'Centro',
      destination: lineDest || 'Zona Sul',
      operatingHours: lineHours,
      frequencyMin: Number(lineFreq) || 12,
      color: lineColor,
      accessible: lineAcc,
      polyline: lineVertices.length >= 2 ? lineVertices : [RIO_CENTER, { lat: -22.9242, lng: -43.2323 }],
      stopIds: lineStopIds.length > 0 ? lineStopIds : [1, 4, 12],
    });
    setEditingLineId(null);
    setLineCode('');
    setLineName('');
    setLineOrigin('');
    setLineDest('');
    setLineVertices([]);
    setLineStopIds([]);
    showToast(`Linha ${saved.code} e itinerário atualizados.`);
  };

  const handleStartTrip = (e: React.FormEvent) => {
    e.preventDefault();
    const created = startTrip({
      lineId: Number(tripLineId),
      busId: Number(tripBusId),
      driverId: Number(tripDriverId),
      direction: tripDir,
    });
    showToast(`Viagem #${created.id} iniciada na Linha ${created.lineCode}.`);
  };

  const handleReportBreakdown = (e: React.FormEvent) => {
    e.preventDefault();
    if (!brkReason.trim()) return;
    const affected = reportBreakdown({
      busId: Number(brkBusId),
      reason: brkReason,
      responsible: brkResponsible,
      targetStatus: brkStatus,
    });
    setBrkReason('');
    showToast(`Manutenção registrada. ${affected} viagem(ns) interrompida(s).`);
  };

  const handleCreateNotice = (e: React.FormEvent) => {
    e.preventDefault();
    if (!noticeTitle.trim() || !noticeMessage.trim()) return;
    publishNotice({
      title: noticeTitle,
      category: noticeCategory,
      message: noticeMessage,
      affectedLineIds: noticeLineId ? [Number(noticeLineId)] : [],
    });
    setNoticeTitle('');
    setNoticeMessage('');
    showToast('Comunicado publicado no aplicativo dos passageiros.');
  };

  // Report Rows Builder (supports Diário / Semanal / Mensal)
  const filteredReportRows = useMemo(() => {
    const lineNum = reportLineId ? Number(reportLineId) : null;
    const mult = reportPeriod === 'diario' ? 1 : reportPeriod === 'semanal' ? 7 : 30;

    if (reportType === 'atrasos') {
      return trips
        .filter((t) => (!lineNum || t.lineId === lineNum) && t.delayMinutes > 0)
        .map((t) => ({
          Periodo: PERIOD_LABELS[reportPeriod],
          Linha: t.lineCode || '',
          Veiculo: `#${t.busUnitNumber || ''}`,
          Motorista: t.driverName || '',
          AtrasoMin: t.delayMinutes,
          Motivo: t.delayReason || 'Tráfego urbano',
          Status: t.status,
        }));
    }

    if (reportType === 'ocorrencias' || reportType === 'desvios' || reportType === 'velocidade') {
      return incidents
        .filter((i) => {
          if (lineNum && i.lineId !== lineNum) return false;
          if (reportType === 'desvios') return i.type === 'desvio_rota';
          if (reportType === 'velocidade') return i.type === 'excesso_velocidade';
          return true;
        })
        .map((i) => ({
          Periodo: PERIOD_LABELS[reportPeriod],
          Tipo: i.type,
          Severidade: i.severity,
          Ocorrencia: i.title,
          Status: i.status,
          Horario: new Date(i.createdAt).toLocaleString('pt-BR'),
        }));
    }

    if (reportType === 'quilometragem' || reportType === 'frota') {
      return buses.map((b) => ({
        Periodo: PERIOD_LABELS[reportPeriod],
        Unidade: `#${b.unitNumber}`,
        Placa: b.plate,
        Modelo: b.model,
        LinhaAtiva: b.activeLineCode || 'Garagem',
        KmEstimadoPeriodo: (
          (b.status === 'em_operacao' ? 142 : 48) * mult +
          b.currentKm * 0.01
        ).toFixed(1),
        Status: BUS_STATUS_LABELS[b.status],
      }));
    }

    return trips
      .filter((t) => !lineNum || t.lineId === lineNum)
      .map((t) => ({
        Periodo: PERIOD_LABELS[reportPeriod],
        Linha: t.lineCode || '',
        Veiculo: `#${t.busUnitNumber || ''}`,
        Motorista: t.driverName || '',
        DistanciaKm: (t.distanceKm * mult).toFixed(1),
        AtrasoMin: t.delayMinutes,
        Status: t.status,
      }));
  }, [reportType, reportLineId, reportPeriod, trips, incidents, buses]);

  const exportCsv = () => {
    if (filteredReportRows.length === 0) {
      showToast('Nenhum dado disponível para exportar neste filtro.');
      return;
    }
    const headers = Object.keys(filteredReportRows[0]);
    const csvLines = [
      headers.join(';'),
      ...filteredReportRows.map((row) =>
        headers
          .map((h) => `"${String((row as Record<string, unknown>)[h] ?? '').replaceAll('"', '""')}"`)
          .join(';')
      ),
    ];
    const blob = new Blob(['\uFEFF' + csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mobilicidade-${reportType}-${reportPeriod}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Arquivo CSV exportado.');
  };

  const exportPdf = () => {
    const doc = new jsPDF({ orientation: 'landscape' });
    doc.setFontSize(14);
    doc.text(
      `MobiliCidade Rio — Relatório ${PERIOD_LABELS[reportPeriod]} (${reportType.toUpperCase()})`,
      14,
      18
    );
    doc.setFontSize(9);
    doc.text(
      `Modo Demonstração · Gerado em ${new Date().toLocaleString('pt-BR')} · Perfil: ${ROLE_LABELS[adminDemoRole]}`,
      14,
      25
    );

    let y = 35;
    if (filteredReportRows.length === 0) {
      doc.text('Nenhum registro encontrado para os filtros selecionados.', 14, y);
    } else {
      const headers = Object.keys(filteredReportRows[0]);
      doc.setFont('helvetica', 'bold');
      doc.text(headers.join(' | '), 14, y);
      y += 7;
      doc.setFont('helvetica', 'normal');
      for (const row of filteredReportRows.slice(0, 28)) {
        const lineText = headers
          .map((h) => String((row as Record<string, unknown>)[h] ?? '').slice(0, 26))
          .join(' | ');
        doc.text(lineText, 14, y);
        y += 6;
        if (y > 190) {
          doc.addPage();
          y = 20;
        }
      }
    }
    doc.save(`mobilicidade-${reportType}-${reportPeriod}.pdf`);
    showToast('Arquivo PDF exportado.');
  };

  const navItems: {
    id: AdminSection;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    visible: boolean;
  }[] = [
    { id: 'dashboard', label: 'Dashboard Operacional', icon: Activity, visible: can('dashboard:view') },
    { id: 'monitoring', label: 'Mapa da Frota (OSM)', icon: MapIcon, visible: can('monitoring:view') },
    { id: 'fleet', label: 'Frota de Ônibus', icon: BusIcon, visible: can('fleet:manage') || can('monitoring:view') },
    { id: 'drivers', label: 'Motoristas', icon: Users, visible: can('drivers:manage') || can('monitoring:view') },
    { id: 'lines', label: 'Linhas e Itinerários', icon: RouteIcon, visible: can('lines:manage') || can('monitoring:view') },
    { id: 'trips', label: 'Viagens, Atrasos e Paradas', icon: Clock, visible: can('trips:manage') || can('monitoring:view') },
    { id: 'incidents', label: 'Ocorrências e Velocidade', icon: AlertTriangle, visible: can('incidents:manage') || can('monitoring:view') },
    { id: 'history', label: 'Histórico GPS', icon: History, visible: can('monitoring:view') },
    { id: 'maintenance', label: 'Manutenção e Falhas', icon: Wrench, visible: can('maintenance:manage') || can('monitoring:view') },
    { id: 'notices_complaints', label: 'Avisos e Reclamações', icon: Megaphone, visible: can('notices:manage') || can('complaints:manage') },
    { id: 'reports', label: 'Relatórios (D/S/M)', icon: FileText, visible: can('reports:view') },
    { id: 'config', label: 'Configurações e Auditoria', icon: Settings, visible: can('config:manage') || can('audit:view') },
  ];

  const visibleNav = navItems.filter((n) => n.visible);
  const filteredBuses =
    busFilter === 'todos' ? buses : buses.filter((b) => b.status === busFilter);
  const filteredIncidents =
    incidentFilter === 'todos' ? incidents : incidents.filter((i) => i.type === incidentFilter);

  const currentPlaybackPoint = histPoints[histIdx] ?? null;

  return (
    <div className="min-h-screen bg-[#F3EBDD] text-[#292D26] flex flex-col lg:flex-row">
      {/* Sidebar */}
      <aside className="w-full lg:w-[272px] shrink-0 border-b lg:border-b-0 lg:border-r border-[#292D26]/12 bg-[#FFFDF8] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#292D26]/10">
          <div>
            <span className="font-display text-lg font-bold tracking-tight text-[#292D26] block">
              MobiliCidade Rio
            </span>
            <span className="text-[11px] font-medium text-[#74766C]">
              Painel Gestor · Demonstração
            </span>
          </div>
          <button
            type="button"
            onClick={onSwitchToPassenger}
            className="rounded-xl bg-[#E8C547] px-3 py-1.5 text-xs font-bold text-[#292D26] whitespace-nowrap shrink-0 hover:bg-[#E8C547]/85 cursor-pointer"
          >
            App Passageiro
          </button>
        </div>

        {/* Demo Role Switcher & Simulation Controls */}
        <div className="px-4 py-3 border-b border-[#292D26]/10 bg-[#F3EBDD]/45 space-y-2">
          <div>
            <label className="block text-[11px] font-semibold text-[#74766C] mb-1">
              Perfil de demonstração ({user.name})
            </label>
            <select
              value={adminDemoRole}
              onChange={(e) => setAdminDemoRole(e.target.value as UserRoleType)}
              className="h-9 w-full rounded-xl border border-[#292D26]/15 bg-[#FFFDF8] px-2.5 text-xs font-semibold text-[#292D26]"
            >
              {(Object.keys(ROLE_LABELS) as UserRoleType[])
                .filter((r) => r !== UserRole.PASSAGEIRO)
                .map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
            </select>
          </div>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={toggleSimulation}
              className="flex-1 inline-flex h-8 items-center justify-center gap-1.5 rounded-xl border border-[#292D26]/12 bg-[#FFFDF8] text-[11px] font-bold text-[#292D26] hover:bg-[#E8C547]/25 cursor-pointer"
            >
              {simulationRunning ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
              {simulationRunning ? 'Pausar frota' : 'Simular frota'}
            </button>
            <button
              type="button"
              onClick={() => {
                resetDemoData();
                showToast('Base demonstrativa restaurada ao estado inicial.');
              }}
              className="inline-flex h-8 items-center justify-center gap-1 rounded-xl border border-[#292D26]/12 bg-[#FFFDF8] px-2.5 text-[11px] font-semibold text-[#74766C] hover:text-[#292D26] cursor-pointer"
              title="Restaurar dados demonstrativos"
            >
              <RotateCcw className="h-3 w-3" />
              Reset
            </button>
          </div>
        </div>

        <nav className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-y-auto p-3 flex-1">
          {visibleNav.map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  active
                    ? 'bg-[#E8C547] text-[#292D26]'
                    : 'text-[#74766C] hover:bg-[#F3EBDD] hover:text-[#292D26]'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-w-0 p-4 sm:p-6 space-y-5 overflow-x-hidden">
        {toast && (
          <div className="flex items-center justify-between rounded-xl border border-[#292D26]/15 bg-[#A8D929]/40 px-4 py-2.5 text-sm font-medium text-[#292D26]">
            <span>{toast}</span>
            <button
              type="button"
              onClick={() => setToast(null)}
              className="text-xs underline ml-4 cursor-pointer"
            >
              Fechar
            </button>
          </div>
        )}

        {/* 1. DASHBOARD OPERACIONAL */}
        {section === 'dashboard' && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-2xl font-bold text-[#292D26]">Dashboard Operacional</h1>
                <p className="text-xs text-[#74766C]">
                  Operação simulada no Rio de Janeiro · 12 veículos, 8 motoristas, 6 linhas e 30 pontos
                </p>
              </div>

              {/* Period Switcher: Diário / Semanal / Mensal */}
              <div className="flex items-center gap-1 rounded-xl border border-[#292D26]/12 bg-[#FFFDF8] p-1">
                {(['diario', 'semanal', 'mensal'] as ReportPeriod[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setReportPeriod(p)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold cursor-pointer transition-colors ${
                      reportPeriod === p
                        ? 'bg-[#E8C547] text-[#292D26]'
                        : 'text-[#74766C] hover:text-[#292D26]'
                    }`}
                  >
                    {PERIOD_LABELS[p]}
                  </button>
                ))}
              </div>
            </div>

            {/* 12 Operational KPIs */}
            <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
              {[
                ['Ônibus cadastrados', metrics.totalBuses, 'frota total', 'ok'],
                ['Em operação', metrics.busesInOperation, 'circulando no mapa', 'ok'],
                ['Disponíveis / Pátio', metrics.busesStopped, 'prontos para escala', 'ok'],
                ['Em manutenção / Falha', metrics.busesMaintenance, 'oficina ou avaria', metrics.busesMaintenance > 0 ? 'warn' : 'ok'],
                ['Motoristas ativos', metrics.activeDrivers, 'escalados na operação', 'ok'],
                ['Viagens em andamento', metrics.tripsInProgress, 'rotas monitoradas', 'ok'],
                [`Viagens concluídas (${PERIOD_LABELS[reportPeriod]})`, metrics.tripsCompleted, 'acumulado do período', 'ok'],
                [`Viagens atrasadas (${PERIOD_LABELS[reportPeriod]})`, metrics.tripsDelayed, 'acima da tolerância', metrics.tripsDelayed > 0 ? 'warn' : 'ok'],
                ['Veículos fora da rota', metrics.vehiclesOffRoute, 'desvio detectado', metrics.vehiclesOffRoute > 0 ? 'crit' : 'ok'],
                ['Ocorrências abertas', metrics.openIncidents, 'aguardando tratativa', metrics.openIncidents > 0 ? 'warn' : 'ok'],
                [`Quilometragem (${PERIOD_LABELS[reportPeriod]})`, `${metrics.totalMileageKm.toFixed(1)} km`, 'percorrida pela frota', 'ok'],
                ['Índice de pontualidade', `${metrics.punctualityRate}%`, `Nota média ${metrics.averageRating}/5`, 'ok'],
              ].map(([label, val, sub, tone]) => (
                <div
                  key={String(label)}
                  className="rounded-2xl border border-[#292D26]/10 bg-[#FFFDF8] p-4 shadow-sm"
                >
                  <p className="text-xs font-medium text-[#74766C]">{label}</p>
                  <p
                    className={`mt-1 font-mono text-2xl font-bold tabular-nums ${
                      tone === 'crit'
                        ? 'text-[#D9534F]'
                        : tone === 'warn'
                          ? 'text-[#E99A36]'
                          : 'text-[#292D26]'
                    }`}
                  >
                    {val}
                  </p>
                  <p className="text-[11px] text-[#74766C] mt-0.5">{sub}</p>
                </div>
              ))}
            </div>

            {/* Charts */}
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-2xl border border-[#292D26]/10 bg-[#FFFDF8] p-5 shadow-sm space-y-3">
                <h2 className="text-sm font-bold text-[#292D26]">
                  Pontualidade ({PERIOD_LABELS[reportPeriod]})
                </h2>
                <PunctualityChart data={metrics.hourlyPunctuality} />
              </div>
              <div className="rounded-2xl border border-[#292D26]/10 bg-[#FFFDF8] p-5 shadow-sm space-y-3">
                <h2 className="text-sm font-bold text-[#292D26]">
                  Quilometragem Programada vs. Realizada
                </h2>
                <MileageComparisonChart data={metrics.lineMileage} />
              </div>
              <div className="rounded-2xl border border-[#292D26]/10 bg-[#FFFDF8] p-5 shadow-sm space-y-3">
                <h2 className="text-sm font-bold text-[#292D26]">Distribuição da Frota</h2>
                <FleetDistributionChart buses={buses} />
                <div className="pt-2 border-t border-[#292D26]/10 space-y-1.5">
                  <p className="text-xs font-semibold text-[#74766C]">Alertas recentes</p>
                  {incidents.slice(0, 2).map((inc) => (
                    <div
                      key={inc.id}
                      className="rounded-xl bg-[#F3EBDD]/60 px-3 py-2 text-xs flex items-center justify-between gap-2"
                    >
                      <span className="font-medium text-[#292D26] truncate">{inc.title}</span>
                      <span className="font-mono text-[10px] uppercase text-[#74766C] shrink-0">
                        {inc.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 2. MAPA DA FROTA (OPENSTREETMAP) */}
        {section === 'monitoring' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-xl font-bold text-[#292D26]">
                  Mapa Operacional da Frota — Rio de Janeiro
                </h1>
                <p className="text-xs text-[#74766C]">
                  Clique em um veículo no mapa para inspecionar telemetria ou simule desvios e velocidade.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <span className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded bg-[#E8C547] border border-[#292D26]" /> Em operação
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded bg-[#D9534F] border border-[#292D26]" /> Fora da rota
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded bg-[#E99A36] border border-[#292D26]" /> Excesso velocidade
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded bg-[#74766C] border border-[#292D26]" /> Pátio / Manutenção
                </span>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-12 items-start">
              <div className="xl:col-span-8">
                <TransitMap
                  center={RIO_CENTER}
                  zoom={13}
                  lines={lines}
                  stops={stops}
                  buses={buses}
                  selectedBusId={selectedBus?.id}
                  onSelectBus={(b: Bus) => {
                    setSelectedBusId(b.id);
                    setGpsBusId(String(b.id));
                    if (b.lat != null && b.lng != null) {
                      setGpsLat(String(b.lat));
                      setGpsLng(String(b.lng));
                    }
                  }}
                  onMapClick={(pos) => {
                    setGpsLat(String(pos.lat));
                    setGpsLng(String(pos.lng));
                  }}
                  className="h-[490px] w-full shadow-sm"
                />
              </div>

              <div className="xl:col-span-4 space-y-4">
                {selectedBus && (
                  <div className="rounded-2xl border border-[#292D26]/12 bg-[#FFFDF8] p-4 shadow-sm space-y-2.5">
                    <div className="flex items-center justify-between">
                      <h2 className="text-base font-bold text-[#292D26]">
                        Veículo #{selectedBus.unitNumber} · {selectedBus.plate}
                      </h2>
                      <span className="rounded-md bg-[#F3EBDD] px-2 py-0.5 text-[11px] font-semibold">
                        {BUS_STATUS_LABELS[selectedBus.status]}
                      </span>
                    </div>
                    <p className="text-xs text-[#74766C]">
                      Linha: <strong>{selectedBus.activeLineCode || 'Garagem'}</strong> ·
                      Motorista: <strong>{selectedBus.activeDriverName || 'Não escalado'}</strong>
                    </p>
                    <div className="grid grid-cols-2 gap-2 font-mono text-xs tabular-nums">
                      <div className="rounded-xl bg-[#F3EBDD] p-2.5">
                        Velocidade: <strong>{Math.round(selectedBus.speedKmh ?? 0)} km/h</strong>
                      </div>
                      <div className="rounded-xl bg-[#F3EBDD] p-2.5">
                        Desvio:{' '}
                        <strong className={selectedBus.offRoute ? 'text-[#D9534F]' : ''}>
                          {selectedBus.deviationMeters ?? 0} m
                        </strong>
                      </div>
                      <div className="rounded-xl bg-[#F3EBDD] p-2.5">
                        Odômetro: <strong>{selectedBus.currentKm.toLocaleString('pt-BR')} km</strong>
                      </div>
                      <div className="rounded-xl bg-[#F3EBDD] p-2.5">
                        {selectedBus.offRoute ? 'FORA DA ROTA' : 'No itinerário'}
                      </div>
                    </div>
                  </div>
                )}

                <div className="rounded-2xl border border-[#292D26]/12 bg-[#FFFDF8] p-4 shadow-sm space-y-3">
                  <h2 className="text-sm font-bold text-[#292D26]">
                    Simulador de Telemetria GPS
                  </h2>
                  <p className="text-[11px] text-[#74766C]">
                    Clique no mapa para capturar coordenadas ou teste alertas operacionais em tempo real.
                  </p>
                  <select
                    value={gpsBusId}
                    onChange={(e) => setGpsBusId(e.target.value)}
                    className="h-9 w-full rounded-xl border border-[#292D26]/15 bg-[#F3EBDD]/60 px-2.5 text-xs"
                  >
                    {buses.map((b) => (
                      <option key={b.id} value={b.id}>
                        #{b.unitNumber} · Linha {b.activeLineCode || 'Garagem'} ({BUS_STATUS_LABELS[b.status]})
                      </option>
                    ))}
                  </select>
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      type="text"
                      value={gpsLat}
                      onChange={(e) => setGpsLat(e.target.value)}
                      className="h-9 rounded-xl border border-[#292D26]/15 bg-[#F3EBDD]/60 px-2 font-mono text-xs"
                    />
                    <input
                      type="text"
                      value={gpsLng}
                      onChange={(e) => setGpsLng(e.target.value)}
                      className="h-9 rounded-xl border border-[#292D26]/15 bg-[#F3EBDD]/60 px-2 font-mono text-xs"
                    />
                    <input
                      type="number"
                      value={gpsSpeed}
                      onChange={(e) => setGpsSpeed(e.target.value)}
                      className="h-9 rounded-xl border border-[#292D26]/15 bg-[#F3EBDD]/60 px-2 font-mono text-xs"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => handleSendGpsPacket()}
                    className="h-9 w-full rounded-xl bg-[#A8D929] text-xs font-bold text-[#292D26] cursor-pointer"
                  >
                    Aplicar Coordenada e Velocidade
                  </button>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={handleSimulateDeviation}
                      className="h-9 rounded-xl border border-[#D9534F]/40 bg-[#D9534F]/10 text-[11px] font-bold text-[#D9534F] cursor-pointer"
                    >
                      Simular Desvio
                    </button>
                    <button
                      type="button"
                      onClick={handleSimulateSpeedExcess}
                      className="h-9 rounded-xl border border-[#E99A36]/50 bg-[#E99A36]/15 text-[11px] font-bold text-[#292D26] cursor-pointer"
                    >
                      Simular Excesso Vel.
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 3. FROTA DE ÔNIBUS */}
        {section === 'fleet' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h1 className="text-xl font-bold text-[#292D26]">Frota de Ônibus ({buses.length})</h1>
              <div className="flex flex-wrap gap-1.5">
                {['todos', 'em_operacao', 'disponivel', 'em_manutencao', 'quebrado'].map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setBusFilter(st)}
                    className={`rounded-xl px-3 py-1.5 text-xs font-semibold cursor-pointer ${
                      busFilter === st ? 'bg-[#E8C547] text-[#292D26]' : 'bg-[#FFFDF8] text-[#74766C]'
                    }`}
                  >
                    {st === 'todos' ? 'Todos' : BUS_STATUS_LABELS[st as BusStatus]}
                  </button>
                ))}
              </div>
            </div>

            {can('fleet:manage') && (
              <form
                onSubmit={handleCreateBus}
                className="rounded-2xl border border-[#292D26]/10 bg-[#FFFDF8] p-4 shadow-sm grid gap-3 sm:grid-cols-2 lg:grid-cols-4 items-end"
              >
                <div>
                  <label className="block text-[11px] font-semibold mb-1">Número / Prefixo</label>
                  <input
                    required
                    value={newBusUnit}
                    onChange={(e) => setNewBusUnit(e.target.value)}
                    placeholder="Ex: 5099"
                    className="h-9 w-full rounded-xl border border-[#292D26]/15 bg-[#F3EBDD]/60 px-3 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold mb-1">Placa</label>
                  <input
                    required
                    value={newBusPlate}
                    onChange={(e) => setNewBusPlate(e.target.value)}
                    placeholder="RIO-9E12"
                    className="h-9 w-full rounded-xl border border-[#292D26]/15 bg-[#F3EBDD]/60 px-3 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold mb-1">Modelo</label>
                  <input
                    required
                    value={newBusModel}
                    onChange={(e) => setNewBusModel(e.target.value)}
                    className="h-9 w-full rounded-xl border border-[#292D26]/15 bg-[#F3EBDD]/60 px-3 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold mb-1">Fabricante</label>
                  <input
                    required
                    value={newBusMaker}
                    onChange={(e) => setNewBusMaker(e.target.value)}
                    className="h-9 w-full rounded-xl border border-[#292D26]/15 bg-[#F3EBDD]/60 px-3 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold mb-1">Ano</label>
                  <input
                    type="number"
                    value={newBusYear}
                    onChange={(e) => setNewBusYear(e.target.value)}
                    className="h-9 w-full rounded-xl border border-[#292D26]/15 bg-[#F3EBDD]/60 px-3 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold mb-1">Capacidade</label>
                  <input
                    type="number"
                    value={newBusCap}
                    onChange={(e) => setNewBusCap(e.target.value)}
                    className="h-9 w-full rounded-xl border border-[#292D26]/15 bg-[#F3EBDD]/60 px-3 text-xs"
                  />
                </div>
                <label className="flex h-9 items-center gap-2 text-xs font-semibold cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newBusAcc}
                    onChange={(e) => setNewBusAcc(e.target.checked)}
                    className="h-4 w-4 accent-[#292D26]"
                  />
                  Veículo acessível (PCD)
                </label>
                <button
                  type="submit"
                  className="h-9 rounded-xl bg-[#A8D929] px-4 text-xs font-bold text-[#292D26] inline-flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Cadastrar Veículo (Demo)
                </button>
              </form>
            )}

            <div className="rounded-2xl border border-[#292D26]/10 bg-[#FFFDF8] shadow-sm overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[#292D26]/10 bg-[#F3EBDD]/60 text-[#74766C]">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Unidade</th>
                    <th className="px-4 py-3 font-semibold">Placa / Modelo</th>
                    <th className="px-4 py-3 font-semibold">Linha Ativa</th>
                    <th className="px-4 py-3 font-semibold">Acessível</th>
                    <th className="px-4 py-3 font-semibold">Quilometragem</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#292D26]/10">
                  {filteredBuses.map((b) => (
                    <tr key={b.id} className="hover:bg-[#F3EBDD]/30">
                      <td className="px-4 py-3 font-mono font-bold text-[#292D26]">#{b.unitNumber}</td>
                      <td className="px-4 py-3">
                        <span className="font-mono font-semibold">{b.plate}</span> · {b.model} ({b.year})
                      </td>
                      <td className="px-4 py-3 font-mono">{b.activeLineCode || '—'}</td>
                      <td className="px-4 py-3">{b.accessible ? 'Sim (PCD)' : 'Não'}</td>
                      <td className="px-4 py-3 font-mono tabular-nums">
                        {b.currentKm.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={b.status}
                          onChange={(e) => {
                            updateBusStatus(b.id, e.target.value as BusStatus);
                            showToast(`Status do veículo #${b.unitNumber} atualizado.`);
                          }}
                          className="h-8 rounded-lg border border-[#292D26]/15 bg-[#F3EBDD]/60 px-2 text-xs font-semibold"
                        >
                          {(Object.keys(BUS_STATUS_LABELS) as BusStatus[]).map((st) => (
                            <option key={st} value={st}>
                              {BUS_STATUS_LABELS[st]}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 4. MOTORISTAS */}
        {section === 'drivers' && (
          <div className="space-y-4">
            <h1 className="text-xl font-bold text-[#292D26]">Motoristas ({drivers.length})</h1>

            {can('drivers:manage') && (
              <form
                onSubmit={handleCreateDriver}
                className="rounded-2xl border border-[#292D26]/10 bg-[#FFFDF8] p-4 shadow-sm grid gap-3 sm:grid-cols-2 lg:grid-cols-4 items-end"
              >
                <div>
                  <label className="block text-[11px] font-semibold mb-1">Nome completo</label>
                  <input
                    required
                    value={drvName}
                    onChange={(e) => setDrvName(e.target.value)}
                    placeholder="Ex: Marcelo Tavares"
                    className="h-9 w-full rounded-xl border border-[#292D26]/15 bg-[#F3EBDD]/60 px-3 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold mb-1">CNH (Categoria D/E)</label>
                  <input
                    required
                    value={drvLic}
                    onChange={(e) => setDrvLic(e.target.value)}
                    placeholder="045998123-RJ"
                    className="h-9 w-full rounded-xl border border-[#292D26]/15 bg-[#F3EBDD]/60 px-3 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold mb-1">Telefone</label>
                  <input
                    required
                    value={drvPhone}
                    onChange={(e) => setDrvPhone(e.target.value)}
                    className="h-9 w-full rounded-xl border border-[#292D26]/15 bg-[#F3EBDD]/60 px-3 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold mb-1">Veículo vinculado</label>
                  <select
                    value={drvBusId}
                    onChange={(e) => setDrvBusId(e.target.value)}
                    className="h-9 w-full rounded-xl border border-[#292D26]/15 bg-[#F3EBDD]/60 px-2.5 text-xs"
                  >
                    <option value="">Sem vínculo fixo</option>
                    {buses.map((b) => (
                      <option key={b.id} value={b.id}>
                        #{b.unitNumber} · {b.plate}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold mb-1">Linha preferencial</label>
                  <select
                    value={drvLineId}
                    onChange={(e) => setDrvLineId(e.target.value)}
                    className="h-9 w-full rounded-xl border border-[#292D26]/15 bg-[#F3EBDD]/60 px-2.5 text-xs"
                  >
                    <option value="">Qualquer linha</option>
                    {lines.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.code} · {l.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold mb-1">CPF mascarado</label>
                  <input
                    value={drvCpf}
                    onChange={(e) => setDrvCpf(e.target.value)}
                    className="h-9 w-full rounded-xl border border-[#292D26]/15 bg-[#F3EBDD]/60 px-3 text-xs"
                  />
                </div>
                <button
                  type="submit"
                  className="sm:col-span-2 h-9 rounded-xl bg-[#A8D929] px-4 text-xs font-bold text-[#292D26] cursor-pointer"
                >
                  Cadastrar Motorista (Demo)
                </button>
              </form>
            )}

            <div className="rounded-2xl border border-[#292D26]/10 bg-[#FFFDF8] shadow-sm overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[#292D26]/10 bg-[#F3EBDD]/60 text-[#74766C]">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Motorista</th>
                    <th className="px-4 py-3 font-semibold">CNH</th>
                    <th className="px-4 py-3 font-semibold">Telefone</th>
                    <th className="px-4 py-3 font-semibold">Escala Atual</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#292D26]/10">
                  {drivers.map((d) => {
                    const bus = buses.find((b) => b.id === d.assignedBusId);
                    const line = lines.find((l) => l.id === d.assignedLineId);
                    return (
                      <tr key={d.id} className="hover:bg-[#F3EBDD]/30">
                        <td className="px-4 py-3 font-semibold text-[#292D26]">{d.name}</td>
                        <td className="px-4 py-3 font-mono">{d.licenseNumber}</td>
                        <td className="px-4 py-3 font-mono">{d.phone}</td>
                        <td className="px-4 py-3">
                          {line ? `Linha ${line.code}` : 'Reserva'} ·{' '}
                          {bus ? `#${bus.unitNumber}` : 'Sem veículo'}
                        </td>
                        <td className="px-4 py-3 font-semibold uppercase text-[11px]">{d.status}</td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => {
                              toggleDriverStatus(d.id);
                              showToast(`Status de ${d.name} atualizado.`);
                            }}
                            className="rounded-lg border border-[#292D26]/15 bg-[#F3EBDD] px-2.5 py-1 text-[11px] font-semibold cursor-pointer"
                          >
                            {d.status === 'inativo' ? 'Ativar' : 'Inativar'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 5. LINHAS E ITINERÁRIOS */}
        {section === 'lines' && (
          <div className="space-y-4">
            <h1 className="text-xl font-bold text-[#292D26]">
              Gestão de Linhas e Itinerários ({lines.length})
            </h1>

            <div className="grid gap-4 xl:grid-cols-12 items-start">
              <div className="xl:col-span-5 space-y-4">
                <form
                  onSubmit={handleSaveLine}
                  className="rounded-2xl border border-[#292D26]/10 bg-[#FFFDF8] p-4 shadow-sm space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-bold text-[#292D26]">
                      {editingLineId ? `Editando Linha ${lineCode}` : 'Nova Linha / Itinerário'}
                    </h2>
                    {editingLineId && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingLineId(null);
                          setLineVertices([]);
                          setLineStopIds([]);
                        }}
                        className="text-xs underline text-[#74766C] cursor-pointer"
                      >
                        Limpar seleção
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <input
                      required
                      value={lineCode}
                      onChange={(e) => setLineCode(e.target.value)}
                      placeholder="Código (ex: 550)"
                      className="h-9 rounded-xl border border-[#292D26]/15 bg-[#F3EBDD]/60 px-2.5 text-xs"
                    />
                    <input
                      required
                      value={lineName}
                      onChange={(e) => setLineName(e.target.value)}
                      placeholder="Nome da linha"
                      className="col-span-2 h-9 rounded-xl border border-[#292D26]/15 bg-[#F3EBDD]/60 px-2.5 text-xs"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      value={lineOrigin}
                      onChange={(e) => setLineOrigin(e.target.value)}
                      placeholder="Origem"
                      className="h-9 rounded-xl border border-[#292D26]/15 bg-[#F3EBDD]/60 px-2.5 text-xs"
                    />
                    <input
                      value={lineDest}
                      onChange={(e) => setLineDest(e.target.value)}
                      placeholder="Destino"
                      className="h-9 rounded-xl border border-[#292D26]/15 bg-[#F3EBDD]/60 px-2.5 text-xs"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2 items-center">
                    <input
                      value={lineHours}
                      onChange={(e) => setLineHours(e.target.value)}
                      placeholder="Horário"
                      className="h-9 rounded-xl border border-[#292D26]/15 bg-[#F3EBDD]/60 px-2.5 text-xs"
                    />
                    <input
                      type="number"
                      value={lineFreq}
                      onChange={(e) => setLineFreq(e.target.value)}
                      placeholder="Freq. min"
                      className="h-9 rounded-xl border border-[#292D26]/15 bg-[#F3EBDD]/60 px-2.5 text-xs"
                    />
                    <input
                      type="color"
                      value={lineColor}
                      onChange={(e) => setLineColor(e.target.value)}
                      className="h-9 w-full rounded-xl border border-[#292D26]/15 bg-[#F3EBDD]/60 p-1 cursor-pointer"
                    />
                  </div>
                  <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                    <input
                      type="checkbox"
                      checked={lineAcc}
                      onChange={(e) => setLineAcc(e.target.checked)}
                      className="h-4 w-4 accent-[#292D26]"
                    />
                    Operação com frota acessível (PCD)
                  </label>

                  <div className="flex items-center justify-between text-xs text-[#74766C]">
                    <span>Vértices no mapa: {lineVertices.length}</span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setLineVertices((v) => v.slice(0, -1))}
                        className="underline cursor-pointer"
                      >
                        Desfazer ponto
                      </button>
                      <button
                        type="button"
                        onClick={() => setLineVertices([])}
                        className="underline cursor-pointer"
                      >
                        Limpar traçado
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="h-10 w-full rounded-xl bg-[#A8D929] text-xs font-bold text-[#292D26] cursor-pointer"
                  >
                    Salvar Linha e Itinerário
                  </button>
                </form>

                <div className="rounded-2xl border border-[#292D26]/10 bg-[#FFFDF8] p-4 shadow-sm space-y-2 max-h-72 overflow-y-auto">
                  {lines.map((l) => (
                    <div
                      key={l.id}
                      className="flex items-center justify-between gap-2 rounded-xl border border-[#292D26]/10 bg-[#F3EBDD]/50 p-2.5 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="font-bold text-[#292D26] truncate">
                          <span
                            className="inline-block h-2.5 w-2.5 rounded-full mr-1.5"
                            style={{ backgroundColor: l.color }}
                          />
                          {l.code} · {l.name}
                        </p>
                        <p className="text-[11px] text-[#74766C]">
                          {l.scheduledKm.toFixed(1)} km · A cada {l.frequencyMin} min
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => loadLineIntoEditor(l)}
                        className="rounded-lg bg-[#E8C547] px-2.5 py-1 text-[11px] font-bold text-[#292D26] shrink-0 cursor-pointer"
                      >
                        Editar
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="xl:col-span-7 space-y-2">
                <TransitMap
                  center={RIO_CENTER}
                  zoom={13}
                  lines={lines}
                  stops={stops}
                  selectedLineId={editingLineId}
                  editableVertices={lineVertices}
                  onMapClick={(pos) => setLineVertices((prev) => [...prev, pos])}
                  className="h-[520px] w-full shadow-sm"
                />
                <p className="text-xs text-[#74766C]">
                  Clique no mapa OpenStreetMap para adicionar vértices ao traçado da linha em edição.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* 6. VIAGENS, ATRASOS E REGISTRO DE PARADAS */}
        {section === 'trips' && (
          <div className="space-y-4">
            <h1 className="text-xl font-bold text-[#292D26]">
              Viagens, Controle de Atrasos e Paradas
            </h1>

            <form
              onSubmit={handleStartTrip}
              className="rounded-2xl border border-[#292D26]/10 bg-[#FFFDF8] p-4 shadow-sm grid gap-3 sm:grid-cols-2 lg:grid-cols-5 items-end"
            >
              <div>
                <label className="block text-[11px] font-semibold mb-1">Linha</label>
                <select
                  value={tripLineId}
                  onChange={(e) => setTripLineId(e.target.value)}
                  className="h-9 w-full rounded-xl border border-[#292D26]/15 bg-[#F3EBDD]/60 px-2.5 text-xs"
                >
                  {lines.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.code} · {l.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold mb-1">Veículo</label>
                <select
                  value={tripBusId}
                  onChange={(e) => setTripBusId(e.target.value)}
                  className="h-9 w-full rounded-xl border border-[#292D26]/15 bg-[#F3EBDD]/60 px-2.5 text-xs"
                >
                  {buses.map((b) => (
                    <option key={b.id} value={b.id}>
                      #{b.unitNumber} ({BUS_STATUS_LABELS[b.status]})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold mb-1">Motorista</label>
                <select
                  value={tripDriverId}
                  onChange={(e) => setTripDriverId(e.target.value)}
                  className="h-9 w-full rounded-xl border border-[#292D26]/15 bg-[#F3EBDD]/60 px-2.5 text-xs"
                >
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold mb-1">Sentido</label>
                <select
                  value={tripDir}
                  onChange={(e) => setTripDir(e.target.value as 'ida' | 'volta')}
                  className="h-9 w-full rounded-xl border border-[#292D26]/15 bg-[#F3EBDD]/60 px-2.5 text-xs"
                >
                  <option value="ida">Ida</option>
                  <option value="volta">Volta</option>
                </select>
              </div>
              <button
                type="submit"
                className="h-9 rounded-xl bg-[#A8D929] px-4 text-xs font-bold text-[#292D26] cursor-pointer"
              >
                Iniciar Nova Viagem
              </button>
            </form>

            {delayModalTripId && (
              <div className="rounded-2xl border border-[#E99A36] bg-[#FFFDF8] p-4 shadow-sm flex flex-wrap items-end gap-3">
                <div>
                  <label className="block text-[11px] font-semibold mb-1">Atraso (min)</label>
                  <input
                    type="number"
                    value={delayMinutesInput}
                    onChange={(e) => setDelayMinutesInput(e.target.value)}
                    className="h-9 w-24 rounded-xl border border-[#292D26]/15 bg-[#F3EBDD]/60 px-2.5 text-xs"
                  />
                </div>
                <div className="flex-1 min-w-[200px]">
                  <label className="block text-[11px] font-semibold mb-1">Motivo do atraso</label>
                  <input
                    value={delayReasonInput}
                    onChange={(e) => setDelayReasonInput(e.target.value)}
                    className="h-9 w-full rounded-xl border border-[#292D26]/15 bg-[#F3EBDD]/60 px-3 text-xs"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    updateTripStatus(
                      delayModalTripId,
                      'atrasada',
                      Number(delayMinutesInput) || 10,
                      delayReasonInput
                    );
                    setDelayModalTripId(null);
                    showToast('Atraso registrado na viagem.');
                  }}
                  className="h-9 rounded-xl bg-[#E8C547] px-4 text-xs font-bold text-[#292D26] cursor-pointer"
                >
                  Confirmar Atraso
                </button>
                <button
                  type="button"
                  onClick={() => setDelayModalTripId(null)}
                  className="h-9 rounded-xl border border-[#292D26]/15 px-3 text-xs cursor-pointer"
                >
                  Cancelar
                </button>
              </div>
            )}

            <div className="rounded-2xl border border-[#292D26]/10 bg-[#FFFDF8] shadow-sm overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[#292D26]/10 bg-[#F3EBDD]/60 text-[#74766C]">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Linha</th>
                    <th className="px-4 py-3 font-semibold">Veículo / Motorista</th>
                    <th className="px-4 py-3 font-semibold">Distância</th>
                    <th className="px-4 py-3 font-semibold">Atraso</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#292D26]/10">
                  {trips.map((t) => (
                    <tr key={t.id} className="hover:bg-[#F3EBDD]/30">
                      <td className="px-4 py-3 font-bold">
                        Linha {t.lineCode} ({t.direction})
                      </td>
                      <td className="px-4 py-3">
                        #{t.busUnitNumber} · {t.driverName}
                      </td>
                      <td className="px-4 py-3 font-mono tabular-nums">{t.distanceKm.toFixed(1)} km</td>
                      <td className="px-4 py-3 font-mono tabular-nums">
                        {t.delayMinutes > 0 ? `+${t.delayMinutes} min` : 'No horário'}
                      </td>
                      <td className="px-4 py-3 uppercase text-[11px] font-semibold">{t.status}</td>
                      <td className="px-4 py-3 flex gap-1.5">
                        {t.status !== 'concluida' && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                updateTripStatus(t.id, 'concluida');
                                showToast('Viagem marcada como concluída.');
                              }}
                              className="rounded-lg bg-[#A8D929] px-2.5 py-1 text-[11px] font-bold text-[#292D26] cursor-pointer"
                            >
                              Concluir
                            </button>
                            <button
                              type="button"
                              onClick={() => setDelayModalTripId(t.id)}
                              className="rounded-lg bg-[#E8C547] px-2.5 py-1 text-[11px] font-bold text-[#292D26] cursor-pointer"
                            >
                              Atraso
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Registro de Paradas */}
            <div className="rounded-2xl border border-[#292D26]/10 bg-[#FFFDF8] p-4 shadow-sm space-y-3">
              <h2 className="text-sm font-bold text-[#292D26]">
                Registro de Paradas ({stopEvents.length})
              </h2>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {stopEvents.slice(0, 9).map((ev) => (
                  <div
                    key={ev.id}
                    className="rounded-xl border border-[#292D26]/10 bg-[#F3EBDD]/50 p-3 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[#292D26] truncate">{ev.stopName}</span>
                      <span className="font-mono text-[11px] text-[#74766C] shrink-0">
                        {ev.dwellSeconds}s
                      </span>
                    </div>
                    <p className="font-mono text-[11px] text-[#74766C]">
                      Chegada {new Date(ev.arrivalTime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} ·{' '}
                      {ev.status}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 7. OCORRÊNCIAS E VELOCIDADE */}
        {section === 'incidents' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h1 className="text-xl font-bold text-[#292D26]">
                Ocorrências, Desvios e Velocidade ({filteredIncidents.length})
              </h1>
              <div className="flex flex-wrap gap-1.5">
                {[
                  ['todos', 'Todas'],
                  ['desvio_rota', 'Fora da rota'],
                  ['excesso_velocidade', 'Velocidade'],
                  ['atraso', 'Atrasos'],
                  ['falha_mecanica', 'Falhas'],
                ].map(([k, lbl]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setIncidentFilter(k)}
                    className={`rounded-xl px-3 py-1.5 text-xs font-semibold cursor-pointer ${
                      incidentFilter === k
                        ? 'bg-[#E8C547] text-[#292D26]'
                        : 'bg-[#FFFDF8] text-[#74766C]'
                    }`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2.5">
              {filteredIncidents.map((inc) => (
                <div
                  key={inc.id}
                  className="rounded-2xl border border-[#292D26]/10 bg-[#FFFDF8] p-4 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-xs">
                      <span
                        className={`rounded px-2 py-0.5 font-bold uppercase text-[10px] ${
                          inc.severity === 'critica'
                            ? 'bg-[#D9534F] text-white'
                            : 'bg-[#E8C547] text-[#292D26]'
                        }`}
                      >
                        {inc.severity}
                      </span>
                      <span className="font-mono text-[#74766C]">
                        {new Date(inc.createdAt).toLocaleTimeString('pt-BR')} · {inc.status}
                      </span>
                    </div>
                    <p className="text-sm font-bold text-[#292D26]">{inc.title}</p>
                    <p className="text-xs text-[#74766C]">{inc.description}</p>
                  </div>
                  {inc.status !== 'resolvida' && (
                    <div className="flex gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          updateIncidentStatus(inc.id, 'em_tratamento');
                          showToast('Ocorrência em tratamento.');
                        }}
                        className="rounded-xl bg-[#E8C547] px-3 py-1.5 text-xs font-bold text-[#292D26] cursor-pointer"
                      >
                        Tratar
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          updateIncidentStatus(inc.id, 'resolvida');
                          showToast('Ocorrência resolvida.');
                        }}
                        className="rounded-xl bg-[#A8D929] px-3 py-1.5 text-xs font-bold text-[#292D26] cursor-pointer"
                      >
                        Resolver
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 8. HISTÓRICO DE LOCALIZAÇÃO GPS */}
        {section === 'history' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-xl font-bold text-[#292D26]">Histórico de Localização GPS</h1>
                <p className="text-xs text-[#74766C]">
                  Reproduza o trajeto percorrido e verifique velocidade e desvios ao longo do tempo.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={histBusId}
                  onChange={(e) => setHistBusId(e.target.value)}
                  className="h-9 rounded-xl border border-[#292D26]/15 bg-[#FFFDF8] px-3 text-xs font-semibold"
                >
                  {buses.map((b) => (
                    <option key={b.id} value={b.id}>
                      #{b.unitNumber} · Linha {b.activeLineCode || 'Garagem'}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    if (histIdx + 1 >= histPoints.length) setHistIdx(0);
                    setHistPlaying((p) => !p);
                  }}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#A8D929] px-4 text-xs font-bold text-[#292D26] cursor-pointer"
                >
                  {histPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  {histPlaying ? 'Pausar' : 'Reproduzir trajeto'}
                </button>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-12 items-start">
              <div className="xl:col-span-8">
                <TransitMap
                  center={
                    currentPlaybackPoint
                      ? { lat: currentPlaybackPoint.lat, lng: currentPlaybackPoint.lng }
                      : RIO_CENTER
                  }
                  zoom={13}
                  lines={lines}
                  stops={stops}
                  playbackPoint={
                    currentPlaybackPoint
                      ? { lat: currentPlaybackPoint.lat, lng: currentPlaybackPoint.lng }
                      : null
                  }
                  extraPolylines={
                    histPoints.length >= 2
                      ? [
                          {
                            id: 'hist-trace',
                            path: histPoints.map((p) => ({ lat: p.lat, lng: p.lng })),
                            color: '#292D26',
                            weight: 4,
                            opacity: 0.85,
                          },
                        ]
                      : []
                  }
                  className="h-[440px] w-full shadow-sm"
                />
              </div>

              <div className="xl:col-span-4 rounded-2xl border border-[#292D26]/10 bg-[#FFFDF8] p-4 shadow-sm space-y-3">
                <h2 className="text-sm font-bold text-[#292D26]">
                  Registros ({histPoints.length} pontos)
                </h2>
                {histPoints.length > 0 && (
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0, histPoints.length - 1)}
                    value={histIdx}
                    onChange={(e) => setHistIdx(Number(e.target.value))}
                    className="w-full accent-[#292D26]"
                  />
                )}
                {currentPlaybackPoint ? (
                  <div className="rounded-xl bg-[#F3EBDD]/70 p-3 font-mono text-xs space-y-1 tabular-nums">
                    <p>
                      Horário:{' '}
                      <strong>
                        {new Date(currentPlaybackPoint.recordedAt).toLocaleTimeString('pt-BR')}
                      </strong>
                    </p>
                    <p>
                      Velocidade: <strong>{Math.round(currentPlaybackPoint.speedKmh)} km/h</strong>
                    </p>
                    <p>
                      Coordenada:{' '}
                      <strong>
                        {currentPlaybackPoint.lat.toFixed(4)}, {currentPlaybackPoint.lng.toFixed(4)}
                      </strong>
                    </p>
                    <p>
                      Desvio: <strong>{currentPlaybackPoint.deviationMeters} m</strong>
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-[#74766C]">
                    Nenhum ponto registrado ainda para este veículo.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 9. MANUTENÇÃO E FALHAS */}
        {section === 'maintenance' && (
          <div className="space-y-4">
            <h1 className="text-xl font-bold text-[#292D26]">Manutenção e Registro de Falhas</h1>

            <form
              onSubmit={handleReportBreakdown}
              className="rounded-2xl border border-[#292D26]/10 bg-[#FFFDF8] p-4 shadow-sm grid gap-3 sm:grid-cols-2 lg:grid-cols-4 items-end"
            >
              <div>
                <label className="block text-[11px] font-semibold mb-1">Veículo</label>
                <select
                  value={brkBusId}
                  onChange={(e) => setBrkBusId(e.target.value)}
                  className="h-9 w-full rounded-xl border border-[#292D26]/15 bg-[#F3EBDD]/60 px-2.5 text-xs"
                >
                  {buses.map((b) => (
                    <option key={b.id} value={b.id}>
                      #{b.unitNumber} · {b.plate}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold mb-1">Status destino</label>
                <select
                  value={brkStatus}
                  onChange={(e) =>
                    setBrkStatus(e.target.value as 'quebrado' | 'em_manutencao' | 'retirado')
                  }
                  className="h-9 w-full rounded-xl border border-[#292D26]/15 bg-[#F3EBDD]/60 px-2.5 text-xs"
                >
                  <option value="em_manutencao">Em manutenção</option>
                  <option value="quebrado">Quebrado</option>
                  <option value="retirado">Retirado</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold mb-1">Responsável / Oficina</label>
                <input
                  value={brkResponsible}
                  onChange={(e) => setBrkResponsible(e.target.value)}
                  className="h-9 w-full rounded-xl border border-[#292D26]/15 bg-[#F3EBDD]/60 px-3 text-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold mb-1">Motivo</label>
                <input
                  required
                  value={brkReason}
                  onChange={(e) => setBrkReason(e.target.value)}
                  placeholder="Ex: Revisão preventiva / Ar-condicionado"
                  className="h-9 w-full rounded-xl border border-[#292D26]/15 bg-[#F3EBDD]/60 px-3 text-xs"
                />
              </div>
              <button
                type="submit"
                className="sm:col-span-2 lg:col-span-4 h-9 rounded-xl bg-[#E8C547] px-4 text-xs font-bold text-[#292D26] cursor-pointer"
              >
                Registrar Manutenção / Retirar de Circulação
              </button>
            </form>

            <div className="space-y-2.5">
              {maintenanceLogs.map((m) => {
                const bus = buses.find((b) => b.id === m.busId);
                return (
                  <div
                    key={m.id}
                    className="rounded-2xl border border-[#292D26]/10 bg-[#FFFDF8] p-4 shadow-sm flex flex-wrap items-center justify-between gap-3"
                  >
                    <div className="space-y-0.5 text-xs">
                      <p className="font-bold text-[#292D26]">
                        Veículo #{bus?.unitNumber || m.busId} · {m.reason}
                      </p>
                      <p className="text-[#74766C]">
                        Responsável: {m.responsible} · Status: {m.status}
                      </p>
                    </div>
                    {m.status === 'em_andamento' && (
                      <button
                        type="button"
                        onClick={() => {
                          completeMaintenance(m.id);
                          showToast('Manutenção concluída e veículo liberado.');
                        }}
                        className="rounded-xl bg-[#A8D929] px-3.5 py-2 text-xs font-bold text-[#292D26] cursor-pointer"
                      >
                        Concluir e Liberar Veículo
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 10. AVISOS E RECLAMAÇÕES */}
        {section === 'notices_complaints' && (
          <div className="grid gap-4 lg:grid-cols-12 items-start">
            <div className="lg:col-span-5 space-y-4">
              <form
                onSubmit={handleCreateNotice}
                className="rounded-2xl border border-[#292D26]/10 bg-[#FFFDF8] p-4 shadow-sm space-y-3"
              >
                <h2 className="text-base font-bold text-[#292D26]">Publicar Comunicado</h2>
                <input
                  required
                  value={noticeTitle}
                  onChange={(e) => setNoticeTitle(e.target.value)}
                  placeholder="Título do aviso..."
                  className="h-9 w-full rounded-xl border border-[#292D26]/15 bg-[#F3EBDD]/60 px-3 text-xs"
                />
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={noticeCategory}
                    onChange={(e) => setNoticeCategory(e.target.value as Notice['category'])}
                    className="h-9 rounded-xl border border-[#292D26]/15 bg-[#F3EBDD]/60 px-2.5 text-xs"
                  >
                    <option value="operacional">Operacional</option>
                    <option value="desvio">Desvio</option>
                    <option value="interrupcao">Interrupção</option>
                    <option value="alteracao_temporaria">Itinerário</option>
                    <option value="comunicado">Comunicado</option>
                  </select>
                  <select
                    value={noticeLineId}
                    onChange={(e) => setNoticeLineId(e.target.value)}
                    className="h-9 rounded-xl border border-[#292D26]/15 bg-[#F3EBDD]/60 px-2.5 text-xs"
                  >
                    <option value="">Toda a rede</option>
                    {lines.map((l) => (
                      <option key={l.id} value={l.id}>
                        Linha {l.code}
                      </option>
                    ))}
                  </select>
                </div>
                <textarea
                  required
                  rows={3}
                  value={noticeMessage}
                  onChange={(e) => setNoticeMessage(e.target.value)}
                  placeholder="Mensagem exibida no aplicativo dos passageiros..."
                  className="w-full rounded-xl border border-[#292D26]/15 bg-[#F3EBDD]/60 p-3 text-xs"
                />
                <button
                  type="submit"
                  className="h-9 w-full rounded-xl bg-[#A8D929] text-xs font-bold text-[#292D26] cursor-pointer"
                >
                  Publicar Aviso ({notices.length} ativos)
                </button>
              </form>
            </div>

            <div className="lg:col-span-7 rounded-2xl border border-[#292D26]/10 bg-[#FFFDF8] p-4 shadow-sm space-y-3">
              <h2 className="text-base font-bold text-[#292D26]">
                Reclamações dos Passageiros ({complaints.length})
              </h2>
              <div className="space-y-3">
                {complaints.map((c) => (
                  <div
                    key={c.id}
                    className="rounded-xl border border-[#292D26]/10 bg-[#F3EBDD]/45 p-3.5 text-xs space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-[#292D26]">
                        {c.protocol} · {c.category}
                      </span>
                      <span className="uppercase font-semibold text-[#74766C]">{c.status}</span>
                    </div>
                    <p className="text-[#292D26]">{c.description}</p>
                    <div className="flex flex-wrap gap-2 items-center">
                      <input
                        type="text"
                        value={compNotes[c.id] ?? c.resolutionNote ?? ''}
                        onChange={(e) =>
                          setCompNotes((prev) => ({ ...prev, [c.id]: e.target.value }))
                        }
                        placeholder="Nota de resposta ao passageiro..."
                        className="h-8 flex-1 min-w-[180px] rounded-lg border border-[#292D26]/15 bg-[#FFFDF8] px-2.5 text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          updateComplaintStatus(
                            c.id,
                            'respondida',
                            compNotes[c.id] ?? c.resolutionNote ?? 'Analisado pela operação.'
                          );
                          showToast(`Protocolo ${c.protocol} respondido.`);
                        }}
                        className="h-8 rounded-lg bg-[#E8C547] px-3 text-[11px] font-bold text-[#292D26] cursor-pointer"
                      >
                        Responder
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 11. RELATÓRIOS DIÁRIOS, SEMANAIS E MENSAIS */}
        {section === 'reports' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-xl font-bold text-[#292D26]">
                  Relatórios Operacionais (Diário, Semanal e Mensal)
                </h1>
                <p className="text-xs text-[#74766C]">
                  Visualize indicadores consolidados ou exporte em CSV e PDF.
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={exportCsv}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#A8D929] px-3.5 text-xs font-bold text-[#292D26] cursor-pointer"
                >
                  <Download className="h-3.5 w-3.5" />
                  Exportar CSV
                </button>
                <button
                  type="button"
                  onClick={exportPdf}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#E8C547] px-3.5 text-xs font-bold text-[#292D26] cursor-pointer"
                >
                  <Download className="h-3.5 w-3.5" />
                  Exportar PDF
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-[#292D26]/10 bg-[#FFFDF8] p-4 shadow-sm flex flex-wrap items-center gap-3">
              <div className="flex rounded-xl bg-[#F3EBDD] p-1">
                {(['diario', 'semanal', 'mensal'] as ReportPeriod[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setReportPeriod(p)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold cursor-pointer ${
                      reportPeriod === p ? 'bg-[#FFFDF8] text-[#292D26] shadow-sm' : 'text-[#74766C]'
                    }`}
                  >
                    {PERIOD_LABELS[p]}
                  </button>
                ))}
              </div>

              <select
                value={reportType}
                onChange={(e) => setReportType(e.target.value)}
                className="h-9 rounded-xl border border-[#292D26]/15 bg-[#F3EBDD]/60 px-3 text-xs font-semibold"
              >
                <option value="viagens">Viagens realizadas</option>
                <option value="atrasos">Controle de atrasos</option>
                <option value="ocorrencias">Ocorrências gerais</option>
                <option value="desvios">Veículos fora da rota</option>
                <option value="velocidade">Excesso de velocidade</option>
                <option value="quilometragem">Quilometragem e frota</option>
              </select>

              <select
                value={reportLineId}
                onChange={(e) => setReportLineId(e.target.value)}
                className="h-9 rounded-xl border border-[#292D26]/15 bg-[#F3EBDD]/60 px-3 text-xs"
              >
                <option value="">Todas as linhas</option>
                {lines.map((l) => (
                  <option key={l.id} value={l.id}>
                    Linha {l.code} · {l.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="rounded-2xl border border-[#292D26]/10 bg-[#FFFDF8] shadow-sm overflow-x-auto">
              {filteredReportRows.length === 0 ? (
                <p className="p-6 text-xs text-[#74766C]">
                  Nenhum registro encontrado para este filtro.
                </p>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-[#292D26]/10 bg-[#F3EBDD]/60 text-[#74766C]">
                    <tr>
                      {Object.keys(filteredReportRows[0]).map((h) => (
                        <th key={h} className="px-4 py-3 font-semibold">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#292D26]/10">
                    {filteredReportRows.map((row, idx) => (
                      <tr key={idx} className="hover:bg-[#F3EBDD]/30">
                        {Object.values(row).map((val, cIdx) => (
                          <td key={cIdx} className="px-4 py-2.5 font-mono tabular-nums">
                            {String(val)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* 12. CONFIGURAÇÕES E AUDITORIA */}
        {section === 'config' && (
          <div className="grid gap-4 lg:grid-cols-2 items-start">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                updateConfig(configDraft);
                showToast('Parâmetros de monitoramento atualizados.');
              }}
              className="rounded-2xl border border-[#292D26]/10 bg-[#FFFDF8] p-5 shadow-sm space-y-3"
            >
              <h2 className="text-base font-bold text-[#292D26]">Parâmetros de Operação</h2>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block font-semibold mb-1">Tolerância de atraso (min)</label>
                  <input
                    type="number"
                    value={configDraft.delayToleranceMinutes}
                    onChange={(e) =>
                      setConfigDraft((c) => ({
                        ...c,
                        delayToleranceMinutes: Number(e.target.value),
                      }))
                    }
                    className="h-9 w-full rounded-xl border border-[#292D26]/15 bg-[#F3EBDD]/60 px-3"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Limite desvio rota (m)</label>
                  <input
                    type="number"
                    value={configDraft.routeDeviationMeters}
                    onChange={(e) =>
                      setConfigDraft((c) => ({
                        ...c,
                        routeDeviationMeters: Number(e.target.value),
                      }))
                    }
                    className="h-9 w-full rounded-xl border border-[#292D26]/15 bg-[#F3EBDD]/60 px-3"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Velocidade máxima urbana (km/h)</label>
                  <input
                    type="number"
                    value={configDraft.speedLimitUrbanKmh}
                    onChange={(e) =>
                      setConfigDraft((c) => ({
                        ...c,
                        speedLimitUrbanKmh: Number(e.target.value),
                      }))
                    }
                    className="h-9 w-full rounded-xl border border-[#292D26]/15 bg-[#F3EBDD]/60 px-3"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Timeout sinal GPS (s)</label>
                  <input
                    type="number"
                    value={configDraft.gpsStaleSeconds}
                    onChange={(e) =>
                      setConfigDraft((c) => ({
                        ...c,
                        gpsStaleSeconds: Number(e.target.value),
                      }))
                    }
                    className="h-9 w-full rounded-xl border border-[#292D26]/15 bg-[#F3EBDD]/60 px-3"
                  />
                </div>
              </div>
              <button
                type="submit"
                className="h-10 rounded-xl bg-[#A8D929] px-4 text-xs font-bold text-[#292D26] cursor-pointer"
              >
                Salvar Parâmetros
              </button>
            </form>

            <div className="rounded-2xl border border-[#292D26]/10 bg-[#FFFDF8] p-5 shadow-sm space-y-3">
              <h2 className="text-base font-bold text-[#292D26]">
                Registro de Auditoria ({auditLogs.length})
              </h2>
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {auditLogs.map((log) => (
                  <div
                    key={log.id}
                    className="rounded-xl border border-[#292D26]/10 bg-[#F3EBDD]/50 p-3 text-xs"
                  >
                    <p className="font-bold text-[#292D26]">
                      {log.action} · {log.userName}
                    </p>
                    <p className="text-[#74766C]">{log.details}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
