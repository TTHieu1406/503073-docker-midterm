// Measures throughput for the current replica count, using CPU-bound requests so
// that the result reflects the application tier rather than Redis or the network.
//
//   docker compose up -d --scale api=3 --no-recreate
//   docker compose --profile load run --rm k6 run /scripts/scale.js

import { check } from 'k6';
import http from 'k6/http';

const BASE_URL = __ENV.BASE_URL ?? 'http://gateway:8080';
const ITERATIONS = __ENV.ITERATIONS ?? '20000';

export const options = {
  vus: Number(__ENV.VUS ?? 40),
  duration: __ENV.DURATION ?? '30s',
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
};

export default function () {
  const response = http.get(`${BASE_URL}/api/ops/compute?iterations=${ITERATIONS}`);
  check(response, { 'status is 200': (r) => r.status === 200 });
}

export function handleSummary(data) {
  const duration = data.metrics.http_req_duration.values;
  const result = {
    requests: data.metrics.http_reqs.values.count,
    rps: Math.round(data.metrics.http_reqs.values.rate * 10) / 10,
    avgMs: Math.round(duration.avg * 10) / 10,
    p95Ms: Math.round(duration['p(95)'] * 10) / 10,
    p99Ms: Math.round(duration['p(99)'] * 10) / 10,
    failedRate: data.metrics.http_req_failed.values.rate,
  };
  return { stdout: `RESULT ${JSON.stringify(result)}\n` };
}
