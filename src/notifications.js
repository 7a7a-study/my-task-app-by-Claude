// notifications.js
// 通知ロジック：許可取得・設定保存・スケジュール送信

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

// ── 通知をキャンセル ─────────────────────────────────────────
export async function cancelNotifications() {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.ready;
  if (!reg?.active) return;
  reg.active.postMessage({ type: 'CANCEL_NOTIFICATIONS' });
}

// ── アプリ起動中のポーリングチェック（1分おき） ──────────────
export function startForegroundCheck(getTasks, getSettings, onNotify) {
  const notified = new Set();

  const check = () => {
    const tasks = getTasks();
    const settings = getSettings();
    if (!settings?.enabled || Notification.permission !== 'granted') return;

    const minutesBefore = settings.minutesBefore || 60;
    const now = Date.now();

    const flat = [];
    const flatten = (ts) => {
      ts.forEach(t => {
        flat.push(t);
        if (t.children?.length) flatten(t.children);
      });
    };
    flatten(tasks);

    flat.forEach(task => {
      if (task.done) return;

      const checkTime = (dateStr, timeStr, type) => {
        if (!dateStr) return;
        const fullStr = dateStr + (timeStr ? `T${timeStr}:00` : 'T23:59:00');
        const target = new Date(fullStr).getTime();
        const notifyAt = target - minutesBefore * 60 * 1000;
        const key = `${task.id}_${type}`;

        // 通知タイミングの±1分以内 かつ まだ通知していない
        if (Math.abs(now - notifyAt) < 60 * 1000 && !notified.has(key)) {
          notified.add(key);
          const timeLabel = minutesBefore >= 60
            ? `${minutesBefore / 60}時間前`
            : `${minutesBefore}分前`;
          const title = type === 'deadline'
            ? `⏰ 締切${timeLabel}：${task.title}`
            : `▶️ 開始${timeLabel}：${task.title}`;

          new Notification(title, {
            body: task.memo
              ? task.memo.replace(/- \[(x| )\] /g, '').split('\n')[0]
              : (type === 'deadline' ? '締切が近づいています' : 'もうすぐ開始時刻です'),
            icon: '/icon-192.png',
            tag: key,
          });
          onNotify?.(task, type);
        }
      };

      checkTime(task.deadlineDate, task.deadlineTime, 'deadline');
      checkTime(task.startDate, task.startTime, 'start');
    });
  };

  check(); // 即時実行
  const id = setInterval(check, 60 * 1000);
  return () => clearInterval(id);
}
