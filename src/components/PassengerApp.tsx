import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Accessibility,
  AlertTriangle,
  ArrowRight,
  Bell,
  Bookmark,
  Bus as BusIcon,
  CheckCircle2,
  Clock,
  Compass,
  Heart,
  Home,
  LocateFixed,
  MapPin,
  Megaphone,
  MessageSquarePlus,
  Navigation,
  Pause,
  Play,
  Route as RouteIcon,
  Search,
  Star,
  Trash2,
  User as UserIcon,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useTransit } from '../contexts/TransitContext.tsx';
import { RIO_CENTER } from '../data/mockTransitData.ts';
import { haversineMeters } from '../services/transitGeo.ts';
import type {
  ArrivalStatus,
  Complaint,
  LatLng,
  Notice,
  PlannedTripOption,
  Stop,
  TransitLine,
} from '../shared/types.ts';
import { TransitMap } from './TransitMap.tsx';

type PassengerTab = 'home' | 'plan' | 'favorites' | 'alerts' | 'profile';
type HomePanelMode = 'overview' | 'itineraries' | 'stops';
type ProfileSection = 'account' | 'accessibility' | 'feedback';
type NoticeFilter = 'todos' | Notice['category'];

const RIO_LOCATION_PRESETS: { label: string; coords: LatLng }[] = [
  { label: 'Cinelândia / Centro', coords: { lat: -22.9107, lng: -43.1763 } },
  { label: 'Copacabana (Cardeal Arcoverde)', coords: { lat: -22.9647, lng: -43.1791 } },
  { label: 'Tijuca (Praça Saens Peña)', coords: { lat: -22.9242, lng: -43.2323 } },
  { label: 'Botafogo (Praia de Botafogo)', coords: { lat: -22.9469, lng: -43.1825 } },
];

const ARRIVAL_STATUS_STYLE: Record<
  ArrivalStatus,
  { label: string; bg: string; text: string }
> = {
  chegando: { label: 'Chegando', bg: 'bg-[#A8D929]', text: 'text-[#292D26]' },
  no_horario: { label: 'No horário', bg: 'bg-[#E8C547]/65', text: 'text-[#292D26]' },
  atrasado: { label: 'Atrasado', bg: 'bg-[#E99A36]/35', text: 'text-[#292D26]' },
  indisponivel: { label: 'Indisponível', bg: 'bg-[#F3EBDD]', text: 'text-[#74766C]' },
};

const NOTICE_CATEGORY_LABELS: Record<Notice['category'], string> = {
  desvio: 'Desvio',
  interrupcao: 'Interrupção',
  alteracao_temporaria: 'Alteração de itinerário',
  obra: 'Obra na via',
  operacional: 'Operacional',
  comunicado: 'Comunicado',
};

export const PassengerApp: React.FC<{ onSwitchToAdmin: () => void }> = ({
  onSwitchToAdmin,
}) => {
  const { user, updatePreferences } = useAuth();
  const {
    lines,
    stops,
    lineStops,
    buses,
    notices,
    complaints,
    ratings,
    favorites,
    frequentDestinations,
    averageRating,
    ratingsCount,
    simulationRunning,
    notifications,
    getArrivalsForStop,
    planTrips,
    toggleSimulation,
    markAllNotificationsRead,
    addFavorite,
    removeFavorite,
    submitComplaint,
    trackComplaint,
    submitRating,
  } = useTransit();

  const [tab, setTab] = useState<PassengerTab>('home');
  const [homeMode, setHomeMode] = useState<HomePanelMode>('overview');
  const [profileSection, setProfileSection] = useState<ProfileSection>('account');

  const [searchQuery, setSearchQuery] = useState('');
  const [accessibleOnly, setAccessibleOnly] = useState(user.accessibilityNeeds);
  const [noticeFilter, setNoticeFilter] = useState<NoticeFilter>('todos');

  // Simulated Rio de Janeiro passenger location & map camera
  const [userLocation, setUserLocation] = useState<LatLng>(RIO_LOCATION_PRESETS[0].coords);
  const [geoLabel, setGeoLabel] = useState<string>('Cinelândia / Centro · Rio de Janeiro');
  const [mapCenter, setMapCenter] = useState<LatLng>(RIO_CENTER);
  const [mapZoom, setMapZoom] = useState<number>(13);

  // Selected stop, line & itinerary direction
  const [selectedStop, setSelectedStop] = useState<Stop | null>(() => stops[3] ?? null);
  const [selectedLine, setSelectedLine] = useState<TransitLine | null>(null);
  const [itineraryDirection, setItineraryDirection] = useState<'ida' | 'volta'>('ida');
  const [walkingTargetStop, setWalkingTargetStop] = useState<Stop | null>(null);

  // Trip planner state
  const [planOriginMode, setPlanOriginMode] = useState<'gps' | number>('gps');
  const [planDestStopId, setPlanDestStopId] = useState<number>(17); // Posto 5 Copacabana
  const [planOptions, setPlanOptions] = useState<PlannedTripOption[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<PlannedTripOption | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);

  // Toast feedback
  const [feedbackBanner, setFeedbackBanner] = useState<string | null>(null);

  // Complaints & ratings state
  const [compLineId, setCompLineId] = useState<string>('1');
  const [compBusId, setCompBusId] = useState<string>('');
  const [compCategory, setCompCategory] = useState('Atraso excessivo');
  const [compDescription, setCompDescription] = useState('');
  const [createdProtocol, setCreatedProtocol] = useState<string | null>(null);
  const [trackProtocolInput, setTrackProtocolInput] = useState('RIO-2026-1042');
  const [trackedComplaint, setTrackedComplaint] = useState<Complaint | null>(null);
  const [trackError, setTrackError] = useState<string | null>(null);

  const [rateLineId, setRateLineId] = useState<string>('1');
  const [rateBusId, setRateBusId] = useState<string>('1');
  const [rateService, setRateService] = useState(5);
  const [ratePunctuality, setRatePunctuality] = useState(4);
  const [rateVehicle, setRateVehicle] = useState(5);
  const [rateComment, setRateComment] = useState('');

  // Editable passenger name
  const [profileName, setProfileName] = useState(user.name);

  useEffect(() => {
    setAccessibleOnly(user.accessibilityNeeds);
  }, [user.accessibilityNeeds]);

  // Compute initial trip plan when entering Plan tab if empty
  useEffect(() => {
    if (tab === 'plan' && planOptions.length === 0 && stops.length > 0) {
      const dest = stops.find((s) => s.id === planDestStopId) ?? stops[16] ?? stops[0];
      const opts = planTrips({
        origin: userLocation,
        originLabel: 'Minha localização atual',
        destination: { lat: dest.lat, lng: dest.lng },
        destinationLabel: dest.name,
        accessibleOnly,
      });
      setPlanOptions(opts);
      setSelectedPlan(opts[0] ?? null);
    }
  }, [tab, planOptions.length, stops, planDestStopId, planTrips, userLocation, accessibleOnly]);

  const showToast = useCallback((msg: string) => {
    setFeedbackBanner(msg);
    window.setTimeout(() => setFeedbackBanner(null), 3500);
  }, []);

  const requestGpsLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setUserLocation(RIO_LOCATION_PRESETS[0].coords);
      setMapCenter(RIO_LOCATION_PRESETS[0].coords);
      setMapZoom(14);
      setGeoLabel('Localização simulada: Cinelândia, Rio de Janeiro');
      showToast('Localização simulada centralizada no Centro do Rio.');
      return;
    }
    setGeoLabel('Obtendo posição...');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = {
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6)),
        };
        // Keep within Rio viewport if user is far away during demo
        const distFromRio = haversineMeters(coords, RIO_CENTER);
        if (distFromRio > 45000) {
          setUserLocation(RIO_LOCATION_PRESETS[0].coords);
          setMapCenter(RIO_LOCATION_PRESETS[0].coords);
          setMapZoom(14);
          setGeoLabel('Localização simulada no Rio de Janeiro (Cinelândia)');
          showToast('Posição ajustada para o perímetro demonstrativo do Rio de Janeiro.');
        } else {
          setUserLocation(coords);
          setMapCenter(coords);
          setMapZoom(14);
          setGeoLabel('GPS ativo no Rio de Janeiro');
        }
      },
      () => {
        setUserLocation(RIO_LOCATION_PRESETS[0].coords);
        setMapCenter(RIO_LOCATION_PRESETS[0].coords);
        setMapZoom(14);
        setGeoLabel('Localização simulada: Cinelândia, Rio de Janeiro');
        showToast('Usando localização demonstrativa no Centro do Rio.');
      },
      { enableHighAccuracy: true, timeout: 4000 }
    );
  }, [showToast]);

  const nearbyStops = useMemo(() => {
    return stops
      .filter((s) => !accessibleOnly || s.accessible)
      .map((s) => {
        const dist = Math.round(haversineMeters(userLocation, { lat: s.lat, lng: s.lng }));
        const servingLines = Array.from(
          new Map(
            lineStops
              .filter((ls) => ls.stopId === s.id)
              .map((ls) => lines.find((l) => l.id === ls.lineId))
              .filter((l): l is TransitLine => Boolean(l))
              .map((l) => [l.id, l])
          ).values()
        );
        return {
          ...s,
          distanceMeters: dist,
          walkMinutes: Math.max(1, Math.round(dist / 75)),
          servingLines,
        };
      })
      .sort((a, b) => a.distanceMeters - b.distanceMeters);
  }, [stops, lineStops, lines, userLocation, accessibleOnly]);

  const filteredLines = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return lines.filter((l) => {
      if (accessibleOnly && !l.accessible) return false;
      if (!q) return true;
      return (
        l.code.toLowerCase().includes(q) ||
        l.name.toLowerCase().includes(q) ||
        l.origin.toLowerCase().includes(q) ||
        l.destination.toLowerCase().includes(q)
      );
    });
  }, [lines, searchQuery, accessibleOnly]);

  const filteredStops = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return nearbyStops;
    return nearbyStops.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.code.toLowerCase().includes(q) ||
        s.neighborhood.toLowerCase().includes(q) ||
        s.address.toLowerCase().includes(q)
    );
  }, [nearbyStops, searchQuery]);

  const activeBuses = useMemo(
    () =>
      buses.filter(
        (b) => b.status === 'em_operacao' && (!accessibleOnly || b.accessible)
      ),
    [buses, accessibleOnly]
  );

  // Arrivals for selected stop (or nearest stop when none selected)
  const inspectedStop = selectedStop ?? nearbyStops[0] ?? stops[0] ?? null;
  const stopArrivals = useMemo(() => {
    if (!inspectedStop) return [];
    return getArrivalsForStop(inspectedStop.id).filter(
      (p) => !accessibleOnly || p.accessible
    );
  }, [inspectedStop, getArrivalsForStop, accessibleOnly]);

  // Selected line ordered stops by direction (ida / volta)
  const selectedLineOrderedStops = useMemo(() => {
    if (!selectedLine) return [];
    return lineStops
      .filter((ls) => ls.lineId === selectedLine.id && ls.direction === itineraryDirection)
      .sort((a, b) => a.sequence - b.sequence);
  }, [selectedLine, lineStops, itineraryDirection]);

  const isStopFavorited = useCallback(
    (stopId: number) =>
      favorites.some((f) => f.targetType === 'stop' && f.targetId === String(stopId)),
    [favorites]
  );

  const isLineFavorited = useCallback(
    (lineId: number) =>
      favorites.some((f) => f.targetType === 'line' && f.targetId === String(lineId)),
    [favorites]
  );

  const handlePlanTrip = (e: React.FormEvent) => {
    e.preventDefault();
    setPlanError(null);
    const destStop = stops.find((s) => s.id === Number(planDestStopId));
    if (!destStop) {
      setPlanError('Selecione um destino.');
      return;
    }
    const originStop =
      planOriginMode === 'gps' ? null : stops.find((s) => s.id === Number(planOriginMode));
    const originCoords = originStop ? { lat: originStop.lat, lng: originStop.lng } : userLocation;
    const originLabel = originStop ? originStop.name : 'Sua localização atual';

    const opts = planTrips({
      origin: originCoords,
      originLabel,
      destination: { lat: destStop.lat, lng: destStop.lng },
      destinationLabel: destStop.name,
      accessibleOnly,
    });

    setPlanOptions(opts);
    setSelectedPlan(opts[0] ?? null);
    if (opts[0]) {
      setMapCenter(originCoords);
      setMapZoom(13);
    } else {
      setPlanError('Nenhuma rota compatível encontrada com os filtros atuais.');
    }
  };

  const handleSubmitComplaint = (e: React.FormEvent) => {
    e.preventDefault();
    if (compDescription.trim().length < 5) {
      showToast('Descreva a ocorrência com pelo menos 5 caracteres.');
      return;
    }
    const created = submitComplaint({
      lineId: compLineId ? Number(compLineId) : null,
      busId: compBusId ? Number(compBusId) : null,
      driverName: null,
      category: compCategory,
      description: compDescription,
      attachmentName: null,
    });
    setCreatedProtocol(created.protocol);
    setTrackProtocolInput(created.protocol);
    setTrackedComplaint(created);
    setCompDescription('');
    showToast(`Solicitação registrada! Protocolo ${created.protocol}`);
  };

  const handleTrackProtocol = (e: React.FormEvent) => {
    e.preventDefault();
    setTrackError(null);
    const found = trackComplaint(trackProtocolInput);
    if (!found) {
      setTrackedComplaint(null);
      setTrackError('Protocolo não encontrado nesta demonstração.');
      return;
    }
    setTrackedComplaint(found);
  };

  const handleSubmitRating = (e: React.FormEvent) => {
    e.preventDefault();
    submitRating({
      lineId: Number(rateLineId),
      busId: rateBusId ? Number(rateBusId) : null,
      serviceQuality: rateService,
      punctuality: ratePunctuality,
      vehicleCondition: rateVehicle,
      cleanliness: rateVehicle,
      comfort: rateService,
      comment: rateComment,
    });
    setRateComment('');
    showToast('Avaliação registrada com sucesso!');
  };

  const filteredNotices = useMemo(() => {
    if (noticeFilter === 'todos') return notices;
    return notices.filter((n) => n.category === noticeFilter);
  }, [notices, noticeFilter]);

  const unreadAlertsCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="min-h-screen bg-[#F3EBDD] text-[#292D26] pb-20 lg:pb-10">
      {/* Top Bar Contract (3 zones, single-line controls) */}
      <header className="sticky top-0 z-30 border-b border-[#292D26]/10 bg-[#F3EBDD]/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 sm:gap-8 px-4 py-3 sm:px-6">
          <button
            type="button"
            onClick={() => {
              setTab('home');
              setHomeMode('overview');
            }}
            className="font-display text-lg font-bold tracking-tight text-[#292D26] whitespace-nowrap shrink-0 cursor-pointer"
          >
            MobiliCidade Rio
          </button>

          <nav className="hidden lg:flex items-center gap-6 text-sm font-medium text-[#74766C]">
            {(
              [
                ['home', 'Início'],
                ['plan', 'Planejar'],
                ['favorites', 'Favoritos'],
                ['alerts', 'Avisos'],
                ['profile', 'Perfil'],
              ] as [PassengerTab, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setTab(key);
                  if (key === 'alerts') markAllNotificationsRead();
                }}
                className={`whitespace-nowrap shrink-0 py-1 transition-colors cursor-pointer ${
                  tab === key
                    ? 'text-[#292D26] font-semibold border-b-2 border-[#E8C547]'
                    : 'hover:text-[#292D26]'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setTab('alerts');
                markAllNotificationsRead();
              }}
              aria-label="Avisos e alertas"
              className="relative flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl border border-[#292D26]/12 bg-[#FFFDF8] text-[#292D26] hover:bg-[#E8C547]/25 transition-colors cursor-pointer"
            >
              <Bell className="h-4 w-4" />
              {unreadAlertsCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#D9534F] px-1 font-mono text-[10px] font-bold text-white tabular-nums">
                  {unreadAlertsCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={onSwitchToAdmin}
              className="min-h-[40px] rounded-xl bg-[#E8C547] px-3.5 py-2 text-xs font-bold text-[#292D26] hover:bg-[#E8C547]/85 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Painel Gestor (Demo)
            </button>
          </div>
        </div>
      </header>

      {/* Feedback Banner */}
      {feedbackBanner && (
        <div className="mx-auto max-w-7xl px-4 pt-3 sm:px-6">
          <div className="flex items-center justify-between rounded-xl border border-[#292D26]/15 bg-[#A8D929]/35 px-4 py-2.5 text-sm font-medium text-[#292D26]">
            <span>{feedbackBanner}</span>
            <button
              type="button"
              onClick={() => setFeedbackBanner(null)}
              className="text-xs underline ml-4 cursor-pointer"
            >
              Fechar
            </button>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="mx-auto max-w-7xl px-4 pt-4 sm:px-6 space-y-4">
        {/* ==================== TAB 1: INÍCIO ==================== */}
        {tab === 'home' && (
          <div className="space-y-4">
            {/* Search & Action Bar */}
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#74766C]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar destino, bairro, linha (ex: 101) ou ponto no Rio..."
                  className="h-11 w-full rounded-xl border border-[#292D26]/15 bg-[#FFFDF8] pl-10 pr-4 text-sm text-[#292D26] placeholder:text-[#74766C]"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={requestGpsLocation}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[#292D26]/12 bg-[#FFFDF8] px-3.5 text-xs font-semibold text-[#292D26] hover:bg-[#E8C547]/25 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <LocateFixed className="h-4 w-4" />
                  Minha posição
                </button>
                <button
                  type="button"
                  onClick={() => setAccessibleOnly((v) => !v)}
                  className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl border px-3.5 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    accessibleOnly
                      ? 'border-[#292D26] bg-[#E8C547] text-[#292D26]'
                      : 'border-[#292D26]/12 bg-[#FFFDF8] text-[#292D26]'
                  }`}
                >
                  <Accessibility className="h-4 w-4" />
                  Acessível (PCD)
                </button>
                <button
                  type="button"
                  onClick={toggleSimulation}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[#292D26]/12 bg-[#FFFDF8] px-3.5 text-xs font-semibold text-[#292D26] hover:bg-[#F3EBDD] whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {simulationRunning ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  {simulationRunning ? 'Pausar simulação' : 'Retomar simulação'}
                </button>
              </div>
            </div>

            {/* Quick Favorites & Mode Switcher */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                <button
                  type="button"
                  onClick={() => setHomeMode('overview')}
                  className={`min-h-[38px] rounded-xl px-3.5 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    homeMode === 'overview'
                      ? 'bg-[#292D26] text-[#FFFDF8]'
                      : 'bg-[#FFFDF8] text-[#74766C] border border-[#292D26]/10'
                  }`}
                >
                  Mapa e Chegadas
                </button>
                <button
                  type="button"
                  onClick={() => setHomeMode('itineraries')}
                  className={`min-h-[38px] rounded-xl px-3.5 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    homeMode === 'itineraries'
                      ? 'bg-[#292D26] text-[#FFFDF8]'
                      : 'bg-[#FFFDF8] text-[#74766C] border border-[#292D26]/10'
                  }`}
                >
                  Itinerários ({filteredLines.length})
                </button>
                <button
                  type="button"
                  onClick={() => setHomeMode('stops')}
                  className={`min-h-[38px] rounded-xl px-3.5 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    homeMode === 'stops'
                      ? 'bg-[#292D26] text-[#FFFDF8]'
                      : 'bg-[#FFFDF8] text-[#74766C] border border-[#292D26]/10'
                  }`}
                >
                  Pontos de Ônibus ({filteredStops.length})
                </button>
              </div>

              {/* Quick Favorites Strip */}
              <div className="flex items-center gap-1.5 overflow-x-auto">
                <span className="text-xs text-[#74766C] whitespace-nowrap">Favoritos rápidos:</span>
                {favorites.slice(0, 3).map((fav) => (
                  <button
                    key={fav.id}
                    type="button"
                    onClick={() => {
                      if (fav.targetType === 'line') {
                        const ln = lines.find((l) => String(l.id) === fav.targetId);
                        if (ln) {
                          setSelectedLine(ln);
                          setHomeMode('itineraries');
                          if (ln.polyline[0]) setMapCenter(ln.polyline[0]);
                        }
                      } else if (fav.targetType === 'stop') {
                        const st = stops.find((s) => String(s.id) === fav.targetId);
                        if (st) {
                          setSelectedStop(st);
                          setHomeMode('overview');
                          setMapCenter({ lat: st.lat, lng: st.lng });
                          setMapZoom(15);
                        }
                      } else if (fav.targetType === 'destination' && fav.meta?.stopId) {
                        setPlanDestStopId(Number(fav.meta.stopId));
                        setTab('plan');
                      }
                    }}
                    className="rounded-xl border border-[#292D26]/12 bg-[#FFFDF8] px-3 py-1.5 text-xs font-semibold text-[#292D26] hover:bg-[#E8C547]/35 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {fav.label.split(' · ')[0]}
                  </button>
                ))}
              </div>
            </div>

            {/* Search Instant Suggestions when typing */}
            {searchQuery.trim().length > 0 && homeMode === 'overview' && (
              <div className="rounded-2xl border border-[#292D26]/10 bg-[#FFFDF8] p-3.5 shadow-sm grid gap-3 md:grid-cols-2">
                <div>
                  <p className="text-xs font-semibold text-[#74766C] mb-2">
                    Linhas correspondentes ({filteredLines.length})
                  </p>
                  {filteredLines.length === 0 ? (
                    <p className="text-xs text-[#74766C]">Nenhuma linha encontrada.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {filteredLines.slice(0, 3).map((ln) => (
                        <button
                          key={ln.id}
                          type="button"
                          onClick={() => {
                            setSelectedLine(ln);
                            setHomeMode('itineraries');
                            if (ln.polyline[0]) setMapCenter(ln.polyline[0]);
                          }}
                          className="w-full flex items-center justify-between rounded-xl bg-[#F3EBDD]/60 px-3 py-2 text-left text-xs hover:bg-[#E8C547]/30 cursor-pointer"
                        >
                          <span className="font-semibold text-[#292D26] truncate">
                            {ln.code} · {ln.name}
                          </span>
                          <ArrowRight className="h-3.5 w-3.5 shrink-0" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <p className="text-xs font-semibold text-[#74766C] mb-2">
                    Pontos correspondentes ({filteredStops.length})
                  </p>
                  {filteredStops.length === 0 ? (
                    <p className="text-xs text-[#74766C]">Nenhum ponto encontrado.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {filteredStops.slice(0, 3).map((st) => (
                        <button
                          key={st.id}
                          type="button"
                          onClick={() => {
                            setSelectedStop(st);
                            setMapCenter({ lat: st.lat, lng: st.lng });
                            setMapZoom(15);
                          }}
                          className="w-full flex items-center justify-between rounded-xl bg-[#F3EBDD]/60 px-3 py-2 text-left text-xs hover:bg-[#E8C547]/30 cursor-pointer"
                        >
                          <span className="font-semibold text-[#292D26] truncate">
                            {st.code} · {st.name}
                          </span>
                          <span className="font-mono text-[11px] text-[#74766C] shrink-0">
                            {st.distanceMeters}m
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Main Grid: OpenStreetMap + Contextual Right Column */}
            <div className="grid gap-4 lg:grid-cols-12 items-start">
              {/* Left 7/8 cols: Interactive OpenStreetMap */}
              <div className="lg:col-span-7 xl:col-span-8 space-y-2.5">
                <TransitMap
                  center={mapCenter}
                  zoom={mapZoom}
                  lines={
                    homeMode === 'itineraries' && selectedLine ? [selectedLine] : filteredLines
                  }
                  stops={
                    homeMode === 'itineraries' && selectedLine
                      ? selectedLineOrderedStops
                          .map((ls) => ls.stop)
                          .filter((s): s is Stop => Boolean(s))
                      : stops.filter((s) => !accessibleOnly || s.accessible)
                  }
                  buses={
                    homeMode === 'itineraries' && selectedLine
                      ? activeBuses.filter((b) => b.activeLineId === selectedLine.id)
                      : activeBuses
                  }
                  userLocation={userLocation}
                  selectedStopId={inspectedStop?.id}
                  selectedLineId={selectedLine?.id}
                  walkingTargetStop={walkingTargetStop}
                  onSelectStop={(st) => {
                    setSelectedStop(st);
                    setHomeMode('overview');
                    setMapCenter({ lat: st.lat, lng: st.lng });
                  }}
                  onSelectBus={(b) => {
                    if (b.activeLineId) {
                      const ln = lines.find((l) => l.id === b.activeLineId) ?? null;
                      setSelectedLine(ln);
                    }
                  }}
                  className="h-[370px] sm:h-[480px] w-full shadow-sm"
                />

                <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-[#74766C]">
                  <span>
                    {geoLabel} · Dados demonstrativos simulados em tempo real (OpenStreetMap)
                  </span>
                  <span className="font-mono tabular-nums text-[#292D26]">
                    {activeBuses.length} ônibus em circulação · {lines.length} linhas
                  </span>
                </div>
              </div>

              {/* Right 5/4 cols: Overview Arrivals & Nearby Stops OR Itineraries OR Stops Explorer */}
              <div className="lg:col-span-5 xl:col-span-4 space-y-4">
                {homeMode === 'overview' && (
                  <>
                    {/* Próximas Chegadas no Ponto Selecionado */}
                    {inspectedStop && (
                      <div className="rounded-2xl border border-[#292D26]/10 bg-[#FFFDF8] p-4 shadow-sm space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs text-[#74766C]">
                              {inspectedStop.code} · {inspectedStop.neighborhood} ·{' '}
                              {inspectedStop.accessible ? 'Ponto acessível' : 'Acessibilidade parcial'}
                            </p>
                            <h2 className="text-base font-bold text-[#292D26] mt-0.5 truncate">
                              {inspectedStop.name}
                            </h2>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              isStopFavorited(inspectedStop.id)
                                ? showToast('Este ponto já está nos seus favoritos.')
                                : (addFavorite(
                                    'stop',
                                    String(inspectedStop.id),
                                    `${inspectedStop.name} (${inspectedStop.code})`,
                                    { code: inspectedStop.code }
                                  ),
                                  showToast(`Ponto favoritado: ${inspectedStop.name}`))
                            }
                            aria-label="Favoritar ponto"
                            className={`flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl border transition-colors cursor-pointer ${
                              isStopFavorited(inspectedStop.id)
                                ? 'border-[#292D26] bg-[#E8C547] text-[#292D26]'
                                : 'border-[#292D26]/15 bg-[#F3EBDD] text-[#292D26]'
                            }`}
                          >
                            <Heart className="h-4 w-4" />
                          </button>
                        </div>

                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setWalkingTargetStop(inspectedStop)}
                            className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#A8D929] px-3 text-xs font-bold text-[#292D26] cursor-pointer"
                          >
                            <Navigation className="h-3.5 w-3.5" />
                            Trajeto a pé até o ponto
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setPlanDestStopId(inspectedStop.id);
                              setTab('plan');
                            }}
                            className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-[#292D26]/15 bg-[#FFFDF8] px-3 text-xs font-semibold text-[#292D26] cursor-pointer"
                          >
                            Ir até aqui
                          </button>
                        </div>

                        <div className="border-t border-[#292D26]/10 pt-3 space-y-2">
                          <h3 className="text-xs font-semibold text-[#292D26]">
                            Próximas chegadas previstas
                          </h3>

                          {stopArrivals.length === 0 ? (
                            <p className="text-xs text-[#74766C] py-2">
                              Nenhuma linha ativa atendendo este ponto com os filtros atuais.
                            </p>
                          ) : (
                            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                              {stopArrivals.map((pred, i) => {
                                const st = ARRIVAL_STATUS_STYLE[pred.arrivalStatus];
                                return (
                                  <div
                                    key={`${pred.lineId}-${pred.busId}-${i}`}
                                    className="rounded-xl border border-[#292D26]/10 bg-[#F3EBDD]/55 p-3 space-y-1.5"
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="flex items-center gap-2 min-w-0">
                                        <span
                                          className="inline-flex items-center justify-center rounded-md px-2 py-0.5 font-mono text-xs font-bold text-white shrink-0"
                                          style={{ backgroundColor: pred.lineColor }}
                                        >
                                          {pred.lineCode}
                                        </span>
                                        <span className="font-mono text-xs font-semibold text-[#292D26] truncate">
                                          Veículo #{pred.unitNumber}
                                        </span>
                                      </div>

                                      {pred.available ? (
                                        <span className="font-mono text-sm font-bold tabular-nums text-[#292D26] shrink-0">
                                          {pred.etaMinutes} min
                                        </span>
                                      ) : (
                                        <span className="text-xs font-semibold text-[#74766C]">
                                          —
                                        </span>
                                      )}
                                    </div>

                                    <div className="flex items-center justify-between gap-2 text-xs">
                                      <span className="text-[#74766C] truncate">
                                        Sentido {pred.direction}
                                      </span>
                                      <span
                                        className={`rounded-md px-2 py-0.5 text-[11px] font-bold shrink-0 ${st.bg} ${st.text}`}
                                      >
                                        {st.label}
                                      </span>
                                    </div>

                                    {pred.available ? (
                                      <p className="font-mono text-[11px] tabular-nums text-[#74766C]">
                                        Horário estimado:{' '}
                                        {pred.estimatedArrivalIso
                                          ? new Date(pred.estimatedArrivalIso).toLocaleTimeString(
                                              'pt-BR',
                                              { hour: '2-digit', minute: '2-digit' }
                                            )
                                          : '--:--'}{' '}
                                        · {pred.distanceMeters}m ·{' '}
                                        {pred.accessible ? 'Adaptado PCD' : 'Convencional'}
                                      </p>
                                    ) : (
                                      <p className="text-[11px] text-[#74766C]">
                                        {pred.unavailableReason}
                                      </p>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Pontos Próximos */}
                    <div className="rounded-2xl border border-[#292D26]/10 bg-[#FFFDF8] p-4 shadow-sm space-y-2.5">
                      <div className="flex items-center justify-between">
                        <h2 className="text-sm font-bold text-[#292D26]">Pontos de ônibus próximos</h2>
                        <button
                          type="button"
                          onClick={() => setHomeMode('stops')}
                          className="text-xs font-semibold text-[#292D26] underline cursor-pointer"
                        >
                          Ver todos
                        </button>
                      </div>
                      <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                        {nearbyStops.slice(0, 5).map((st) => (
                          <button
                            key={st.id}
                            type="button"
                            onClick={() => {
                              setSelectedStop(st);
                              setMapCenter({ lat: st.lat, lng: st.lng });
                              setMapZoom(15);
                            }}
                            className={`w-full text-left rounded-xl border p-2.5 transition-colors cursor-pointer ${
                              inspectedStop?.id === st.id
                                ? 'border-[#292D26] bg-[#E8C547]/25'
                                : 'border-[#292D26]/10 bg-[#F3EBDD]/45 hover:bg-[#E8C547]/15'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-bold text-[#292D26] truncate">
                                {st.name}
                              </span>
                              <span className="font-mono text-xs font-semibold tabular-nums text-[#292D26] shrink-0">
                                {st.distanceMeters}m
                              </span>
                            </div>
                            <p className="text-[11px] text-[#74766C] mt-0.5 truncate">
                              Linhas: {st.servingLines.map((l) => l.code).join(', ') || '—'} ·{' '}
                              {st.walkMinutes} min a pé
                            </p>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Ônibus em Circulação */}
                    <div className="rounded-2xl border border-[#292D26]/10 bg-[#FFFDF8] p-4 shadow-sm space-y-2.5">
                      <div className="flex items-center justify-between">
                        <h2 className="text-sm font-bold text-[#292D26]">
                          Ônibus em circulação ({activeBuses.length})
                        </h2>
                        <button
                          type="button"
                          onClick={() => setHomeMode('itineraries')}
                          className="text-xs font-semibold text-[#292D26] underline cursor-pointer"
                        >
                          Itinerários
                        </button>
                      </div>
                      <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                        {activeBuses.slice(0, 6).map((b) => (
                          <button
                            key={b.id}
                            type="button"
                            onClick={() => {
                              if (b.lat != null && b.lng != null) {
                                setMapCenter({ lat: b.lat, lng: b.lng });
                                setMapZoom(15);
                              }
                            }}
                            className="w-full flex items-center justify-between rounded-xl border border-[#292D26]/10 px-3 py-2 text-left text-xs hover:bg-[#F3EBDD]/60 cursor-pointer"
                          >
                            <span className="font-mono font-bold text-[#292D26]">
                              Linha {b.activeLineCode} · #{b.unitNumber}
                            </span>
                            <span className="font-mono tabular-nums text-[#74766C]">
                              {Math.round(b.speedKmh ?? 0)} km/h ·{' '}
                              {b.offRoute ? 'Desvio' : 'Normal'}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {/* ITINERÁRIOS VIEW */}
                {homeMode === 'itineraries' && (
                  <div className="space-y-3">
                    <div className="rounded-2xl border border-[#292D26]/10 bg-[#FFFDF8] p-4 shadow-sm space-y-2.5">
                      <h2 className="text-base font-bold text-[#292D26]">Linhas e Itinerários</h2>
                      <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                        {filteredLines.map((line) => {
                          const isSel = selectedLine?.id === line.id;
                          return (
                            <button
                              key={line.id}
                              type="button"
                              onClick={() => {
                                setSelectedLine(line);
                                if (line.polyline[0]) {
                                  setMapCenter(line.polyline[0]);
                                  setMapZoom(13);
                                }
                              }}
                              className={`w-full text-left rounded-xl border p-3 transition-colors cursor-pointer ${
                                isSel
                                  ? 'border-[#292D26] bg-[#E8C547]/25'
                                  : 'border-[#292D26]/10 bg-[#F3EBDD]/45 hover:bg-[#E8C547]/15'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span
                                    className="inline-block h-3 w-3 rounded-full shrink-0"
                                    style={{ backgroundColor: line.color }}
                                  />
                                  <span className="font-mono text-xs font-bold text-[#292D26] truncate">
                                    {line.code} · {line.name}
                                  </span>
                                </div>
                                <span className="font-mono text-[11px] text-[#74766C] shrink-0">
                                  {line.scheduledKm.toFixed(1)} km
                                </span>
                              </div>
                              <p className="text-[11px] text-[#74766C] mt-1">
                                {line.origin} ↔ {line.destination}
                              </p>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {selectedLine ? (
                      <div className="rounded-2xl border border-[#292D26]/10 bg-[#FFFDF8] p-4 shadow-sm space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <h3 className="text-sm font-bold text-[#292D26]">
                              Linha {selectedLine.code} — {selectedLine.name}
                            </h3>
                            <p className="text-xs text-[#74766C] mt-0.5">
                              {selectedLine.operatingHours} · A cada {selectedLine.frequencyMin} min
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              if (!isLineFavorited(selectedLine.id)) {
                                addFavorite(
                                  'line',
                                  String(selectedLine.id),
                                  `${selectedLine.code} · ${selectedLine.name}`,
                                  { code: selectedLine.code, color: selectedLine.color }
                                );
                                showToast(`Linha ${selectedLine.code} favoritada!`);
                              }
                            }}
                            className="rounded-xl bg-[#E8C547] px-3 py-1.5 text-xs font-bold text-[#292D26] shrink-0 cursor-pointer"
                          >
                            {isLineFavorited(selectedLine.id) ? 'Favorita' : 'Favoritar'}
                          </button>
                        </div>

                        {/* Direction Switcher (Ida / Volta) */}
                        <div className="grid grid-cols-2 gap-1 rounded-xl bg-[#F3EBDD] p-1">
                          <button
                            type="button"
                            onClick={() => setItineraryDirection('ida')}
                            className={`rounded-lg py-1.5 text-xs font-semibold cursor-pointer ${
                              itineraryDirection === 'ida'
                                ? 'bg-[#FFFDF8] text-[#292D26] shadow-sm'
                                : 'text-[#74766C]'
                            }`}
                          >
                            Sentido: {selectedLine.destination}
                          </button>
                          <button
                            type="button"
                            onClick={() => setItineraryDirection('volta')}
                            className={`rounded-lg py-1.5 text-xs font-semibold cursor-pointer ${
                              itineraryDirection === 'volta'
                                ? 'bg-[#FFFDF8] text-[#292D26] shadow-sm'
                                : 'text-[#74766C]'
                            }`}
                          >
                            Sentido: {selectedLine.origin}
                          </button>
                        </div>

                        <div className="text-xs text-[#74766C]">
                          Horários programados:{' '}
                          <span className="font-mono text-[#292D26]">
                            {selectedLine.scheduledDepartures.join(' · ')}
                          </span>
                        </div>

                        <div className="border-t border-[#292D26]/10 pt-2.5 space-y-1.5 max-h-56 overflow-y-auto pr-1">
                          {selectedLineOrderedStops.map((ls) => (
                            <button
                              key={ls.id}
                              type="button"
                              onClick={() => {
                                if (ls.stop) {
                                  setSelectedStop(ls.stop);
                                  setMapCenter({ lat: ls.stop.lat, lng: ls.stop.lng });
                                  setMapZoom(15);
                                }
                              }}
                              className="w-full flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs hover:bg-[#F3EBDD] cursor-pointer"
                            >
                              <span className="font-medium text-[#292D26] truncate">
                                <span className="font-mono text-[#74766C] mr-2">
                                  {String(ls.sequence).padStart(2, '0')}
                                </span>
                                {ls.stop?.name}
                              </span>
                              <span className="font-mono text-[11px] tabular-nums text-[#74766C] shrink-0">
                                +{ls.scheduledOffsetMin} min
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-[#292D26]/10 bg-[#FFFDF8] p-4 text-xs text-[#74766C]">
                        Selecione uma linha acima para visualizar o percurso completo, paradas e horários.
                      </div>
                    )}
                  </div>
                )}

                {/* PONTOS DE ÔNIBUS VIEW */}
                {homeMode === 'stops' && (
                  <div className="rounded-2xl border border-[#292D26]/10 bg-[#FFFDF8] p-4 shadow-sm space-y-3">
                    <h2 className="text-base font-bold text-[#292D26]">
                      Pontos de Ônibus ({filteredStops.length})
                    </h2>
                    <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
                      {filteredStops.map((st) => (
                        <div
                          key={st.id}
                          className="rounded-xl border border-[#292D26]/10 bg-[#F3EBDD]/45 p-3 space-y-1.5"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedStop(st);
                                setHomeMode('overview');
                                setMapCenter({ lat: st.lat, lng: st.lng });
                                setMapZoom(15);
                              }}
                              className="text-left min-w-0 flex-1 cursor-pointer"
                            >
                              <p className="text-xs font-bold text-[#292D26] truncate">
                                {st.code} · {st.name}
                              </p>
                              <p className="text-[11px] text-[#74766C]">
                                {st.neighborhood} · {st.distanceMeters}m ({st.walkMinutes} min a pé)
                              </p>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                addFavorite('stop', String(st.id), `${st.name} (${st.code})`, {
                                  code: st.code,
                                });
                                showToast(`Ponto favoritado: ${st.name}`);
                              }}
                              className="rounded-lg bg-[#FFFDF8] border border-[#292D26]/12 px-2 py-1 text-[11px] font-semibold text-[#292D26] cursor-pointer"
                            >
                              {isStopFavorited(st.id) ? 'Favorito' : 'Favoritar'}
                            </button>
                          </div>
                          <p className="text-[11px] text-[#74766C]">
                            Linhas:{' '}
                            <span className="font-mono font-semibold text-[#292D26]">
                              {st.servingLines.map((l) => l.code).join(' · ') || 'Nenhuma'}
                            </span>{' '}
                            · {st.accessible ? 'Acessível (PCD)' : 'Padrão'}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ==================== TAB 2: PLANEJAR VIAGEM ==================== */}
        {tab === 'plan' && (
          <div className="grid gap-4 lg:grid-cols-12 items-start">
            <div className="lg:col-span-5 space-y-4">
              <form
                onSubmit={handlePlanTrip}
                className="rounded-2xl border border-[#292D26]/10 bg-[#FFFDF8] p-5 shadow-sm space-y-4"
              >
                <div>
                  <h1 className="text-xl font-bold text-[#292D26]">Planejar Viagem</h1>
                  <p className="text-xs text-[#74766C] mt-0.5">
                    Encontre rotas diretas ou com baldeação pelos corredores do Rio de Janeiro.
                  </p>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-[#292D26] mb-1">
                      Origem
                    </label>
                    <select
                      value={String(planOriginMode)}
                      onChange={(e) =>
                        setPlanOriginMode(e.target.value === 'gps' ? 'gps' : Number(e.target.value))
                      }
                      className="h-11 w-full rounded-xl border border-[#292D26]/15 bg-[#F3EBDD]/60 px-3 text-sm"
                    >
                      <option value="gps">Minha localização atual ({geoLabel})</option>
                      {stops.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.code} · {s.name} ({s.neighborhood})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#292D26] mb-1">
                      Destino desejado
                    </label>
                    <select
                      value={planDestStopId}
                      onChange={(e) => setPlanDestStopId(Number(e.target.value))}
                      className="h-11 w-full rounded-xl border border-[#292D26]/15 bg-[#F3EBDD]/60 px-3 text-sm"
                    >
                      {stops.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.code} · {s.name} ({s.neighborhood})
                        </option>
                      ))}
                    </select>
                  </div>

                  <label className="flex items-center gap-2.5 text-xs font-medium text-[#292D26] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={accessibleOnly}
                      onChange={(e) => setAccessibleOnly(e.target.checked)}
                      className="h-4 w-4 accent-[#292D26]"
                    />
                    Somente veículos e pontos adaptados (PCD)
                  </label>
                </div>

                {planError && <p className="text-xs font-medium text-[#D9534F]">{planError}</p>}

                <button
                  type="submit"
                  className="h-11 w-full rounded-xl bg-[#A8D929] text-sm font-bold text-[#292D26] hover:bg-[#A8D929]/90 transition-colors cursor-pointer"
                >
                  Traçar melhores rotas
                </button>
              </form>

              {/* Ranked Options */}
              {planOptions.length > 0 && (
                <div className="space-y-3">
                  <h2 className="text-sm font-bold text-[#292D26]">
                    Opções sugeridas ({planOptions.length})
                  </h2>
                  {planOptions.map((opt, idx) => {
                    const isSel = selectedPlan?.id === opt.id;
                    return (
                      <div
                        key={opt.id}
                        onClick={() => setSelectedPlan(opt)}
                        className={`rounded-2xl border p-4 cursor-pointer transition-colors ${
                          isSel
                            ? 'border-[#292D26] bg-[#FFFDF8] shadow-sm'
                            : 'border-[#292D26]/10 bg-[#FFFDF8]/75 hover:bg-[#FFFDF8]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-[#74766C]">
                            Opção {idx + 1} ·{' '}
                            {opt.transfers === 0 ? 'Viagem direta' : `${opt.transfers} baldeação`}
                            {opt.accessible ? ' · Acessível' : ''}
                          </span>
                          <span className="font-mono text-base font-bold tabular-nums text-[#292D26]">
                            {opt.totalMinutes} min
                          </span>
                        </div>

                        <p className="font-mono text-xs tabular-nums text-[#74766C] mt-1">
                          {(opt.totalDistanceMeters / 1000).toFixed(1)} km totais ·{' '}
                          {opt.walkMinutes} min a pé
                        </p>

                        <div className="mt-3 space-y-2 border-t border-[#292D26]/10 pt-2.5">
                          {opt.legs.map((leg, lIdx) => (
                            <div key={lIdx} className="flex items-start gap-2 text-xs">
                              <span
                                className="mt-0.5 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold shrink-0"
                                style={{
                                  backgroundColor:
                                    leg.type === 'walk' ? '#F3EBDD' : leg.lineColor || '#E8C547',
                                  color: leg.type === 'walk' ? '#292D26' : '#FFFFFF',
                                }}
                              >
                                {leg.type === 'walk' ? 'A PÉ' : leg.lineCode}
                              </span>
                              <div className="min-w-0">
                                <p className="font-medium text-[#292D26]">
                                  {leg.fromName} → {leg.toName}
                                </p>
                                <p className="text-[11px] text-[#74766C] font-mono tabular-nums">
                                  {leg.durationMinutes} min · {leg.distanceMeters}m
                                  {leg.scheduledDeparture ? ` · ${leg.scheduledDeparture}` : ''}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>

                        <div className="mt-3 flex justify-end">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              const destStop = stops.find((s) => s.id === Number(planDestStopId));
                              addFavorite(
                                'route',
                                opt.id,
                                `Rota até ${destStop?.name || 'Destino'} (${opt.totalMinutes} min)`,
                                { opt }
                              );
                              showToast('Rota salva nos seus favoritos.');
                            }}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-[#292D26] underline cursor-pointer"
                          >
                            <Bookmark className="h-3.5 w-3.5" />
                            Salvar rota nos favoritos
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="lg:col-span-7">
              <TransitMap
                center={mapCenter}
                zoom={mapZoom}
                lines={selectedPlan ? [] : lines}
                stops={stops}
                buses={activeBuses}
                userLocation={userLocation}
                plannedTrip={selectedPlan}
                className="h-[420px] lg:h-[600px] w-full shadow-sm"
              />
            </div>
          </div>
        )}

        {/* ==================== TAB 3: FAVORITOS ==================== */}
        {tab === 'favorites' && (
          <div className="mx-auto max-w-4xl space-y-4">
            <div className="rounded-2xl border border-[#292D26]/10 bg-[#FFFDF8] p-5 shadow-sm space-y-4">
              <div>
                <h1 className="text-xl font-bold text-[#292D26]">Seus Favoritos</h1>
                <p className="text-xs text-[#74766C] mt-0.5">
                  Linhas favoritas, pontos salvos e destinos frequentes no Rio de Janeiro.
                </p>
              </div>

              {/* Frequent Destinations */}
              <div className="space-y-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-[#74766C]">
                  Destinos frequentes
                </h2>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {frequentDestinations.map((dest) => (
                    <button
                      key={dest.id}
                      type="button"
                      onClick={() => {
                        setPlanDestStopId(dest.stopId);
                        setTab('plan');
                      }}
                      className="flex items-center justify-between rounded-xl border border-[#292D26]/10 bg-[#F3EBDD]/55 p-3.5 text-left hover:bg-[#E8C547]/25 transition-colors cursor-pointer"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-[#292D26] truncate">{dest.name}</p>
                        <p className="text-xs text-[#74766C]">
                          {dest.neighborhood} · {dest.category}
                        </p>
                      </div>
                      <span className="rounded-lg bg-[#A8D929] px-2.5 py-1 text-[11px] font-bold text-[#292D26] shrink-0">
                        Traçar rota
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Saved Favorite Lines, Stops & Routes */}
              <div className="space-y-2 border-t border-[#292D26]/10 pt-4">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-[#74766C]">
                  Linhas, pontos e rotas salvos ({favorites.length})
                </h2>

                {favorites.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[#292D26]/20 p-6 text-center space-y-1">
                    <p className="text-sm font-semibold text-[#292D26]">
                      Nenhum favorito salvo ainda
                    </p>
                    <p className="text-xs text-[#74766C]">
                      Toque no coração de um ponto, linha ou rota para adicioná-lo aqui.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {favorites.map((fav) => (
                      <div
                        key={fav.id}
                        className="flex items-center justify-between gap-3 rounded-xl border border-[#292D26]/10 bg-[#F3EBDD]/45 p-3.5"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            if (fav.targetType === 'stop') {
                              const st = stops.find((s) => String(s.id) === fav.targetId);
                              if (st) {
                                setSelectedStop(st);
                                setHomeMode('overview');
                                setMapCenter({ lat: st.lat, lng: st.lng });
                                setMapZoom(15);
                                setTab('home');
                              }
                            } else if (fav.targetType === 'line') {
                              const ln = lines.find((l) => String(l.id) === fav.targetId);
                              if (ln) {
                                setSelectedLine(ln);
                                setHomeMode('itineraries');
                                if (ln.polyline[0]) setMapCenter(ln.polyline[0]);
                                setTab('home');
                              }
                            } else if (fav.targetType === 'route' && fav.meta?.opt) {
                              setSelectedPlan(fav.meta.opt as PlannedTripOption);
                              setPlanOptions([fav.meta.opt as PlannedTripOption]);
                              setTab('plan');
                            } else if (fav.targetType === 'destination' && fav.meta?.stopId) {
                              setPlanDestStopId(Number(fav.meta.stopId));
                              setTab('plan');
                            }
                          }}
                          className="text-left min-w-0 flex-1 cursor-pointer"
                        >
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#74766C]">
                            {fav.targetType === 'line'
                              ? 'Linha favorita'
                              : fav.targetType === 'stop'
                                ? 'Ponto favorito'
                                : fav.targetType === 'route'
                                  ? 'Rota salva'
                                  : 'Destino frequente'}
                          </p>
                          <p className="text-sm font-bold text-[#292D26] truncate">{fav.label}</p>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            removeFavorite(fav.id);
                            showToast('Favorito removido.');
                          }}
                          aria-label="Remover favorito"
                          className="flex min-h-[38px] min-w-[38px] items-center justify-center rounded-xl border border-[#292D26]/12 bg-[#FFFDF8] text-[#D9534F] hover:bg-[#D9534F]/10 cursor-pointer"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ==================== TAB 4: AVISOS E ALERTAS ==================== */}
        {tab === 'alerts' && (
          <div className="mx-auto max-w-5xl space-y-4">
            <div className="rounded-2xl border border-[#292D26]/10 bg-[#FFFDF8] p-5 shadow-sm space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h1 className="text-xl font-bold text-[#292D26]">Avisos e Alertas da Operação</h1>
                  <p className="text-xs text-[#74766C] mt-0.5">
                    Atrasos, desvios, interrupções e comunicados em tempo real da rede.
                  </p>
                </div>

                {/* Category filter buttons */}
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      ['todos', 'Todos'],
                      ['desvio', 'Desvios'],
                      ['interrupcao', 'Interrupções'],
                      ['alteracao_temporaria', 'Itinerário'],
                      ['comunicado', 'Comunicados'],
                    ] as [NoticeFilter, string][]
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setNoticeFilter(key)}
                      className={`rounded-xl px-3 py-1.5 text-xs font-semibold cursor-pointer ${
                        noticeFilter === key
                          ? 'bg-[#E8C547] text-[#292D26]'
                          : 'bg-[#F3EBDD] text-[#74766C]'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                {filteredNotices.length === 0 ? (
                  <p className="text-sm text-[#74766C] py-4">
                    Nenhum aviso registrado nesta categoria.
                  </p>
                ) : (
                  filteredNotices.map((n) => (
                    <div
                      key={n.id}
                      className="rounded-xl border border-[#292D26]/10 bg-[#F3EBDD]/50 p-4 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-bold text-[#292D26]">
                          {NOTICE_CATEGORY_LABELS[n.category]}
                        </span>
                        <span className="font-mono tabular-nums text-[#74766C]">
                          {new Date(n.startTime).toLocaleTimeString('pt-BR', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      <h2 className="text-sm font-bold text-[#292D26]">{n.title}</h2>
                      <p className="text-xs text-[#74766C] leading-relaxed">{n.message}</p>
                      <p className="text-[11px] text-[#292D26]">
                        Linhas:{' '}
                        <span className="font-mono font-semibold">
                          {n.affectedLineIds.length > 0
                            ? n.affectedLineIds
                                .map((id) => lines.find((l) => l.id === id)?.code || `#${id}`)
                                .join(', ')
                            : 'Toda a rede'}
                        </span>
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Real-time Operational Event Feed */}
            <div className="rounded-2xl border border-[#292D26]/10 bg-[#FFFDF8] p-5 shadow-sm space-y-3">
              <h2 className="text-base font-bold text-[#292D26]">
                Ocorrências recentes detectadas pela simulação
              </h2>
              <div className="space-y-2">
                {notifications.map((n) => (
                  <div
                    key={n.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-[#292D26]/10 bg-[#F3EBDD]/40 px-3.5 py-2.5"
                  >
                    <div className="min-w-0">
                      <p
                        className={`text-[11px] font-bold ${
                          n.severity === 'critica'
                            ? 'text-[#D9534F]'
                            : n.severity === 'atencao'
                              ? 'text-[#E99A36]'
                              : 'text-[#292D26]'
                        }`}
                      >
                        {n.severity === 'critica'
                          ? 'Alerta crítico'
                          : n.severity === 'atencao'
                            ? 'Atenção operacional'
                            : 'Comunicado'}
                      </p>
                      <p className="text-xs font-semibold text-[#292D26] truncate">{n.title}</p>
                    </div>
                    <span className="font-mono text-[11px] tabular-nums text-[#74766C] shrink-0">
                      {new Date(n.timestamp).toLocaleTimeString('pt-BR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ==================== TAB 5: PERFIL, ACESSIBILIDADE & OUVIDORIA ==================== */}
        {tab === 'profile' && (
          <div className="mx-auto max-w-5xl space-y-4">
            {/* Profile Header & Mode Switch */}
            <div className="rounded-2xl border border-[#292D26]/10 bg-[#FFFDF8] p-5 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <p className="text-xs text-[#74766C]">Perfil do Passageiro · Demonstração</p>
                <h1 className="text-xl font-bold text-[#292D26]">{user.name}</h1>
                <p className="text-xs text-[#74766C] mt-0.5">{user.email}</p>
              </div>
              <button
                type="button"
                onClick={onSwitchToAdmin}
                className="min-h-[44px] rounded-xl bg-[#E8C547] px-5 text-xs font-bold text-[#292D26] hover:bg-[#E8C547]/85 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Abrir Painel de Gestão Web (Demo)
              </button>
            </div>

            {/* Sub-navigation inside Profile */}
            <div className="flex flex-wrap gap-1.5 rounded-2xl border border-[#292D26]/10 bg-[#FFFDF8] p-1.5 w-fit">
              {(
                [
                  ['account', 'Preferências e Local'],
                  ['accessibility', 'Acessibilidade (PCD)'],
                  ['feedback', 'Reclamações e Avaliações'],
                ] as [ProfileSection, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setProfileSection(key)}
                  className={`rounded-xl px-3.5 py-2 text-xs font-semibold whitespace-nowrap cursor-pointer ${
                    profileSection === key
                      ? 'bg-[#E8C547] text-[#292D26]'
                      : 'text-[#74766C] hover:text-[#292D26]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {profileSection === 'account' && (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-[#292D26]/10 bg-[#FFFDF8] p-5 shadow-sm space-y-4">
                  <h2 className="text-base font-bold text-[#292D26]">Preferências de Uso</h2>
                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-[#292D26]">
                      Nome de exibição
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={profileName}
                        onChange={(e) => setProfileName(e.target.value)}
                        className="h-10 flex-1 rounded-xl border border-[#292D26]/15 bg-[#F3EBDD]/60 px-3 text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          updatePreferences({ name: profileName });
                          showToast('Nome atualizado.');
                        }}
                        className="h-10 rounded-xl bg-[#A8D929] px-4 text-xs font-bold text-[#292D26] cursor-pointer"
                      >
                        Salvar
                      </button>
                    </div>
                  </div>

                  <label className="flex items-center justify-between rounded-xl border border-[#292D26]/10 bg-[#F3EBDD]/50 p-3.5 text-xs font-semibold cursor-pointer">
                    <span>Filtrar apenas veículos e pontos acessíveis (PCD)</span>
                    <input
                      type="checkbox"
                      checked={accessibleOnly}
                      onChange={(e) => {
                        setAccessibleOnly(e.target.checked);
                        updatePreferences({ accessibilityNeeds: e.target.checked });
                      }}
                      className="h-4 w-4 accent-[#292D26]"
                    />
                  </label>

                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-[#292D26]">
                      Simular localização no Rio de Janeiro
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {RIO_LOCATION_PRESETS.map((preset) => (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => {
                            setUserLocation(preset.coords);
                            setMapCenter(preset.coords);
                            setMapZoom(14);
                            setGeoLabel(preset.label);
                            showToast(`Localização simulada: ${preset.label}`);
                          }}
                          className="rounded-xl border border-[#292D26]/12 bg-[#F3EBDD]/60 p-2.5 text-left text-xs font-medium text-[#292D26] hover:bg-[#E8C547]/30 cursor-pointer"
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-[#292D26]/10 bg-[#FFFDF8] p-5 shadow-sm space-y-2.5">
                  <h2 className="text-base font-bold text-[#292D26]">Preferências de Notificação</h2>
                  {(
                    [
                      ['delays', 'Atrasos nas linhas'],
                      ['routeChanges', 'Desvios e mudanças de itinerário'],
                      ['scheduleChanges', 'Alterações de horário'],
                      ['operationalIssues', 'Ocorrências operacionais'],
                      ['favoritesOnly', 'Somente linhas favoritas'],
                    ] as [keyof typeof user.notificationPrefs, string][]
                  ).map(([key, label]) => (
                    <label
                      key={key}
                      className="flex items-center justify-between rounded-xl border border-[#292D26]/10 px-3.5 py-2.5 text-xs font-medium cursor-pointer"
                    >
                      <span>{label}</span>
                      <input
                        type="checkbox"
                        checked={user.notificationPrefs[key]}
                        onChange={(e) =>
                          updatePreferences({
                            notificationPrefs: {
                              ...user.notificationPrefs,
                              [key]: e.target.checked,
                            },
                          })
                        }
                        className="h-4 w-4 accent-[#292D26]"
                      />
                    </label>
                  ))}
                </div>
              </div>
            )}

            {profileSection === 'accessibility' && (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-[#292D26]/10 bg-[#FFFDF8] p-5 shadow-sm space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-bold text-[#292D26]">
                      Ônibus Adaptados em Circulação
                    </h2>
                    <button
                      type="button"
                      onClick={() => {
                        setAccessibleOnly(true);
                        updatePreferences({ accessibilityNeeds: true });
                        setTab('home');
                      }}
                      className="rounded-xl bg-[#A8D929] px-3 py-1.5 text-xs font-bold text-[#292D26] cursor-pointer"
                    >
                      Filtrar no mapa
                    </button>
                  </div>
                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    {buses
                      .filter((b) => b.accessible)
                      .map((b) => (
                        <div
                          key={b.id}
                          className="flex items-center justify-between rounded-xl border border-[#292D26]/10 bg-[#F3EBDD]/50 p-3 text-xs"
                        >
                          <div>
                            <p className="font-mono font-bold text-[#292D26]">
                              Veículo #{b.unitNumber} · {b.model}
                            </p>
                            <p className="text-[#74766C]">
                              {b.activeLineCode
                                ? `Em operação na Linha ${b.activeLineCode}`
                                : `Status: ${b.status}`}
                            </p>
                          </div>
                          <Accessibility className="h-4 w-4 text-[#292D26] shrink-0" />
                        </div>
                      ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-[#292D26]/10 bg-[#FFFDF8] p-5 shadow-sm space-y-3">
                  <h2 className="text-base font-bold text-[#292D26]">
                    Pontos de Ônibus Acessíveis ({stops.filter((s) => s.accessible).length}/
                    {stops.length})
                  </h2>
                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    {stops
                      .filter((s) => s.accessible)
                      .map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => {
                            setSelectedStop(s);
                            setMapCenter({ lat: s.lat, lng: s.lng });
                            setMapZoom(15);
                            setTab('home');
                          }}
                          className="w-full flex items-center justify-between rounded-xl border border-[#292D26]/10 px-3 py-2 text-left text-xs hover:bg-[#F3EBDD] cursor-pointer"
                        >
                          <div className="min-w-0">
                            <p className="font-semibold text-[#292D26] truncate">
                              {s.code} · {s.name}
                            </p>
                            <p className="text-[#74766C] truncate">{s.address}</p>
                          </div>
                          <Accessibility className="h-4 w-4 text-[#292D26] shrink-0" />
                        </button>
                      ))}
                  </div>
                </div>
              </div>
            )}

            {profileSection === 'feedback' && (
              <div className="grid gap-4 lg:grid-cols-12 items-start">
                {/* Complaint Form */}
                <form
                  onSubmit={handleSubmitComplaint}
                  className="lg:col-span-6 rounded-2xl border border-[#292D26]/10 bg-[#FFFDF8] p-5 shadow-sm space-y-3"
                >
                  <h2 className="text-base font-bold text-[#292D26]">Registrar Reclamação</h2>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-semibold mb-1">Linha</label>
                      <select
                        value={compLineId}
                        onChange={(e) => setCompLineId(e.target.value)}
                        className="h-10 w-full rounded-xl border border-[#292D26]/15 bg-[#F3EBDD]/60 px-3 text-xs"
                      >
                        {lines.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.code} · {l.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1">Categoria</label>
                      <select
                        value={compCategory}
                        onChange={(e) => setCompCategory(e.target.value)}
                        className="h-10 w-full rounded-xl border border-[#292D26]/15 bg-[#F3EBDD]/60 px-3 text-xs"
                      >
                        <option value="Atraso excessivo">Atraso excessivo</option>
                        <option value="Queima de parada">Queima de parada</option>
                        <option value="Desvio de rota">Desvio de rota</option>
                        <option value="Acessibilidade / Rampa">Acessibilidade / Rampa</option>
                        <option value="Limpeza e conservação">Limpeza e conservação</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">Veículo (opcional)</label>
                    <select
                      value={compBusId}
                      onChange={(e) => setCompBusId(e.target.value)}
                      className="h-10 w-full rounded-xl border border-[#292D26]/15 bg-[#F3EBDD]/60 px-3 text-xs"
                    >
                      <option value="">Não identificado</option>
                      {buses.map((b) => (
                        <option key={b.id} value={b.id}>
                          #{b.unitNumber} · {b.plate}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">Descrição</label>
                    <textarea
                      required
                      rows={3}
                      value={compDescription}
                      onChange={(e) => setCompDescription(e.target.value)}
                      placeholder="Descreva o ocorrido com local e horário aproximado..."
                      className="w-full rounded-xl border border-[#292D26]/15 bg-[#F3EBDD]/60 p-3 text-xs"
                    />
                  </div>
                  <button
                    type="submit"
                    className="h-10 rounded-xl bg-[#A8D929] px-4 text-xs font-bold text-[#292D26] cursor-pointer"
                  >
                    Enviar reclamação
                  </button>
                  {createdProtocol && (
                    <p className="rounded-xl bg-[#A8D929]/25 p-2.5 text-xs">
                      Protocolo gerado: <strong className="font-mono">{createdProtocol}</strong>
                    </p>
                  )}
                </form>

                {/* Rating Form */}
                <form
                  onSubmit={handleSubmitRating}
                  className="lg:col-span-6 rounded-2xl border border-[#292D26]/10 bg-[#FFFDF8] p-5 shadow-sm space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-bold text-[#292D26]">
                      Avaliar Linha e Veículo
                    </h2>
                    <span className="font-mono text-xs font-bold text-[#292D26]">
                      Média geral: {averageRating.toFixed(1)}/5 ({ratingsCount})
                    </span>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-semibold mb-1">Linha</label>
                      <select
                        value={rateLineId}
                        onChange={(e) => setRateLineId(e.target.value)}
                        className="h-10 w-full rounded-xl border border-[#292D26]/15 bg-[#F3EBDD]/60 px-3 text-xs"
                      >
                        {lines.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.code} · {l.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1">Veículo</label>
                      <select
                        value={rateBusId}
                        onChange={(e) => setRateBusId(e.target.value)}
                        className="h-10 w-full rounded-xl border border-[#292D26]/15 bg-[#F3EBDD]/60 px-3 text-xs"
                      >
                        {buses.map((b) => (
                          <option key={b.id} value={b.id}>
                            #{b.unitNumber} · {b.model}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {(
                    [
                      ['Atendimento e conforto', rateService, setRateService],
                      ['Pontualidade', ratePunctuality, setRatePunctuality],
                      ['Estado do veículo', rateVehicle, setRateVehicle],
                    ] as [string, number, React.Dispatch<React.SetStateAction<number>>][]
                  ).map(([lbl, val, setter]) => (
                    <div key={lbl} className="flex items-center justify-between text-xs">
                      <span className="font-medium">{lbl}</span>
                      <div className="flex gap-1">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => setter(n)}
                            className={`h-8 w-8 rounded-lg font-mono font-bold cursor-pointer ${
                              val >= n ? 'bg-[#E8C547] text-[#292D26]' : 'bg-[#F3EBDD] text-[#74766C]'
                            }`}
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}

                  <textarea
                    rows={2}
                    value={rateComment}
                    onChange={(e) => setRateComment(e.target.value)}
                    placeholder="Comentário opcional sobre a viagem..."
                    className="w-full rounded-xl border border-[#292D26]/15 bg-[#F3EBDD]/60 p-3 text-xs"
                  />
                  <button
                    type="submit"
                    className="h-10 rounded-xl bg-[#E8C547] px-4 text-xs font-bold text-[#292D26] cursor-pointer"
                  >
                    Enviar avaliação
                  </button>
                </form>

                {/* Simulated History of Requests & Protocol Lookup */}
                <div className="lg:col-span-12 rounded-2xl border border-[#292D26]/10 bg-[#FFFDF8] p-5 shadow-sm space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-base font-bold text-[#292D26]">
                      Histórico de Solicitações e Avaliações ({complaints.length} protocolos ·{' '}
                      {ratings.length} avaliações)
                    </h2>
                    <form onSubmit={handleTrackProtocol} className="flex gap-2">
                      <input
                        type="text"
                        value={trackProtocolInput}
                        onChange={(e) => setTrackProtocolInput(e.target.value)}
                        placeholder="Consultar protocolo..."
                        className="h-9 rounded-xl border border-[#292D26]/15 bg-[#F3EBDD]/60 px-3 font-mono text-xs"
                      />
                      <button
                        type="submit"
                        className="h-9 rounded-xl bg-[#292D26] px-3 text-xs font-semibold text-[#FFFDF8] cursor-pointer"
                      >
                        Buscar
                      </button>
                    </form>
                  </div>

                  {trackError && <p className="text-xs text-[#D9534F]">{trackError}</p>}
                  {trackedComplaint && (
                    <div className="rounded-xl border border-[#292D26]/15 bg-[#E8C547]/20 p-3 text-xs">
                      <span className="font-mono font-bold">{trackedComplaint.protocol}</span> ·{' '}
                      <span className="font-semibold uppercase">
                        {trackedComplaint.status.replace('_', ' ')}
                      </span>{' '}
                      — {trackedComplaint.description}
                    </div>
                  )}

                  <div className="grid gap-2.5 md:grid-cols-2">
                    {complaints.map((c) => (
                      <div
                        key={c.id}
                        className="rounded-xl border border-[#292D26]/10 bg-[#F3EBDD]/50 p-3 text-xs space-y-1"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-bold text-[#292D26]">{c.protocol}</span>
                          <span className="font-semibold uppercase text-[#74766C]">
                            {c.status.replace('_', ' ')}
                          </span>
                        </div>
                        <p className="font-semibold text-[#292D26]">{c.category}</p>
                        <p className="text-[#74766C]">{c.description}</p>
                        {c.resolutionNote && (
                          <p className="text-[#292D26] pt-1">
                            <strong>Resposta:</strong> {c.resolutionNote}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Mobile Fixed Thumb-Zone Bottom Tab Bar: Início, Planejar, Favoritos, Avisos, Perfil */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-[#292D26]/12 bg-[#FFFDF8]/95 backdrop-blur-md lg:hidden">
        <div className="grid grid-cols-5 h-16 items-center">
          {(
            [
              ['home', 'Início', Home],
              ['plan', 'Planejar', RouteIcon],
              ['favorites', 'Favoritos', Heart],
              ['alerts', 'Avisos', Megaphone],
              ['profile', 'Perfil', UserIcon],
            ] as [PassengerTab, string, React.ComponentType<{ className?: string }>][]
          ).map(([key, label, Icon]) => {
            const active = tab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setTab(key);
                  if (key === 'alerts') markAllNotificationsRead();
                }}
                className={`relative flex min-h-[44px] flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors cursor-pointer ${
                  active ? 'text-[#292D26]' : 'text-[#74766C]'
                }`}
              >
                <span
                  className={`flex h-7 w-11 items-center justify-center rounded-xl transition-colors ${
                    active ? 'bg-[#E8C547]' : ''
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
};
