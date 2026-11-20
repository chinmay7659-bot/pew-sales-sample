import { AppData, DesignItem, ModelItem, SalespersonItem, SampleRecord } from './types';

export const APPS_SCRIPT_TEMPLATE = `// Paste into Google Sheet -> Extensions -> Apps Script, then Deploy -> Web app (Anyone).
const TABS = {
  samples: ['id', 'date', 'salesperson', 'design', 'item', 'qty', 'trays', 'status', 'notes', 'ts', 'by'],
  salespeople: ['id', 'name', 'ts'],
  designs: ['id', 'name', 'ts'],
  models: ['id', 'name', 'design', 'ts'],
};

function norm(v) {
  return String(v == null ? '' : v).trim().toLowerCase();
}

function mkKey(d, m) {
  return norm(d) + '|' + norm(m);
}

function ensureTabs(ss) {
  const map = {
    Samples: TABS.samples,
    Salespeople: TABS.salespeople,
    Designs: TABS.designs,
    Models: TABS.models,
  };
  Object.keys(map).forEach(function (name) {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    const hdr = map[name];
    const first = sh.getRange(1, 1, 1, hdr.length).getDisplayValues()[0];
    if (String(first[0] || '').trim() !== 'id') {
      sh.getRange(1, 1, 1, hdr.length).setValues([hdr]);
      sh.setFrozenRows(1);
    }
  });
}

function readAll(ss) {
  ensureTabs(ss);
  const sRows = ss.getSheetByName('Samples').getDataRange().getDisplayValues();
  const spRows = ss.getSheetByName('Salespeople').getDataRange().getDisplayValues();
  const dnRows = ss.getSheetByName('Designs').getDataRange().getDisplayValues();
  const mdRows = ss.getSheetByName('Models').getDataRange().getDisplayValues();

  const samples = [];
  for (var i = 1; i < sRows.length; i++) {
    var r = sRows[i];
    var id = String(r[0] || '').trim();
    if (!id) continue;
    var traysRaw = String(r[6] || '').trim();
    var traysVal = traysRaw === '' ? null : Number(traysRaw);
    samples.push({
      id: id,
      date: String(r[1] || '').trim(),
      salesperson: String(r[2] || '').trim(),
      design: String(r[3] || '').trim(),
      item: String(r[4] || '').trim(),
      qty: Math.max(1, Math.round(Number(r[5]) || 1)),
      trays: traysVal !== null && isFinite(traysVal) ? Math.max(0, Math.round(traysVal)) : null,
      status: String(r[7] || 'Sent').trim() || 'Sent',
      notes: String(r[8] || ''),
      ts: Number(r[9]) || 0,
      by: String(r[10] || '').trim() || undefined,
    });
  }
  samples.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });

  var salespeople = [];
  for (var j = 1; j < spRows.length; j++) {
    var sp = spRows[j];
    if (String(sp[0] || '').trim() && String(sp[1] || '').trim()) {
      salespeople.push({ id: String(sp[0]).trim(), name: String(sp[1]).trim(), ts: Number(sp[2]) || 0 });
    }
  }

  var designs = [];
  for (var k = 1; k < dnRows.length; k++) {
    var dn = dnRows[k];
    if (String(dn[0] || '').trim() && String(dn[1] || '').trim()) {
      designs.push({ id: String(dn[0]).trim(), name: String(dn[1]).trim(), ts: Number(dn[2]) || 0 });
    }
  }

  var models = [];
  for (var m = 1; m < mdRows.length; m++) {
    var md = mdRows[m];
    if (String(md[0] || '').trim() && String(md[1] || '').trim()) {
      models.push({ id: String(md[0]).trim(), name: String(md[1]).trim(), design: String(md[2] || '').trim(), ts: Number(md[3]) || 0 });
    }
  }

  return { salespeople: salespeople, designs: designs, models: models, samples: samples };
}

function sampleRow(r) {
  return [
    String(r.id || ''),
    String(r.date || ''),
    String(r.salesperson || ''),
    String(r.design || ''),
    String(r.item || ''),
    Number(r.qty) || 1,
    r.trays === null || r.trays === undefined || r.trays === '' ? '' : Number(r.trays),
    String(r.status || 'Sent'),
    String(r.notes || ''),
    Number(r.ts) || Date.now(),
    String(r.by || ''),
  ];
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    return jsonOut({ ok: true, title: ss.getName(), data: readAll(ss) });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var body = JSON.parse(e.postData.contents || '{}');
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureTabs(ss);
    var action = body.action;

    if (action === 'appendSample' && body.record) {
      var sh = ss.getSheetByName('Samples');
      var nextRow = sh.getLastRow() + 1;
      sh.getRange(nextRow, 1, 1, 5).setNumberFormat('@');
      sh.getRange(nextRow, 8, 1, 2).setNumberFormat('@');
      sh.getRange(nextRow, 11, 1, 1).setNumberFormat('@');
      sh.getRange(nextRow, 1, 1, 11).setValues([sampleRow(body.record)]);
    } else if (action === 'updateSample' && body.record) {
      var shU = ss.getSheetByName('Samples');
      var valsU = shU.getDataRange().getDisplayValues();
      var rowIdx = -1;
      for (var i = 1; i < valsU.length; i++) {
        if (String(valsU[i][0] || '').trim() === String(body.record.id).trim()) {
          rowIdx = i + 1;
          break;
        }
      }
      if (rowIdx < 2) rowIdx = shU.getLastRow() + 1;
      shU.getRange(rowIdx, 1, 1, 5).setNumberFormat('@');
      shU.getRange(rowIdx, 8, 1, 2).setNumberFormat('@');
      shU.getRange(rowIdx, 11, 1, 1).setNumberFormat('@');
      shU.getRange(rowIdx, 1, 1, 11).setValues([sampleRow(body.record)]);
    } else if (action === 'deleteSample' && body.id) {
      var shD = ss.getSheetByName('Samples');
      var valsD = shD.getDataRange().getDisplayValues();
      for (var d = valsD.length - 1; d >= 1; d--) {
        if (String(valsD[d][0] || '').trim() === String(body.id).trim()) {
          shD.deleteRow(d + 1);
          break;
        }
      }
    } else if (action === 'appendCatalog' && body.entries) {
      var entries = body.entries;
      if (entries.salespeople && entries.salespeople.length) {
        var spSh = ss.getSheetByName('Salespeople');
        var spStart = spSh.getLastRow() + 1;
        var spRows = entries.salespeople.map(function (s) { return [String(s.id), String(s.name), Number(s.ts) || Date.now()]; });
        spSh.getRange(spStart, 1, spRows.length, 2).setNumberFormat('@');
        spSh.getRange(spStart, 1, spRows.length, 3).setValues(spRows);
      }
      if (entries.designs && entries.designs.length) {
        var dnSh = ss.getSheetByName('Designs');
        var dnStart = dnSh.getLastRow() + 1;
        var dnRows = entries.designs.map(function (dItem) { return [String(dItem.id), String(dItem.name), Number(dItem.ts) || Date.now()]; });
        dnSh.getRange(dnStart, 1, dnRows.length, 2).setNumberFormat('@');
        dnSh.getRange(dnStart, 1, dnRows.length, 3).setValues(dnRows);
      }
      if (entries.models && entries.models.length) {
        var mdSh = ss.getSheetByName('Models');
        var mdStart = mdSh.getLastRow() + 1;
        var mdRows = entries.models.map(function (mItem) { return [String(mItem.id), String(mItem.name), String(mItem.design), Number(mItem.ts) || Date.now()]; });
        mdSh.getRange(mdStart, 1, mdRows.length, 3).setNumberFormat('@');
        mdSh.getRange(mdStart, 1, mdRows.length, 4).setValues(mdRows);
      }
    } else if (action === 'renameSalesperson') {
      var spShR = ss.getSheetByName('Salespeople');
      var spValsR = spShR.getDataRange().getDisplayValues();
      for (var r1 = 1; r1 < spValsR.length; r1++) {
        if (String(spValsR[r1][0] || '').trim() === String(body.id).trim()) {
          spShR.getRange(r1 + 1, 2).setNumberFormat('@').setValue(String(body.newName));
        }
      }
      var sShR = ss.getSheetByName('Samples');
      var sValsR = sShR.getDataRange().getDisplayValues();
      var oldSpKey = norm(body.oldName);
      for (var r2 = 1; r2 < sValsR.length; r2++) {
        if (norm(sValsR[r2][2]) === oldSpKey) {
          sShR.getRange(r2 + 1, 3).setNumberFormat('@').setValue(String(body.newName));
        }
      }
    } else if (action === 'renameDesign') {
      var dnShR = ss.getSheetByName('Designs');
      var dnValsR = dnShR.getDataRange().getDisplayValues();
      for (var d1 = 1; d1 < dnValsR.length; d1++) {
        if (String(dnValsR[d1][0] || '').trim() === String(body.id).trim()) {
          dnShR.getRange(d1 + 1, 2).setNumberFormat('@').setValue(String(body.newName));
        }
      }
      var oldDnKey = norm(body.oldName);
      var mdShR = ss.getSheetByName('Models');
      var mdValsR = mdShR.getDataRange().getDisplayValues();
      for (var d2 = 1; d2 < mdValsR.length; d2++) {
        if (norm(mdValsR[d2][2]) === oldDnKey) {
          mdShR.getRange(d2 + 1, 3).setNumberFormat('@').setValue(String(body.newName));
        }
      }
      var sShD = ss.getSheetByName('Samples');
      var sValsD = sShD.getDataRange().getDisplayValues();
      for (var d3 = 1; d3 < sValsD.length; d3++) {
        if (norm(sValsD[d3][3]) === oldDnKey) {
          sShD.getRange(d3 + 1, 4).setNumberFormat('@').setValue(String(body.newName));
        }
      }
    } else if (action === 'renameModel') {
      var mdShM = ss.getSheetByName('Models');
      var mdValsM = mdShM.getDataRange().getDisplayValues();
      for (var m1 = 1; m1 < mdValsM.length; m1++) {
        if (String(mdValsM[m1][0] || '').trim() === String(body.id).trim()) {
          mdShM.getRange(m1 + 1, 2, 1, 2).setNumberFormat('@').setValues([[String(body.newName), String(body.newDesign)]]);
        }
      }
      var oldPair = mkKey(body.oldDesign, body.oldName);
      var sShM = ss.getSheetByName('Samples');
      var sValsM = sShM.getDataRange().getDisplayValues();
      for (var m2 = 1; m2 < sValsM.length; m2++) {
        if (mkKey(sValsM[m2][3], sValsM[m2][4]) === oldPair) {
          sShM.getRange(m2 + 1, 4, 1, 2).setNumberFormat('@').setValues([[String(body.newDesign), String(body.newName)]]);
        }
      }
    } else if (action === 'deleteCatalog') {
      var tab = body.kind === 'salesperson' ? 'Salespeople' : body.kind === 'design' ? 'Designs' : 'Models';
      var delSh = ss.getSheetByName(tab);
      var delVals = delSh.getDataRange().getDisplayValues();
      for (var x = delVals.length - 1; x >= 1; x--) {
        if (String(delVals[x][0] || '').trim() === String(body.id).trim()) {
          delSh.deleteRow(x + 1);
          break;
        }
      }
    } else if (action === 'seedIfEmpty' && body.data) {
      var cur = readAll(ss);
      if (cur.samples.length === 0 && cur.salespeople.length === 0 && cur.designs.length === 0 && cur.models.length === 0) {
        var seed = body.data;
        if (seed.samples && seed.samples.length) {
          var s1 = ss.getSheetByName('Samples');
          s1.getRange(2, 1, seed.samples.length, 5).setNumberFormat('@');
          s1.getRange(2, 1, seed.samples.length, 11).setValues(seed.samples.map(sampleRow));
        }
        if (seed.salespeople && seed.salespeople.length) {
          var s2 = ss.getSheetByName('Salespeople');
          s2.getRange(2, 1, seed.salespeople.length, 2).setNumberFormat('@');
          s2.getRange(2, 1, seed.salespeople.length, 3).setValues(seed.salespeople.map(function (x) { return [String(x.id), String(x.name), Number(x.ts) || Date.now()]; }));
        }
        if (seed.designs && seed.designs.length) {
          var s3 = ss.getSheetByName('Designs');
          s3.getRange(2, 1, seed.designs.length, 2).setNumberFormat('@');
          s3.getRange(2, 1, seed.designs.length, 3).setValues(seed.designs.map(function (x) { return [String(x.id), String(x.name), Number(x.ts) || Date.now()]; }));
        }
        if (seed.models && seed.models.length) {
          var s4 = ss.getSheetByName('Models');
          s4.getRange(2, 1, seed.models.length, 3).setNumberFormat('@');
          s4.getRange(2, 1, seed.models.length, 4).setValues(seed.models.map(function (x) { return [String(x.id), String(x.name), String(x.design), Number(x.ts) || Date.now()]; }));
        }
      }
    }

    return jsonOut({ ok: true, title: ss.getName(), data: readAll(ss) });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err && err.message ? err.message : err) });
  } finally {
    lock.releaseLock();
  }
}
`;

interface BridgeResponse {
  ok: boolean;
  title?: string;
  data?: AppData;
  error?: string;
}

async function callBridge(
  bridgeUrl: string,
  payload?: Record<string, unknown>,
): Promise<{ title: string; data: AppData }> {
  const trimmed = bridgeUrl.trim();
  const res = await fetch(
    trimmed,
    payload
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload),
        }
      : { method: 'GET' },
  );

  const text = await res.text();
  let parsed: BridgeResponse;
  try {
    parsed = JSON.parse(text) as BridgeResponse;
  } catch {
    throw new Error(
      'Invalid response from Sheet Sync URL. Make sure the Apps Script is deployed as a Web App with access set to "Anyone".',
    );
  }

  if (!res.ok || !parsed.ok || !parsed.data) {
    throw new Error(parsed.error || `Sheet Sync failed (${res.status}).`);
  }

  return {
    title: parsed.title || 'Shared Google Sheet',
    data: parsed.data,
  };
}

export const webBridgeApi = {
  fetchAll: (bridgeUrl: string) => callBridge(bridgeUrl),
  seedIfEmpty: (bridgeUrl: string, data: AppData) =>
    callBridge(bridgeUrl, { action: 'seedIfEmpty', data }),
  appendSample: (bridgeUrl: string, record: SampleRecord) =>
    callBridge(bridgeUrl, { action: 'appendSample', record }),
  updateSample: (bridgeUrl: string, record: SampleRecord) =>
    callBridge(bridgeUrl, { action: 'updateSample', record }),
  deleteSample: (bridgeUrl: string, id: string) =>
    callBridge(bridgeUrl, { action: 'deleteSample', id }),
  appendCatalog: (
    bridgeUrl: string,
    entries: { salespeople?: SalespersonItem[]; designs?: DesignItem[]; models?: ModelItem[] },
  ) => callBridge(bridgeUrl, { action: 'appendCatalog', entries }),
  renameSalesperson: (bridgeUrl: string, id: string, oldName: string, newName: string) =>
    callBridge(bridgeUrl, { action: 'renameSalesperson', id, oldName, newName }),
  renameDesign: (bridgeUrl: string, id: string, oldName: string, newName: string) =>
    callBridge(bridgeUrl, { action: 'renameDesign', id, oldName, newName }),
  renameModel: (
    bridgeUrl: string,
    id: string,
    oldDesign: string,
    oldName: string,
    newDesign: string,
    newName: string,
  ) =>
    callBridge(bridgeUrl, {
      action: 'renameModel',
      id,
      oldDesign,
      oldName,
      newDesign,
      newName,
    }),
  deleteCatalog: (
    bridgeUrl: string,
    kind: 'salesperson' | 'design' | 'model',
    id: string,
  ) => callBridge(bridgeUrl, { action: 'deleteCatalog', kind, id }),
};
