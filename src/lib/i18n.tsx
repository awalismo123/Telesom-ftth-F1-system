import React, { createContext, useContext, useState } from 'react';
import type { Language } from '../types/database';

const translations = {
  en: {
    appName: 'Telesom FTTH Operations',
    deptSubtitle: 'Fixed Broadband Department — Field System',
    loginTitle: 'Sign In to Field Portal',
    loginSubtitle: 'Enter your username or Telesom phone number and 4-digit PIN',
    identifierLabel: 'Username or Phone (e.g. supervisor or 634...)',
    identifierPlaceholder: 'supervisor or 634100101',
    pinLabel: '4-Digit Security PIN',
    signInBtn: 'Sign In',
    signingIn: 'Verifying...',
    demoAccountsTitle: 'Quick Test Accounts (Click to Fill)',
    supervisorRole: 'Supervisor',
    technicianRole: 'Technician',
    logout: 'Sign Out',
    changePin: 'Change PIN',
    currentPin: 'Current PIN',
    newPin: 'New 4-Digit PIN',
    saveChanges: 'Save Changes',
    cancel: 'Cancel',

    // Navigation
    navOverview: 'Command Overview',
    navIngest: 'Daily Sheet Upload',
    navDispatch: 'Dispatch & Clustering',
    navCablebox: 'Cablebox History',
    navTeam: 'Team & Crews',

    // Tech Mobile Nav
    techMyRoute: 'My Route',
    techBoxes: 'Cableboxes',
    techProfile: 'My Crew & PIN',

    // Overview KPIs
    activeGroup: 'Active Group',
    activeTechs: 'Active Technicians',
    fieldCrews: '2-Tech Crews',
    trackedBoxes: 'Tracked Cableboxes',
    openTasks: 'Open F1 Tasks',
    pendingInstallations: 'Pending Installations (Galinta)',
    activeFaults: 'Active Faults (Cilada)',

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
    pinResetLabel: 'New 4-Digit PIN (leave blank to keep current)',
    pinNewLabel: '4-Digit Login PIN',
    statusActive: 'Active',
    statusInactive: 'Inactive',
    addCrew: 'Create 2-Tech Crew',
    editCrew: 'Edit Crew',
    crewName: 'Crew Name',
    vehicleTag: 'Vehicle / Tag',
    zoneFocus: 'Default Xaafada / Zone Focus',
    selectCrewMembers: 'Assign Technicians to Crew',
    noCrewAssigned: 'Individual (No Crew)',
    addGroup: 'Add New FBB Group',

    // Roadmap Banner
    roadmapTitle: 'Step-by-Step Build Progress',
    phase1Done: 'Phase 1 Live: Supabase Cloud + PIN Auth + Bilingual UI + Team & 2-Tech Crews',
    phase2Done: 'Phase 2 Live: Group-chat picture OCR (Galinta & Cilada), Excel/CSV/paste, Group F1 filter, carry-over & repeat-fault decisions, undo',
    phase2Next: 'Phase 3 Next: Xaafada & Cablebox clustering, individual/crew assignment, 1-click WhatsApp summary',
    phase3Pending: 'Phase 3: Xaafada & Cablebox Clustering + 1-Click WhatsApp Summary',
    phase4Pending: 'Phase 4: Mobile Execution, Live Timer, Blockers & Optical dBm',
    phase5Pending: 'Phase 5: Full Cablebox Port History & Efficiency Analytics',
  },
  so: {
    appName: 'Nidaamka FTTH Telesom',
    deptSubtitle: 'Waaxda Fixed Broadband — Hawlgalka Kooxda',
    loginTitle: 'Soo Gal Nidaamka Shaqada',
    loginSubtitle: 'Geli magacaaga isticmaalaha ama lambarka Telesom iyo PIN-ka 4-ta lambar',
    identifierLabel: 'Username ama Lambarka Tel (tusaale: supervisor ama 634...)',
    identifierPlaceholder: 'supervisor ama 634100101',
    pinLabel: 'PIN-ka Sirta ah (4 Lambar)',
    signInBtn: 'Soo Gal',
    signingIn: 'Waa la hubinayaa...',
    demoAccountsTitle: 'Akoonnada Tijaabada Degdegga ah (Guji si aad u buuxiso)',
    supervisorRole: 'Kormeere (Supervisor)',
    technicianRole: 'Farsamayaqaan (Tech)',
    logout: 'Ka Bax',
    changePin: 'Beddel PIN-ka',
    currentPin: 'PIN-ka Hadda',
    newPin: 'PIN Cusub (4 Lambar)',
    saveChanges: 'Kaydi Isbeddelka',
    cancel: 'Jooji',

    // Navigation
    navOverview: 'Guudmar & Xaaladda',
    navIngest: 'Soo Geli Warqadda (Pic/Excel)',
    navDispatch: 'Qaybinta & Xaafadaha',
    navCablebox: 'Taariikhda Cablebox',
    navTeam: 'Shaqaalaha & Gaadiidka',

    // Tech Mobile Nav
    techMyRoute: 'Shaqadayda Maanta',
    techBoxes: 'Cablebox-yada',
    techProfile: 'Kooxdayda & PIN',

    // Overview KPIs
    activeGroup: 'Kooxda Shaqaynaysa',
    activeTechs: 'Farsamayaqaannada F1',
    fieldCrews: 'Kooxaha Gaadiidka (Crews)',
    trackedBoxes: 'Cablebox-yada Diwaangashan',
    openTasks: 'Shaqooyinka Furan (F1)',
    pendingInstallations: 'Galinta Cusub (Pending Install)',
    activeFaults: 'Ciladaha Taagan (Cilada)',

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
    pinResetLabel: 'PIN Cusub oo 4-lambar ah (banaan u daa haddii aan la beddelayn)',
    pinNewLabel: 'PIN-ka Soo-galka (4 Lambar)',
    statusActive: 'Shaqaynaya',
    statusInactive: 'Hakad ku jira',
    addCrew: 'Samee Koox Lammaane (Crew)',
    editCrew: 'Wax Ka Beddel Crew-ga',
    crewName: 'Magaca Crew-ga',
    vehicleTag: 'Gaadhiga / Sumadda',
    zoneFocus: 'Xaafadaha U Gaarka ah',
    selectCrewMembers: 'U Dooro Farsamayaqaannada Crew-gan',
    noCrewAssigned: 'Keli (Crew ma laha)',
    addGroup: 'Ku Dar Group Cusub',

    // Roadmap Banner
    roadmapTitle: 'Heerarka Dhismaha Nidaamka (Mid-Mid)',
    phase1Done: 'Qaybta 1aad (Shaqaynaysa): Supabase Cloud + PIN Auth + Af-Soomaali/English + Maamulka Shaqaalaha & Crews',
    phase2Done: 'Qaybta 2aad (Shaqaynaysa): Sawirka Kooxda (OCR) — Galinta & Cilada, Excel/CSV, shaandhaynta F1, go\'aamadaha Baaqi & Cilad-soo-noqod, Undo',
    phase2Next: 'Qaybta 3aad (Xigta): Isku-xidhka Xaafadaha & Cablebox, qaybinta shaqaalaha, fariinta WhatsApp-ka',
    phase3Pending: 'Qaybta 3aad: Isku-xidhka Xaafadaha & Cablebox + Fariinta WhatsApp-ka Kooxda',
    phase4Pending: 'Qaybta 4aad: Mobile-ka Farsamayaqaanka, Saacadda (Timer), Caqabadaha & Cabirka dBm',
    phase5Pending: 'Qaybta 5aad: Taariikhda Port-yada Cablebox & Warbixinta Waxqabadka',
  },
} as const;

export type TranslationKey = keyof typeof translations.en;

interface LanguageContextValue {
  lang: Language;
  setLang: (l: Language) => void;
  t: (key: TranslationKey) => string;
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

  const t = (key: TranslationKey): string => {
    return translations[lang][key] ?? translations.en[key] ?? key;
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
