// notifications.js
//
// 【通知タイミングの仕様】
//   開始時刻あり  → 開始時刻の X分前（設定値）
//   締切時刻あり  → 締切時刻の X分前（設定値）
//   締切日のみ    → その日の朝 9:00 固定
//
// 【送信条件】
//   通知時刻が「過去60分以内 〜 未来30秒以内」なら送る
//   同じ通知はlocalStorageで記録して重複防止（25時間以内は再送しない）

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

function fireNotification(ev) {
  if (alreadySent(ev.key)) return;
  markSent(ev.key);
  try {
    new Notification(ev.title, { body: ev.body, icon: '/icon-192.png', tag: ev.key });
  } catch(e) { console.error('通知送信失敗:', e); }
}

// ── アプリ起動中のポーリングチェック（30秒おき） ────────────
// 過去60分以内 〜 30秒先 の通知を全部送る（見逃し救済含む）
export function startForegroundCheck(getTasks, getSettings, onNotify) {
  const check = () => {
    const tasks = getTasks();
    const settings = getSettings();
    if (!settings?.enabled || Notification.permission !== 'granted') return;

    const now = Date.now();
    const PAST  = 60 * 60 * 1000; // 過去60分まで遡る
    const GRACE =      30 * 1000; // 30秒先まで先打ちOK

    getNotifyEvents(tasks, settings.minutesBefore || 60).forEach(ev => {
      if (ev.notifyAt >= now - PAST && ev.notifyAt <= now + GRACE) {
        fireNotification(ev);
        onNotify?.(ev);
      }
    });
  };

  check(); // 起動直後に即チェック
  const id = setInterval(check, 30 * 1000);
  return () => clearInterval(id);
}
