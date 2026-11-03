import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DAY_MS = 86_400_000;
export const METRIC_KEYS = ['requests', 'input', 'cacheRead', 'cacheWrite', 'output', 'cost', 'durationMs'];

export function localDate(time) {
  const date = new Date(time);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

const byTime = (a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0);

function rowKey({ date, source, model, version }) {
  return [date, source, model, version].join('|');
}

function getOrCreateRow(rows, identity) {
  const key = rowKey(identity);
  let row = rows.get(key);
  if (!row) {
    row = { ...identity, ...Object.fromEntries(METRIC_KEYS.map(metric => [metric, 0])) };
    rows.set(key, row);
  }
  return row;
}

function addEventToRows(rows, event) {
  const row = getOrCreateRow(rows, {
    date: localDate(event.time),
    source: event.source,
    model: event.model,
    version: event.version,
  });
  row.requests += 1;
  for (const metric of METRIC_KEYS.slice(1)) row[metric] += event[metric];
}

function addRowToRows(rows, source) {
  const row = getOrCreateRow(rows, {
    date: source.date,
    source: source.source,
    model: source.model,
    version: source.version,
  });
  for (const metric of METRIC_KEYS) row[metric] += Number(source[metric]) || 0;
}

function readJsonLines(file) {
  if (!existsSync(file)) return [];
  const items = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      items.push(JSON.parse(line));
    } catch {
      continue;
    }
  }
  return items;
}

function readJson(file, fallback) {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeAtomic(file, content) {
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, content);
  renameSync(temporary, file);
}

export class Store {
  #eventsFile;
  #dailyFile;
  #dir;
  #retentionDays;
  #maxRawEvents;
  #now;
  #events = [];
  #compacted = new Map();
  #totals = new Map();

  constructor({ dir, retentionDays = 7, maxRawEvents = 100_000, now = Date.now }) {
    this.#dir = dir;
    this.#eventsFile = join(dir, 'events.jsonl');
    this.#dailyFile = join(dir, 'daily.json');
    this.#retentionDays = retentionDays;
    this.#maxRawEvents = maxRawEvents;
    this.#now = now;
  }

  load() {
    mkdirSync(this.#dir, { recursive: true });
    this.#events = readJsonLines(this.#eventsFile).sort(byTime);
    this.#compacted = new Map();
    for (const row of readJson(this.#dailyFile, [])) addRowToRows(this.#compacted, row);
    this.#totals = new Map();
    for (const row of this.#compacted.values()) addRowToRows(this.#totals, row);
    for (const event of this.#events) addEventToRows(this.#totals, event);
  }

  add(events) {
    if (events.length === 0) return;
    appendFileSync(this.#eventsFile, events.map(event => `${JSON.stringify(event)}\n`).join(''));
    const previousLast = this.#events.at(-1);
    this.#events.push(...events);
    if (previousLast && events.some(event => event.time < previousLast.time)) this.#events.sort(byTime);
    for (const event of events) addEventToRows(this.#totals, event);
    if (this.#events.length > this.#maxRawEvents) this.#compactOverflow();
  }

  enforceRetention() {
    const cutoff = new Date(this.#now() - this.#retentionDays * DAY_MS).toISOString();
    return this.#compactBefore(cutoff) + this.#compactOverflow();
  }

  compactAll() {
    return this.#compactBefore(null);
  }

  summary({ recentLimit = 50 } = {}) {
    return {
      rows: [...this.#totals.values()],
      recent: this.#events.slice(-recentLimit).reverse(),
      storage: {
        rawEvents: this.#events.length,
        oldestRaw: this.#events[0]?.time ?? null,
        compactedRows: this.#compacted.size,
        retentionDays: this.#retentionDays,
        maxRawEvents: this.#maxRawEvents,
      },
    };
  }

  #compactOverflow() {
    if (this.#events.length <= this.#maxRawEvents) return 0;
    const overflow = this.#events.length - this.#maxRawEvents;
    return this.#compactOldest(overflow);
  }

  #compactBefore(cutoff) {
    const count = cutoff === null ? this.#events.length : this.#events.findIndex(event => event.time >= cutoff);
    return this.#compactOldest(count === -1 ? this.#events.length : count);
  }

  #compactOldest(count) {
    if (count <= 0) return 0;
    const old = this.#events.slice(0, count);
    const kept = this.#events.slice(count);
    for (const event of old) addEventToRows(this.#compacted, event);
    writeAtomic(this.#dailyFile, JSON.stringify([...this.#compacted.values()]));
    writeAtomic(this.#eventsFile, kept.map(event => `${JSON.stringify(event)}\n`).join(''));
    this.#events = kept;
    return old.length;
  }
}
