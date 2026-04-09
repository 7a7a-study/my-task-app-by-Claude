import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { auth, provider, db } from "./firebase";
import { signInWithPopup, signOut, onAuthStateChanged, GoogleAuthProvider } from "firebase/auth";
import { doc, setDoc, onSnapshot } from "firebase/firestore";
import { registerSW, scheduleNotifications, startForegroundCheck } from "./notifications";
import { saveGCalToken, clearGCalToken, fetchGCalEvents } from "./gcal";

import { C, G, TAG_PRESETS, ALLOWED } from "./constants";
import { localDate, flatten, parseRepeat, syncTags, syncDone, isLaterTask, toggleMemo, fetchHolidays, useIsPC } from "./utils";
import { CB, Btn, Login, NotificationModal } from "./components/ui";
import { TaskForm } from "./components/TaskForm";
import { LaterPanel } from "./components/LaterPanel";
import { ListView } from "./views/ListView";
import { DayView } from "./views/DayView";
import { WeekView } from "./views/WeekView";
import { GanttView } from "./views/GanttView";
import { DashboardView } from "./views/DashboardView";
import { ReportView } from "./views/ReportView";
import { TagsView } from "./views/TagsView";
import { TemplatesView } from "./views/TemplatesView";

// ── 既存タスクのマイグレーション ────────────────────────────────────
const migrateTask = (t) => {
  // sessions[] の各枠を新フィールドに統一（date → startDate、不正フィールドを除去）
  const migrateSessions = (sessions) => sessions
    .map(s => {
      // startDate が空でも date から復元を試みる
      const sd = (s.startDate && s.startDate !== "") ? s.startDate : (s.date && s.date !== "") ? s.date : "";
      return { sd, s };
    })
    .filter(({sd}) => sd !== "")  // 日付のないセッションを除去
    .map(({sd, s}) => ({
      // 必要なフィールドだけ明示的にピック（タスク本体のstartDate等の混入を防ぐ）
      id:        s.id || ("s_" + Math.random().toString(36).slice(2,8)),
      startDate: sd,
      date:      sd,  // 旧フィールド互換
      startTime: s.startTime || "",
      endDate:   s.endDate || "",
      endTime:   s.endTime || "",
    }));

  // children は undefined にしない（JSON比較の false-positive を防ぐ）
  // migrateTasks 側で children を上書きするため、ここでは spread のまま
  let result = {...t};

  // sessions がある場合は枠フィールドを統一
  // 繰り返しタスクで日付なし・時間あり のセッションは後段の補完に回すため除去しない
  if ((t.sessions||[]).length > 0) {
    const repeatType2 = typeof t.repeat === "string" ? t.repeat : t.repeat?.type;
    const isRep = repeatType2 && repeatType2 !== "なし";
    if (isRep) {
      // 日付なしセッションも一旦通す（後段で startDate 補完される）
      result = {...result, sessions: t.sessions.map(s => {
        const sd = (s.startDate && s.startDate !== "") ? s.startDate : (s.date && s.date !== "") ? s.date : "";
        return {
          id:        s.id || ("s_" + Math.random().toString(36).slice(2,8)),
          startDate: sd,
          date:      sd,
          startTime: s.startTime || "",
          endDate:   s.endDate || "",
          endTime:   s.endTime || "",
        };
      })};
    } else {
      result = {...result, sessions: migrateSessions(t.sessions)};
    }
  }

  // 旧フォーマット：startDate がタスク本体にある場合 sessions[0] に移動
  if (t.startDate) {
    const mainSession = {
      id: "s_main",
      startDate: t.startDate,
      date: t.startDate,  // 互換
      startTime: t.startTime || "",
      endDate: t.endDate || "",
      endTime: t.endTime || "",
    };
    const existingSessions = migrateSessions(t.sessions || []);
    const alreadyHasMain = existingSessions.some(s => s.id === "s_main");
    result = {
      ...result,
      startDate: "",
      startTime: "",
      endTime: "",
      sessions: alreadyHasMain ? existingSessions : [mainSession, ...existingSessions],
    };
  }

  // task.endDate を sessions[0].endDate に移動（繰り返しタスクの終了日）
  if (t.endDate && (result.sessions||[]).length > 0 && !result.sessions[0].endDate) {
    result = {
      ...result,
      sessions: result.sessions.map((s, i) => i === 0 ? {...s, endDate: t.endDate} : s),
    };
  }

  // 繰り返しタスクで sessions[0].endDate === startDate になっているデータを修復
  // （TaskFormの開始日自動セットバグで登録当日しか表示されなくなる問題）
  if (result.repeat && result.repeat !== "なし") {
    const s0 = (result.sessions||[])[0];
    if (s0 && s0.endDate && s0.endDate === (s0.startDate || s0.date || "")) {
      result = {
        ...result,
        sessions: result.sessions.map((s, i) => i === 0 ? {...s, endDate: ""} : s),
      };
    }
  }

  // 繰り返しタスクで sessions が空 or startDate なしセッションあり → task_timestamp から登録日を補完
  const repeatType = typeof result.repeat === "string" ? result.repeat : result.repeat?.type;
  if (repeatType && repeatType !== "なし") {
    const tsMatch = (result.id || "").match(/task_(\d{13})/);
    const d = tsMatch ? new Date(parseInt(tsMatch[1], 10)) : new Date();
    const pad = n => String(n).padStart(2, "0");
    const createdDate = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    if ((result.sessions||[]).length === 0) {
      // セッションなし → 新規生成
      result = {
        ...result,
        sessions: [{
          id: "s_migrated_" + (result.id || ""),
          startDate: createdDate,
          date:      createdDate,
          startTime: "",
          endDate:   "",
          endTime:   "",
        }],
      };
    } else {
      // 日付なしセッションに startDate を補完（時間は保持）
      const needsFill = result.sessions.some(s => !s.startDate && !s.date);
      if (needsFill) {
        result = {
          ...result,
          sessions: result.sessions.map(s =>
            (s.startDate || s.date) ? s : {...s, startDate: createdDate, date: createdDate}
          ),
        };
      }
    }
  }

  return result;
};
const migrateTasks = (tasks) => tasks.map(t => ({
  ...migrateTask(t),
  children: migrateTasks(t.children || []),
}));

// ── マイグレーション要否の判定（children:[] vs undefined の差異は無視）──
// ── マイグレーション要否の判定（children:[] vs undefined の差異は無視）──
const needsMigration = (original, migrated) => {
  const strip = tasks => JSON.stringify(tasks, (key, val) => {
    if (key === "children" && (!val || (Array.isArray(val) && val.length === 0))) return "__empty__";
    return val;
  });
  return strip(original) !== strip(migrated);
};

export default function App() {
  const [sideOpen, setSideOpen]       = useState(window.innerWidth >= 768);
  const [sortOrder, setSortOrder]     = useState("デフォルト");
  const today = localDate();
  const [user, setUser]               = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginLoading, setLoginLoading] = useState(false);
  const [saving, setSaving]           = useState(false);
  const [tasks, setTasksRaw]          = useState([]);
  const [tags, setTagsRaw]            = useState(TAG_PRESETS);
  const [templates, setTemplatesRaw]  = useState([]);
  const [view, setView]               = useState("dashboard");
  const [showForm, setShowForm]       = useState(false);
  const [editTask, setEditTask]       = useState(null);
  const [isDuplicate, setIsDuplicate] = useState(false); // 複製フォームかどうか
  const [addChildTo, setAddChildTo]   = useState(null);
  const [filters, setFilters]         = useState({tag: "", search: "", hideCompleted: true});
  const [dragTask, setDragTask]       = useState(null);
  const [defDate, setDefDate]         = useState(null);
  const [defTime, setDefTime]         = useState(null);
  const [showNotifModal, setShowNotifModal] = useState(false);
  const [notifSettings, setNotifSettingsRaw] = useState(() => {
    try { return JSON.parse(localStorage.getItem("notifSettings") || "null") || {enabled: false, minutesBefore: 60}; }
    catch { return {enabled: false, minutesBefore: 60}; }
  });
  // GCalイベント（メモリのみ・Firestore書き込みなし）
  const [gcalEvents, setGCalEvents] = useState(null); // null=未取得, []=取得済み空, [...]=イベントあり
  const [gcalEnabled, setGCalEnabled] = useState(() => {
    try { return localStorage.getItem("gcal_enabled") === "true"; } catch { return false; }
  });
  const [gcalError, setGCalError] = useState(null); // "no_token" | "api_error" | null
  const [gcalFetchTrigger, setGCalFetchTrigger] = useState(0); // ログイン後の再取得トリガー

  // notifRef はここで宣言（setNotifSettings の closure で参照するため先に定義）
  const notifRef = useRef(notifSettings);
  const setNotifSettings = s => {
    setNotifSettingsRaw(s);
    notifRef.current = s;  // ref を即時更新（save2DB が800ms後に参照するため）
    try { localStorage.setItem("notifSettings", JSON.stringify(s)); } catch {}
  };

  // 認証
  useEffect(() => { const u = onAuthStateChanged(auth, u => { setUser(u); setAuthLoading(false); }); return u; }, []);

  // Firestore リアルタイム同期
  // hasPendingWrites=true の間はローカル書き込み中なのでスキップ
  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(
      doc(db, "users", user.uid),
      snap => {
        if (snap.metadata.hasPendingWrites) return;
        if (snap.exists()) {
          const d = snap.data();
          if (d.tasks) {
            const migrated = migrateTasks(d.tasks);
            setTasksRaw(migrated);
            // マイグレーションが必要な場合のみ保存トリガー
            // needsMigration は children:[]↔undefined の差異を無視して比較
            if (needsMigration(d.tasks, migrated)) {
              // 直接 setDoc ではなく debounced save2DB を使う
              // → scheduledNotifs/fcmToken の上書き消去を防ぎ、
              //   複数デバイスからの同時書き込みも自然に吸収できる
              save2DBRef.current();
            }
          }
          if (d.tags)           setTagsRaw(d.tags);
          if (d.templates)      setTemplatesRaw(d.templates);
          // notifSettings が Firestore に保存されていれば復元
          // （localStorage を持たない別デバイスとの同期用）
          if (d.notifSettings)  setNotifSettingsRaw(d.notifSettings);
        }
      }
    );
    return unsub;
  }, [user]); // eslint-disable-line

  // 今年・来年の祝日プリフェッチ
  useEffect(() => { const y = new Date().getFullYear(); fetchHolidays(y); fetchHolidays(y + 1); }, []);

  // Service Worker登録
  useEffect(() => { registerSW(); }, []);

  // 通知スケジュール
  const notifHash = useMemo(() =>
    flatten(tasks).map(t =>
      `${t.id}:${t.done}:${t.startDate || ""}:${t.startTime || ""}:${t.deadlineDate || ""}:${t.deadlineTime || ""}:${t.notifyStart ?? 0}:${t.notifyDeadline ?? ""}`
    ).join("|"),
  [tasks]);
  useEffect(() => { scheduleNotifications(tasks, notifSettings); }, [notifHash, notifSettings]);

  // notifRef を notifSettings の変化に追従させる（useCallback/setInterval内のstale closure防止）
  useEffect(() => { notifRef.current = notifSettings; }, [notifSettings]);

  // フォアグラウンド通知チェック
  useEffect(() => {
    const stop = startForegroundCheck(() => tasksLatest.current, () => notifRef.current, null);
    return stop;
  }, []);

  // ── GCalイベント取得（メモリキャッシュ/Firestore書き込みなし）─────────
  // ビューが日/週/ダッシュボードに切り替わったとき、または今日の日付が変わったときに取得。
  // gcalEnabledがfalseのときは何もしない。
  const gcalFetchRef = useRef(null); // 重複fetch防止
  useEffect(() => {
    if (!gcalEnabled) return;
    // 取得対象期間：今日から±30日（週ビュー・ダッシュボードをカバー）
    const from = (() => { const d = new Date(today); d.setDate(d.getDate()-7); return d.toISOString().slice(0,10); })();
    const to   = (() => { const d = new Date(today); d.setDate(d.getDate()+30); return d.toISOString().slice(0,10); })();
    const key  = from + "_" + to + "_" + gcalFetchTrigger;
    if (gcalFetchRef.current === key) return; // 同一範囲は再取得しない
    gcalFetchRef.current = key;

    fetchGCalEvents(from, to).then(events => {
      if (events === null) {
        setGCalError("no_token"); // トークンなし（再ログイン案内）
        setGCalEvents(null);
      } else {
        setGCalError(null);
        setGCalEvents(events);
      }
    });
  }, [gcalEnabled, today, gcalFetchTrigger]); // eslint-disable-line

  // 最新値をrefで追跡（stale closure防止のため save2DB 呼び出し時に参照する）
  const tasksLatest     = useRef(tasks);
  const tagsLatest      = useRef(tags);
  const templatesLatest = useRef(templates);
  useEffect(() => { tasksLatest.current = tasks; }, [tasks]);
  useEffect(() => { tagsLatest.current = tags; }, [tags]);
  useEffect(() => { templatesLatest.current = templates; }, [templates]);

  // ── save2DB：デバウンス付き Firestore 保存 ──────────────────────────
  // 【設計方針】
  //   - 引数なし。ref（最新値）を参照するため、ドラッグ中の連続呼び出しは
  //     最後の1回だけが実際に保存される（Firestore 書き込み回数を大幅削減）
  //   - setDoc に { merge: true } を付けることで scheduledNotifs / fcmToken を
  //     上書き消去しない（Cloud Function との共存に必須）
  //   - notifSettings も保存することで Cloud Function が FCM 通知設定を読める
  //   - クライアント側ハードストップ：5分間に20回を超えたら保存を停止
  //     （CF側 Layer2〜4 と独立した最終安全弁）
  const saveTimerRef    = useRef(null);
  const save2DBRef      = useRef(null); // onSnapshot 内から参照するための ref
  const saveCountRef    = useRef(0);    // ハードストップ用カウンター
  const saveCountReset  = useRef(null); // カウンターリセットタイマー
  const saveHalted      = useRef(false);// ハードストップフラグ

  const save2DB = useCallback(() => {
    if (!user) return;

    // ── ハードストップ判定（5分間に20回超え）──────────────────────────
    if (saveHalted.current) {
      console.error("[save2DB] ハードストップ中。Firestoreへの保存を停止しています。");
      return;
    }
    saveCountRef.current += 1;
    if (!saveCountReset.current) {
      saveCountReset.current = setTimeout(() => {
        saveCountRef.current  = 0;
        saveHalted.current    = false; // 5分後にリセット（自動復旧）
        saveCountReset.current = null;
      }, 5 * 60 * 1000);
    }
    if (saveCountRef.current > 20) {
      saveHalted.current = true;
      console.error(`[save2DB] 5分間に${saveCountRef.current}回の保存を検出。無限ループの可能性があるため停止しました。`);
      return;
    }

    // ── デバウンス（800ms）──────────────────────────────────────────
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      saveTimerRef.current = null;
      setSaving(true);
      try {
        await setDoc(
          doc(db, "users", user.uid),
          {
            tasks:        tasksLatest.current,
            tags:         tagsLatest.current,
            templates:    templatesLatest.current,
            notifSettings: notifRef.current,
            updatedAt:    new Date().toISOString(),
          },
          { merge: true }   // ← scheduledNotifs / fcmToken を消さない
        );
      } catch (e) {
        console.error("保存失敗", e);
      }
      setSaving(false);
    }, 800); // 800ms デバウンス：ドラッグ中の連続更新を1回に集約
  }, [user]);

  // onSnapshot の closure からも最新の save2DB を呼べるよう ref に保持
  useEffect(() => { save2DBRef.current = save2DB; }, [save2DB]);

  const setTasks     = t  => { setTasksRaw(t);  save2DB(); };
  const setTags      = tg => { setTagsRaw(tg);  save2DB(); };
  const setTemplates = tp => { setTemplatesRaw(tp); save2DB(); };

  const handleLogin = async () => {
    setLoginLoading(true);
    try {
      const r = await signInWithPopup(auth, provider);
      if (!ALLOWED.includes(r.user.uid)) { await signOut(auth); alert("アクセスできません。"); }
      else {
        // GCalアクセストークンをlocalStorageに保存（Firestoreへの書き込みなし）
        const credential = GoogleAuthProvider.credentialFromResult(r);
        if (credential) { saveGCalToken(credential); setGCalFetchTrigger(n => n + 1); }
      }
    } catch(e) { console.error(e); }
    setLoginLoading(false);
  };

  // ツリー操作
  const updTreeLocal  = (ts, id, fn) => ts.map(t => t.id === id ? fn(t) : {...t, children: updTreeLocal(t.children || [], id, fn)});
  const delTreeLocal  = (ts, id)     => ts.filter(t => t.id !== id).map(t => ({...t, children: delTreeLocal(t.children || [], id)}));
  const addChild      = (ts, pid, c) => ts.map(t => t.id === pid ? {...t, children: [...(t.children || []), c]} : {...t, children: addChild(t.children || [], pid, c)});

  const handleSave = f => {
    // TaskFormは _sessions か sessions（展開済み）のどちらかで渡してくる
    const {_sessions, ...fStripped} = f;
    const rawSessions = _sessions ?? fStripped.sessions ?? [];
    const isRepeat = fStripped.repeat && parseRepeat(fStripped.repeat).type !== "なし";
    // 繰り返しタスクで日付なしセッション（時間だけ入っている場合も含む）→ 今日を startDate に上書き
    const filledSessions = isRepeat
      ? (() => {
          const today = localDate();
          const filled = rawSessions.map(s =>
            (s.startDate || s.date) ? s : {...s, startDate: today, date: today}
          );
          // セッションが空なら新規生成
          if (filled.length === 0) {
            return [{ startDate: today, date: today, startTime: "", endDate: "", endTime: "" }];
          }
          return filled;
        })()
      : rawSessions;
    let sessions = filledSessions
      .filter(s => s.startDate || s.date)  // startDateなしはセッションとして無効
      .map(s => ({
        id: s.id || ("s_" + Date.now() + "_" + Math.random().toString(36).slice(2,6)),
        startDate: s.startDate || s.date || "",
        date:      s.startDate || s.date || "",  // 旧フィールド互換
        startTime: s.startTime || "",
        endDate:   s.endDate || "",
        endTime:   s.endTime || "",
      }));
    const fw = {
      ...fStripped,
      startDate: "",
      startTime: "",
      endTime: "",
      sessions,
      isLater: isLaterTask({...fStripped, sessions}),  // sessions確定後に判定
    };
    let nt;
    const isExisting = editTask && allFlat.some(t => t.id === editTask.id);
    if (isExisting)      nt = updTreeLocal(tasks, f.id, () => fw);
    else if (addChildTo) nt = addChild(tasks, addChildTo, fw);
    else                 nt = [...tasks, fw];
    const synced = syncTags(nt, fw.id, fw.tags, tags);
    setTasks(syncDone(synced));
    setEditTask(null); setAddChildTo(null);
  };

  const handleUpdate = updated => {
    // getTasksForDate が付加した一時フィールドを除去してから保存
    const clean = {...updated};
    delete clean._pt; delete clean._pid;
    delete clean._sessionId; delete clean._sessionOnly;
    delete clean._isDeadline; delete clean._overrideKey; delete clean._overrideId;
    delete clean._w7deadline; delete clean._w7session;
    // セッションを正規化（不正フィールド混入・startDateなしを除去）
    if (clean.sessions) {
      clean.sessions = clean.sessions
        .map(s => {
          const sd = (s.startDate && s.startDate !== "") ? s.startDate : (s.date && s.date !== "") ? s.date : "";
          return {sd, s};
        })
        .filter(({sd}) => sd !== "")
        .map(({sd, s}) => ({
          id:        s.id || ("s_" + Date.now() + "_" + Math.random().toString(36).slice(2,6)),
          startDate: sd,
          date:      sd,
          startTime: s.startTime || "",
          endDate:   s.endDate || "",
          endTime:   s.endTime || "",
        }));
    }
    const synced = syncTags(updTreeLocal(tasks, clean.id, () => clean), clean.id, clean.tags, tags);
    setTasks(syncDone(synced));
    setDragTask(null);
  };

  const handleAdd    = (date, hour) => { setDefDate(date); setDefTime(hour != null ? `${String(hour).padStart(2, "0")}:00` : null); setEditTask(null); setAddChildTo(null); setShowForm(true); };

  const handleToggle = (id, forDate) => {
    const allFlat2 = allFlat;
    const target = allFlat2.find(t => t.id === id);
    if (!target) return;
    const isRepeat = target.repeat && parseRepeat(target.repeat).type !== "なし";
    if (isRepeat) {
      const date = forDate || localDate();
      const doneDates = [...(target.doneDates || [])];
      const alreadyDone = doneDates.includes(date);
      const newDone = alreadyDone
        ? doneDates.filter(d => d !== date)
        : [...doneDates, date];
      setTasks(syncDone(updTreeLocal(tasks, id, t => ({...t, doneDates: newDone}))));
      return;
    }
    if (!target.done && (target.children || []).length > 0) {
      const hasPendingChild = flatten(target.children || []).some(c => !c.done);
      if (hasPendingChild) { alert("子タスクをすべて完了してから親タスクを完了にしてください"); return; }
    }
    setTasks(syncDone(updTreeLocal(tasks, id, t => ({...t, done: !t.done}))));
  };

  const handleDelete = id => setTasks(delTreeLocal(tasks, id));

  const handleSkip = (id, date) => {
    const t = allFlat.find(x => x.id === id);
    if (!t) return;
    const skipDates = [...(t.skipDates || [])];
    if (!skipDates.includes(date)) skipDates.push(date);
    setTasks(syncDone(updTreeLocal(tasks, id, x => ({...x, skipDates}))));
  };

  const handleOverride = (id, origDate, ov) => {
    const t = allFlat.find(x => x.id === id);
    if (!t) return;
    const overrideDates = {...(t.overrideDates || {}), [origDate]: ov};
    setTasks(syncDone(updTreeLocal(tasks, id, x => ({...x, overrideDates}))));
  };

  const handleAddSession = (id, session) => {
    setTasks(updTreeLocal(tasks, id, t => ({...t, sessions: [...(t.sessions || []), session]})));
  };

  // 時間枠を1つ削除（sessionのidで特定）
  const handleRemoveSession = (taskId, sessionId) => {
    setTasks(updTreeLocal(tasks, taskId, t => {
      const sessions = (t.sessions || []).filter(s => s.id !== sessionId);
      return {
        ...t,
        sessions,
        isLater: isLaterTask({...t, sessions}),
      };
    }));
  };

  // 時間枠クリア（タスクは残す・日程だけ消す）
  const handleClearSchedule = id => {
    setTasks(updTreeLocal(tasks, id, t => ({
      ...t,
      startDate: "", startTime: "", endTime: "", duration: "",
      sessions: [], isLater: true,
    })));
  };

  const handleMemoToggle = (id, idx) => {
    const next = updTreeLocal(tasks, id, x => ({...x, memo: toggleMemo(x.memo, idx)}));
    setTasksRaw(next);  // setTasks ではなく setTasksRaw（DB保存は下の save2DB に任せる）
    save2DB();          // デバウンス済み：連続トグルは最後の1回だけ保存
  };

  const handleEdit = t => {
    // _sessionOnly チップから来た場合、startDate/startTime/endTime が枠の値に上書きされているので元タスクを引き直す
    const original = allFlat.find(x => x.id === t.id);
    setEditTask(original || t);
    setIsDuplicate(false);
    setShowForm(true);
  };

  const handleDuplicate = t => {
    const dupChildren = cs => (cs || []).map(c => ({...c, id: "task_" + Date.now() + Math.random(), done: false, children: dupChildren(c.children)}));
    const dup = {...t, id: "task_" + Date.now(), done: false, children: dupChildren(t.children)};
    delete dup._pt; delete dup._pid;
    setEditTask(dup);
    setIsDuplicate(true);
    setShowForm(true);
  };

  const handleUseTemplate = tpl => {
    const mk = t => ({id: "task_" + Date.now() + Math.random(), title: t.title, done: false, tags: t.tags || [], memo: t.memo || "", startDate: "", startTime: "", endDate: "", endTime: "", deadlineDate: "", deadlineTime: "", repeat: "なし", duration: "", isLater: true, children: (t.children || []).map(c => mk(c))});
    setTasks([...tasks, ...tpl.tasks.map(t => mk(t))]);
    setView("list");
  };

  const allFlat   = useMemo(() => flatten(tasks), [tasks]);
  const nonRepeat = useMemo(() => allFlat.filter(t => !t.repeat || parseRepeat(t.repeat).type === "なし"), [allFlat]);
  const doneCnt   = nonRepeat.filter(t => t.done).length;
  const totalCnt  = nonRepeat.length;
  const activeCnt = nonRepeat.filter(t => !t.done).length;
  const pct       = totalCnt > 0 ? Math.round((doneCnt / totalCnt) * 100) : 0;

  const isPC = useIsPC();
  const NAV = [
    {id: "dashboard", label: "ダッシュボード", icon: "◈"},
    {id: "list",      label: "リスト",         icon: "☰"},
    ...(isPC ? [] : [{id: "day", label: "日", icon: "📆"}]),
    {id: "week",      label: "週",             icon: "📅"},
    {id: "gantt",     label: "ガント",         icon: "📊"},
    {id: "templates", label: "テンプレート",   icon: "📋"},
    {id: "tagmgr",    label: "タグ管理",       icon: "🏷"},
    {id: "report",    label: "レポート",       icon: "📈"},
  ];
  const ptags    = tags.filter(t => !t.parentId && !t.archived);
  const showLater = ["day", "week", "gantt"].includes(view);

  if (authLoading) return <div style={{minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", color: C.textMuted}}>読み込み中...</div>;
  if (!user)       return <Login onLogin={handleLogin} loading={loginLoading}/>;

  return (
    <>
      <style>{G}</style>
      <div style={{minHeight: "100vh", background: C.bg, display: "flex"}}>
        {/* サイドバー */}
        <div style={{width: sideOpen ? 200 : 42, flexShrink: 0, background: C.surface, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", position: "fixed", top: 0, left: 0, height: "100vh", overflowY: "auto", zIndex: 10, transition: "width .2s", boxShadow: "2px 0 16px rgba(0,0,0,.3)"}}>
          <div style={{padding: `10px ${sideOpen ? 12 : 5}px 9px`, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4, flexShrink: 0}}>
            {sideOpen && (
              <div style={{minWidth: 0, flex: 1}}>
                <div style={{display: "flex", alignItems: "center", gap: 8, marginBottom: 2}}>
                  <div style={{width: 28, height: 28, borderRadius: 8, overflow: "hidden", flexShrink: 0, boxShadow: "0 2px 8px rgba(0,0,0,.3)"}}>
                    <img src="/logo512.png" alt="Slate" style={{width: "100%", height: "100%", objectFit: "cover"}}/>
                  </div>
                  <div style={{fontFamily: "'Playfair Display',serif", fontWeight: 700, fontSize: 16, whiteSpace: "nowrap", letterSpacing: 0.5}}>
                    <span style={{background: `linear-gradient(135deg,${C.accent},${C.info})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent"}}>Slate</span>
                  </div>
                </div>
                <div style={{fontSize: 9, color: C.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"}}>{user.email}</div>
                {saving && <div style={{fontSize: 8, color: C.success, marginTop: 1}}>💾 保存中...</div>}
                <div style={{marginTop: 7}}>
                  <div style={{display: "flex", justifyContent: "space-between", fontSize: 8, color: C.textMuted, marginBottom: 2}}>
                    <span>進捗</span><span style={{fontWeight: 700, color: C.accent}}>{pct}%</span>
                  </div>
                  <div style={{background: C.bg, borderRadius: 8, height: 3, overflow: "hidden"}}>
                    <div style={{width: `${pct}%`, height: "100%", background: `linear-gradient(90deg,${C.accent},${C.success})`, borderRadius: 8, transition: "width .5s"}}/>
                  </div>
                  <div style={{fontSize: 10, color: C.textSub, marginTop: 3, fontWeight: 600}}>{doneCnt}件完了 <span style={{color: C.textMuted, fontWeight: 400}}>／</span> 残り<span style={{color: C.accent}}>{activeCnt}</span>件</div>
                </div>
              </div>
            )}
            <button onClick={() => setSideOpen(!sideOpen)} style={{background: C.accentS, color: C.accent, border: `1px solid ${C.accent}33`, borderRadius: 6, width: 24, height: 24, fontSize: 11, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center"}}>{sideOpen ? "◀" : "▶"}</button>
          </div>

          <div style={{padding: `6px ${sideOpen ? 6 : 3}px`, flex: 1, overflowY: "auto"}}>
            {NAV.map(n => (
              <button key={n.id} className="nb" onClick={() => setView(n.id)} title={n.label}
                style={{display: "flex", alignItems: "center", gap: sideOpen ? 7 : 0, justifyContent: sideOpen ? "flex-start" : "center", width: "100%", padding: "6px 6px", borderRadius: 7, marginBottom: 1, background: view === n.id ? C.accentS : "transparent", color: view === n.id ? C.accent : C.textSub, border: view === n.id ? `1px solid ${C.accent}33` : "1px solid transparent", fontSize: 11, fontWeight: view === n.id ? 700 : 400, transition: "all .15s", textAlign: "left"}}>
                <span style={{fontSize: 14, flexShrink: 0}}>{n.icon}</span>
                {sideOpen && n.label}
                {sideOpen && view === n.id && <div style={{marginLeft: "auto", width: 4, height: 4, borderRadius: "50%", background: C.accent}}/>}
              </button>
            ))}
          </div>

          {sideOpen && (
            <div style={{padding: "8px 8px", borderTop: `1px solid ${C.border}`, flexShrink: 0}}>
              <div style={{position: "relative", marginBottom: 4}}>
                <span style={{position: "absolute", left: 7, top: "50%", transform: "translateY(-50%)", fontSize: 10, color: C.textMuted}}>🔍</span>
                <input value={filters.search} onChange={e => setFilters(f => ({...f, search: e.target.value}))} placeholder="検索..." style={{width: "100%", background: C.bgSub, color: C.text, padding: "4px 7px 4px 22px", borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 10}}/>
              </div>
              <select value={filters.tag} onChange={e => setFilters(f => ({...f, tag: e.target.value}))} style={{width: "100%", background: C.bgSub, color: C.text, padding: "4px 7px", borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 10, marginBottom: 5}}>
                <option value="">すべてのタグ</option>
                {ptags.map(p => (
                  <optgroup key={p.id} label={p.name}>
                    <option value={p.id}>{p.name}（全体）</option>
                    {tags.filter(t => t.parentId === p.id && !t.archived).map(c => <option key={c.id} value={c.id}>└ {c.name}</option>)}
                  </optgroup>
                ))}
              </select>
              <div style={{display: "flex", alignItems: "center", gap: 5, marginBottom: 7}}>
                <CB checked={filters.hideCompleted} onChange={() => setFilters(f => ({...f, hideCompleted: !f.hideCompleted}))} size={12}/>
                <span style={{fontSize: 9, color: C.textMuted}}>完了を隠す</span>
              </div>
              <button onClick={() => setShowNotifModal(true)} style={{width: "100%", background: notifSettings?.enabled ? C.accentS : "transparent", color: notifSettings?.enabled ? C.accent : C.textMuted, border: `1px solid ${notifSettings?.enabled ? C.accent : C.border}`, borderRadius: 6, padding: "4px", fontSize: 9, cursor: "pointer", marginBottom: 4, display: "flex", alignItems: "center", justifyContent: "center", gap: 4}}>
                {notifSettings?.enabled ? "🔔" : "🔕"} 通知設定
              </button>
              <button onClick={() => { signOut(auth); clearGCalToken(); }} style={{width: "100%", background: "transparent", color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px", fontSize: 9, cursor: "pointer"}}
                onMouseEnter={e => { e.currentTarget.style.background = C.dangerS; e.currentTarget.style.color = C.danger; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = C.textMuted; }}>ログアウト</button>
            </div>
          )}
          {!sideOpen && (
            <div style={{padding: "5px 3px", borderTop: `1px solid ${C.border}`, flexShrink: 0}}>
              <button onClick={() => setShowNotifModal(true)} title="通知設定" style={{background: notifSettings?.enabled ? C.accentS : "transparent", color: notifSettings?.enabled ? C.accent : C.textMuted, border: `1px solid ${notifSettings?.enabled ? C.accent : C.border}`, borderRadius: 6, padding: "4px", fontSize: 12, cursor: "pointer", width: "100%", marginBottom: 3}}>{notifSettings?.enabled ? "🔔" : "🔕"}</button>
              <button onClick={() => signOut(auth)} title="ログアウト" style={{background: "transparent", color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px", fontSize: 10, cursor: "pointer", width: "100%"}}>↩</button>
            </div>
          )}
        </div>

        {/* メイン */}
        <div style={{marginLeft: sideOpen ? 200 : 42, flex: 1, display: "flex", minHeight: "100vh", transition: "margin .2s", overflow: "hidden"}}>
          <div style={{flex: 1, padding: "13px 17px", minWidth: 0, overflowX: "auto", overflowY: "auto"}}>
            <div style={{display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 11}}>
              <div>
                <h1 style={{fontFamily: "'Playfair Display',serif", fontWeight: 700, fontSize: 17, letterSpacing: -.4, lineHeight: 1.2}}>{NAV.find(n => n.id === view)?.icon} {NAV.find(n => n.id === view)?.label}</h1>
                <div style={{fontSize: 9, color: C.textMuted, marginTop: 1}}>{new Date(today).toLocaleDateString("ja-JP", {year: "numeric", month: "long", day: "numeric", weekday: "short"})}</div>
              </div>
              {["list","day","week","gantt"].includes(view) && (
                <Btn v="accent" onClick={() => { setDefDate(null); setDefTime(null); setEditTask(null); setAddChildTo(null); setShowForm(true); }}>＋ 追加</Btn>
              )}
            </div>
            {view === "dashboard" && <DashboardView tasks={tasks} tags={tags} today={today} onToggle={handleToggle} onEdit={handleEdit} onDelete={handleDelete} onDuplicate={handleDuplicate} onSkip={handleSkip} onOverride={handleOverride} onAddSession={handleAddSession} onRemoveSession={handleRemoveSession} onMemoToggle={handleMemoToggle} onAdd={handleAdd} onUpdate={handleUpdate} dragTask={dragTask} setDragTask={setDragTask} gcalEvents={gcalEvents} gcalEnabled={gcalEnabled} setGCalEnabled={v=>{setGCalEnabled(v);try{localStorage.setItem("gcal_enabled",v?"true":"false");}catch{}}} gcalError={gcalError}/>}
            {view === "list"      && <ListView tasks={tasks} tags={tags} filters={filters} onEdit={handleEdit} onDelete={handleDelete} onToggle={handleToggle} onAddChild={pid => { setAddChildTo(pid); setShowForm(true); }} onDuplicate={handleDuplicate} onMemoToggle={handleMemoToggle} sortOrder={sortOrder} setSortOrder={setSortOrder}/>}
            {view === "day"       && <DayView tasks={tasks} tags={tags} today={today} onUpdate={handleUpdate} onAdd={handleAdd} onToggle={handleToggle} onEdit={handleEdit} onDelete={handleDelete} onDuplicate={handleDuplicate} onSkip={handleSkip} onOverride={handleOverride} onAddSession={handleAddSession} onRemoveSession={handleRemoveSession} dragTask={dragTask} setDragTask={setDragTask} gcalEvents={gcalEvents}/>}
            {view === "week"      && <WeekView tasks={tasks} tags={tags} today={today} onUpdate={handleUpdate} onAdd={handleAdd} onToggle={handleToggle} onEdit={handleEdit} onDelete={handleDelete} onDuplicate={handleDuplicate} onSkip={handleSkip} onOverride={handleOverride} onAddSession={handleAddSession} onRemoveSession={handleRemoveSession} dragTask={dragTask} setDragTask={setDragTask} gcalEvents={gcalEvents}/>}
            {view === "gantt"     && <GanttView tasks={tasks} tags={tags} today={today} onUpdate={handleUpdate} onAdd={handleAdd} onToggle={handleToggle} onEdit={handleEdit} onDelete={handleDelete} onDuplicate={handleDuplicate} onSkip={handleSkip} onOverride={handleOverride} hideCompleted={filters.hideCompleted} dragTask={dragTask} setDragTask={setDragTask}/>}
            {view === "report"    && <ReportView tasks={tasks} tags={tags}/>}
            {view === "templates" && <TemplatesView templates={templates} setTemplates={setTemplates} onUse={handleUseTemplate} tags={tags}/>}
            {view === "tagmgr"    && <TagsView tags={tags} setTags={setTags}/>}
          </div>
          {showLater && <LaterPanel tasks={tasks} tags={tags} dragTask={dragTask} setDragTask={setDragTask} onEdit={handleEdit}/>}
        </div>
      </div>

      {showForm && (
        <TaskForm
          task={editTask} tags={tags} isChild={!!addChildTo} isDuplicate={isDuplicate}
          parentTags={addChildTo ? (allFlat.find(t => t.id === addChildTo)?.tags || []) : null}
          onSave={handleSave} defDate={defDate} defTime={defTime}
          onClose={() => { setShowForm(false); setEditTask(null); setIsDuplicate(false); setAddChildTo(null); setDefDate(null); setDefTime(null); }}
        />
      )}
      {showNotifModal && <NotificationModal settings={notifSettings} onSave={setNotifSettings} onClose={() => setShowNotifModal(false)}/>}
    </>
  );
}
