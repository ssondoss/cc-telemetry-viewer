#!/usr/bin/env node
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createViewerServer } from '../src/server.js';
import { Store } from '../src/store.js';

const HELP = `Usage: cc-telemetry-viewer [options]

Options:
  --port <number>            Port for the dashboard and the OTLP receiver (default 4318)
  --data-dir <path>          Where data is stored (default ./data in the project folder)
  --retention-days <number>  Days of detailed logs to keep before compacting into daily totals (default 7)
  --max-events <number>      Maximum detailed logs to keep (default 100000)
  -h, --help                 Show this help
`;

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '4318' },
    'data-dir': { type: 'string', default: join(dirname(fileURLToPath(import.meta.url)), '..', 'data') },
    'retention-days': { type: 'string', default: '7' },
    'max-events': { type: 'string', default: '100000' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (values.help) {
  process.stdout.write(HELP);
  process.exit(0);
}

function positiveInteger(name, value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    process.stderr.write(`--${name} must be a positive whole number\n`);
    process.exit(1);
  }
  return number;
}

const port = positiveInteger('port', values.port);
const store = new Store({
  dir: values['data-dir'],
  retentionDays: positiveInteger('retention-days', values['retention-days']),
  maxRawEvents: positiveInteger('max-events', values['max-events']),
});

store.load();
store.enforceRetention();
setInterval(() => store.enforceRetention(), 60 * 60 * 1000).unref();

const server = createViewerServer({ store });
server.on('error', error => {
  process.stderr.write(error.code === 'EADDRINUSE' ? `Port ${port} is already in use. Try --port <other>\n` : `${error.message}\n`);
  process.exit(1);
});

server.listen(port, '127.0.0.1', () => {
  const endpoint = `http://127.0.0.1:${port}`;
  process.stdout.write(`Dashboard:  ${endpoint}
Data:       ${values['data-dir']}

Start Claude Code with:

  CLAUDE_CODE_ENABLE_TELEMETRY=1 \\
  OTEL_LOGS_EXPORTER=otlp \\
  OTEL_EXPORTER_OTLP_PROTOCOL=http/json \\
  OTEL_EXPORTER_OTLP_ENDPOINT=${endpoint} \\
  OTEL_LOGS_EXPORT_INTERVAL=5000 \\
  claude
`);
});
