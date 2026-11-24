import { fetchActivity } from './reads';
import { fetchDispatchLoad, fetchDispatchTasks, type DispatchLoad } from './dispatchService';
import { fetchGroupOverview, fetchTodaySummary } from './reads';
import type { ActivityEvent } from './activity';
import type { Cablebox, Crew, Task, UserProfile } from '../types/database';
import type { CrewLink } from './reads';
import type { TodaySummary } from './today';

/**
 * Everything the command page reads, in one round trip.
 *
 * ## Why one call and not five
 *
 * The page is opened at the start of a shift, on a phone, on a mobile network.
 * Five sequential requests is five round trips before a supervisor can see
 * whether anybody is stuck, and the slowest one decides when the page appears.
 * They are independent, so they go out together.
 *
 * ## Why the failure is reported per-part
 *
 * The old landing screen wrapped its whole load in `catch {}`. A failed request
 * left the page showing **zeros**, which is not an empty day — it is a claim
 * that nothing is wrong. `partial` names which parts did not arrive so the
 * screen can say "the crew list could not be loaded" instead of inventing one.
 * A page that quietly reports zero blocked jobs during an outage is the exact
 * failure mode the department asked to be rid of.
 */

export interface OverviewData {
  today: TodaySummary | null;
  tasks: Task[];
  load: DispatchLoad;
  events: ActivityEvent[];
  members: UserProfile[];
  crews: Crew[];
  crewMembers: CrewLink[];
  cableboxes: Cablebox[];
}

export type OverviewPart = keyof Omit<OverviewData, never>;

export interface OverviewResult {
  data: OverviewData;
  /** Parts that failed to load. Empty means everything arrived. */
  partial: OverviewPart[];
}

export const EMPTY_OVERVIEW: OverviewData = {
  today: null,
  tasks: [],
  load: { users: [], crews: [] },
  events: [],
  members: [],
  crews: [],
  crewMembers: [],
  cableboxes: [],
};

/**
 * Load the whole page.
 *
 * Each source is settled independently: one failure must not blank the other
 * four, and it must not be mistaken for a zero.
 */
export async function fetchOverview(params: {
  token: string;
  groupId: string;
  day: string;
  eventsDays?: number;
}): Promise<OverviewResult> {
  /**
   * Thirty days, not seven.
   *
   * The chart only draws seven, but the feed is read from the same response and
   * a week of silence would otherwise leave no way to say *when* the department
   * last moved — which is the difference between a quiet week and a broken feed.
   * Same single call, same row cap.
   */
  const { token, groupId, day, eventsDays = 30 } = params;

  const [today, tasks, load, events, overview] = await Promise.allSettled([
    fetchTodaySummary(token, groupId, day),
    fetchDispatchTasks(token, groupId),
    fetchDispatchLoad(token, groupId),
    fetchActivity(token, groupId, eventsDays, 200),
    fetchGroupOverview(token, groupId),
  ]);

  const partial: OverviewPart[] = [];
  const data: OverviewData = { ...EMPTY_OVERVIEW };

  if (today.status === 'fulfilled') data.today = today.value;
  else partial.push('today');

  if (tasks.status === 'fulfilled') data.tasks = tasks.value;
  else partial.push('tasks');

  if (load.status === 'fulfilled') data.load = load.value;
  else partial.push('load');

  if (events.status === 'fulfilled') data.events = events.value;
  else partial.push('events');

  if (overview.status === 'fulfilled') {
    data.members = overview.value.members;
    data.crews = overview.value.crews;
    data.crewMembers = overview.value.crew_members;
    data.cableboxes = overview.value.cableboxes;
  } else {
    partial.push('members');
  }

  return { data, partial };
}

/**
 * How many sources the page loads.
 *
 * The page compares `partial.length` against this to tell "some panels are
 * stale" from "nothing arrived". A hard-coded 4 sat here first and was wrong the
 * moment a source was added — the count belongs beside the requests.
 */
export const OVERVIEW_SOURCE_COUNT = 5;

/** True when nothing at all arrived, so the page must not pose as merely stale. */
export function nothingLoaded(partial: readonly OverviewPart[]): boolean {
  return partial.length >= OVERVIEW_SOURCE_COUNT;
}

/** Human names for the parts, so a failure can be described without a code. */
export function partLabel(part: OverviewPart, lang: 'en' | 'so'): string {
  const so = lang === 'so';
  const labels: Record<OverviewPart, { en: string; so: string }> = {
    today: { en: "today's counts", so: 'tirooyinka maanta' },
    tasks: { en: 'the open jobs', so: 'shaqooyinka furan' },
    load: { en: 'the crew list', so: 'liiska shaqaalaha' },
    events: { en: 'the activity feed', so: 'dhacdooyinka' },
    members: { en: 'the team roster', so: 'liiska xubnaha' },
    crews: { en: 'the crews', so: 'kooxaha' },
    crewMembers: { en: 'crew membership', so: 'xubnaha kooxaha' },
    cableboxes: { en: 'the cable boxes', so: 'sanduuqyada' },
  };
  return labels[part][so ? 'so' : 'en'];
}

/**
 * The sentence shown when something did not arrive.
 *
 * Names the parts. "Could not load" alone leaves a supervisor refreshing a page
 * that is 80% working and concluding the whole system is down.
 */
export function partialNotice(parts: readonly OverviewPart[], lang: 'en' | 'so'): string | null {
  if (parts.length === 0) return null;
  const so = lang === 'so';
  const names = parts.map((part) => partLabel(part, lang)).join(so ? ', ' : ', ');

  return so
    ? `${names} lama soo qaadin. Qaybaha kale way shaqaynayaan.`
    : `Could not load ${names}. Everything else is still working.`;
}
