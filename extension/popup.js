const button = document.getElementById("run");
const status = document.getElementById("status");
const folder = document.getElementById("folder");
const editArea = document.getElementById("editArea");
const savedArea = document.getElementById("savedArea");
const savedPath = document.getElementById("savedPath");
const save = document.getElementById("save");
const edit = document.getElementById("edit");
const openDownloads = document.getElementById("openDownloads");
const sheetEditArea = document.getElementById("sheetEditArea");
const sheetSavedArea = document.getElementById("sheetSavedArea");
const sheetUrl = document.getElementById("sheetUrl");
const savedSheetUrl = document.getElementById("savedSheetUrl");
const saveSheet = document.getElementById("saveSheet");
const editSheet = document.getElementById("editSheet");

function showSaved(value) {
  folder.value = value;
  savedPath.textContent = value
    ? `Chrome 기본 다운로드 폴더\\${value.replaceAll("/", "\\")}`
    : "Chrome 기본 다운로드 폴더";
  editArea.classList.add("hidden");
  savedArea.classList.remove("hidden");
}

chrome.storage.local.get({captureFolder: "", captureFolderSaved: true}).then(data => {
  folder.value = data.captureFolder;
  if (data.captureFolderSaved) showSaved(data.captureFolder);
});

save.addEventListener("click", async () => {
  const value = folder.value.trim();
  await chrome.storage.local.set({captureFolder: value, captureFolderSaved: true});
  showSaved(value);
  status.textContent = "저장 경로를 저장했습니다.";
});

edit.addEventListener("click", () => {
  savedArea.classList.add("hidden");
  editArea.classList.remove("hidden");
  folder.focus();
});

openDownloads.addEventListener("click", async () => {
  await chrome.tabs.create({url: "chrome://settings/downloads"});
  window.close();
});

function showSavedSheet(value) {
  sheetUrl.value = value;
  savedSheetUrl.href = value;
  savedSheetUrl.title = value;
  sheetEditArea.classList.add("hidden");
  sheetSavedArea.classList.remove("hidden");
}

chrome.storage.local.get({reviewSheetUrl: "", reviewSheetUrlSaved: false}).then(data => {
  sheetUrl.value = data.reviewSheetUrl;
  if (data.reviewSheetUrlSaved && data.reviewSheetUrl) showSavedSheet(data.reviewSheetUrl);
});

saveSheet.addEventListener("click", async () => {
  const value = sheetUrl.value.trim();
  if (!/^https:\/\/docs\.google\.com\/spreadsheets\//.test(value)) {
    status.textContent = "Google 스프레드시트 주소를 확인해주세요.";
    return;
  }
  await chrome.storage.local.set({
    reviewSheetUrl: value,
    reviewSheetUrlSaved: true,
    targetSheetName: "크리마 부정리뷰 모음"
  });
  showSavedSheet(value);
  status.textContent = "부정리뷰 기록 링크를 저장했습니다.";
});

editSheet.addEventListener("click", () => {
  sheetSavedArea.classList.add("hidden");
  sheetEditArea.classList.remove("hidden");
  sheetUrl.focus();
});

savedSheetUrl.addEventListener("click", async event => {
  event.preventDefault();
  if (savedSheetUrl.href) await chrome.tabs.create({url: savedSheetUrl.href});
});

button.addEventListener("click", async () => {
  await chrome.storage.local.set({captureFolder: folder.value.trim()});
  button.disabled = true;
  status.textContent = "관리자 화면을 여는 중입니다…";
  const result = await chrome.runtime.sendMessage({type: "runNow"});
  status.textContent = result?.ok ? "실행을 시작했습니다." : "실행하지 못했습니다.";
  setTimeout(() => window.close(), 900);
});
