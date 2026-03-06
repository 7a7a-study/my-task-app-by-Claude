import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { auth, provider, db } from "./firebase";
import { signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import { doc, setDoc, onSnapshot } from "firebase/firestore";

// ── カラーテーマ（ミッドナイトスレート - 目に優しいダークモード）──
const C = {
  bg: "#161922",        // ページ背景
  bgSub: "#1c2130",     // サブ背景
  surface: "#202536",   // カード背景
  surfaceHover: "#272d40",
  border: "#303650",
  borderLight: "#404870",
  accent: "#7b72f0",    // メインアクセント（落ち着いた紫）
  accentSoft: "rgba(123,114,240,0.12)",
  accentGlow: "rgba(123,114,240,0.25)",
  success: "#3ecf8e",   // 緑
  successSoft: "rgba(62,207,142,0.12)",
  warning: "#f6a93b",   // オレンジ
  warningSoft: "rgba(246,169,59,0.12)",
  danger: "#f0647a",    // 赤
  dangerSoft: "rgba(240,100,122,0.12)",
  info: "#4db8f0",      // 水色
  infoSoft: "rgba(77,184,240,0.12)",
  text: "#dce3f0",      // メインテキスト
  textSub: "#8d97b8",   // サブテキスト
  textMuted: "#50587a", // ミュートテキスト
};

const TAG_PRESETS = [
  { id: "t1", name: "仕事", color: "#7b72f0", parentId: null },
  { id: "t2", name: "個人", color: "#3ecf8e", parentId: null },
  { id: "t3", name: "緊急", color: "#f0647a", parentId: null },
  { id: "t4", name: "学習", color: "#f6a93b", parentId: null },
  { id: "t5", name: "健康", color: "#4db8f0", parentId: null },
];
const REPEAT_OPTIONS = ["なし", "毎日", "毎週", "毎月", "平日のみ"];
const DAYS_JP = ["月", "火", "水", "木", "金", "土", "日"];
const HOURS = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`);
const ALLOWED_UIDS = ["w1HtaWxdSnMCV1miEm3yNF7g08J2", "mszdWzOojoURpcIQdYdA3FRpQiG2"];
const SORT_OPTIONS = ["デフォルト", "開始日順", "締切日順", "タগগループ順", "完了を最後に"];

// ── ユーティリティ ──────────────────────────────
const flattenTasks = (tasks, result = [], parentTitle = null, parentId = null) => {
  tasks.forEach(t => {
    result.push({ ...t, _parentTitle: parentTitle, _parentId: parentId });
    if (t.children?.length) flattenTasks(t.children, result, t.title, t.id);
  });
  return result;
};
const getDaysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
const formatDate = d => { if (!d) return ""; const dt = new Date(d); return `${dt.getMonth() + 1}/${dt.getDate()}`; };
const formatDateTime = (d, t) => { if (!d) return ""; return t ? `${formatDate(d)} ${t}` : formatDate(d); };
const isSameDay = (d1, d2) => (!d1 || !d2) ? false : d1.slice(0, 10) === d2.slice(0, 10);
const getWeekDates = base => {
  const d = new Date(base), day = d.getDay(), mon = new Date(d);
  mon.setDate(d.getDate() - day + 1);
  return Array.from({ length: 7 }, (_, i) => { const dt = new Date(mon); dt.setDate(mon.getDate() + i); return dt.toISOString().slice(0, 10); });
};
const isAutoLater = task => !task.startDate && !task.startTime;
const timeToMin = t => { if (!t) return null; const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const minToTime = m => `${String(Math.floor(Math.max(0, m) / 60) % 24).padStart(2, "0")}:${String(Math.max(0, m) % 60).padStart(2, "0")}`;
const calcDuration = (st, et) => { if (!st || !et) return null; const d = timeToMin(et) - timeToMin(st); return d > 0 ? d : null; };
const applyDuration = (st, dur) => { if (!st || !dur) return ""; return minToTime(timeToMin(st) + Number(dur)); };

// ── タグ同期（編集したタスクのタグを正とし、親子に反映）──────────
const syncTagsFromEdited = (tasks, editedId, editedTags, allTags) => {
  // 親タグも自動補完
  const completeTags = (tagIds) => tagIds.reduce((acc, tid) => {
    if (!acc.includes(tid)) acc.push(tid);
    const tag = allTags.find(t => t.id === tid);
    if (tag?.parentId && !acc.includes(tag.parentId)) acc.push(tag.parentId);
    return acc;
  }, []);

  const syncNode = (task, parentEditedTags = null) => {
    let myTags;
    if (task.id === editedId) {
      // 編集されたタスク：タグを新しいものに完全置き換え
      myTags = completeTags(editedTags);
    } else if (parentEditedTags !== null) {
      // 編集タスクの子：親のタグを引き継ぎ（既存タグは保持）
      myTags = completeTags([...new Set([...task.tags || [], ...parentEditedTags])]);
    } else {
      myTags = completeTags(task.tags || []);
    }
    const isEditedParent = task.id === editedId;
    const children = (task.children || []).map(c => syncNode(c, isEditedParent ? editedTags : null));
    // 子タグを親に統合（子が持つタグの親タグのみ）
    const childTagIds = [...new Set(children.flatMap(c => c.tags || []))];
    const merged = [...new Set([...myTags, ...childTagIds])];
    return { ...task, tags: merged, children };
  };
  return tasks.map(t => syncNode(t));
};

const parseMemo = (memo, onToggle) => {
  if (!memo) return null;
  return memo.split("\n").map((line, i) => {
    const m = line.match(/^- \[(x| )\] (.*)$/);
    if (m) {
      const checked = m[1] === "x";
      return (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <div onClick={e => { e.stopPropagation(); e.preventDefault(); onToggle && onToggle(i); }}
            style={{ width: 16, height: 16, borderRadius: 4, border: `2px solid ${checked ? C.accent : C.border}`, background: checked ? C.accent : "transparent", cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", transition: "all .15s" }}>
            {checked && <span style={{ color: "#fff", fontSize: 10, fontWeight: 700 }}>✓</span>}
          </div>
          <span style={{ fontSize: 13, color: checked ? C.textMuted : C.textSub, textDecoration: checked ? "line-through" : "none" }}>{m[2]}</span>
        </div>
      );
    }
    return <div key={i} style={{ fontSize: 13, color: C.textSub, marginBottom: 2, lineHeight: 1.5 }}>{line || <br />}</div>;
  });
};
const toggleMemoCheck = (memo, idx) => {
  const lines = memo.split("\n");
  const m = lines[idx]?.match(/^- \[(x| )\] (.*)$/);
  if (m) lines[idx] = `- [${m[1] === "x" ? " " : "x"}] ${m[2]}`;
  return lines.join("\n");
};

// ── グローバルCSS ─────────────────────────────────
const G = `
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;600;700&family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,600;0,9..40,700&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #161922; color: #dce3f0; font-family: 'Noto Sans JP', sans-serif; font-size: 14px; line-height: 1.5; -webkit-font-smoothing: antialiased; }
  ::-webkit-scrollbar { width: 5px; height: 5px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #303650; border-radius: 4px; }
  input, textarea, select { font-family: 'Noto Sans JP', sans-serif; outline: none; border: none; color: #dce3f0; }
  button { cursor: pointer; font-family: 'Noto Sans JP', sans-serif; border: none; outline: none; }
  .tr:hover .ta { opacity: 1 !important; }
  .nb:hover { background: #272d40 !important; }
  .ba:active { transform: scale(0.97); }
  .ba:hover { filter: brightness(1.1); box-shadow: 0 4px 20px rgba(123,114,240,0.4); }
  .mo { animation: fi .15s ease; }
  .mc { animation: su .22s cubic-bezier(.34,1.56,.64,1); }
  .task-chip { transition: filter .15s; }
  .task-chip:hover { filter: brightness(1.15) !important; }
  .chip-drag { cursor: grab !important; }
  .chip-drag:active { cursor: grabbing !important; }
  .rh { cursor: ns-resize; transition: background .15s; }
  .rh:hover { background: rgba(123,114,240,0.8) !important; }
  .gantt-day-hover:hover { background: rgba(123,114,240,0.08) !important; cursor: pointer; }
  @keyframes fi { from { opacity: 0; } to { opacity: 1; } }
  @keyframes su { from { transform: translateY(14px) scale(.96); opacity: 0; } to { transform: none; opacity: 1; } }
`;

// ── 基本UIコンポーネント ──────────────────────────
const Checkbox = ({ checked, onChange, size = 16, color }) => (
  <div onClick={e => { e.stopPropagation(); onChange(); }}
    style={{ width: size, height: size, borderRadius: Math.max(3, size * 0.25), border: `2px solid ${checked ? (color || C.accent) : C.border}`, background: checked ? (color || C.accent) : "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, transition: "all .15s", boxShadow: checked ? `0 0 8px ${(color || C.accent)}44` : undefined }}>
    {checked && <span style={{ color: "#fff", fontSize: size * 0.58, fontWeight: 800, lineHeight: 1 }}>✓</span>}
  </div>
);

const Btn = ({ children, onClick, variant = "ghost", style = {}, disabled, title }) => {
  const v = {
    ghost: { background: "transparent", color: C.textSub, border: `1px solid ${C.border}` },
    accent: { background: `linear-gradient(135deg, #7b72f0, #a396f8)`, color: "#fff", border: "none", boxShadow: "0 2px 12px rgba(123,114,240,0.35)" },
    danger: { background: C.dangerSoft, color: C.danger, border: `1px solid ${C.danger}44` },
    success: { background: C.successSoft, color: C.success, border: `1px solid ${C.success}44` },
    subtle: { background: C.surfaceHover, color: C.textSub, border: `1px solid ${C.border}` },
  };
  return (
    <button className={variant === "accent" ? "ba" : ""} onClick={onClick} disabled={disabled} title={title}
      style={{ padding: "7px 16px", borderRadius: 9, fontSize: 13, fontWeight: 600, transition: "all .15s", opacity: disabled ? .4 : 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, ...v[variant], ...style }}>
      {children}
    </button>
  );
};

const Modal = ({ title, children, onClose, wide }) => (
  <div className="mo" onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(10,12,20,.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16, backdropFilter: "blur(6px)" }}>
    <div className="mc" onClick={e => e.stopPropagation()} style={{ background: C.surface, borderRadius: 18, width: "100%", maxWidth: wide ? 740 : 520, border: `1px solid ${C.border}`, maxHeight: "92vh", overflow: "auto", boxShadow: "0 30px 80px rgba(0,0,0,.7)" }}>
      <div style={{ padding: "18px 24px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, background: C.surface, zIndex: 1, borderRadius: "18px 18px 0 0" }}>
        <span style={{ fontFamily: "'DM Sans',sans-serif", fontWeight: 700, fontSize: 16, color: C.text }}>{title}</span>
        <button onClick={onClose} style={{ background: C.surfaceHover, color: C.textSub, border: "none", borderRadius: 8, width: 30, height: 30, fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
      </div>
      <div style={{ padding: "22px 24px" }}>{children}</div>
    </div>
  </div>
);

const Inp = ({ label, value, onChange, type = "text", placeholder = "" }) => (
  <div style={{ marginBottom: 14 }}>
    {label && <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 5, fontWeight: 700, textTransform: "uppercase", letterSpacing: .5 }}>{label}</div>}
    <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      style={{ width: "100%", background: C.bg, color: C.text, padding: "10px 13px", borderRadius: 9, border: `1px solid ${C.border}`, fontSize: 13, transition: "border .15s" }}
      onFocus={e => e.target.style.borderColor = C.accent} onBlur={e => e.target.style.borderColor = C.border} />
  </div>
);

const Sel = ({ label, value, onChange, options }) => (
  <div style={{ marginBottom: 14 }}>
    {label && <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 5, fontWeight: 700, textTransform: "uppercase", letterSpacing: .5 }}>{label}</div>}
    <select value={value} onChange={e => onChange(e.target.value)} style={{ width: "100%", background: C.bg, color: C.text, padding: "10px 13px", borderRadius: 9, border: `1px solid ${C.border}`, fontSize: 13 }}>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  </div>
);

const TagPill = ({ tag }) => (
  <span style={{ display: "inline-flex", alignItems: "center", padding: "2px 9px", borderRadius: 12, fontSize: 11, fontWeight: 700, color: tag.color, background: tag.color + "20", border: `1px solid ${tag.color}44`, letterSpacing: .2 }}>{tag.name}</span>
);

// ── ログイン画面 ─────────────────────────────────
const LoginScreen = ({ onLogin, loading }) => (
  <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", position: "relative", overflow: "hidden" }}>
    <div style={{ position: "absolute", width: 500, height: 500, borderRadius: "50%", background: `radial-gradient(circle, ${C.accent}18 0%, transparent 70%)`, top: -150, left: -100, pointerEvents: "none" }} />
    <div style={{ position: "absolute", width: 400, height: 400, borderRadius: "50%", background: `radial-gradient(circle, ${C.success}12 0%, transparent 70%)`, bottom: -100, right: -50, pointerEvents: "none" }} />
    <div style={{ textAlign: "center", padding: 48, position: "relative", zIndex: 1 }}>
      <div style={{ width: 72, height: 72, borderRadius: 22, background: `linear-gradient(135deg, ${C.accent}, #a396f8)`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 22px", boxShadow: `0 8px 32px ${C.accentGlow}`, fontSize: 34 }}>✅</div>
      <div style={{ fontFamily: "'DM Sans',sans-serif", fontWeight: 700, fontSize: 32, marginBottom: 8, letterSpacing: -1 }}>
        <span style={{ background: `linear-gradient(135deg, ${C.accent}, ${C.info})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>マイタスク</span>
      </div>
      <div style={{ color: C.textMuted, marginBottom: 40, fontSize: 14 }}>あなただけのタスク管理アプリ</div>
      <button onClick={onLogin} disabled={loading}
        style={{ display: "flex", alignItems: "center", gap: 12, background: "#fff", color: "#333", border: "none", borderRadius: 14, padding: "14px 32px", fontSize: 15, fontWeight: 700, cursor: "pointer", margin: "0 auto", boxShadow: "0 4px 24px rgba(0,0,0,.3)", opacity: loading ? .7 : 1, transition: "all .2s" }}>
        <svg width="20" height="20" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" /><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" /><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" /><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" /></svg>
        {loading ? "ログイン中..." : "Googleでログイン"}
      </button>
    </div>
  </div>
);

// ── タスクポップアップ ────────────────────────────
const TaskPopup = ({ task, tags, onClose, onEdit, onToggle, onDelete, onMemoToggle, onDuplicate, anchor }) => {
  const tTags = tags.filter(t => task.tags?.includes(t.id) && t.parentId);
  const tagColor = tags.find(t => task.tags?.includes(t.id))?.color || C.accent;
  const today = new Date().toISOString().slice(0, 10);
  const isOverdue = task.deadlineDate && !task.done && task.deadlineDate < today;
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 500 }}>
      <div onClick={e => e.stopPropagation()} style={{ position: "fixed", top: Math.min(anchor?.y || 100, window.innerHeight - 370), left: Math.min(anchor?.x || 100, window.innerWidth - 318), background: C.surface, borderRadius: 16, padding: 20, border: `1px solid ${C.border}`, width: 308, boxShadow: `0 20px 60px rgba(0,0,0,.65)`, zIndex: 501 }}>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, borderRadius: "16px 16px 0 0", background: `linear-gradient(90deg, ${tagColor}, ${tagColor}66)` }} />
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 12, marginTop: 4 }}>
          <Checkbox checked={task.done} onChange={() => { onToggle(task.id); onClose(); }} size={20} color={tagColor} />
          <div style={{ flex: 1, minWidth: 0 }}>
            {task._parentTitle && <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 3 }}>📁 {task._parentTitle}</div>}
            <div style={{ fontSize: 15, fontWeight: 700, textDecoration: task.done ? "line-through" : "none", color: task.done ? C.textMuted : C.text, lineHeight: 1.3 }}>{task.title}</div>
            {tTags.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 7 }}>{tTags.map(t => <TagPill key={t.id} tag={t} />)}</div>}
          </div>
        </div>
        {(task.startDate || task.duration || task.deadlineDate || task.repeat !== "なし") && (
          <div style={{ background: C.bg, borderRadius: 10, padding: "10px 12px", marginBottom: 12, display: "flex", flexDirection: "column", gap: 5 }}>
            {task.startDate && <div style={{ fontSize: 12, color: C.textSub, display: "flex", gap: 6 }}><span style={{ color: C.accent }}>▶</span>{formatDateTime(task.startDate, task.startTime)}{task.endDate && <><span style={{ color: C.textMuted }}>→</span>{formatDateTime(task.endDate, task.endTime)}</>}</div>}
            {task.duration && <div style={{ fontSize: 12, color: C.accent, display: "flex", gap: 6 }}><span>⏱</span>{task.duration}分</div>}
            {task.deadlineDate && <div style={{ fontSize: 12, color: isOverdue ? C.danger : C.warning, display: "flex", gap: 6 }}><span>⚠</span>{formatDateTime(task.deadlineDate, task.deadlineTime)}</div>}
            {task.repeat !== "なし" && <div style={{ fontSize: 12, color: C.success, display: "flex", gap: 6 }}><span>↻</span>{task.repeat}</div>}
          </div>
        )}
        {task.memo && <div onClick={e => e.stopPropagation()} style={{ background: C.bg, borderRadius: 10, padding: "10px 12px", marginBottom: 12, maxHeight: 150, overflowY: "auto" }}>{parseMemo(task.memo, idx => onMemoToggle(task.id, idx))}</div>}
        <div style={{ display: "flex", gap: 7 }}>
          <Btn variant="accent" onClick={() => { onEdit(task); onClose(); }} style={{ flex: 1, padding: "8px 10px", fontSize: 12 }}>✎ 編集</Btn>
          <Btn variant="success" onClick={() => { onDuplicate(task); onClose(); }} style={{ padding: "8px 12px", fontSize: 12 }} title="複製">⧉</Btn>
          <Btn variant="danger" onClick={() => { onDelete(task.id); onClose(); }} style={{ padding: "8px 12px", fontSize: 12 }} title="削除">✕</Btn>
        </div>
      </div>
    </div>
  );
};

// ── あとでやるパネル ──────────────────────────────
const LaterPanel = ({ tasks, tags, dragTask, setDragTask }) => {
  const laterTasks = flattenTasks(tasks).filter(t => t.isLater || isAutoLater(t));
  return (
    <div style={{ width: 185, flexShrink: 0, background: C.surface, borderLeft: `1px solid ${C.border}`, padding: "14px 10px", overflowY: "auto" }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: C.warning, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 2 }}>📌 あとでやる</div>
        <div style={{ fontSize: 10, color: C.textMuted }}>ドラッグして日時を設定</div>
      </div>
      {laterTasks.length === 0 && <div style={{ fontSize: 12, color: C.textMuted, textAlign: "center", padding: "20px 0" }}>なし</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {laterTasks.map(t => {
          const c = tags.find(tg => t.tags?.includes(tg.id))?.color || C.accent;
          const isDragging = dragTask?.id === t.id;
          const childTag = tags.find(tg => t.tags?.includes(tg.id) && tg.parentId);
          return (
            <div key={t.id} draggable className="chip-drag"
              onDragStart={e => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("laterTaskId", t.id); setDragTask(t); }}
              onDragEnd={() => setDragTask(null)}
              style={{ background: isDragging ? C.accentSoft : C.bgSub, borderLeft: `3px solid ${c}`, borderRadius: "0 9px 9px 0", padding: "8px 9px", opacity: isDragging ? .4 : 1, transition: "all .15s" }}>
              {t._parentTitle && <div style={{ fontSize: 9, color: C.textMuted, marginBottom: 2 }}>📁 {t._parentTitle}</div>}
              <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 3, lineHeight: 1.3 }}>{t.title}</div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {t.duration && <span style={{ fontSize: 10, color: C.accent }}>⏱{t.duration}分</span>}
                {t.deadlineDate && <span style={{ fontSize: 10, color: C.warning }}>⚠{formatDate(t.deadlineDate)}</span>}
                {childTag && <TagPill tag={childTag} />}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ── タスクフォーム ────────────────────────────────
const TaskForm = ({ task, tags, onSave, onClose, isChild, defaultDate, defaultTime }) => {
  const empty = { id: "task_" + Date.now(), title: "", done: false, tags: [], memo: "", startDate: defaultDate || "", startTime: defaultTime || "", endDate: "", endTime: "", deadlineDate: "", deadlineTime: "", repeat: "なし", duration: "", children: [], isLater: false };
  const [f, setF] = useState(task ? { duration: "", ...task } : empty);
  const upd = (k, v) => setF(p => ({ ...p, [k]: v }));

  const tog = tid => {
    const tag = tags.find(t => t.id === tid);
    let newTags = [...f.tags];
    if (newTags.includes(tid)) {
      // タグを外す
      newTags = newTags.filter(x => x !== tid);
      if (tag?.parentId) {
        // 子タグを外す → 同じ親の他の子タグが残っていなければ親も外す
        const siblingsSelected = tags.filter(t => t.parentId === tag.parentId && t.id !== tid).some(t => newTags.includes(t.id));
        if (!siblingsSelected) newTags = newTags.filter(x => x !== tag.parentId);
      } else {
        // 親タグを外す → 子タグもすべて外す
        const childIds = tags.filter(t => t.parentId === tid).map(t => t.id);
        newTags = newTags.filter(x => !childIds.includes(x));
      }
    } else {
      // タグを付ける
      newTags = [...newTags, tid];
      if (tag?.parentId && !newTags.includes(tag.parentId)) newTags = [...newTags, tag.parentId];
    }
    upd("tags", newTags);
  };

  const handleStartTime = v => { upd("startTime", v); if (f.duration && v) upd("endTime", applyDuration(v, Number(f.duration))); else if (f.endTime && v) { const d = calcDuration(v, f.endTime); if (d) upd("duration", String(d)); } };
  const handleEndTime = v => { upd("endTime", v); if (f.startTime && v) { const d = calcDuration(f.startTime, v); if (d) upd("duration", String(d)); } };
  const handleDuration = v => { upd("duration", v); if (f.startTime && v) upd("endTime", applyDuration(f.startTime, Number(v))); };

  const parentTags = tags.filter(t => !t.parentId && !t.archived);
  const childTagsOf = pid => tags.filter(t => t.parentId === pid && !t.archived);

  return (
    <Modal title={task ? "タスクを編集" : isChild ? "子タスクを追加" : "タスクを追加"} onClose={onClose} wide>
      <Inp label="タスク名 *" value={f.title} onChange={v => upd("title", v)} placeholder="タスク名..." />
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 8, fontWeight: 700, textTransform: "uppercase", letterSpacing: .5 }}>タグ</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {parentTags.map(pt => (
            <div key={pt.id}>
              <div onClick={() => tog(pt.id)} style={{ display: "inline-flex", alignItems: "center", padding: "5px 14px", borderRadius: 20, fontSize: 13, fontWeight: 700, cursor: "pointer", border: `1.5px solid ${pt.color}55`, background: f.tags.includes(pt.id) ? pt.color + "22" : "transparent", color: f.tags.includes(pt.id) ? pt.color : C.textMuted, marginBottom: 6, transition: "all .15s" }}>{pt.name}</div>
              {childTagsOf(pt.id).length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, paddingLeft: 16 }}>
                  {childTagsOf(pt.id).map(ct => (
                    <div key={ct.id} onClick={() => tog(ct.id)} style={{ display: "inline-flex", alignItems: "center", padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer", border: `1.5px solid ${ct.color}55`, background: f.tags.includes(ct.id) ? ct.color + "22" : "transparent", color: f.tags.includes(ct.id) ? ct.color : C.textMuted, transition: "all .15s" }}>└ {ct.name}</div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div style={{ background: C.bg, borderRadius: 12, padding: 14, marginBottom: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 8 }}>
          <Inp label="📅 開始日" value={f.startDate} onChange={v => upd("startDate", v)} type="date" />
          <Inp label="開始時刻" value={f.startTime} onChange={handleStartTime} type="time" />
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: C.accent, marginBottom: 5, fontWeight: 700, textTransform: "uppercase", letterSpacing: .5 }}>⏱ 所要時間(分)</div>
            <input type="number" min="0" value={f.duration} onChange={e => handleDuration(e.target.value)} placeholder="例:60" style={{ width: "100%", background: C.surface, color: C.text, padding: "10px 13px", borderRadius: 9, border: `1px solid ${C.border}`, fontSize: 13 }} />
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 8 }}>
          <Inp label="⏹ 終了日" value={f.endDate} onChange={v => upd("endDate", v)} type="date" />
          <Inp label="終了時刻" value={f.endTime} onChange={handleEndTime} type="time" />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Inp label="⚠️ 締切日" value={f.deadlineDate} onChange={v => upd("deadlineDate", v)} type="date" />
          <Inp label="締切時刻" value={f.deadlineTime} onChange={v => upd("deadlineTime", v)} type="time" />
        </div>
      </div>
      <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 14, padding: "8px 12px", background: C.accentSoft, borderRadius: 9, border: `1px solid ${C.accent}33` }}>
        💡 開始日未設定→「あとでやる」に自動追加 / タイムラインではドラッグで所要時間変更可
      </div>
      <Sel label="繰り返し" value={f.repeat} onChange={v => upd("repeat", v)} options={REPEAT_OPTIONS} />
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 6, fontWeight: 700, textTransform: "uppercase", letterSpacing: .5 }}>
          メモ <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>（<code style={{ background: C.bg, padding: "1px 5px", borderRadius: 4, fontSize: 11 }}>- [ ] テキスト</code>）</span>
        </div>
        <textarea value={f.memo} onChange={e => upd("memo", e.target.value)} placeholder={"メモ...\n- [ ] チェック項目1\n- [ ] チェック項目2"} rows={4} style={{ width: "100%", background: C.bg, color: C.text, padding: "10px 13px", borderRadius: 9, border: `1px solid ${C.border}`, fontSize: 13, resize: "vertical", lineHeight: 1.6 }} />
      </div>
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <Btn onClick={onClose}>キャンセル</Btn>
        <Btn variant="accent" onClick={() => { if (f.title.trim()) { onSave({ ...f, isLater: isAutoLater(f) }); onClose(); } }}>保存</Btn>
      </div>
    </Modal>
  );
};

// ── タスク行（リストビュー用）────────────────────
const TaskRow = ({ task, tags, depth = 0, onEdit, onDelete, onToggle, onAddChild, onDuplicate }) => {
  const [exp, setExp] = useState(true);
  const tTags = tags.filter(t => task.tags?.includes(t.id) && t.parentId);
  const today = new Date().toISOString().slice(0, 10);
  const isOverdue = task.deadlineDate && !task.done && task.deadlineDate < today;
  const isUrgent = task.deadlineDate && !task.done && task.deadlineDate === today;
  const isLater = task.isLater || isAutoLater(task);
  const tagColor = tags.find(t => task.tags?.includes(t.id))?.color || C.accent;
  return (
    <div style={{ marginLeft: depth * 24 }}>
      <div className="tr" style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 14px", borderRadius: 11, marginBottom: 4, background: depth === 0 ? C.surface : C.bgSub, border: `1px solid ${isOverdue ? C.danger + "55" : depth === 0 ? C.border : "transparent"}`, borderLeft: depth > 0 ? `3px solid ${tagColor}55` : undefined, opacity: task.done ? .5 : 1, transition: "all .15s" }}>
        <div style={{ paddingTop: 1, flexShrink: 0 }}><Checkbox checked={task.done} onChange={() => onToggle(task.id)} color={tagColor} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", marginBottom: 3 }}>
            {task.children?.length > 0 && <span onClick={() => setExp(!exp)} style={{ cursor: "pointer", fontSize: 10, color: C.textMuted, transform: exp ? "rotate(90deg)" : "", transition: "transform .15s", display: "inline-block" }}>▶</span>}
            <span style={{ fontSize: 14, fontWeight: depth === 0 ? 600 : 500, textDecoration: task.done ? "line-through" : "none", color: task.done ? C.textMuted : C.text }}>{task.title}</span>
            {task.repeat !== "なし" && <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 10, background: C.successSoft, color: C.success, fontWeight: 600 }}>↻ {task.repeat}</span>}
            {isLater && <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 10, background: C.warningSoft, color: C.warning, fontWeight: 600 }}>📌</span>}
            {isOverdue && <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 10, background: C.dangerSoft, color: C.danger, fontWeight: 600 }}>⚠ 超過</span>}
            {isUrgent && <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 10, background: C.warningSoft, color: C.warning, fontWeight: 600 }}>🔥 今日</span>}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {tTags.map(t => <TagPill key={t.id} tag={t} />)}
            {task.startDate && <span style={{ fontSize: 11, color: C.textMuted }}>▶ {formatDateTime(task.startDate, task.startTime)}</span>}
            {task.duration && <span style={{ fontSize: 11, color: C.accent }}>⏱{task.duration}分</span>}
            {task.deadlineDate && <span style={{ fontSize: 11, color: isOverdue ? C.danger : C.warning }}>⚠{formatDateTime(task.deadlineDate, task.deadlineTime)}</span>}
            {task.memo && <span style={{ fontSize: 11, color: C.textMuted, fontStyle: "italic" }}>{task.memo.replace(/- \[[ x]\] /g, "").slice(0, 26)}…</span>}
          </div>
        </div>
        <div className="ta" style={{ display: "flex", gap: 4, opacity: 0, transition: "opacity .15s", flexShrink: 0 }}>
          <button title="子タスク追加" onClick={() => onAddChild(task.id)} style={{ background: C.accentSoft, color: C.accent, border: "none", borderRadius: 7, width: 28, height: 28, fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center" }}>+</button>
          <button title="複製" onClick={() => onDuplicate(task)} style={{ background: C.successSoft, color: C.success, border: "none", borderRadius: 7, width: 28, height: 28, fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>⧉</button>
          <button title="編集" onClick={() => onEdit(task)} style={{ background: C.surfaceHover, color: C.textSub, border: "none", borderRadius: 7, width: 28, height: 28, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>✎</button>
          <button title="削除" onClick={() => onDelete(task.id)} style={{ background: C.dangerSoft, color: C.danger, border: "none", borderRadius: 7, width: 28, height: 28, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
        </div>
      </div>
      {exp && task.children?.map(c => <TaskRow key={c.id} task={c} tags={tags} depth={depth + 1} onEdit={onEdit} onDelete={onDelete} onToggle={onToggle} onAddChild={onAddChild} onDuplicate={onDuplicate} />)}
    </div>
  );
};

// ── リストビュー ─────────────────────────────────
const ListView = ({ tasks, tags, filters, onEdit, onDelete, onToggle, onAddChild, onDuplicate, sortOrder, setSortOrder }) => {
  const filtered = useMemo(() => {
    let list = tasks;
    if (filters.tag) list = list.filter(t => t.tags?.includes(filters.tag));
    if (filters.search) list = list.filter(t => t.title.toLowerCase().includes(filters.search.toLowerCase()));
    if (filters.hideCompleted) list = list.filter(t => !t.done);
    if (sortOrder === "開始日順") list = [...list].sort((a, b) => (a.startDate || "9") > (b.startDate || "9") ? 1 : -1);
    else if (sortOrder === "締切日順") list = [...list].sort((a, b) => (a.deadlineDate || "9") > (b.deadlineDate || "9") ? 1 : -1);
    else if (sortOrder === "タググループ順") list = [...list].sort((a, b) => (a.tags?.[0] || "") > (b.tags?.[0] || "") ? 1 : -1);
    else if (sortOrder === "完了を最後に") list = [...list].sort((a, b) => a.done === b.done ? 0 : a.done ? 1 : -1);
    return list;
  }, [tasks, filters, sortOrder]);
  const later = filtered.filter(t => t.isLater || isAutoLater(t));
  const habits = filtered.filter(t => !(t.isLater || isAutoLater(t)) && t.repeat !== "なし");
  const regular = filtered.filter(t => !(t.isLater || isAutoLater(t)) && t.repeat === "なし");
  const Sec = ({ title, items, color, icon }) => items.length === 0 ? null : (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span>{icon}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: 1 }}>{title}</span>
        <span style={{ fontSize: 11, color: C.textMuted, background: C.surfaceHover, padding: "1px 8px", borderRadius: 10 }}>{items.length}</span>
      </div>
      {items.map(t => <TaskRow key={t.id} task={t} tags={tags} onEdit={onEdit} onDelete={onDelete} onToggle={onToggle} onAddChild={onAddChild} onDuplicate={onDuplicate} />)}
    </div>
  );
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 18, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, color: C.textMuted, fontWeight: 600 }}>並び替え</span>
        {SORT_OPTIONS.map(s => (
          <button key={s} onClick={() => setSortOrder(s)} style={{ fontSize: 11, padding: "4px 11px", borderRadius: 20, border: `1px solid ${sortOrder === s ? C.accent : C.border}`, background: sortOrder === s ? C.accentSoft : "transparent", color: sortOrder === s ? C.accent : C.textMuted, cursor: "pointer", fontWeight: sortOrder === s ? 700 : 400, transition: "all .15s" }}>{s}</button>
        ))}
      </div>
      <Sec title="習慣・繰り返し" items={habits} color={C.success} icon="🔄" />
      <Sec title="タスク" items={regular} color={C.accent} icon="📋" />
      <Sec title="あとでやる" items={later} color={C.warning} icon="📌" />
      {filtered.length === 0 && <div style={{ textAlign: "center", padding: "60px 0", color: C.textMuted }}><div style={{ fontSize: 52, marginBottom: 14 }}>🎉</div><div>タスクがありません</div></div>}
    </div>
  );
};

// ── タスクチップ（リサイズハンドル付き）──────────
const TaskChip = ({ task, tags, color, onPopup, onToggle, onUpdateTask, compact, hourHeight = 52 }) => {
  const isOverdue = task.deadlineDate && !task.done && task.deadlineDate < new Date().toISOString().slice(0, 10);
  const resizing = useRef(false);
  const startY = useRef(0);
  const startDur = useRef(0);

  const onResizeStart = useCallback((e) => {
    e.stopPropagation();
    e.preventDefault();
    resizing.current = true;
    startY.current = e.clientY || e.touches?.[0]?.clientY || 0;
    startDur.current = Number(task.duration) || 60;
    const onMove = ev => {
      if (!resizing.current) return;
      const y = ev.clientY || ev.touches?.[0]?.clientY || 0;
      const dy = y - startY.current;
      const minPerPx = 60 / hourHeight;
      const newDur = Math.max(15, Math.round((startDur.current + dy * minPerPx) / 15) * 15);
      onUpdateTask({ ...task, duration: String(newDur), endTime: task.startTime ? applyDuration(task.startTime, newDur) : "" });
    };
    const onUp = () => {
      resizing.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onUp);
  }, [task, onUpdateTask, hourHeight]);

  const durMin = Number(task.duration) || 0;
  const chipH = durMin > 0 && !compact ? Math.max(30, durMin / 60 * hourHeight) : undefined;

  return (
    <div className="task-chip chip-drag" draggable
      onDragStart={e => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("taskId", task.id); e.stopPropagation(); }}
      onClick={e => { e.stopPropagation(); onPopup(e, task); }}
      style={{ background: task.done ? C.border + "44" : color + "25", borderLeft: `3px solid ${task.done ? C.textMuted : color}`, borderRadius: "0 7px 7px 0", padding: compact ? "2px 6px" : "5px 9px", marginBottom: 2, opacity: task.done ? .6 : 1, userSelect: "none", position: "relative", height: chipH, overflow: "hidden", display: "flex", flexDirection: "column", justifyContent: "space-between", boxShadow: chipH ? `0 2px 6px ${color}18` : undefined }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <div onClick={e => { e.stopPropagation(); onToggle(task.id); }} style={{ width: 10, height: 10, borderRadius: 3, border: `2px solid ${task.done ? C.textMuted : color}`, background: task.done ? color : "transparent", flexShrink: 0, cursor: "pointer" }} />
          <span style={{ fontSize: compact ? 10 : 12, fontWeight: 600, color: task.done ? C.textMuted : color, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", textDecoration: task.done ? "line-through" : "none" }}>{task.startTime && !compact ? `${task.startTime} ` : ""}{task.title}</span>
          {isOverdue && !compact && <span style={{ fontSize: 9, color: C.danger }}>⚠</span>}
        </div>
        {task._parentTitle && !compact && <div style={{ fontSize: 9, color: C.textMuted, paddingLeft: 15 }}>📁{task._parentTitle}</div>}
        {task.duration && !compact && <div style={{ fontSize: 9, color: color, paddingLeft: 15, opacity: .8 }}>⏱{task.duration}分</div>}
      </div>
      {/* リサイズハンドル：所要時間が設定されているときに表示 */}
      {chipH && !compact && (
        <div className="rh" onMouseDown={onResizeStart} onTouchStart={onResizeStart} onClick={e => e.stopPropagation()}
          style={{ height: 8, width: "100%", background: color + "55", display: "flex", alignItems: "center", justifyContent: "center", marginTop: "auto", flexShrink: 0 }}>
          <div style={{ width: 24, height: 2, borderRadius: 1, background: "rgba(255,255,255,0.6)" }} />
        </div>
      )}
    </div>
  );
};

// ── 日ビュー ─────────────────────────────────────
const DayView = ({ tasks, tags, today, onUpdateTask, onAddTask, onToggle, onEdit, onDelete, onDuplicate, dragTask, setDragTask }) => {
  const HOUR_H = 58;
  const [dropHour, setDropHour] = useState(null);
  const [popup, setPopup] = useState(null);
  const allFlat = flattenTasks(tasks);
  const todayTasks = allFlat.filter(t => {
    if (t.repeat === "毎日") return true;
    if (t.repeat === "平日のみ") { const d = new Date(today).getDay(); return d >= 1 && d <= 5; }
    return isSameDay(t.startDate, today) || isSameDay(t.deadlineDate, today);
  });
  const timed = todayTasks.filter(t => t.startTime && !(t.isLater || isAutoLater(t)));
  const untimed = todayTasks.filter(t => !t.startTime && !(t.isLater || isAutoLater(t)));
  const handlePopup = (e, task) => { const r = e.currentTarget.getBoundingClientRect(); setPopup({ task, x: Math.min(r.right + 8, window.innerWidth - 320), y: Math.min(r.top, window.innerHeight - 380) }); };
  const handleDrop = (e, h) => {
    e.preventDefault(); setDropHour(null);
    const tid = e.dataTransfer.getData("taskId") || e.dataTransfer.getData("laterTaskId");
    const t = tid ? allFlat.find(x => x.id === tid) || dragTask : dragTask;
    if (!t) return;
    const st = `${String(h).padStart(2, "0")}:00`;
    onUpdateTask({ ...t, startDate: today, startTime: st, endTime: t.duration ? applyDuration(st, Number(t.duration)) : t.endTime || "", isLater: false });
    setDragTask(null);
  };
  const handleMemoToggle = (id, idx) => {
    const t = allFlat.find(x => x.id === id);
    if (t) onUpdateTask({ ...t, memo: toggleMemoCheck(t.memo, idx) });
    setPopup(p => p ? { ...p, task: { ...p.task, memo: toggleMemoCheck(p.task.memo, idx) } } : null);
  };
  const now = new Date(); const isToday = today === now.toISOString().slice(0, 10);
  return (
    <div style={{ position: "relative" }}>
      {HOURS.slice(6, 23).map((hour, i) => {
        const h = 6 + i; const isDrop = dropHour === h;
        const ht = timed.filter(t => t.startTime?.slice(0, 2) === String(h).padStart(2, "0"));
        return (
          <div key={hour} onDragOver={e => { e.preventDefault(); setDropHour(h); }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDropHour(null); }} onDrop={e => handleDrop(e, h)}
            style={{ display: "grid", gridTemplateColumns: "52px 1fr", minHeight: HOUR_H, borderTop: `1px solid ${C.border}22`, background: isDrop ? C.accentSoft : "transparent", transition: "background .15s", position: "relative" }}>
            {isToday && now.getHours() === h && <div style={{ position: "absolute", left: 52, right: 0, top: `${(now.getMinutes() / 60) * 100}%`, height: 2, background: C.danger, zIndex: 3, borderRadius: 1, pointerEvents: "none" }}><div style={{ width: 8, height: 8, borderRadius: "50%", background: C.danger, position: "absolute", left: -4, top: -3 }} /></div>}
            <div style={{ fontSize: 11, color: isDrop ? C.accent : C.textMuted, paddingTop: 4, paddingRight: 8, textAlign: "right", fontWeight: isDrop ? 700 : 400, fontFamily: "'DM Sans',sans-serif" }}>{hour}</div>
            <div style={{ padding: "3px 0 3px 8px", position: "relative" }}>
              {isDrop
                ? <div style={{ position: "absolute", inset: "3px 8px", border: `2px dashed ${C.accent}`, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: C.accent, pointerEvents: "none", background: C.accentSoft }}>{(dragTask || { title: "タスク" }).title} → {hour}</div>
                : ht.length > 0 ? ht.map(t => { const c = tags.find(tg => t.tags?.includes(tg.id))?.color || C.accent; return <TaskChip key={t.id} task={t} tags={tags} color={c} onPopup={handlePopup} onToggle={onToggle} onUpdateTask={onUpdateTask} hourHeight={HOUR_H} />; })
                  : <div onClick={() => onAddTask(today, h)} style={{ height: HOUR_H - 6, cursor: "pointer", borderRadius: 7, display: "flex", alignItems: "center", paddingLeft: 8, fontSize: 11, color: "transparent", transition: "all .15s" }} onMouseEnter={e => { e.currentTarget.style.background = C.accentSoft; e.currentTarget.style.color = C.accent; }} onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "transparent"; }}>+ 追加</div>}
            </div>
          </div>
        );
      })}
      {untimed.length > 0 && <div style={{ marginTop: 14, padding: "12px 14px", background: C.surface, borderRadius: 12, border: `1px solid ${C.border}` }}><div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, marginBottom: 8, textTransform: "uppercase", letterSpacing: .5 }}>時間未定</div>{untimed.map(t => { const c = tags.find(tg => t.tags?.includes(tg.id))?.color || C.accent; return <TaskChip key={t.id} task={t} tags={tags} color={c} onPopup={handlePopup} onToggle={onToggle} onUpdateTask={onUpdateTask} hourHeight={HOUR_H} />; })}</div>}
      {popup && <TaskPopup task={popup.task} tags={tags} anchor={popup} onClose={() => setPopup(null)} onEdit={onEdit} onToggle={id => { onToggle(id); setPopup(null); }} onDelete={onDelete} onDuplicate={onDuplicate} onMemoToggle={handleMemoToggle} />}
    </div>
  );
};

// ── 週ビュー ─────────────────────────────────────
const WeekView = ({ tasks, tags, today, onUpdateTask, onAddTask, onToggle, onEdit, onDelete, onDuplicate, dragTask, setDragTask }) => {
  const HOUR_H = 52;
  const weekDates = getWeekDates(today);
  const [dropCell, setDropCell] = useState(null);
  const [popup, setPopup] = useState(null);
  const allFlat = flattenTasks(tasks);
  const getDay = date => allFlat.filter(t => {
    if (t.repeat === "毎日") return true;
    if (t.repeat === "平日のみ") { const d = new Date(date).getDay(); return d >= 1 && d <= 5; }
    if (t.repeat === "毎週" && t.startDate) return new Date(t.startDate).getDay() === new Date(date).getDay();
    return isSameDay(t.startDate, date) || isSameDay(t.deadlineDate, date);
  }).filter(t => !(t.isLater || isAutoLater(t)));
  const handlePopup = (e, task) => { const r = e.currentTarget.getBoundingClientRect(); setPopup({ task, x: Math.min(r.right + 8, window.innerWidth - 320), y: Math.min(r.top, window.innerHeight - 380) }); };
  const handleDrop = (e, d, h) => {
    e.preventDefault(); setDropCell(null);
    const tid = e.dataTransfer.getData("taskId") || e.dataTransfer.getData("laterTaskId");
    const t = tid ? allFlat.find(x => x.id === tid) || dragTask : dragTask;
    if (!t) return;
    const st = `${String(h).padStart(2, "0")}:00`;
    onUpdateTask({ ...t, startDate: d, startTime: st, endTime: t.duration ? applyDuration(st, Number(t.duration)) : t.endTime || "", isLater: false });
    setDragTask(null);
  };
  const handleMemoToggle = (id, idx) => {
    const t = allFlat.find(x => x.id === id);
    if (t) onUpdateTask({ ...t, memo: toggleMemoCheck(t.memo, idx) });
    setPopup(p => p ? { ...p, task: { ...p.task, memo: toggleMemoCheck(p.task.memo, idx) } } : null);
  };
  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ display: "grid", gridTemplateColumns: "48px repeat(7,1fr)", minWidth: 620 }}>
        <div />
        {weekDates.map((d, i) => {
          const isT = d === today, dt = new Date(d), isSat = dt.getDay() === 6, isSun = dt.getDay() === 0;
          return (<div key={d} style={{ padding: "7px 3px", textAlign: "center", borderBottom: `2px solid ${isT ? C.accent : C.border}`, color: isT ? C.accent : isSat ? C.info : isSun ? C.danger : C.textSub }}>
            <div style={{ fontSize: 10, fontWeight: 700 }}>{DAYS_JP[i]}</div>
            <div style={{ fontSize: 17, fontWeight: isT ? 700 : 400, fontFamily: "'DM Sans',sans-serif" }}>{dt.getDate()}</div>
          </div>);
        })}
        {HOURS.slice(6, 23).map((hour, i) => {
          const h = 6 + i;
          return [
            <div key={hour + "l"} style={{ fontSize: 10, color: C.textMuted, paddingRight: 5, textAlign: "right", paddingTop: 3, borderTop: `1px solid ${C.border}22`, height: HOUR_H, display: "flex", alignItems: "flex-start", justifyContent: "flex-end", fontFamily: "'DM Sans',sans-serif" }}>{hour}</div>,
            ...weekDates.map(d => {
              const dts = getDay(d).filter(t => t.startTime?.slice(0, 2) === String(h).padStart(2, "0"));
              const key = `${d}_${h}`; const isDrop = dropCell === key;
              return (
                <div key={d + hour} onDragOver={e => { e.preventDefault(); setDropCell(key); }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDropCell(null); }} onDrop={e => handleDrop(e, d, h)}
                  style={{ borderTop: `1px solid ${C.border}22`, height: HOUR_H, padding: "1px 2px", background: isDrop ? C.accentSoft : "transparent", transition: "background .15s", cursor: "pointer" }} onClick={() => { if (!dragTask) onAddTask(d, h); }}>
                  {isDrop ? <div style={{ height: "100%", border: `2px dashed ${C.accent}`, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: C.accent }}>{hour}</div>
                    : dts.map(t => { const c = tags.find(tg => t.tags?.includes(tg.id))?.color || C.accent; return <TaskChip key={t.id} task={t} tags={tags} color={c} onPopup={handlePopup} onToggle={onToggle} onUpdateTask={onUpdateTask} compact hourHeight={HOUR_H} />; })}
                </div>
              );
            })
          ];
        })}
      </div>
      {popup && <TaskPopup task={popup.task} tags={tags} anchor={popup} onClose={() => setPopup(null)} onEdit={onEdit} onToggle={id => { onToggle(id); setPopup(null); }} onDelete={onDelete} onDuplicate={onDuplicate} onMemoToggle={handleMemoToggle} />}
    </div>
  );
};

// ── ガントチャート（タグ別グループ・完了チェック・ドラッグ移動・バーリサイズ）────
const MonthView = ({ tasks, tags, today, onUpdateTask, onAddTask, onToggle, onEdit, onDelete, onDuplicate, dragTask, setDragTask }) => {
  const [vy, setVy] = useState(new Date(today).getFullYear());
  const [vm, setVm] = useState(new Date(today).getMonth());
  const [dropDay, setDropDay] = useState(null);
  const [popup, setPopup] = useState(null);
  const [draggingBar, setDraggingBar] = useState(null); // {task, startDay}
  const [dropBarDay, setDropBarDay] = useState(null);
  const dim = getDaysInMonth(vy, vm);
  const DAY_W = 32;
  const ROW_H = 32;
  const allFlat = flattenTasks(tasks);

  // 表示タスク
  const visibleTasks = allFlat.filter(t => (t.startDate || t.deadlineDate) && !(t.isLater || isAutoLater(t)));

  // タグ別グループ化（親タスク優先）
  const groups = useMemo(() => {
    const tagGroups = {};
    visibleTasks.forEach(t => {
      const parentTagId = t.tags?.find(id => tags.find(tg => tg.id === id && !tg.parentId)) || "__none__";
      if (!tagGroups[parentTagId]) tagGroups[parentTagId] = [];
      tagGroups[parentTagId].push(t);
    });
    return tagGroups;
  }, [JSON.stringify(visibleTasks.map(t => t.id)), tags]);

  const getBar = task => {
    const s = task.startDate ? new Date(task.startDate) : task.deadlineDate ? new Date(task.deadlineDate) : null;
    const e = task.deadlineDate ? new Date(task.deadlineDate) : s;
    if (!s) return null;
    const ms = new Date(vy, vm, 1), me = new Date(vy, vm, dim);
    if (e < ms || s > me) return null;
    const cs = s < ms ? ms : s, ce = e > me ? me : e;
    return { startDay: cs.getDate(), width: ce.getDate() - cs.getDate() + 1 };
  };

  const dateStr = d => `${vy}-${String(vm + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const MN = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
  const todayDay = today.startsWith(`${vy}-${String(vm + 1).padStart(2, "0")}`) ? parseInt(today.slice(8)) : null;

  const handlePopup = (e, task) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setPopup({ task, x: Math.min(r.right + 8, window.innerWidth - 320), y: Math.min(r.top, window.innerHeight - 380) });
  };
  const handleMemoToggle = (id, idx) => {
    const t = allFlat.find(x => x.id === id);
    if (t) onUpdateTask({ ...t, memo: toggleMemoCheck(t.memo, idx) });
    setPopup(p => p ? { ...p, task: { ...p.task, memo: toggleMemoCheck(p.task.memo, idx) } } : null);
  };

  // ドロップハンドラー（バードラッグ移動 or 外部タスク）
  const handleDrop = (e, d) => {
    e.preventDefault(); e.stopPropagation();
    setDropDay(null); setDropBarDay(null);
    if (draggingBar) {
      const diff = d - draggingBar.startDay;
      const t = draggingBar.task;
      const shiftDate = ds => { if (!ds) return ds; const dt = new Date(ds); dt.setDate(dt.getDate() + diff); return dt.toISOString().slice(0, 10); };
      onUpdateTask({ ...t, startDate: shiftDate(t.startDate), deadlineDate: shiftDate(t.deadlineDate), isLater: false });
      setDraggingBar(null);
    } else {
      const tid = e.dataTransfer.getData("taskId") || e.dataTransfer.getData("laterTaskId");
      const t = tid ? allFlat.find(x => x.id === tid) || dragTask : dragTask;
      if (t) { onUpdateTask({ ...t, startDate: dateStr(d), isLater: false }); setDragTask(null); }
    }
  };

  // バーリサイズ（右端ドラッグで幅変更→deadlineDate変更）
  const barResizing = useRef(false);
  const barResizeTask = useRef(null);
  const barResizeStartX = useRef(0);
  const barResizeStartWidth = useRef(0);
  const onBarResizeStart = useCallback((e, task, barWidth) => {
    e.stopPropagation(); e.preventDefault();
    barResizing.current = true;
    barResizeTask.current = task;
    barResizeStartX.current = e.clientX || e.touches?.[0]?.clientX || 0;
    barResizeStartWidth.current = barWidth;
    const onMove = ev => {
      if (!barResizing.current) return;
      const x = ev.clientX || ev.touches?.[0]?.clientX || 0;
      const dx = x - barResizeStartX.current;
      const daysDiff = Math.round(dx / DAY_W);
      const newWidth = Math.max(1, barResizeStartWidth.current + daysDiff);
      const t = barResizeTask.current;
      const startD = t.startDate || t.deadlineDate;
      if (!startD) return;
      const newEnd = new Date(startD);
      newEnd.setDate(newEnd.getDate() + newWidth - 1);
      onUpdateTask({ ...t, deadlineDate: newEnd.toISOString().slice(0, 10) });
    };
    const onUp = () => {
      barResizing.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onUp);
  }, [onUpdateTask]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <Btn onClick={() => { if (vm === 0) { setVy(y => y - 1); setVm(11); } else setVm(m => m - 1); }}>‹</Btn>
        <span style={{ fontFamily: "'DM Sans',sans-serif", fontWeight: 700, fontSize: 16 }}>{vy}年 {MN[vm]}</span>
        <Btn onClick={() => { if (vm === 11) { setVy(y => y + 1); setVm(0); } else setVm(m => m + 1); }}>›</Btn>
        <span style={{ fontSize: 11, color: C.textMuted, marginLeft: 6 }}>バーをドラッグで日程移動 / 右端ドラッグで期間変更</span>
      </div>

      <div style={{ overflowX: "auto", borderRadius: 14, border: `1px solid ${C.border}`, background: C.surface }}>
        <div style={{ minWidth: dim * DAY_W + 230 }}>

          {/* ── 日付ヘッダー ── */}
          <div style={{ display: "flex", borderBottom: `2px solid ${C.border}`, background: C.bgSub, position: "sticky", top: 0, zIndex: 10 }}>
            <div style={{ width: 230, flexShrink: 0, padding: "10px 16px", fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: .5, borderRight: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 20 }} />タスク名
            </div>
            <div style={{ display: "flex" }}>
              {Array.from({ length: dim }, (_, i) => {
                const d = i + 1;
                const dt = new Date(vy, vm, d);
                const isSat = dt.getDay() === 6, isSun = dt.getDay() === 0, isT = d === todayDay;
                return (
                  <div key={d} className="gantt-day-hover"
                    onDragOver={e => { e.preventDefault(); draggingBar ? setDropBarDay(d) : setDropDay(d); }}
                    onDragLeave={() => { setDropDay(null); setDropBarDay(null); }}
                    onDrop={e => handleDrop(e, d)}
                    onClick={() => { if (!dragTask && !draggingBar) onAddTask(dateStr(d), null); }}
                    style={{ width: DAY_W, flexShrink: 0, textAlign: "center", fontSize: 10, fontWeight: isT ? 800 : 400, fontFamily: "'DM Sans',sans-serif", color: isT ? C.accent : isSat ? C.info : isSun ? C.danger : C.textMuted, background: isT ? C.accentSoft : isSat || isSun ? "rgba(255,255,255,0.02)" : "transparent", borderLeft: `1px solid ${C.border}22`, padding: "9px 0", position: "relative" }}>
                    {d}
                    {isT && <div style={{ position: "absolute", bottom: 0, left: "50%", transform: "translateX(-50%)", width: 4, height: 4, borderRadius: "50%", background: C.accent }} />}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── タグ別グループ ── */}
          {Object.entries(groups).map(([tagId, groupTasks]) => {
            const tag = tags.find(t => t.id === tagId);
            const groupColor = tag?.color || C.textMuted;
            return (
              <div key={tagId}>
                {/* グループヘッダー */}
                {tagId !== "__none__" && (
                  <div style={{ display: "flex", background: `${groupColor}0e`, borderTop: `2px solid ${groupColor}44`, borderBottom: `1px solid ${groupColor}33` }}>
                    <div style={{ width: 230, flexShrink: 0, padding: "7px 16px", display: "flex", alignItems: "center", gap: 8, borderRight: `1px solid ${C.border}` }}>
                      <div style={{ width: 12, height: 12, borderRadius: "50%", background: groupColor, boxShadow: `0 0 10px ${groupColor}88`, flexShrink: 0 }} />
                      <span style={{ fontSize: 13, fontWeight: 700, color: groupColor }}>{tag?.name}</span>
                      <span style={{ fontSize: 10, color: C.textMuted, background: C.surface + "aa", padding: "1px 7px", borderRadius: 8, marginLeft: "auto" }}>{groupTasks.length}</span>
                    </div>
                    <div style={{ flex: 1, position: "relative" }}>
                      {todayDay && <div style={{ position: "absolute", left: (todayDay - 1) * DAY_W + DAY_W / 2, top: 0, bottom: 0, width: 1, background: `${C.danger}33`, pointerEvents: "none" }} />}
                    </div>
                  </div>
                )}

                {/* タスク行 */}
                {groupTasks.map((task, rowIdx) => {
                  const bar = getBar(task);
                  const c = tags.find(t => task.tags?.includes(t.id))?.color || C.accent;
                  const isBeingDragged = draggingBar?.task?.id === task.id;
                  const isParent = !task._parentId;
                  const tTags = tags.filter(t => task.tags?.includes(t.id) && t.parentId);

                  return (
                    <div key={task.id}
                      style={{ display: "flex", borderBottom: `1px solid ${C.border}22`, height: ROW_H, background: rowIdx % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)", transition: "background .1s" }}
                      onMouseEnter={e => e.currentTarget.style.background = C.surfaceHover + "88"}
                      onMouseLeave={e => e.currentTarget.style.background = rowIdx % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)"}>

                      {/* 左カラム */}
                      <div style={{ width: 230, flexShrink: 0, display: "flex", alignItems: "center", gap: 7, padding: "0 10px 0 16px", borderRight: `1px solid ${C.border}`, overflow: "hidden" }}>
                        {task._parentId && <span style={{ color: C.textMuted, fontSize: 11, flexShrink: 0, marginLeft: 10 }}>└</span>}
                        <Checkbox checked={task.done} onChange={() => onToggle(task.id)} size={14} color={c} />
                        <span style={{ fontSize: 12, fontWeight: isParent ? 600 : 400, color: task.done ? C.textMuted : C.text, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", textDecoration: task.done ? "line-through" : "none", flex: 1 }}>{task.title}</span>
                        <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
                          {tTags.slice(0, 1).map(t => <div key={t.id} style={{ width: 6, height: 6, borderRadius: "50%", background: t.color, flexShrink: 0 }} title={t.name} />)}
                          {task.deadlineDate && <span style={{ fontSize: 9, color: C.warning }}>⚠</span>}
                        </div>
                      </div>

                      {/* バー列 */}
                      <div style={{ flex: 1, position: "relative", overflow: "visible" }}
                        onDragOver={e => { e.preventDefault(); draggingBar ? setDropBarDay(Math.ceil((e.nativeEvent.offsetX) / DAY_W)) : setDropDay(Math.ceil((e.nativeEvent.offsetX) / DAY_W)); }}
                        onDrop={e => { const d = Math.ceil((e.nativeEvent.offsetX) / DAY_W); handleDrop(e, Math.max(1, Math.min(dim, d))); }}>

                        {/* Today縦線 */}
                        {todayDay && <div style={{ position: "absolute", left: (todayDay - 1) * DAY_W + DAY_W / 2, top: 0, bottom: 0, width: 1, background: `${C.danger}33`, pointerEvents: "none", zIndex: 1 }} />}

                        {bar && (
                          <div
                            draggable
                            onDragStart={e => { e.stopPropagation(); e.dataTransfer.effectAllowed = "move"; setDraggingBar({ task, startDay: bar.startDay }); }}
                            onDragEnd={() => { setDraggingBar(null); setDropBarDay(null); }}
                            onClick={e => handlePopup(e, task)}
                            style={{ position: "absolute", left: (bar.startDay - 1) * DAY_W + 2, width: Math.max(bar.width * DAY_W - 4, DAY_W / 2), height: isParent ? 22 : 16, top: (ROW_H - (isParent ? 22 : 16)) / 2, background: isBeingDragged ? `${c}44` : task.done ? C.border + "55" : `linear-gradient(90deg, ${c}66, ${c}44)`, border: `1px solid ${c}88`, borderRadius: 6, display: "flex", alignItems: "center", paddingLeft: 7, fontSize: 10, color: task.done ? C.textMuted : c, fontWeight: 600, overflow: "hidden", whiteSpace: "nowrap", cursor: "grab", textDecoration: task.done ? "line-through" : "none", zIndex: 3, transition: "opacity .15s", boxShadow: `0 1px 4px ${c}33` }}>
                            {bar.width > 2 ? task.title.slice(0, 18) : ""}
                            {/* 右端リサイズハンドル */}
                            <div
                              onMouseDown={e => onBarResizeStart(e, task, bar.width)}
                              onTouchStart={e => onBarResizeStart(e, task, bar.width)}
                              onClick={e => e.stopPropagation()}
                              style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 8, cursor: "ew-resize", background: `${c}55`, borderRadius: "0 5px 5px 0", display: "flex", alignItems: "center", justifyContent: "center" }}>
                              <div style={{ width: 1.5, height: 8, background: "rgba(255,255,255,0.6)", borderRadius: 1 }} />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}

          {visibleTasks.length === 0 && <div style={{ padding: "48px 0", textAlign: "center", color: C.textMuted, fontSize: 13 }}>この月にタスクがありません<br /><span style={{ fontSize: 11 }}>「+ 追加」または日付をクリックして追加</span></div>}
        </div>
      </div>
      {popup && <TaskPopup task={popup.task} tags={tags} anchor={popup} onClose={() => setPopup(null)} onEdit={onEdit} onToggle={id => { onToggle(id); setPopup(null); }} onDelete={onDelete} onDuplicate={onDuplicate} onMemoToggle={handleMemoToggle} />}
    </div>
  );
};

// ── テンプレート（子タグ・子タスクメモ対応）──────
const TemplatesView = ({ templates, setTemplates, onUse, tags }) => {
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ name: "", tasks: [{ title: "", memo: "", tags: [], children: [] }] });
  const addTask = () => setForm(f => ({ ...f, tasks: [...f.tasks, { title: "", memo: "", tags: [], children: [] }] }));
  const updTask = (i, k, v) => setForm(f => { const ts = [...f.tasks]; ts[i] = { ...ts[i], [k]: v }; return { ...f, tasks: ts }; });
  const addChild = i => setForm(f => { const ts = [...f.tasks]; ts[i] = { ...ts[i], children: [...(ts[i].children || []), { title: "", memo: "", tags: [] }] }; return { ...f, tasks: ts }; });
  const updChild = (i, j, k, v) => setForm(f => { const ts = [...f.tasks]; ts[i].children[j] = { ...ts[i].children[j], [k]: v }; return { ...f, tasks: ts }; });
  const parentTags = tags.filter(t => !t.parentId && !t.archived);
  const childTagsOf = pid => tags.filter(t => t.parentId === pid && !t.archived);

  // タグ切り替え（親子連動）
  const togTag = (tagsArr, setTagsFn, tid) => {
    const tag = tags.find(t => t.id === tid);
    let cur = [...tagsArr];
    if (cur.includes(tid)) {
      cur = cur.filter(x => x !== tid);
      if (tag?.parentId) {
        const sib = tags.filter(t => t.parentId === tag.parentId && t.id !== tid).some(t => cur.includes(t.id));
        if (!sib) cur = cur.filter(x => x !== tag.parentId);
      } else {
        cur = cur.filter(x => !tags.filter(t => t.parentId === tid).map(t => t.id).includes(x));
      }
    } else {
      cur = [...cur, tid];
      if (tag?.parentId && !cur.includes(tag.parentId)) cur = [...cur, tag.parentId];
    }
    setTagsFn(cur);
  };

  const TagToggleRow = ({ selectedTags, onChange }) => (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 5, fontWeight: 700 }}>タグ</div>
      {parentTags.map(pt => (
        <div key={pt.id} style={{ marginBottom: 5 }}>
          <div onClick={() => togTag(selectedTags, onChange, pt.id)} style={{ display: "inline-flex", padding: "3px 12px", borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: "pointer", border: `1.5px solid ${pt.color}55`, background: selectedTags.includes(pt.id) ? pt.color + "22" : "transparent", color: selectedTags.includes(pt.id) ? pt.color : C.textMuted, transition: "all .15s", marginBottom: 4 }}>{pt.name}</div>
          {childTagsOf(pt.id).length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, paddingLeft: 12 }}>
              {childTagsOf(pt.id).map(ct => (
                <div key={ct.id} onClick={() => togTag(selectedTags, onChange, ct.id)} style={{ display: "inline-flex", padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: "pointer", border: `1.5px solid ${ct.color}55`, background: selectedTags.includes(ct.id) ? ct.color + "22" : "transparent", color: selectedTags.includes(ct.id) ? ct.color : C.textMuted, transition: "all .15s" }}>└ {ct.name}</div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );

  const save = () => {
    if (!form.name.trim()) return;
    setTemplates(t => [...t, { id: "tpl_" + Date.now(), name: form.name, tasks: form.tasks.filter(t => t.title) }]);
    setForm({ name: "", tasks: [{ title: "", memo: "", tags: [], children: [] }] });
    setShow(false);
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}><Btn variant="accent" onClick={() => setShow(true)}>+ テンプレートを作成</Btn></div>
      {templates.length === 0 && <div style={{ textAlign: "center", padding: 40, color: C.textMuted }}>テンプレートがまだありません</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(290px,1fr))", gap: 14 }}>
        {templates.map(tpl => (
          <div key={tpl.id} style={{ background: C.surface, borderRadius: 16, padding: 18, border: `1px solid ${C.border}`, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontFamily: "'DM Sans',sans-serif", fontWeight: 700, fontSize: 16 }}>{tpl.name}</div>
            <div style={{ flex: 1 }}>
              {tpl.tasks.map((t, i) => (
                <div key={i}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: `1px solid ${C.border}22`, fontSize: 13, color: C.textSub }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: C.accent, flexShrink: 0 }} />{t.title}
                    {(t.tags || []).length > 0 && <div style={{ display: "flex", gap: 3, marginLeft: "auto" }}>{(t.tags || []).map(tid => { const tg = tags.find(x => x.id === tid && x.parentId); return tg ? <TagPill key={tid} tag={tg} /> : null; })}</div>}
                  </div>
                  {(t.children || []).map((c, j) => <div key={j} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0 3px 14px", fontSize: 12, color: C.textMuted }}><div style={{ width: 4, height: 4, borderRadius: "50%", background: C.textMuted, flexShrink: 0 }} />{c.title}</div>)}
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn variant="accent" onClick={() => onUse(tpl)} style={{ flex: 1, padding: "8px", fontSize: 12 }}>使う</Btn>
              <Btn variant="danger" onClick={() => setTemplates(t => t.filter(x => x.id !== tpl.id))} style={{ padding: "8px 12px", fontSize: 12 }}>削除</Btn>
            </div>
          </div>
        ))}
      </div>
      {show && (
        <Modal title="テンプレートを作成" onClose={() => setShow(false)} wide>
          <Inp label="テンプレート名" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} placeholder="例: 週次レビュー" />
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: .5 }}>タスク一覧</div>
            {form.tasks.map((t, i) => (
              <div key={i} style={{ background: C.bg, borderRadius: 12, padding: 14, marginBottom: 10, border: `1px solid ${C.border}` }}>
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <input value={t.title} onChange={e => updTask(i, "title", e.target.value)} placeholder={`タスク ${i + 1}`}
                    style={{ flex: 1, background: C.surface, color: C.text, padding: "8px 12px", borderRadius: 9, border: `1px solid ${C.border}`, fontSize: 13 }} />
                  <button onClick={() => setForm(f => ({ ...f, tasks: f.tasks.filter((_, idx) => idx !== i) }))} style={{ background: C.dangerSoft, color: C.danger, border: "none", borderRadius: 8, width: 34, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
                </div>
                <textarea value={t.memo || ""} onChange={e => updTask(i, "memo", e.target.value)} placeholder="メモ（任意）" rows={2}
                  style={{ width: "100%", background: C.surface, color: C.text, padding: "7px 12px", borderRadius: 9, border: `1px solid ${C.border}`, fontSize: 12, resize: "none", marginBottom: 8 }} />
                <TagToggleRow selectedTags={t.tags || []} onChange={newTags => updTask(i, "tags", newTags)} />
                {(t.children || []).map((c, j) => (
                  <div key={j} style={{ marginLeft: 16, marginBottom: 8, background: C.surface, borderRadius: 10, padding: 10, border: `1px solid ${C.border}` }}>
                    <div style={{ display: "flex", gap: 6, marginBottom: 7, alignItems: "center" }}>
                      <span style={{ color: C.textMuted, fontSize: 13 }}>└</span>
                      <input value={c.title} onChange={e => updChild(i, j, "title", e.target.value)} placeholder={`子タスク ${j + 1}`}
                        style={{ flex: 1, background: C.bg, color: C.text, padding: "6px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontSize: 12 }} />
                      <button onClick={() => setForm(f => { const ts = [...f.tasks]; ts[i].children = ts[i].children.filter((_, idx) => idx !== j); return { ...f, tasks: ts }; })}
                        style={{ background: C.dangerSoft, color: C.danger, border: "none", borderRadius: 6, width: 26, height: 26, fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
                    </div>
                    <textarea value={c.memo || ""} onChange={e => updChild(i, j, "memo", e.target.value)} placeholder="子タスクのメモ（任意）" rows={2}
                      style={{ width: "100%", background: C.bg, color: C.text, padding: "6px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontSize: 11, resize: "none" }} />
                  </div>
                ))}
                <button onClick={() => addChild(i)} style={{ background: "none", color: C.accent, border: `1px dashed ${C.accent}44`, borderRadius: 7, padding: "4px 12px", fontSize: 11, cursor: "pointer", marginTop: 2 }}>+ 子タスク追加</button>
              </div>
            ))}
            <Btn onClick={addTask} style={{ width: "100%", justifyContent: "center" }}>+ タスク追加</Btn>
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <Btn onClick={() => setShow(false)}>キャンセル</Btn>
            <Btn variant="accent" onClick={save}>保存</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
};

// ── タグ管理 ─────────────────────────────────────
const TagsView = ({ tags, setTags }) => {
  const [form, setForm] = useState({ name: "", color: "#7b72f0", parentId: null });
  const [editId, setEditId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const add = () => { if (!form.name.trim()) return; setTags(t => [...t, { id: "tag_" + Date.now(), name: form.name, color: form.color, parentId: form.parentId || null, archived: false }]); setForm({ name: "", color: "#7b72f0", parentId: null }); };
  const archive = id => setTags(ts => ts.map(t => t.id === id ? { ...t, archived: true } : t));
  const restore = id => setTags(ts => ts.map(t => t.id === id ? { ...t, archived: false } : t));
  const startEdit = t => { setEditId(t.id); setEditForm({ name: t.name, color: t.color }); };
  const saveEdit = id => { setTags(ts => ts.map(t => t.id === id ? { ...t, ...editForm } : t)); setEditId(null); };
  const parentTags = tags.filter(t => !t.parentId && !t.archived);
  const childTagsOf = pid => tags.filter(t => t.parentId === pid && !t.archived);
  const archivedTags = tags.filter(t => t.archived);
  const handleParentChange = pid => { const parent = tags.find(t => t.id === pid); setForm(f => ({ ...f, parentId: pid || null, color: parent ? parent.color : f.color })); };
  const EditRow = ({ t }) => editId === t.id && editForm ? (
    <div style={{ background: C.bg, borderRadius: 10, padding: 12, marginTop: 8, display: "flex", gap: 10, alignItems: "flex-end" }}>
      <div style={{ flex: 1 }}><Inp label="タグ名" value={editForm.name} onChange={v => setEditForm(f => ({ ...f, name: v }))} /></div>
      <div style={{ marginBottom: 14 }}><div style={{ fontSize: 11, color: C.textMuted, marginBottom: 5, fontWeight: 700 }}>色</div><input type="color" value={editForm.color} onChange={e => setEditForm(f => ({ ...f, color: e.target.value }))} style={{ width: 44, height: 38, borderRadius: 8, border: `1px solid ${C.border}`, background: "none", cursor: "pointer", padding: 2 }} /></div>
      <div style={{ marginBottom: 14, display: "flex", gap: 6 }}><Btn variant="accent" onClick={() => saveEdit(t.id)}>保存</Btn><Btn onClick={() => setEditId(null)}>✕</Btn></div>
    </div>
  ) : null;
  return (
    <div>
      <div style={{ background: C.surface, borderRadius: 16, padding: 18, border: `1px solid ${C.border}`, marginBottom: 16 }}>
        <div style={{ fontFamily: "'DM Sans',sans-serif", fontWeight: 700, marginBottom: 14, fontSize: 15 }}>新しいタグを作成</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 60px", gap: 10, marginBottom: 10 }}>
          <Inp label="タグ名" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} placeholder="タグ名..." />
          <div><div style={{ fontSize: 11, color: C.textMuted, marginBottom: 5, fontWeight: 700 }}>色</div><input type="color" value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} style={{ width: "100%", height: 40, borderRadius: 9, border: `1px solid ${C.border}`, background: "none", cursor: "pointer", padding: 2 }} /></div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 5, fontWeight: 700, textTransform: "uppercase", letterSpacing: .5 }}>親タグ</div>
          <select value={form.parentId || ""} onChange={e => handleParentChange(e.target.value || null)} style={{ width: "100%", background: C.bg, color: C.text, padding: "10px 13px", borderRadius: 9, border: `1px solid ${C.border}`, fontSize: 13 }}>
            <option value="">なし（親タグとして作成）</option>
            {parentTags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <Btn variant="accent" onClick={add}>追加</Btn>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {parentTags.map(pt => (
          <div key={pt.id} style={{ background: C.surface, borderRadius: 14, padding: 14, border: `1px solid ${pt.color}33` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 14, height: 14, borderRadius: "50%", background: pt.color, boxShadow: `0 0 10px ${pt.color}66` }} />
                <span style={{ fontWeight: 700, color: pt.color, fontSize: 15 }}>{pt.name}</span>
                <span style={{ fontSize: 11, color: C.textMuted, background: C.surfaceHover, padding: "1px 8px", borderRadius: 8 }}>親タグ</span>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <Btn onClick={() => startEdit(pt)} style={{ padding: "4px 11px", fontSize: 11 }}>編集</Btn>
                <Btn variant="danger" onClick={() => archive(pt.id)} style={{ padding: "4px 11px", fontSize: 11 }}>アーカイブ</Btn>
              </div>
            </div>
            <EditRow t={pt} />
            {childTagsOf(pt.id).length > 0 && (
              <div style={{ paddingLeft: 22, marginTop: 10, display: "flex", flexDirection: "column", gap: 5 }}>
                {childTagsOf(pt.id).map(ct => (
                  <div key={ct.id} style={{ background: C.bg, borderRadius: 10, border: `1px solid ${ct.color}33`, padding: "8px 12px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ width: 10, height: 10, borderRadius: "50%", background: ct.color }} />
                        <span style={{ fontSize: 13, color: ct.color, fontWeight: 600 }}>{ct.name}</span>
                        <span style={{ fontSize: 10, color: C.textMuted }}>小タグ</span>
                      </div>
                      <div style={{ display: "flex", gap: 5 }}>
                        <Btn onClick={() => startEdit(ct)} style={{ padding: "3px 9px", fontSize: 11 }}>編集</Btn>
                        <Btn variant="danger" onClick={() => archive(ct.id)} style={{ padding: "3px 9px", fontSize: 11 }}>アーカイブ</Btn>
                      </div>
                    </div>
                    <EditRow t={ct} />
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {archivedTags.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <button onClick={() => setShowArchived(!showArchived)} style={{ background: "none", border: "none", color: C.textMuted, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
            {showArchived ? "▼" : "▶"} アーカイブ済み ({archivedTags.length})
          </button>
          {showArchived && <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {archivedTags.map(t => (
              <div key={t.id} style={{ background: C.surface, borderRadius: 10, padding: "10px 14px", border: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", opacity: .55 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}><div style={{ width: 10, height: 10, borderRadius: "50%", background: t.color }} /><span style={{ fontSize: 13, color: C.textSub }}>{t.name}</span><span style={{ fontSize: 10, color: C.textMuted }}>{t.parentId ? "小タグ" : "親タグ"}</span></div>
                <div style={{ display: "flex", gap: 6 }}><Btn onClick={() => restore(t.id)} style={{ padding: "3px 10px", fontSize: 11 }}>復元</Btn><Btn variant="danger" onClick={() => setTags(ts => ts.filter(x => x.id !== t.id))} style={{ padding: "3px 10px", fontSize: 11 }}>完全削除</Btn></div>
              </div>
            ))}
          </div>}
        </div>
      )}
    </div>
  );
};

// ── メインApp ────────────────────────────────────
export default function App() {
  const [sideOpen, setSideOpen] = useState(true);
  const [sortOrder, setSortOrder] = useState("デフォルト");
  const today = new Date().toISOString().slice(0, 10);
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginLoading, setLoginLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [tags, setTags] = useState(TAG_PRESETS);
  const [templates, setTemplates] = useState([]);
  const [view, setView] = useState("list");
  const [showForm, setShowForm] = useState(false);
  const [editTask, setEditTask] = useState(null);
  const [addChildTo, setAddChildTo] = useState(null);
  const [filters, setFilters] = useState({ tag: "", search: "", hideCompleted: false });
  const [dragTask, setDragTask] = useState(null);
  const [defaultDate, setDefaultDate] = useState(null);
  const [defaultTime, setDefaultTime] = useState(null);

  useEffect(() => { const unsub = onAuthStateChanged(auth, u => { setUser(u); setAuthLoading(false); }); return unsub; }, []);
  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(doc(db, "users", user.uid), snap => {
      if (snap.exists()) { const d = snap.data(); if (d.tasks) setTasks(d.tasks); if (d.tags) setTags(d.tags); if (d.templates) setTemplates(d.templates); }
    });
    return unsub;
  }, [user]);

  const save = async (t, tg, tp) => { if (!user) return; setSaving(true); try { await setDoc(doc(db, "users", user.uid), { tasks: t, tags: tg, templates: tp, updatedAt: new Date().toISOString() }); } catch (e) { console.error(e); } setSaving(false); };
  const updT = t => { setTasks(t); save(t, tags, templates); };
  const updTg = t => { setTags(t); save(tasks, t, templates); };
  const updTp = t => { setTemplates(t); save(tasks, tags, t); };
  const handleLogin = async () => {
    setLoginLoading(true);
    try { const r = await signInWithPopup(auth, provider); if (!ALLOWED_UIDS.includes(r.user.uid)) { await signOut(auth); alert("このアカウントはアクセスできません。"); } }
    catch (e) { console.error(e); } setLoginLoading(false);
  };

  const updTree = (ts, id, fn) => ts.map(t => t.id === id ? fn(t) : { ...t, children: updTree(t.children || [], id, fn) });
  const delTree = (ts, id) => ts.filter(t => t.id !== id).map(t => ({ ...t, children: delTree(t.children || [], id) }));
  const addChildFn = (ts, pid, c) => ts.map(t => t.id === pid ? { ...t, children: [...(t.children || []), c] } : { ...t, children: addChildFn(t.children || [], pid, c) });

  const handleSave = f => {
    const fw = { ...f, isLater: isAutoLater(f) };
    let nt;
    if (editTask) nt = updTree(tasks, f.id, () => fw);
    else if (addChildTo) nt = addChildFn(tasks, addChildTo, fw);
    else nt = [...tasks, fw];
    // 編集したタスクのタグを正として同期
    updT(syncTagsFromEdited(nt, fw.id, fw.tags, tags));
    setEditTask(null); setAddChildTo(null);
  };

  const handleUpdateTask = updated => {
    const clean = { ...updated }; delete clean._parentTitle; delete clean._parentId;
    updT(syncTagsFromEdited(updTree(tasks, clean.id, () => clean), clean.id, clean.tags, tags));
    setDragTask(null);
  };

  const handleAddTask = (date, hour) => { setDefaultDate(date); setDefaultTime(hour != null ? `${String(hour).padStart(2, "0")}:00` : null); setEditTask(null); setAddChildTo(null); setShowForm(true); };
  const handleToggle = id => updT(updTree(tasks, id, t => ({ ...t, done: !t.done })));
  const handleDelete = id => updT(delTree(tasks, id));
  const handleEdit = t => { setEditTask(t); setShowForm(true); };
  const handleDuplicate = t => {
    const dup = tk => ({ ...tk, id: "task_" + Date.now() + Math.random(), title: tk.title + " (コピー)", done: false, children: (tk.children || []).map(c => dup(c)) });
    const d = dup(t);
    let nt;
    if (t._parentId) nt = addChildFn(tasks, t._parentId, d);
    else { const idx = tasks.findIndex(x => x.id === t.id); nt = [...tasks.slice(0, idx + 1), d, ...tasks.slice(idx + 1)]; }
    updT(nt);
  };
  const handleUseTemplate = tpl => {
    const newTasks = tpl.tasks.map(t => ({
      id: "task_" + Date.now() + Math.random(), title: t.title, done: false, tags: t.tags || [], memo: t.memo || "",
      startDate: "", startTime: "", endDate: "", endTime: "", deadlineDate: "", deadlineTime: "", repeat: "なし", duration: "", isLater: true,
      children: (t.children || []).map(c => ({ id: "task_" + Date.now() + Math.random(), title: c.title, done: false, tags: c.tags || [], memo: c.memo || "", startDate: "", startTime: "", endDate: "", endTime: "", deadlineDate: "", deadlineTime: "", repeat: "なし", duration: "", isLater: true, children: [] }))
    }));
    updT([...tasks, ...newTasks]); setView("list");
  };

  const allFlat = flattenTasks(tasks);
  const done = allFlat.filter(t => t.done).length;
  const total = allFlat.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const NAV = [
    { id: "list", label: "リスト", icon: "☰" },
    { id: "day", label: "日", icon: "📆" },
    { id: "week", label: "週", icon: "📅" },
    { id: "month", label: "ガント", icon: "📊" },
    { id: "templates", label: "テンプレート", icon: "📋" },
    { id: "tagmgr", label: "タグ管理", icon: "🏷" },
  ];
  const parentTags = tags.filter(t => !t.parentId && !t.archived);
  const showLaterPanel = ["day", "week", "month"].includes(view);

  if (authLoading) return <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", color: C.textMuted }}>読み込み中...</div>;
  if (!user) return <LoginScreen onLogin={handleLogin} loading={loginLoading} />;

  return (
    <>
      <style>{G}</style>
      <div style={{ minHeight: "100vh", background: C.bg, display: "flex" }}>
        {/* ── サイドバー ── */}
        <div style={{ width: sideOpen ? 212 : 46, flexShrink: 0, background: C.surface, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", position: "fixed", top: 0, left: 0, height: "100vh", overflowY: "auto", zIndex: 10, transition: "width .2s", boxShadow: "2px 0 20px rgba(0,0,0,.3)" }}>
          <div style={{ padding: `16px ${sideOpen ? 16 : 7}px 14px`, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, flexShrink: 0 }}>
            {sideOpen && <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontFamily: "'DM Sans',sans-serif", fontWeight: 700, fontSize: 17, whiteSpace: "nowrap", letterSpacing: -.5 }}>
                <span style={{ background: `linear-gradient(135deg, ${C.accent}, ${C.info})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>◈ マイタスク</span>
              </div>
              <div style={{ fontSize: 10, color: C.textMuted, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.email}</div>
              {saving && <div style={{ fontSize: 10, color: C.success, marginTop: 1, display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 5, height: 5, borderRadius: "50%", background: C.success, display: "inline-block" }} />保存中...</div>}
              <div style={{ marginTop: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.textMuted, marginBottom: 4 }}><span>進捗</span><span style={{ fontWeight: 700, color: C.accent }}>{pct}%</span></div>
                <div style={{ background: C.bg, borderRadius: 10, height: 5, overflow: "hidden" }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: `linear-gradient(90deg, ${C.accent}, ${C.success})`, borderRadius: 10, transition: "width .5s" }} />
                </div>
                <div style={{ fontSize: 10, color: C.textMuted, marginTop: 3 }}>{done}/{total} 完了</div>
              </div>
            </div>}
            <button onClick={() => setSideOpen(!sideOpen)} style={{ background: C.accentSoft, color: C.accent, border: `1px solid ${C.accent}33`, borderRadius: 9, width: 28, height: 28, fontSize: 13, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", transition: "all .15s" }}>{sideOpen ? "◀" : "▶"}</button>
          </div>

          <div style={{ padding: `10px ${sideOpen ? 8 : 5}px`, flex: 1, overflowY: "auto" }}>
            {NAV.map(n => (
              <button key={n.id} className="nb" onClick={() => setView(n.id)} title={n.label}
                style={{ display: "flex", alignItems: "center", gap: sideOpen ? 10 : 0, justifyContent: sideOpen ? "flex-start" : "center", width: "100%", padding: "9px 8px", borderRadius: 10, marginBottom: 3, background: view === n.id ? C.accentSoft : "transparent", color: view === n.id ? C.accent : C.textSub, border: view === n.id ? `1px solid ${C.accent}33` : "1px solid transparent", fontSize: 13, fontWeight: view === n.id ? 700 : 400, transition: "all .15s", textAlign: "left" }}>
                <span style={{ fontSize: 16, flexShrink: 0 }}>{n.icon}</span>
                {sideOpen && n.label}
                {sideOpen && view === n.id && <div style={{ marginLeft: "auto", width: 6, height: 6, borderRadius: "50%", background: C.accent }} />}
              </button>
            ))}
          </div>

          {sideOpen && <div style={{ padding: "12px 10px", borderTop: `1px solid ${C.border}`, flexShrink: 0 }}>
            <div style={{ position: "relative", marginBottom: 7 }}>
              <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: C.textMuted }}>🔍</span>
              <input value={filters.search} onChange={e => setFilters(f => ({ ...f, search: e.target.value }))} placeholder="検索..."
                style={{ width: "100%", background: C.bg, color: C.text, padding: "7px 10px 7px 28px", borderRadius: 9, border: `1px solid ${C.border}`, fontSize: 12 }} />
            </div>
            <select value={filters.tag} onChange={e => setFilters(f => ({ ...f, tag: e.target.value }))}
              style={{ width: "100%", background: C.bg, color: C.text, padding: "7px 10px", borderRadius: 9, border: `1px solid ${C.border}`, fontSize: 12, marginBottom: 8 }}>
              <option value="">すべてのタグ</option>
              {parentTags.map(pt => (<optgroup key={pt.id} label={pt.name}><option value={pt.id}>{pt.name}（全体）</option>{tags.filter(t => t.parentId === pt.id && !t.archived).map(ct => <option key={ct.id} value={ct.id}>└ {ct.name}</option>)}</optgroup>))}
            </select>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
              <Checkbox checked={filters.hideCompleted} onChange={() => setFilters(f => ({ ...f, hideCompleted: !f.hideCompleted }))} size={15} />
              <span style={{ fontSize: 11, color: C.textMuted }}>完了を隠す</span>
            </div>
            <button onClick={() => signOut(auth)} style={{ width: "100%", background: "transparent", color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: 9, padding: "6px", fontSize: 11, cursor: "pointer", transition: "all .15s" }}
              onMouseEnter={e => { e.currentTarget.style.background = C.dangerSoft; e.currentTarget.style.color = C.danger; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = C.textMuted; }}>ログアウト</button>
          </div>}
          {!sideOpen && <div style={{ padding: "8px 5px", borderTop: `1px solid ${C.border}`, flexShrink: 0 }}>
            <button onClick={() => signOut(auth)} title="ログアウト" style={{ background: "transparent", color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: 9, padding: "6px", fontSize: 12, cursor: "pointer", width: "100%" }}>↩</button>
          </div>}
        </div>

        {/* ── メインコンテンツ ── */}
        <div style={{ marginLeft: sideOpen ? 212 : 46, flex: 1, display: "flex", minHeight: "100vh", transition: "margin .2s" }}>
          <div style={{ flex: 1, padding: "24px 28px", minWidth: 0, overflowX: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
              <div>
                <h1 style={{ fontFamily: "'DM Sans',sans-serif", fontWeight: 700, fontSize: 22, letterSpacing: -.5, lineHeight: 1.2 }}>
                  {NAV.find(n => n.id === view)?.icon} {NAV.find(n => n.id === view)?.label}
                </h1>
                <div style={{ fontSize: 12, color: C.textMuted, marginTop: 3 }}>
                  {new Date(today).toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "long" })}
                </div>
              </div>
              {["list", "day", "week", "month"].includes(view) && (
                <Btn variant="accent" onClick={() => { setDefaultDate(null); setDefaultTime(null); setEditTask(null); setAddChildTo(null); setShowForm(true); }}>
                  ＋ 追加
                </Btn>
              )}
            </div>
            {view === "list" && <ListView tasks={tasks} tags={tags} filters={filters} onEdit={handleEdit} onDelete={handleDelete} onToggle={handleToggle} onAddChild={pid => { setAddChildTo(pid); setShowForm(true); }} onDuplicate={handleDuplicate} sortOrder={sortOrder} setSortOrder={setSortOrder} />}
            {view === "day" && <DayView tasks={tasks} tags={tags} today={today} onUpdateTask={handleUpdateTask} onAddTask={handleAddTask} onToggle={handleToggle} onEdit={handleEdit} onDelete={handleDelete} onDuplicate={handleDuplicate} dragTask={dragTask} setDragTask={setDragTask} />}
            {view === "week" && <WeekView tasks={tasks} tags={tags} today={today} onUpdateTask={handleUpdateTask} onAddTask={handleAddTask} onToggle={handleToggle} onEdit={handleEdit} onDelete={handleDelete} onDuplicate={handleDuplicate} dragTask={dragTask} setDragTask={setDragTask} />}
            {view === "month" && <MonthView tasks={tasks} tags={tags} today={today} onUpdateTask={handleUpdateTask} onAddTask={handleAddTask} onToggle={handleToggle} onEdit={handleEdit} onDelete={handleDelete} onDuplicate={handleDuplicate} dragTask={dragTask} setDragTask={setDragTask} />}
            {view === "templates" && <TemplatesView templates={templates} setTemplates={updTp} onUse={handleUseTemplate} tags={tags} />}
            {view === "tagmgr" && <TagsView tags={tags} setTags={updTg} />}
          </div>
          {showLaterPanel && <LaterPanel tasks={tasks} tags={tags} dragTask={dragTask} setDragTask={setDragTask} />}
        </div>
      </div>
      {showForm && <TaskForm task={editTask} tags={tags} isChild={!!addChildTo} onSave={handleSave} defaultDate={defaultDate} defaultTime={defaultTime} onClose={() => { setShowForm(false); setEditTask(null); setAddChildTo(null); setDefaultDate(null); setDefaultTime(null); }} />}
    </>
  );
}
