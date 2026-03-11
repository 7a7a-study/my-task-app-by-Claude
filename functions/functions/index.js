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
 *     ※ スケジュール"更新"の制限。通知の"送信"は別系統なので影響なし。
 *
 *   Layer 3【1日上限】
 *     1日の呼び出し合計が10,000回を超えたら当日停止（翌日0時に自動復旧）
 *
 *   Layer 4【月次上限】
 *     月間150万回到達で停止 → 翌月初に自動復旧
 *
 *   + maxInstances:3 で同時実行インスタンスを制限（無限増殖防止）
 *
 * ■ 通知が来なくなることはないか？
 *   Layer 2・3・4 はすべて「スケジュール再計算」の実行制限。
 *   1分おきの「通知送信スケジューラー」は独立しており影響を受けない。
 *   ただし月次/1日停止中は送信スケジューラーも止まるため、
 *   その間は通知が届かない（画面上部のバナーで明示）。
 */

const functions = require("firebase-functions");
const admin     = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

// ── 定数 ──────────────────────────────────────────────────────────────
const ALLOWED_UIDS   = ["w1HtaWxdSnMCV1miEm3yNF7g08J2", "mszdWzOojoURpcIQdYdA3FRpQiG2"];
const USAGE_DOC      = db.collection("system").doc("usage");

const RATE_LIMIT_PER_MIN = 10;       // Layer2: 1ユーザー1分間に最大10回
const DAILY_LIMIT        = 10_000;   // Layer3: 1日の呼び出し合計上限
const MONTHLY_LIMIT      = 1_500_000;// Layer4: 月間呼び出し合計上限（無料枠200万の75%）
const MAX_NOTIFS         = 50;       // 1ユーザーあたりの最大通知スケジュール数

// ── キー生成 ──────────────────────────────────────────────────────────
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

// ── Layer 2: レート制限（1ユーザー1分10回まで）────────────────────────
/**
 * @returns {Promise<boolean>} true = 制限超過（スキップすべき）
 */
async function isRateLimited(uid) {
  const key    = minuteKey(uid);
  const refDoc = db.collection("system").doc("rateCounters");
  try {
    let limited = false;
    await db.runTransaction(async (tx) => {
      const snap  = await tx.get(refDoc);
      const data  = snap.exists ? snap.data() : {};
      const count = (data[key] || 0) + 1;
      if (count > RATE_LIMIT_PER_MIN) {
        limited = true;
        return; // カウントも増やさない
      }
      tx.set(refDoc, { [key]: count }, { merge: true });
    });
    return limited;
  } catch (e) {
    console.error("rate limit error:", e);
    return false; // エラー時は通過
  }
}

// ── Layer 3 & 4: 使用量チェック＋インクリメント ────────────────────────
/**
 * 1日・月次の呼び出し回数をインクリメントして上限チェック。
 * 停止中の場合・上限到達時は notifPaused=true をセット。
 * @returns {Promise<boolean>} true=利用可能, false=停止中
 */
async function checkAndIncrementUsage() {
  const mKey = monthKey();
  const dKey = dayKey();
  try {
    let paused = false;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(USAGE_DOC);
      const data = snap.exists ? snap.data() : {};

      // ── 自動復旧チェック ──────────────────────────────────────────
      const resumeAt = data.resumeAt?.toDate?.() || null;
      if (data.notifPaused && resumeAt && new Date() >= resumeAt) {
        // 翌日0時 or 翌月初を過ぎていたら復旧
        const updates = {
          notifPaused: false,
          pausedAt:    null,
          resumeAt:    null,
          [mKey]:      (data[mKey] || 0) + 1,
          [dKey]:      (data[dKey] || 0) + 1,
        };
        tx.set(USAGE_DOC, updates, { merge: true });
        return;
      }

      // ── 停止中はスキップ ──────────────────────────────────────────
      if (data.notifPaused) {
        paused = true;
        return;
      }

      const mCount = (data[mKey] || 0) + 1;
      const dCount = (data[dKey] || 0) + 1;
      const updates = { [mKey]: mCount, [dKey]: dCount };

      // Layer3: 1日上限
      if (dCount >= DAILY_LIMIT) {
        updates.notifPaused = true;
        updates.pausedAt    = admin.firestore.FieldValue.serverTimestamp();
        updates.resumeAt    = admin.firestore.Timestamp.fromDate(nextMidnight());
        updates.pauseReason = "daily";
        console.warn(`⚠️ 1日上限到達 (${dCount}回) → 翌日0時まで停止`);
      }
      // Layer4: 月次上限
      else if (mCount >= MONTHLY_LIMIT) {
        updates.notifPaused = true;
        updates.pausedAt    = admin.firestore.FieldValue.serverTimestamp();
        updates.resumeAt    = admin.firestore.Timestamp.fromDate(nextMonthFirst());
        updates.pauseReason = "monthly";
        console.warn(`⚠️ 月次上限到達 (${mCount}回) → 翌月初まで停止`);
      }

      tx.set(USAGE_DOC, updates, { merge: true });
    });
    return !paused;
  } catch (e) {
    console.error("usage check error:", e);
    return true; // エラー時は通過（安全側）
  }
}

// ── 通知ハッシュ（変更検出用）────────────────────────────────────────
function notifHash(tasks, settings) {
  function sig(t) {
    const kids = (t.children || []).map(sig).join(",");
    return [t.id, t.done?1:0, t.startDate||"", t.startTime||"",
            t.deadlineDate||"", t.deadlineTime||"",
            t.notifyStart||0, t.notifyDeadline||0, kids].join(":");
  }
  const tStr = (tasks || []).map(sig).join("|");
  const sStr = `${settings?.enabled}:${settings?.minutesBefore}`;
  return `${tStr}##${sStr}`;
}

// ── 通知エントリ生成 ──────────────────────────────────────────────────
function toJSDate(dateStr, timeStr) {
  if (!dateStr) return null;
  return new Date(timeStr ? `${dateStr}T${timeStr}:00` : `${dateStr}T00:00:00`);
}

function buildNotifs(tasks, settings) {
  if (!settings?.enabled) return [];
  const notifs = [];
  const now    = Date.now();
  const before = (settings.minutesBefore || 60) * 60 * 1000;

  function process(t) {
    if (t.done) return;
    if (t.notifyStart && t.startDate) {
      const d = toJSDate(t.startDate, t.startTime);
      if (d && d.getTime() - before > now) {
        notifs.push({
          taskId: t.id, type: "start",
          fireAt: admin.firestore.Timestamp.fromDate(new Date(d.getTime() - before)),
          title: "📅 タスク開始前", body: t.title,
        });
      }
    }
    if (t.notifyDeadline && t.deadlineDate) {
      const d = toJSDate(t.deadlineDate, t.deadlineTime);
      if (d && d.getTime() - before > now) {
        notifs.push({
          taskId: t.id, type: "deadline",
          fireAt: admin.firestore.Timestamp.fromDate(new Date(d.getTime() - before)),
          title: "⚠️ 締切前", body: t.title,
        });
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
// users/{uid} が書き換わったら通知スケジュールを再計算
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

    // Layer 1: 通知関連フィールドに変化がなければ即終了（コスト0）
    if (notifHash(before.tasks, before.notifSettings) ===
        notifHash(after.tasks,  after.notifSettings)) return null;

    // Layer 2: レート制限（1分間に10回まで）
    if (await isRateLimited(uid)) {
      console.log(`[rate_limited] uid=${uid}`);
      return null;
    }

    // Layer 3 & 4: 1日・月次使用量チェック
    if (!(await checkAndIncrementUsage())) {
      console.log(`[usage_paused] uid=${uid}`);
      return null;
    }

    // 通知スケジュール再計算 → 保存（1回の書き込みのみ）
    const notifs = buildNotifs(after.tasks, after.notifSettings);
    await change.after.ref.update({ scheduledNotifs: notifs });
    console.log(`[updated] uid=${uid} notifs=${notifs.length}`);
    return null;
  });

// ════════════════════════════════════════════════════════════════════════
// Cloud Function ② sendScheduledNotifs
// 1分おきに期限が来た通知をFCMで送信
// ※ Layer2（レート制限）の影響を受けない独立系統
// ════════════════════════════════════════════════════════════════════════
exports.sendScheduledNotifs = functions
  .runWith({ maxInstances: 1, memory: "128MB", timeoutSeconds: 60 })
  .pubsub
  .schedule("every 1 minutes")
  .onRun(async () => {
    // 1日・月次チェック（スケジューラー自体の呼び出しもカウント）
    if (!(await checkAndIncrementUsage())) {
      console.log("[scheduler_paused]");
      return null;
    }

    const now   = admin.firestore.Timestamp.now();
    const batch = db.batch();
    let sendCount = 0;

    for (const uid of ALLOWED_UIDS) {
      try {
        const snap = await db.collection("users").doc(uid).get();
        if (!snap.exists) continue;

        const { scheduledNotifs: notifs = [], fcmToken: token } = snap.data();
        if (!token || !notifs.length) continue;

        const toSend = notifs.filter(n => n.fireAt.toMillis() <= now.toMillis());
        const toKeep = notifs.filter(n => n.fireAt.toMillis() >  now.toMillis());
        if (!toSend.length) continue;

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
      } catch (e) {
        console.error(`[user_error] uid=${uid}:`, e);
      }
    }

    await batch.commit();
    if (sendCount > 0) console.log(`[sent] ${sendCount}件`);
    return null;
  });
