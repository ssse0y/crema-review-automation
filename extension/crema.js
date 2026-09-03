(() => {
  const RUN_KEY = "cremaAutomationRunning";
  const ANGER = [
    "구매하지 마", "사지 마", "사지마", "비추천", "절대 사지", "진짜 구매하지",
    "화딱지", "화가", "화남", "짜증", "열받", "스트레스", "최악", "실망", "답답", "황당",
    "다시는", "환불", "교환", "돈 아깝", "돈아깝", "구림", "심하다", "말도 안",
    "안됩니다", "안 됩니다", "못 쓰", "못쓰", "쓰지 못", "불량", "충격", "후회"
  ];
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const visible = el => !!(el && el.getClientRects().length);
  const log = message => chrome.runtime.sendMessage({type: "log", message}).catch(() => {});
  const setStatus = (status, message, detail = "") => chrome.runtime.sendMessage({type: "runStatus", status, message, detail}).catch(() => {});
  const compact = text => (text || "").replace(/\s+/g, "").trim();
  let currentStage = "작업 시작";

  function findClickable(text) {
    const wanted = compact(text);
    const primary = [...document.querySelectorAll("button,a,[role=button],[onclick]")]
      .find(el => visible(el) && compact(el.innerText).includes(wanted));
    if (primary) return primary;
    // 일부 크리마 좌측 메뉴는 이벤트가 연결된 일반 div/span으로 렌더링된다.
    const leaf = [...document.querySelectorAll("body *")]
      .find(el => visible(el) && compact(el.innerText) === wanted && el.children.length <= 2);
    return leaf ? (leaf.closest("button,a,[role=button],[onclick]") || leaf) : null;
  }

  async function click(text) {
    for (let i = 0; i < 20; i++) {
      const el = findClickable(text);
      if (el) {
        el.scrollIntoView({block: "center"});
        el.click();
        await wait(1300);
        return true;
      }
      await wait(500);
    }
    return false;
  }

  function findExactClickable(text, root = document) {
    const wanted = compact(text);
    return [...root.querySelectorAll("button,a,[role=button],[onclick]")]
      .find(el => visible(el) && compact(el.innerText) === wanted);
  }

  async function clickExact(text, root = document, timeout = 5000) {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      const el = findExactClickable(text, root);
      if (el) {
        el.scrollIntoView({block: "center"});
        el.click();
        await wait(700);
        return true;
      }
      await wait(200);
    }
    return false;
  }

  function masterCheckbox() {
    const tables = [...document.querySelectorAll("table")].filter(visible);
    for (const table of tables) {
      const checkbox = table.querySelector("thead input[type='checkbox'],thead [role='checkbox']");
      if (checkbox && visible(checkbox)) return checkbox;
    }
    const header = [...document.querySelectorAll("thead")].find(visible);
    const headerCheckbox = header?.querySelector("input[type='checkbox'],[role='checkbox']");
    if (headerCheckbox) return headerCheckbox;
    // 크리마가 표를 div 기반으로 렌더링하는 경우 화면에서 가장 위에 있는
    // 목록용 체크박스를 전체 선택 체크박스로 사용한다.
    const candidates = [...document.querySelectorAll("input[type='checkbox'],[role='checkbox'],label")]
      .filter(el => {
        const target = el.matches("label") ? el.querySelector("input[type='checkbox']") : el;
        const rect = el.getBoundingClientRect();
        return target && visible(el) && rect.width >= 12 && rect.height >= 12 && rect.top > 60;
      })
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    return candidates[0] || null;
  }

  async function payAllRewards() {
    const checkbox = masterCheckbox();
    if (!checkbox) throw new Error("적립금 지급 목록의 전체 선택 체크박스를 찾지 못했습니다.");
    const checked = checkbox.matches("input") ? checkbox.checked : checkbox.getAttribute("aria-checked") === "true";
    if (!checked) checkbox.click();
    await wait(700);

    const payButton = findExactClickable("적립금 지급");
    if (!payButton) throw new Error("전체 선택 후 나타나는 ‘적립금 지급’ 버튼을 찾지 못했습니다.");
    payButton.scrollIntoView({block: "center"});
    payButton.click();
    await wait(500);

    let dialog = null;
    for (let i = 0; i < 25; i++) {
      const title = [...document.querySelectorAll("body *")].find(el => {
        const text = compact(el.innerText);
        return visible(el) && el.children.length <= 3 && text.startsWith("적립금지급") && text.includes("선택리뷰");
      });
      if (title) {
        dialog = title.closest("[role='dialog'],.modal,.ant-modal,.MuiDialog-root");
        if (!dialog) {
          let candidate = title;
          for (let depth = 0; depth < 8 && candidate.parentElement; depth++) {
            candidate = candidate.parentElement;
            const rect = candidate.getBoundingClientRect();
            if (rect.width >= 450 && rect.height >= 280 && findExactClickable("적립금 지급", candidate)) {
              dialog = candidate;
              break;
            }
          }
        }
        if (dialog && visible(dialog)) break;
      }
      await wait(200);
    }
    if (!dialog) throw new Error("목록의 적립금 지급 버튼을 눌렀지만 최종 지급 팝업이 열리지 않았습니다.");

    const finalPayButton = findExactClickable("적립금 지급", dialog);
    if (!finalPayButton) throw new Error("최종 지급 팝업의 파란 ‘적립금 지급’ 버튼을 찾지 못했습니다.");
    // 최종 버튼을 누르기 직전에 다음 단계를 저장해 새로고침 후 중복 지급을 막는다.
    await chrome.storage.local.set({cremaAutomationPhase: "capture"});
    finalPayButton.click();
    for (let i = 0; i < 30 && visible(dialog); i++) await wait(200);
    if (visible(dialog)) throw new Error("최종 적립금 지급 후에도 지급 팝업이 닫히지 않았습니다. 입력값 또는 오류 메시지를 확인해주세요.");
    await log("최종 적립금 지급 버튼 1회 클릭 완료");
  }

  function containerFor(status) {
    let el = status;
    for (let i = 0; i < 8 && el.parentElement; i++, el = el.parentElement) {
      const text = el.innerText || "";
      if (text.length >= 40 && (/[\s_-]review[\s_-]|review-/i.test(el.className || "") || ["TR", "LI", "ARTICLE"].includes(el.tagName))) return el;
    }
    return el;
  }

  function isTwoStars(el) {
    const text = el.innerText || "";
    if (/(별점|평점)\s*[:：]?\s*2(?:\.0)?\s*점?/.test(text)) return true;
    const labels = [...el.querySelectorAll("[aria-label],[title]")]
      .map(x => `${x.getAttribute("aria-label") || ""} ${x.getAttribute("title") || ""}`).join(" ");
    return /(2점|별점\s*2|평점\s*2)/.test(labels);
  }

  function parse(el) {
    const raw = (el.innerText || "").trim();
    const lines = raw.split(/\n+/).map(x => x.trim()).filter(Boolean);
    const id = (raw.match(/[\w.-]+@[\w.-]+|\b\d{6,}\b/) || [""])[0];
    const date = (raw.match(/20\d{2}[.\-/]\s*\d{1,2}[.\-/]\s*\d{1,2}/) || [new Date().toISOString().slice(0, 10)])[0];
    const candidates = lines.filter(x => !["부정 리뷰", "별점 2", "2점"].includes(x) && x !== id && !x.includes(date));
    return {id, date, product: candidates[0] || "", content: candidates.slice(1).join("\n") || raw, raw};
  }

  function exactText(root, text) {
    const wanted = compact(text);
    return [...root.querySelectorAll("*")]
      .find(el => visible(el) && compact(el.innerText) === wanted && el.children.length <= 2);
  }

  function modalRoot() {
    const title = [...document.querySelectorAll("body *")]
      .find(el => visible(el) && compact(el.innerText).startsWith("리뷰상세") && el.children.length <= 3);
    if (!title) return null;
    return title.closest("[role='dialog'],.modal,.ant-modal,.MuiDialog-root") || (() => {
      let el = title;
      for (let i = 0; i < 8 && el.parentElement; i++, el = el.parentElement) {
        const r = el.getBoundingClientRect();
        if (r.width > 500 && r.height > 400 && r.width < innerWidth * .9) return el;
      }
      return title.parentElement;
    })();
  }

  function scrollBox(modal) {
    return [...modal.querySelectorAll("*")]
      .filter(el => visible(el) && el.scrollHeight > el.clientHeight + 30)
      .sort((a, b) => b.clientHeight - a.clientHeight)[0] || modal;
  }

  async function waitForModal() {
    for (let i = 0; i < 30; i++) {
      const modal = modalRoot();
      if (modal) return modal;
      await wait(200);
    }
    return null;
  }

  function labelValue(modal, label) {
    const node = exactText(modal, label);
    if (!node) return "";
    const parentLines = (node.parentElement?.innerText || "").split(/\n+/).map(x => x.trim()).filter(Boolean);
    const at = parentLines.findIndex(x => compact(x) === compact(label));
    if (at >= 0 && parentLines[at + 1]) return parentLines[at + 1];
    const next = node.nextElementSibling;
    return (next?.innerText || next?.textContent || "").trim();
  }

  function sectionText(modal, heading) {
    const node = exactText(modal, heading);
    if (!node) return "";
    let next = node.nextElementSibling;
    if (!next && node.parentElement) next = node.parentElement.nextElementSibling;
    return (next?.innerText || next?.textContent || "").trim();
  }

  function productName(modal) {
    const change = exactText(modal, "상품 변경");
    const box = change?.parentElement?.parentElement;
    const lines = (box?.innerText || "").split(/\n+/).map(x => x.trim()).filter(Boolean);
    return lines.find(x => !/^(상품 변경|리뷰 복사|부정 리뷰|상세보기|[\d,]+원|CREMA)/.test(x)) || "";
  }

  async function cropScreenshot(rect) {
    const raw = await chrome.runtime.sendMessage({type: "captureRaw"});
    if (!raw?.ok) throw new Error(raw?.error || "화면 캡처 실패");
    const image = new Image();
    image.src = raw.dataUrl;
    await image.decode();
    const scaleX = image.naturalWidth / innerWidth;
    const scaleY = image.naturalHeight / innerHeight;
    const x = Math.max(0, rect.left);
    const y = Math.max(0, rect.top);
    const width = Math.min(innerWidth - x, rect.width);
    const height = Math.min(innerHeight - y, rect.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scaleX));
    canvas.height = Math.max(1, Math.round(height * scaleY));
    canvas.getContext("2d").drawImage(image, x * scaleX, y * scaleY, width * scaleX, height * scaleY, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  }

  async function captureRange(scroller, modal, startNode, endNode, index, part) {
    if (!startNode || !endNode) return 0;
    const scrollerRect = scroller.getBoundingClientRect();
    const startContent = scroller.scrollTop + startNode.getBoundingClientRect().top - scrollerRect.top;
    const endContent = scroller.scrollTop + endNode.getBoundingClientRect().bottom - scrollerRect.top;
    const available = Math.min(scroller.clientHeight, innerHeight - Math.max(0, scrollerRect.top)) - 8;
    let offset = startContent;
    let page = 1;
    while (offset < endContent - 2) {
      scroller.scrollTop = Math.max(0, offset - 4);
      await wait(350);
      const top = Math.max(scrollerRect.top, 0);
      const height = Math.min(available, endContent - offset + 8);
      const rect = {left: modal.getBoundingClientRect().left, top, width: modal.getBoundingClientRect().width, height};
      const dataUrl = await cropScreenshot(rect);
      const saved = await chrome.runtime.sendMessage({type: "saveCapture", dataUrl, index, part, page});
      if (!saved?.ok) throw new Error(`${part} 캡처 저장 실패: ${saved?.error || "알 수 없는 오류"}`);
      offset += Math.max(100, available - 12);
      page++;
    }
    return page - 1;
  }

  async function captureVisibleRect(rect, index, part) {
    const bounded = {
      left: Math.max(0, rect.left),
      top: Math.max(0, rect.top),
      width: Math.min(innerWidth - Math.max(0, rect.left), rect.width),
      height: Math.min(innerHeight - Math.max(0, rect.top), rect.height)
    };
    const dataUrl = await cropScreenshot(bounded);
    const saved = await chrome.runtime.sendMessage({type: "saveCapture", dataUrl, index, part, page: 1});
    if (!saved?.ok) throw new Error(`${part} 캡처 저장 실패: ${saved?.error || "알 수 없는 오류"}`);
  }

  function reviewDetailCell(row) {
    const table = row.closest("table");
    const headers = table ? [...table.querySelectorAll("thead th")] : [];
    const index = headers.findIndex(th => compact(th.innerText).includes("리뷰상세내용"));
    if (index >= 0 && row.cells?.[index]) return row.cells[index];
    const cells = [...row.querySelectorAll("td")].filter(visible);
    return cells.sort((a, b) => (b.innerText || "").length - (a.innerText || "").length)[0] || row;
  }

  async function closeModal(modal) {
    const close = modal.querySelector("[aria-label*='close' i],[aria-label*='닫기'],button[class*='close' i]") ||
      [...modal.querySelectorAll("button,[role=button]")].find(el => /^(×|✕|닫기)$/.test((el.innerText || "").trim()));
    if (close) close.click();
    await wait(500);
  }

  async function run() {
    const marker = new URL(location.href).searchParams.get("crema_auto");
    const state = await chrome.storage.local.get([RUN_KEY, "liveEnabled", "cremaAutomationPhase"]);
    if (marker === "1") await chrome.storage.local.set({[RUN_KEY]: true});
    if (marker !== "1" && !state[RUN_KEY]) return;
    if (findClickable("가입/로그인")) {
      await click("가입/로그인");
      // 로그인 세션이 살아 있으면 관리자 화면으로 이동하고, 그렇지 않으면
      // 실제 로그인 입력란이 나타난다. 이동 중에는 다음 페이지의 content script가 이어서 실행한다.
      await wait(2500);
      const password = document.querySelector("input[type='password']");
      if (password && visible(password)) {
        await log("기존 Chrome의 크리마 로그인이 필요하여 중단");
        await setStatus("error", "적립금 지급을 시작하지 못했습니다.", "크리마 로그인이 만료되었습니다. 크리마에 다시 로그인한 후 실행해주세요.");
        await chrome.storage.local.set({[RUN_KEY]: false});
      }
      return;
    }
    await log("확장 프로그램 실행 시작");
    const onReviewAdmin = location.hostname === "admin.cre.ma" && location.pathname.startsWith("/v2/review/");
    const reachedNewReviews = onReviewAdmin ? await click("신규 리뷰 관리") : false;
    const phase = state.cremaAutomationPhase || "payment";
    const reachedTargetTab = reachedNewReviews && (phase === "payment"
      ? await click("적립금 지급 필요")
      : await clickExact("전체"));
    if (!reachedTargetTab) {
      const labels = [...document.querySelectorAll("button,a,[role=button]")]
        .filter(visible).map(el => (el.innerText || el.getAttribute("aria-label") || "").trim())
        .filter(Boolean).slice(0, 80);
      await log(`메뉴 진단 URL=${location.href} FRAME=${window === top ? "top" : "child"} LABELS=${JSON.stringify(labels)}`);
      await chrome.runtime.sendMessage({type: "capture", index: 0, label: "메뉴탐색오류"});
      await log("메뉴를 찾지 못해 지급 중단");
      await setStatus("error", "적립금 지급 화면으로 이동하지 못했습니다.", `현재 주소: ${location.href}\n크리마 관리자 화면 구조가 변경되었거나 로그인이 만료되었을 수 있습니다.`);
      await chrome.storage.local.set({[RUN_KEY]: false});
      return;
    }
    if (phase === "payment") {
      const pageText = document.body.innerText || "";
      const resultMatch = pageText.match(/([\d,]+)\s*개의\s*결과/);
      const resultCount = resultMatch ? Number(resultMatch[1].replaceAll(",", "")) : null;
      const explicitlyEmpty = resultCount === 0 || /지급할 리뷰가 없습니다|검색 결과가 없습니다/.test(pageText);
      if (explicitlyEmpty) {
        await setStatus("success", "지급이 필요한 리뷰가 없습니다.", "");
        await chrome.storage.local.set({[RUN_KEY]: false, cremaAutomationPhase: "done"});
        return;
      }
      currentStage = "적립금 지급";
      await setStatus("running", resultCount === null
        ? "지급 대상 리뷰를 전체 선택하고 있습니다."
        : `리뷰 ${resultCount}건의 적립금을 지급하고 있습니다.`, "");
      await payAllRewards();
      await wait(1200);
      if (!await clickExact("전체")) throw new Error("적립금 지급 후 ‘전체’ 탭으로 이동하지 못했습니다.");
    }
    currentStage = "부정 리뷰 캡처 및 저장";
    const statuses = [...document.querySelectorAll("body *")].filter(el => visible(el) && (el.innerText || "").trim() === "부정 리뷰");
    const rows = [];
    for (const status of statuses) {
      const listRow = status.closest("tr") || containerFor(status);
      const detailCell = reviewDetailCell(listRow);
      detailCell.scrollIntoView({block: "center"});
      await wait(250);
      (detailCell.querySelector("a,button,[role=button]") || detailCell).click();
      const modal = await waitForModal();
      if (!modal) {
        await log("리뷰 상세 내용 텍스트 클릭 후 팝업을 찾지 못함");
        continue;
      }
      const scroller = scrollBox(modal);
      scroller.scrollTop = 0;
      await wait(300);
      const bodyText = sectionText(modal, "리뷰 본문");
      const modalText = modal.innerText || "";
      const row = {
        id: labelValue(modal, "작성자 아이디"),
        date: labelValue(modal, "작성일"),
        product: productName(modal),
        content: bodyText,
        raw: modalText
      };
      const ratingMatch = modalText.match(/(?:별점\s*)?([1-5])\s*\/\s*5|(?:별점|평점)\s*[:：]?\s*([1-5])(?:\.0)?\s*점?/);
      const rating = ratingMatch ? Number(ratingMatch[1] || ratingMatch[2]) : 0;
      const qualifies = rating >= 1 && rating <= 3 &&
        ANGER.some(word => bodyText.includes(word));
      if (qualifies) {
        const index = rows.length + 1;
        const idLabel = exactText(modal, "작성자 아이디");
        const idBlock = idLabel?.parentElement || idLabel;
        const modalRect = modal.getBoundingClientRect();
        const idRect = idBlock?.getBoundingClientRect();
        const topBottom = idRect ? idRect.bottom + 10 : Math.min(modalRect.bottom, modalRect.top + innerHeight * .55);
        await captureVisibleRect({left: modalRect.left, top: modalRect.top, width: modalRect.width, height: topBottom - modalRect.top}, index, "상품및아이디");

        const attachmentHeading = exactText(modal, "첨부 포토/동영상");
        const reviewHeading = exactText(modal, "리뷰 본문");
        if (attachmentHeading && reviewHeading) {
          const attachmentEnd = reviewHeading.previousElementSibling || attachmentHeading.parentElement?.nextElementSibling || attachmentHeading;
          await captureRange(scroller, modal, attachmentHeading, attachmentEnd, index, "첨부사진");
        }
        if (reviewHeading) {
          const reviewCard = reviewHeading.nextElementSibling || reviewHeading.parentElement?.nextElementSibling || reviewHeading;
          await captureRange(scroller, modal, reviewHeading, reviewCard, index, "리뷰본문");
        }
        rows.push(row);
      }
      await closeModal(modal);
    }
    const reviewSave = await chrome.runtime.sendMessage({type: "reviews", rows});
    if (!reviewSave?.ok) throw new Error(`시트 기록 대기 데이터 저장 실패: ${reviewSave?.error || "알 수 없는 오류"}`);
    await log(`부정 리뷰 ${rows.length}건 캡처 및 시트 기록 대기 저장 완료`);
    await setStatus("success", `적립금 지급과 부정 리뷰 ${rows.length}건의 캡처 저장이 완료되었습니다.`, rows.length ? "시트 기록은 현재 실행하지 않습니다." : "캡처 조건을 만족하는 부정 리뷰가 없습니다.");
    await chrome.storage.local.set({[RUN_KEY]: false, cremaAutomationPhase: "done"});
  }
  run().catch(async error => {
    await log(`오류로 지급 중단: ${error}`);
    await setStatus("error", `${currentStage} 중 오류가 발생했습니다.`, String(error?.stack || error));
    await chrome.storage.local.set({[RUN_KEY]: false, cremaAutomationPhase: "error"});
  });
})();
