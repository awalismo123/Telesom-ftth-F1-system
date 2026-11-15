/**
 * Getting a technician to the right street.
 *
 * ## There are no coordinates in this system
 *
 * `cableboxes` has `box_code`, `xaafada` (neighbourhood) and `location_notes`.
 * `tasks` carries the same two text fields. **Nothing has a latitude or a
 * longitude**, and no amount of front-end work can produce one.
 *
 * The tempting shortcut — putting a pin on the city centre, or on a
 * neighbourhood centroid — is worse than useless. It would look authoritative
 * and send someone to the wrong street, and the technician would trust it
 * because the app drew a marker.
 *
 * So this module builds a **map search**, and every screen that uses it says so:
 * "opens a map search for the box name — not a saved pin." The technician
 * compares the box name on the map with the box name on their job card, which is
 * a check they are already able to make.
 *
 * ## The honest fix, if accuracy is ever needed
 *
 * A coordinate captured **once per box, on site, by a technician** using the
 * phone's own GPS — stored on `cableboxes` and stamped with who and when. That
 * is a later phase, and it needs the boxes to be visited. It is not something to
 * fake now.
 */

export interface Place {
  boxCode?: string | null;
  xaafada?: string | null;
  locationNotes?: string | null;
}

/**
 * The string to search for.
 *
 * Box code first, because it is the most specific thing we hold and the thing
 * printed on the physical cabinet. Then the neighbourhood, because a box code is
 * only unique *within* the department's list, not within a city. `location_notes`
 * is deliberately excluded: it is written for colleagues ("Port 7 connector clip
 * loose"), and sending that to a map search produces noise, not a place.
 *
 * Returns `''` when there is nothing to search for — and callers must show no
 * link at all rather than a link that searches for an empty string.
 */
export function mapQuery(place: Place): string {
  const code = (place.boxCode ?? '').trim();
  const area = (place.xaafada ?? '').trim();

  if (!code && !area) return '';
  if (!code) return area;
  if (!area) return code;
  return `${code}, ${area}`;
}

export type MapProvider = 'google' | 'osm';

/**
 * A map **search** URL.
 *
 * Both providers take a free-text query and require no API key, no account and
 * no billing: opening the URL in a browser is the whole interaction. Nothing is
 * embedded, so there is no map tile quota to exceed and no cost that can start
 * running.
 *
 * Google Maps is the default because it is what people in Hargeisa already use
 * and it opens the installed app on a phone. OpenStreetMap is offered as the
 * alternative because it is fully open data and needs nothing from anybody.
 *
 * Returns `null` for an empty query — a link that searches for nothing is a
 * dead end dressed up as an action.
 */
export function mapSearchUrl(place: Place, provider: MapProvider = 'google'): string | null {
  const query = mapQuery(place);
  if (!query) return null;

  const encoded = encodeURIComponent(query);
  return provider === 'osm'
    ? `https://www.openstreetmap.org/search?query=${encoded}`
    : `https://www.google.com/maps/search/?api=1&query=${encoded}`;
}

/**
 * A `geo:` URI for the phone's own map app.
 *
 * `geo:0,0?q=` is a **search** in the installed maps application, not a pin at
 * 0,0 — the zero coordinate pair is the documented "search, do not navigate"
 * form. Android handles it directly and it works with no data connection if the
 * technician has offline maps, which is why it is offered alongside the web
 * link.
 *
 * Not offered as the only option: iOS ignores `geo:` in some browsers, so the
 * web link stays the default everywhere else.
 */
export function geoSearchUri(place: Place): string | null {
  const query = mapQuery(place);
  if (!query) return null;
  return `geo:0,0?q=${encodeURIComponent(query)}`;
}

/**
 * The address as a person would say it, for reading aloud on the phone or
 * pasting into any app the technician happens to have.
 *
 * Box code, neighbourhood, and — unlike the map query — the location notes,
 * because those are the "second gate on the left" details that actually get
 * someone to the right cabinet. That is the difference between a search field
 * and a colleague talking.
 */
export function spokenLocation(place: Place): string[] {
  const parts = [place.boxCode, place.xaafada, place.locationNotes]
    .map((value) => (value ?? '').trim())
    .filter((value) => value.length > 0);

  return parts;
}

/** Copy for the button and its warning. Shared so every screen says the same
 *  thing — a technician should not have to learn two footnotes. */
export const MAP_COPY = {
  label: { en: 'Find on map', so: 'Khariidad ku raadi' },
  note: {
    en: 'Opens a map search for the box name — not a saved pin.',
    so: 'Waxay furtaa raadinta khariidadda magaca sanduuqa — ma aha goob la keydiyay.',
  },
  noPlace: {
    en: 'No box or area recorded, so there is nothing to search for.',
    so: 'Sanduuq ama xaafad lama diiwaan gelin, marka waxba lama raadin karo.',
  },
} as const;
