import React, { createContext, useContext, useEffect, useState } from 'react';
import type { Language } from '../types/database';

const translations = {
  en: {
    appName: 'Telesom FTTH Operations',
    deptSubtitle: 'Fixed Broadband Department — Field System',
    deptFooter: 'Telesom Fixed Broadband Department • Group F1 Field System',
    loginTitle: 'Sign In to Field Portal',
    loginGroupBadge: 'FTTH · Group F1',
    loginNeedPin: 'No PIN yet? Ask your supervisor to set one for you.',
    loginSecureLine: 'Your PIN is personal — do not share it.',
    loginSubtitle: 'Enter your username or Telesom phone number and your PIN',
    identifierLabel: 'Username or Phone (e.g. supervisor or 634...)',
    identifierPlaceholder: 'Your username or Telesom number',
    pinLabel: 'Security PIN',
    pinHint: '4–6 digits',
    signInBtn: 'Sign In',
    signingIn: 'Verifying...',
    supervisorRole: 'Supervisor',
    technicianRole: 'Technician',
    logout: 'Sign Out',
    changePin: 'Change PIN',
    currentPin: 'Current PIN',
    newPin: 'New PIN (4–6 digits)',
    saveChanges: 'Save Changes',
    cancel: 'Cancel',

    // Navigation
    navOverview: 'Command Overview',
    navIngest: 'Daily Sheet Upload',
    navDispatch: 'Dispatch & Clustering',
    navInsights: 'Insights',
    navActivity: 'Record',
    navCablebox: 'Cablebox History',
    navTeam: 'Team & Crews',

    // Tech Mobile Nav
    techMyRoute: 'My Route',
    techBoxes: 'Cableboxes',
    techProfile: 'My Crew & PIN',

    // Overview KPIs
    activeTechs: 'Active Technicians',
    fieldCrews: '2-Tech Crews',
    trackedBoxes: 'Tracked Cableboxes',
    openTasks: 'Open F1 Tasks',

    // Shared interface words — used by more than one screen
    close: 'Close',
    dismiss: 'Dismiss',
    backspace: 'Delete last digit',
    selectActiveGroup: 'Select active group',
    switchLanguage: 'Switch language (Somali / English)',
    pinUpdated: 'PIN updated successfully',
    assignedTechnicians: 'Assigned technicians ({count})',
    noTechniciansYet: 'No technicians assigned yet',
    deptScaling: 'Department scaling',
    deactivate: 'Deactivate',
    activateGroup: 'Activate group {code}',
    primaryTeam: 'Primary team',
    groupCode: 'Group code',
    groupName: 'Group name',
    groupDescription: 'Description',
    memberNamePlaceholder: 'e.g. Cabdiraxmaan Maxamed',
    crewZonePlaceholder: 'e.g. Jigjigayar, Gantalaha, Bada Cas',
    groupCodePlaceholder: 'e.g. F4',
    groupNamePlaceholder: 'Group F4 — Fixed Broadband',
    groupDescriptionPlaceholder: 'Zone or team notes',

    // Team & Crews Management
    teamHeader: 'Group Team, 2-Tech Crews & Department Scaling',
    teamSubheader: 'Manage technicians, PIN access, field vehicles/crews, and multi-group expansion (F1, F2, F3, F5, GA).',
    tabMembers: 'Team Members',
    tabCrews: '2-Tech Crews / Vehicles',
    tabGroups: 'FBB Groups (F1–GA)',
    addMember: 'Add Team Member',
    editMember: 'Edit Member',
    fullName: 'Full Name',
    username: 'Username (Login ID)',
    phone: 'Telesom Mobile (63xxxxxxx)',
    role: 'Role',
    pinResetLabel: 'New PIN (4–6 digits, leave blank to keep current)',
    pinNewLabel: 'Login PIN (4–6 digits)',
    pinMustChange: 'PIN not changed yet',
    statusActive: 'Active',
    statusInactive: 'Inactive',
    addCrew: 'Create 2-Tech Crew',
    editCrew: 'Edit Crew',
    crewName: 'Crew Name',
    vehicleTag: 'Vehicle / Tag',
    zoneFocus: 'Default Xaafada / Zone Focus',
    selectCrewMembers: 'Assign Technicians to Crew',
    noCrewAssigned: 'Individual (No Crew)',
    assignedCrew: 'Assigned crew',
    crewPartner: 'Crew partner',
    noCrewPartner: 'Working solo today.',
    myAccount: 'My account',
    phoneLabel: 'Phone',
    identifierLabelShort: 'Username',
    changePinHint: 'Use “Change PIN” in the header to update your PIN (4–6 digits).',
    call: 'Call',
    addGroup: 'Add New FBB Group',

    // Dispatch & Route Clustering (Phase 3)
    dispatchTitle: 'Dispatch & Route Clustering',
    dispatchSubtitle: 'Group the unassigned jobs by cablebox and neighbourhood, hand them to a technician or crew, then send the plan to the group chat.',
    dispatchPool: 'Unassigned jobs',
    dispatchPoolEmpty: 'Nothing waiting — every job has an owner.',
    dispatchLanes: 'Technicians & crews',
    dispatchLaneEmpty: 'No jobs yet',
    dispatchSearch: 'Search name, line, phone, box…',
    dispatchFilterAll: 'All',
    dispatchFilterUrgent: 'Urgent',
    dispatchSelectAll: 'Select all',
    dispatchClear: 'Clear',
    dispatchSelected: 'selected',
    dispatchAssignTo: 'Assign to…',
    dispatchAutoCluster: 'Auto-cluster',
    dispatchAutoHint: 'Urgent jobs first, then each cablebox and neighbourhood together.',
    dispatchPlanTitle: 'Suggested routes',
    dispatchPlanEmpty: 'No unassigned jobs to cluster.',
    dispatchApplyPlan: 'Apply plan',
    dispatchApplyPartial: 'Apply selected routes',
    dispatchPlanReasonZone: 'the crew covers this area',
    dispatchPlanReasonBox: 'they already worked this box',
    dispatchPlanReasonBalance: 'it balances the load',
    dispatchUnassign: 'Return to pool',
    dispatchMessage: 'Group-chat message',
    dispatchMessageHint: 'Send one master plan, or one message per team.',
    dispatchCopy: 'Copy',
    dispatchCopied: 'Copied',
    dispatchCopyAll: 'Copy full plan',
    dispatchShare: 'Share',
    dispatchWhatsApp: 'WhatsApp',
    dispatchTelegram: 'Telegram',
    dispatchIncludePhone: 'Include phone numbers',
    dispatchEditTemplate: 'Edit template',
    dispatchResetTemplate: 'Reset',
    dispatchTemplateHelp: 'Placeholders: {group} {date} {count} {crews} {crewsLabel} {blocks}',
    dispatchOpenJobs: 'open',
    dispatchUrgentJobs: 'urgent',
    dispatchDoneToday: 'done today',
    dispatchAssignSkipped: 'skipped (already started or finished)',
    dispatchNoTargets: 'Add a technician or a crew first — see Team & Crews.',
    dispatchEmptyMessage: 'Assign some jobs first — then the message writes itself.',
    dispatchUnassignedShort: 'unassigned',
    dispatchInProgressShort: 'in progress',
    // Roadmap Banner
    groupFieldReady: 'Field ready ·',
  },
  so: {
    appName: 'Nidaamka FTTH Telesom',
    // Erayada la wadaago
    close: 'Xir',
    dismiss: 'Xir',
    backspace: 'Tirtir lambarka ugu dambeeya',
    selectActiveGroup: 'Dooro kooxda firfircoon',
    switchLanguage: 'Beddel luuqadda (Soomaali / Ingiriis)',
    pinUpdated: 'PIN-ka si guul leh ayaa loo beddelay',
    assignedTechnicians: 'Farsamayaqaannada la qoondeeyay ({count})',
    noTechniciansYet: 'Weli farsamayaqaan lama qoondeyn',
    deptScaling: 'Ballaarinta waaxda',
    deactivate: 'Dami',
    activateGroup: 'Daar kooxda {code}',
    primaryTeam: 'Kooxda koowaad',
    groupCode: 'Lambarka kooxda',
    groupName: 'Magaca kooxda',
    groupDescription: 'Sharaxaad',
    memberNamePlaceholder: 'tusaale: Cabdiraxmaan Maxamed',
    crewZonePlaceholder: 'tusaale: Jigjigayar, Gantalaha, Bada Cas',
    groupCodePlaceholder: 'tusaale: F4',
    groupNamePlaceholder: 'Kooxda F4 — Fixed Broadband',
    groupDescriptionPlaceholder: 'Aag ama qoraal kooxeed',
    deptSubtitle: 'Waaxda Fixed Broadband — Hawlgalka Kooxda',
    deptFooter: 'Waaxda Internet-ka ee Telesom • Nidaamka Goobta Kooxda F1',
    loginTitle: 'Soo Gal Nidaamka Shaqada',
    loginGroupBadge: 'FTTH · Kooxda F1',
    loginNeedPin: 'PIN ma haysataa? Weydii kormeerahaaga inuu kuu sameeyo.',
    loginSecureLine: 'PIN-kaagu waa mid shaqsi ah — ha la wadaagin.',
    loginSubtitle: 'Geli magacaaga isticmaalaha ama lambarka Telesom iyo PIN-kaaga sirta ah',
    identifierLabel: 'Magaca isticmaalaha ama Lambarka Tel (tusaale: supervisor ama 634...)',
    identifierPlaceholder: 'Magacaaga isticmaalaha ama lambarka Telesom',
    pinLabel: 'PIN-ka Sirta ah',
    pinHint: '4–6 lambar',
    signInBtn: 'Soo Gal',
    signingIn: 'Waa la hubinayaa...',
    supervisorRole: 'Kormeere (Supervisor)',
    technicianRole: 'Farsamayaqaan (Tech)',
    logout: 'Ka Bax',
    changePin: 'Beddel PIN-ka',
    currentPin: 'PIN-ka Hadda',
    newPin: 'PIN Cusub (4–6 lambar)',
    saveChanges: 'Kaydi Isbeddelka',
    cancel: 'Jooji',

    // Navigation
    navOverview: 'Guudmar & Xaaladda',
    navIngest: 'Soo Geli Warqadda (Pic/Excel)',
    navDispatch: 'Qaybinta & Xaafadaha',
    navInsights: 'Falanqayn',
    navActivity: 'Diiwaan',
    navCablebox: 'Taariikhda Cablebox',
    navTeam: 'Shaqaalaha & Gaadiidka',

    // Tech Mobile Nav
    techMyRoute: 'Shaqadayda Maanta',
    techBoxes: 'Cablebox-yada',
    techProfile: 'Kooxdayda & PIN',

    // Overview KPIs
    activeTechs: 'Farsamayaqaannada F1',
    fieldCrews: 'Kooxaha Gaadiidka (Crews)',
    trackedBoxes: 'Cablebox-yada Diwaangashan',
    openTasks: 'Shaqooyinka Furan (F1)',

    // Team & Crews Management
    teamHeader: 'Maamulka Shaqaalaha, Lammaanaha Gaadiidka & Kooxaha FBB',
    teamSubheader: 'Maamul farsamayaqaannada, PIN-kooda, kooxaha wada socda (Crews), iyo ballaarinta kooxaha F1, F2, F3, F5, GA.',
    tabMembers: 'Xubnaha Kooxda',
    tabCrews: 'Kooxaha Lammaanaha (Crews)',
    tabGroups: 'Kooxaha Waaxda (F1–GA)',
    addMember: 'Ku Dar Shaqaale Cusub',
    editMember: 'Wax Ka Beddel Xubinta',
    fullName: 'Magaca Oo Saddexan',
    username: 'Username (Magaca Soo-galka)',
    phone: 'Lambarka Telesom (63xxxxxxx)',
    role: 'Doorka Shaqada',
    pinResetLabel: 'PIN Cusub (4–6 lambar, banaan u daa haddii aan la beddelin)',
    pinNewLabel: 'PIN-ka Soo-galka (4–6 lambar)',
    pinMustChange: 'PIN aan la beddelin',
    statusActive: 'Shaqaynaya',
    statusInactive: 'Hakad ku jira',
    addCrew: 'Samee Koox Lammaane (Crew)',
    editCrew: 'Wax Ka Beddel Crew-ga',
    crewName: 'Magaca Crew-ga',
    vehicleTag: 'Gaadhiga / Sumadda',
    zoneFocus: 'Xaafadaha U Gaarka ah',
    selectCrewMembers: 'U Dooro Farsamayaqaannada Crew-gan',
    noCrewAssigned: 'Keli (Crew ma laha)',
    assignedCrew: 'Crew-ga la qoondeeyay',
    crewPartner: 'Jaalka crew-ga',
    noCrewPartner: 'Maanta keligaa baad shaqeynaysaa.',
    myAccount: 'Akoonkayga',
    phoneLabel: 'Telefoon',
    identifierLabelShort: 'Magaca isticmaalaha',
    changePinHint: 'Isticmaal “Beddel PIN” ee madaxa si aad u beddesho PIN-kaaga (4–6 lambar).',
    call: 'Wac',
    addGroup: 'Ku Dar Group Cusub',

    // Dispatch & Route Clustering (Phase 3)
    dispatchTitle: 'Qaybinta & Isku-xidhka Xaafadaha',
    dispatchSubtitle: 'Shaqooyinka aan la qaybin ku ururi Cablebox iyo Xaafad, u dhiib farsamayaqe ama koox, kadibna fariinta u dir kooxda.',
    dispatchPool: 'Shaqooyinka aan la qaybin',
    dispatchPoolEmpty: 'Wax sugaya ma jiraan — shaqo kastaa milkiile ayay leedahay.',
    dispatchLanes: 'Farsamayaqaannada & Kooxaha',
    dispatchLaneEmpty: 'Weli shaqo ma qabin',
    dispatchSearch: 'Raadi magac, line, telefoon, box…',
    dispatchFilterAll: 'Dhammaan',
    dispatchFilterUrgent: 'Degdeg',
    dispatchSelectAll: 'Dooro dhammaan',
    dispatchClear: 'Nadiifi',
    dispatchSelected: 'la doortay',
    dispatchAssignTo: 'U dhiib…',
    dispatchAutoCluster: 'Isku-xidh si otomaatig ah',
    dispatchAutoHint: 'Degdegga horay, kadib Cablebox iyo xaafad kasta wada jir.',
    dispatchPlanTitle: 'Jidadka la soo jeediyay',
    dispatchPlanEmpty: 'Ma jiraan shaqooyin aan la qaybin oo la isku-xidhi karo.',
    dispatchApplyPlan: 'Dhaqan galiso qorshaha',
    dispatchApplyPartial: 'Dhaqan galiso jidadka la doortay',
    dispatchPlanReasonZone: 'kooxdu xaafadan bay qabataa',
    dispatchPlanReasonBox: 'horaa bay uga shaqaynaysay box-kan',
    dispatchPlanReasonBalance: 'culayska ayay dheellitirtaa',
    dispatchUnassign: 'Ku celi liiska',
    dispatchMessage: 'Fariinta kooxda (WhatsApp)',
    dispatchMessageHint: 'Hal fariin oo qorshaha oo dhan, ama fariin gooni ah koox kasta.',
    dispatchCopy: 'Koobi',
    dispatchCopied: 'La koobiyay',
    dispatchCopyAll: 'Koobi qorshaha oo dhan',
    dispatchShare: 'La wadaag',
    dispatchWhatsApp: 'WhatsApp',
    dispatchTelegram: 'Telegram',
    dispatchIncludePhone: 'Ku dar lambarada telefoonka',
    dispatchEditTemplate: 'Wax ka beddel qaabka',
    dispatchResetTemplate: 'Soo celi',
    dispatchTemplateHelp: 'Calammo: {group} {date} {count} {crews} {crewsLabel} {blocks}',
    dispatchOpenJobs: 'furan',
    dispatchUrgentJobs: 'degdeg',
    dispatchDoneToday: 'maanta dhammaaday',
    dispatchAssignSkipped: 'la booday (horaa loo bilaabay ama waa dhammaaday)',
    dispatchNoTargets: 'Marka hore ku dar farsamayaqe ama koox — eeg Shaqaalaha & Gaadiidka.',
    dispatchEmptyMessage: 'Marka hore shaqooyin qaybi — fariintu iskeed ayay u qormaysaa.',
    dispatchUnassignedShort: 'aan la qaybin',
    dispatchInProgressShort: 'socda',

    // Roadmap Banner
    groupFieldReady: 'Goobta diyaar ·',
  },
} as const;

export type TranslationKey = keyof typeof translations.en;

interface LanguageContextValue {
  lang: Language;
  setLang: (l: Language) => void;
  /**
   * `t('activateGroup', { code: 'F4' })`
   *
   * Interpolation exists so a sentence can move as one unit: splitting "Activate
   * group" and the code across a template literal is exactly how translations
   * end up with the wrong word order.
   */
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  );
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

const LANG_STORAGE_KEY = 'telesom_f1_lang';

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Language>(() => {
    const saved = localStorage.getItem(LANG_STORAGE_KEY);
    return saved === 'en' || saved === 'so' ? saved : 'so';
  });

  const setLang = (next: Language) => {
    setLangState(next);
    localStorage.setItem(LANG_STORAGE_KEY, next);
  };

  // Screen readers and browser translation follow the real document language.
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const t = (key: TranslationKey, vars?: Record<string, string | number>): string => {
    const template = translations[lang][key] ?? translations.en[key] ?? key;
    return interpolate(template, vars);
  };

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used inside LanguageProvider');
  return ctx;
}

/**
 * For shared primitives (Sheet, Toast) that must also work when rendered alone
 * in a test, outside the provider. Screens keep using `useLanguage`, which
 * throws — a screen without a language is a bug, a modal without one is a test.
 */
export function useLanguageSafe(): LanguageContextValue | null {
  return useContext(LanguageContext);
}
