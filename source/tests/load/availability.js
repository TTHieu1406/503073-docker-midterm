// Steady traffic for watching availability while something is going wrong, for
// example during a crash, a scale-down or a rolling update.
//
//   docker compose --profile load run --rm k6 run /scripts/availability.js

import { check } from 'k6';
import http from 'k6/http';

const BASE_URL = __ENV.BASE_URL ?? 'http://gateway:8080';

export const options = {
  scenarios: {
    steady: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.RATE ?? 100),
      timeUnit: '1s',
      duration: __ENV.DURATION ?? '40s',
      preAllocatedVUs: 50,
      maxVUs: 200,
    },
  },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
};

export default function () {
  const response = http.get(`${BASE_URL}/api/whoami`);
  check(response, { 'status is 200': (r) => r.status === 200 });
}

export function handleSummary(data) {
  const duration = data.metrics.http_req_duration.values;
  const failed = data.metrics.http_req_failed.values;
  const result = {
    requests: data.metrics.http_reqs.values.count,
    failed: failed.passes,
    failedRate: failed.rate,
    p95Ms: Math.round(duration['p(95)'] * 10) / 10,
    maxMs: Math.round(duration.max * 10) / 10,
  };
  return { stdout: `RESULT ${JSON.stringify(result)}\n` };
}
