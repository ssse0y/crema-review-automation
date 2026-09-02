const button = document.getElementById("run");
const status = document.getElementById("status");
const folder = document.getElementById("folder");
const editArea = document.getElementById("editArea");
const savedArea = document.getElementById("savedArea");
const savedPath = document.getElementById("savedPath");
const save = document.getElementById("save");
const edit = document.getElementById("edit");

function showSaved(value) {
  folder.value = value;
  savedPath.textContent = `Chrome 기본 다운로드 폴더\\${value.replaceAll("/", "\\")}`;
  editArea.classList.add("hidden");
  savedArea.classList.remove("hidden");
}

chrome.storage.local.get({captureFolder: "부정리뷰", captureFolderSaved: false}).then(data => {
  folder.value = data.captureFolder;
  if (data.captureFolderSaved) showSaved(data.captureFolder);
});

save.addEventListener("click", async () => {
  const value = folder.value.trim() || "부정리뷰";
  await chrome.storage.local.set({captureFolder: value, captureFolderSaved: true});
  showSaved(value);
  status.textContent = "저장 경로를 저장했습니다.";
});

edit.addEventListener("click", () => {
  savedArea.classList.add("hidden");
  editArea.classList.remove("hidden");
  folder.focus();
});

button.addEventListener("click", async () => {
  await chrome.storage.local.set({captureFolder: folder.value.trim() || "부정리뷰"});
  button.disabled = true;
  status.textContent = "관리자 화면을 여는 중입니다…";
  const result = await chrome.runtime.sendMessage({type: "runNow"});
  status.textContent = result?.ok ? "실행을 시작했습니다." : "실행하지 못했습니다.";
  setTimeout(() => window.close(), 900);
});
