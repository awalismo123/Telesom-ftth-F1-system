import test from 'node:test';
import assert from 'node:assert/strict';
import {
  blockerLabel,
  buildBoxCsv,
  buildCsv,
  buildJobsCsv,
  buildOpsMessage,
  buildTechCsv,
  dbmBand,
  dbmQuality,
  dbmTone,
  eventLabel,
  formatDbm,
  formatMinutes,
  healthMeta,
  isChronic,
  portUsage,
  timeAgoShort,
  type AnalyticsResponse,
} from '../src/lib/registry';

test('dBm bands follow the field rule (healthy −27 … −8)', () => {
  assert.equal(dbmBand(-21.5), 'healthy');
  assert.equal(dbmBand(-27), 'healthy');
  assert.equal(dbmBand(-8), 'healthy');
  assert.equal(dbmBand(-28), 'weak');
  assert.equal(dbmBand(-7.9), 'strong');
  assert.equal(dbmBand(null), 'none');
  assert.equal(formatDbm(-21.456), '-21.46 dBm');
  assert.equal(formatDbm(null), '—');
  assert.equal(dbmTone(-20), 'text-emerald-700');
  assert.equal(dbmTone(-30), 'text-amber-700');
});

test('port usage never divides by zero and respects damaged ports', () => {
  assert.deepEqual(portUsage({ total_ports: 8, ports_used: 6, ports_damaged: 2 }), {
    used: 6,
    usable: 6,
    percent: 100,
  });
  assert.deepEqual(portUsage({ total_ports: 8, ports_used: 2, ports_damaged: 0 }), {
    used: 2,
    usable: 8,
    percent: 25,
  });
  assert.deepEqual(portUsage({ total_ports: 8, ports_used: 0, ports_damaged: 8 }), {
    used: 0,
    usable: 1,
    percent: 0,
  });
});

test('a box is chronic from three faults', () => {
  assert.equal(isChronic({ faults_30d: 3 }), true);
  assert.equal(isChronic({ faults_30d: 2 }), false);
});

test('durations read naturally in both languages', () => {
  assert.equal(formatMinutes(45, 'en'), '45m');
  assert.equal(formatMinutes(120, 'en'), '2h');
  assert.equal(formatMinutes(95, 'en'), '1h 35m');
  assert.equal(formatMinutes(95, 'so'), '1 saac 35 daq');
});

test('dBm quality ignores unmeasurable readings', () => {
  assert.equal(dbmQuality({ healthy: 3, weak: 1, strong: 0, out: 0 }), 75);
  assert.equal(dbmQuality({ healthy: 0, weak: 0, strong: 0, out: 0 }), 0);
  assert.equal(dbmQuality({ healthy: 2, weak: 0, strong: 0, out: 5 }), 100);
});

test('CSV survives commas and quotes', () => {
  assert.equal(buildCsv([['a', 'b,c'], ['say "hi"', 3]]), 'a,"b,c"\r\n"say ""hi""",3');

  const jobCsv = buildJobsCsv([
    {
      completed_at: '2026-10-28T09:15:00Z',
      line_number: '575225',
      customer_name: 'AAMINA',
      worker: 'F1 - Crew A',
      cablebox: 'FAT48',
      port_number: 3,
      optical_dbm: -21.4,
      duration_seconds: 3600,
      blocker: null,
    },
  ]);
  const row = jobCsv.split('\r\n')[1].split(',');
  assert.equal(jobCsv.split('\r\n')[0].split(',').length, 10);
  assert.equal(row[0], '2026-10-28 09:15');
  assert.equal(row[6], '60');
  assert.equal(row[8], 'healthy');

  assert.equal(buildTechCsv([]).split('\r\n')[0].split(',').length, 8);
  assert.equal(buildBoxCsv([]).split('\r\n')[0].split(',').length, 9);
});

test('labels translate and fall back gracefully', () => {
  assert.equal(eventLabel('port_damaged', 'en'), 'Port damaged');
  assert.equal(eventLabel('cilada_fixed', 'so'), 'Cilad la hagaajiyay');
  assert.equal(eventLabel('mystery', 'en'), 'mystery');
  assert.equal(blockerLabel('fiber_break', 'so'), 'Fiilo go’ay');
  assert.equal(healthMeta('critical', 'en').label, 'Critical');
  assert.equal(healthMeta('healthy', 'so').label, 'Caafimaad');
});

test('time ago stays short enough for dense lists', () => {
  const now = Date.now();
  assert.equal(timeAgoShort(new Date(now - 5000).toISOString(), 'en'), 'just now');
  assert.equal(timeAgoShort(new Date(now - 12 * 60_000).toISOString(), 'en'), '12m ago');
  assert.equal(timeAgoShort(new Date(now - 3 * 86_400_000).toISOString(), 'en'), '3d ago');
  assert.equal(timeAgoShort(null, 'en'), 'no activity yet');
});

const analytics: AnalyticsResponse = {
  window_days: 30,
  totals: {
    completed: 36,
    urgent_completed: 5,
    repeat_faults: 0,
    avg_minutes: 68,
    avg_dbm: -21.72,
    open_now: 7,
    running_now: 1,
    blocked_now: 1,
    active_days: 20,
    demo_tasks: 36,
    bands: { healthy: 32, weak: 4, strong: 0, out: 0 },
  },
  daily: [{ date: '2026-10-28', completed: 2, avg_minutes: 60 }],
  techs: [
    {
      name: 'F1 - Crew A',
      completed: 18,
      urgent: 2,
      repeats: 0,
      avg_minutes: 68,
      avg_dbm: -20.79,
      running_now: 1,
      blocked_now: 1,
    },
  ],
  boxes: [
    {
      id: '1',
      box_code: 'FAT48',
      xaafada: 'Jigjigayar',
      health_status: 'critical',
      faults: 15,
      completed: 18,
      avg_dbm: -22.65,
      last_event_at: null,
      damaged_ports: 2,
      chronic: true,
    },
  ],
  blockers: [{ reason: 'fiber_break', count: 3 }],
  demo: { tasks: 36, logs: 36 },
  server_now: '2026-10-28T10:00:00Z',
};

test('the WhatsApp report is ready to paste', () => {
  const message = buildOpsMessage({
    analytics,
    groupCode: 'F1',
    lang: 'en',
    date: '2026-10-28',
  });

  assert.equal(message.split('\n')[0], '*TELESOM F1 — DAILY REPORT 28/10/2026*');
  assert.ok(message.includes('*Teams (30 days)*'));
  assert.ok(message.includes('FAT48'));
  assert.ok(message.includes('Fiber break — 3'));
  assert.ok(message.includes('Open: 7 · Running: 1 · Blocked: 1'));
});

test('the WhatsApp report speaks Somali too', () => {
  const message = buildOpsMessage({
    analytics,
    groupCode: 'F1',
    lang: 'so',
    date: '2026-10-28',
  });

  assert.equal(message.split('\n')[0], '*TELESOM F1 — WARBIXIN 28/10/2026*');
  assert.ok(message.includes('*Cablebox u baahan feejignaan*'));
  assert.ok(message.includes('% dBm caafimaad qaba'));
});
