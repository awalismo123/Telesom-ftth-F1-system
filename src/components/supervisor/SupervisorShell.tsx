import React, { useEffect, useState, useCallback } from 'react';
import {
  LayoutDashboard,
  FileSpreadsheet,
  Route,
  Server,
  Users,
  Camera,
  Wifi,
  Truck,
  BarChart3,
  History,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../lib/i18n';
import type { Cablebox } from '../../types/database';
import { ActivityLog } from './ActivityLog';
import { fetchGroupOverview, fetchTodaySummary } from '../../lib/reads';
import type { TodaySummary } from '../../lib/today';
import { todayKey } from '../../lib/format';
import { TodayPanel } from './TodayPanel';
import { Tabs, type TabItem } from '../ui/Tabs';
import { Stat } from '../ui/Stat';
import { cx } from '../ui/cx';
import { LazyPanel } from '../ui/LazyPanel';
import { preload, type PreloadKey } from '../../lib/preload';
import { useNavigation } from '../../lib/navigation';

/**
 * Every module is its own chunk. A supervisor who opens the app to dispatch one
 * job does not download the OCR wizard, the analytics charts or the team
 * manager; they arrive when their tab is chosen (or hovered, which is why the
 * preload map exists).
 */
const TeamAndCrewManager = React.lazy(() =>
  import('./TeamAndCrewManager').then((m) => ({ default: m.TeamAndCrewManager })),
);
const IngestWizard = React.lazy(() =>
  import('./ingest/IngestWizard').then((m) => ({ default: m.IngestWizard })),
);
const DispatchBoard = React.lazy(() =>
  import('./dispatch/DispatchBoard').then((m) => ({ default: m.DispatchBoard })),
);
const BoxRegistry = React.lazy(() =>
  import('./BoxRegistry').then((m) => ({ default: m.BoxRegistry })),
);
const Analytics = React.lazy(() =>
  import('./Analytics').then((m) => ({ default: m.Analytics })),
);

/** Which chunk a module lives in, so a hover can fetch it before the click. */
const PRELOAD: Partial<Record<SupervisorTab, PreloadKey>> = {
  team: 'supervisor-team',
  ingest: 'supervisor-ingest',
  dispatch: 'supervisor-dispatch',
  insights: 'supervisor-analytics',
  cableboxes: 'supervisor-boxes',
};

type SupervisorTab = 'overview' | 'ingest' | 'dispatch' | 'insights' | 'activity' | 'cableboxes' | 'team';

export function SupervisorShell() {
  const { session, activeGroup } = useAuth();
  const { t, lang } = useLanguage();
  const so = lang === 'so';

  const [activeTab, setActiveTab] = useState<SupervisorTab>('overview');
  const [techCount, setTechCount] = useState(0);
  const [crewCount, setCrewCount] = useState(0);
  const [taskCount, setTaskCount] = useState(0);
  const [unassignedCount, setUnassignedCount] = useState(0);
  const [cableboxes, setCableboxes] = useState<Cablebox[]>([]);
  const [today, setToday] = useState<TodaySummary | null>(null);
  const [todayLoading, setTodayLoading] = useState(true);
  const [focusTask, setFocusTask] = useState<{ id: string; nonce: number } | null>(null);
  const [focusBox, setFocusBox] = useState<{ id: string; nonce: number } | null>(null);
  const { intent, consume } = useNavigation();

  /**
   * Search results and notifications land here: switch to the right tab and hand
   * the job or box to the screen that owns it.
   */
  useEffect(() => {
    if (!intent) return;

    if (intent.to === 'dispatch') {
      setActiveTab('dispatch');
      if (intent.taskId) setFocusTask({ id: intent.taskId, nonce: intent.nonce });
      consume();
    } else if (intent.to === 'boxes') {
      setActiveTab('cableboxes');
      if (intent.boxId) setFocusBox({ id: intent.boxId, nonce: intent.nonce });
      consume();
    } else if (intent.to === 'insights' || intent.to === 'ingest' || intent.to === 'team' || intent.to === 'overview') {
      setActiveTab(intent.to);
      consume();
    }
    // 'route' is the technician's shell; the supervisor ignores it.
  }, [intent, consume]);

  const loadSummary = useCallback(async () => {
    if (!activeGroup?.id || !session?.token) return;
    try {
      // One token-checked call replaces five table reads. The database decides
      // what this supervisor may see; the browser only names its own group.
      const overview = await fetchGroupOverview(session.token, activeGroup.id);
      setTechCount(overview.counts.technicians);
      setCrewCount(overview.counts.crews);
      setTaskCount(overview.counts.open_tasks);
      setUnassignedCount(overview.counts.unassigned);
      setCableboxes(overview.cableboxes);

      // The day is the supervisor's own, not the server's: Hargeisa is UTC+3,
      // so a job closed just after midnight would land in yesterday otherwise.
      setToday(await fetchTodaySummary(session.token, activeGroup.id, todayKey()));
    } catch {
      // A summary that cannot load must not blank the shell; the tabs inside
      // load their own data and will show the real error if there is one.
    } finally {
      setTodayLoading(false);
    }
  }, [activeGroup?.id, session?.token]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary, activeTab]);

  const navItems: TabItem<SupervisorTab>[] = [
    { id: 'overview', label: t('navOverview'), icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: 'team', label: t('navTeam'), icon: <Users className="w-4 h-4" /> },
    { id: 'ingest', label: t('navIngest'), icon: <Camera className="w-4 h-4" /> },
    { id: 'dispatch', label: t('navDispatch'), icon: <Route className="w-4 h-4" /> },
    { id: 'insights', label: t('navInsights'), icon: <BarChart3 className="w-4 h-4" /> },
    { id: 'activity', label: t('navActivity'), icon: <History className="w-4 h-4" /> },
    {
      id: 'cableboxes',
      label: t('navCablebox'),
      icon: <Server className="w-4 h-4" />,
      badge: cableboxes.length,
    },
  ];

  const activeLabel = navItems.find((item) => item.id === activeTab)?.label ?? '';

  return (
    <div className="mx-auto w-full max-w-[1400px] px-3 sm:px-6 py-4 sm:py-5">
      <div className="lg:flex lg:gap-6 lg:items-start">
        {/*
          Desktop: a real sidebar. Phone and tablet keep the horizontal strip so
          the thumb never has to reach for the far edge of a wide screen.
        */}
        <aside className="hidden lg:block w-60 shrink-0 lg:sticky lg:top-20">
          <div className="rounded-2xl bg-brand-950 border border-brand-800/60 p-3 text-white shadow-sm">
            <div className="flex items-center gap-2 px-2 pt-1 pb-3">
              <div className="w-8 h-8 rounded-lg bg-brand-400 flex items-center justify-center">
                <Wifi className="w-4 h-4 text-brand-950 stroke-[2.5]" aria-hidden="true" />
              </div>
              <div className="leading-tight">
                <div className="text-xs font-extrabold">Group F1</div>
                <div className="text-[10px] text-brand-300/80">{t('supervisorRole')}</div>
              </div>
            </div>

            <nav aria-label={t('appName')} className="space-y-1">
              {navItems.map((item) => {
                const active = item.id === activeTab;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveTab(item.id)}
                    onPointerEnter={() => PRELOAD[item.id] && preload(PRELOAD[item.id] as PreloadKey)}
                    onFocus={() => PRELOAD[item.id] && preload(PRELOAD[item.id] as PreloadKey)}
                    aria-current={active ? 'page' : undefined}
                    className={cx(
                      'w-full min-h-11 flex items-center gap-2.5 px-2.5 rounded-xl text-xs font-bold text-left transition cursor-pointer',
                      active
                        ? 'bg-brand-400 text-brand-950'
                        : 'text-brand-100/85 hover:bg-brand-900 hover:text-white',
                    )}
                  >
                    <span aria-hidden="true">{item.icon}</span>
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.badge != null && (
                      <span
                        className={cx(
                          'text-[10px] font-extrabold px-1.5 py-0.5 rounded-md',
                          active ? 'bg-brand-950/15 text-brand-950' : 'bg-brand-900 text-brand-200',
                        )}
                      >
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>

            <div className="mt-3 pt-3 border-t border-brand-800/60 px-2 pb-1 text-[10px] text-brand-300/60">
              {t('deptSubtitle')}
            </div>
          </div>
        </aside>

        <div className="flex-1 min-w-0 space-y-5 sm:space-y-6">
          <Tabs
            items={navItems}
            value={activeTab}
            onChange={setActiveTab}
            label={t('appName')}
            className="lg:hidden"
            onIntent={(id) => PRELOAD[id] && preload(PRELOAD[id] as PreloadKey)}
          />

          <div
            id={`panel-${activeTab}`}
            role="tabpanel"
            aria-label={activeLabel}
            className="space-y-5 sm:space-y-6"
          >
            {activeTab === 'overview' && (
              <div className="space-y-5 sm:space-y-6">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                  <Stat
                    label={t('activeTechs')}
                    value={techCount}
                    icon={<Users className="w-4 h-4" />}
                    hint={`${t('groupFieldReady')} ${activeGroup?.code ?? 'F1'}`}
                  />
                  <Stat
                    label={t('fieldCrews')}
                    value={crewCount}
                    icon={<Truck className="w-4 h-4" />}
                    tone="sky"
                    hint={so ? 'Farsamayaqaan ama gaadiid laba qof' : 'Individual or 2-tech vehicle'}
                  />
                  <Stat
                    label={t('openTasks')}
                    value={taskCount}
                    icon={<FileSpreadsheet className="w-4 h-4" />}
                    tone="amber"
                    hint={`${unassignedCount} ${t('dispatchUnassignedShort')}`}
                    onClick={() => setActiveTab('dispatch')}
                  />
                  <Stat
                    label={t('trackedBoxes')}
                    value={cableboxes.length}
                    icon={<Server className="w-4 h-4" />}
                    tone="violet"
                    hint={so ? 'Taariikhda sanduuq kasta' : 'History per cablebox'}
                  />
                </div>

                {/*
                  This space used to hold a five-line build-progress roadmap.
                  It now holds the only thing a supervisor opening the app at
                  07:30 needs: what is open, what is stuck, and who is out.
                */}
                <TodayPanel
                  summary={today}
                  loading={todayLoading}
                  onNavigate={(tab) => setActiveTab(tab)}
                />
              </div>
            )}

            {activeTab === 'team' && (
              <LazyPanel shape="rows" label={t('navTeam')}>
                <TeamAndCrewManager />
              </LazyPanel>
            )}
            {activeTab === 'ingest' && (
              <LazyPanel shape="wizard" label={t('navIngest')}>
                <IngestWizard />
              </LazyPanel>
            )}
            {activeTab === 'dispatch' && (
              <LazyPanel shape="board" label={t('navDispatch')}>
                <DispatchBoard focusTaskId={focusTask?.id ?? null} focusNonce={focusTask?.nonce ?? 0} />
              </LazyPanel>
            )}
            {activeTab === 'cableboxes' && (
              <LazyPanel shape="cards" label={t('navCablebox')}>
                <BoxRegistry focusBoxId={focusBox?.id ?? null} focusNonce={focusBox?.nonce ?? 0} />
              </LazyPanel>
            )}
            {activeTab === 'insights' && (
              <LazyPanel shape="cards" label={t('navInsights')}>
                <Analytics />
              </LazyPanel>
            )}
            {activeTab === 'activity' && (
              <LazyPanel shape="rows" label={t('navActivity')}>
                <ActivityLog />
              </LazyPanel>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
