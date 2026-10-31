import { useCallback } from 'react';
import { useLanguage } from './i18n';
import { toErrorMessage } from './errors';
import { RpcError } from './rpc';

/**
 * Turn anything caught in a `catch` block into a sentence the user can act on.
 *
 * `RpcError.detail` keeps the original Postgres text, so a message that was
 * already translated once is translated again from the source — never
 * "translated" from an English sentence.
 */
export function describeError(error: unknown, lang: 'so' | 'en'): string {
  if (error instanceof RpcError) return toErrorMessage(error.detail, lang);

  const detail =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';

  return toErrorMessage(detail, lang);
}

/** Hook form — bound to the language currently selected in the app. */
export function useErrorMessage() {
  const { lang } = useLanguage();
  return useCallback((error: unknown) => describeError(error, lang), [lang]);
}
