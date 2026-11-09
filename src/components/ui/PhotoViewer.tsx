import React, { useEffect, useState } from 'react';
import { Camera, Loader2, X } from 'lucide-react';
import { fetchTaskPhoto, type TaskPhoto } from '../../lib/reads';
import { photoSizeLabel } from '../../lib/photo';
import { formatDateTime } from '../../lib/format';
import { describeError } from '../../lib/useErrorMessage';
import { useLanguage } from '../../lib/i18n';

/**
 * One completion photo, full screen.
 *
 * The bytes are fetched on open rather than with the list, because a board with
 * forty jobs must not download forty photographs to show forty rows. Nothing is
 * cached: a photograph of a customer's wall is not something to keep in memory
 * after it has been looked at.
 */
export function PhotoViewer({
  token,
  photoId,
  caption,
  onClose,
}: {
  token: string;
  photoId: string;
  caption?: string;
  onClose: () => void;
}) {
  const { lang } = useLanguage();
  const so = lang === 'so';

  const [photo, setPhoto] = useState<TaskPhoto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    void fetchTaskPhoto(token, photoId)
      .then((row) => !cancelled && setPhoto(row))
      .catch((err) => !cancelled && setError(describeError(err, lang)))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [token, photoId, lang]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[70] bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-3"
      role="dialog"
      aria-modal="true"
      aria-label={so ? 'Sawirka caddaynta' : 'Photo proof'}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-2xl w-full sm:max-w-lg overflow-hidden max-h-[92vh] flex flex-col">
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-100">
          <Camera className="w-4 h-4 text-emerald-700" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-extrabold text-slate-900">
              {so ? 'Caddaynta sawirka' : 'Photo proof'}
            </div>
            <div className="text-[10px] text-slate-500 truncate">
              {caption ??
                (photo
                  ? `${photo.uploaded_by_name} · ${formatDateTime(photo.created_at, lang)}`
                  : so
                    ? 'Waa la soo dejinayaa…'
                    : 'Loading…')}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={so ? 'Xir sawirka' : 'Close photo'}
            className="w-9 h-9 rounded-xl bg-slate-100 text-slate-600 inline-flex items-center justify-center cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="bg-slate-900 flex-1 min-h-0 flex items-center justify-center">
          {loading && (
            <div className="py-16 text-white inline-flex items-center gap-2 text-xs font-semibold">
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              {so ? 'Sawirka ayaa imanaya' : 'Fetching the photo'}
            </div>
          )}

          {!loading && error && (
            <div className="py-16 px-4 text-center text-rose-200 text-xs font-semibold">{error}</div>
          )}

          {!loading && photo && (
            <img
              src={`data:${photo.mime};base64,${photo.base64}`}
              alt={so ? 'Sawirka shaqada la dhammeeyay' : 'Photograph of the completed job'}
              className="max-h-[70vh] w-auto max-w-full object-contain"
            />
          )}
        </div>

        {photo && (
          <div className="px-3 py-2 border-t border-slate-100 text-[10px] text-slate-500 flex items-center justify-between gap-2">
            <span className="truncate">
              {photo.uploaded_by_name} · {formatDateTime(photo.created_at, lang)}
            </span>
            <span className="font-mono shrink-0">{photoSizeLabel(photo.byte_size)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
