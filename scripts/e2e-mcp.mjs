// QA the MCP server over real stdio JSON-RPC against live Devnet: every tool, plus
// the error paths (bad input, unknown party, unknown tool). Reads the same
// gitignored env the deployer uses.
//   LEDGER_ENV_FILE=scripts/.env.devnet node scripts/e2e-mcp.mjs
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const srv = spawn(process.execPath, ['mcp/server.mjs'], { cwd: ROOT, stdio: ['pipe', 'pipe', 'inherit'] });

let nextId = 1, buf = '';
const pending = new Map();
srv.stdout.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  }
});
const rpc = (method, params = {}) => new Promise((res, rej) => {
  const id = nextId++;
  pending.set(id, res);
  srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error(`timeout: ${method}`)); } }, 90000);
});
const call = async (name, args = {}) => {
  const m = await rpc('tools/call', { name, arguments: args });
  return { text: m.result?.content?.[0]?.text ?? '', isError: !!m.result?.isError, raw: m };
};

let pass = 0; const fails = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fails.push(name); console.log(`  ✗ FAIL ${name}${detail ? '  — ' + detail.slice(0, 120) : ''}`); }
};

(async () => {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'qa', version: '1' } });
  srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  console.log('── Tool discovery ──');
  const list = await rpc('tools/list', {});
  const names = (list.result?.tools ?? []).map((t) => t.name);
  ok('exposes all 6 tools', names.length === 6, names.join(','));
  for (const t of ['explain_desk', 'list_settlements', 'party_view', 'market_snapshot', 'best_execution', 'post_rfq'])
    ok(`tool "${t}" is advertised`, names.includes(t));
  const schemas = (list.result?.tools ?? []).every((t) => t.inputSchema && t.inputSchema.type === 'object');
  ok('every tool declares an object inputSchema', schemas);

  console.log('── Read tools (live Devnet) ──');
  const explain = await call('explain_desk');
  ok('explain_desk describes the privacy model', /sealed|privacy|Vickrey/i.test(explain.text));

  const settle = await call('list_settlements');
  ok('list_settlements returns the audit trail', /@/.test(settle.text) && settle.text.split('\n').length > 5,
    `${settle.text.split('\n').length} lines`);
  ok('list_settlements includes basket settlements', /basket/i.test(settle.text));

  const pvA = await call('party_view', { party: 'dealerA' });
  ok('party_view(dealerA) reports its on-ledger view', /contracts:/.test(pvA.text));
  ok('party_view(dealerA) shows only its OWN quotes', !/dealerB/.test(pvA.text), pvA.text);

  const pvR = await call('party_view', { party: 'regulator' });
  ok('party_view(regulator) sees no pre-trade quotes', /quotes visible: none/i.test(pvR.text), pvR.text);
  ok('party_view(regulator) does see settled TradeReports', /TradeReport/.test(pvR.text));

  const snap = await call('market_snapshot');
  ok('market_snapshot reports settled trades', /settled trades:\s*\d+/i.test(snap.text), snap.text);

  const be = await call('best_execution');
  const attested = (be.text.match(/BEST EXECUTION ATTESTED/g) ?? []).length;
  ok('best_execution attests multiple trades', attested >= 5, `${attested} attested`);
  ok('best_execution explains the no-order-book claim', /selective|disclos/i.test(be.text));

  console.log('── Error paths ──');
  const badParty = await call('party_view', { party: 'nobody' });
  ok('unknown party fails gracefully (no crash, clear message)', /unknown party/i.test(badParty.text), badParty.text);

  const badQty = await call('post_rfq', { instrument: 'TBOND30', quantity: 0 });
  ok('post_rfq rejects a non-positive quantity', /positive/i.test(badQty.text), badQty.text);

  const negQty = await call('post_rfq', { instrument: 'TBOND30', quantity: -5 });
  ok('post_rfq rejects a negative quantity', /positive/i.test(negQty.text), negQty.text);

  const unknown = await call('no_such_tool');
  ok('unknown tool returns an error, not a hang', unknown.isError || /unknown tool/i.test(unknown.text), unknown.text);

  console.log('── Write tool (real on-ledger action) ──');
  const posted = await call('post_rfq', { instrument: 'GILT10', quantity: 250 });
  ok('post_rfq posts a real RFQ on Devnet', /Posted a confidential RFQ/.test(posted.text), posted.text);
  ok('post_rfq returns the on-ledger contract id', /contract: [0-9a-f]{40,}/.test(posted.text));
  ok('post_rfq echoes the requested instrument/qty', /GILT10 × 250/.test(posted.text), posted.text);

  const total = pass + fails.length;
  console.log(`\n════ MCP QA: ${pass}/${total} checks passed ════`);
  if (fails.length) console.log('FAIL: ' + fails.join(' | '));
  srv.kill();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('mcp qa error:', e.message); srv.kill(); process.exit(1); });
