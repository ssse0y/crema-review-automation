function safeFolder(value) {
  return String(value || "")
    .replace(/[\\:*?"<>|]/g, "_")
    .replace(/^\/+|\/+$/g, "")
    .trim();
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message.type === "runNow") {
      await chrome.storage.local.set({
        cremaAutomationRunning: true,
        cremaAutomationPhase: "review",
        liveEnabled: false,
        lastRunStatus: "running",
        lastRunMessage: "부정 리뷰를 확인하고 있습니다.",
        lastRunDetail: "",
        lastRunAt: new Date().toISOString()
      });
      const stamp = Date.now();
      await chrome.tabs.create({url: `https://admin.cre.ma/v2/review/caution_reviews?crema_auto=1&run=${stamp}`});
      sendResponse({ok: true});
      return;
    }
    if (message.type === "runStatus") {
      await chrome.storage.local.set({
        lastRunStatus: message.status,
        lastRunMessage: message.message || "",
        lastRunDetail: message.detail || "",
        lastRunAt: new Date().toISOString()
      });
      sendResponse({ok: true});
      return;
    }
    if (message.type === "capture") {
      const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, {format: "png"});
      const {captureFolder} = await settings();
      const date = new Date().toLocaleDateString("sv-SE");
      const suffix = message.index ? `_${String(message.index).padStart(2, "0")}` : `_${message.label || "진단"}`;
      const filename = `${captureFolder ? captureFolder + "/" : ""}${date}${suffix}.png`;
      const downloadId = await chrome.downloads.download({url: dataUrl, filename, conflictAction: "uniquify", saveAs: false});
      sendResponse({ok: true, downloadId, filename});
      return;
    }
    if (message.type === "captureRaw") {
      const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, {format: "png"});
      sendResponse({ok: true, dataUrl});
      return;
    }
    if (message.type === "trustedButtonClick") {
      if (!sender.tab?.id) throw new Error("클릭할 크리마 탭을 찾지 못했습니다.");
      const target = {tabId: sender.tab.id};
      let attached = false;
      try {
        await chrome.windows.update(sender.tab.windowId, {focused: true});
        await chrome.tabs.update(sender.tab.id, {active: true});
        await chrome.debugger.attach(target, "1.3");
        attached = true;
        await chrome.debugger.sendCommand(target, "Input.setIgnoreInputEvents", {ignore: false});
        const evaluated = await chrome.debugger.sendCommand(target, "Runtime.evaluate", {
          expression: `document.querySelector('[data-crema-final-pay="${message.marker}"]')`,
          returnByValue: false
        });
        const objectId = evaluated?.result?.objectId;
        if (!objectId) throw new Error("Chrome 페이지 영역에서 최종 지급 버튼을 찾지 못했습니다.");
        await chrome.debugger.sendCommand(target, "DOM.scrollIntoViewIfNeeded", {objectId});
        await chrome.debugger.sendCommand(target, "Runtime.callFunctionOn", {
          objectId,
          functionDeclaration: "function() { this.focus({preventScroll: true}); }"
        });
        const rectResult = await chrome.debugger.sendCommand(target, "Runtime.callFunctionOn", {
          objectId,
          functionDeclaration: "function() { const r = this.getBoundingClientRect(); return {left:r.left, top:r.top, width:r.width, height:r.height}; }",
          returnByValue: true
        });
        const rect = rectResult?.result?.value;
        if (!rect || rect.width < 1 || rect.height < 1) throw new Error("최종 지급 버튼의 화면 위치를 확인하지 못했습니다.");
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const hitTest = await chrome.debugger.sendCommand(target, "Runtime.evaluate", {
          expression: `(() => { const hit=document.elementFromPoint(${x},${y}); const button=document.querySelector('[data-crema-final-pay="${message.marker}"]'); return !!(hit && button && (hit===button || button.contains(hit))); })()`,
          returnByValue: true
        });
        if (hitTest?.result?.value !== true) throw new Error("계산된 위치가 파란 적립금 지급 버튼과 일치하지 않아 클릭을 중단했습니다.");
        await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
          type: "mouseMoved", x, y
        });
        await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
          type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1
        });
        await new Promise(resolve => setTimeout(resolve, 120));
        await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
          type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1
        });
        await new Promise(resolve => setTimeout(resolve, 1500));
        sendResponse({ok: true, info: {method: "verified-dynamic-button-position"}});
      } finally {
        if (attached) await chrome.debugger.detach(target).catch(() => {});
      }
      return;
    }
    if (message.type === "saveCapture") {
      const {captureFolder} = await settings();
      const date = new Date().toLocaleDateString("sv-SE");
      const filename = `${captureFolder ? captureFolder + "/" : ""}${date}_${String(message.index).padStart(2, "0")}_${message.part}${message.page > 1 ? `_${String(message.page).padStart(2, "0")}` : ""}.png`;
      const downloadId = await chrome.downloads.download({url: message.dataUrl, filename, conflictAction: "uniquify", saveAs: false});
      sendResponse({ok: true, downloadId, filename});
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
      await chrome.storage.local.set({pendingReviewRows: [], pendingReviewSavedAt: ""});
      sendResponse({ok: true, ...result});
      return;
    }
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
