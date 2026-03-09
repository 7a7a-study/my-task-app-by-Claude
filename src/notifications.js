// notifications.js
//
// 【通知タイミングの仕様】
//   開始時刻あり  → 開始時刻の X分前（設定値）
//   締切時刻あり  → 締切時刻の X分前（設定値）
//   締切日のみ    → その日の朝 9:00 固定
//
// 【重要】
//   new Notification() はiPhoneのPWAでのみ動作する。
//   AndroidのChromeやPC Chromeでは Service Worker 経由
//   (registration.showNotification) を使わないと動かない。
//   → 全通知をSW経由に統一する。

// ── 通知許可を取得 ──────────────────────────────────────────
export async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    return { ok: false, reason: 'このブラウザは通知に対応していません' };
  }
  if (Notification.permission === 'granted') return { ok: true };
  if (Notification.permission === 'denied') {
    return { ok: false, reason: '通知がブロックされています。ブラウザ設定から許可してください' };
  }
  const result = await Notification.requestPermission();
  if (result === 'granted') return { ok: true };
  return { ok: false, reason: '通知を許可しませんでした' };
}

// ── Service Worker 登録 ─────────────────────────────────────
export async function registerSW() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    await navigator.serviceWorker.ready;
    return reg;
  } catch (e) {
    console.error('SW登録失敗:', e);
    return null;
  }
}

// ── SW経由で通知を1件送る ───────────────────────────────────
// new Notification() はAndroid Chrome / PC Chromeで使えないため
// 常にSW経由（registration.showNotification）を使う
async function showNotificationViaSW(title, body, tag) {
  try {
    if (!('serviceWorker' in navigator)) return false;
    const reg = await navigator.serviceWorker.ready;
    if (!reg) return false;
    await reg.showNotification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag,
      renotify: false,
      vibrate: [200, 100, 200],
    });
    return true;
  } catch(e) {
    console.error('SW通知失敗:', e);
    return false;
  }
}

// ── SWへスケジュール送信（バックグラウンド用） ──────────────
export async function scheduleNotifications(tasks, settings) {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    if (!reg?.active) return;
    reg.active.postMessage({ type: 'SCHEDULE_NOTIFICATIONS', tasks, settings });
  } catch(e) {
    console.error('SW通知スケジュール失敗:', e);
  }
}

// ── テスト通知（SW経由） ────────────────────────────────────
export async function sendTestNotification() {
  const ok = await showNotificationViaSW(
    '🔔 テスト通知',
    '通知は正常に動作しています！',
    'test_' + Date.now()
  );
  return ok;
}

// ── 送信済みキーをlocalStorageで管理 ───────────────────────
const STORAGE_KEY = 'notified_keys';
const EXPIRE_MS = 25 * 60 * 60 * 1000; // 25時間

function getSentMap() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
}
function markSent(key) {
  try {
    const map = getSentMap();
    const now = Date.now();
    map[key] = now;
    Object.keys(map).forEach(k => { if (now - map[k] > EXPIRE_MS) delete map[k]; });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {}
}
function alreadySent(key) {
  const map = getSentMap();
  return !!(map[key] && Date.now() - map[key] < EXPIRE_MS);
}

// ── タスクリストを平坦化 ────────────────────────────────────
function flattenTasks(tasks) {
  const result = [];
  const walk = ts => ts.forEach(t => { result.push(t); if (t.children?.length) walk(t.children); });
  walk(tasks);
  return result;
}

// ── 通知イベントを列挙 ──────────────────────────────────────
function getNotifyEvents(tasks, minutesBefore) {
  const events = [];
  const label = minutesBefore >= 60 ? `${minutesBefore/60}時間前` : `${minutesBefore}分前`;

  flattenTasks(tasks).forEach(task => {
    if (task.done) return;
    const memo = task.memo ? task.memo.replace(/- \[(x| )\] /g,'').split('\n')[0] : '';

    if (task.startDate && task.startTime) {
      const ms = new Date(`${task.startDate}T${task.startTime}:00`).getTime();
      events.push({
        key: `start_${task.id}_${minutesBefore}`,
        notifyAt: ms - minutesBefore * 60 * 1000,
        title: `▶️ 開始${label}：${task.title}`,
        body: memo || 'もうすぐ開始時刻です',
      });
    }
    if (task.deadlineDate && task.deadlineTime) {
      const ms = new Date(`${task.deadlineDate}T${task.deadlineTime}:00`).getTime();
      events.push({
        key: `deadline_${task.id}_${minutesBefore}`,
        notifyAt: ms - minutesBefore * 60 * 1000,
        title: `⏰ 締切${label}：${task.title}`,
        body: memo || '締切が近づいています',
      });
    }
    if (task.deadlineDate && !task.deadlineTime) {
      events.push({
        key: `deadlineday_${task.id}`,
        notifyAt: new Date(`${task.deadlineDate}T09:00:00`).getTime(),
        title: `⏰ 今日が締切：${task.title}`,
        body: memo || '本日が締切です',
      });
    }
  });

  return events;
}

// ── アプリ起動中のポーリングチェック（30秒おき） ────────────
// 過去60分以内 〜 30秒先 の通知をSW経由で送る
export function startForegroundCheck(getTasks, getSettings, onNotify) {
  const check = async () => {
    const tasks = getTasks();
    const settings = getSettings();
    if (!settings?.enabled || Notification.permission !== 'granted') return;

    const now = Date.now();
    const PAST  = 60 * 60 * 1000; // 過去60分まで遡る
    const GRACE =      30 * 1000; // 30秒先まで先打ちOK

    const events = getNotifyEvents(tasks, settings.minutesBefore || 60);

    for (const ev of events) {
      if (ev.notifyAt >= now - PAST && ev.notifyAt <= now + GRACE) {
        if (!alreadySent(ev.key)) {
          markSent(ev.key);
          await showNotificationViaSW(ev.title, ev.body, ev.key);
          onNotify?.(ev);
        }
      }
    }
  };

  check();
  const id = setInterval(check, 30 * 1000);
  return () => clearInterval(id);
}
