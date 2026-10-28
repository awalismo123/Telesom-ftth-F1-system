import React, { useEffect, useState, useCallback } from 'react';
import {
  LayoutDashboard,
  FileSpreadsheet,
  Route,
  Server,
  Users,
  CheckCircle2,
  Clock,
  Camera,
  AlertTriangle,
  Wifi,
  Truck,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../lib/i18n';
import type { Cablebox } from '../../types/database';
import { TeamAndCrewManager } from './TeamAndCrewManager';

type SupervisorTab = 'overview' | 'ingest' | 'dispatch' | 'cableboxes' | 'team';

export function SupervisorShell() {
  const { activeGroup } = useAuth();
  const { t } = useLanguage();

  const [activeTab, setActiveTab] = useState<SupervisorTab>('overview');
  const [techCount, setTechCount] = useState(0);
  const [crewCount, setCrewCount] = useState(0);
  const [taskCount, setTaskCount] = useState(0);
  const [cableboxes, setCableboxes] = useState<Cablebox[]>([]);

  const loadSummary = useCallback(async () => {
    if (!activeGroup?.id) return;
    const [techRes, crewRes, taskRes, boxRes] = await Promise.all([
      supabase
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('group_id', activeGroup.id)
        .eq('role', 'technician')
        .eq('is_active', true),
      supabase
        .from('crews')
        .select('id', { count: 'exact', head: true })
        .eq('group_id', activeGroup.id)
        .eq('is_active', true),
      supabase
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('group_id', activeGroup.id)
        .neq('status', 'completed'),
      supabase.from('cableboxes').select('*').order('box_code', { ascending: true }),
    ]);

    setTechCount(techRes.count ?? 0);
    setCrewCount(crewRes.count ?? 0);
    setTaskCount(taskRes.count ?? 0);
    if (boxRes.data) setCableboxes(boxRes.data as Cablebox[]);
  }, [activeGroup?.id]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary, activeTab]);

  const navItems: { id: SupervisorTab; label: string; icon: React.ReactNode; badge?: string }[] = [
    { id: 'overview', label: t('navOverview'), icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: 'team', label: t('navTeam'), icon: <Users className="w-4 h-4" />, badge: 'LIVE' },
    { id: 'ingest', label: t('navIngest'), icon: <Camera className="w-4 h-4" />, badge: 'P2' },
    { id: 'dispatch', label: t('navDispatch'), icon: <Route className="w-4 h-4" />, badge: 'P3' },
    {
      id: 'cableboxes',
      label: t('navCablebox'),
      icon: <Server className="w-4 h-4" />,
      badge: `${cableboxes.length}`,
    },
  ];

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-6 py-5 space-y-6">
      {/* Top Module Navigation Pills */}
      <nav className="flex items-center gap-2 overflow-x-auto pb-1">
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold whitespace-nowrap border transition cursor-pointer ${
                isActive
                  ? 'bg-emerald-950 text-white border-emerald-950 shadow-sm'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-emerald-50/50 hover:border-emerald-200'
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
              {item.badge && (
                <span
                  className={`px-1.5 py-0.5 rounded-md text-[10px] font-extrabold ${
                    item.badge === 'LIVE'
                      ? isActive
                        ? 'bg-emerald-400 text-emerald-950'
                        : 'bg-emerald-100 text-emerald-800'
                      : isActive
                        ? 'bg-white/20 text-white'
                        : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Active View */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* KPI Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-xs">
              <div className="flex items-center justify-between text-slate-400 mb-2">
                <span className="text-xs font-bold text-slate-500">{t('activeTechs')}</span>
                <Users className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="text-2xl font-extrabold text-slate-900">{techCount}</div>
              <div className="text-[11px] text-emerald-700 font-semibold mt-1">
                Group {activeGroup?.code} Field Ready
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-xs">
              <div className="flex items-center justify-between text-slate-400 mb-2">
                <span className="text-xs font-bold text-slate-500">{t('fieldCrews')}</span>
                <Truck className="w-4 h-4 text-sky-600" />
              </div>
              <div className="text-2xl font-extrabold text-slate-900">{crewCount}</div>
              <div className="text-[11px] text-sky-700 font-semibold mt-1">
                Individual + 2-Tech Vehicles
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-xs">
              <div className="flex items-center justify-between text-slate-400 mb-2">
                <span className="text-xs font-bold text-slate-500">{t('openTasks')}</span>
                <FileSpreadsheet className="w-4 h-4 text-amber-600" />
              </div>
              <div className="text-2xl font-extrabold text-slate-900">{taskCount}</div>
              <div className="text-[11px] text-slate-500 font-medium mt-1">
                Galinta &amp; Cilada Queue
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-xs">
              <div className="flex items-center justify-between text-slate-400 mb-2">
                <span className="text-xs font-bold text-slate-500">{t('trackedBoxes')}</span>
                <Server className="w-4 h-4 text-purple-600" />
              </div>
              <div className="text-2xl font-extrabold text-slate-900">{cableboxes.length}</div>
              <div className="text-[11px] text-purple-700 font-semibold mt-1">
                FAT / Cablebox Memory
              </div>
            </div>
          </div>

          {/* Step-by-Step Build Progress Card */}
          <div className="bg-gradient-to-br from-emerald-950 via-slate-900 to-emerald-950 text-white rounded-3xl p-6 shadow-lg border border-emerald-800/50">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-5 border-b border-white/10">
              <div>
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-400/20 text-emerald-300 text-[11px] font-bold mb-2">
                  <Wifi className="w-3.5 h-3.5" />
                  <span>SUPABASE LIVE • VERCEL READY</span>
                </div>
                <h2 className="text-lg sm:text-xl font-extrabold">{t('roadmapTitle')}</h2>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab('team')}
                className="self-start md:self-auto px-4 py-2.5 rounded-xl bg-emerald-400 hover:bg-emerald-300 text-emerald-950 font-extrabold text-xs transition cursor-pointer"
              >
                {t('navTeam')} →
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-5 text-xs">
              <div className="p-3.5 rounded-2xl bg-emerald-500/15 border border-emerald-400/30 flex items-start gap-3">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span className="font-semibold text-emerald-100">{t('phase1Done')}</span>
              </div>

              <div className="p-3.5 rounded-2xl bg-amber-400/15 border border-amber-400/30 flex items-start gap-3">
                <Camera className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
                <span className="font-semibold text-amber-100">{t('phase2Next')}</span>
              </div>

              <div className="p-3.5 rounded-2xl bg-white/5 border border-white/10 flex items-start gap-3">
                <Clock className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                <span className="text-slate-300">{t('phase3Pending')}</span>
              </div>

              <div className="p-3.5 rounded-2xl bg-white/5 border border-white/10 flex items-start gap-3">
                <Clock className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                <span className="text-slate-300">{t('phase4Pending')}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'team' && <TeamAndCrewManager />}

      {activeTab === 'ingest' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center max-w-2xl mx-auto space-y-3 shadow-xs">
          <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-800 flex items-center justify-center mx-auto">
            <Camera className="w-6 h-6" />
          </div>
          <h3 className="text-base font-extrabold text-slate-900">
            Module 1 (Phase 2 Next): Daily Picture (JPEG/PNG) &amp; Sheet Extractor
          </h3>
          <p className="text-xs text-slate-600 leading-relaxed">
            Calibrated directly to Telesom&apos;s{' '}
            <strong>Pending Installation (Galinta)</strong> and{' '}
            <strong>CILADA KU TAAGAN GROUP-KA</strong> daily group-chat images—extracting only{' '}
            <span className="font-bold text-emerald-700">Group {activeGroup?.code}</span> rows,
            detecting urgent <code>degdeg / dd / dadaji</code> tickets, and preventing duplicate
            lines.
          </p>
        </div>
      )}

      {activeTab === 'dispatch' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center max-w-2xl mx-auto space-y-3 shadow-xs">
          <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-800 flex items-center justify-center mx-auto">
            <Route className="w-6 h-6" />
          </div>
          <h3 className="text-base font-extrabold text-slate-900">
            Module 2 (Phase 3): Route Clustering &amp; WhatsApp Summary
          </h3>
          <p className="text-xs text-slate-600 leading-relaxed">
            Clusters unassigned Group {activeGroup?.code} jobs by <strong>Xaafada</strong> and{' '}
            <strong>Cablebox</strong>, assigns routes to Individual Techs or 2-Tech Crews, and
            formats a 1-click group chat dispatch message.
          </p>
        </div>
      )}

      {activeTab === 'cableboxes' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
            <h3 className="text-base font-extrabold text-slate-900">
              Seeded Cablebox Registry (Full Port &amp; Log Explorer in Phase 5)
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Initial boxes recognized from Telesom Group F1 records in Supabase:
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {cableboxes.map((box) => (
              <div
                key={box.id}
                className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-extrabold text-slate-900 text-base">{box.box_code}</div>
                    {box.olt_path && (
                      <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                        {box.olt_path}
                      </div>
                    )}
                  </div>
                  <span
                    className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
                      box.health_status === 'healthy'
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-amber-50 text-amber-800 border border-amber-200'
                    }`}
                  >
                    {box.health_status.toUpperCase()}
                  </span>
                </div>
                <div className="text-xs text-slate-600 flex flex-wrap gap-3">
                  <span>
                    <strong>Xaafada:</strong> {box.xaafada || '—'}
                  </span>
                  <span>
                    <strong>Ports:</strong> {box.total_ports}
                  </span>
                  <span>
                    <strong>Last dBm:</strong>{' '}
                    {box.last_optical_dbm !== null ? `${box.last_optical_dbm} dBm` : '—'}
                  </span>
                </div>
                {box.damaged_ports.length > 0 && (
                  <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 flex items-center gap-2 text-xs text-amber-900 font-semibold">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>
                      Damaged Port(s): {box.damaged_ports.join(', ')} — {box.location_notes}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
