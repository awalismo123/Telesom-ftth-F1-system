import React from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  Copy,
  History,
  RotateCcw,
  Sparkles,
  XCircle,
} from 'lucide-react';
import type { ConflictKind, ImportPlan, PlanRow, RowDecision } from '../../../lib/importer';
import { useLanguage } from '../../../lib/i18n';

interface Props {
  plan: ImportPlan;
  onChange: (plan: ImportPlan) => void;
}

const CONFLICT_STYLES: Record<ConflictKind, { bg: string; text: string; border: string }> = {
  new: { bg: 'bg-emerald-50', text: 'text-emerald-800', border: 'border-emerald-200' },
  carryover: { bg: 'bg-sky-50', text: 'text-sky-800', border: 'border-sky-200' },
  repeat: { bg: 'bg-amber-50', text: 'text-amber-800', border: 'border-amber-200' },
  duplicate_today: { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-200' },
  invalid: { bg: 'bg-rose-50', text: 'text-rose-800', border: 'border-rose-200' },
};

function conflictIcon(kind: ConflictKind) {
  switch (kind) {
    case 'new':
      return <Sparkles className="w-3.5 h-3.5" />;
    case 'carryover':
      return <History className="w-3.5 h-3.5" />;
    case 'repeat':
      return <RotateCcw className="w-3.5 h-3.5" />;
    case 'duplicate_today':
      return <Copy className="w-3.5 h-3.5" />;
    default:
      return <AlertTriangle className="w-3.5 h-3.5" />;
  }
}

export function ConflictPanel({ plan, onChange }: Props) {
  const { lang } = useLanguage();
  const so = lang === 'so';

  const label: Record<ConflictKind, string> = {
    new: so ? 'Cusub' : 'New',
    carryover: so ? 'Baaqi (weliba furan)' : 'Carry-over (still open)',
    repeat: so ? 'Cilad soo noqotay' : 'Repeat fault',
    duplicate_today: so ? 'Hore loo soo geliyay maanta' : 'Already imported today',
    invalid: so ? 'Aan la aqoonsan' : 'Unreadable',
  };

  const decisionsFor = (row: PlanRow): { value: RowDecision; label: string; hint: string }[] => {
    switch (row.conflict) {
      case 'carryover':
        return [
          {
            value: 'refresh',
            label: so ? 'Furan + cusboonaysii' : 'Keep open + refresh details',
            hint: so
              ? 'Shaqada hore way sii socotaa, xogta cusub baa lagu darayaa'
              : 'Keeps the existing task and its assignment, updates phone/area/box',
          },
          {
            value: 'skip',
            label: so ? 'Iska dhaaf' : 'Skip this row',
            hint: so ? 'Ma beddelayso wax' : 'Leaves the existing task untouched',
          },
          {
            value: 'create',
            label: so ? 'Samee shaqo cusub' : 'Create a separate task',
            hint: so ? 'Laba shaqo ayaa noqon doona' : 'Produces a second task for the same line',
          },
        ];
      case 'repeat':
        return [
          {
            value: 'create',
            label: so ? 'Cilad cusub (la xidhiidha tii hore)' : 'New fault, linked to the old one',
            hint: so ? 'Taariikhda hore way sii hayaan' : 'Keeps the old repair as history',
          },
          {
            value: 'reopen',
            label: so ? 'Fur sha qadii hore' : 'Reopen the previous task',
            hint: so ? 'Iskli waqtigii hore la tirtirayaa' : 'Clears the old completion and reuses it',
          },
          {
            value: 'skip',
            label: so ? 'Iska dhaaf' : 'Skip this row',
            hint: '',
          },
        ];
      case 'duplicate_today':
        return [
          { value: 'skip', label: so ? 'Iska dhaaf (duuban)' : 'Skip (duplicate)', hint: '' },
          {
            value: 'refresh',
            label: so ? 'Cusboonaysii' : 'Refresh existing',
            hint: so ? 'Beddel xogta la hayo' : 'Overwrite details of today’s task',
          },
        ];
      case 'invalid':
        return [{ value: 'skip', label: so ? 'Iska dhaaf' : 'Skip', hint: '' }];
      default:
        return [
          { value: 'create', label: so ? 'Soo geli' : 'Import', hint: '' },
          { value: 'skip', label: so ? 'Iska dhaaf' : 'Skip', hint: '' },
        ];
    }
  };

  const setDecision = (rowId: string, decision: RowDecision) => {
    onChange({
      ...plan,
      rows: plan.rows.map((r) => (r.id === rowId ? { ...r, decision, included: decision !== 'skip' } : r)),
    });
  };

  const bulkSet = (kind: ConflictKind, decision: RowDecision) => {
    onChange({
      ...plan,
      rows: plan.rows.map((r) =>
        r.conflict === kind ? { ...r, decision, included: true } : r,
      ),
    });
  };

  const actionable = plan.rows.filter((r) => r.conflict !== 'invalid');

  const groups: { kind: ConflictKind; rows: PlanRow[] }[] = (
    ['carryover', 'repeat', 'duplicate_today', 'new'] as ConflictKind[]
  )
    .map((kind) => ({ kind, rows: actionable.filter((r) => r.conflict === kind) }))
    .filter((g) => g.rows.length > 0);

  const totals = {
    create: plan.rows.filter((r) => r.decision === 'create' && r.conflict !== 'invalid').length,
    refresh: plan.rows.filter((r) => r.decision === 'refresh').length,
    reopen: plan.rows.filter((r) => r.decision === 'reopen').length,
    skip: plan.rows.filter((r) => r.decision === 'skip' || r.conflict === 'invalid').length,
  };

  return (
    <div className="space-y-4">
      {/* Decision totals */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3.5">
          <div className="text-[11px] font-bold uppercase tracking-wide text-emerald-700">
            {so ? 'Cusub' : 'Create'}
          </div>
          <div className="text-xl font-extrabold text-emerald-900">{totals.create}</div>
        </div>
        <div className="rounded-2xl border border-sky-200 bg-sky-50 p-3.5">
          <div className="text-[11px] font-bold uppercase tracking-wide text-sky-700">
            {so ? 'Cusboonaysiin' : 'Refresh'}
          </div>
          <div className="text-xl font-extrabold text-sky-900">{totals.refresh}</div>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3.5">
          <div className="text-[11px] font-bold uppercase tracking-wide text-amber-700">
            {so ? 'Dib u furid' : 'Reopen'}
          </div>
          <div className="text-xl font-extrabold text-amber-900">{totals.reopen}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-3.5">
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
            {so ? 'La dhaafi doono' : 'Skipped'}
          </div>
          <div className="text-xl font-extrabold text-slate-700">{totals.skip}</div>
        </div>
      </div>

      {groups.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          {so
            ? 'Ma jiraan shaqooyin hore u jiray — dhammaan waa cusub.'
            : 'No existing tasks matched these lines — every row is new.'}
        </div>
      )}

      {groups.map((group) => (
        <div key={group.kind} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-slate-50 border-b border-slate-200">
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold border ${CONFLICT_STYLES[group.kind].bg} ${CONFLICT_STYLES[group.kind].text} ${CONFLICT_STYLES[group.kind].border}`}
              >
                {conflictIcon(group.kind)}
                {label[group.kind]}
              </span>
              <span className="text-xs font-bold text-slate-700">{group.rows.length}</span>
            </div>

            <div className="flex items-center gap-1.5">
              {group.kind === 'carryover' && (
                <>
                  <button
                    type="button"
                    onClick={() => bulkSet('carryover', 'refresh')}
                    className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-sky-600 text-white hover:bg-sky-700 cursor-pointer"
                  >
                    {so ? 'Dhammaan cusboonaysii' : 'Refresh all'}
                  </button>
                  <button
                    type="button"
                    onClick={() => bulkSet('carryover', 'skip')}
                    className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer"
                  >
                    {so ? 'Dhammaan dhaaf' : 'Skip all'}
                  </button>
                </>
              )}
              {group.kind === 'repeat' && (
                <>
                  <button
                    type="button"
                    onClick={() => bulkSet('repeat', 'create')}
                    className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-amber-600 text-white hover:bg-amber-700 cursor-pointer"
                  >
                    {so ? 'Dhammaan cusub' : 'New for all'}
                  </button>
                  <button
                    type="button"
                    onClick={() => bulkSet('repeat', 'reopen')}
                    className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer"
                  >
                    {so ? 'Dhammaan dib u fur' : 'Reopen all'}
                  </button>
                </>
              )}
              {group.kind === 'duplicate_today' && (
                <button
                  type="button"
                  onClick={() => bulkSet('duplicate_today', 'skip')}
                  className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  {so ? 'Dhammaan dhaaf' : 'Skip all'}
                </button>
              )}
            </div>
          </div>

          <div className="divide-y divide-slate-100">
            {group.rows.map((row) => (
              <div key={row.id} className="p-4 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm text-slate-900">
                        {row.row.derived.customerName || '—'}
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[11px] font-mono">
                        {row.row.derived.lineNumber}
                      </span>
                      {row.row.derived.xaafada && (
                        <span className="text-[11px] text-slate-500">{row.row.derived.xaafada}</span>
                      )}
                      {row.row.derived.urgent && (
                        <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 text-[10px] font-bold">
                          DEGDEG
                        </span>
                      )}
                    </div>

                    {row.existing && (
                      <div className="text-[11px] text-slate-500 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="inline-flex items-center gap-1">
                          <ArrowRightLeft className="w-3 h-3" />
                          {so ? 'Shaqada hore' : 'Existing'}: {row.existing.status}
                        </span>
                        {row.existing.assigned_user_id && (
                          <span className="text-sky-700 font-semibold">
                            {so ? 'lootan yahay' : 'already assigned'}
                          </span>
                        )}
                        {row.existing.completed_at && (
                          <span>
                            {so ? 'la dhammeeyay' : 'completed'}{' '}
                            {new Date(row.existing.completed_at).toLocaleDateString()}
                          </span>
                        )}
                        <span className="font-mono">
                          {so ? 'sannadka' : 'created'}{' '}
                          {new Date(row.existing.created_at).toLocaleDateString()}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="shrink-0">
                    {row.decision === 'skip' || row.conflict === 'invalid' ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-400">
                        <XCircle className="w-3.5 h-3.5" />
                        {so ? 'La dhaafayaa' : 'Skipped'}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {row.decision === 'create'
                          ? so
                            ? 'Waa la soo gelinayaa'
                            : 'Will be imported'
                          : row.decision === 'refresh'
                            ? so
                              ? 'Waa la cusboonaysiinayaa'
                              : 'Will be refreshed'
                            : so
                              ? 'Waa la furayaa'
                              : 'Will be reopened'}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {decisionsFor(row).map((option) => {
                    const active = row.decision === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setDecision(row.id, option.value)}
                        title={option.hint}
                        className={`px-3 py-2 rounded-xl text-[11px] font-bold border transition text-left cursor-pointer ${
                          active
                            ? 'bg-emerald-950 text-white border-emerald-950 shadow-xs'
                            : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/40'
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
