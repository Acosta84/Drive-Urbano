import React from 'react';
import type { Bus } from '../shared/types.ts';

export const PunctualityChart: React.FC<{
  data: { hour: string; onTime: number; delayed: number }[];
}> = ({ data }) => {
  if (data.length === 0) {
    return (
      <div className="flex h-44 items-center justify-center text-sm text-[#74766C]">
        Sem viagens registradas para o gráfico de pontualidade.
      </div>
    );
  }

  const maxTotal = Math.max(1, ...data.map((d) => d.onTime + d.delayed));

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-3 h-40 pt-4">
        {data.map((d) => {
          const total = d.onTime + d.delayed;
          const onTimeH = Math.round((d.onTime / maxTotal) * 100);
          const delayedH = Math.round((d.delayed / maxTotal) * 100);
          return (
            <div key={d.hour} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end">
              <span className="font-mono text-[11px] tabular-nums text-[#74766C]">{total}</span>
              <div className="w-full max-w-[38px] flex flex-col-reverse gap-0.5 h-[108px] justify-start">
                {d.onTime > 0 && (
                  <div
                    style={{ height: `${Math.max(8, onTimeH)}%` }}
                    className="w-full rounded-sm bg-[#A8D929] border border-[#292D26]/15"
                    title={`${d.hour}: ${d.onTime} no horário`}
                  />
                )}
                {d.delayed > 0 && (
                  <div
                    style={{ height: `${Math.max(8, delayedH)}%` }}
                    className="w-full rounded-sm bg-[#E99A36] border border-[#292D26]/15"
                    title={`${d.hour}: ${d.delayed} atrasada(s)`}
                  />
                )}
              </div>
              <span className="font-mono text-[11px] tabular-nums text-[#292D26]">{d.hour}</span>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-5 text-xs text-[#74766C]">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-xs bg-[#A8D929] border border-[#292D26]/20" />
          No horário
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-xs bg-[#E99A36] border border-[#292D26]/20" />
          Com atraso
        </span>
      </div>
    </div>
  );
};

export const MileageComparisonChart: React.FC<{
  data: { code: string; plannedKm: number; actualKm: number }[];
}> = ({ data }) => {
  if (data.length === 0) {
    return (
      <div className="flex h-44 items-center justify-center text-sm text-[#74766C]">
        Nenhuma linha cadastrada para comparativo de quilometragem.
      </div>
    );
  }

  const maxKm = Math.max(1, ...data.flatMap((d) => [d.plannedKm, d.actualKm]));

  return (
    <div className="space-y-3">
      {data.map((row) => {
        const plannedPct = Math.round((row.plannedKm / maxKm) * 100);
        const actualPct = Math.round((row.actualKm / maxKm) * 100);
        return (
          <div key={row.code} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-mono font-semibold text-[#292D26]">Linha {row.code}</span>
              <span className="font-mono tabular-nums text-[#74766C]">
                {row.actualKm.toFixed(1)} km realizados / {row.plannedKm.toFixed(1)} km programados
              </span>
            </div>
            <div className="space-y-1">
              <div className="h-2 w-full rounded-full bg-[#F3EBDD]">
                <div
                  className="h-2 rounded-full bg-[#E8C547]"
                  style={{ width: `${Math.max(4, plannedPct)}%` }}
                />
              </div>
              <div className="h-2 w-full rounded-full bg-[#F3EBDD]">
                <div
                  className="h-2 rounded-full bg-[#A8D929]"
                  style={{ width: `${Math.max(4, actualPct)}%` }}
                />
              </div>
            </div>
          </div>
        );
      })}
      <div className="flex items-center gap-5 pt-1 text-xs text-[#74766C]">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-xs bg-[#E8C547]" />
          Programado
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-xs bg-[#A8D929]" />
          Realizado (GPS)
        </span>
      </div>
    </div>
  );
};

export const FleetDistributionChart: React.FC<{ buses: Bus[] }> = ({ buses }) => {
  const total = Math.max(1, buses.length);
  const groups = [
    {
      label: 'Em operação',
      count: buses.filter((b) => b.status === 'em_operacao').length,
      color: '#A8D929',
    },
    {
      label: 'Disponível (pátio)',
      count: buses.filter((b) => b.status === 'disponivel').length,
      color: '#E8C547',
    },
    {
      label: 'Manutenção',
      count: buses.filter((b) => b.status === 'em_manutencao').length,
      color: '#E99A36',
    },
    {
      label: 'Falha / Retirado',
      count: buses.filter((b) => b.status === 'quebrado' || b.status === 'retirado').length,
      color: '#D9534F',
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex h-3.5 w-full overflow-hidden rounded-full bg-[#F3EBDD]">
        {groups.map((g) => {
          const pct = (g.count / total) * 100;
          if (pct <= 0) return null;
          return (
            <div
              key={g.label}
              style={{ width: `${pct}%`, backgroundColor: g.color }}
              title={`${g.label}: ${g.count}`}
            />
          );
        })}
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        {groups.map((g) => (
          <div key={g.label} className="flex items-center justify-between rounded-xl bg-[#F3EBDD]/60 px-3 py-2">
            <span className="flex items-center gap-2 text-[#292D26]">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: g.color }}
              />
              {g.label}
            </span>
            <span className="font-mono font-bold tabular-nums text-[#292D26]">{g.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
