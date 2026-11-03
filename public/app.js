const SETTINGS_KEY = 'cc-telemetry-viewer:settings';
const DAY_MS = 86_400_000;
const DEFAULT_SETTINGS = {
  panels: { overview: true, breakdown: true, daily: true, latest: true },
  groupBy: 'source',
  range: '7',
  refreshSeconds: 3,
  sort: {},
};
const GROUP_LABELS = { source: 'request type', model: 'model', version: 'Claude Code version', date: 'day' };
const METRIC_KEYS = ['requests', 'input', 'cacheRead', 'cacheWrite', 'output', 'cost', 'durationMs'];

const $ = id => document.getElementById(id);
const formatNumber = value => Math.round(value).toLocaleString();
const formatCost = value => `$${value.toFixed(value < 1 ? 4 : 2)}`;
const formatSeconds = ms => `${(ms / 1000).toFixed(1)}s`;
const totalTokens = row => row.input + row.cacheRead + row.cacheWrite + row.output;
const SORT_VALUES = {
  avgTime: row => (row.requests ? row.durationMs / row.requests : 0),
  tokens: totalTokens,
  share: row => row.cost,
};

let settings = loadSettings();
let refreshTimer;
let seenRecent = new Set();
let lastSummary;
const filters = { source: '', model: '' };

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      panels: { ...DEFAULT_SETTINGS.panels, ...saved.panels },
      sort: { ...saved.sort },
    };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function localDate(time) {
  const date = new Date(time);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function rowsInRange(rows) {
  if (settings.range === 'all') return rows;
  const cutoff = localDate(Date.now() - (Number(settings.range) - 1) * DAY_MS);
  return rows.filter(row => row.date >= cutoff);
}

function matchesFilters(row) {
  return row.source.toLowerCase().includes(filters.source) && row.model.toLowerCase().includes(filters.model);
}

function isFiltered() {
  return Boolean(filters.source || filters.model);
}

// Applies the user's column sort, if any. Without one, the list keeps its default order.
function applySort(list, table) {
  const sort = settings.sort[table];
  if (!sort) return list;
  const value = SORT_VALUES[sort.key] ?? (row => row[sort.key]);
  const direction = sort.dir === 'asc' ? 1 : -1;
  return list.sort((a, b) => (value(a) - value(b)) * direction);
}

function sumRows(rows) {
  const total = Object.fromEntries(METRIC_KEYS.map(metric => [metric, 0]));
  for (const row of rows) for (const metric of METRIC_KEYS) total[metric] += row[metric];
  return total;
}

function groupRows(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row[key])) groups.set(row[key], []);
    groups.get(row[key]).push(row);
  }
  return [...groups].map(([name, list]) => ({ name, ...sumRows(list) }));
}

function tableRow(cells, className = '') {
  const tr = document.createElement('tr');
  tr.className = className;
  for (const cell of cells) {
    const td = document.createElement('td');
    if (cell instanceof Node) td.append(cell);
    else td.textContent = cell;
    tr.append(td);
  }
  return tr;
}

function emptyRow(columns, message) {
  const tr = document.createElement('tr');
  tr.className = 'empty';
  const td = document.createElement('td');
  td.colSpan = columns;
  td.textContent = message;
  tr.append(td);
  return tr;
}

function bar(percent) {
  const span = document.createElement('span');
  span.className = 'bar';
  span.style.width = `${Math.max(1, percent * 1.5)}px`;
  return span;
}

function card(label, value) {
  const element = document.createElement('div');
  element.className = 'card';
  const labelElement = document.createElement('div');
  labelElement.className = 'label';
  labelElement.textContent = label;
  const valueElement = document.createElement('div');
  valueElement.className = 'value';
  valueElement.textContent = value;
  element.append(labelElement, valueElement);
  return element;
}

function renderOverview(total) {
  $('cards').replaceChildren(
    card('Cost', formatCost(total.cost)),
    card('Requests', formatNumber(total.requests)),
    card('Tokens', formatNumber(totalTokens(total))),
    card('Output tokens', formatNumber(total.output)),
    card('Avg request time', total.requests ? formatSeconds(total.durationMs / total.requests) : '—'),
  );
}

function renderBreakdown(rows, total) {
  $('group-label').textContent = GROUP_LABELS[settings.groupBy];
  const groups = groupRows(rows, settings.groupBy);
  if (settings.groupBy === 'date') groups.sort((a, b) => b.name.localeCompare(a.name));
  else groups.sort((a, b) => b.cost - a.cost);
  applySort(groups, 'breakdown');

  if (groups.length === 0) {
    $('breakdown-body').replaceChildren(emptyRow(10, isFiltered() ? 'No requests match the filter' : 'No requests in this range yet'));
    return;
  }

  const body = groups.map(group => {
    const share = total.cost ? (group.cost / total.cost) * 100 : 0;
    return tableRow([
      group.name,
      formatNumber(group.requests),
      formatNumber(group.input),
      formatNumber(group.cacheRead),
      formatNumber(group.cacheWrite),
      formatNumber(group.output),
      formatCost(group.cost),
      formatSeconds(group.durationMs / group.requests),
      `${share.toFixed(0)}%`,
      bar(share),
    ]);
  });
  body.push(tableRow([
    'Total',
    formatNumber(total.requests),
    formatNumber(total.input),
    formatNumber(total.cacheRead),
    formatNumber(total.cacheWrite),
    formatNumber(total.output),
    formatCost(total.cost),
    formatSeconds(total.durationMs / total.requests),
    '',
    '',
  ], 'total'));
  $('breakdown-body').replaceChildren(...body);
}

function renderDaily(rows) {
  const days = applySort(groupRows(rows, 'date').sort((a, b) => b.name.localeCompare(a.name)), 'daily');
  if (days.length === 0) {
    $('daily-body').replaceChildren(emptyRow(6, isFiltered() ? 'No requests match the filter' : 'No history yet'));
    return;
  }
  $('daily-body').replaceChildren(...days.map(day => tableRow([
    day.name,
    formatNumber(day.requests),
    formatNumber(totalTokens(day)),
    formatNumber(day.output),
    formatCost(day.cost),
    formatSeconds(day.durationMs),
  ])));
}

function recentKey(request) {
  return `${request.time}|${request.source}|${request.cost}`;
}

function renderLatest(allRecent) {
  // Track "seen" on the unfiltered list, so changing the filter doesn't flash old rows as new.
  const isFirstRender = seenRecent.size === 0;
  const previouslySeen = seenRecent;
  seenRecent = new Set(allRecent.map(recentKey));
  const recent = applySort(allRecent.filter(matchesFilters), 'latest');
  if (recent.length === 0) {
    const message = isFiltered() && allRecent.length
      ? 'No requests match the filter'
      : 'No detailed logs. New requests appear here as Claude Code sends them';
    $('latest-body').replaceChildren(emptyRow(9, message));
    return;
  }
  $('latest-body').replaceChildren(...recent.map(request => tableRow([
    new Date(request.time).toLocaleTimeString(),
    request.source,
    request.model,
    formatNumber(request.input),
    formatNumber(request.cacheRead),
    formatNumber(request.cacheWrite),
    formatNumber(request.output),
    formatCost(request.cost),
    formatSeconds(request.durationMs),
  ], !isFirstRender && !previouslySeen.has(recentKey(request)) ? 'new' : '')));
}

function renderStorage(storage) {
  const oldest = storage.oldestRaw ? ` since ${new Date(storage.oldestRaw).toLocaleString()}` : '';
  $('storage').textContent =
    `${formatNumber(storage.rawEvents)} detailed logs kept${oldest}. ` +
    `Logs older than ${storage.retentionDays} days (or beyond ${formatNumber(storage.maxRawEvents)}) become daily totals automatically.`;
}

function applyPanelVisibility() {
  for (const section of document.querySelectorAll('section[data-panel]')) {
    section.hidden = !settings.panels[section.dataset.panel];
  }
}

function updateOptions(id, values) {
  const list = $(id);
  const sorted = [...new Set(values)].sort();
  if (list.dataset.values === sorted.join('\n')) return;
  list.dataset.values = sorted.join('\n');
  list.replaceChildren(...sorted.map(value => Object.assign(document.createElement('option'), { value })));
}

function render() {
  if (!lastSummary) return;
  const summary = lastSummary;
  updateOptions('source-options', summary.rows.map(row => row.source));
  updateOptions('model-options', summary.rows.map(row => row.model));
  const rows = rowsInRange(summary.rows).filter(matchesFilters);
  const total = sumRows(rows);
  renderOverview(total);
  renderBreakdown(rows, total);
  renderDaily(rows);
  renderLatest(summary.recent);
  renderStorage(summary.storage);
  renderSortIndicators();
}

function renderSortIndicators() {
  for (const th of document.querySelectorAll('th[data-sort]')) {
    const sort = settings.sort[th.closest('table').dataset.table];
    const active = sort?.key === th.dataset.sort;
    th.setAttribute('aria-sort', active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
    th.querySelector('.arrow').textContent = active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕';
  }
}

async function refresh() {
  try {
    const response = await fetch('/api/summary');
    if (!response.ok) throw new Error(response.statusText);
    lastSummary = await response.json();
    render();
    $('status').textContent = `updated ${new Date().toLocaleTimeString()}`;
  } catch {
    $('status').textContent = 'cannot reach the viewer server. Is it still running?';
  }
}

function scheduleRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(refresh, settings.refreshSeconds * 1000);
}

function bindSettings() {
  for (const checkbox of document.querySelectorAll('[data-panel-toggle]')) {
    const panel = checkbox.dataset.panelToggle;
    checkbox.checked = settings.panels[panel];
    checkbox.addEventListener('change', () => {
      settings.panels[panel] = checkbox.checked;
      saveSettings();
      applyPanelVisibility();
    });
  }

  $('group-by').value = settings.groupBy;
  $('group-by').addEventListener('change', event => {
    settings.groupBy = event.target.value;
    saveSettings();
    refresh();
  });

  $('range').value = settings.range;
  $('range').addEventListener('change', event => {
    settings.range = event.target.value;
    saveSettings();
    refresh();
  });

  $('refresh').value = String(settings.refreshSeconds);
  $('refresh').addEventListener('change', event => {
    settings.refreshSeconds = Number(event.target.value);
    saveSettings();
    scheduleRefresh();
  });

  $('settings-toggle').addEventListener('click', () => {
    const panel = $('settings');
    panel.hidden = !panel.hidden;
    $('settings-toggle').setAttribute('aria-expanded', String(!panel.hidden));
  });
}

// Click cycle per column: descending, ascending, then back to the default order.
function bindSorting() {
  for (const th of document.querySelectorAll('th[data-sort]')) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sort';
    const arrow = document.createElement('span');
    arrow.className = 'arrow';
    arrow.setAttribute('aria-hidden', 'true');
    button.append(...th.childNodes, arrow);
    th.append(button);
    button.addEventListener('click', () => {
      const table = th.closest('table').dataset.table;
      const key = th.dataset.sort;
      const current = settings.sort[table];
      if (current?.key !== key) settings.sort[table] = { key, dir: 'desc' };
      else if (current.dir === 'desc') settings.sort[table] = { key, dir: 'asc' };
      else delete settings.sort[table];
      saveSettings();
      render();
    });
  }
  renderSortIndicators();
}

function bindFilters() {
  for (const key of ['source', 'model']) {
    $(`filter-${key}`).addEventListener('input', event => {
      filters[key] = event.target.value.trim().toLowerCase();
      $('clear-filters').hidden = !isFiltered();
      render();
    });
  }
  $('clear-filters').addEventListener('click', () => {
    for (const key of ['source', 'model']) {
      filters[key] = '';
      $(`filter-${key}`).value = '';
    }
    $('clear-filters').hidden = true;
    render();
  });
}

function bindCompact() {
  $('compact').addEventListener('click', async () => {
    const confirmed = confirm(
      'Convert all detailed logs into daily totals and delete them?\n\n' +
      'Cost, tokens, time and history stay. The "Latest requests" list will be emptied.',
    );
    if (!confirmed) return;
    const response = await fetch('/api/compact', { method: 'POST', headers: { 'x-viewer-action': 'compact' } });
    const result = await response.json();
    $('status').textContent = response.ok ? `compacted ${formatNumber(result.compacted)} logs` : `compact failed: ${result.error}`;
    refresh();
  });
}

bindSettings();
bindSorting();
bindFilters();
bindCompact();
applyPanelVisibility();
refresh();
scheduleRefresh();
