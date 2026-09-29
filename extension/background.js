function safeFolder(value) {
  return String(value || "")
    .replace(/[\\:*?"<>|]/g, "_")
    .replace(/^\/+|\/+$/g, "")
    .trim();
}

function safeFilenamePart(value) {
  return String(value || "").replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, "_").slice(0, 60);
}

let lastCaptureAt = 0;
async function waitForCaptureSlot() {
  const remaining = 650 - (Date.now() - lastCaptureAt);
  if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
  lastCaptureAt = Date.now();
}

async function captureSenderTab(sender) {
  const tabId = sender.tab?.id;
  const windowId = sender.tab?.windowId;
  if (tabId === undefined || windowId === undefined) throw new Error("캡처할 크리마 탭을 찾지 못했습니다.");
  const runState = await chrome.storage.local.get({activeCremaAutomationTabId: null});
  if (runState.activeCremaAutomationTabId !== tabId) {
    throw new Error("작업 탭이 아닌 다른 탭에서 들어온 캡처 요청을 차단했습니다.");
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    await chrome.tabs.update(tabId, {active: true});
    await new Promise(resolve => setTimeout(resolve, 300));
    const [activeBefore] = await chrome.tabs.query({active: true, windowId});
    if (activeBefore?.id !== tabId) continue;
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {format: "png"});
    const [activeAfter] = await chrome.tabs.query({active: true, windowId});
    if (activeAfter?.id === tabId) return dataUrl;
  }
  throw new Error("캡처 도중 다른 탭이 활성화되어 크리마 화면을 찍지 못했습니다. 작업 탭을 그대로 둔 뒤 다시 시도해주세요.");
}

async function waitForDownload(downloadId, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const items = await chrome.downloads.search({id: downloadId});
    const item = items[0];
    if (item?.state === "complete") return item;
    if (item?.state === "interrupted") throw new Error(`파일 저장이 중단되었습니다: ${item.error || "원인 미상"}`);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error("파일 저장 완료를 30초 안에 확인하지 못했습니다.");
}

async function settings() {
  const data = await chrome.storage.local.get({captureFolder: ""});
  return {captureFolder: safeFolder(data.captureFolder)};
}

function parseSpreadsheet(url) {
  const id = String(url || "").match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)?.[1] || "";
  const gid = String(url || "").match(/(?:[#?&]gid=)(\d+)/)?.[1];
  return {spreadsheetId: id, sheetId: gid === undefined ? null : Number(gid)};
}

function captureDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("crema-captures", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("captures", {keyPath: "id", autoIncrement: true});
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function captureStore(mode, value) {
  const db = await captureDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("captures", "readwrite");
    const store = transaction.objectStore("captures");
    const request = mode === "add" ? store.add(value) : mode === "all" ? store.getAll() : store.clear();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
  });
}

async function resetRunCaptures() {
  await captureStore("clear");
}

function localDateKey(value = new Date()) {
  return new Date(value).toLocaleDateString("sv-SE");
}

async function expirePreviousDayResults() {
  const data = await chrome.storage.local.get({lastRunAt: "", cremaAutomationRunning: false});
  if (data.cremaAutomationRunning || (data.lastRunAt && localDateKey(data.lastRunAt) === localDateKey())) return false;
  await captureStore("clear");
  await chrome.storage.local.set({
    lastRunStatus: "",
    lastRunMessage: "",
    lastRunDetail: "",
    lastRunAt: ""
  });
  return true;
}

async function downloadStagedCaptures() {
  const captures = await captureStore("all");
  if (!captures.length) return 0;
  for (const capture of captures) {
    await chrome.downloads.download({
      url: capture.dataUrl,
      filename: capture.filename,
      conflictAction: "uniquify",
      saveAs: false
    });
  }
  await captureStore("clear");
  return captures.length;
}

chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
  if (!notificationId.startsWith("crema-") || buttonIndex !== 0) return;
  try {
    await expirePreviousDayResults();
    const count = await downloadStagedCaptures();
    await chrome.notifications.clear(notificationId);
    await chrome.notifications.create(`crema-download-${Date.now()}`, {
      type: "basic",
      iconUrl: "icon.png",
      title: "부정리뷰 캡처 다운로드",
      message: count ? `${count}개의 캡처본 다운로드를 시작했습니다.` : "다운로드할 캡처본이 없습니다."
    });
  } catch (error) {
    await chrome.notifications.create(`crema-download-error-${Date.now()}`, {
      type: "basic",
      iconUrl: "icon.png",
      title: "캡처본 다운로드 오류",
      message: String(error)
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message.type === "isAutomationTab") {
      const data = await chrome.storage.local.get({activeCremaAutomationTabId: null});
      sendResponse({ok: true, allowed: sender.tab?.id === data.activeCremaAutomationTabId});
      return;
    }
    if (message.type === "runNow") {
      await resetRunCaptures();
      const tab = await chrome.tabs.create({url: "about:blank", active: false});
      await chrome.storage.local.set({
        cremaAutomationRunning: true,
        activeCremaAutomationTabId: tab.id,
        cremaAutomationPhase: "review",
        liveEnabled: false,
        lastRunStatus: "running",
        lastRunMessage: "부정 리뷰를 확인하고 있습니다.",
        lastRunDetail: "",
        lastRunAt: new Date().toISOString()
      });
      const stamp = Date.now();
      await chrome.tabs.update(tab.id, {url: `https://admin.cre.ma/v2/review/new_reviews?tab=mileage_required&crema_auto=1&run=${stamp}`});
      sendResponse({ok: true});
      return;
    }
    if (message.type === "runCaptureTest") {
      await resetRunCaptures();
      const tab = await chrome.tabs.create({url: "about:blank", active: false});
      await chrome.storage.local.set({
        cremaAutomationRunning: true,
        activeCremaAutomationTabId: tab.id,
        cremaAutomationPhase: "capture_test",
        lastRunStatus: "running",
        lastRunMessage: "현재 목록의 부정리뷰 캡처·시트 기록을 테스트하고 있습니다.",
        lastRunDetail: "",
        lastRunAt: new Date().toISOString()
      });
      const stamp = Date.now();
      await chrome.tabs.update(tab.id, {url: `https://admin.cre.ma/v2/review/new_reviews?tab=mileage_required&crema_auto=1&run=${stamp}`});
      sendResponse({ok: true});
      return;
    }
    if (message.type === "runSheetTest") {
      await resetRunCaptures();
      const tab = await chrome.tabs.create({url: "about:blank", active: false});
      await chrome.storage.local.set({
        cremaAutomationRunning: true,
        activeCremaAutomationTabId: tab.id,
        cremaAutomationPhase: "sheet_test",
        lastRunStatus: "running",
        lastRunMessage: "첫 번째 리뷰를 스프레드시트에 기록하고 있습니다.",
        lastRunDetail: "",
        lastRunAt: new Date().toISOString()
      });
      const stamp = Date.now();
      await chrome.tabs.update(tab.id, {url: `https://admin.cre.ma/v2/review/new_reviews?tab=mileage_required&crema_auto=1&run=${stamp}`});
      sendResponse({ok: true});
      return;
    }
    if (message.type === "getStagedCaptures") {
      await expirePreviousDayResults();
      const captures = await captureStore("all");
      const captureDate = captures[0]?.filename?.match(/(?:^|\/)(\d{4}-\d{2}-\d{2})/)?.[1] || "";
      sendResponse({ok: true, count: captures.length, captureDate});
      return;
    }
    if (message.type === "downloadStagedCaptures") {
      const count = await downloadStagedCaptures();
      sendResponse({ok: true, count});
      return;
    }
    if (message.type === "runStatus") {
      await chrome.storage.local.set({
        lastRunStatus: message.status,
        lastRunMessage: message.message || "",
        lastRunDetail: message.detail || "",
        lastRunAt: new Date().toISOString()
      });
      if (message.status === "success" || message.status === "error") {
        const notificationId = `crema-${Date.now()}`;
        const stagedCaptures = await captureStore("all");
        const canDownload = stagedCaptures.length > 0;
        await chrome.notifications.create(notificationId, {
          type: "basic",
          iconUrl: "icon.png",
          title: message.status === "success" ? "크리마 작업 완료" : "크리마 작업 실패",
          message: `${message.message || (message.status === "success" ? "작업이 완료되었습니다." : "작업 중 오류가 발생했습니다.")}${canDownload ? "\n아래 버튼을 눌러 캡처본을 내려받으세요." : ""}`,
          buttons: canDownload ? [{title: "캡처본 다운받기"}] : [],
          priority: message.status === "error" ? 2 : 1
        });
      }
      sendResponse({ok: true});
      return;
    }
    if (message.type === "capture") {
      await waitForCaptureSlot();
      const dataUrl = await captureSenderTab(sender);
      const {captureFolder} = await settings();
      const date = new Date().toLocaleDateString("sv-SE");
      const suffix = message.index ? `_${String(message.index).padStart(2, "0")}` : `_${message.label || "진단"}`;
      const filename = `${captureFolder ? captureFolder + "/" : ""}${date}${suffix}.png`;
      await captureStore("add", {dataUrl, filename});
      sendResponse({ok: true, filename, savedPath: `임시 보관: ${filename}`});
      return;
    }
    if (message.type === "captureRaw") {
      await waitForCaptureSlot();
      const dataUrl = await captureSenderTab(sender);
      sendResponse({ok: true, dataUrl});
      return;
    }
    if (message.type === "mainWorldFinalPay") {
      if (!sender.tab?.id) throw new Error("클릭할 크리마 탭을 찾지 못했습니다.");
      const results = await chrome.scripting.executeScript({
        target: {tabId: sender.tab.id, frameIds: [sender.frameId]},
        world: "MAIN",
        func: marker => {
          const button = document.querySelector(
            `[data-crema-final-pay="${marker}"][class*="AppButton__button--style-blue"]`
          );
          if (!button || button.innerText.replace(/\s+/g, "").trim() !== "적립금지급" || button.disabled) {
            return {ok: false, error: "모달 하단의 활성 파란 적립금 지급 버튼을 찾지 못했습니다."};
          }
          button.click();
          return {ok: true, info: {className: button.className, text: button.innerText}};
        },
        args: [message.marker]
      });
      sendResponse(results[0]?.result || {ok: false, error: "최종 지급 버튼 실행 결과를 받지 못했습니다."});
      return;
    }
    if (message.type === "saveCapture") {
      const {captureFolder} = await settings();
      const dateMatch = String(message.reviewDate || "").match(/(20\d{2})\D+(\d{1,2})\D+(\d{1,2})/);
      const date = dateMatch
        ? `${dateMatch[1]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[3].padStart(2, "0")}`
        : new Date().toLocaleDateString("sv-SE");
      const authorName = safeFilenamePart(message.authorName) || "이름없음";
      const hasRating = message.rating !== null && message.rating !== undefined && message.rating !== "";
      const rating = Number(message.rating);
      const ratingLabel = hasRating && Number.isFinite(rating) ? `별점${rating}개` : "별점미확인";
      const filename = `${captureFolder ? captureFolder + "/" : ""}${date}_${authorName}_${ratingLabel}_${message.part}${message.page > 1 ? `_${String(message.page).padStart(2, "0")}` : ""}.png`;
      await captureStore("add", {dataUrl: message.dataUrl, filename});
      sendResponse({ok: true, filename, savedPath: `임시 보관: ${filename}`});
      return;
    }
    if (message.type === "log") {
      const prior = await chrome.storage.local.get({automationLog: []});
      const entry = `[${new Date().toLocaleString("ko-KR")}] ${message.message}`;
      await chrome.storage.local.set({automationLog: [...prior.automationLog.slice(-199), entry]});
      sendResponse({ok: true});
      return;
    }
    if (message.type === "reviews") {
      await chrome.storage.local.set({
        pendingReviewRows: message.rows || [],
        pendingReviewSavedAt: new Date().toISOString()
      });
      sendResponse({ok: true, stored: "pendingReviewRows"});
      return;
    }
    if (message.type === "writeSheet") {
      const config = await chrome.storage.local.get({
        reviewSheetUrl: "",
        targetSheetName: "",
        sheetWebAppUrl: "",
        sheetApiKey: "",
        pendingReviewRows: []
      });
      const rows = message.rows || config.pendingReviewRows || [];
      const target = parseSpreadsheet(config.reviewSheetUrl);
      if (!target.spreadsheetId) throw new Error("부정리뷰 기록 링크가 올바르지 않습니다.");
      if (!config.sheetWebAppUrl || !config.sheetApiKey) throw new Error("Google Sheets 권한 연결이 필요합니다.");
      const response = await fetch(config.sheetWebAppUrl, {
        method: "POST",
        headers: {"Content-Type": "text/plain;charset=utf-8"},
        body: JSON.stringify({
          apiKey: config.sheetApiKey,
          spreadsheetId: target.spreadsheetId,
          sheetId: target.sheetId,
          sheetName: config.targetSheetName || "",
          rows
        }),
        redirect: "follow"
      });
      if (!response.ok) throw new Error(`Google Sheets 연결 오류 (${response.status})`);
      const result = await response.json();
      if (!result.ok) throw new Error(result.error || "Google Sheets 기록 실패");
      const inserted = Number(result.inserted || 0);
      const skipped = Number(result.skipped || 0);
      if (rows.length && inserted + skipped !== rows.length) {
        throw new Error(`시트 서버가 ${rows.length}건 중 ${inserted}건 기록, ${skipped}건 중복으로 응답했습니다. 실제 처리 건수가 맞지 않습니다.`);
      }
      await chrome.storage.local.set({pendingReviewRows: [], pendingReviewSavedAt: ""});
      sendResponse({ok: true, ...result, inserted, skipped});
      return;
    }
    sendResponse({ok: false, error: `알 수 없는 메시지입니다: ${String(message.type || "유형 없음")}`});
  })().catch(async error => {
    const prior = await chrome.storage.local.get({automationLog: []});
    await chrome.storage.local.set({
      automationLog: [...prior.automationLog.slice(-199), `[${new Date().toLocaleString("ko-KR")}] 백그라운드 오류: ${error}`],
      lastRunStatus: "error",
      lastRunMessage: "캡처본 저장 중 오류가 발생했습니다.",
      lastRunDetail: String(error),
      lastRunAt: new Date().toISOString()
    });
    sendResponse({ok: false, error: String(error)});
  });
  return true;
});
