// firebase-messaging-sw.js
// Service Worker: バックグラウンド通知タイマー + PWAキャッシュ

const CACHE_NAME = 'mytask-v1';

// ── インストール ──────────────────────────────────────────────
self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── メッセージ受信（アプリ→SW） ──────────────────────────────
self.addEventListener('message', event => {
  const { type, tasks, settings } = event.data || {};

  if (type === 'SCHEDULE_NOTIFICATIONS') {
    // タスクと通知設定を受け取り、アラームをスケジュール
    scheduleNotifications(tasks, settings);
  }
  if (type === 'CANCEL_NOTIFICATIONS') {
    cancelAllNotifications();
  }
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
  const notifyMinutesBefore = (settings.minutesBefore || 60);

  // フラットなタスクリストに展開
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

    // 締切日時で通知
    if (task.deadlineDate) {
      const deadlineStr = task.deadlineDate + (task.deadlineTime ? `T${task.deadlineTime}:00` : 'T23:59:00');
      const deadline = new Date(deadlineStr).getTime();
      const notifyAt = deadline - notifyMinutesBefore * 60 * 1000;

      if (notifyAt > now) {
        const delay = notifyAt - now;
        // 最大24時間先まで（Service Workerが生存できる範囲）
        if (delay < 24 * 60 * 60 * 1000) {
          const tid = setTimeout(() => {
            showNotification(task, notifyMinutesBefore, 'deadline');
          }, delay);
          timers.set(`deadline_${task.id}`, tid);
        }
      }
    }

    // 開始日時で通知
    if (task.startDate && task.startTime) {
      const startStr = `${task.startDate}T${task.startTime}:00`;
      const startTime = new Date(startStr).getTime();
      const notifyAt = startTime - notifyMinutesBefore * 60 * 1000;

      if (notifyAt > now) {
        const delay = notifyAt - now;
        if (delay < 24 * 60 * 60 * 1000) {
          const tid = setTimeout(() => {
            showNotification(task, notifyMinutesBefore, 'start');
          }, delay);
          timers.set(`start_${task.id}`, tid);
        }
      }
    }
  });
}

function showNotification(task, minutesBefore, type) {
  const timeLabel = minutesBefore >= 60
    ? `${minutesBefore / 60}時間前`
    : `${minutesBefore}分前`;

  const title = type === 'deadline'
    ? `⏰ 締切${timeLabel}：${task.title}`
    : `▶️ 開始${timeLabel}：${task.title}`;

  const body = task.memo
    ? task.memo.replace(/- \[(x| )\] /g, '').split('\n')[0]
    : (type === 'deadline' ? '締切が近づいています' : 'もうすぐ開始時刻です');

  self.registration.showNotification(title, {
    body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: `task_${task.id}_${type}`,
    renotify: false,
    data: { taskId: task.id },
    vibrate: [200, 100, 200],
  });
}

// ── 通知クリック ──────────────────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      if (list.length > 0) {
        list[0].focus();
      } else {
        clients.openWindow('/');
      }
    })
  );
});

// ── フェッチ（PWAオフライン対応） ─────────────────────────────
self.addEventListener('fetch', event => {
  // APIリクエストはキャッシュしない
  if (event.request.url.includes('firestore') ||
      event.request.url.includes('googleapis') ||
      event.request.url.includes('firebase')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      return cached || fetch(event.request).catch(() => cached);
    })
  );
});
