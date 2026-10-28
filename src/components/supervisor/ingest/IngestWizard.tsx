import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  CheckCircle2,
  ClipboardPaste,
  FileSpreadsheet,
  History,
  Image as ImageIcon,
  Loader2,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  X,
  Zap,
} from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../contexts/AuthContext';
import { useLanguage } from '../../../lib/i18n';
import type { OcrProgress, OcrResult } from '../../../lib/ocr/engine';
import { buildRowsFromRecords, type ExtractedRow } from '../../../lib/ocr/extract';
import { parseTabularText, parseCsvFile } from '../../../lib/ocr/paste';
import { GALINTA_TEMPLATE, CILADA_TEMPLATE, type SheetTemplate } from '../../../lib/ocr/templates';
import {
  buildImportPlan,
  commitImport,
  undoImport,
  uploadSourceImage,
  type CommitResult,
  type ImportPlan,
  type RowDecision,
} from '../../../lib/importer';
import { ExtractionReview } from './ExtractionReview';
import { ConflictPanel } from './ConflictPanel';

type Phase = 'source' | 'processing' | 'review' | 'conflicts' | 'done';

interface ImportBatchRow {
  id: string;
  sheet_category: 'installation' | 'cilada';
  source_type: string;
  file_name: string | null;
  print_date: string | null;
  total_rows_read: number;
  group_matched_rows: number;
  new_tasks_created: number;
  duplicates_skipped: number;
  carryovers_updated: number;
  status: string;
  created_at: string;
  source_image_path: string | null;
}

export function IngestWizard() {
  const { session, activeGroup } = useAuth();
  const { lang } = useLanguage();
  const so = lang === 'so';

  const [phase, setPhase] = useState<Phase>('source');
  const [sheetType, setSheetType] = useState<'galinta' | 'cilada' | null>(null);
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [rows, setRows] = useState<ExtractedRow[]>([]);
  const [extraction, setExtraction] = useState<OcrResult | null>(null);
  const ocrUsedRef = useRef(false);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceLabel, setSourceLabel] = useState<string>('');
  const [sourceKind, setSourceKind] = useState<'image' | 'excel' | 'paste' | 'pdf'>('image');
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [committing, setCommitting] = useState(false);
  const [history, setHistory] = useState<ImportBatchRow[]>([]);
  const [historyBusy, setHistoryBusy] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const templateHint: SheetTemplate | undefined =
    sheetType === 'galinta' ? GALINTA_TEMPLATE : sheetType === 'cilada' ? CILADA_TEMPLATE : undefined;

  const loadHistory = useCallback(async () => {
    if (!activeGroup?.id) return;
    const { data } = await supabase
      .from('import_batches')
      .select(
        'id, sheet_category, source_type, file_name, print_date, total_rows_read, group_matched_rows, new_tasks_created, duplicates_skipped, carryovers_updated, status, created_at, source_image_path',
      )
      .eq('group_id', activeGroup.id)
      .order('created_at', { ascending: false })
      .limit(8);
    if (data) setHistory(data as ImportBatchRow[]);
  }, [activeGroup?.id]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    return () => {
      // Free the WASM worker + the trained data when the supervisor leaves the
      // wizard; phones run out of memory otherwise. Only do this if the OCR
      // bundle was actually loaded — importing it here would defeat the
      // on-demand split.
      if (!ocrUsedRef.current) return;
      void import('../../../lib/ocr/engine').then((m) => m.terminateOcrWorker());
    };
  }, []);

  const reset = () => {
    setPhase('source');
    setRows([]);
    setExtraction(null);
    setSourceFile(null);
    setSourceLabel('');
    setPlan(null);
    setResult(null);
    setError(null);
    setProgress(null);
    setPasteText('');
  };

  /* ------------------------------------------------------------------ */
  /* Image pipeline                                                      */
  /* ------------------------------------------------------------------ */
  const handleImage = async (file: File) => {
    setError(null);
    setSourceFile(file);
    setSourceKind('image');
    setSourceLabel(file.name);
    setPhase('processing');
    setProgress({ stage: 'preparing', progress: 0.01, message: so ? 'Sawirka waa la diyaarinayaa…' : 'Preparing the picture…' });

    try {
      // Loaded on demand: the Tesseract bundle is ~500 kB and most sessions
      // never open this wizard, so it must not block the first paint on 3G.
      const { extractFromImage } = await import('../../../lib/ocr/engine');
      ocrUsedRef.current = true;
      const ocr = await extractFromImage(file, setProgress, templateHint);
      setExtraction(ocr);
      const built = buildRowsFromRecords(ocr.records, ocr.template);
      // Even with zero rows we go to the review screen: the supervisor can then
      // paste the table or type the rows instead of losing the attempt.
      setRows(built);
      setSheetType(ocr.template.id === 'galinta' ? 'galinta' : 'cilada');
      setPhase('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read the picture');
      setPhase('source');
    }
  };

  const handleText = (text: string, label: string, kind: 'paste' | 'excel') => {
    setError(null);
    try {
      const parsed =
        kind === 'paste'
          ? parseTabularText(text, templateHint)
          : parseCsvFile(text, templateHint);
      const built = buildRowsFromRecords(parsed.records, parsed.template);
      if (!built.length) throw new Error(so ? 'Xog ma jirto.' : 'No rows found in that text.');
      setExtraction(null);
      setRows(built);
      setSheetType(parsed.template.id === 'galinta' ? 'galinta' : 'cilada');
      setSourceKind(kind);
      setSourceLabel(label);
      setSourceFile(null);
      setPasteOpen(false);
      setPhase('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse the text');
    }
  };

  const onFilesPicked = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;

    if (file.type.startsWith('image/')) {
      void handleImage(file);
      return;
    }

    if (/\.(csv|tsv|txt)$/i.test(file.name)) {
      const reader = new FileReader();
      reader.onload = () => handleText(String(reader.result || ''), file.name, 'excel');
      reader.readAsText(file);
      return;
    }

    setError(
      so
        ? 'Faylkan lama taageerayo. Isticmaal sawir (JPEG/PNG), CSV, ama koobi-gasho xogta Excel-ka.'
        : 'Unsupported file. Use a picture (JPEG/PNG), a CSV file, or paste the Excel table.',
    );
  };

  /* ------------------------------------------------------------------ */
  /* Conflict + commit                                                   */
  /* ------------------------------------------------------------------ */
  const goToConflicts = async () => {
    if (!session || !activeGroup) return;
    setError(null);
    setCommitting(true);
    try {
      const built = await buildImportPlan({
        token: session.token,
        groupId: activeGroup.id,
        groupCode: activeGroup.code,
        taskType: sheetType === 'galinta' ? 'installation' : 'cilada',
        rows,
      });
      setPlan(built);
      setPhase('conflicts');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check existing tasks');
    } finally {
      setCommitting(false);
    }
  };

  const confirmImport = async () => {
    if (!session || !activeGroup || !plan || !sheetType) return;
    setCommitting(true);
    setError(null);
    try {
      let imagePath: string | null = null;
      if (sourceFile && sourceFile.type.startsWith('image/')) {
        imagePath = await uploadSourceImage(sourceFile, activeGroup.id);
      }

      const committed = await commitImport({
        token: session.token,
        groupId: activeGroup.id,
        sheetCategory: sheetType === 'galinta' ? 'installation' : 'cilada',
        sourceType: sourceKind,
        fileName: sourceLabel || 'daily-sheet',
        printDate: rows[0]?.derived.reportedDate ?? null,
        sourceImagePath: imagePath,
        plan,
      });
      setResult(committed);
      setPhase('done');
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setCommitting(false);
    }
  };

  const handleUndo = async (batchId: string) => {
    if (!session) return;
    setHistoryBusy(batchId);
    try {
      await undoImport(session.token, batchId);
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Undo failed');
    } finally {
      setHistoryBusy(null);
    }
  };

  const updatePlanRow = (rowId: string, decision: RowDecision) => {
    if (!plan) return;
    setPlan({
      ...plan,
      rows: plan.rows.map((r) => (r.id === rowId ? { ...r, decision } : r)),
    });
  };

  /* ------------------------------------------------------------------ */
  /* Render                                                              */
  /* ------------------------------------------------------------------ */
  const stepper = [
    { id: 'source', label: so ? 'Sawirka' : 'Picture' },
    { id: 'review', label: so ? 'Hubi' : 'Verify' },
    { id: 'conflicts', label: so ? 'Go\'aamad' : 'Decide' },
    { id: 'done', label: so ? 'Dhammaystiran' : 'Done' },
  ];

  const activeStepIndex =
    phase === 'source' ? 0 : phase === 'processing' ? 0 : phase === 'review' ? 1 : phase === 'conflicts' ? 2 : 3;

  const template = extraction?.template ?? templateHint ?? CILADA_TEMPLATE;

  return (
    <div className="space-y-5">
      {/* Header + stepper */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-lg font-extrabold text-slate-900">
              {so ? 'Soo Geli Warqadda Maanta' : 'Daily Sheet Upload'}
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              {so
                ? 'Sawirka kooxda laga soo diray (JPEG/PNG), Excel, ama xog koobi-gashan — nidaamku wuxuu soo saarayaa Group F1 oo keliya.'
                : 'Group-chat picture (JPEG/PNG), Excel/CSV or pasted rows — only your active group is extracted.'}
            </p>
          </div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-[11px] font-bold text-emerald-800 self-start">
            <ShieldCheck className="w-3.5 h-3.5" />
            {so ? 'Sawirka taleefankaaga kama baxo' : 'OCR runs on your device'}
          </div>
        </div>

        <div className="flex items-center gap-1.5 mt-4">
          {stepper.map((step, idx) => {
            const active = idx === activeStepIndex;
            const done = idx < activeStepIndex;
            return (
              <React.Fragment key={step.id}>
                <div
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold ${
                    active
                      ? 'bg-emerald-950 text-white'
                      : done
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-slate-50 text-slate-400 border border-slate-200'
                  }`}
                >
                  {done ? (
                    <CheckCircle2 className="w-3 h-3" />
                  ) : (
                    <span className="w-3.5 h-3.5 rounded-full bg-current/20 grid place-items-center text-[9px]">
                      {idx + 1}
                    </span>
                  )}
                  <span>{step.label}</span>
                </div>
                {idx < stepper.length - 1 && <div className="flex-1 h-px bg-slate-200 min-w-2" />}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 flex items-start gap-2.5">
          <X className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <div className="text-xs font-semibold text-rose-800">{error}</div>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* SOURCE                                                            */}
      {/* ---------------------------------------------------------------- */}
      {phase === 'source' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            {/* Sheet type */}
            <div className="bg-white rounded-2xl border border-slate-200 p-4">
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-2">
                1 · {so ? 'Nooca warqadda' : 'Sheet type'}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setSheetType(null)}
                  className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                    sheetType === null
                      ? 'border-emerald-600 bg-emerald-50 ring-1 ring-emerald-500/30'
                      : 'border-slate-200 hover:border-emerald-300'
                  }`}
                >
                  <Sparkles className="w-4 h-4 text-emerald-700 mb-1.5" />
                  <div className="text-xs font-bold text-slate-900">
                    {so ? 'Auto-detect' : 'Auto-detect'}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {so ? 'Nidaamka ayaa garta' : 'Best for new formats'}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setSheetType('galinta')}
                  className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                    sheetType === 'galinta'
                      ? 'border-emerald-600 bg-emerald-50 ring-1 ring-emerald-500/30'
                      : 'border-slate-200 hover:border-emerald-300'
                  }`}
                >
                  <FileSpreadsheet className="w-4 h-4 text-emerald-700 mb-1.5" />
                  <div className="text-xs font-bold text-slate-900">Galinta</div>
                  <div className="text-[10px] text-slate-500">
                    {so ? 'Rakibaad taagan' : 'Pending Installation'}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setSheetType('cilada')}
                  className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                    sheetType === 'cilada'
                      ? 'border-emerald-600 bg-emerald-50 ring-1 ring-emerald-500/30'
                      : 'border-slate-200 hover:border-emerald-300'
                  }`}
                >
                  <Zap className="w-4 h-4 text-emerald-700 mb-1.5" />
                  <div className="text-xs font-bold text-slate-900">Cilada</div>
                  <div className="text-[10px] text-slate-500">
                    {so ? 'Cilado taagan' : 'Active Faults'}
                  </div>
                </button>
              </div>
            </div>

            {/* Drop zone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                onFilesPicked(e.dataTransfer.files);
              }}
              className={`bg-white rounded-2xl border-2 border-dashed p-6 sm:p-10 text-center transition ${
                dragging ? 'border-emerald-500 bg-emerald-50/60' : 'border-slate-300'
              }`}
            >
              <div className="w-14 h-14 rounded-2xl bg-emerald-100 text-emerald-800 grid place-items-center mx-auto mb-3">
                <UploadCloud className="w-7 h-7" />
              </div>
              <h3 className="text-sm font-extrabold text-slate-900">
                {so ? 'Soo dhig sawirka kooxda' : 'Drop the group-chat picture here'}
              </h3>
              <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                {so
                  ? 'JPEG, PNG ama screenshot. Waxa kale ee la taageerayo: fayl CSV ama xog Excel ah oo la koobi-gashaday.'
                  : 'JPEG, PNG or a screenshot. You can also use a CSV file or paste rows copied straight out of Excel.'}
              </p>

              <div className="flex flex-wrap items-center justify-center gap-2 mt-4">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold cursor-pointer"
                >
                  <ImageIcon className="w-4 h-4" />
                  {so ? 'Dooro sawir' : 'Choose picture'}
                </button>
                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold cursor-pointer"
                >
                  <Camera className="w-4 h-4" />
                  {so ? 'Qaado sawir' : 'Take photo'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setPasteOpen(true);
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold cursor-pointer"
                >
                  <ClipboardPaste className="w-4 h-4" />
                  {so ? 'Koobi-gasho xog' : 'Paste table'}
                </button>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.csv,.tsv,.txt"
                className="hidden"
                onChange={(e) => onFilesPicked(e.target.files)}
              />
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => onFilesPicked(e.target.files)}
              />
            </div>
          </div>

          {/* Recent imports */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
            <div className="flex items-center gap-1.5">
              <History className="w-4 h-4 text-slate-500" />
              <h3 className="text-xs font-extrabold text-slate-900 uppercase tracking-wide">
                {so ? 'Soo-gelinta Ugu Dambeysay' : 'Recent imports'}
              </h3>
            </div>

            {history.length === 0 && (
              <p className="text-xs text-slate-400 italic py-4">
                {so ? 'Weli wax soo-gelin ah ma jiraan.' : 'No imports yet.'}
              </p>
            )}

            <div className="space-y-2 max-h-[26rem] overflow-y-auto pr-1">
              {history.map((batch) => (
                <div
                  key={batch.id}
                  className={`p-3 rounded-xl border ${
                    batch.status === 'undone'
                      ? 'border-slate-200 bg-slate-50 opacity-60'
                      : 'border-slate-200 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        batch.sheet_category === 'installation'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-rose-100 text-rose-800'
                      }`}
                    >
                      {batch.sheet_category === 'installation' ? 'GALINTA' : 'CILADA'}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      {new Date(batch.created_at).toLocaleString([], {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>

                  <div className="text-[11px] text-slate-600 mt-1.5">
                    <strong className="text-slate-900">{batch.new_tasks_created}</strong>{' '}
                    {so ? 'cusub' : 'new'} · <strong>{batch.carryovers_updated}</strong>{' '}
                    {so ? 'cusboonaysiin' : 'updated'} ·{' '}
                    <strong>{batch.group_matched_rows}</strong> F1 / {batch.total_rows_read}
                  </div>

                  {batch.status === 'undone' ? (
                    <div className="text-[10px] font-bold text-slate-400 mt-1.5">
                      {so ? 'LA BEDDELAY (Undone)' : 'UNDONE'}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleUndo(batch.id)}
                      disabled={historyBusy === batch.id}
                      className="mt-2 inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 disabled:opacity-50 cursor-pointer"
                    >
                      {historyBusy === batch.id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <RotateCcw className="w-3 h-3" />
                      )}
                      {so ? 'Ka noqo (Undo)' : 'Undo import'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* PROCESSING                                                        */}
      {/* ---------------------------------------------------------------- */}
      {phase === 'processing' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 sm:p-12 text-center max-w-xl mx-auto">
          <Loader2 className="w-9 h-9 text-emerald-700 animate-spin mx-auto mb-4" />
          <h3 className="text-sm font-extrabold text-slate-900">
            {so ? 'Sawirka waa la akhrinayaa…' : 'Reading the picture…'}
          </h3>
          <p className="text-xs text-slate-500 mt-1">{progress?.message}</p>

          <div className="h-2 rounded-full bg-slate-100 overflow-hidden mt-5">
            <div
              className="h-full bg-emerald-600 transition-all duration-300"
              style={{ width: `${Math.round((progress?.progress ?? 0.02) * 100)}%` }}
            />
          </div>
          <p className="text-[11px] text-slate-400 mt-2">
            {so
              ? 'Markii ugu horeysay waxa ay qaadan kartaa 20-ilbiriq si moodelka OCR u soo dego.'
              : 'The first run may take up to 20 seconds while the OCR model loads. It is cached afterwards.'}
          </p>

          <button
            type="button"
            onClick={reset}
            className="mt-5 px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
          >
            {so ? 'Jooji' : 'Cancel'}
          </button>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* REVIEW                                                            */}
      {/* ---------------------------------------------------------------- */}
      {phase === 'review' && (
        <div className="space-y-4">
          <ExtractionReview
            template={template}
            rows={rows}
            onChange={setRows}
            preview={extraction?.processedPreview ?? null}
            imageSize={extraction?.imageSize ?? null}
            gridLines={
              extraction
                ? {
                    rows: extraction.grid.rowBands.map((b) => b.center),
                    cols: extraction.grid.colBands.map((b) => b.center),
                  }
                : null
            }
            groupCode={activeGroup?.code ?? 'F1'}
            titleText={extraction?.titleText}
            warnings={extraction?.warnings ?? []}
            perColumn={extraction?.stats.perColumn}
            onAddRow={() => setRows((prev) => [...prev, ...buildRowsFromRecords([{}], template)])}
            onPasteInstead={() => {
              setPasteOpen(true);
              setPhase('source');
            }}
          />

          <div className="flex flex-wrap items-center justify-between gap-2 bg-white rounded-2xl border border-slate-200 p-4">
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              {so ? 'Dib u noqo' : 'Back'}
            </button>

            <div className="flex items-center gap-2">
              <span className="text-[11px] text-slate-500 hidden sm:block">
                {so
                  ? 'Waxba lama keydiyo ilaa aad go\'aamad qaadato'
                  : 'Nothing is saved until you confirm'}
              </span>
              <button
                type="button"
                onClick={() => void goToConflicts()}
                disabled={committing || rows.length === 0}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-xs font-bold cursor-pointer"
              >
                {committing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {so ? 'Sii wad — hubi shaqooyinka hore' : 'Continue — check existing tasks'}
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* CONFLICTS                                                         */}
      {/* ---------------------------------------------------------------- */}
      {phase === 'conflicts' && plan && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 flex items-start gap-2.5">
            <ShieldCheck className="w-4 h-4 text-sky-700 shrink-0 mt-0.5" />
            <div className="text-xs text-sky-900 font-medium">
              {so
                ? 'Nidaamka si otomaatig ah wax ma beddelin. Shaqo kasta oo hore u jirtay waxaad halkan ka dooranaysaa waxa lagu sameeyo.'
                : 'Nothing has been changed yet. Every row that already exists in the system is listed below — choose what happens to each one.'}
            </div>
          </div>

          <ConflictPanel plan={plan} onChange={setPlan} />

          <div className="flex flex-wrap items-center justify-between gap-2 bg-white rounded-2xl border border-slate-200 p-4">
            <button
              type="button"
              onClick={() => setPhase('review')}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              {so ? 'Dib u noqo xogta' : 'Back to rows'}
            </button>

            <button
              type="button"
              onClick={() => void confirmImport()}
              disabled={committing}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-xs font-bold cursor-pointer"
            >
              {committing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {so ? 'Xaqiiji oo soo geli' : 'Confirm & import'}
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* DONE                                                              */}
      {/* ---------------------------------------------------------------- */}
      {phase === 'done' && result && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-10 max-w-2xl mx-auto text-center">
          <div className="w-14 h-14 rounded-2xl bg-emerald-100 text-emerald-700 grid place-items-center mx-auto mb-4">
            <CheckCircle2 className="w-7 h-7" />
          </div>
          <h3 className="text-lg font-extrabold text-slate-900">
            {so ? 'Soo-gelinta waa dhammaatay!' : 'Import complete!'}
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            {so
              ? 'Shaqooyinka cusub waxay hadda ku jiraan liiska qaybinta.'
              : 'The new tasks are now in the dispatch queue.'}
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 text-left">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
              <div className="text-[10px] font-bold uppercase text-emerald-700">
                {so ? 'Cusub' : 'Created'}
              </div>
              <div className="text-xl font-extrabold text-emerald-900">{result.created}</div>
            </div>
            <div className="rounded-xl border border-sky-200 bg-sky-50 p-3">
              <div className="text-[10px] font-bold uppercase text-sky-700">
                {so ? 'Cusboonaysiin' : 'Refreshed'}
              </div>
              <div className="text-xl font-extrabold text-sky-900">{result.refreshed}</div>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <div className="text-[10px] font-bold uppercase text-amber-700">
                {so ? 'Dib u furid' : 'Reopened'}
              </div>
              <div className="text-xl font-extrabold text-amber-900">{result.reopened}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-[10px] font-bold uppercase text-slate-500">
                {so ? 'La dhaafay' : 'Skipped'}
              </div>
              <div className="text-xl font-extrabold text-slate-700">{result.skipped}</div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2 mt-6">
            <button
              type="button"
              onClick={reset}
              className="px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold cursor-pointer"
            >
              {so ? 'Soo geli warqad kale' : 'Upload another sheet'}
            </button>
            <button
              type="button"
              onClick={() => void handleUndo(result.batch_id)}
              disabled={historyBusy === result.batch_id}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 text-xs font-bold disabled:opacity-50 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {so ? 'Ka noqo soo-gelintan' : 'Undo this import'}
            </button>
          </div>
        </div>
      )}

      {/* Paste modal */}
      {pasteOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-2xl overflow-hidden">
            <div className="px-5 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ClipboardPaste className="w-4 h-4 text-emerald-700" />
                <h3 className="font-bold text-slate-900 text-sm">
                  {so ? 'Koobi-gasho xogta Excel-ka' : 'Paste the table'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setPasteOpen(false)}
                className="p-1 rounded text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3">
              <p className="text-xs text-slate-500">
                {so
                  ? 'Excel-ka fur, xogta dooro oo Ctrl+C / Ctrl+V halkan ku dheji. Safka koowaad waa inuu yahay cinwaanka.'
                  : 'Open the sheet, select the table including the header row, then Ctrl+C / Ctrl+V here. Tabs, commas and pipes are all detected.'}
              </p>
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                rows={10}
                placeholder={'ID\tCustName\tLine_No\tXNumber\tRef-Number\tXaafada\tService\tShaqada\tDateIn\tTimeIn\tSpeed\tGroup'}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-[11px] font-mono focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPasteOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
                >
                  {so ? 'Jooji' : 'Cancel'}
                </button>
                <button
                  type="button"
                  onClick={() => handleText(pasteText, 'pasted-table', 'paste')}
                  disabled={pasteText.trim().length < 10}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-700 text-white disabled:opacity-50 cursor-pointer"
                >
                  {so ? 'Falanqee' : 'Parse rows'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
