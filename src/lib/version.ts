/**
 * What version of the app is in front of the person.
 *
 * A manager who approved "the version on Tuesday" needs to be able to say which
 * one that was; a technician reporting a problem needs to be able to say the
 * same. The number is stamped on the sign-in screen, which is the one screen
 * everyone sees whether they can sign in or not.
 *
 * Deliberately a constant rather than a build-time inject: it is two strings,
 * it never goes stale in a way that matters, and reading `package.json` into the
 * bundle for a label would be a poor trade.
 */

export const APP_VERSION = '1.1.0';

/**
 * The date this build was published.
 *
 * 1.0.0 was the batch that closed the security hole; 1.1.0 is the manager pack —
 * the record, photo proof and the read-only manager. Both are on the sign-in
 * screen and on the printed report, because a report that a head manager files
 * is worth nothing if nobody can tell which build produced it.
 */
export const BUILD_DATE = '2026-11-09';

export const BUILD_LABEL = `v${APP_VERSION} · ${BUILD_DATE}`;
