const EXPECTED_HEADERS = ['ID', '작성일', '상품명', '리뷰 내용'];

function setupApiKey() {
  const key = Utilities.getUuid() + Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperty('CREMA_API_KEY', key);
  console.log('연결 키: ' + key);
  return key;
}

function doGet() {
  return jsonResponse_({ok: true, service: 'crema-review-sheet'});
}

function doPost(e) {
  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const expectedKey = PropertiesService.getScriptProperties().getProperty('CREMA_API_KEY');
    if (!expectedKey || payload.apiKey !== expectedKey) throw new Error('연결 키가 올바르지 않습니다.');
    if (!payload.spreadsheetId) throw new Error('스프레드시트 ID가 없습니다.');

    const workbook = SpreadsheetApp.openById(payload.spreadsheetId);
    let sheet = null;
    if (payload.sheetName) sheet = workbook.getSheetByName(payload.sheetName);
    if (!sheet && payload.sheetId !== null && payload.sheetId !== undefined) {
      sheet = workbook.getSheets().find(item => String(item.getSheetId()) === String(payload.sheetId));
    }
    if (!sheet && !payload.sheetName) sheet = workbook.getSheets()[0];
    if (!sheet) throw new Error('지정한 시트 탭을 찾을 수 없습니다.');

    const headers = sheet.getRange(1, 1, 1, 4).getDisplayValues()[0];
    if (headers.join('|') !== EXPECTED_HEADERS.join('|')) {
      throw new Error('A1:D1 헤더가 ID / 작성일 / 상품명 / 리뷰 내용과 일치하지 않습니다.');
    }

    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    if (!rows.length) return jsonResponse_({ok: true, inserted: 0, skipped: 0});
    const lastRow = Math.max(sheet.getLastRow(), 1);
    const existing = lastRow > 1
      ? new Set(sheet.getRange(2, 1, lastRow - 1, 3).getDisplayValues().map(row => row.map(String).join('|')))
      : new Set();
    const uniqueRows = rows.filter(row => {
      if (!row || !row.id) return false;
      const key = [String(row.id), normalizeDate_(row.date), String(row.product || '')].join('|');
      if (existing.has(key)) return false;
      existing.add(key);
      return true;
    });
    const skipped = rows.length - uniqueRows.length;
    if (!uniqueRows.length) return jsonResponse_({ok: true, inserted: 0, skipped});

    const values = uniqueRows.map(row => [
      String(row.id || ''),
      parseDate_(row.date),
      String(row.product || ''),
      String(row.content || '')
    ]);
    const startRow = lastRow + 1;
    sheet.getRange(startRow, 1, values.length, 4).setValues(values);
    if (lastRow >= 2) {
      sheet.getRange(lastRow, 1, 1, 4).copyFormatToRange(sheet, 1, 4, startRow, startRow + values.length - 1);
    }
    sheet.getRange(startRow, 2, values.length, 1).setNumberFormat('yyyy. M. d');
    SpreadsheetApp.flush();
    return jsonResponse_({ok: true, inserted: values.length, skipped, sheetName: sheet.getName()});
  } catch (error) {
    return jsonResponse_({ok: false, error: String(error && error.message || error)});
  }
}

function parseDate_(value) {
  const match = String(value || '').match(/(20\d{2})\D+(\d{1,2})\D+(\d{1,2})/);
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : String(value || '');
}

function normalizeDate_(value) {
  const match = String(value || '').match(/(20\d{2})\D+(\d{1,2})\D+(\d{1,2})/);
  return match ? `${match[1]}. ${Number(match[2])}. ${Number(match[3])}` : String(value || '');
}

function jsonResponse_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
