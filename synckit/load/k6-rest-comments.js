// k6 scenario: REST comments at a constant 200 rps for 10 minutes.
// 75 % POST (create comment) / 25 % GET (list comments), spread over the
// load-test rooms created by prepare.mjs.
//
//   k6 run -e BASE_URLS=http://a:4201,http://b:4202 -e API_KEY=sk_dev_… \
//          load/k6-rest-comments.js
import { check } from "k6";
import http from "k6/http";

const URLS = (__ENV.BASE_URLS || "http://127.0.0.1:4000").split(",");
const ROOMS = Number(__ENV.ROOMS || 50);
const API_KEY = __ENV.API_KEY;

export const options = {
  scenarios: {
    comments: {
      executor: "constant-arrival-rate",
      rate: Number(__ENV.RPS || 200),
      timeUnit: "1s",
      duration: __ENV.DURATION || "10m",
      preAllocatedVUs: 100,
      maxVUs: 400,
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<100"],
    http_req_failed: ["rate<0.01"],
  },
};

export default function () {
  const base = URLS[__ITER % URLS.length];
  const room = `load-room-${__ITER % ROOMS}`;
  const headers = { authorization: `Bearer ${API_KEY}`, "content-type": "application/json" };

  if (__ITER % 4 === 3) {
    const response = http.get(`${base}/v1/rooms/${room}/comments?limit=20`, { headers });
    check(response, { "list 200": (r) => r.status === 200 });
  } else {
    const response = http.post(
      `${base}/v1/rooms/${room}/comments`,
      JSON.stringify({
        endUserId: `k6-user-${__VU}`,
        body: `load test comment ${__ITER}`,
      }),
      { headers },
    );
    check(response, { "create 201": (r) => r.status === 201 });
  }
}
