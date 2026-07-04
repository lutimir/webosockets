#!/usr/bin/env node
// Provisions load-test fixtures with nothing but `psql` and node:crypto:
// an enterprise-plan organization (no connection caps), a project, an API
// key and the load-test rooms. Re-running replaces the previous fixtures.
//
//   eval "$(node load/prepare.mjs | tail -4)"
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://synckit:synckit@localhost:5432/synckit";
const JWT_SECRET = process.env.JWT_SECRET ?? "dev-only-change-me-0000000000000000";
const ROOMS = Number(process.env.ROOMS ?? 50);

const orgId = randomUUID();
const projectId = randomUUID();
const keyId = randomUUID();

// Same key format the server issues: sk_<env>_<base64url secret>,
// located by the first 8 chars of the secret, verified by sha256(full key).
const secret = randomBytes(24).toString("base64url");
const apiKey = `sk_dev_${secret}`;
const keyHash = createHash("sha256").update(apiKey).digest("hex");

const roomValues = Array.from(
  { length: ROOMS },
  (_, i) => `('${randomUUID()}', '${projectId}', 'load-room-${i}')`,
).join(",\n    ");

const sql = `
begin;
delete from organizations where slug = 'load-test';
insert into organizations (id, name, slug, plan)
  values ('${orgId}', 'Load Test', 'load-test', 'enterprise');
insert into projects (id, organization_id, name, slug, environment)
  values ('${projectId}', '${orgId}', 'Load Test', 'load-test', 'dev');
insert into api_keys (id, project_id, prefix, key_hash, scopes)
  values ('${keyId}', '${projectId}', '${secret.slice(0, 8)}', '${keyHash}', '{}');
insert into rooms (id, project_id, external_id)
  values ${roomValues};
commit;
`;

execFileSync("psql", [DATABASE_URL, "-v", "ON_ERROR_STOP=1", "-q"], { input: sql });

console.log(`# fixtures ready: org=${orgId} project=${projectId} rooms=${ROOMS}`);
console.log(`export LOAD_PROJECT_ID=${projectId}`);
console.log(`export LOAD_API_KEY=${apiKey}`);
console.log(`export LOAD_JWT_SECRET=${JWT_SECRET}`);
console.log(`export LOAD_ROOMS=${ROOMS}`);
