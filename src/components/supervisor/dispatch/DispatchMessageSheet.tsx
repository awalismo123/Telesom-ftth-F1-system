import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Copy,
  MessageCircle,
  Phone,
  RotateCcw,
  Send,
  Share2,
  Sliders,
  Truck,
  User,
  X,
} from 'lucide-react';
import type { MessageLane } from '../../../lib/dispatch';
import {
  DEFAULT_TEMPLATES,
  buildDispatchMessage,
  buildBlock,
  targetKey,
  telegramLink,
  whatsappLink,
  type DispatchLang,
} from '../../../lib/dispatch';
import { logDispatch } from '../../../lib/dispatchService';
import { useAuth } from '../../../contexts/AuthContext';
import { useLanguage } from '../../../lib/i18n';

interface Props {
  open: boolean;
  onClose: () => void;
  lanes: MessageLane[];
  groupCode: string;
  groupId: string;
}

type Channel = 'clipboard' | 'share' | 'whatsapp' | 'telegram';

function storageKey(groupId: string, lang: DispatchLang) {
  return `telesom.dispatch.template.${groupId}.${lang}`;
}

export function DispatchMessageSheet({ open, onClose, lanes, groupCode, groupId }: Props) {
  const { t, lang: uiLang } = useLanguage();
  const { session } = useAuth();
  const so = uiLang === 'so';

  const [lang, setLang] = useState<DispatchLang>(uiLang);
  const [includePhone, setIncludePhone] = useState(true);
  const [template, setTemplate] = useState('');
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const stored = localStorage.getItem(storageKey(groupId, lang));
    setTemplate(stored ?? DEFAULT_TEMPLATES[lang]);
    setCopied(null);
  }, [open, groupId, lang]);

  const today = new Date().toISOString().slice(0, 10);

  const activeLanes = useMemo(
    () => lanes.filter((lane) => lane.tasks.length > 0),
    [lanes],
  );

  const masterMessage = useMemo(
    () =>
      buildDispatchMessage(activeLanes, {
        groupCode,
        date: today,
        lang,
        template,
        includePhone,
      }),
    [activeLanes, groupCode, today, lang, template, includePhone],
  );

  const taskIds = useMemo(
    () => activeLanes.flatMap((lane) => lane.tasks.map((task) => task.id)),
    [activeLanes],
  );

  if (!open) return null;

  const record = (channel: Channel) => {
    if (!session?.token) return;
    void logDispatch({
      token: session.token,
      groupId,
      channel,
      message: masterMessage,
      taskIds,
      crewCount: activeLanes.length,
    }).catch(() => {
      // Logging is best effort — never block the supervisor.
    });
  };

  const copyText = async (text: string, marker: string, channel: Channel) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(marker);
      window.setTimeout(() => setCopied(null), 2000);
      record(channel);
    } catch {
      // Very old browsers / insecure contexts: fall back to a textarea.
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      document.body.removeChild(area);
      setCopied(marker);
      window.setTimeout(() => setCopied(null), 2000);
      record(channel);
    }
  };

  const share = async () => {
    const payload = { title: `Telesom ${groupCode} dispatch`, text: masterMessage };
    if (navigator.share) {
      try {
        await navigator.share(payload);
        record('share');
        return;
      } catch {
        // user cancelled or unsupported → fall through to copy
      }
    }
    await copyText(masterMessage, 'master', 'clipboard');
  };

  const openExternal = (url: string, channel: Channel) => {
    record(channel);
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const saveTemplate = (value: string) => {
    setTemplate(value);
    if (value.trim() && value.trim() !== DEFAULT_TEMPLATES[lang].trim()) {
      localStorage.setItem(storageKey(groupId, lang), value);
    } else {
      localStorage.removeItem(storageKey(groupId, lang));
    }
  };

  const resetTemplate = () => {
    localStorage.removeItem(storageKey(groupId, lang));
    setTemplate(DEFAULT_TEMPLATES[lang]);
  };

  return (
    <div className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-6">
      <div className="bg-white w-full sm:max-w-3xl rounded-t-3xl sm:rounded-3xl max-h-[90vh] flex flex-col">
        {/* header */}
        <div className="px-4 py-3 border-b border-slate-100 flex items-start justify-between gap-2">
          <div>
            <div className="text-sm font-extrabold text-slate-900 flex items-center gap-1.5">
              <MessageCircle className="w-4 h-4 text-emerald-700" />
              {t('dispatchMessage')}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              {t('dispatchMessageHint')} · {activeLanes.length} {so ? 'kooxood' : 'teams'} ·{' '}
              {taskIds.length} {so ? 'shaqo' : 'jobs'}
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-4 space-y-3">
          {activeLanes.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-xs text-slate-500">
              {t('dispatchEmptyMessage')}
            </div>
          )}

          {activeLanes.length > 0 && (
            <>
              {/* controls */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-xl border border-slate-200 overflow-hidden">
                  {(['so', 'en'] as DispatchLang[]).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setLang(option)}
                      className={`px-3 py-1.5 text-[11px] font-extrabold transition cursor-pointer ${
                        lang === option
                          ? 'bg-emerald-950 text-white'
                          : 'bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {option === 'so' ? 'Soomaali' : 'English'}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => setIncludePhone((v) => !v)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[11px] font-bold transition cursor-pointer ${
                    includePhone
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                      : 'bg-white border-slate-200 text-slate-500'
                  }`}
                >
                  <Phone className="w-3.5 h-3.5" />
                  {t('dispatchIncludePhone')}
                </button>

                <button
                  type="button"
                  onClick={() => setEditing((v) => !v)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 text-[11px] font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  <Sliders className="w-3.5 h-3.5" />
                  {t('dispatchEditTemplate')}
                </button>
              </div>

              {editing && (
                <div className="rounded-2xl border border-slate-200 p-3 space-y-2 bg-slate-50/60">
                  <textarea
                    value={template}
                    onChange={(e) => saveTemplate(e.target.value)}
                    rows={6}
                    spellCheck={false}
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-[11px] font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-emerald-600 bg-white"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] text-slate-500">{t('dispatchTemplateHelp')}</span>
                    <button
                      type="button"
                      onClick={resetTemplate}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold text-slate-600 hover:bg-white border border-slate-200 cursor-pointer"
                    >
                      <RotateCcw className="w-3 h-3" />
                      {t('dispatchResetTemplate')}
                    </button>
                  </div>
                </div>
              )}

              {/* preview */}
              <div className="rounded-2xl bg-[#e5ddd5] p-3">
                <div className="max-w-md mx-auto">
                  <div className="bg-white rounded-xl rounded-tl-sm px-3 py-2.5 shadow-sm">
                    <pre className="whitespace-pre-wrap break-words font-sans text-[11.5px] leading-relaxed text-slate-800">
                      {masterMessage}
                    </pre>
                  </div>
                  <div className="text-[10px] text-emerald-900/60 text-right mt-1 pr-1">
                    {so ? 'Sida ay ka muuqan doonto WhatsApp' : 'How it will look in WhatsApp'}
                  </div>
                </div>
              </div>

              {/* actions */}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void copyText(masterMessage, 'master', 'clipboard')}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-[11px] font-extrabold cursor-pointer"
                >
                  {copied === 'master' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {copied === 'master' ? t('dispatchCopied') : t('dispatchCopyAll')}
                </button>

                <button
                  type="button"
                  onClick={() => void share()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-slate-200 text-slate-700 text-[11px] font-extrabold hover:bg-slate-50 cursor-pointer"
                >
                  <Share2 className="w-4 h-4" />
                  {t('dispatchShare')}
                </button>

                <button
                  type="button"
                  onClick={() => openExternal(whatsappLink(masterMessage), 'whatsapp')}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#25D366] text-white text-[11px] font-extrabold hover:brightness-95 cursor-pointer"
                >
                  <MessageCircle className="w-4 h-4" />
                  {t('dispatchWhatsApp')}
                </button>

                <button
                  type="button"
                  onClick={() => openExternal(telegramLink(masterMessage), 'telegram')}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#229ED9] text-white text-[11px] font-extrabold hover:brightness-95 cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                  {t('dispatchTelegram')}
                </button>
              </div>

              {/* per-team messages */}
              <div className="space-y-2 pt-1">
                <div className="text-[11px] font-extrabold uppercase tracking-wide text-slate-400">
                  {so ? 'Fariin gooni ah koox kasta' : 'One message per team'}
                </div>

                {activeLanes.map((lane) => {
                  const key = targetKey(lane.target);
                  const single = buildDispatchMessage([lane], {
                    groupCode,
                    date: today,
                    lang,
                    template,
                    includePhone,
                    onlyTargetKey: key,
                  });

                  return (
                    <div
                      key={key}
                      className="rounded-2xl border border-slate-200 p-2.5 flex items-center gap-2"
                    >
                      <span className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-800 flex items-center justify-center shrink-0">
                        {lane.target.kind === 'crew' ? (
                          <Truck className="w-4 h-4" />
                        ) : (
                          <User className="w-4 h-4" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12px] font-extrabold text-slate-900 truncate">
                          {lane.target.name}
                        </span>
                        <span className="block text-[10px] text-slate-500">
                          {lane.tasks.length} {so ? 'shaqo' : lane.tasks.length === 1 ? 'job' : 'jobs'}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => void copyText(single, key, 'clipboard')}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-900 text-white text-[10px] font-bold hover:bg-slate-800 cursor-pointer"
                      >
                        {copied === key ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        {copied === key ? t('dispatchCopied') : t('dispatchCopy')}
                      </button>
                      <button
                        type="button"
                        onClick={() => openExternal(whatsappLink(single), 'whatsapp')}
                        className="p-1.5 rounded-lg text-emerald-700 hover:bg-emerald-50 cursor-pointer"
                        title={t('dispatchWhatsApp')}
                      >
                        <MessageCircle className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* preview of the block used for a single team */}
              <details className="rounded-2xl border border-slate-200 p-3">
                <summary className="text-[11px] font-bold text-slate-600 cursor-pointer">
                  {so ? 'Muuji qaabka fariinta hal koox' : 'Show a single-team block'}
                </summary>
                <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-[11px] leading-relaxed text-slate-700">
                  {buildBlock(activeLanes[0], lang, includePhone)}
                </pre>
              </details>
            </>
          )}
        </div>

        <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between">
          <span className="text-[10px] text-slate-400">
            {taskIds.length} {so ? 'shaqo' : 'jobs'} · {activeLanes.length} {so ? 'kooxood' : 'teams'}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-extrabold hover:bg-slate-800 cursor-pointer"
          >
            {so ? 'Xir' : 'Done'}
          </button>
        </div>
      </div>
    </div>
  );
}
