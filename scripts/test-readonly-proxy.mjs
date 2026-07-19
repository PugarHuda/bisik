// Self-check for the hosted read-only proxy (api/proxy.mjs): the security
// property is that writes are denied BEFORE any token is attached or the ledger
// is reached, and only the desk's read endpoints + /config are allowed.
//   node scripts/test-readonly-proxy.mjs
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const handler = (await import(pathToFileURL(join(HERE, '..', 'api', 'proxy.mjs')).href)).default;

const res = () => ({ _s: 0, _j: null, status(c) { this._s = c; return this; },
  json(o) { this._j = o; return this; }, send() { return this; }, setHeader() {} });
const call = async (method, path, body = {}) => { const r = res(); await handler({ method, query: { path }, body }, r); return r; };
const acsBody = (party) => ({ filter: { filtersByParty: { [party]: { cumulative: [] } } }, verbose: true, activeAtOffset: 1 });

let fail = 0;
const ok = (n, c) => { console.log((c ? '✓' : '✗') + ' ' + n); if (!c) fail++; };

// Writes: must be a hard 403, never proxied.
ok('blocks command submit', (await call('POST', ['v2', 'commands', 'submit-and-wait-for-transaction']))._s === 403);
ok('blocks grant rights', (await call('POST', ['v2', 'users', '6', 'rights']))._s === 403);
ok('blocks party allocate (POST)', (await call('POST', ['v2', 'parties']))._s === 403);
ok('blocks unknown path', (await call('GET', ['v2', 'anything', 'else']))._s === 403);
// Reads + config: allowed (config is served locally; reads pass the allowlist).
const c = await call('GET', ['config']);
ok('config returns readOnly + parties', c._s === 200 && c._j?.readOnly === true && !!c._j?.parties?.buyer);
ok('allows ledger-end read', (await call('GET', ['v2', 'state', 'ledger-end']))._s !== 403);
ok('blocks parties GET (validator enumeration)', (await call('GET', ['v2', 'parties']))._s === 403);
// active-contracts is scoped to THIS desk's parties on the shared validator.
const buyer = c._j.parties.buyer;
ok('allows active-contracts for a desk party', (await call('POST', ['v2', 'state', 'active-contracts'], acsBody(buyer)))._s !== 403);
ok('rejects active-contracts for a foreign party', (await call('POST', ['v2', 'state', 'active-contracts'], acsBody('intruder::deadbeef')))._s === 403);
ok('rejects active-contracts with no party filter', (await call('POST', ['v2', 'state', 'active-contracts'], {}))._s === 403);
// The scoping bypass: a valid desk party in filtersByParty (to pass the gate) PLUS a
// filtersForAnyParty that would enumerate every party the shared M2M token can readAs.
ok('rejects filtersForAnyParty bypass', (await call('POST', ['v2', 'state', 'active-contracts'],
  { filter: { filtersByParty: { [buyer]: { cumulative: [] } }, filtersForAnyParty: { cumulative: [] } }, activeAtOffset: 1 }))._s === 403);
ok('rejects any non-filtersByParty filter key', (await call('POST', ['v2', 'state', 'active-contracts'],
  { filter: { filtersForAnyParty: { cumulative: [] } }, activeAtOffset: 1 }))._s === 403);
// Method must match the allowlist entry exactly — an allowed path with the wrong verb is not a hole.
ok('blocks wrong method on an allowed path (POST ledger-end)', (await call('POST', ['v2', 'state', 'ledger-end']))._s === 403);
ok('blocks wrong method on an allowed path (GET active-contracts)', (await call('GET', ['v2', 'state', 'active-contracts']))._s === 403);

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
