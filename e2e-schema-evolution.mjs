#!/usr/bin/env node
/**
 * @file e2e-schema-evolution.mjs
 * @description Backward-compatibility test that exercises older canonical payloads, optional-field defaults, and all 7 translators with partial inputs.
 * @author Carlos Mejía
 * @project MIPIT-PoC — Cross-border Instant Payments Middleware
 */
/**
 * MIPIT — Schema Evolution Test (Backward Compatibility)
 *
 * Verifies that:
 *   1. Existing canonical payloads still validate after schema changes
 *   2. New optional fields don't break existing translations
 *   3. Missing optional fields get sensible defaults
 *   4. All 7 translators handle partial canonical payloads gracefully
 *   5. The translate endpoint handles payloads from "older" clients
 *   6. Minimal payloads (only required fields) still translate correctly
 */

import { createTraceLogger, fetchWithTrace } from './logging.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const TOKEN = process.env.TOKEN;
if (!TOKEN) { console.error('Set TOKEN env var'); process.exit(1); }

const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` };
const logger = createTraceLogger('e2e-schema-evolution');
let pass = 0, fail = 0, total = 0;

function assert(cond, label, detail) {
  total++;
  if (cond) { pass++; console.log(`    ✅ ${label}`); }
  else { fail++; console.log(`    ❌ ${label}${detail ? ` — ${detail}` : ''}`); }
}

async function post(path, body) {
  const res = await fetchWithTrace(logger, `POST ${path}`, `${BASE}${path}`, {
    method: 'POST', headers: H,
    body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
  });
  return { status: res.status, data: res.body };
}

async function get(path) {
  const res = await fetchWithTrace(logger, `GET ${path}`, `${BASE}${path}`, {
    headers: H,
    signal: AbortSignal.timeout(10000),
  });
  return { status: res.status, data: res.body };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  logger.banner('START e2e-schema-evolution');
  logger.step('configuration', { BASE });
  console.log('');
  console.log('════════════════════════════════════════════════════════════');
  console.log('  MIPIT — Schema Evolution Test (Backward Compatibility)');
  console.log(`  ${new Date().toISOString()}`);
  console.log('════════════════════════════════════════════════════════════');

  // ─── Test 1: Minimal PIX payload (only required fields) ───
  console.log('\n═══ Test 1: Minimal PIX payload (legacy client) ═══');
  const minimalPix = {
    endToEndId: 'E2626422020260404120012345678901',
    valor: { original: '500.00' },
    pagador: { ispb: '26264220', nome: 'MinSender' },
    recebedor: { ispb: '60701190', nome: 'MinRecv' },
    chave: 'min@email.com',
  };
  const r1 = await post('/translate/preview', { sourceRail: 'PIX', payload: minimalPix });
  assert(r1.status === 200, `Minimal PIX preview: HTTP ${r1.status}`);
  if (r1.data?.canonical) {
    assert(r1.data.canonical.amount?.value === 500, `Amount: ${r1.data.canonical.amount?.value}`);
    assert(r1.data.canonical.debtor?.name === 'MinSender', `Debtor name preserved`);
    assert(r1.data.canonical.origin?.rail === 'PIX', `Origin rail: PIX`);
  }
  const translationCount1 = Object.keys(r1.data?.translations ?? {}).length;
  assert(translationCount1 >= 5, `${translationCount1} translations from minimal payload`);

  // ─── Test 2: PIX payload with ALL optional fields ───
  console.log('\n═══ Test 2: Full PIX payload (all optional fields) ═══');
  const fullPix = {
    endToEndId: 'E2626422020260404120012345678901',
    valor: { original: '2500.00' },
    pagador: {
      ispb: '26264220', nome: 'Full Sender', cpf: '12345678901',
      agencia: '0001',
      contaTransacional: { numero: '123456-7', tipoConta: 'CACC' },
    },
    recebedor: {
      ispb: '60701190', nome: 'Full Receiver', cpf: '98765432100',
      agencia: '0002',
      contaTransacional: { numero: '765432-1', tipoConta: 'SVGS' },
    },
    chave: 'full@email.com', tipoChave: 'EMAIL', tipo: 'TRANSF',
    campoLivre: 'Full payment with all fields',
    idConciliacao: 'CONC-001',
    infoAdicional: [{ nome: 'extra', valor: 'data' }],
    dataHora: '2026-04-04T12:00:00Z',
  };
  const r2 = await post('/translate/preview', { sourceRail: 'PIX', payload: fullPix });
  assert(r2.status === 200, `Full PIX preview: HTTP ${r2.status}`);
  if (r2.data?.canonical) {
    assert(r2.data.canonical.amount?.value === 2500, `Amount: ${r2.data.canonical.amount?.value}`);
    assert(r2.data.canonical.debtor?.taxId === '12345678901', `Tax ID preserved`);
    assert(r2.data.canonical.debtor?.account_id != null, `Debtor account_id present`);
  }
  const translationCount2 = Object.keys(r2.data?.translations ?? {}).length;
  assert(translationCount2 >= 5, `${translationCount2} translations from full payload`);

  // ─── Test 3: SPEI minimal payload (CreatePaymentRequest format) ───
  console.log('\n═══ Test 3: Minimal SPEI payload ═══');
  const minimalSpei = {
    amount: 3000,
    currency: 'MXN',
    debtor: { alias: 'SPEI-014180000228456711', name: 'SPEI Sender' },
    creditor: { alias: 'SPEI-012180000118359784', name: 'SPEI Receiver' },
  };
  const r3 = await post('/translate/preview', { sourceRail: 'SPEI', payload: minimalSpei });
  assert(r3.status === 200, `Minimal SPEI preview: HTTP ${r3.status}`);
  if (r3.data?.canonical) {
    assert(r3.data.canonical.amount?.value === 3000, `SPEI amount: ${r3.data.canonical.amount?.value}`);
    assert(r3.data.canonical.origin?.rail === 'SPEI', `Origin: SPEI`);
  }

  // ─── Test 4: SWIFT MT103 minimal ───
  console.log('\n═══ Test 4: Minimal SWIFT MT103 payload ═══');
  const minimalSwift = {
    transactionRef: 'TXN-LEGACY-001',
    bankOperationCode: 'CRED',
    valueDate: '2026-04-04',
    currency: 'USD',
    amount: 1000,
    orderingCustomer: { account: '111222333', name: 'John Legacy' },
    beneficiaryCustomer: { account: '444555666', name: 'Jane Modern' },
    detailsOfCharges: 'SHA',
  };
  const r4 = await post('/translate/preview', { sourceRail: 'SWIFT_MT103', payload: minimalSwift });
  assert(r4.status === 200, `Minimal SWIFT preview: HTTP ${r4.status}`);
  const swiftTranslations = Object.keys(r4.data?.translations ?? {}).length;
  assert(swiftTranslations >= 5, `${swiftTranslations} translations from SWIFT`);

  // ─── Test 5: Cross-format translation preserves core fields ───
  console.log('\n═══ Test 5: Cross-format field preservation ═══');
  const crossPairs = [
    { src: 'PIX', dst: 'SPEI', check: 'monto' },
    { src: 'PIX', dst: 'SWIFT_MT103', check: 'amount' },
    { src: 'PIX', dst: 'ISO20022_MX', check: 'CdtTrfTxInf' },
    { src: 'PIX', dst: 'ACH_NACHA', check: 'batchHeader' },
    { src: 'PIX', dst: 'FEDNOW', check: 'FIToFICstmrCdtTrf' },
    { src: 'PIX', dst: 'BRE_B', check: 'valor' },
  ];

  for (const { src, dst, check } of crossPairs) {
    const r = await post('/translate', {
      sourceRail: src, destinationRail: dst, payload: fullPix,
    });
    assert(r.status === 200, `${src}→${dst}: HTTP ${r.status}`);
    if (r.data?.translated) {
      const translated = JSON.stringify(r.data.translated);
      assert(translated.includes(check),
        `${src}→${dst} has "${check}" field`);
    }
  }

  // ─── Test 6: Unknown fields in payload are ignored (forward compat) ───
  console.log('\n═══ Test 6: Unknown fields ignored (forward compatibility) ═══');
  const futurePayload = {
    ...minimalPix,
    futureField1: 'should be ignored',
    futureField2: { nested: true },
    experimentalFX: { newRate: 5.5 },
  };
  const r6 = await post('/translate/preview', { sourceRail: 'PIX', payload: futurePayload });
  assert(r6.status === 200, `Payload with unknown fields: HTTP ${r6.status}`);
  assert(r6.data?.canonical?.amount?.value === 500, `Core fields still parsed correctly`);

  // ─── Test 7: Payment API backward compatibility ───
  console.log('\n═══ Test 7: Payment API backward compat (v1 payload) ═══');
  const v1Payload = {
    amount: 100,
    currency: 'BRL',
    debtor: { alias: 'PIX-v1@test.com', name: 'V1Sender' },
    creditor: { alias: 'PIX-v1-recv@test.com', name: 'V1Recv' },
  };
  const r7 = await post('/payments', v1Payload);
  // Without Idempotency-Key the behavior depends on whether it's required
  assert(r7.status === 201 || r7.status === 200 || r7.status === 400,
    `V1 payload (no purpose/reference): HTTP ${r7.status}`);

  // With all optional fields
  const r7b = await post('/payments', {
    ...v1Payload,
    purpose: 'V1_TEST',
    reference: 'REF-V1-001',
    debtor: { ...v1Payload.debtor, name: 'V1Full' },
  });
  assert(r7b.status === 201 || r7b.status === 200,
    `V1 payload with optional fields: HTTP ${r7b.status}`);

  // ─── Test 8: FedNow with and without BAH wrapper ───
  console.log('\n═══ Test 8: FedNow schema variations ═══');
  const fednowDirect = {
    FIToFICstmrCdtTrf: {
      GrpHdr: {
        MsgId: 'MSG-FN-001', CreDtTm: '2026-04-04T12:00:00Z', NbOfTxs: '1',
        SttlmInf: { SttlmMtd: 'CLRG', ClrSys: { Cd: 'USABA' } },
      },
      CdtTrfTxInf: {
        PmtId: { EndToEndId: 'E2E-FN-001' },
        IntrBkSttlmAmt: { Ccy: 'USD', value: '750.00' },
        IntrBkSttlmDt: '2026-04-04',
        DbtrAgt: { FinInstnId: { ClrSysMmbId: { ClrSysId: { Cd: 'USABA' }, MmbId: '021000021' } } },
        Dbtr: { Nm: 'Alice FedNow' },
        DbtrAcct: { Id: { Othr: { Id: '987654321' } } },
        CdtrAgt: { FinInstnId: { ClrSysMmbId: { ClrSysId: { Cd: 'USABA' }, MmbId: '026009593' } } },
        Cdtr: { Nm: 'Bob FedNow' },
        CdtrAcct: { Id: { Othr: { Id: '123456789' } } },
      },
    },
  };
  const r8a = await post('/translate/preview', { sourceRail: 'FEDNOW', payload: fednowDirect });
  assert(r8a.status === 200, `FedNow without BAH: HTTP ${r8a.status}`);

  const fednowWithBAH = {
    BusinessMessageHeader: {
      Fr: { FIId: { FinInstnId: { ClrSysMmbId: { MmbId: '021000021' } } } },
      To: { FIId: { FinInstnId: { ClrSysMmbId: { MmbId: '026009593' } } } },
      BizSvc: 'fednow', MsgDefIdr: 'pacs.008.001.08',
      BizMsgIdr: 'BIZ-001', CreDt: '2026-04-04T12:00:00Z',
    },
    ...fednowDirect,
  };
  const r8b = await post('/translate/preview', { sourceRail: 'FEDNOW', payload: fednowWithBAH });
  assert(r8b.status === 200, `FedNow with BAH: HTTP ${r8b.status}`);

  if (r8a.data?.canonical && r8b.data?.canonical) {
    assert(
      r8a.data.canonical.amount?.value === r8b.data.canonical.amount?.value,
      `Same amount with/without BAH: ${r8a.data.canonical.amount?.value}`
    );
  }

  // ─── Test 9: ACH NACHA minimal (full AchNachaTransaction format) ───
  console.log('\n═══ Test 9: ACH NACHA minimal payload ═══');
  const minimalAch = {
    batchHeader: {
      recordType: '5',
      serviceClassCode: '225',
      companyName: 'ACME Corp',
      companyId: '1234567890',
      secCode: 'PPD',
      companyEntryDescription: 'PAYMENT',
      effectiveEntryDate: '260404',
      originatingDfiId: '02100002',
      batchNumber: '0000001',
    },
    entryDetail: {
      recordType: '6',
      transactionCode: 22,
      routingTransitNumber: '026009593',
      accountNumber: '123456789012',
      amount: 150000,
      individualName: 'Bob NACHA',
      addendaRecordIndicator: '0',
      traceNumber: '0210000210000001',
    },
    originator: {
      name: 'Alice NACHA',
      accountNumber: '987654321',
      routingNumber: '021000021',
    },
    odfi: {
      name: 'First Bank',
      routingNumber: '021000021',
    },
  };
  const r9 = await post('/translate/preview', { sourceRail: 'ACH_NACHA', payload: minimalAch });
  assert(r9.status === 200, `Minimal ACH NACHA preview: HTTP ${r9.status}`);
  if (r9.data?.canonical) {
    assert(r9.data.canonical.amount?.value === 1500,
      `ACH amount cents→dollars: ${r9.data.canonical.amount?.value}`);
  }

  // ─── Test 10: ISO 20022 with Document wrapper ───
  console.log('\n═══ Test 10: ISO 20022 with Document wrapper ═══');
  const iso20022Wrapped = {
    Document: {
      FIToFICstmrCdtTrf: {
        GrpHdr: {
          MsgId: 'MSG-ISO-001', CreDtTm: '2026-04-04T12:00:00Z', NbOfTxs: '1',
          SttlmInf: { SttlmMtd: 'CLRG' },
        },
        CdtTrfTxInf: {
          PmtId: { EndToEndId: 'E2E-ISO-001' },
          IntrBkSttlmAmt: { Ccy: 'EUR', value: '1200.00' },
          IntrBkSttlmDt: '2026-04-04',
          Dbtr: { Nm: 'Euro Sender' },
          DbtrAcct: { Id: { IBAN: 'DE89370400440532013000' } },
          DbtrAgt: { FinInstnId: { BIC: 'COBADEFFXXX' } },
          Cdtr: { Nm: 'Euro Receiver' },
          CdtrAcct: { Id: { Othr: { Id: '9876543210' } } },
          CdtrAgt: { FinInstnId: { BIC: 'BNPAFRPPXXX' } },
        },
      },
    },
  };
  const r10 = await post('/translate/preview', { sourceRail: 'ISO20022_MX', payload: iso20022Wrapped });
  assert(r10.status === 200, `ISO 20022 wrapped Document: HTTP ${r10.status}`);
  if (r10.data?.canonical) {
    assert(r10.data.canonical.debtor?.name === 'Euro Sender', `Debtor name from wrapped doc`);
    assert(r10.data.canonical.amount?.currency === 'EUR', `Currency: EUR`);
  }

  const iso20022Direct = iso20022Wrapped.Document.FIToFICstmrCdtTrf;
  const r10b = await post('/translate/preview', { sourceRail: 'ISO20022_MX', payload: iso20022Direct });
  assert(r10b.status === 200, `ISO 20022 direct (unwrapped): HTTP ${r10b.status}`);

  // Summary
  console.log('\n════════════════════════════════════════════════════════════');
  console.log(`  TOTAL: ${pass} passed / ${fail} failed / ${total} total`);
  console.log(`  ${fail === 0 ? 'ALL PASS ✅' : `${fail} FAILURES ❌`}`);
  console.log('════════════════════════════════════════════════════════════\n');
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
