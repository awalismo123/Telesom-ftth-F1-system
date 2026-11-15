/**
 * What a crew is.
 *
 * One or two people in one vehicle. The second member is called a partner, the
 * job timer is shared between them, and the dispatch board treats a crew as a
 * single unit of capacity.
 *
 * Nothing enforced any of that until migration 023. Measured on the live
 * project on 15/11/2026: both active crews had zero members; earlier the same
 * day one had three. Both states are impossible under the model and neither
 * was impossible in the schema.
 *
 * The rule lives here rather than inline in the screen so the UI, the tests and
 * the database can be checked against one definition. The database is still the
 * authority — `enforce_crew_size()` and `upsert_crew()` reject the write — but a
 * supervisor should never reach the database to find out.
 */

/** The most people a crew can hold. A two-person vehicle. */
export const CREW_MAX_MEMBERS = 2;

/** The fewest people an *active* crew can hold. An inactive crew may hold zero. */
export const CREW_MIN_MEMBERS = 1;

export type CrewSizeProblem = 'empty-active' | 'too-many';

export interface CrewSizeCheck {
  ok: boolean;
  problem: CrewSizeProblem | null;
  /** Ready to put in front of a supervisor, in their language. */
  message: { en: string; so: string } | null;
}

export function crewSizeProblem(memberCount: number, isActive: boolean): CrewSizeProblem | null {
  if (memberCount > CREW_MAX_MEMBERS) return 'too-many';
  // An inactive crew with nobody in it is how a crew is retired. It is not an
  // error, and it must not be blocked, or a supervisor cannot put a vehicle
  // out of service without deleting its history.
  if (isActive && memberCount < CREW_MIN_MEMBERS) return 'empty-active';
  return null;
}

const MESSAGES: Record<CrewSizeProblem, { en: string; so: string }> = {
  'too-many': {
    en: 'A crew is one or two people. Remove someone before adding another.',
    so: 'Kooxdu waa hal ama laba qof. Ka saar qof ka hor inta aadan mid kale ku darin.',
  },
  'empty-active': {
    en: 'An active crew needs at least one member. Add a technician, or mark the crew inactive.',
    so: 'Koox firfircoon waa in ay leedahay ugu yaraan hal xubin. Ku dar farsamayaqaan, ama ka dhig mid aan firfircoonayn.',
  },
};

export function checkCrewSize(memberCount: number, isActive: boolean): CrewSizeCheck {
  const problem = crewSizeProblem(memberCount, isActive);
  return {
    ok: problem === null,
    problem,
    message: problem ? MESSAGES[problem] : null,
  };
}

/**
 * A crew that cannot be dispatched, with the reason.
 *
 * Used by the today panel and the dispatch board so an empty crew is reported
 * rather than counted as capacity. Deliberately not an error state: it is a
 * roster that needs ten seconds of a supervisor's attention.
 */
export function isDispatchable(memberCount: number, isActive: boolean): boolean {
  return isActive && memberCount >= CREW_MIN_MEMBERS;
}
