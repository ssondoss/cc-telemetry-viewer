const API_REQUEST_EVENT = 'claude_code.api_request';

function unwrap(value) {
  if (!value) return undefined;
  if ('stringValue' in value) return value.stringValue;
  if ('intValue' in value) return Number(value.intValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('boolValue' in value) return value.boolValue;
  if ('arrayValue' in value) return (value.arrayValue.values ?? []).map(unwrap);
  return undefined;
}

function attributesToObject(attributes = []) {
  return Object.fromEntries(attributes.map(attribute => [attribute.key, unwrap(attribute.value)]));
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function toIsoTime(eventTimestamp, timeUnixNano) {
  const fromTimestamp = eventTimestamp ? new Date(eventTimestamp) : null;
  if (fromTimestamp && !Number.isNaN(fromTimestamp.getTime())) return fromTimestamp.toISOString();
  if (timeUnixNano) return new Date(Number(BigInt(timeUnixNano) / 1_000_000n)).toISOString();
  return new Date().toISOString();
}

export function extractApiRequests(batch) {
  const requests = [];
  for (const resourceLog of batch?.resourceLogs ?? []) {
    const resource = attributesToObject(resourceLog.resource?.attributes);
    for (const scopeLog of resourceLog.scopeLogs ?? []) {
      for (const record of scopeLog.logRecords ?? []) {
        if (record.body?.stringValue !== API_REQUEST_EVENT) continue;
        const attributes = attributesToObject(record.attributes);
        requests.push({
          time: toIsoTime(attributes['event.timestamp'], record.timeUnixNano),
          source: attributes.query_source ?? 'unknown',
          model: attributes.model ?? 'unknown',
          version: resource['service.version'] ?? 'unknown',
          sessionId: attributes['session.id'] ?? null,
          input: toNumber(attributes.input_tokens),
          cacheRead: toNumber(attributes.cache_read_tokens),
          cacheWrite: toNumber(attributes.cache_creation_tokens),
          output: toNumber(attributes.output_tokens),
          cost: toNumber(attributes.cost_usd),
          durationMs: toNumber(attributes.duration_ms),
        });
      }
    }
  }
  return requests;
}
