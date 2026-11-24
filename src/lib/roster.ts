/**
 * Whether somebody can be taken off duty, and what has to happen to their work.
 *
 * ## The hole this closes
 *
 * `upsert_team_member` and `upsert_crew` set `is_active = false` and check
 * nothing else. `dispatch_load` — which builds the board's lanes — filters on
 * `is_active = true`. So deactivating a person or a crew does not just take them
 * off the roster: it takes their **open jobs off the board entirely**. Those jobs
 * stay `assigned` in the database, stay counted by `today_summary` as work in
 * someone's hands, and appear on no lane, so no supervisor can see that they need
 * reassigning.
 *
 * Measured on the live project on 24/11/2026, in rolled-back transactions:
 * deactivating a technician holding 2 open jobs succeeded silently, and so did
 * retiring a crew holding 2. Neither produced an error and neither said anything.
 *
 * That is the same failure the whole app is built to avoid — work that exists but
 * cannot be seen — so it is refused rather than warned about.
 *
 * ## Why refusing, and not "deactivate and reassign for me"
 *
 * Reassignment needs a destination, and the person doing it is standing on the
 * team screen looking at a list, not at a map or a shift. Choosing *who* inherits
 * two faults is a dispatch decision with a cost attached; guessing it here would
 * be the interface inventing an answer to a question only the supervisor can
 * answer. So the rule is: move the work first, then retire the person. The
 * message says exactly that and names the jobs.
 */

/** One job standing between somebody and going off duty. */
export interface HeldJob {
  id: string;
  line_number: string;
  customer_name: string;
  status: string;
}

export type RetirementProblem = 'open-jobs' | 'active-job';

export interface RetirementCheck {
  ok: boolean;
  problem: RetirementProblem | null;
  /** Jobs that must be moved first. Empty when `ok`. */
  jobs: HeldJob[];
  /** A sentence in both languages, or `null` when `ok`. */
  message: { en: string; so: string } | null;
}

/**
 * What stops this person or crew from being made inactive.
 *
 * `jobs` must be the jobs **assigned to them and still open** — `assigned`,
 * `in_progress` or `blocked`. A job in progress is called out separately because
 * it is worse: somebody is standing at a customer's house, and the record of
 * their work is about to stop being visible.
 */
export function retirementProblem(jobs: readonly HeldJob[], hasActiveJob?: boolean): RetirementCheck {
  if (jobs.length === 0) {
    return { ok: true, problem: null, jobs: [], message: null };
  }

  const inProgress =
    hasActiveJob ?? jobs.some((job) => job.status === 'in_progress' || job.status === 'blocked');

  if (inProgress) {
    return {
      ok: false,
      problem: 'active-job',
      jobs: [...jobs],
      message: {
        en: 'This job is being worked on right now. It cannot be taken off the board while somebody is at the customer.',
        so: 'Shaqadan hadda waa la shaqeynayaa. Lama qaadi karo shaashadda inta qof macmiilka joogo.',
      },
    };
  }

  const n = jobs.length;
  return {
    ok: false,
    problem: 'open-jobs',
    jobs: [...jobs],
    message: {
      en:
        n === 1
          ? 'One job is still assigned here. Move it to somebody else, then take this off duty.'
          : `${n} jobs are still assigned here. Move them to somebody else, then take this off duty.`,
      so:
        n === 1
          ? 'Hal shaqo ayaa weli halkan loo qoondeeyay. U rar qof kale, ka dibna hawada ka saar.'
          : `${n} shaqo ayaa weli halkan loo qoondeeyay. U rar qof kale, ka dibna hawada ka saar.`,
    },
  };
}

/**
 * The same check applied to a whole crew.
 *
 * A crew holds work directly (`tasks.assigned_crew_id`), so it has its own jobs
 * independent of its members'. Both have to be clear, or retiring the crew hides
 * them just as effectively as retiring a person does.
 */
export function crewRetirementProblem(jobs: readonly HeldJob[]): RetirementCheck {
  return retirementProblem(jobs);
}

/**
 * A one-line summary of held work for the roster: "2 open · 1 in progress".
 *
 * Returns `null` for somebody with nothing open, so the caller can omit the line
 * entirely rather than print a zero. A roster where every card says "0 jobs" is
 * a roster nobody reads.
 */
export function workloadLine(
  openJobs: number,
  activeJobs: number,
  lang: 'en' | 'so',
): string | null {
  if (openJobs <= 0) return null;

  const open = lang === 'so' ? `${openJobs} furan` : `${openJobs} open`;
  if (activeJobs <= 0) return open;

  const active = lang === 'so' ? `${activeJobs} socda` : `${activeJobs} in progress`;
  return `${open} · ${active}`;
}

/**
 * Where does a person's capacity actually sit?
 *
 * `dispatch_load` builds its lanes from crews **and** from individual
 * technicians, and `assign_tasks` accepts either. So a two-person crew and each
 * of its two members all appear as targets. None of the three is wrong, but a
 * supervisor reading "6 targets" for a team of 4 technicians in 2 crews is being
 * told the department has 6 units of capacity, which it does not.
 *
 * The roster says the true number next to the reassuring one.
 */
export function capacitySentence(
  crewsWithMembers: number,
  loneTechnicians: number,
  lang: 'en' | 'so',
): string {
  const units = crewsWithMembers + loneTechnicians;

  if (lang === 'so') {
    const crewPart = `${crewsWithMembers} koox${crewsWithMembers === 1 ? '' : 'o'}`;
    const lonePart =
      loneTechnicians > 0 ? ` iyo ${loneTechnicians} farsamayaqaan keligood ah` : '';
    return `${crewPart}${lonePart} ayaa diyaar ah — ${units} shaqo-ballaarineed oo dhab ah.`;
  }

  const crewPart = `${crewsWithMembers} crew${crewsWithMembers === 1 ? '' : 's'}`;
  const lonePart =
    loneTechnicians > 0 ? ` and ${loneTechnicians} lone technician${loneTechnicians === 1 ? '' : 's'}` : '';
  return `${crewPart}${lonePart} — ${units} real unit${units === 1 ? '' : 's'} of capacity.`;
}

/**
 * The line numbers of the jobs blocking a retirement, for the message.
 *
 * A refusal that says "2 jobs" but not which ones leaves the supervisor hunting
 * through the board for them. Capped at five: past that the list stops being a
 * set of instructions and becomes a wall of numbers, and the count is the useful
 * part.
 */
export function lineNumbersOf(jobs: readonly HeldJob[]): string {
  if (jobs.length === 0) return '';
  const shown = jobs.slice(0, 5).map((job) => job.line_number);
  const rest = jobs.length - shown.length;
  return rest > 0 ? `${shown.join(', ')} +${rest}` : shown.join(', ');
}

/**
 * How many real units of capacity the roster has.
 *
 * The board builds a lane for every active crew **and** every active technician,
 * because `assign_tasks` accepts either. So two crews of two produce six lanes,
 * and a supervisor reading six lanes plans a shift as if the department had six
 * units. It has two.
 *
 * A technician counts only when they are in **no active crew** — somebody inside
 * a crew is capacity that the crew already accounts for, and counting them again
 * is what produced the inflated number.
 */
export function capacityCounts(
  crews: readonly { id: string; is_active: boolean }[],
  technicians: readonly { id: string; is_active: boolean }[],
  links: readonly { crew_id: string; user_id: string }[],
): { crewsWithMembers: number; loneTechnicians: number } {
  const activeCrewIds = new Set(crews.filter((crew) => crew.is_active).map((crew) => crew.id));

  const crewsWithMembers = [...activeCrewIds].filter((crewId) =>
    links.some((link) => link.crew_id === crewId),
  ).length;

  const loneTechnicians = technicians.filter(
    (tech) =>
      tech.is_active &&
      !links.some((link) => link.user_id === tech.id && activeCrewIds.has(link.crew_id)),
  ).length;

  return { crewsWithMembers, loneTechnicians };
}

/**
 * Can these people staff an active crew?
 *
 * ## The hole
 *
 * `upsert_crew` caps a crew at two and refuses an empty *active* crew. It says
 * nothing about whether the members are actually on duty. So somebody who is
 * inactive can be put into a crew that is saved as active: the roster shows a
 * staffed vehicle, `dispatch_load` lists it as capacity, and half of it cannot
 * take a job. Measured live on 24/11/2026 — the save succeeded.
 *
 * An inactive crew may hold inactive people: that is what retiring a crew and
 * its roster together looks like, and refusing it would make retirement
 * impossible in the right order.
 */
export function inactiveMembersInActiveCrew(
  activeCrew: boolean,
  members: readonly { id: string; full_name: string; is_active: boolean }[],
): { en: string; so: string } | null {
  if (!activeCrew) return null;

  const off = members.filter((member) => !member.is_active);
  if (off.length === 0) return null;

  const names = off.map((member) => member.full_name).join(', ');
  return {
    en: `${names} ${off.length === 1 ? 'is' : 'are'} off duty and cannot be put in an active crew. Re-activate them first, or save the crew as inactive.`,
    so: `${names} ${off.length === 1 ? 'waa' : 'waa'} fasax laga joogo, lagamana dari karo koox firfircoon. Marka hore dib u hawlgeliso, ama kooxda ka dhig mid aan firfircoonayn.`,
  };
}
