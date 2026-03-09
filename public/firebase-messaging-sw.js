// firebase-messaging-sw.js — PWAキャッシュ + バックグラウンド通知
const CACHE_NAME = 'mytask-v3';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const timers = new Map();
const sent   = new Set();

function cancelAll() { timers.forEach(id=>clearTimeout(id)); timers.clear(); }

function flattenTasks(tasks) {
  const r=[]; const w=ts=>ts.forEach(t=>{r.push(t);if(t.children?.length)w(t.children);}); w(tasks||[]); return r;
}

// タスク個別設定対応の通知イベント列挙
function getEvents(tasks) {
  const events = [];
  flattenTasks(tasks).forEach(task => {
    if (task.done) return;
    const memo = task.memo ? task.memo.replace(/- \[(x| )\] /g,'').split('\n')[0] : '';

    // 開始時刻通知
    if (task.startDate && task.startTime) {
      const mins = task.notifyStart !== undefined ? task.notifyStart : 0;
      if (mins !== -1) {
        const ms = new Date(`${task.startDate}T${task.startTime}:00`).getTime();
        const label = mins===0?'開始時刻':mins>=60?`開始${mins/60}時間前`:`開始${mins}分前`;
        events.push({ key:`start_${task.id}_${mins}`, notifyAt:ms-mins*60*1000,
          title:`▶️ ${label}：${task.title}`, body:memo||'もうすぐ開始時刻です' });
      }
    }

    // 締切通知
    if (task.deadlineDate) {
      if (task.deadlineTime) {
        const mins = (task.notifyDeadline!==undefined&&task.notifyDeadline!==null) ? task.notifyDeadline : 180;
        if (mins !== -1) {
          const ms = new Date(`${task.deadlineDate}T${task.deadlineTime}:00`).getTime();
          const label = mins>=60?`締切${mins/60}時間前`:`締切${mins}分前`;
          events.push({ key:`deadline_${task.id}_${mins}`, notifyAt:ms-mins*60*1000,
            title:`⏰ ${label}：${task.title}`, body:memo||'締切が近づいています' });
        }
      } else {
        const mode = task.notifyDeadline!==undefined ? task.notifyDeadline : null;
        if (mode !== -1) {
          events.push({ key:`deadlineday_${task.id}`,
            notifyAt:new Date(`${task.deadlineDate}T09:00:00`).getTime(),
            title:`⏰ 今日が締切：${task.title}`, body:memo||'本日が締切です' });
        }
      }
    }
  });
  return events;
}

function scheduleNotifications(tasks, settings) {
  cancelAll();
  if (!settings?.enabled) return;
  const now = Date.now();
  const PAST = 60*60*1000, MAX = 24*60*60*1000;

  getEvents(tasks).forEach(ev => {
    if (sent.has(ev.key)) return;
    if (ev.notifyAt >= now - PAST && ev.notifyAt <= now) {
      sent.add(ev.key);
      self.registration.showNotification(ev.title, {
        body:ev.body, icon:'/icon-192.png', badge:'/icon-192.png',
        tag:ev.key, renotify:false, vibrate:[200,100,200],
      });
      return;
    }
    const delay = ev.notifyAt - now;
    if (delay > 0 && delay <= MAX) {
      const tid = setTimeout(() => {
        if (sent.has(ev.key)) return;
        sent.add(ev.key);
        self.registration.showNotification(ev.title, {
          body:ev.body, icon:'/icon-192.png', badge:'/icon-192.png',
          tag:ev.key, renotify:false, vibrate:[200,100,200],
        });
      }, delay);
      timers.set(ev.key, tid);
    }
  });
}

self.addEventListener('message', event => {
  const {type,tasks,settings} = event.data||{};
  if (type==='SCHEDULE_NOTIFICATIONS') scheduleNotifications(tasks,settings);
  if (type==='CANCEL_NOTIFICATIONS') cancelAll();
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
      if (list.length>0) { list[0].focus(); return; }
      clients.openWindow('/');
    })
  );
});

self.addEventListener('fetch', event => {
  if (event.request.url.includes('firestore')||event.request.url.includes('googleapis')||event.request.url.includes('firebase')) return;
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).catch(()=>cached)));
});
