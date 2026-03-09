// firebase-messaging-sw.js
// Service Worker: PWAキャッシュ + バックグラウンド通知
//
// 【仕組み】
//   アプリが開かれるたびにタスクデータを受け取り、
//   直近24時間以内の通知をsetTimeoutでスケジュール。
//   また受信時に「過去60分以内の見逃し通知」も即送信する。

const CACHE_NAME = 'mytask-v2';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── タイマー管理 ────────────────────────────────────────────
const timers = new Map();

function cancelAll() {
  timers.forEach(id => clearTimeout(id));
  timers.clear();
}

// ── 送信済み管理（SW内メモリ、再起動でリセット） ────────────
const sent = new Set();

// ── タスク平坦化 ─────────────────────────────────────────────
function flattenTasks(tasks) {
  const result = [];
  const walk = ts => ts.forEach(t => { result.push(t); if (t.children?.length) walk(t.children); });
  walk(tasks || []);
  return result;
}

// ── 通知イベント列挙 ─────────────────────────────────────────
function getEvents(tasks, minutesBefore) {
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

// ── 通知をスケジュール ───────────────────────────────────────
function scheduleNotifications(tasks, settings) {
  cancelAll();
  if (!settings?.enabled) return;

  const now = Date.now();
  const minutesBefore = settings.minutesBefore || 60;
  const PAST  = 60 * 60 * 1000; // 過去60分まで遡って即送信
  const MAX   = 24 * 60 * 60 * 1000; // 24時間先までスケジュール

  getEvents(tasks, minutesBefore).forEach(ev => {
    if (sent.has(ev.key)) return;

    // 過去60分以内の見逃し → 即送信
    if (ev.notifyAt >= now - PAST && ev.notifyAt <= now) {
      sent.add(ev.key);
      self.registration.showNotification(ev.title, {
        body: ev.body, icon: '/icon-192.png', badge: '/icon-192.png',
        tag: ev.key, renotify: false, vibrate: [200, 100, 200],
      });
      return;
    }

    // 未来24時間以内 → タイマーセット
    const delay = ev.notifyAt - now;
    if (delay > 0 && delay <= MAX) {
      const tid = setTimeout(() => {
        if (sent.has(ev.key)) return;
        sent.add(ev.key);
        self.registration.showNotification(ev.title, {
          body: ev.body, icon: '/icon-192.png', badge: '/icon-192.png',
          tag: ev.key, renotify: false, vibrate: [200, 100, 200],
          data: { taskId: ev.key },
        });
      }, delay);
      timers.set(ev.key, tid);
    }
  });
}

// ── メッセージ受信 ───────────────────────────────────────────
self.addEventListener('message', event => {
  const { type, tasks, settings } = event.data || {};
  if (type === 'SCHEDULE_NOTIFICATIONS') scheduleNotifications(tasks, settings);
  if (type === 'CANCEL_NOTIFICATIONS')   cancelAll();
});

// ── 通知クリック ─────────────────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      if (list.length > 0) { list[0].focus(); return; }
      clients.openWindow('/');
    })
  );
});

// ── PWAキャッシュ ────────────────────────────────────────────
self.addEventListener('fetch', event => {
  if (event.request.url.includes('firestore') ||
      event.request.url.includes('googleapis') ||
      event.request.url.includes('firebase')) return;
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).catch(() => cached))
  );
});
