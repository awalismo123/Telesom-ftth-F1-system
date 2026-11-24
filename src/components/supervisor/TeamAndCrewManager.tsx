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
  KeyRound,
  RefreshCw,
  AlertTriangle,
  Lock as LockIcon,
  ListChecks,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../lib/i18n';
import { useTableChanges } from '../../lib/realtime';
import { fetchGroupOverview, fetchTeamWorkload, type TeamWorkloadJob } from '../../lib/reads';
import { fetchTask } from '../../lib/opsService';
import { JobActionsSheet } from './dispatch/JobActionsSheet';
import { EditJobSheet } from './dispatch/EditJobSheet';
import { faultTypeLabel } from '../../lib/faults';
import {
  capacityCounts,
  capacitySentence,
  inactiveMembersInActiveCrew,
  crewRetirementProblem,
  lineNumbersOf,
  retirementProblem,
  workloadLine,
  type HeldJob,
} from '../../lib/roster';
import {
  clearDepartmentPins,
  fetchPinStatus,
  flagDepartmentPins,
  flagPinsExplanation,
  lockedSentence,
  pinProblem,
  setMemberPin,
  stalePinMembers,
  stalePinSentence,
  type PinStatus,
} from '../../lib/pins';
import { useToast } from '../ui/Toast';
import type { Crew, Group, Task, UserProfile, UserRole } from '../../types/database';
import { CREW_MAX_MEMBERS, checkCrewSize } from '../../lib/crew';

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
  /**
   * The open jobs the board is currently showing, per person and per crew.
   *
   * Without this the retirement rule would be asked about an empty list and
   * always pass — a guard that looks present and does nothing.
   */
  const [workload, setWorkload] = useState<TeamWorkloadJob[]>([]);
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
  const [loadError, setLoadError] = useState<string | null>(null);
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

  const toast = useToast();
  const [flaggingPins, setFlaggingPins] = useState(false);
  /** Who is on a department PIN and who is locked out — one read, two facts. */
  const [pinStatus, setPinStatus] = useState<PinStatus>({ onDepartmentPin: [], locked: [] });
  /** The member whose PIN sheet is open, and what has been typed into it. */
  const [pinMember, setPinMember] = useState<UserProfile | null>(null);
  const [pinDraft, setPinDraft] = useState('');
  const [pinBusy, setPinBusy] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  /** Which member's job list is open, and the job being acted on. */
  const [jobsFor, setJobsFor] = useState<UserProfile | null>(null);
  const [actionTaskId, setActionTaskId] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<TeamWorkloadJob | null>(null);
  /** The full row behind `editingTask`, fetched rather than assembled. */
  const [openTask, setOpenTask] = useState<Task | null>(null);
  const [openTaskError, setOpenTaskError] = useState<string | null>(null);

  /**
   * Ask everyone on a department PIN to choose their own at next sign-in.
   *
   * Says what actually happened rather than a reassuring number: this can
   * legitimately change nobody, and claiming otherwise is how the old banner
   * became permanent.
   */
  const flagPins = async () => {
    if (!session?.token) return;
    setFlaggingPins(true);
    try {
      const flagged = await flagDepartmentPins(session.token);
      toast.success(
        flagged === 0
          ? lang === 'so' ? 'Qofna looma baahnayn calaamad' : 'Nobody needed flagging'
          : lang === 'so'
            ? `${flagged} qof waa la calaamadeeyay`
            : `${flagged} ${flagged === 1 ? 'account' : 'accounts'} flagged`,
        { description: flagPinsExplanation(lang) },
      );
      await loadPins();
    } catch (error) {
      toast.error(
        lang === 'so' ? 'Lama calaamadeyn karin' : 'Could not flag the PINs',
        { description: describeError(error, lang) },
      );
    } finally {
      setFlaggingPins(false);
    }
  };

  /**
   * The exit that never existed: everybody here has their own PIN now.
   *
   * Used when the flag is stale rather than true — somebody changed their PIN
   * out of band, or an account was seeded before the flag was tracked.
   */
  const clearPins = async () => {
    if (!session?.token) return;
    setFlaggingPins(true);
    try {
      const changed = await clearDepartmentPins(session.token);
      toast.success(
        lang === 'so'
          ? `${changed} qof loo calaamadeeyay inuu PIN-kiisa isticmaalo`
          : `${changed} ${changed === 1 ? 'account' : 'accounts'} marked as using their own PIN`,
      );
      await loadPins();
    } catch (error) {
      toast.error(
        lang === 'so' ? 'Lama beddeli karin' : 'Could not update the PIN state',
        { description: describeError(error, lang) },
      );
    } finally {
      setFlaggingPins(false);
    }
  };

  /**
   * Issue somebody a PIN.
   *
   * This is the whole point of the screen: a technician who cannot sign in
   * calls the supervisor, and the supervisor needs to fix it from here, now,
   * without the database console. It also clears any lockout — the reason the
   * same action used to leave the person still unable to get in.
   */
  const savePin = async () => {
    if (!pinMember || !session?.token || !activeGroup?.id) return;

    const problem = pinProblem(pinDraft, lang);
    if (problem) {
      setPinError(problem);
      return;
    }

    setPinBusy(true);
    setPinError(null);
    try {
      await setMemberPin({
        token: session.token,
        memberId: pinMember.id,
        groupId: activeGroup.id,
        username: pinMember.username,
        fullName: pinMember.full_name,
        phone: pinMember.phone,
        role: pinMember.role,
        isActive: pinMember.is_active,
        pin: pinDraft,
      });
      toast.success(
        lang === 'so'
          ? `PIN-ka ${pinMember.full_name} waa la beddelay`
          : `${pinMember.full_name} has a new PIN`,
        {
          description:
            lang === 'so'
              ? 'Wuxuu dooran doonaa mid gaar ah marka uu soo galo.'
              : 'They will choose their own at next sign-in.',
        },
      );
      setPinMember(null);
      setPinDraft('');
      await loadData(true);
      await loadPins();
    } catch (error) {
      setPinError(describeError(error, lang));
    } finally {
      setPinBusy(false);
    }
  };

  /**
   * The PIN state, read separately from the roster.
   *
   * Deliberately its own call and its own failure: if this read fails the page
   * still shows the members, and — importantly — the banner does not fall back
   * to a guess. A missing answer is not "nobody is on a department PIN".
   */
  const loadPins = useCallback(async () => {
    if (!activeGroup?.id || !session?.token) return;
    try {
      setPinStatus(await fetchPinStatus(session.token, activeGroup.id));
    } catch {
      // Left as-is rather than cleared: an empty list would read as "all clear".
    }
  }, [activeGroup?.id, session?.token]);

  const loadData = useCallback(async (silent = false) => {
    if (!activeGroup?.id || !session?.token) return;
    // A background refresh (another supervisor added a technician) must not
    // replace the table with a skeleton under the reader's finger.
    if (!silent) setLoading(true);
    try {
      const [overview, jobs] = await Promise.all([
        fetchGroupOverview(session.token, activeGroup.id),
        // A workload read failure must not blank the roster: the screen still
        // lists everybody, and the rule degrades to the database's own refusal.
        fetchTeamWorkload(session.token, activeGroup.id).catch(() => [] as TeamWorkloadJob[]),
      ]);
      setMembers(overview.members);
      setCrews(overview.crews);
      setCrewLinks(overview.crew_members as CrewMemberRow[]);
      setWorkload(jobs);
    } catch (error) {
      if (!silent) setLoadError(describeError(error, lang));
    } finally {
      setLoading(false);
    }
  }, [activeGroup?.id, session?.token]);

  useEffect(() => {
    void loadData();
    void loadPins();
  }, [loadData, loadPins]);

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
  // A PIN being issued or replaced elsewhere changes the badge and the banner.
  useTableChanges({ table: 'user_credentials', onChange: () => void loadPins() });

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

  /**
   * Open one job for editing.
   *
   * Fetches the real row first. The failure is surfaced on the panel rather
   * than swallowed: if the row cannot be read, the supervisor must not be
   * shown a form that would overwrite it with blanks.
   */
  const editJob = useCallback(
    async (job: TeamWorkloadJob) => {
      if (!session?.token) return;
      setOpenTaskError(null);
      setEditingTask(job);
      setOpenTask(null);
      try {
        setOpenTask(await fetchTask(session.token, job.id));
      } catch (error) {
        setOpenTaskError(describeError(error, lang));
      }
    },
    [session?.token, lang],
  );

  /** The open jobs assigned to one person, in the shape the rule wants. */
  const jobsForUser = (userId: string): HeldJob[] =>
    workload
      .filter((job) => job.assigned_user_id === userId)
      .map((job) => ({
        id: job.id,
        line_number: job.line_number,
        customer_name: job.customer_name,
        status: job.status,
      }));

  const jobsForCrew = (crewId: string): HeldJob[] =>
    workload
      .filter((job) => job.assigned_crew_id === crewId)
      .map((job) => ({
        id: job.id,
        line_number: job.line_number,
        customer_name: job.customer_name,
        status: job.status,
      }));

  /**
   * Refuse the save that would hide work.
   *
   * The database refuses it too (migration 034); this exists so the sentence is
   * in the supervisor's language, names the line numbers, and arrives before the
   * round trip rather than as a constraint name afterwards.
   */
  const retirementRefusal = (jobs: HeldJob[]): string | null => {
    const check = retirementProblem(jobs);
    return check.ok ? null : check.message![lang];
  };

  /**
   * Members of this crew who are off duty.
   *
   * Saving an active crew with one of these produces a staffed-looking vehicle
   * that cannot take a job. The database refuses it; this says which person.
   */
  const offDutyInCrew = (memberIds: string[]) =>
    members.filter((member) => memberIds.includes(member.id) && !member.is_active);

  const handleSaveMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.token || !activeGroup?.id) return;
    // Only a *deactivation* is refused. Editing a name, phone, PIN or role is
    // untouched by the rule, and a supervisor must always be able to correct a
    // record without first emptying somebody's hands.
    if (editingMember && editingMember.is_active && !mActive) {
      const refusal = retirementRefusal(jobsForUser(editingMember.id));
      if (refusal) {
        setFormError(`${refusal}\n${lineNumbersOf(jobsForUser(editingMember.id))}`);
        return;
      }
    }

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

  /**
   * A crew is one or two people — the vehicle, the partner, the shared timer.
   * The database enforces the same cap (migration 023); this stops the click
   * that would have failed, and says why instead of dropping it silently.
   */
  const toggleCrewMemberSelection = (uid: string) => {
    setFormError(null);
    setCSelectedMembers((prev) => {
      if (prev.includes(uid)) return prev.filter((id) => id !== uid);
      if (prev.length >= CREW_MAX_MEMBERS) {
        const size = checkCrewSize(prev.length + 1, true);
        setFormError(size.message ? size.message[lang] : null);
        return prev;
      }
      return [...prev, uid];
    });
  };

  const handleSaveCrew = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.token || !activeGroup?.id) return;
    setFormError(null);

    // Mirrors the database rule. Doing it here first means the supervisor gets
    // a sentence in their own language instead of a constraint name.
    const size = checkCrewSize(cSelectedMembers.length, cActive);
    if (!size.ok) {
      setFormError(size.message ? size.message[lang] : null);
      return;
    }

    // An active crew whose members are off duty is a vehicle on the roster that
    // cannot work. Refused here for the same reason the database refuses it.
    const offDuty = inactiveMembersInActiveCrew(cActive, offDutyInCrew(cSelectedMembers));
    if (offDuty) {
      setFormError(offDuty[lang]);
      return;
    }

    // Retiring a crew hides its jobs from every lane exactly as deactivating a
    // person does, because `dispatch_load` filters on `is_active`.
    if (editingCrew && editingCrew.is_active && !cActive) {
      const held = jobsForCrew(editingCrew.id);
      const check = crewRetirementProblem(held);
      if (!check.ok) {
        setFormError(`${check.message![lang]}\n${lineNumbersOf(held)}`);
        return;
      }
    }

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
  const staleCount = stalePinMembers(members).length;

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
      {loadError && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-800">
          {loadError}
        </div>
      )}

      {/* Header */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-lg font-extrabold text-slate-900">{t('teamHeader')}</h2>
          <p className="text-xs text-slate-500 mt-1">{t('teamSubheader')}</p>
          {/*
            The board's lanes are crews *and* every technician, so two crews of
            two appear as six targets. This says how much real capacity there is,
            because that is the number a supervisor plans a shift with.
          */}
          {!loading && (
            <p className="text-[11px] font-semibold text-brand-800 mt-1.5 tabular">
              {(() => {
                const counts = capacityCounts(crews, techniciansOnly, crewLinks);
                return capacitySentence(counts.crewsWithMembers, counts.loneTechnicians, lang);
              })()}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {subTab === 'members' && (
            <button
              type="button"
              onClick={openAddMember}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-700 hover:bg-brand-800 text-white text-xs font-bold shadow-xs transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>{t('addMember')}</span>
            </button>
          )}
          {subTab === 'crews' && (
            <button
              type="button"
              onClick={openAddCrew}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-700 hover:bg-brand-800 text-white text-xs font-bold shadow-xs transition cursor-pointer"
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
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-700 hover:bg-brand-800 text-white text-xs font-bold shadow-xs transition cursor-pointer"
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
              ? 'bg-brand-900 text-white border-brand-900 shadow-xs'
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
              ? 'bg-brand-900 text-white border-brand-900 shadow-xs'
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
              ? 'bg-brand-900 text-white border-brand-900 shadow-xs'
              : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
          }`}
        >
          <Building2 className="w-4 h-4" />
          <span>
            {t('tabGroups')} ({availableGroups.length})
          </span>
        </button>
      </div>

      {/* Who still signs in with a PIN the department chose.
       *
       * Three things this block used to get wrong, all of which made it a
       * permanent feature of the page:
       *   • it counted finished accounts (anyone whose must_change flag was not
       *     true), so the number could never reach zero — the supervisor, who
       *     had already changed his, was the one it kept naming;
       *   • its only button could set the flag, never clear it;
       *   • it printed a paragraph of instructions instead of an action, so the
       *     sentence never changed no matter what anybody did.
       *
       * It now reads one fact from the database, offers both directions, and
       * says nothing at all when there is nothing to say. */}
      {!loading && staleCount > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-start gap-2 min-w-0 flex-1">
            <KeyRound className="w-4 h-4 text-amber-700 mt-0.5 shrink-0" aria-hidden="true" />
            <div className="min-w-0 space-y-1">
              <div className="text-xs font-extrabold text-amber-900">
                {lang === 'so' ? 'PIN-yada waaxda' : 'Department PINs still in use'}
              </div>
              <div className="text-[11px] font-semibold text-amber-800">
                {stalePinSentence(staleCount, lang)}
              </div>
              <ul className="text-[11px] text-amber-900 font-semibold flex flex-wrap gap-x-2 gap-y-0.5">
                {stalePinMembers(members).map((m) => (
                  <li key={m.full_name} className="inline-flex items-center gap-1">
                    <span aria-hidden="true">·</span>
                    {m.full_name}
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-amber-800 leading-snug">{flagPinsExplanation(lang)}</p>
            </div>
          </div>
          <div className="shrink-0 flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => void flagPins()}
              disabled={flaggingPins}
              className="inline-flex items-center justify-center gap-1.5 min-h-11 px-3 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-extrabold disabled:opacity-60 cursor-pointer"
            >
              {flaggingPins ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              {lang === 'so' ? 'Weydii PIN cusub' : 'Ask for a new PIN'}
            </button>
            {/* The exit. Without it this box was a one-way door. */}
            <button
              type="button"
              onClick={() => void clearPins()}
              disabled={flaggingPins}
              className="inline-flex items-center justify-center gap-1.5 min-h-11 px-3 rounded-xl bg-white border border-amber-300 text-amber-900 text-[11px] font-bold disabled:opacity-60 cursor-pointer"
            >
              {lang === 'so' ? 'Dhammaan way beddeleen' : 'They have all changed theirs'}
            </button>
          </div>
        </div>
      )}

      {/* Locked out after wrong PINs. Invisible before this, and the reason a
          supervisor could issue a correct new PIN and watch it do nothing. */}
      {!loading && pinStatus.locked.length > 0 && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 flex items-start gap-2">
          <LockIcon className="w-4 h-4 text-rose-700 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <div className="text-xs font-extrabold text-rose-900">
              {lang === 'so' ? 'Waa la xannibay' : 'Locked out'}
            </div>
            <ul className="mt-0.5 text-[11px] text-rose-800 font-semibold">
              {pinStatus.locked.map((row) => (
                <li key={row.id}>
                  {row.full_name} — {lockedSentence(row.until, lang)}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[11px] text-rose-800 leading-snug">
              {lang === 'so'
                ? 'Haddii aad siiso PIN cusub, xannibaadda waa la tirtirayaa isla markiiba.'
                : 'Issuing a new PIN clears the lock immediately, from the member’s card below.'}
            </p>
          </div>
        </div>
      )}

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
                          : 'bg-brand-100 text-brand-800'
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
                      {m.seed_pin_flag ? (
                        <div className="mt-0.5 inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                          <KeyRound className="w-3 h-3" aria-hidden="true" />
                          {t('pinMustChange')}
                        </div>
                      ) : null}
                      {pinStatus.locked.some((row) => row.id === m.id) && (
                        <div className="mt-0.5 inline-flex items-center gap-1 rounded border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-800">
                          <LockIcon className="w-3 h-3" aria-hidden="true" />
                          {lang === 'so' ? 'Xanniban' : 'Locked out'}
                        </div>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setPinMember(m);
                      setPinDraft('');
                      setPinError(null);
                    }}
                    className={`p-2 rounded-lg transition cursor-pointer ${
                      pinStatus.locked.some((row) => row.id === m.id)
                        ? 'text-rose-600 hover:bg-rose-50'
                        : 'text-slate-500 hover:text-amber-700 hover:bg-amber-50'
                    }`}
                    title={lang === 'so' ? 'Beddeli PIN-ka' : 'Change PIN'}
                    aria-label={`${lang === 'so' ? 'Beddeli PIN-ka' : 'Change PIN'} — ${m.full_name}`}
                  >
                    <KeyRound className="w-4 h-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => openEditMember(m)}
                    className="p-2 rounded-lg text-slate-500 hover:text-brand-700 hover:bg-brand-50 transition cursor-pointer"
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
                          : 'bg-brand-50 text-brand-800 border border-brand-200'
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
                        className="inline-flex items-center gap-1 font-bold text-brand-700 hover:underline"
                      >
                        <Phone className="w-3 h-3" />
                        <span>{m.phone}</span>
                      </a>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </div>

                  {/*
                    What they are holding, right now.

                    This is the number that decides whether they can go off duty,
                    so it belongs on the card rather than only in the refusal.
                  */}
                  {(() => {
                    const held = jobsForUser(m.id);
                    const line = workloadLine(
                      held.length,
                      held.filter((row) => row.status === 'in_progress').length,
                      lang,
                    );
                    if (!line) return null;
                    return (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-slate-500 shrink-0">
                            {lang === 'so' ? 'Shaqo:' : 'Work:'}
                          </span>
                          <span className="font-bold text-slate-800 tabular">{line}</span>
                        </div>
                        {/*
                          The jobs themselves, which this card could only count
                          before. Opening one from here is the difference between
                          "he has three" and being able to fix them without
                          leaving Team & Crews for the dispatch board.
                        */}
                        <button
                          type="button"
                          onClick={() => setJobsFor(m)}
                          className="w-full inline-flex items-center justify-center gap-1.5 min-h-11 rounded-xl bg-slate-50 border border-slate-200 text-[11px] font-bold text-slate-700 hover:bg-slate-100 cursor-pointer"
                        >
                          <ListChecks className="w-3.5 h-3.5" aria-hidden="true" />
                          {lang === 'so'
                            ? `Fur shaqooyinka (${held.length})`
                            : `Open the jobs (${held.length})`}
                        </button>
                      </div>
                    );
                  })()}

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
                          <MapPin className="w-3.5 h-3.5 text-brand-600" />
                          <span>{c.zone_focus}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => openEditCrew(c)}
                    className="p-2 rounded-lg text-slate-500 hover:text-brand-700 hover:bg-brand-50 transition cursor-pointer"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                </div>

                {/*
                  The crew's own jobs are counted separately from its members'.
                  Both block retirement, and only this one is easy to forget.
                */}
                {(() => {
                  const held = jobsForCrew(c.id);
                  if (held.length === 0) return null;
                  const active = held.filter((row) => row.status === 'in_progress').length;
                  return (
                    <div className="flex items-center justify-between rounded-xl bg-slate-50 border border-slate-200 px-2.5 py-1.5">
                      <span className="text-[11px] font-semibold text-slate-600">
                        {lang === 'so' ? 'Shaqooyin halkan ku xiran' : 'Jobs held by this crew'}
                      </span>
                      <span className="text-[11px] font-extrabold text-slate-900 tabular">
                        {workloadLine(held.length, active, lang)}
                      </span>
                    </div>
                  );
                })()}

                <div className="pt-3 border-t border-slate-100">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">
                    {t('assignedTechnicians', { count: cMembers.length })}
                  </div>
                  {cMembers.length === 0 ? (
                    <div className="space-y-1.5">
                      <div className="text-xs text-slate-500 italic">{t('noTechniciansYet')}</div>
                      {/* An active crew with nobody in it cannot be dispatched,
                          but it still counts as a row in the crew list — which
                          is how "crews out of N" came to look healthy while
                          nobody was available. Say it here, where it is fixed. */}
                      {c.is_active && (
                        <div className="flex items-start gap-1.5 rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-1.5 text-[11px] font-semibold text-amber-900">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
                          <span>
                            {lang === 'so'
                              ? 'Kooxdan cidna kuma jirto, marka lama qaybin karo. Ku dar farsamayaqaan ama ka dhig mid aan firfircoonayn.'
                              : 'Nobody is in this crew, so it cannot be dispatched. Add a technician or mark it inactive.'}
                          </span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {cMembers.map((tech) => (
                        <div
                          key={tech.id}
                          className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-200/70"
                        >
                          <div className="flex items-center gap-2">
                            <Wrench className="w-3.5 h-3.5 text-brand-700" />
                            <span className="text-xs font-bold text-slate-800">
                              {tech.full_name}
                            </span>
                          </div>
                          {tech.phone && (
                            <a
                              href={`tel:0${tech.phone.replace(/^0/, '')}`}
                              className="text-xs font-semibold text-brand-700 hover:underline flex items-center gap-1"
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
                g.is_active ? 'border-brand-300 ring-1 ring-brand-500/20' : 'border-slate-200'
              }`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="px-3 py-1 rounded-full text-xs font-extrabold bg-brand-950 text-brand-300">
                    Group {g.code}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 text-xs font-bold ${
                      g.is_active ? 'text-brand-700' : 'text-slate-500'
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
                <span className="text-[11px] text-slate-500">{t('deptScaling')}</span>
                {g.code !== 'F1' ? (
                  <button
                    type="button"
                    onClick={() => void handleToggleGroupStatus(g)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                      g.is_active
                        ? 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                        : 'bg-brand-50 hover:bg-brand-100 text-brand-800 border border-brand-200'
                    }`}
                  >
                    {g.is_active ? t('deactivate') : t('activateGroup', { code: g.code })}
                  </button>
                ) : (
                  <span className="text-[11px] font-bold text-brand-700">{t('primaryTeam')}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Member Modal */}
      {/* Issuing a PIN.
       *
       * The one action that fixes "he cannot sign in", and it did not exist on
       * any screen: a supervisor had to go to the database console. The modal
       * member form technically had a PIN box, but using it to reset a PIN also
       * re-submitted the whole member record, which is not what the supervisor
       * is trying to do.
       *
       * Says plainly what will happen next, because the old behaviour — a
       * correct new PIN that still would not sign in — looked like a bug in
       * exactly this form. */}
      {pinMember && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-md overflow-hidden">
            <div className="px-5 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-bold text-slate-900 text-sm">
                {lang === 'so' ? 'Beddeli PIN-ka' : 'Change PIN'} — {pinMember.full_name}
              </h3>
              <button
                type="button"
                onClick={() => setPinMember(null)}
                className="p-1 text-slate-500 hover:text-slate-600 cursor-pointer"
                aria-label={lang === 'so' ? 'Xir' : 'Close'}
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void savePin();
              }}
              className="p-5 space-y-4"
            >
              <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2">
                <div className="text-[11px] font-bold text-slate-700 tabular">
                  @{pinMember.username}
                </div>
                <div className="text-[10px] text-slate-500">
                  {pinMember.role === 'supervisor' ? t('supervisorRole') : t('technicianRole')}
                  {pinStatus.locked.some((row) => row.id === pinMember.id) && (
                    <> · {lang === 'so' ? 'hadda xanniban' : 'currently locked out'}</>
                  )}
                </div>
              </div>

              {pinError && (
                <div
                  role="alert"
                  className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold"
                >
                  {pinError}
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1" htmlFor="new-pin">
                  {lang === 'so' ? 'PIN cusub (4–6 lambar)' : 'New PIN (4–6 digits)'}
                </label>
                <input
                  id="new-pin"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={6}
                  value={pinDraft}
                  onChange={(e) => {
                    setPinDraft(e.target.value.replace(/\D/g, ''));
                    setPinError(null);
                  }}
                  placeholder="••••"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-lg font-bold tracking-[0.4em] tabular focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
              </div>

              <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 space-y-1">
                <p className="text-[11px] font-bold text-amber-900">
                  {lang === 'so' ? 'Waxa dhacaya marka la kaydiyo' : 'What happens when you save'}
                </p>
                <ul className="text-[11px] text-amber-800 leading-snug list-disc pl-4 space-y-0.5">
                  <li>
                    {lang === 'so'
                      ? 'PIN-kan ayaa si degdeg ah u shaqeyn doona.'
                      : 'This PIN signs them in immediately.'}
                  </li>
                  <li>
                    {lang === 'so'
                      ? 'Xannibaad kasta waa la tirtirayaa.'
                      : 'Any lockout is cleared.'}
                  </li>
                  <li>
                    {lang === 'so'
                      ? 'Waxaa laga codsan doonaa inay doortaan mid gaar ah marka ay soo galaan.'
                      : 'They are asked to choose their own at next sign-in.'}
                  </li>
                </ul>
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setPinMember(null)}
                  disabled={pinBusy}
                  className="min-h-11 px-3 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-60 cursor-pointer"
                >
                  {lang === 'so' ? 'Jooji' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={pinBusy || pinDraft.length < 4}
                  className="inline-flex items-center justify-center gap-1.5 min-h-11 px-4 rounded-xl bg-brand-900 hover:bg-brand-950 text-white text-xs font-extrabold disabled:opacity-60 cursor-pointer"
                >
                  {pinBusy && <RefreshCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
                  {lang === 'so' ? 'Kaydi PIN-ka' : 'Save PIN'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* One person's open work.
       *
       * Everything here is the same rule the dispatch board uses — `edit_task`
       * and `delete_task` decide, not this screen — so a refusal arrives with
       * the database's own reason and can be acted on. Read-only rows are
       * deliberate: a finished or cancelled job is evidence, and if this list
       * quietly offered to delete one it would be a promise the server breaks.
       */}
      {jobsFor && (() => {
        const held = workload.filter((job) => job.assigned_user_id === jobsFor.id);
        return (
          <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
              <div className="px-5 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between shrink-0">
                <div className="min-w-0">
                  <h3 className="font-bold text-slate-900 text-sm truncate">
                    {lang === 'so' ? 'Shaqooyinka' : 'Jobs'} — {jobsFor.full_name}
                  </h3>
                  <p className="text-[10px] text-slate-500">
                    {held.length === 0
                      ? lang === 'so'
                        ? 'Wax shaqo ah ma hayo'
                        : 'Nothing open'
                      : workloadLine(held.length, held.filter((r) => r.status === 'in_progress').length, lang)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setJobsFor(null)}
                  className="p-1 text-slate-500 hover:text-slate-600 cursor-pointer shrink-0"
                  aria-label={lang === 'so' ? 'Xir' : 'Close'}
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>

              <div className="p-3 overflow-y-auto space-y-2">
                {held.length === 0 && (
                  <p className="px-2 py-6 text-center text-xs text-slate-500">
                    {lang === 'so'
                      ? 'Shaqadan qofkan wax shaqo ah kuma xidhna.'
                      : 'No open jobs are assigned to this person.'}
                  </p>
                )}

                {held.map((job) => {
                  const isFault = job.task_type === 'cilada';
                  return (
                    <div
                      key={job.id}
                      className="rounded-xl border border-slate-200 px-3 py-2 space-y-1.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-mono text-[11px] font-bold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">
                              {job.line_number}
                            </span>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                isFault
                                  ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                  : 'bg-sky-50 text-sky-800 border border-sky-200'
                              }`}
                            >
                              {isFault
                                ? lang === 'so' ? 'Cilad' : 'Fault'
                                : lang === 'so' ? 'Galinta' : 'Install'}
                            </span>
                            {job.priority === 'urgent' && (
                              <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 text-[10px] font-extrabold">
                                {lang === 'so' ? 'DEGDEG' : 'URGENT'}
                              </span>
                            )}
                          </div>
                          <div className="mt-1 text-xs font-bold text-slate-900 truncate">
                            {job.customer_name || '—'}
                          </div>
                          <div className="text-[10px] text-slate-500 truncate">
                            {job.xaafada || job.cablebox_code_raw || '—'}
                            {isFault && (
                              <>
                                {' · '}
                                <span
                                  className={job.fault_type ? 'font-semibold' : 'text-amber-700 font-semibold'}
                                >
                                  {faultTypeLabel(job.fault_type, lang) ??
                                    (lang === 'so' ? 'nooc ma leh' : 'no type')}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => void editJob(job)}
                          className="flex-1 inline-flex items-center justify-center gap-1 min-h-11 rounded-lg bg-white border border-slate-200 text-[11px] font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
                          {lang === 'so' ? 'Wax ka beddel' : 'Edit'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setActionTaskId(job.id)}
                          className="flex-1 inline-flex items-center justify-center gap-1 min-h-11 rounded-lg bg-white border border-slate-200 text-[11px] font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                        >
                          <ListChecks className="w-3.5 h-3.5" aria-hidden="true" />
                          {lang === 'so' ? 'Ficil' : 'Actions'}
                        </button>
                        {job.customer_phone && (
                          <a
                            href={`tel:${job.customer_phone}`}
                            className="inline-flex items-center justify-center min-h-11 w-11 rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
                            aria-label={lang === 'so' ? 'Wac' : 'Call'}
                          >
                            <Phone className="w-3.5 h-3.5" aria-hidden="true" />
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Edit and act, from this screen.
       *
       * `EditJobSheet` is the dispatch board's own form rather than a second
       * copy, so the two cannot drift: the same validation, the same refusals,
       * the same audit row. It needs a full `Task` and the roster read carries
       * only a summary, so the real row is fetched on open.
       *
       * Fetching matters: handing the form a half-filled object would show
       * blank fields for values that exist, and save those blanks back over
       * them. A short wait is the honest trade.
       */}
      {editingTask && openTaskError && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-sm p-5 space-y-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 mt-0.5 shrink-0" aria-hidden="true" />
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  {lang === 'so' ? 'Shaqadan lama akhrin karin' : 'Could not read this job'}
                </h3>
                <p className="mt-1 text-[11px] text-slate-600 leading-snug">{openTaskError}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setEditingTask(null);
                setOpenTaskError(null);
              }}
              className="w-full min-h-11 rounded-xl bg-slate-100 text-xs font-bold text-slate-700 cursor-pointer"
            >
              {lang === 'so' ? 'Xir' : 'Close'}
            </button>
          </div>
        </div>
      )}

      {editingTask && !openTaskError && !openTask && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 px-5 py-4 flex items-center gap-2">
            <RefreshCw className="w-4 h-4 animate-spin text-brand-700" aria-hidden="true" />
            <span className="text-xs font-bold text-slate-700">
              {lang === 'so' ? 'Waa la soo qaadayaa…' : 'Loading the job…'}
            </span>
          </div>
        </div>
      )}

      {editingTask && openTask && session?.token && (
        <EditJobSheet
          open
          onClose={() => setEditingTask(null)}
          task={openTask}
          token={session.token}
          onSaved={() => {
            setOpenTask(null);
            void loadData(true);
            void loadPins();
          }}
        />
      )}

      {actionTaskId && activeGroup?.id && session?.token && (
        <JobActionsSheet
          open
          taskId={actionTaskId}
          onClose={() => setActionTaskId(null)}
          onChanged={() => {
            void loadData(true);
          }}
          token={session.token}
          groupId={activeGroup.id}
          targets={[]}
        />
      )}

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
                  placeholder={t('memberNamePlaceholder')}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand-600"
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
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand-600"
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
                    placeholder="63X XXX XXX"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">{t('role')}</label>
                  <select
                    value={mRole}
                    onChange={(e) => setMRole(e.target.value as UserRole)}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-sm font-semibold bg-white focus:outline-none focus:ring-2 focus:ring-brand-600"
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
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-sm font-semibold bg-white focus:outline-none focus:ring-2 focus:ring-brand-600"
                  >
                    <option value="active">{t('statusActive')}</option>
                    <option value="inactive">{t('statusInactive')}</option>
                  </select>
                </div>
              </div>

              {/*
                The refusal, said before the click.

                A supervisor changing this dropdown to "Inactive" while the person
                holds three faults is about to be refused; telling them now, with
                the line numbers, turns a surprise into a decision.
              */}
              {editingMember &&
                editingMember.is_active &&
                !mActive &&
                (() => {
                  const held = jobsForUser(editingMember.id);
                  const check = retirementProblem(held);
                  if (check.ok) return null;
                  return (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                      <p className="text-[11px] font-bold text-amber-900">{check.message![lang]}</p>
                      <p className="mt-0.5 text-[10px] font-semibold text-amber-800 tabular">
                        {lineNumbersOf(held)}
                      </p>
                    </div>
                  );
                })()}

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
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-bold tracking-widest focus:outline-none focus:ring-2 focus:ring-brand-600"
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
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-brand-700 hover:bg-brand-800 text-white disabled:opacity-50 cursor-pointer"
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
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand-600"
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
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand-600"
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
                  placeholder={t('crewZonePlaceholder')}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
              </div>

              {/*
                The crew's own status.

                It was a variable the form set on create and then never exposed
                again (`setCActive` was only ever called by `openAddCrew` and
                `openEditCrew`), so a crew could not be taken off duty from this
                screen at all — the retirement rule had no door to guard.
              */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">{t('status')}</label>
                <select
                  value={cActive ? 'active' : 'inactive'}
                  onChange={(e) => setCActive(e.target.value === 'active')}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-sm font-semibold bg-white focus:outline-none focus:ring-2 focus:ring-brand-600"
                >
                  <option value="active">{t('statusActive')}</option>
                  <option value="inactive">{t('statusInactive')}</option>
                </select>
              </div>

              {editingCrew &&
                editingCrew.is_active &&
                !cActive &&
                (() => {
                  const held = jobsForCrew(editingCrew.id);
                  const check = crewRetirementProblem(held);
                  if (check.ok) return null;
                  return (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                      <p className="text-[11px] font-bold text-amber-900">{check.message![lang]}</p>
                      <p className="mt-0.5 text-[10px] font-semibold text-amber-800 tabular">
                        {lineNumbersOf(held)}
                      </p>
                    </div>
                  );
                })()}

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
                            ? 'bg-brand-50 border-brand-300 text-brand-900'
                            : 'bg-white border-slate-200 text-slate-700'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleCrewMemberSelection(tech.id)}
                            className="rounded text-brand-600 focus:ring-brand-500"
                          />
                          <span className="truncate">{tech.full_name}</span>
                          {/* Choosing somebody off duty would build a crew that
                              cannot take work. Say it on the row, not on save. */}
                          {!tech.is_active && (
                            <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-extrabold text-amber-900">
                              {t('statusInactive')}
                            </span>
                          )}
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
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-brand-700 hover:bg-brand-800 text-white disabled:opacity-50 cursor-pointer"
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
                <label className="block text-xs font-bold text-slate-700 mb-1">{t('groupCode')}</label>
                <input
                  type="text"
                  required
                  value={gCode}
                  onChange={(e) => setGCode(e.target.value.toUpperCase())}
                  placeholder={t('groupCodePlaceholder')}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-bold"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">{t('groupName')}</label>
                <input
                  type="text"
                  required
                  value={gName}
                  onChange={(e) => setGName(e.target.value)}
                  placeholder={t('groupNamePlaceholder')}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">{t('groupDescription')}</label>
                <input
                  type="text"
                  value={gDesc}
                  onChange={(e) => setGDesc(e.target.value)}
                  placeholder={t('groupDescriptionPlaceholder')}
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
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-brand-700 text-white cursor-pointer"
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
