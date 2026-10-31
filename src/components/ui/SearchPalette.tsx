import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, MapPin, Search, Server, Timer, User } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../lib/i18n';
import { globalSearch } from '../../lib/opsService';
import { EMPTY_SEARCH, searchQueryIsUsable, statusLabel, type SearchResponse } from '../../lib/ops';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { describeError } from '../../lib/useErrorMessage';
import { Sheet } from './Sheet';
import { Input } from './Field';
import { cx } from './cx';

/**
 * One box for "where is…".
 *
 * A supervisor on the phone is asked "what is happening with line 6344771?"
 * and the answer must not require opening three tabs. This searches lines,
 * customers, phone numbers, cableboxes and areas in one query — the database
 * ranks the answers so the exact line number is always first.
 */
export function SearchPalette({
  open,
  onClose,
  onPickTask,
  onPickBox,
}: {
  open: boolean;
  onClose: () => void;
  onPickTask: (taskId: string) => void;
  onPickBox: (boxId: string) => void;
}) {
  const { session, activeGroup } = useAuth();
  const { lang } = useLanguage();
  const so = lang === 'so';

  const [query, setQuery] = useState('');
  const [result, setResult] = useState<SearchResponse>(EMPTY_SEARCH);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);

  const debounced = useDebouncedValue(query, 220);
  const token = session?.token ?? '';
  const groupId = activeGroup?.id ?? '';
  const requestId = useRef(0);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setResult(EMPTY_SEARCH);
    setError(null);
    setActive(0);
  }, [open]);

  useEffect(() => {
    if (!open || !token || !groupId || !searchQueryIsUsable(debounced)) {
      setResult(EMPTY_SEARCH);
      setLoading(false);
      return;
    }

    const id = ++requestId.current;
    setLoading(true);

    void globalSearch({ token, groupId, query: debounced })
      .then((payload) => {
        // Ignore an older answer that landed after a newer one.
        if (id !== requestId.current) return;
        setResult(payload);
        setActive(0);
        setError(null);
      })
      .catch((err) => {
        if (id !== requestId.current) return;
        setError(describeError(err, lang));
      })
      .finally(() => id === requestId.current && setLoading(false));

    return () => {
      requestId.current += 1;
    };
  }, [open, token, groupId, debounced, lang]);

  const rows = useMemo(() => {
    const tasks = result.tasks.map((hit) => ({ kind: 'task' as const, id: hit.id }));
    const boxes = result.boxes.map((hit) => ({ kind: 'box' as const, id: hit.id }));
    return [...tasks, ...boxes];
  }, [result]);

  const pick = (index: number) => {
    const row = rows[index];
    if (!row) return;
    if (row.kind === 'task') onPickTask(row.id);
    else onPickBox(row.id);
    onClose();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current) => Math.min(current + 1, Math.max(rows.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => Math.max(current - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      pick(active);
    }
  };

  const usable = searchQueryIsUsable(query);
  const empty = usable && !loading && rows.length === 0;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="lg"
      title={
        <span className="flex items-center gap-2">
          <Search className="w-4 h-4 text-emerald-700" aria-hidden="true" />
          {so ? 'Raadi' : 'Search'}
        </span>
      }
      description={
        so
          ? 'Khad, macmiil, taleefan, sanduuq ama xaafad — dhammaan hal meel.'
          : 'Line, customer, phone, cablebox or area — all in one place.'
      }
    >
      <div className="space-y-3" onKeyDown={onKeyDown}>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={so ? 'Tusaale: 6344771 ama FAT 48' : 'For example: 6344771 or FAT 48'}
          aria-label={so ? 'Raadi' : 'Search'}
          inputSize="lg"
          autoFocus
          leadingIcon={<Search className="w-4 h-4" />}
          aside={loading ? <Loader2 className="w-4 h-4 animate-spin text-emerald-700" /> : null}
        />

        {error && <p className="text-[11px] font-semibold text-rose-600">{error}</p>}

        {!usable && (
          <p className="text-[11px] text-slate-500 px-1">
            {so ? 'Qor ugu yaraan laba xaraf.' : 'Type at least two characters.'}
          </p>
        )}

        {empty && (
          <p className="text-[12px] text-slate-500 px-1 py-6 text-center">
            {so ? 'Waxba lama helin.' : 'Nothing found.'}
          </p>
        )}

        {result.tasks.length > 0 && (
          <section>
            <h3 className="px-1 pb-1.5 text-[10px] font-extrabold uppercase tracking-wide text-slate-500">
              {so ? 'Shaqooyin' : 'Jobs'}
            </h3>
            <ul className="space-y-1">
              {result.tasks.map((hit, index) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    onClick={() => pick(index)}
                    onPointerEnter={() => setActive(index)}
                    className={cx(
                      'w-full text-left rounded-xl border px-3 py-2 transition cursor-pointer',
                      active === index
                        ? 'border-emerald-400 bg-emerald-50'
                        : 'border-slate-200 bg-white hover:border-emerald-300',
                    )}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-[11px] font-bold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">
                        {hit.line_number}
                      </span>
                      <span className="text-[12px] font-bold text-slate-900 truncate">{hit.customer_name}</span>
                      <span className="text-[10px] font-bold text-slate-500">{statusLabel(hit.status, lang)}</span>
                      {hit.priority === 'urgent' && (
                        <span className="text-[10px] font-extrabold text-rose-700">DEGDEG</span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                      {hit.xaafada && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {hit.xaafada}
                        </span>
                      )}
                      {hit.cablebox_code_raw && (
                        <span className="inline-flex items-center gap-1">
                          <Server className="w-3 h-3" />
                          {hit.cablebox_code_raw}
                          {hit.port_number ? ` ·${hit.port_number}` : ''}
                        </span>
                      )}
                      {hit.worker && (
                        <span className="inline-flex items-center gap-1">
                          <User className="w-3 h-3" />
                          {hit.worker}
                        </span>
                      )}
                      {hit.task_type === 'cilada' && (
                        <span className="inline-flex items-center gap-1">
                          <Timer className="w-3 h-3" />
                          cilada
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {result.boxes.length > 0 && (
          <section>
            <h3 className="px-1 pb-1.5 text-[10px] font-extrabold uppercase tracking-wide text-slate-500">
              {so ? 'Sanduuqyo' : 'Cableboxes'}
            </h3>
            <ul className="space-y-1">
              {result.boxes.map((hit, index) => {
                const rowIndex = result.tasks.length + index;
                return (
                  <li key={hit.id}>
                    <button
                      type="button"
                      onClick={() => pick(rowIndex)}
                      onPointerEnter={() => setActive(rowIndex)}
                      className={cx(
                        'w-full text-left rounded-xl border px-3 py-2 transition cursor-pointer',
                        active === rowIndex
                          ? 'border-emerald-400 bg-emerald-50'
                          : 'border-slate-200 bg-white hover:border-emerald-300',
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <Server className="w-3.5 h-3.5 text-emerald-700" />
                        <span className="text-[12px] font-extrabold text-slate-900">{hit.box_code}</span>
                        <span className="text-[10px] font-bold text-slate-500">
                          {hit.total_ports} {so ? 'port' : 'ports'}
                        </span>
                        {hit.ports_damaged > 0 && (
                          <span className="text-[10px] font-bold text-rose-700">
                            {hit.ports_damaged} {so ? 'jaban' : 'damaged'}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-500">
                        {[hit.xaafada, hit.olt_path].filter(Boolean).join(' · ') || '—'}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </Sheet>
  );
}
