import React, { useEffect, useState } from 'react';
import {
  ClipboardList,
  Server,
  UserCheck,
  Truck,
  Phone,
  AlertTriangle,
  MapPin,
  Wrench,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../lib/i18n';
import type { Cablebox, UserProfile } from '../../types/database';

export function TechnicianShell() {
  const { session, activeGroup } = useAuth();
  const { t } = useLanguage();

  const [tab, setTab] = useState<'route' | 'boxes' | 'profile'>('route');
  const [teammates, setTeammates] = useState<UserProfile[]>([]);
  const [boxes, setBoxes] = useState<Cablebox[]>([]);

  useEffect(() => {
    const loadMobileContext = async () => {
      if (!session) return;

      const boxRes = await supabase
        .from('cableboxes')
        .select('*')
        .order('box_code', { ascending: true });
      if (boxRes.data) setBoxes(boxRes.data as Cablebox[]);

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

  return (
    <div className="max-w-md mx-auto px-3 pt-4 pb-24 space-y-4">
      {/* Technician Status Banner */}
      <div className="bg-gradient-to-br from-emerald-900 to-emerald-950 text-white rounded-2xl p-4 shadow-md">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold text-emerald-300 uppercase tracking-wider">
              Group {activeGroup?.code} • {t('technicianRole')}
            </div>
            <h2 className="text-base font-extrabold mt-0.5">{session.user.full_name}</h2>
          </div>
          {activeCrew && (
            <div className="px-2.5 py-1 rounded-xl bg-white/10 border border-white/15 text-right">
              <div className="text-xs font-extrabold text-emerald-200">{activeCrew.name}</div>
              {activeCrew.vehicle_tag && (
                <div className="text-[10px] text-emerald-300/80">{activeCrew.vehicle_tag}</div>
              )}
            </div>
          )}
        </div>

        {activeCrew?.zone_focus && (
          <div className="mt-3 pt-2.5 border-t border-white/10 flex items-center gap-1.5 text-xs text-emerald-200">
            <MapPin className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>{activeCrew.zone_focus}</span>
          </div>
        )}
      </div>

      {/* Tab Views */}
      {tab === 'route' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center space-y-3 shadow-xs">
          <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-800 flex items-center justify-center mx-auto">
            <ClipboardList className="w-6 h-6" />
          </div>
          <h3 className="font-extrabold text-slate-900 text-sm">{t('techMyRoute')}</h3>
          <p className="text-xs text-slate-500 leading-relaxed">
            No tasks assigned yet today. Once the Supervisor uploads the daily{' '}
            <strong>Galinta</strong> or <strong>Cilada</strong> picture sheet and dispatches jobs to{' '}
            <strong>{activeCrew ? activeCrew.name : session.user.full_name}</strong>, your route
            cards, <code>tel:</code> call buttons, and live timer will appear right here.
          </p>
        </div>
      )}

      {tab === 'boxes' && (
        <div className="space-y-3">
          {boxes.map((box) => (
            <div
              key={box.id}
              className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-2"
            >
              <div className="flex items-center justify-between">
                <span className="font-extrabold text-slate-900 text-sm">{box.box_code}</span>
                <span className="text-xs font-semibold text-slate-500">{box.xaafada || '—'}</span>
              </div>
              {box.olt_path && (
                <div className="text-[11px] font-mono text-slate-500">{box.olt_path}</div>
              )}
              {box.damaged_ports.length > 0 && (
                <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 flex items-center gap-2 text-xs text-amber-900 font-semibold">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>
                    Bad Port(s): {box.damaged_ports.join(', ')} — {box.location_notes}
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'profile' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-100 text-sky-800 flex items-center justify-center">
              <Truck className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs text-slate-500 font-medium">Assigned Crew</div>
              <div className="text-sm font-extrabold text-slate-900">
                {activeCrew ? activeCrew.name : t('noCrewAssigned')}
              </div>
            </div>
          </div>

          {teammates.length > 0 && (
            <div className="pt-3 border-t border-slate-100 space-y-2">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Crew Partner
              </div>
              {teammates.map((partner) => (
                <div
                  key={partner.id}
                  className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200"
                >
                  <div className="flex items-center gap-2">
                    <Wrench className="w-4 h-4 text-emerald-700" />
                    <span className="text-xs font-bold text-slate-800">{partner.full_name}</span>
                  </div>
                  {partner.phone && (
                    <a
                      href={`tel:0${partner.phone.replace(/^0/, '')}`}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-700 text-white text-xs font-bold"
                    >
                      <Phone className="w-3.5 h-3.5" />
                      <span>Call</span>
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Fixed Bottom Mobile Tab Bar */}
      <nav className="fixed bottom-0 inset-x-0 z-30 bg-white border-t border-slate-200 shadow-lg">
        <div className="max-w-md mx-auto grid grid-cols-3 h-16">
          <button
            type="button"
            onClick={() => setTab('route')}
            className={`flex flex-col items-center justify-center gap-1 text-[11px] font-bold cursor-pointer ${
              tab === 'route' ? 'text-emerald-700' : 'text-slate-400'
            }`}
          >
            <ClipboardList className="w-5 h-5" />
            <span>{t('techMyRoute')}</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('boxes')}
            className={`flex flex-col items-center justify-center gap-1 text-[11px] font-bold cursor-pointer ${
              tab === 'boxes' ? 'text-emerald-700' : 'text-slate-400'
            }`}
          >
            <Server className="w-5 h-5" />
            <span>{t('techBoxes')}</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('profile')}
            className={`flex flex-col items-center justify-center gap-1 text-[11px] font-bold cursor-pointer ${
              tab === 'profile' ? 'text-emerald-700' : 'text-slate-400'
            }`}
          >
            <UserCheck className="w-5 h-5" />
            <span>{t('techProfile')}</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
