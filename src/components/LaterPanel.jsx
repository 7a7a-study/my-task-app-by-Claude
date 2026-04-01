import { useState } from "react";
import { C } from "../constants";
import { flatten, isLaterTask, fd, localDate } from "../utils";
import { Pill } from "./ui";

const addDays = (base, n) => {
  const d = new Date(base); d.setDate(d.getDate() + n); return localDate(d);
};
const thisWeekEnd = (base) => {
  const d = new Date(base); const dow = d.getDay();
  d.setDate(d.getDate() + (dow === 0 ? 0 : 7 - dow)); return localDate(d);
};
const nextWeekStart = (base) => {
  const d = new Date(base); const dow = d.getDay();
  d.setDate(d.getDate() + (dow === 0 ? 1 : 8 - dow)); return localDate(d);
};

export const LaterPanel = ({tasks, tags, dragTask, setDragTask, onEdit, onUpdate}) => {
  const today = localDate();
  const later = flatten(tasks).filter(t => t.isLater || isLaterTask(t));
  const isMobile = window.innerWidth < 768;
  const [open, setOpen] = useState(!isMobile);

  const scheduleTask = (t, date) => {
    if (!onUpdate) return;
    const newSessions = (t.sessions||[]).length > 0
      ? t.sessions.map((s, i) => i === 0 ? {...s, startDate: date, date, startTime: "", endTime: ""} : s)
      : [{id: "s_main", startDate: date, date, startTime: "", endTime: ""}];
    onUpdate({...t, sessions: newSessions, startDate: "", startTime: "", endTime: "", isLater: false});
  };

  return (
    <div style={{width: open ? 188 : 28, flexShrink: 0, background: C.surface, borderLeft: `1px solid ${C.border}`, display: "flex", flexDirection: "column", overflow: "hidden", transition: "width .2s"}}>
      <div style={{padding: "8px 8px 4px", flexShrink: 0, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", minWidth: 0}}>
        {open ? (
          <>
            <div>
              <div style={{fontSize: 9, fontWeight: 700, color: C.warn, textTransform: "uppercase", letterSpacing: 1, whiteSpace: "nowrap"}}>📌 あとでやる</div>
              <div style={{fontSize: 8, color: C.textMuted, marginTop: 1, whiteSpace: "nowrap"}}>ドラッグ配置 / ボタンで日程追加</div>
            </div>
            <button onClick={() => setOpen(false)} title="閉じる"
              style={{background: "none", border: "none", color: C.textMuted, cursor: "pointer", fontSize: 13, lineHeight: 1, flexShrink: 0, padding: "0 2px"}}>‹</button>
          </>
        ) : (
          <button onClick={() => setOpen(true)} title="あとでやるを開く"
            style={{background: "none", border: "none", color: C.warn, cursor: "pointer", fontSize: 13, lineHeight: 1, width: "100%", padding: "2px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: 2}}>
            <span>›</span>
            {later.length > 0 && <span style={{fontSize: 8, background: C.warnS, color: C.warn, borderRadius: 8, padding: "1px 3px", fontWeight: 700}}>{later.length}</span>}
          </button>
        )}
      </div>
      {open && later.length === 0 && <div style={{fontSize: 11, color: C.textMuted, textAlign: "center", padding: "12px 0", flex: 1}}>なし</div>}
      {open && (
        <div style={{flex: 1, overflowY: "auto", padding: "4px 6px 6px"}}>
          {later.map(t => {
            const c = tags.find(tg => t.tags?.includes(tg.id))?.color || C.accent;
            const isDragging = dragTask?.id === t.id;
            const childTag = tags.find(tg => t.tags?.includes(tg.id) && tg.parentId);
            return (
              <div key={t.id} style={{background: isDragging ? C.accentS : C.bgSub, borderLeft: `3px solid ${c}`, borderRadius: "0 6px 6px 0", padding: "5px 6px", marginBottom: 6, opacity: isDragging ? .4 : 1}}>
                <div draggable className="drag" style={{position: "relative"}}
                  onDragStart={e => {e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("laterTaskId", t.id); setDragTask(t);}}
                  onDragEnd={() => setDragTask(null)}>
                  {t._pt && <div style={{fontSize: 8, color: C.textMuted, marginBottom: 1}}>📁{t._pt}</div>}
                  <div style={{fontSize: 10, fontWeight: 600, color: C.text, lineHeight: 1.3, paddingRight: 18}}>{t.title}</div>
                  <div style={{display: "flex", gap: 3, flexWrap: "wrap", marginTop: 2}}>
                    {t.duration && <span style={{fontSize: 8, color: C.accent}}>⏱{t.duration}分</span>}
                    {t.deadlineDate && <span style={{fontSize: 8, color: C.warn}}>⚠{fd(t.deadlineDate)}</span>}
                    {childTag && <Pill tag={childTag}/>}
                  </div>
                  <button onClick={() => onEdit(t)} title="編集"
                    style={{position: "absolute", top: 0, right: 0, background: C.surfHov, color: C.textSub, border: "none", borderRadius: 4, width: 16, height: 16, fontSize: 8, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer"}}>✎</button>
                </div>
                {onUpdate && (
                  <div style={{display: "flex", gap: 3, marginTop: 5, flexWrap: "wrap"}}>
                    {[
                      {label: "今日", date: today, color: C.success},
                      {label: "明日", date: addDays(today, 1), color: C.accent},
                      {label: "今週末", date: thisWeekEnd(today), color: C.warn},
                      {label: "来週", date: nextWeekStart(today), color: C.textMuted},
                    ].map(({label, date, color}) => (
                      <button key={label} onClick={() => scheduleTask(t, date)}
                        style={{fontSize: 8, padding: "2px 6px", borderRadius: 8, border: `1px solid ${color}55`,
                          background: color + "18", color, cursor: "pointer", fontWeight: 600, lineHeight: 1.4}}>
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
