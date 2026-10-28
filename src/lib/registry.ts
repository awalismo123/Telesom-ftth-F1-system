/**
 * Cablebox registry — types, labels and pure helpers.
 * Everything here is render-free so it can be unit-tested in isolation.
 */

export type HealthStatus = 'healthy' | 'warning' | 'critical';
export type PortStatus = 'free' | 'occupied' | 'damaged' | 'reserved' | 'unknown';
export type Lang = 'so' | 'en';

/* ------------------------------------------------------------------ */
/* Types — mirror the JSON returned by the RPCs in migration 006        */
/* ------------------------------------------------------------------ */

export interface DemoCount {
  tasks: number;
  logs: number;
}

export interface BoxSummary {
  id: string;
  box_code: string;
  xaafada: string | null;
  olt_path: string | null;
  total_ports: number;
  health_status: HealthStatus;
  damaged_ports: number[] | null;
  location_notes: string | null;
  fault_count: number;
  last_optical_dbm: number | null;
  ports_used: number;
  ports_damaged: number;
  open_jobs: number;
  running_jobs: number;
  completed_30d: number;
  faults_30d: number;
  avg_dbm_30d: number | null;
  last_event_at: string | null;
}

export interface DirectoryResponse {
  boxes: BoxSummary[];
  demo: DemoCount;
  server_now: string;
}

export interface BoxPort {
  port_number: number;
  status: PortStatus;
  line_number: string | null;
  customer_name: string | null;
  notes: string | null;
  updated_at: string | null;
  updated_by: string | null;
}

export interface BoxIncident {
  id: string;
  event_type: string;
  port_number: number | null;
  optical_dbm: number | null;
  notes: string | null;
  created_at: string;
  logged_by: string | null;
  line_number: string | null;
  is_demo: boolean;
}

export interface BoxJob {
  id: string;
  line_number: string;
  customer_name: string;
  task_type: string;
  status: string;
  port_number: number | null;
  optical_dbm: number | null;
  completed_at: string | null;
  duration_seconds: number;
  worker: string | null;
  is_demo: boolean;
}

export interface BoxStats {
  faults_30d: number;
  faults_all: number;
  completed_30d: number;
  avg_dbm_30d: number | null;
  last_dbm: number | null;
  avg_minutes: number;
  last_event_at: string | null;
}

export interface BoxDetail {
  box: BoxSummary;
  ports: BoxPort[];
  incidents: BoxIncident[];
  jobs: BoxJob[];
  stats: BoxStats;
  server_now: string;
}

export interface PortResult {
  box_id: string;
  port_number: number;
  status: PortStatus;
  damaged_ports: number[];
  health_status: HealthStatus;
  server_now: string;
}

export interface AnalyticsTotals {
  completed: number;
  urgent_completed: number;
  repeat_faults: number;
  avg_minutes: number;
  avg_dbm: number | null;
  open_now: number;
  running_now: number;
  blocked_now: number;
  active_days: number;
  demo_tasks: number;
  bands: { healthy: number; weak: number; strong: number; out: number };
}

export interface AnalyticsTech {
  name: string;
  completed: number;
  urgent: number;
  repeats: number;
  avg_minutes: number;
  avg_dbm: number | null;
  running_now: number;
  blocked_now: number;
}

export interface AnalyticsBox {
  id: string;
  box_code: string;
  xaafada: string | null;
  health_status: HealthStatus;
  faults: number;
  completed: number;
  avg_dbm: number | null;
  last_event_at: string | null;
  damaged_ports: number;
  chronic: boolean;
}

export interface AnalyticsDay {
  date: string;
  completed: number;
  avg_minutes: number;
}

export interface AnalyticsResponse {
  window_days: number;
  totals: AnalyticsTotals;
  daily: AnalyticsDay[];
  techs: AnalyticsTech[];
  boxes: AnalyticsBox[];
  blockers: { reason: string; count: number }[];
  demo: DemoCount;
  server_now: string;
}

/* ------------------------------------------------------------------ */
/* Labels                                                              */
/* ------------------------------------------------------------------ */

export const PORT_STATUS_META: Record<
  PortStatus,
  { en: string; so: string; tile: string; dot: string }
> = {
  free: {
    en: 'Free',
    so: 'Banaan',
    tile: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    dot: 'bg-emerald-500',
  },
  occupied: {
    en: 'In use',
    so: 'La isticmaalo',
    tile: 'bg-sky-50 border-sky-200 text-sky-800',
    dot: 'bg-sky-500',
  },
  damaged: {
    en: 'Damaged',
    so: 'Burbur',
    tile: 'bg-rose-50 border-rose-300 text-rose-800',
    dot: 'bg-rose-500',
  },
  reserved: {
    en: 'Reserved',
    so: 'Kaydsan',
    tile: 'bg-violet-50 border-violet-200 text-violet-800',
    dot: 'bg-violet-500',
  },
  unknown: {
    en: 'Not checked',
    so: 'Aan la hubin',
    tile: 'bg-slate-50 border-slate-200 text-slate-600',
    dot: 'bg-slate-300',
  },
};

export const EVENT_LABEL: Record<string, { en: string; so: string }> = {
  installation: { en: 'Installation completed', so: 'Galinta la dhammeeyay' },
  cilada_fixed: { en: 'Fault fixed', so: 'Cilad la hagaajiyay' },
  port_damaged: { en: 'Port damaged', so: 'Port burbursan' },
  box_full: { en: 'Box full', so: 'Sanduuq buuxa' },
  fiber_break: { en: 'Fiber break', so: 'Fiilo go\u2019ay' },
  inspection: { en: 'Inspection', so: 'Baaris' },
  note: { en: 'Note', so: 'Qoraal' },
};

export const BLOCKER_LABEL: Record<string, { en: string; so: string }> = {
  customer_unreachable: { en: 'Customer unreachable', so: 'Macmiil lama helin' },
  fiber_break: { en: 'Fiber break', so: 'Fiilo go\u2019ay' },
  box_full: { en: 'Box full', so: 'Sanduuq buuxa' },
  hardware_defective: { en: 'Hardware defective', so: 'Qalab xumaaday' },
  other: { en: 'Other', so: 'Kale' },
};

export function eventLabel(type: string, lang: Lang): string {
  const meta = EVENT_LABEL[type];
  if (!meta) return type;
  return lang === 'so' ? meta.so : meta.en;
}

export function blockerLabel(reason: string, lang: Lang): string {
  const meta = BLOCKER_LABEL[reason];
  if (!meta) return reason;
  return lang === 'so' ? meta.so : meta.en;
}

export function healthMeta(status: HealthStatus, lang: Lang) {
  if (status === 'critical') {
    return {
      label: lang === 'so' ? 'Halis' : 'Critical',
      chip: 'bg-rose-50 text-rose-700 border-rose-200',
      dot: 'bg-rose-500',
      text: 'text-rose-700',
    };
  }
  if (status === 'warning') {
    return {
      label: lang === 'so' ? 'Digniin' : 'Warning',
      chip: 'bg-amber-50 text-amber-800 border-amber-200',
      dot: 'bg-amber-500',
      text: 'text-amber-700',
    };
  }
  return {
    label: lang === 'so' ? 'Caafimaad' : 'Healthy',
    chip: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    dot: 'bg-emerald-500',
    text: 'text-emerald-700',
  };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** −27 … −8 dBm is the healthy window used across the app. */
export function dbmBand(dbm: number | null | undefined): 'healthy' | 'weak' | 'strong' | 'none' {
  if (dbm === null || dbm === undefined || Number.isNaN(dbm)) return 'none';
  if (dbm > -8) return 'strong';
  if (dbm < -27) return 'weak';
  return 'healthy';
}

export function formatDbm(dbm: number | null | undefined): string {
  if (dbm === null || dbm === undefined || Number.isNaN(dbm)) return '—';
  return `${Number(dbm).toFixed(2)} dBm`;
}

export function dbmTone(dbm: number | null | undefined): string {
  const band = dbmBand(dbm);
  if (band === 'healthy') return 'text-emerald-700';
  if (band === 'weak' || band === 'strong') return 'text-amber-700';
  return 'text-slate-400';
}

export function portUsage(box: { total_ports: number; ports_used: number; ports_damaged: number }) {
  const usable = Math.max(1, box.total_ports - box.ports_damaged);
  return {
    used: box.ports_used,
    usable,
    percent: Math.min(100, Math.round((box.ports_used / usable) * 100)),
  };
}

export function isChronic(box: { faults_30d: number }): boolean {
  return box.faults_30d >= 3;
}

/** "3 days ago" / "3 maalmood ka hor" — compact, for dense lists. */
export function timeAgoShort(iso: string | null, lang: Lang): string {
  if (!iso) return lang === 'so' ? 'weli ma jirin' : 'no activity yet';
  const diffMin = Math.floor((Date.now() - Date.parse(iso)) / 60000);
  if (!Number.isFinite(diffMin) || diffMin < 1) return lang === 'so' ? 'hadda' : 'just now';
  if (diffMin < 60) return lang === 'so' ? `${diffMin} daq` : `${diffMin}m ago`;
  const hours = Math.floor(diffMin / 60);
  if (hours < 24) return lang === 'so' ? `${hours} saac` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return lang === 'so' ? `${days} maalmood` : `${days}d ago`;
  const months = Math.floor(days / 30);
  return lang === 'so' ? `${months} bilood` : `${months}mo ago`;
}

export function formatMinutes(minutes: number | null | undefined, lang: Lang): string {
  const value = Math.max(0, Math.round(Number(minutes) || 0));
  if (value < 60) return lang === 'so' ? `${value} daq` : `${value}m`;
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  if (rest === 0) return lang === 'so' ? `${hours} saac` : `${hours}h`;
  return lang === 'so' ? `${hours} saac ${rest} daq` : `${hours}h ${rest}m`;
}

/** Percentage of jobs that landed inside the healthy dBm window. */
export function dbmQuality(bands: AnalyticsTotals['bands']): number {
  const total = bands.healthy + bands.weak + bands.strong;
  if (total === 0) return 0;
  return Math.round((bands.healthy / total) * 100);
}

/* ------------------------------------------------------------------ */
/* Exports — CSV for the office, WhatsApp text for the group chat      */
/* ------------------------------------------------------------------ */

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  if (/[",\n;]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function buildCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

/** Daily work report: one row per completed job in the window. */
export function buildJobsCsv(
  jobs: { completed_at: string | null; line_number: string; customer_name: string; worker: string | null; cablebox?: string | null; port_number: number | null; optical_dbm: number | null; duration_seconds: number; blocker?: string | null }[],
): string {
  const header = [
    'Date',
    'Line',
    'Customer',
    'Cablebox',
    'Port',
    'Worker',
    'Duration (min)',
    'Optical dBm',
    'Band',
    'Blocker',
  ];
  const rows = jobs.map((job) => [
    job.completed_at ? job.completed_at.slice(0, 16).replace('T', ' ') : '',
    job.line_number,
    job.customer_name,
    job.cablebox ?? '',
    job.port_number ?? '',
    job.worker ?? '',
    Math.round((job.duration_seconds || 0) / 60),
    job.optical_dbm ?? '',
    dbmBand(job.optical_dbm),
    job.blocker ?? '',
  ]);
  return buildCsv([header, ...rows]);
}

export function buildTechCsv(techs: AnalyticsTech[]): string {
  const header = ['Team / technician', 'Completed', 'Urgent', 'Repeat visits', 'Avg minutes', 'Avg dBm', 'Running now', 'Blocked now'];
  const rows = techs.map((tech) => [
    tech.name,
    tech.completed,
    tech.urgent,
    tech.repeats,
    tech.avg_minutes,
    tech.avg_dbm ?? '',
    tech.running_now,
    tech.blocked_now,
  ]);
  return buildCsv([header, ...rows]);
}

export function buildBoxCsv(boxes: AnalyticsBox[]): string {
  const header = ['Cablebox', 'Xaafada', 'Health', 'Faults (window)', 'Completed (window)', 'Avg dBm', 'Damaged ports', 'Chronic', 'Last event'];
  const rows = boxes.map((box) => [
    box.box_code,
    box.xaafada ?? '',
    box.health_status,
    box.faults,
    box.completed,
    box.avg_dbm ?? '',
    box.damaged_ports,
    box.chronic ? 'yes' : 'no',
    box.last_event_at ? box.last_event_at.slice(0, 16).replace('T', ' ') : '',
  ]);
  return buildCsv([header, ...rows]);
}

/** The message the supervisor drops into the group chat. */
export function buildOpsMessage(params: {
  analytics: AnalyticsResponse;
  groupCode: string;
  lang: Lang;
  date?: string;
}): string {
  const { analytics, groupCode, lang } = params;
  const so = lang === 'so';
  const date = params.date ?? new Date().toISOString().slice(0, 10);
  const [y, m, d] = date.split('-');
  const t = analytics.totals;
  const lines: string[] = [];

  lines.push(`*TELESOM ${groupCode} — ${so ? 'WARBIXIN' : 'DAILY REPORT'} ${d}/${m}/${y}*`);
  lines.push(
    so
      ? `${t.completed} shaqo la dhammeeyay · celcelis ${formatMinutes(t.avg_minutes, lang)} · ${dbmQuality(t.bands)}% dBm caafimaad qaba`
      : `${t.completed} jobs completed · avg ${formatMinutes(t.avg_minutes, lang)} · ${dbmQuality(t.bands)}% healthy dBm`,
  );

  if (analytics.techs.length > 0) {
    lines.push('');
    lines.push(so ? `*Shaqaalaha (${analytics.window_days} maalmood)*` : `*Teams (${analytics.window_days} days)*`);
    for (const tech of analytics.techs.slice(0, 6)) {
      lines.push(
        `• ${tech.name} — ${tech.completed} ${so ? 'shaqo' : 'jobs'} · ${formatMinutes(tech.avg_minutes, lang)}${
          tech.urgent > 0 ? ` · ${tech.urgent} ${so ? 'degdeg' : 'urgent'}` : ''
        }`,
      );
    }
  }

  const chronic = analytics.boxes.filter((box) => box.chronic || box.damaged_ports > 0);
  if (chronic.length > 0) {
    lines.push('');
    lines.push(so ? '*Cablebox u baahan feejignaan*' : '*Cableboxes needing attention*');
    for (const box of chronic.slice(0, 5)) {
      const bits = [`${box.faults} ${so ? 'cilad' : 'faults'}`];
      if (box.damaged_ports > 0) bits.push(`${box.damaged_ports} port ${so ? 'burbur' : 'damaged'}`);
      if (box.avg_dbm !== null) bits.push(formatDbm(box.avg_dbm));
      lines.push(`• ${box.box_code}${box.xaafada ? ` (${box.xaafada})` : ''} — ${bits.join(' · ')}`);
    }
  }

  if (analytics.blockers.length > 0) {
    lines.push('');
    lines.push(so ? '*Caqabadaha ugu badan*' : '*Top blockers*');
    for (const blocker of analytics.blockers.slice(0, 4)) {
      lines.push(`• ${blockerLabel(blocker.reason, lang)} — ${blocker.count}`);
    }
  }

  lines.push('');
  lines.push(
    so
      ? `Furan: ${t.open_now} · Socda: ${t.running_now} · Caqabad: ${t.blocked_now}`
      : `Open: ${t.open_now} · Running: ${t.running_now} · Blocked: ${t.blocked_now}`,
  );

  return lines.join('\n');
}

/** Browser-only: save a CSV without a server round-trip. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
