// notifications.js
// 通知ロジック：許可取得・設定保存・スケジュール送信
//
// 【通知タイミングの仕様】
//   開始時刻あり  → 開始時刻の X分前（設定値）
//   締切時刻あり  → 締切時刻の X分前（設定値）
//   締切日のみ    → その日の朝 9:00 固定

// ── 通知許可を取得 ────────────────────────────────────────────
export async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    return { ok: false, reason: 'このブラウザは通知に対応していません' };
  }
  if (Notification.permission === 'granted') {
    return { ok: true };
  }
  if (Notification.permission === 'denied') {
    return { ok: false, reason: '通知がブロックされています。ブラウザの設定から許可してください' };
  }
  const result = await Notification.requestPermission();
  if (result === 'granted') return { ok: true };
  return { ok: false, reason: '通知を許可しませんでした' };
}

// ── Service Worker 登録 ───────────────────────────────────────
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

// ── タスクをSWに送ってスケジュール ───────────────────────────
export async function scheduleNotifications(tasks, settings) {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.ready;
  if (!reg?.active) return;
  reg.active.postMessage({
    type: 'SCHEDULE_NOTIFICATIONS',
    tasks,
    settings,
  });
}

// ── アプリ起動中のポーリングチェック（1分おき） ──────────────
export function startForegroundCheck(getTasks, getSettings, onNotify) {
  const notified = new Set();

  const check = () => {
    const tasks = getTasks();
    const settings = getSettings();
    if (!settings?.enabled || Notification.permission !== 'granted') return;

    const now = Date.now();
    const minutesBefore = settings.minutesBefore || 60;

    const flat = [];
    const flatten = (ts) => {
      ts.forEach(t => { flat.push(t); if (t.children?.length) flatten(t.children); });
    };
    flatten(tasks);

    flat.forEach(task => {
      if (task.done) return;

      // 開始時刻あり → X分前
      if (task.startDate && task.startTime) {
        const startMs = new Date(`${task.startDate}T${task.startTime}:00`).getTime();
        const notifyAt = startMs - minutesBefore * 60 * 1000;
        const key = `start_${task.id}`;
        if (Math.abs(now - notifyAt) < 60 * 1000 && !notified.has(key)) {
          notified.add(key);
          const label = minutesBefore >= 60 ? `${minutesBefore/60}時間前` : `${minutesBefore}分前`;
          new Notification(`▶️ 開始${label}：${task.title}`, {
            body: task.memo ? task.memo.replace(/- \[(x| )\] /g,'').split('\n')[0] : 'もうすぐ開始時刻です',
            icon: '/icon-192.png', tag: key,
          });
          onNotify?.(task);
        }
      }

      // 締切時刻あり → X分前
      if (task.deadlineDate && task.deadlineTime) {
        const dlMs = new Date(`${task.deadlineDate}T${task.deadlineTime}:00`).getTime();
        const notifyAt = dlMs - minutesBefore * 60 * 1000;
        const key = `deadline_${task.id}`;
        if (Math.abs(now - notifyAt) < 60 * 1000 && !notified.has(key)) {
          notified.add(key);
          const label = minutesBefore >= 60 ? `${minutesBefore/60}時間前` : `${minutesBefore}分前`;
          new Notification(`⏰ 締切${label}：${task.title}`, {
            body: task.memo ? task.memo.replace(/- \[(x| )\] /g,'').split('\n')[0] : '締切が近づいています',
            icon: '/icon-192.png', tag: key,
          });
          onNotify?.(task);
        }
      }

      // 締切日のみ（時刻なし）→ 朝9:00固定
      if (task.deadlineDate && !task.deadlineTime) {
        const notifyAt = new Date(`${task.deadlineDate}T09:00:00`).getTime();
        const key = `deadline_${task.id}`;
        if (Math.abs(now - notifyAt) < 60 * 1000 && !notified.has(key)) {
          notified.add(key);
          new Notification(`⏰ 今日が締切：${task.title}`, {
            body: task.memo ? task.memo.replace(/- \[(x| )\] /g,'').split('\n')[0] : '本日が締切です',
            icon: '/icon-192.png', tag: key,
          });
          onNotify?.(task);
        }
      }
    });
  };

  check();
  const id = setInterval(check, 60 * 1000);
  return () => clearInterval(id);
}
