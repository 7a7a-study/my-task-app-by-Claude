import { useState, useMemo, useEffect, useRef } from "react";
import { auth, provider, db } from "./firebase";
import { signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import { doc, setDoc, getDoc, onSnapshot } from "firebase/firestore";
import { registerSW, scheduleNotifications, startForegroundCheck } from "./notifications";

import { C, G, TAG_PRESETS, ALLOWED } from "./constants";
import { localDate, flatten, parseRepeat, syncTags, syncDone, isLaterTask, toggleMemo, fetchHolidays } from "./utils";
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

export default function App() {
  const [sideOpen, setSideOpen]       = useState(true);
  const [sortOrder, setSortOrder]     = useState("デフォルト");
  const today = localDate();
  const [user, setUser]               = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginLoading, setLoginLoading] = useState(false);
  const [saving, setSaving]           = useState(false);
  const [tasks, setTasksRaw]          = useState([]);
  const [tags, setTagsRaw]            = useState(TAG_PRESETS);
  const [templates, setTemplatesRaw]  = useState([]);
  const [view, setView]               = useState("list");
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
  const setNotifSettings = s => {
    setNotifSettingsRaw(s);
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
      { includeMetadataChanges: true },
      snap => {
        // ローカルキャッシュからの即時反応（自分の書き込み中）は無視
        if (snap.metadata.hasPendingWrites) return;
        if (snap.exists()) {
          const d = snap.data();
          if (d.tasks)     setTasksRaw(d.tasks);
          if (d.tags)      setTagsRaw(d.tags);
          if (d.templates) setTemplatesRaw(d.templates);
        }
      }
    );
    return unsub;
  }, [user]);

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

  // tasksとnotifSettingsをrefで追跡（stale closure防止）
  const notifRef = useRef(notifSettings);
  useEffect(() => { notifRef.current = notifSettings; }, [notifSettings]);

  // フォアグラウンド通知チェック
  useEffect(() => {
    const stop = startForegroundCheck(() => tasksLatest.current, () => notifRef.current, null);
    return stop;
  }, []);

  // 最新値をrefで追跡（stale closure防止のため save2DB 呼び出し時に参照する）
  const tasksLatest     = useRef(tasks);
  const tagsLatest      = useRef(tags);
  const templatesLatest = useRef(templates);
  useEffect(() => { tasksLatest.current = tasks; }, [tasks]);
  useEffect(() => { tagsLatest.current = tags; }, [tags]);
  useEffect(() => { templatesLatest.current = templates; }, [templates]);

  const save2DB = async (t, tg, tp) => {
    if (!user) return;
    setSaving(true);
    try {
      await setDoc(doc(db, "users", user.uid), {tasks: t, tags: tg, templates: tp, updatedAt: new Date().toISOString()});
    }
    catch(e) { console.error("保存失敗", e); }
    setSaving(false);
  };

  const setTasks     = t  => { setTasksRaw(t);  save2DB(t, tagsLatest.current, templatesLatest.current); };
  const setTags      = tg => { setTagsRaw(tg);  save2DB(tasksLatest.current, tg, templatesLatest.current); };
  const setTemplates = tp => { setTemplatesRaw(tp); save2DB(tasksLatest.current, tagsLatest.current, tp); };

  const handleLogin = async () => {
    setLoginLoading(true);
    try {
      const r = await signInWithPopup(auth, provider);
      if (!ALLOWED.includes(r.user.uid)) { await signOut(auth); alert("アクセスできません。"); }
    } catch(e) { console.error(e); }
    setLoginLoading(false);
  };

  // ツリー操作
  const updTreeLocal  = (ts, id, fn) => ts.map(t => t.id === id ? fn(t) : {...t, children: updTreeLocal(t.children || [], id, fn)});
  const delTreeLocal  = (ts, id)     => ts.filter(t => t.id !== id).map(t => ({...t, children: delTreeLocal(t.children || [], id)}));
  const addChild      = (ts, pid, c) => ts.map(t => t.id === pid ? {...t, children: [...(t.children || []), c]} : {...t, children: addChild(t.children || [], pid, c)});

  const handleSave = f => {
    const {_sessions, ...fStripped} = f;
    const fw = {...fStripped, isLater: isLaterTask(fStripped)};
    let nt;
    const isExisting = editTask && flatten(tasks).some(t => t.id === editTask.id);
    if (isExisting)      nt = updTreeLocal(tasks, f.id, () => fw);
    else if (addChildTo) nt = addChild(tasks, addChildTo, fw);
    else                 nt = [...tasks, fw];
    const synced = syncTags(nt, fw.id, fw.tags, tags);
    setTasks(syncDone(synced));
    setEditTask(null); setAddChildTo(null);
  };

  const handleUpdate = updated => {
    const clean = {...updated}; delete clean._pt; delete clean._pid;
    const synced = syncTags(updTreeLocal(tasks, clean.id, () => clean), clean.id, clean.tags, tags);
    setTasks(syncDone(synced));
    setDragTask(null);
  };

  const handleAdd    = (date, hour) => { setDefDate(date); setDefTime(hour != null ? `${String(hour).padStart(2, "0")}:00` : null); setEditTask(null); setAddChildTo(null); setShowForm(true); };

  const handleToggle = (id, forDate) => {
    const allFlat2 = flatten(tasks);
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
    const t = flatten(tasks).find(x => x.id === id);
    if (!t) return;
    const skipDates = [...(t.skipDates || [])];
    if (!skipDates.includes(date)) skipDates.push(date);
    setTasks(syncDone(updTreeLocal(tasks, id, x => ({...x, skipDates}))));
  };

  const handleOverride = (id, origDate, ov) => {
    const t = flatten(tasks).find(x => x.id === id);
    if (!t) return;
    const overrideDates = {...(t.overrideDates || {}), [origDate]: ov};
    setTasks(syncDone(updTreeLocal(tasks, id, x => ({...x, overrideDates}))));
  };

  const handleAddSession = (id, session) => {
    setTasks(updTreeLocal(tasks, id, t => ({...t, sessions: [...(t.sessions || []), session]})));
  };

  // 時間枠を1つ削除（sessionのidで特定）
  const handleRemoveSession = (taskId, sessionId) => {
    if (!sessionId) {
      // sessionIdなし＝メイン時間枠（startDate/Time）だけクリア。追加枠(sessions)は残す
      setTasks(updTreeLocal(tasks, taskId, t => ({
        ...t,
        startDate: "", startTime: "", endTime: "", duration: "",
        isLater: (t.sessions||[]).length === 0,
      })));
    } else {
      // 特定の追加枠だけ削除
      setTasks(updTreeLocal(tasks, taskId, t => ({
        ...t,
        sessions: (t.sessions || []).filter(s => s.id !== sessionId),
      })));
    }
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
    setTasksRaw(next);
    clearTimeout(window._memoSaveTimer);
    window._memoSaveTimer = setTimeout(() => save2DB(next, tags, templates), 800);
  };

  const handleEdit = t => {
    // _sessionOnly チップから来た場合、startDate/startTime/endTime が枠の値に上書きされているので元タスクを引き直す
    const original = flatten(tasks).find(x => x.id === t.id);
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

  const allFlat   = flatten(tasks);
  const nonRepeat = allFlat.filter(t => !t.repeat || parseRepeat(t.repeat).type === "なし");
  const doneCnt   = nonRepeat.filter(t => t.done).length;
  const totalCnt  = nonRepeat.length;
  const activeCnt = nonRepeat.filter(t => !t.done).length;
  const pct       = totalCnt > 0 ? Math.round((doneCnt / totalCnt) * 100) : 0;

  const NAV = [
    {id: "dashboard", label: "ダッシュボード", icon: "◈"},
    {id: "list",      label: "リスト",         icon: "☰"},
    {id: "day",       label: "日",             icon: "📆"},
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
              <button onClick={() => signOut(auth)} style={{width: "100%", background: "transparent", color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px", fontSize: 9, cursor: "pointer"}}
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
            {view === "dashboard" && <DashboardView tasks={tasks} tags={tags} today={today} onToggle={handleToggle} onEdit={handleEdit} onDelete={handleDelete} onDuplicate={handleDuplicate} onSkip={handleSkip} onOverride={handleOverride} onAddSession={handleAddSession} onRemoveSession={handleRemoveSession} onMemoToggle={handleMemoToggle}/>}
            {view === "list"      && <ListView tasks={tasks} tags={tags} filters={filters} onEdit={handleEdit} onDelete={handleDelete} onToggle={handleToggle} onAddChild={pid => { setAddChildTo(pid); setShowForm(true); }} onDuplicate={handleDuplicate} onMemoToggle={handleMemoToggle} sortOrder={sortOrder} setSortOrder={setSortOrder}/>}
            {view === "day"       && <DayView tasks={tasks} tags={tags} today={today} onUpdate={handleUpdate} onAdd={handleAdd} onToggle={handleToggle} onEdit={handleEdit} onDelete={handleDelete} onDuplicate={handleDuplicate} onSkip={handleSkip} onOverride={handleOverride} onAddSession={handleAddSession} onRemoveSession={handleRemoveSession} dragTask={dragTask} setDragTask={setDragTask}/>}
            {view === "week"      && <WeekView tasks={tasks} tags={tags} today={today} onUpdate={handleUpdate} onAdd={handleAdd} onToggle={handleToggle} onEdit={handleEdit} onDelete={handleDelete} onDuplicate={handleDuplicate} onSkip={handleSkip} onOverride={handleOverride} onAddSession={handleAddSession} onRemoveSession={handleRemoveSession} dragTask={dragTask} setDragTask={setDragTask}/>}
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
          parentTags={addChildTo ? (flatten(tasks).find(t => t.id === addChildTo)?.tags || []) : null}
          onSave={handleSave} defDate={defDate} defTime={defTime}
          onClose={() => { setShowForm(false); setEditTask(null); setIsDuplicate(false); setAddChildTo(null); setDefDate(null); setDefTime(null); }}
        />
      )}
      {showNotifModal && <NotificationModal settings={notifSettings} onSave={setNotifSettings} onClose={() => setShowNotifModal(false)}/>}
    </>
  );
}
