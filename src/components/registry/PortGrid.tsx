import React, { useEffect, useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { PORT_STATUS_META, type BoxPort, type Lang, type PortStatus } from '../../lib/registry';

interface Props {
  ports: BoxPort[];
  totalPorts: number;
  lang: Lang;
  canEdit: boolean;
  onSave: (port: number, status: PortStatus, notes?: string) => Promise<void>;
}

const EDITABLE: PortStatus[] = ['free', 'occupied', 'damaged', 'reserved', 'unknown'];

/**
 * The port map of one box. Tapping a port opens a tiny editor underneath —
 * this is the thing a technician does standing at the box with one hand.
 */
export function PortGrid({ ports, totalPorts, lang, canEdit, onSave }: Props) {
  const so = lang === 'so';
  const [selected, setSelected] = useState<number | null>(null);
  const [status, setStatus] = useState<PortStatus>('damaged');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const byNumber = new Map(ports.map((port) => [port.port_number, port]));
  const active = selected !== null ? byNumber.get(selected) : undefined;

  useEffect(() => {
    if (selected === null) return;
    const port = byNumber.get(selected);
    setStatus(port?.status ?? 'unknown');
    setNotes(port?.notes ?? '');
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const handleSave = async () => {
    if (selected === null) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(selected, status, notes.trim() || undefined);
      setSelected(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the port');
    } finally {
      setSaving(false);
    }
  };

  const nums = Array.from({ length: totalPorts }, (_, i) => i + 1);

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-4 gap-1.5">
        {nums.map((n) => {
          const port = byNumber.get(n);
          const meta = PORT_STATUS_META[port?.status ?? 'unknown'];
          const isActive = selected === n;
          return (
            <button
              key={n}
              type="button"
              disabled={!canEdit}
              onClick={() => setSelected(isActive ? null : n)}
              className={`relative text-left rounded-xl border px-2 py-1.5 transition ${meta.tile} ${
                isActive ? 'ring-2 ring-slate-900/60' : ''
              } ${canEdit ? 'cursor-pointer active:scale-95' : 'cursor-default'}`}
            >
              <div className="flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                <span className="font-mono text-[11px] font-extrabold">P{n}</span>
              </div>
              <div className="text-[9px] font-bold uppercase tracking-wide opacity-80 truncate">
                {so ? meta.so : meta.en}
              </div>
              {port?.line_number && (
                <div className="font-mono text-[9px] opacity-70 truncate">{port.line_number}</div>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 px-0.5">
        {EDITABLE.slice(0, 4).map((key) => (
          <span key={key} className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500">
            <span className={`w-1.5 h-1.5 rounded-full ${PORT_STATUS_META[key].dot}`} />
            {so ? PORT_STATUS_META[key].so : PORT_STATUS_META[key].en}
          </span>
        ))}
      </div>

      {selected !== null && canEdit && (
        <div className="rounded-2xl border border-slate-200 bg-white p-2.5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-extrabold text-slate-800">
              {so ? `Port ${selected}` : `Port ${selected}`}
              {active?.customer_name && (
                <span className="ml-1 font-normal text-slate-500">· {active.customer_name}</span>
              )}
            </span>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex flex-wrap gap-1">
            {EDITABLE.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setStatus(key)}
                className={`px-2 py-1 rounded-lg text-[11px] font-bold border transition cursor-pointer ${
                  status === key
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-600 border-slate-200'
                }`}
              >
                {so ? PORT_STATUS_META[key].so : PORT_STATUS_META[key].en}
              </button>
            ))}
          </div>

          <input
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder={
              status === 'damaged'
                ? so
                  ? 'Sababta (tusaale: connector jabay)'
                  : 'Reason (e.g. broken connector)'
                : so
                  ? 'Qoraal (ikhtiyaari)'
                  : 'Note (optional)'
            }
            className="w-full h-9 rounded-xl border border-slate-200 px-2.5 text-[11px] focus:outline-none focus:ring-2 focus:ring-emerald-600"
          />

          {error && <p className="text-[10px] font-semibold text-rose-700">{error}</p>}

          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || status === (active?.status ?? 'unknown')}
            className="w-full h-9 rounded-xl bg-emerald-700 text-white text-[11px] font-extrabold disabled:opacity-40 cursor-pointer inline-flex items-center justify-center gap-1.5"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            {so ? 'Kaydi' : 'Save port'}
          </button>
        </div>
      )}

      {!canEdit && (
        <p className="text-[10px] text-slate-400 text-center">
          {so ? 'Port-yada waxaa beddeli kara farsamayaqaanada iyo kormeeraha.' : 'Ports can be updated by technicians and the supervisor.'}
        </p>
      )}
    </div>
  );
}
