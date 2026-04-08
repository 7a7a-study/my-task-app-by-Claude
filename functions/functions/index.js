/**
 * Slate タスクアプリ Cloud Functions
 *
 * ■ 無限ループ・コスト爆発 対策（4層構造）
 *
 *   Layer 1【ハッシュ比較】
 *     通知に無関係な変更（メモ・タイトル等）では一切実行しない → コスト0
 *
 *   Layer 2【レート制限】
 *     同一UIDで1分間に最大10回まで。超えたら静かにスキップ。
 *
 *   Layer 3【1日上限】
 *     1日の呼び出し合計が10,000回を超えたら当日停止（翌日0時に自動復旧）
 *
 *   Layer 4【月次上限】
 *     月間150万回到達で停止 → 翌月初に自動復旧
 *
 *   + maxInstances:3 で同時実行インスタンスを制限（無限増殖防止）
 *
 * ■ v24 → v25 の修正内容
 *   - notifHash / buildNotifs を sessions[0] ベースに修正
 *     （マイグレーション後は startDate が sessions[0] に移動されるため）
 *   - notifyStart/notifyDeadline の判定を falsy チェック → !== -1 に修正
 *     （notifyStart=0 が「定刻通知」を意味するため 0 を除外しないよう）
 *   - sendScheduledNotifs: 送信対象がない場合は checkAndIncrementUsage をスキップ
 *     （毎分の無駄な read+write を削減。1日 ~2880 ops の節約）
 *   - notifSettings を Firestore から読み込むよう変更
 *     （App.js 側で notifSettings を Firestore に保存するようにしたため）
 */

const functions = require("firebase-functions");
const admin     = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

const ALLOWED_UIDS   = ["w1HtaWxdSnMCV1miEm3yNF7g08J2", "mszdWzOojoURpcIQdYdA3FRpQiG2"];
const USAGE_DOC      = db.collection("system").doc("usage");

const RATE_LIMIT_PER_MIN = 10;
const DAILY_LIMIT        = 10_000;
const MONTHLY_LIMIT      = 1_500_000;
const MAX_NOTIFS         = 50;

function monthKey() {
  const d = new Date();
  return `count_${d.getFullYear()}_${String(d.getMonth()+1).padStart(2,"0")}`;
}
function dayKey() {
  const d = new Date();
  return `count_${d.getFullYear()}_${String(d.getMonth()+1).padStart(2,"0")}_${String(d.getDate()).padStart(2,"0")}`;
}
function minuteKey(uid) {
  const d = new Date();
  const min = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}${String(d.getHours()).padStart(2,"0")}${String(d.getMinutes()).padStart(2,"0")}`;
  return `rate_${uid}_${min}`;
}
function nextMidnight() {
  const d = new Date();
  d.setHours(24, 0, 0, 0);
  return d;
}
function nextMonthFirst() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 1);
}

async function isRateLimited(uid) {
  const key    = minuteKey(uid);
  const refDoc = db.collection("system").doc("rateCounters");
  try {
    let limited = false;
    await db.runTransaction(async (tx) => {
      const snap  = await tx.get(refDoc);
      const data  = snap.exists ? snap.data() : {};
      const count = (data[key] || 0) + 1;
      if (count > RATE_LIMIT_PER_MIN) { limited = true; return; }
      tx.set(refDoc, { [key]: count }, { merge: true });
    });
    return limited;
  } catch (e) {
    console.error("rate limit error:", e);
    return false;
  }
}

async function checkAndIncrementUsage() {
  const mKey = monthKey();
  const dKey = dayKey();
  try {
    let paused = false;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(USAGE_DOC);
      const data = snap.exists ? snap.data() : {};
      const resumeAt = data.resumeAt?.toDate?.() || null;
      if (data.notifPaused && resumeAt && new Date() >= resumeAt) {
        tx.set(USAGE_DOC, {
          notifPaused: false, pausedAt: null, resumeAt: null,
          [mKey]: (data[mKey] || 0) + 1, [dKey]: (data[dKey] || 0) + 1,
        }, { merge: true });
        return;
      }
      if (data.notifPaused) { paused = true; return; }
      const mCount = (data[mKey] || 0) + 1;
      const dCount = (data[dKey] || 0) + 1;
      const updates = { [mKey]: mCount, [dKey]: dCount };
      if (dCount >= DAILY_LIMIT) {
        Object.assign(updates, {
          notifPaused: true,
          pausedAt:    admin.firestore.FieldValue.serverTimestamp(),
          resumeAt:    admin.firestore.Timestamp.fromDate(nextMidnight()),
          pauseReason: "daily",
        });
        console.warn(`⚠️ 1日上限到達 (${dCount}回) → 翌日0時まで停止`);
      } else if (mCount >= MONTHLY_LIMIT) {
        Object.assign(updates, {
          notifPaused: true,
          pausedAt:    admin.firestore.FieldValue.serverTimestamp(),
          resumeAt:    admin.firestore.Timestamp.fromDate(nextMonthFirst()),
          pauseReason: "monthly",
        });
        console.warn(`⚠️ 月次上限到達 (${mCount}回) → 翌月初まで停止`);
      }
      tx.set(USAGE_DOC, updates, { merge: true });
    });
    return !paused;
  } catch (e) {
    console.error("usage check error:", e);
    return true;
  }
}

// ── 通知ハッシュ（変更検出用）────────────────────────────────────────
// 【修正】sessions[0] ベースで startDate/startTime を取得
// 【修正】notifyStart=0（定刻）が falsy 判定されないよう !== -1 で判定
function notifHash(tasks, settings) {
  function sig(t) {
    const s0 = (t.sessions && t.sessions.length > 0) ? t.sessions[0] : null;
    const startDate = s0?.startDate || t.startDate || "";
    const startTime = s0?.startTime || t.startTime || "";
    const kids = (t.children || []).map(sig).join(",");
    return [
      t.id,
      t.done ? 1 : 0,
      startDate,
      startTime,
      t.deadlineDate   || "",
      t.deadlineTime   || "",
      t.notifyStart    !== undefined ? t.notifyStart    : 0,
      t.notifyDeadline !== undefined ? t.notifyDeadline : "",
      kids,
    ].join(":");
  }
  const tStr = (tasks || []).map(sig).join("|");
  const sStr = `${settings?.enabled}:${settings?.minutesBefore}`;
  return `${tStr}##${sStr}`;
}

function toJSDate(dateStr, timeStr) {
  if (!dateStr) return null;
  return new Date(timeStr ? `${dateStr}T${timeStr}:00` : `${dateStr}T00:00:00`);
}

// ── 通知エントリ生成 ──────────────────────────────────────────────────
// 【修正】sessions[0] から startDate/startTime を取得
// 【修正】notifyStart !== -1 で判定（0=定刻通知を正しく扱う）
// 【修正】notifyDeadline の仕様を Client 側と統一
//         undefined/省略 → 時刻あり:180分前, 時刻なし:当日9:00
//         null           → 当日9:00
//         -1             → 通知しない
//         数値           → その分前
function buildNotifs(tasks, settings) {
  if (!settings?.enabled) return [];
  const notifs = [];
  const now    = Date.now();

  function process(t) {
    if (t.done) return;

    // 開始時刻通知
    const s0 = (t.sessions && t.sessions.length > 0) ? t.sessions[0] : null;
    const startDate = s0?.startDate || t.startDate || "";
    const startTime = s0?.startTime || t.startTime || "";

    if (startDate && startTime) {
      const minsBeforeStart = t.notifyStart !== undefined ? t.notifyStart : 0;
      if (minsBeforeStart !== -1) {
        const d = toJSDate(startDate, startTime);
        if (d && d.getTime() - minsBeforeStart * 60_000 > now) {
          const label = minsBeforeStart === 0 ? "開始時刻"
            : minsBeforeStart >= 60 ? `開始${minsBeforeStart / 60}時間前`
            : `開始${minsBeforeStart}分前`;
          notifs.push({
            taskId: t.id, type: "start",
            fireAt: admin.firestore.Timestamp.fromDate(
              new Date(d.getTime() - minsBeforeStart * 60_000)
            ),
            title: `▶️ ${label}：${t.title}`,
            body:  t.title,
          });
        }
      }
    }

    // 締切通知
    if (t.deadlineDate) {
      if (t.deadlineTime) {
        const minsBefore = (t.notifyDeadline !== undefined && t.notifyDeadline !== null)
          ? t.notifyDeadline : 180;
        if (minsBefore !== -1) {
          const d = toJSDate(t.deadlineDate, t.deadlineTime);
          if (d && d.getTime() - minsBefore * 60_000 > now) {
            const label = minsBefore >= 60
              ? `締切${minsBefore / 60}時間前` : `締切${minsBefore}分前`;
            notifs.push({
              taskId: t.id, type: "deadline",
              fireAt: admin.firestore.Timestamp.fromDate(
                new Date(d.getTime() - minsBefore * 60_000)
              ),
              title: `⏰ ${label}：${t.title}`,
              body:  t.title,
            });
          }
        }
      } else {
        const notifyMode = t.notifyDeadline !== undefined ? t.notifyDeadline : null;
        if (notifyMode !== -1) {
          const fireAt = new Date(`${t.deadlineDate}T09:00:00`).getTime();
          if (fireAt > now) {
            notifs.push({
              taskId: t.id, type: "deadlineDay",
              fireAt: admin.firestore.Timestamp.fromDate(new Date(fireAt)),
              title: `⏰ 今日が締切：${t.title}`,
              body:  t.title,
            });
          }
        }
      }
    }

    (t.children || []).forEach(process);
  }

  (tasks || []).forEach(process);
  return notifs
    .sort((a, b) => a.fireAt.toMillis() - b.fireAt.toMillis())
    .slice(0, MAX_NOTIFS);
}

// ════════════════════════════════════════════════════════════════════════
// Cloud Function ① onUserDataWrite
// ════════════════════════════════════════════════════════════════════════
exports.onUserDataWrite = functions
  .runWith({ maxInstances: 3, memory: "128MB", timeoutSeconds: 30 })
  .firestore
  .document("users/{uid}")
  .onWrite(async (change, context) => {
    const { uid } = context.params;
    if (!ALLOWED_UIDS.includes(uid)) return null;
    if (!change.after.exists)         return null;

    const before = change.before.exists ? change.before.data() : {};
    const after  = change.after.data();

    // Layer 1: notifSettings も含めてハッシュ比較
    if (notifHash(before.tasks, before.notifSettings) ===
        notifHash(after.tasks,  after.notifSettings)) return null;

    // Layer 2
    if (await isRateLimited(uid)) {
      console.log(`[rate_limited] uid=${uid}`);
      return null;
    }

    // Layer 3 & 4
    if (!(await checkAndIncrementUsage())) {
      console.log(`[usage_paused] uid=${uid}`);
      return null;
    }

    const notifs = buildNotifs(after.tasks, after.notifSettings);
    await change.after.ref.update({ scheduledNotifs: notifs });
    console.log(`[updated] uid=${uid} notifs=${notifs.length}`);
    return null;
  });

// ════════════════════════════════════════════════════════════════════════
// Cloud Function ② sendScheduledNotifs
// 1分おきに期限が来た通知をFCMで送信
// 【修正】送信対象がない場合は checkAndIncrementUsage をスキップ
//         → 毎分の無駄な 2ops（usage read+write）を節約
// ════════════════════════════════════════════════════════════════════════
exports.sendScheduledNotifs = functions
  .runWith({ maxInstances: 1, memory: "128MB", timeoutSeconds: 60 })
  .pubsub
  .schedule("every 1 minutes")
  .onRun(async () => {
    const now = admin.firestore.Timestamp.now();
    const batch = db.batch();
    let sendCount = 0;
    let hasWork   = false;

    // ── Phase 1: 送信対象を収集（usage カウンターはまだ触らない）──────
    const workItems = [];
    for (const uid of ALLOWED_UIDS) {
      try {
        const snap = await db.collection("users").doc(uid).get();
        if (!snap.exists) continue;
        const { scheduledNotifs: notifs = [], fcmToken: token } = snap.data();
        if (!token || !notifs.length) continue;
        const toSend = notifs.filter(n => n.fireAt.toMillis() <= now.toMillis());
        if (!toSend.length) continue;
        workItems.push({ snap, notifs, token, toSend });
        hasWork = true;
      } catch (e) {
        console.error(`[user_read_error] uid=${uid}:`, e);
      }
    }

    // 送信対象がなければ usage を消費せずに終了
    if (!hasWork) return null;

    // ── Phase 2: usage チェック（送信する場合のみ）───────────────────
    if (!(await checkAndIncrementUsage())) {
      console.log("[scheduler_paused]");
      return null;
    }

    // ── Phase 3: FCM 送信 ──────────────────────────────────────────────
    for (const { snap, notifs, token, toSend } of workItems) {
      const toKeep = notifs.filter(n => n.fireAt.toMillis() > now.toMillis());
      for (const n of toSend) {
        try {
          await admin.messaging().send({
            token,
            notification: { title: n.title, body: n.body },
            data: { taskId: n.taskId, type: n.type },
            webpush: { notification: { icon: "/logo192.png", badge: "/logo192.png" } },
          });
          sendCount++;
        } catch (e) {
          if (e.code === "messaging/registration-token-not-registered") {
            batch.update(snap.ref, { fcmToken: admin.firestore.FieldValue.delete() });
          }
          console.error(`[fcm_error] taskId=${n.taskId}:`, e.message);
        }
      }
      batch.update(snap.ref, { scheduledNotifs: toKeep });
    }

    await batch.commit();
    if (sendCount > 0) console.log(`[sent] ${sendCount}件`);
    return null;
  });
