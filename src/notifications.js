// notifications.js
//
// 【通知タイミングの仕様】
//   task.notifyStart   : 開始時刻の何分前か（0=定刻、-1=通知しない）
//   task.notifyDeadline: 締切の何分前か（null=当日朝9:00、-1=通知しない）
//   ※フィールドが未設定の場合のデフォルト：
//     開始時刻あり → 定刻（0）
//     締切時刻あり → 3時間前（180）
//     締切日のみ   → 当日朝9:00（null）

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

// ── SWへスケジュール送信 ────────────────────────────────────
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

// ── SW経由で通知を送る ──────────────────────────────────────
async function showNotificationViaSW(title, body, tag) {
  try {
    if (!('serviceWorker' in navigator)) return false;
    const reg = await navigator.serviceWorker.ready;
    if (!reg) return false;
    await reg.showNotification(title, {
      body, icon: '/icon-192.png', badge: '/icon-192.png',
      tag, renotify: false, vibrate: [200, 100, 200],
    });
    return true;
  } catch(e) {
    console.error('SW通知失敗:', e);
    return false;
  }
}

// ── テスト通知 ──────────────────────────────────────────────
export async function sendTestNotification() {
  return await showNotificationViaSW(
    '🔔 テスト通知', '通知は正常に動作しています！', 'test_' + Date.now()
  );
}

// ── 送信済みキー管理（localStorage） ───────────────────────
const STORAGE_KEY = 'notified_keys';
const EXPIRE_MS = 25 * 60 * 60 * 1000;

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

// ── タスク平坦化 ─────────────────────────────────────────────
function flattenTasks(tasks) {
  const result = [];
  const walk = ts => ts.forEach(t => { result.push(t); if (t.children?.length) walk(t.children); });
  walk(tasks);
  return result;
}

// ── 通知イベント列挙（タスク個別設定対応） ──────────────────
function getNotifyEvents(tasks) {
  const events = [];

  flattenTasks(tasks).forEach(task => {
    if (task.done) return;
    const memo = task.memo ? task.memo.replace(/- \[(x| )\] /g,'').split('\n')[0] : '';

    // ── 開始時刻の通知 ──
    if (task.startDate && task.startTime) {
      // notifyStart未設定 → デフォルト0（定刻）
      const minsBeforeStart = task.notifyStart !== undefined ? task.notifyStart : 0;
      if (minsBeforeStart !== -1) {
        const startMs = new Date(`${task.startDate}T${task.startTime}:00`).getTime();
        const notifyAt = startMs - minsBeforeStart * 60 * 1000;
        const label = minsBeforeStart === 0 ? '開始時刻' :
                      minsBeforeStart >= 60 ? `開始${minsBeforeStart/60}時間前` :
                      `開始${minsBeforeStart}分前`;
        events.push({
          key: `start_${task.id}_${minsBeforeStart}`,
          notifyAt,
          title: `▶️ ${label}：${task.title}`,
          body: memo || 'もうすぐ開始時刻です',
        });
      }
    }

    // ── 締切の通知 ──
    if (task.deadlineDate) {
      if (task.deadlineTime) {
        // 時刻あり：notifyDeadline未設定 → デフォルト180分前（3時間前）
        const minsBefore = task.notifyDeadline !== undefined && task.notifyDeadline !== null
          ? task.notifyDeadline : 180;
        if (minsBefore !== -1) {
          const dlMs = new Date(`${task.deadlineDate}T${task.deadlineTime}:00`).getTime();
          const notifyAt = dlMs - minsBefore * 60 * 1000;
          const label = minsBefore >= 60 ? `締切${minsBefore/60}時間前` : `締切${minsBefore}分前`;
          events.push({
            key: `deadline_${task.id}_${minsBefore}`,
            notifyAt,
            title: `⏰ ${label}：${task.title}`,
            body: memo || '締切が近づいています',
          });
        }
      } else {
        // 時刻なし：notifyDeadlineがnull or 未設定 → 当日朝9:00
        const notifyMode = task.notifyDeadline !== undefined ? task.notifyDeadline : null;
        if (notifyMode !== -1) {
          events.push({
            key: `deadlineday_${task.id}`,
            notifyAt: new Date(`${task.deadlineDate}T09:00:00`).getTime(),
            title: `⏰ 今日が締切：${task.title}`,
            body: memo || '本日が締切です',
          });
        }
      }
    }
  });

  return events;
}

// ── アプリ起動中ポーリング（30秒おき） ─────────────────────
export function startForegroundCheck(getTasks, getSettings, onNotify) {
  const check = async () => {
    const tasks = getTasks();
    const settings = getSettings();
    if (!settings?.enabled || Notification.permission !== 'granted') return;

    const now = Date.now();
    const PAST  = 60 * 60 * 1000; // 過去60分まで遡る
    const GRACE =      30 * 1000; // 30秒先まで先打ちOK

    for (const ev of getNotifyEvents(tasks)) {
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
