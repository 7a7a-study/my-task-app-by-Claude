// firebase-messaging-sw.js
// Service Worker: バックグラウンド通知タイマー + PWAキャッシュ
//
// 【通知タイミングの仕様】
//   開始時刻あり  → 開始時刻の X分前（設定値）
//   締切時刻あり  → 締切時刻の X分前（設定値）
//   締切日のみ    → その日の朝 9:00 固定

const CACHE_NAME = 'mytask-v1';

self.addEventListener('install', event => { self.skipWaiting(); });

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── メッセージ受信（アプリ→SW） ──────────────────────────────
self.addEventListener('message', event => {
  const { type, tasks, settings } = event.data || {};
  if (type === 'SCHEDULE_NOTIFICATIONS') scheduleNotifications(tasks, settings);
  if (type === 'CANCEL_NOTIFICATIONS')   cancelAllNotifications();
});

// スケジュール済みタイマーを管理
const timers = new Map();

function cancelAllNotifications() {
  timers.forEach(id => clearTimeout(id));
  timers.clear();
}

function scheduleNotifications(tasks, settings) {
  cancelAllNotifications();
  if (!settings?.enabled) return;

  const now = Date.now();
  const minutesBefore = settings.minutesBefore || 60;

  const flat = [];
  const flatten = (ts) => {
    ts.forEach(t => { flat.push(t); if (t.children?.length) flatten(t.children); });
  };
  flatten(tasks);

  flat.forEach(task => {
    if (task.done) return;

    const schedule = (key, notifyAt, title, body) => {
      if (notifyAt <= now) return;
      const delay = notifyAt - now;
      if (delay >= 24 * 60 * 60 * 1000) return; // 24時間超はSWの生存限界なのでスキップ
      const tid = setTimeout(() => {
        self.registration.showNotification(title, {
          body,
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          tag: key,
          renotify: false,
          data: { taskId: task.id },
          vibrate: [200, 100, 200],
        });
      }, delay);
      timers.set(key, tid);
    };

    const label = minutesBefore >= 60 ? `${minutesBefore/60}時間前` : `${minutesBefore}分前`;
    const memo = task.memo ? task.memo.replace(/- \[(x| )\] /g,'').split('\n')[0] : '';

    // 開始時刻あり → X分前
    if (task.startDate && task.startTime) {
      const startMs = new Date(`${task.startDate}T${task.startTime}:00`).getTime();
      schedule(
        `start_${task.id}`,
        startMs - minutesBefore * 60 * 1000,
        `▶️ 開始${label}：${task.title}`,
        memo || 'もうすぐ開始時刻です'
      );
    }

    // 締切時刻あり → X分前
    if (task.deadlineDate && task.deadlineTime) {
      const dlMs = new Date(`${task.deadlineDate}T${task.deadlineTime}:00`).getTime();
      schedule(
        `deadline_${task.id}`,
        dlMs - minutesBefore * 60 * 1000,
        `⏰ 締切${label}：${task.title}`,
        memo || '締切が近づいています'
      );
    }

    // 締切日のみ（時刻なし）→ 朝9:00固定
    if (task.deadlineDate && !task.deadlineTime) {
      const notifyAt = new Date(`${task.deadlineDate}T09:00:00`).getTime();
      schedule(
        `deadline_${task.id}`,
        notifyAt,
        `⏰ 今日が締切：${task.title}`,
        memo || '本日が締切です'
      );
    }
  });
}

// ── 通知クリック ──────────────────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      if (list.length > 0) list[0].focus();
      else clients.openWindow('/');
    })
  );
});

// ── フェッチ（PWAオフライン対応） ─────────────────────────────
self.addEventListener('fetch', event => {
  if (event.request.url.includes('firestore') ||
      event.request.url.includes('googleapis') ||
      event.request.url.includes('firebase')) return;
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).catch(() => cached))
  );
});
