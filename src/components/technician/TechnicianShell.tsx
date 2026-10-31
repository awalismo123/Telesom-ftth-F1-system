import React, { useEffect, useState } from 'react';
import {
  ClipboardList,
  Server,
  UserCheck,
  Truck,
  Phone,
  MapPin,
  Wrench,
} from 'lucide-react';
import { RunningPill } from './RunningPill';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../lib/i18n';
import type { UserProfile } from '../../types/database';
import { Tabs, type TabItem } from '../ui/Tabs';
import { Card } from '../ui/Card';
import { LazyPanel } from '../ui/LazyPanel';
import { cx } from '../ui/cx';
import { preload } from '../../lib/preload';

/**
 * Route and registry are separate chunks: a technician who opens the app to
 * read today's jobs never downloads the cablebox registry, and vice versa.
 * `preload()` fires on tab intent so the switch still feels instant.
 */
const RouteView = React.lazy(() =>
  import('./RouteView').then((m) => ({ default: m.RouteView })),
);
const BoxRegistry = React.lazy(() =>
  import('../supervisor/BoxRegistry').then((m) => ({ default: m.BoxRegistry })),
);

type TechTab = 'route' | 'boxes' | 'profile';

export function TechnicianShell() {
  const { session, activeGroup } = useAuth();
  const { t } = useLanguage();

  const [tab, setTab] = useState<TechTab>('route');
  const [teammates, setTeammates] = useState<UserProfile[]>([]);

  useEffect(() => {
    const loadMobileContext = async () => {
      if (!session) return;

      if (session.crews.length > 0) {
        const crewIds = session.crews.map((c) => c.id);
        const { data: links } = await supabase
          .from('crew_members')
          .select('user_id')
          .in('crew_id', crewIds);

        const partnerIds = (links || [])
          .map((r: { user_id: string }) => r.user_id)
          .filter((uid: string) => uid !== session.user.id);

        if (partnerIds.length > 0) {
          const { data: usersData } = await supabase
            .from('users')
            .select('*')
            .in('id', partnerIds);
          if (usersData) setTeammates(usersData as UserProfile[]);
        } else {
          setTeammates([]);
        }
      }
    };

    void loadMobileContext();
  }, [session]);

  if (!session) return null;

  const activeCrew = session.crews[0] || null;

  const tabItems: TabItem<TechTab>[] = [
    { id: 'route', label: t('techMyRoute'), icon: <ClipboardList className="w-4 h-4" /> },
    { id: 'boxes', label: t('techBoxes'), icon: <Server className="w-4 h-4" /> },
    { id: 'profile', label: t('techProfile'), icon: <UserCheck className="w-4 h-4" /> },
  ];

  const crewCard = (
    <Card padding="md" className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-sky-100 text-sky-800 flex items-center justify-center" aria-hidden="true">
          <Truck className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] text-slate-500 font-semibold">{t('assignedCrew') || 'Assigned crew'}</div>
          <div className="text-sm font-extrabold text-slate-900 truncate">
            {activeCrew ? activeCrew.name : t('noCrewAssigned')}
          </div>
          {activeCrew?.vehicle_tag && (
            <div className="text-[11px] text-slate-500">{activeCrew.vehicle_tag}</div>
          )}
        </div>
      </div>

      {teammates.length > 0 ? (
        <div className="pt-3 border-t border-slate-100 space-y-2">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            {t('crewPartner') || 'Crew partner'}
          </div>
          {teammates.map((partner) => (
            <div
              key={partner.id}
              className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-50 border border-slate-200"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Wrench className="w-4 h-4 text-emerald-700 shrink-0" aria-hidden="true" />
                <span className="text-xs font-bold text-slate-800 truncate">{partner.full_name}</span>
              </div>
              {partner.phone && (
                <a
                  href={`tel:0${partner.phone.replace(/^0/, '')}`}
                  className="shrink-0 inline-flex items-center gap-1 min-h-9 px-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold"
                >
                  <Phone className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{t('call') || 'Call'}</span>
                </a>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-slate-500 border-t border-slate-100 pt-3">
          {t('noCrewPartner') || 'Working solo today.'}
        </p>
      )}
    </Card>
  );

  return (
    <div className="mx-auto w-full max-w-md md:max-w-5xl px-3 md:px-6 pt-4 pb-28 md:pb-8">
      {/* Identity banner: who am I, which group, which crew. */}
      <div className="bg-gradient-to-br from-emerald-900 to-emerald-950 text-white rounded-2xl p-4 shadow-md print-block">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-bold text-emerald-300 uppercase tracking-wider">
              Group {activeGroup?.code} • {t('technicianRole')}
            </div>
            <h2 className="text-base font-extrabold mt-0.5 truncate">{session.user.full_name}</h2>
          </div>
          {activeCrew && (
            <div className="px-2.5 py-1 rounded-xl bg-white/10 border border-white/15 text-right shrink-0">
              <div className="text-xs font-extrabold text-emerald-200">{activeCrew.name}</div>
              {activeCrew.vehicle_tag && (
                <div className="text-[10px] text-emerald-300/80">{activeCrew.vehicle_tag}</div>
              )}
            </div>
          )}
        </div>

        {activeCrew?.zone_focus && (
          <div className="mt-3 pt-2.5 border-t border-white/10 flex items-center gap-1.5 text-xs text-emerald-200">
            <MapPin className="w-3.5 h-3.5 text-emerald-400 shrink-0" aria-hidden="true" />
            <span>{activeCrew.zone_focus}</span>
          </div>
        )}
      </div>

      {/* Tablet and up: tabs along the top instead of a bottom bar under the thumb. */}
      <div className="hidden md:block mt-4">
        <Tabs
          variant="bar"
          items={tabItems}
          value={tab}
          onChange={setTab}
          label={t('techMyRoute')}
          onIntent={(id) => id === 'boxes' && preload('supervisor-boxes')}
        />
      </div>

      <div className="mt-4 md:grid md:grid-cols-[minmax(0,1fr)_19rem] md:gap-5 md:items-start">
        <div className="space-y-4 min-w-0">
          {tab === 'route' && (
            <LazyPanel shape="rows" label={t('techMyRoute')}>
              <RouteView />
            </LazyPanel>
          )}

          {tab === 'boxes' && (
            <LazyPanel shape="cards" label={t('techBoxes')}>
              <BoxRegistry />
            </LazyPanel>
          )}

          {tab === 'profile' && (
            <div className="space-y-4">
              {crewCard}

              <Card padding="md">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">
                  {t('myAccount') || 'My account'}
                </div>
                <dl className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <dt className="text-slate-500">{t('identifierLabelShort') || 'Username'}</dt>
                    <dd className="font-bold text-slate-900 truncate">{session.user.username}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">{t('phoneLabel') || 'Phone'}</dt>
                    <dd className="font-bold text-slate-900 truncate">{session.user.phone || '—'}</dd>
                  </div>
                </dl>
                <p className="mt-3 pt-3 border-t border-slate-100 text-[11px] text-slate-500">
                  {t('changePinHint') || 'Use “Change PIN” in the header to update your 4-digit PIN.'}
                </p>
              </Card>
            </div>
          )}
        </div>

        {/* Right rail on tablets and desktop: crew context stays visible while
            the technician works through the route. */}
        <aside className="hidden md:block space-y-4 md:sticky md:top-20">
          {crewCard}
          <RunningPill onGoToRoute={() => setTab('route')} />
        </aside>
      </div>

      {tab !== 'route' && (
        <div className="md:hidden mt-4">
          <RunningPill onGoToRoute={() => setTab('route')} />
        </div>
      )}

      {/* Phone: fixed bottom tabs, safe-area aware, every target ≥ 44 px. */}
      <nav
        aria-label={t('appName')}
        className={cx('md:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-slate-200 shadow-lg safe-bottom')}
      >
        <div className="max-w-md mx-auto grid grid-cols-3">
          {tabItems.map((item) => {
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                onPointerEnter={() => item.id === 'boxes' && preload('supervisor-boxes')}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'min-h-16 flex flex-col items-center justify-center gap-1 text-[11px] font-bold cursor-pointer transition',
                  active ? 'text-emerald-700' : 'text-slate-500 hover:text-slate-600',
                )}
              >
                <span aria-hidden="true">{item.icon}</span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
