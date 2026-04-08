// ── Google Calendar 連携ユーティリティ ────────────────────────────────
// 【設計方針：Firestore書き込みゼロ】
//   - 取得したイベントはメモリキャッシュ（gcalCache）のみに保存
//   - Firestoreには一切読み書きしない
//   - アクセストークンはFirebase AuthのsignInWithPopupで取得済みのものを再利用
//   - 同一日付範囲は5分間キャッシュ（APIリクエスト削減）
//   - GCal APIは無料・課金なし（超過時はリクエストが止まるだけ）

import { getAuth } from "firebase/auth";

// ── メモリキャッシュ（ページリロードでクリア、Firestoreに書かない）──
// key: "YYYY-MM-DD_YYYY-MM-DD"、value: { events, fetchedAt }
const gcalCache = {};
const CACHE_TTL_MS = 5 * 60 * 1000; // 5分

// アクセストークンのキャッシュ（再取得を最小化）
let cachedToken = null;
let tokenFetchedAt = 0;
const TOKEN_TTL_MS = 55 * 60 * 1000; // 55分（Googleトークンの有効期限1時間より少し短め）

// ── アクセストークン取得 ───────────────────────────────────────────────
// Firebase Authのユーザーからトークンを取得。
// getIdToken()はFirebaseのIDトークンなので使えない。
// GoogleAuthProviderのcredentialが必要なため、ユーザーに一度だけポップアップを出す。
export const getGCalToken = async () => {
  const now = Date.now();

  // キャッシュが有効なら再利用
  if (cachedToken && (now - tokenFetchedAt) < TOKEN_TTL_MS) {
    return cachedToken;
  }

  // Firebase AuthのcurrentUserからGoogle OAuthトークンを取得
  // getIdTokenForce=trueでリフレッシュ
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) return null;

  try {
    // Firebase AuthユーザーにGoogleプロバイダのアクセストークンが紐づいている場合
    // providerData経由では取れないため、signInWithCredentialを再実行せずに
    // GoogleAuthProviderのgetCredentialFromResult相当のものを使う。
    // 最もシンプルな方法：window.gapi不使用、fetch経由でGoogle OAuthの
    // tokeninfo を用いて検証することも可能だが、
    // ここでは Firebase の「再認証なし」でアクセストークンを得る方法として
    // auth.currentUser.getIdToken() → Googleの exchange は不可。
    // 代わりに: ユーザー初回ログイン時にlocalStorageにgoogleAccessTokenを保存する設計にする。
    // → App.jsのhandleLoginでsignInWithPopupの戻り値のcredentialを保存。
    const token = localStorage.getItem("gcal_access_token");
    const tokenExp = parseInt(localStorage.getItem("gcal_token_exp") || "0");

    if (token && Date.now() < tokenExp) {
      cachedToken = token;
      tokenFetchedAt = now;
      return token;
    }

    return null; // トークンなし → 再ログインが必要
  } catch (e) {
    console.warn("[gcal] トークン取得失敗:", e);
    return null;
  }
};

// ── App.jsのhandleLoginから呼ぶ：アクセストークンを保存 ──────────────
export const saveGCalToken = (credential) => {
  try {
    // GoogleAuthProvider.credentialFromResult(result) から取得したcredential
    const token = credential?.accessToken;
    if (!token) return;
    // Googleのアクセストークンは通常1時間有効
    const exp = Date.now() + 58 * 60 * 1000; // 58分後
    localStorage.setItem("gcal_access_token", token);
    localStorage.setItem("gcal_token_exp", String(exp));
    cachedToken = token;
    tokenFetchedAt = Date.now();
  } catch (e) {
    console.warn("[gcal] トークン保存失敗:", e);
  }
};

export const clearGCalToken = () => {
  try {
    localStorage.removeItem("gcal_access_token");
    localStorage.removeItem("gcal_token_exp");
  } catch {}
  cachedToken = null;
  tokenFetchedAt = 0;
};

// ── GCalイベント取得（メモリキャッシュ付き）────────────────────────────
// dateFrom, dateTo: "YYYY-MM-DD"
// 返り値: GCalEvent[] | null（トークンなし or エラー）
export const fetchGCalEvents = async (dateFrom, dateTo) => {
  const cacheKey = `${dateFrom}_${dateTo}`;
  const now = Date.now();

  // キャッシュヒット（5分以内）
  const cached = gcalCache[cacheKey];
  if (cached && (now - cached.fetchedAt) < CACHE_TTL_MS) {
    return cached.events;
  }

  const token = await getGCalToken();
  if (!token) return null; // 未ログイン or トークン期限切れ

  try {
    const params = new URLSearchParams({
      timeMin: `${dateFrom}T00:00:00+09:00`,
      timeMax: `${dateTo}T23:59:59+09:00`,
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "100",
    });

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (res.status === 401) {
      // トークン期限切れ → クリア（次回ビュー表示時に再ログイン案内）
      clearGCalToken();
      return null;
    }
    if (!res.ok) {
      console.warn("[gcal] APIエラー:", res.status);
      return null;
    }

    const data = await res.json();
    const events = (data.items || []).map(ev => ({
      id: ev.id,
      title: ev.summary || "(タイトルなし)",
      // 終日イベント: start.date、時間指定: start.dateTime
      isAllDay: !!ev.start?.date && !ev.start?.dateTime,
      startDate: ev.start?.dateTime
        ? ev.start.dateTime.slice(0, 10)
        : ev.start?.date || "",
      startTime: ev.start?.dateTime
        ? ev.start.dateTime.slice(11, 16)
        : "",
      endDate: ev.end?.dateTime
        ? ev.end.dateTime.slice(0, 10)
        : ev.end?.date
          // GCalの終日イベントのendDateは「翌日」なので1日戻す
          ? (() => { const d = new Date(ev.end.date); d.setDate(d.getDate()-1); return d.toISOString().slice(0,10); })()
          : "",
      endTime: ev.end?.dateTime
        ? ev.end.dateTime.slice(11, 16)
        : "",
      calendarColor: "#4285f4", // Google Calendar blue
      location: ev.location || "",
      description: ev.description || "",
      htmlLink: ev.htmlLink || "",
      _isGCal: true, // Slateのタスクと区別するフラグ
    }));

    // メモリキャッシュに保存（Firestoreには書かない）
    gcalCache[cacheKey] = { events, fetchedAt: now };
    return events;
  } catch (e) {
    console.warn("[gcal] fetch失敗:", e);
    return null;
  }
};

// ── 指定日のGCalイベントを絞り込む ───────────────────────────────────
export const getGCalEventsForDate = (events, date) => {
  if (!events) return [];
  return events.filter(ev => {
    if (!ev.startDate) return false;
    const end = ev.endDate || ev.startDate;
    return date >= ev.startDate && date <= end;
  });
};
