import React, { useState } from 'react';
import { Building2, FileText, History, ShieldCheck } from 'lucide-react';
import { useLanguage } from '../../lib/i18n';
import { Tabs, type TabItem } from '../ui/Tabs';
import { LazyPanel } from '../ui/LazyPanel';
import { Portfolio } from './Portfolio';

/**
 * The manager's app: two tabs and a report.
 *
 * It is a separate shell, not the supervisor's with buttons hidden, because a
 * hidden button is a promise made by CSS. Nothing in this file imports an
 * assign, cancel, complete or import call, and the database refuses a manager's
 * writes even if one were reached by hand (migration 014, `block_manager_writes`).
 *
 * Lazy, like every other panel: a manager who signs in to read the portfolio
 * does not download the record feed or the print sheet.
 */
const ActivityLog = React.lazy(() =>
  import('../supervisor/ActivityLog').then((m) => ({ default: m.ActivityLog })),
);
const PeriodReportSheet = React.lazy(() =>
  import('../supervisor/PeriodReportSheet').then((m) => ({ default: m.PeriodReportSheet })),
);

type ManagerTab = 'portfolio' | 'record';

export function ManagerShell() {
  const { lang } = useLanguage();
  const so = lang === 'so';

  const [activeTab, setActiveTab] = useState<ManagerTab>('portfolio');
  const [reportOpen, setReportOpen] = useState(false);

  const tabs: TabItem<ManagerTab>[] = [
    {
      id: 'portfolio',
      label: so ? 'Kooxaha' : 'Groups',
      icon: <Building2 className="w-4 h-4" aria-hidden="true" />,
    },
    {
      id: 'record',
      label: so ? 'Diiwaanka' : 'Record',
      icon: <History className="w-4 h-4" aria-hidden="true" />,
    },
  ];

  return (
    <div className="max-w-4xl mx-auto px-3 pb-24 pt-3">
      {/* read-only, said out loud rather than implied */}
      <div className="mb-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-extrabold text-slate-900">
            {so ? 'Aragtida maamulaha — akhris kaliya' : 'Manager view — read only'}
          </div>
          <div className="text-[10px] text-slate-500">
            {so
              ? 'Waad arki kartaa dhammaan kooxaha; ma beddeli kartid shaqo, qoondeyn ama tirtirid.'
              : 'You can see every group; you cannot assign, complete or cancel anything.'}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setReportOpen(true)}
          className="shrink-0 inline-flex items-center gap-1.5 h-9 px-2.5 rounded-xl bg-slate-900 text-white text-[11px] font-extrabold cursor-pointer"
        >
          <FileText className="w-3.5 h-3.5" aria-hidden="true" />
          {so ? 'Warbixin' : 'Report'}
        </button>
      </div>

      <Tabs
        items={tabs}
        value={activeTab}
        onChange={setActiveTab}
        label={so ? 'Qaybaha maamulaha' : 'Manager sections'}
      />

      <div className="mt-3">
        {activeTab === 'portfolio' && (
          <LazyPanel label={so ? 'Kooxaha' : 'Groups'}>
            <Portfolio />
          </LazyPanel>
        )}

        {activeTab === 'record' && (
          <LazyPanel label={so ? 'Diiwaanka' : 'Record'}>
            <ActivityLog scope="manager" />
          </LazyPanel>
        )}
      </div>

      {reportOpen && (
        <LazyPanel label={so ? 'Warbixin' : 'Report'}>
          <PeriodReportSheet
            scope="manager"
            open={reportOpen}
            onClose={() => setReportOpen(false)}
          />
        </LazyPanel>
      )}
    </div>
  );
}
