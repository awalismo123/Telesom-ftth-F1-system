import React, { useEffect, useState, useCallback } from 'react';
import { describeError } from '../../lib/useErrorMessage';
import {
  Users,
  Truck,
  Building2,
  Plus,
  Edit3,
  Phone,
  ShieldCheck,
  Wrench,
  CheckCircle2,
  X,
  MapPin,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../lib/i18n';
import { useTableChanges } from '../../lib/realtime';
import type { Crew, Group, UserProfile, UserRole } from '../../types/database';

interface CrewMemberRow {
  crew_id: string;
  user_id: string;
}

export function TeamAndCrewManager() {
  const { session, activeGroup, availableGroups, refreshGroups } = useAuth();
  const { t, lang } = useLanguage();

  const [subTab, setSubTab] = useState<'members' | 'crews' | 'groups'>('members');
  const [members, setMembers] = useState<UserProfile[]>([]);
  const [crews, setCrews] = useState<Crew[]>([]);
  const [crewLinks, setCrewLinks] = useState<CrewMemberRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Member modal state
  const [memberModalOpen, setMemberModalOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<UserProfile | null>(null);
  const [mFullName, setMFullName] = useState('');
  const [mUsername, setMUsername] = useState('');
  const [mPhone, setMPhone] = useState('');
  const [mRole, setMRole] = useState<UserRole>('technician');
  const [mPin, setMPin] = useState('');
  const [mActive, setMActive] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Crew modal state
  const [crewModalOpen, setCrewModalOpen] = useState(false);
  const [editingCrew, setEditingCrew] = useState<Crew | null>(null);
  const [cName, setCName] = useState('');
  const [cVehicle, setCVehicle] = useState('');
  const [cZone, setCZone] = useState('');
  const [cSelectedMembers, setCSelectedMembers] = useState<string[]>([]);
  const [cActive, setCActive] = useState(true);

  // Group modal state
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [gCode, setGCode] = useState('');
  const [gName, setGName] = useState('');
  const [gDesc, setGDesc] = useState('');

  const loadData = useCallback(async (silent = false) => {
    if (!activeGroup?.id) return;
    // A background refresh (another supervisor added a technician) must not
    // replace the table with a skeleton under the reader's finger.
    if (!silent) setLoading(true);
    const [usersRes, crewsRes, linksRes] = await Promise.all([
      supabase
        .from('users')
        .select('*')
        .eq('group_id', activeGroup.id)
        .order('role', { ascending: true })
        .order('full_name', { ascending: true }),
      supabase
        .from('crews')
        .select('*')
        .eq('group_id', activeGroup.id)
        .order('name', { ascending: true }),
      supabase.from('crew_members').select('*'),
    ]);

    if (usersRes.data) setMembers(usersRes.data as UserProfile[]);
    if (crewsRes.data) setCrews(crewsRes.data as Crew[]);
    if (linksRes.data) setCrewLinks(linksRes.data as CrewMemberRow[]);
    setLoading(false);
  }, [activeGroup?.id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  /**
   * Staff, crews and crew membership land live — a technician added on another
   * phone appears without a reload.
   *
   * This used to call `supabase.channel('team-crews-realtime')` by hand. The
   * topic was fixed, and removing a channel is asynchronous: leave the tab and
   * come back before the unsubscribe finishes and `channel()` hands back the
   * still-subscribed channel, so the next `.on()` throws. `useTableChanges`
   * names every subscription uniquely, so that race cannot exist.
   */
  useTableChanges({ table: 'users', onChange: () => void loadData(true) });
  useTableChanges({ table: 'crews', onChange: () => void loadData(true) });
  useTableChanges({ table: 'crew_members', onChange: () => void loadData(true) });

  const openAddMember = () => {
    setEditingMember(null);
    setMFullName('');
    setMUsername('');
    setMPhone('');
    setMRole('technician');
    setMPin('');
    setMActive(true);
    setFormError(null);
    setMemberModalOpen(true);
  };

  const openEditMember = (m: UserProfile) => {
    setEditingMember(m);
    setMFullName(m.full_name);
    setMUsername(m.username);
    setMPhone(m.phone || '');
    setMRole(m.role);
    setMPin('');
    setMActive(m.is_active);
    setFormError(null);
    setMemberModalOpen(true);
  };

  const handleSaveMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.token || !activeGroup?.id) return;
    setFormError(null);
    setSaving(true);
    try {
      const { error } = await supabase.rpc('upsert_team_member', {
        p_token: session.token,
        p_member_id: editingMember?.id || null,
        p_group_id: activeGroup.id,
        p_username: mUsername,
        p_full_name: mFullName,
        p_phone: mPhone,
        p_role: mRole,
        p_pin: mPin,
        p_is_active: mActive,
      });
      if (error) throw new Error(error.message);
      setMemberModalOpen(false);
      await loadData();
    } catch (err) {
      setFormError(describeError(err, lang));
    } finally {
      setSaving(false);
    }
  };

  const openAddCrew = () => {
    setEditingCrew(null);
    setCName(`${activeGroup?.code || 'F1'} - Crew `);
    setCVehicle('');
    setCZone('');
    setCSelectedMembers([]);
    setCActive(true);
    setFormError(null);
    setCrewModalOpen(true);
  };

  const openEditCrew = (c: Crew) => {
    setEditingCrew(c);
    setCName(c.name);
    setCVehicle(c.vehicle_tag || '');
    setCZone(c.zone_focus || '');
    const assignedIds = crewLinks
      .filter((link) => link.crew_id === c.id)
      .map((link) => link.user_id);
    setCSelectedMembers(assignedIds);
    setCActive(c.is_active);
    setFormError(null);
    setCrewModalOpen(true);
  };

  const toggleCrewMemberSelection = (uid: string) => {
    setCSelectedMembers((prev) =>
      prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]
    );
  };

  const handleSaveCrew = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.token || !activeGroup?.id) return;
    setFormError(null);
    setSaving(true);
    try {
      const { error } = await supabase.rpc('upsert_crew', {
        p_token: session.token,
        p_crew_id: editingCrew?.id || null,
        p_group_id: activeGroup.id,
        p_name: cName,
        p_vehicle_tag: cVehicle,
        p_zone_focus: cZone,
        p_member_ids: cSelectedMembers,
        p_is_active: cActive,
      });
      if (error) throw new Error(error.message);
      setCrewModalOpen(false);
      await loadData();
    } catch (err) {
      setFormError(describeError(err, lang));
    } finally {
      setSaving(false);
    }
  };

  const handleToggleGroupStatus = async (grp: Group) => {
    if (!session?.token) return;
    await supabase.rpc('upsert_group', {
      p_token: session.token,
      p_code: grp.code,
      p_name: grp.name,
      p_description: grp.description || '',
      p_is_active: !grp.is_active,
    });
    await refreshGroups();
  };

  const handleAddGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.token) return;
    setSaving(true);
    setFormError(null);
    try {
      const { error } = await supabase.rpc('upsert_group', {
        p_token: session.token,
        p_code: gCode,
        p_name: gName,
        p_description: gDesc,
        p_is_active: true,
      });
      if (error) throw new Error(error.message);
      setGroupModalOpen(false);
      setGCode('');
      setGName('');
      setGDesc('');
      await refreshGroups();
    } catch (err) {
      setFormError(describeError(err, lang));
    } finally {
      setSaving(false);
    }
  };

  const techniciansOnly = members.filter((m) => m.role === 'technician');

  const getCrewsForUser = (userId: string) => {
    const cIds = crewLinks.filter((l) => l.user_id === userId).map((l) => l.crew_id);
    return crews.filter((c) => cIds.includes(c.id));
  };

  const getMembersForCrew = (crewId: string) => {
    const uIds = crewLinks.filter((l) => l.crew_id === crewId).map((l) => l.user_id);
    return members.filter((m) => uIds.includes(m.id));
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-lg font-extrabold text-slate-900">{t('teamHeader')}</h2>
          <p className="text-xs text-slate-500 mt-1">{t('teamSubheader')}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {subTab === 'members' && (
            <button
              type="button"
              onClick={openAddMember}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold shadow-xs transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>{t('addMember')}</span>
            </button>
          )}
          {subTab === 'crews' && (
            <button
              type="button"
              onClick={openAddCrew}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold shadow-xs transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>{t('addCrew')}</span>
            </button>
          )}
          {subTab === 'groups' && (
            <button
              type="button"
              onClick={() => {
                setFormError(null);
                setGroupModalOpen(true);
              }}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold shadow-xs transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>{t('addGroup')}</span>
            </button>
          )}
        </div>
      </div>

      {/* Sub-navigation */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setSubTab('members')}
          className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold border transition cursor-pointer ${
            subTab === 'members'
              ? 'bg-emerald-900 text-white border-emerald-900 shadow-xs'
              : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>
            {t('tabMembers')} ({members.length})
          </span>
        </button>

        <button
          type="button"
          onClick={() => setSubTab('crews')}
          className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold border transition cursor-pointer ${
            subTab === 'crews'
              ? 'bg-emerald-900 text-white border-emerald-900 shadow-xs'
              : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
          }`}
        >
          <Truck className="w-4 h-4" />
          <span>
            {t('tabCrews')} ({crews.length})
          </span>
        </button>

        <button
          type="button"
          onClick={() => setSubTab('groups')}
          className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold border transition cursor-pointer ${
            subTab === 'groups'
              ? 'bg-emerald-900 text-white border-emerald-900 shadow-xs'
              : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
          }`}
        >
          <Building2 className="w-4 h-4" />
          <span>
            {t('tabGroups')} ({availableGroups.length})
          </span>
        </button>
      </div>

      {/* Tab Content */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-sm text-slate-500">
          Loading Group {activeGroup?.code} data...
        </div>
      ) : subTab === 'members' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {members.map((m) => {
            const userCrews = getCrewsForUser(m.id);
            return (
              <div
                key={m.id}
                className={`bg-white rounded-2xl border p-5 transition shadow-xs ${
                  m.is_active ? 'border-slate-200' : 'border-slate-200 opacity-60 bg-slate-50'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                        m.role === 'supervisor'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-emerald-100 text-emerald-800'
                      }`}
                    >
                      {m.role === 'supervisor' ? (
                        <ShieldCheck className="w-5 h-5" />
                      ) : (
                        <Wrench className="w-5 h-5" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-bold text-slate-900 text-sm truncate">{m.full_name}</h3>
                      <div className="text-xs text-slate-500 font-medium">@{m.username}</div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => openEditMember(m)}
                    className="p-2 rounded-lg text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 transition cursor-pointer"
                    title={t('editMember')}
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Role:</span>
                    <span
                      className={`px-2 py-0.5 rounded-full font-bold text-[11px] ${
                        m.role === 'supervisor'
                          ? 'bg-amber-50 text-amber-800 border border-amber-200'
                          : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                      }`}
                    >
                      {m.role === 'supervisor' ? t('supervisorRole') : t('technicianRole')}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Phone:</span>
                    {m.phone ? (
                      <a
                        href={`tel:${m.phone.startsWith('0') || m.phone.startsWith('+') ? m.phone : `0${m.phone}`}`}
                        className="inline-flex items-center gap-1 font-bold text-emerald-700 hover:underline"
                      >
                        <Phone className="w-3 h-3" />
                        <span>{m.phone}</span>
                      </a>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </div>

                  {m.role === 'technician' && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-500 shrink-0">Crew:</span>
                      {userCrews.length > 0 ? (
                        <div className="flex flex-wrap justify-end gap-1">
                          {userCrews.map((c) => (
                            <span
                              key={c.id}
                              className="px-2 py-0.5 rounded-md bg-sky-50 text-sky-800 border border-sky-200 font-semibold text-[11px]"
                            >
                              {c.name}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-500 text-[11px]">{t('noCrewAssigned')}</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : subTab === 'crews' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {crews.map((c) => {
            const cMembers = getMembersForCrew(c.id);
            return (
              <div
                key={c.id}
                className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-sky-100 text-sky-800 flex items-center justify-center">
                      <Truck className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-extrabold text-slate-900 text-base">{c.name}</h3>
                        {c.vehicle_tag && (
                          <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[11px] font-bold">
                            {c.vehicle_tag}
                          </span>
                        )}
                      </div>
                      {c.zone_focus && (
                        <div className="flex items-center gap-1 text-xs text-slate-500 mt-0.5">
                          <MapPin className="w-3.5 h-3.5 text-emerald-600" />
                          <span>{c.zone_focus}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => openEditCrew(c)}
                    className="p-2 rounded-lg text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 transition cursor-pointer"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                </div>

                <div className="pt-3 border-t border-slate-100">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">
                    Assigned Technicians ({cMembers.length})
                  </div>
                  {cMembers.length === 0 ? (
                    <div className="text-xs text-slate-500 italic">No technicians assigned yet</div>
                  ) : (
                    <div className="space-y-2">
                      {cMembers.map((tech) => (
                        <div
                          key={tech.id}
                          className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-200/70"
                        >
                          <div className="flex items-center gap-2">
                            <Wrench className="w-3.5 h-3.5 text-emerald-700" />
                            <span className="text-xs font-bold text-slate-800">
                              {tech.full_name}
                            </span>
                          </div>
                          {tech.phone && (
                            <a
                              href={`tel:0${tech.phone.replace(/^0/, '')}`}
                              className="text-xs font-semibold text-emerald-700 hover:underline flex items-center gap-1"
                            >
                              <Phone className="w-3 h-3" />
                              <span>{tech.phone}</span>
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {availableGroups.map((g) => (
            <div
              key={g.id}
              className={`rounded-2xl border p-5 bg-white shadow-xs flex flex-col justify-between gap-4 ${
                g.is_active ? 'border-emerald-300 ring-1 ring-emerald-500/20' : 'border-slate-200'
              }`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="px-3 py-1 rounded-full text-xs font-extrabold bg-emerald-950 text-emerald-300">
                    Group {g.code}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 text-xs font-bold ${
                      g.is_active ? 'text-emerald-700' : 'text-slate-500'
                    }`}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {g.is_active ? t('statusActive') : t('statusInactive')}
                  </span>
                </div>
                <h3 className="font-bold text-slate-900 text-sm mt-3">{g.name}</h3>
                <p className="text-xs text-slate-500 mt-1">{g.description || '—'}</p>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                <span className="text-[11px] text-slate-500">Department Scaling</span>
                {g.code !== 'F1' ? (
                  <button
                    type="button"
                    onClick={() => void handleToggleGroupStatus(g)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                      g.is_active
                        ? 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                        : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200'
                    }`}
                  >
                    {g.is_active ? 'Deactivate' : `Activate Group ${g.code}`}
                  </button>
                ) : (
                  <span className="text-[11px] font-bold text-emerald-700">Primary Team</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Member Modal */}
      {memberModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-md overflow-hidden">
            <div className="px-5 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-bold text-slate-900 text-sm">
                {editingMember ? t('editMember') : t('addMember')} — Group {activeGroup?.code}
              </h3>
              <button
                type="button"
                onClick={() => setMemberModalOpen(false)}
                className="p-1 text-slate-500 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveMember} className="p-5 space-y-4">
              {formError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
                  {formError}
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {t('fullName')}
                </label>
                <input
                  type="text"
                  required
                  value={mFullName}
                  onChange={(e) => setMFullName(e.target.value)}
                  placeholder="e.g. Cabdiraxmaan Maxamed"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {t('username')}
                  </label>
                  <input
                    type="text"
                    required
                    value={mUsername}
                    onChange={(e) => setMUsername(e.target.value)}
                    placeholder="e.g. cabdi"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {t('phone')}
                  </label>
                  <input
                    type="tel"
                    value={mPhone}
                    onChange={(e) => setMPhone(e.target.value)}
                    placeholder="634100101"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">{t('role')}</label>
                  <select
                    value={mRole}
                    onChange={(e) => setMRole(e.target.value as UserRole)}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-sm font-semibold bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  >
                    <option value="technician">{t('technicianRole')}</option>
                    <option value="supervisor">{t('supervisorRole')}</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Status</label>
                  <select
                    value={mActive ? 'active' : 'inactive'}
                    onChange={(e) => setMActive(e.target.value === 'active')}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-sm font-semibold bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  >
                    <option value="active">{t('statusActive')}</option>
                    <option value="inactive">{t('statusInactive')}</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {editingMember ? t('pinResetLabel') : t('pinNewLabel')}
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  required={!editingMember}
                  value={mPin}
                  onChange={(e) => setMPin(e.target.value.replace(/\D/g, ''))}
                  placeholder={editingMember ? '•••• (unchanged)' : '1111'}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-bold tracking-widest focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setMemberModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
                >
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-700 hover:bg-emerald-800 text-white disabled:opacity-50 cursor-pointer"
                >
                  {saving ? '...' : t('saveChanges')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Crew Modal */}
      {crewModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-md overflow-hidden">
            <div className="px-5 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-bold text-slate-900 text-sm">
                {editingCrew ? t('editCrew') : t('addCrew')}
              </h3>
              <button
                type="button"
                onClick={() => setCrewModalOpen(false)}
                className="p-1 text-slate-500 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveCrew} className="p-5 space-y-4">
              {formError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {t('crewName')}
                  </label>
                  <input
                    type="text"
                    required
                    value={cName}
                    onChange={(e) => setCName(e.target.value)}
                    placeholder="F1 - Crew A"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {t('vehicleTag')}
                  </label>
                  <input
                    type="text"
                    value={cVehicle}
                    onChange={(e) => setCVehicle(e.target.value)}
                    placeholder="Gaadhi 01"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {t('zoneFocus')}
                </label>
                <input
                  type="text"
                  value={cZone}
                  onChange={(e) => setCZone(e.target.value)}
                  placeholder="e.g. Jigjigayar, Gantalaha, Bada Cas"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  {t('selectCrewMembers')}
                </label>
                <div className="max-h-44 overflow-y-auto space-y-1.5 border border-slate-200 rounded-xl p-2.5 bg-slate-50">
                  {techniciansOnly.map((tech) => {
                    const checked = cSelectedMembers.includes(tech.id);
                    return (
                      <label
                        key={tech.id}
                        className={`flex items-center justify-between p-2 rounded-lg border text-xs font-semibold cursor-pointer transition ${
                          checked
                            ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                            : 'bg-white border-slate-200 text-slate-700'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleCrewMemberSelection(tech.id)}
                            className="rounded text-emerald-600 focus:ring-emerald-500"
                          />
                          <span>{tech.full_name}</span>
                        </div>
                        <span className="text-[11px] text-slate-500">{tech.phone || ''}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCrewModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
                >
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-700 hover:bg-emerald-800 text-white disabled:opacity-50 cursor-pointer"
                >
                  {saving ? '...' : t('saveChanges')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Group Modal */}
      {groupModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-sm overflow-hidden">
            <div className="px-5 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-bold text-slate-900 text-sm">{t('addGroup')}</h3>
              <button
                type="button"
                onClick={() => setGroupModalOpen(false)}
                className="p-1 text-slate-500 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleAddGroup} className="p-5 space-y-4">
              {formError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">
                  {formError}
                </div>
              )}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Group Code</label>
                <input
                  type="text"
                  required
                  value={gCode}
                  onChange={(e) => setGCode(e.target.value.toUpperCase())}
                  placeholder="e.g. F4"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-bold"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Group Name</label>
                <input
                  type="text"
                  required
                  value={gName}
                  onChange={(e) => setGName(e.target.value)}
                  placeholder="Group F4 — Fixed Broadband"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Description</label>
                <input
                  type="text"
                  value={gDesc}
                  onChange={(e) => setGDesc(e.target.value)}
                  placeholder="Zone or team notes"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setGroupModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
                >
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-700 text-white cursor-pointer"
                >
                  {saving ? '...' : t('saveChanges')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
