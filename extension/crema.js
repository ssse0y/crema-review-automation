(() => {
  const RUN_KEY = "cremaAutomationRunning";
  const ANGER = [
    "화딱지", "화가", "짜증", "스트레스", "최악", "실망", "답답", "황당",
    "다시는", "환불", "교환", "구림", "심하다", "안됩니다", "안 됩니다",
    "못 쓰", "쓰지 못", "불량", "충격"
  ];
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const visible = el => !!(el && el.getClientRects().length);
  const log = message => chrome.runtime.sendMessage({type: "log", message}).catch(() => {});
  const compact = text => (text || "").replace(/\s+/g, "").trim();

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

  async function run() {
    const marker = new URL(location.href).searchParams.get("crema_auto");
    const state = await chrome.storage.local.get([RUN_KEY, "liveEnabled"]);
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
        await chrome.storage.local.set({[RUN_KEY]: false});
      }
      return;
    }
    await log("확장 프로그램 실행 시작");
    const onReviewAdmin = location.hostname === "admin.cre.ma" && location.pathname.startsWith("/v2/review/");
    const reachedNewReviews = onReviewAdmin ? await click("신규 리뷰 관리") : false;
    if (!reachedNewReviews || !await click("적립금 지급 필요")) {
      const labels = [...document.querySelectorAll("button,a,[role=button]")]
        .filter(visible).map(el => (el.innerText || el.getAttribute("aria-label") || "").trim())
        .filter(Boolean).slice(0, 80);
      await log(`메뉴 진단 URL=${location.href} FRAME=${window === top ? "top" : "child"} LABELS=${JSON.stringify(labels)}`);
      await chrome.runtime.sendMessage({type: "capture", index: 0, label: "메뉴탐색오류"});
      await log("메뉴를 찾지 못해 지급 중단");
      await chrome.storage.local.set({[RUN_KEY]: false});
      return;
    }
    const statuses = [...document.querySelectorAll("body *")].filter(el => visible(el) && (el.innerText || "").trim() === "부정 리뷰");
    const rows = [];
    for (const status of statuses) {
      const el = containerFor(status);
      const row = parse(el);
      if (isTwoStars(el) && ANGER.some(word => row.content.includes(word))) {
        el.scrollIntoView({block: "center"});
        await wait(400);
        await chrome.runtime.sendMessage({type: "capture", index: rows.length + 1, label: "부정리뷰"});
        rows.push(row);
      }
    }
    await chrome.runtime.sendMessage({type: "reviews", rows});
    await log(`부정 리뷰 ${rows.length}건 캡처 및 로컬 기록 완료`);
    if (!state.liveEnabled) {
      await chrome.runtime.sendMessage({type: "capture", index: 0, label: "지급전검증"});
      await log("최초 검증 전이므로 실제 지급 중단");
      await chrome.storage.local.set({[RUN_KEY]: false});
      return;
    }
    await log("지급 활성화는 화면 검증 후 별도 버전에서 수행됩니다");
    await chrome.storage.local.set({[RUN_KEY]: false});
  }
  run().catch(async error => {
    await log(`오류로 지급 중단: ${error}`);
    await chrome.storage.local.set({[RUN_KEY]: false});
  });
})();
