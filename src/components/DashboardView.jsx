import { useState, useMemo } from "react";
import { C } from "../constants";
import { flatten, fd, sameDay, parseRepeat, matchesRepeat, isLaterTask, localDate, t2m, addDur, getTasksForDate, getDeadlineTasksForDate, useIsPC, useResizeHandler, isHol } from "../utils";
import { getGCalEventsForDate } from "../gcal";
import { TimelineChip } from "./ListView";
import { TaskRow } from "../components/TaskRow";
import { Popup } from "../components/Popup";

export const DashboardView = ({tasks,tags,today,onToggle,onEdit,onDelete,onDuplicate,onSkip,onOverride,onAddSession,onRemoveSession,onMemoToggle,onAdd,onUpdate,dragTask,setDragTask,gcalEvents,gcalEnabled,gcalError}) => {
  const isPC = useIsPC();
  const [popup, setPopup] = useState(null);
  const [dropH, setDropH] = useState(null);
  const [showStats, setShowStats] = useState(false);

  const all = useMemo(() => flatten(tasks), [tasks]);
  const nonRep = all.filter(t => !t.repeat || parseRepeat(t.repeat).type === "なし");

  const todayTasks = all.filter(t => {
    if (t.repeat && parseRepeat(t.repeat).type !== "なし") return matchesRepeat(t, today);
    return (t.sessions||[]).some(s => sameDay(s.date, today)) || sameDay(t.deadlineDate, today);
  }).filter(t => !(t.isLater || isLaterTask(t)));
  const todayDone = todayTasks.filter(t => {
    if (t.repeat && parseRepeat(t.repeat).type !== "なし") return (t.doneDates||[]).includes(today);
    return t.done;
  }).length;

  const in7 = (() => { const d = new Date(today); d.setDate(d.getDate() + 7); return localDate(d); })();

  const overdue = nonRep.filter(t => t.deadlineDate && !t.done && t.deadlineDate < today)
                        .sort((a,b) => a.deadlineDate.localeCompare(b.deadlineDate));

  const overdueScheduled = nonRep.filter(t => {
    if (t.done || t.deadlineDate) return false;
    const sessions = t.sessions || [];
    if (sessions.length === 0) return false;
    const hasFuture = sessions.some(s => { const sd = s.startDate || s.date || ""; return sd >= today; });
    if (hasFuture) return false;
    return sessions.some(s => { const sd = s.startDate || s.date || ""; return sd && sd < today; });
  }).sort((a,b) => {
    const lastDate = t => [...(t.sessions||[])].map(s => s.startDate||s.date||"").sort().pop() || "";
    return lastDate(a).localeCompare(lastDate(b));
  });

  // 今後7日間（tomorrow〜+7日）に予定があるタスク（繰り返し含む・完了除外）
  const tomorrow = (() => { const d = new Date(today); d.setDate(d.getDate()+1); return localDate(d); })();
  const week7Tasks = (() => {
    const days = [];
    for (let i = 1; i <= 7; i++) {
      const d = new Date(today); d.setDate(d.getDate() + i);
      days.push(localDate(d));
    }
    const seen = new Set();
    const result = [];
    all.forEach(t => {
      if (t.done) return;
      if (seen.has(t.id)) return;
      // 締切日が範囲内
      const hasDeadline = !!(t.deadlineDate && t.deadlineDate >= tomorrow && t.deadlineDate <= in7);
      // 繰り返しタスク: 範囲内の日にマッチするか
      let hasSession = false;
      if (t.repeat && parseRepeat(t.repeat).type !== "なし") {
        hasSession = days.some(d => matchesRepeat(t, d));
      } else {
        // 通常タスク: sessionsのstartDate/endDateが範囲内
        hasSession = (t.sessions||[]).some(s => {
          const sd = s.startDate || s.date || "";
          const ed = s.endDate || sd;
          return sd && sd <= in7 && (ed || sd) >= tomorrow;
        });
      }
      if (hasDeadline || hasSession) {
        seen.add(t.id);
        result.push({...t, _w7deadline: hasDeadline, _w7session: hasSession});
      }
    });
    return result.sort((a, b) => {
      const dateOf = t => t.deadlineDate || (t.sessions||[]).map(s=>s.startDate||s.date||"").filter(Boolean).sort()[0] || "9";
      return dateOf(a).localeCompare(dateOf(b));
    });
  })();

  const laterTasks = all.filter(t => !t.children?.length && (t.isLater || isLaterTask(t)) && !t.done);

  const tagStats = tags.filter(t => !t.parentId && !t.archived).map(tag => {
    const childTagIds = tags.filter(c => c.parentId === tag.id).map(c => c.id);
    const tt = nonRep.filter(t => t.tags?.includes(tag.id) || childTagIds.some(cid => t.tags?.includes(cid)));
    const td = tt.filter(t => t.done).length;
    return {...tag, total: tt.length, done: td, pct: tt.length ? Math.round(td / tt.length * 100) : 0};
  }).filter(t => t.total > 0);

  const doneCnt  = nonRep.filter(t => t.done).length;
  const totalCnt = nonRep.length;
  const pct = totalCnt > 0 ? Math.round(doneCnt / totalCnt * 100) : 0;

  const openPopup = (e, task) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setPopup({task, taskId: task.id, x: Math.min(r.right+8, window.innerWidth-308), y: Math.min(r.top, window.innerHeight-420)});
  };
  const hToggle = (id) => {
    const t = all.find(x=>x.id===id);
    const isRep = t?.repeat && parseRepeat(t.repeat).type !== "なし";
    onToggle(id, isRep ? today : undefined);
  };

  const addDaysStr = (base, n) => { const d = new Date(base); d.setDate(d.getDate()+n); return localDate(d); };
  const nextWeekend = (base) => {
    const d = new Date(base); d.setDate(d.getDate()+1);
    for (let i=0; i<14; i++) {
      const s = localDate(d); const dow = d.getDay();
      if (dow===0 || dow===6 || isHol(s)) return s;
      d.setDate(d.getDate()+1);
    }
    return localDate(d);
  };
  const nextWeekday = (base) => {
    const d = new Date(base); const dow = d.getDay();
    d.setDate(d.getDate() + (dow===0 ? 1 : 8 - dow));
    for (let i=0; i<7; i++) {
      const s = localDate(d); const wd = d.getDay();
      if (wd>=1 && wd<=5 && !isHol(s)) return s;
      d.setDate(d.getDate()+1);
    }
    return localDate(d);
  };

  const quickScheduleAdd = (task, date) => {
    if (!onUpdate) return;
    const newSession = { id: "s_" + Date.now(), startDate: date, date, startTime: "", endTime: "" };
    const sessions = [...(task.sessions||[]), newSession];
    onUpdate({...task, sessions, startDate:"", startTime:"", endTime:"", isLater:false});
  };

  const quickScheduleOverwrite = (task, date) => {
    if (!onUpdate) return;
    const sid = task._sessionId;
    let sessions;
    if (sid) {
      sessions = (task.sessions||[]).map(s => s.id===sid ? {...s, startDate:date, date} : s);
    } else {
      sessions = (task.sessions||[]).length > 0
        ? task.sessions.map((s,i) => i===0 ? {...s, startDate:date, date} : s)
        : [{id:"s_main", startDate:date, date, startTime:"", endTime:""}];
    }
    onUpdate({...task, sessions, startDate:"", startTime:"", endTime:"", isLater:false});
  };

  const quickDates = () => [
    {label:"明日",   date:addDaysStr(today,1), color:C.accent},
    {label:"今週末", date:nextWeekend(today),  color:C.warn},
    {label:"来週",   date:nextWeekday(today),  color:C.info},
  ];

  const QuickBtns = ({task, mode}) => (
    <div style={{display:"flex",gap:3,marginTop:4,flexWrap:"wrap"}}>
      {quickDates().map(({label,date,color}) => (
        <button key={label}
          onClick={e=>{e.stopPropagation(); mode==="overwrite" ? quickScheduleOverwrite(task,date) : quickScheduleAdd(task,date);}}
          style={{fontSize:8,padding:"2px 6px",borderRadius:8,border:`1px solid ${color}55`,
            background:color+"15",color,cursor:"pointer",fontWeight:600,lineHeight:1.4}}>
          {label}→
        </button>
      ))}
    </div>
  );

  const DAY_START = 6, DAY_END = 23, PPM = 0.75;
  const HH = 60 * PPM;
  const dayStartMin = DAY_START * 60;

  const tlTasks       = useMemo(() => getTasksForDate(tasks, today), [tasks, today]);
  // GCalイベント（メモリキャッシュのみ・Firestoreに書かない）
  const gcalForToday  = useMemo(() => getGCalEventsForDate(gcalEvents, today), [gcalEvents, today]);
  const gcalTimed     = gcalForToday.filter(ev => ev.startTime && !ev.isAllDay);
  const gcalAllDay    = gcalForToday.filter(ev => ev.isAllDay || !ev.startTime);
  const deadlineTasks = useMemo(() => getDeadlineTasksForDate(tasks, today), [tasks, today]);
  const timedTasks     = tlTasks.filter(t => t.startTime);
  const untimedTasks   = tlTasks.filter(t => !t.startTime);
  const normalUntimed  = untimedTasks.filter(t => !t._isDeadline);
  const deadlineUntimed = [
    ...untimedTasks.filter(t => t._isDeadline),
    // 締切タスクは未完了なら日時枠の有無に関わらず常に表示
    ...deadlineTasks.filter(t => !t.deadlineTime),
  ];
  const timedDeadlines = deadlineTasks.filter(t => !!t.deadlineTime);

  const PPM_DB = PPM;
  const timedWithCols = useMemo(() => {
    const chips = timedTasks.map(t => {
      const s = t2m(t.startTime)||0;
      const e = t.endTime ? t2m(t.endTime) : s+(Number(t.duration)||60);
      const dispH = Math.max(20, (e-s)*PPM_DB);
      return {...t, _sm:s, _em:e, _dispEnd: s + dispH/PPM_DB};
    });
    return chips.map((chip, i) => {
      const group = chips.map((_,j)=>j).filter(j =>
        chips[j]._sm < chip._dispEnd && chips[j]._dispEnd > chip._sm
      );
      const totalCols = group.length;
      const col = group.indexOf(i);
      return {...chip, _col: col, _totalCols: totalCols};
    });
  }, [timedTasks]); // eslint-disable-line

  const MiniRow = ({task, showDate, draggable: isDraggable, showQuick, showQuickOverwrite, week7Mode}) => {
    const c = tags.find(tg => task.tags?.includes(tg.id))?.color || C.accent;
    const childTag = tags.find(tg => task.tags?.includes(tg.id) && tg.parentId);
    const isOver = task.deadlineDate && task.deadlineDate < today && !task.done;
    // week7Modeの繰り返しタスクは未来日なので常に未完了表示
    const isDone = week7Mode && task.repeat && parseRepeat(task.repeat).type !== "なし"
      ? false
      : task.repeat && parseRepeat(task.repeat).type !== "なし"
        ? (task.doneDates||[]).includes(today)
        : task.done;

    // 今後7日間の日時枠情報（繰り返し含む）
    const sessionDateStr = (() => {
      if (!showDate) return "";
      if (task.repeat && parseRepeat(task.repeat).type !== "なし") {
        // 繰り返しはsessions[0]の時間情報だけ表示
        const s0 = task.sessions?.[0];
        return s0?.startTime ? s0.startTime + (s0.endTime ? `〜${s0.endTime}` : "") : "繰返";
      }
      return task.sessions?.[0]?.startDate || task.sessions?.[0]?.date || "";
    })();

    return (
      <div style={{padding:"4px 0",borderBottom:`1px solid ${C.border}18`,opacity:isDone?.55:1}}>
        <div style={{display:"flex",alignItems:"center",gap:7,cursor:isDraggable?"grab":"pointer"}}
          draggable={!!isDraggable}
          onDragStart={isDraggable ? e=>{e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("taskId",task.id);setDragTask&&setDragTask(task);} : undefined}
          onDragEnd={isDraggable ? ()=>setDragTask&&setDragTask(null) : undefined}
          onClick={e=>openPopup(e,task)}>
          <div onClick={e=>{e.stopPropagation();hToggle(task.id);}}
            style={{width:12,height:12,borderRadius:3,border:`2px solid ${isDone?c:C.border}`,
              background:isDone?c:"transparent",flexShrink:0,cursor:"pointer",
              display:"flex",alignItems:"center",justifyContent:"center"}}>
            {isDone && <span style={{color:"#fff",fontSize:7,fontWeight:900}}>✓</span>}
          </div>
          <span style={{fontSize:12,color:isDone?C.textMuted:C.text,
            textDecoration:isDone?"line-through":"none",
            flex:1,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{task.title}</span>
          {childTag && <span style={{fontSize:8,color:childTag.color,fontWeight:600,flexShrink:0,
            padding:"1px 5px",borderRadius:8,background:childTag.color+"18"}}>{childTag.name}</span>}
          {showDate && (() => {
            const hasDL = !!task.deadlineDate;
            const isOver2 = hasDL && task.deadlineDate < today;
            const dlColor = isOver2 ? C.danger : C.warn;
            const hasSession = task._w7session && sessionDateStr;
            // 締切あり
            if (hasDL) {
              const dlLabel = (isOver2 ? "⚠ " : "") + fd(task.deadlineDate) + "締";
              // 日時枠もあるかどうかをアイコンで付記
              const sessionHint = hasSession
                ? <span style={{fontSize:9,color:C.accent,flexShrink:0,marginLeft:2}}>📅</span>
                : <span style={{fontSize:9,color:C.textMuted,flexShrink:0,marginLeft:2,opacity:.5}}>□</span>;
              return (
                <span style={{display:"flex",alignItems:"center",gap:1,flexShrink:0}}>
                  <span style={{fontSize:9,color:dlColor,fontWeight:isOver2?700:500}}>{dlLabel}</span>
                  {sessionHint}
                </span>
              );
            }
            // セッションのみ
            if (sessionDateStr) return (
              <span style={{fontSize:9,color:C.accent,flexShrink:0}}>
                📅{task.repeat&&parseRepeat(task.repeat).type!=="なし" ? sessionDateStr : fd(sessionDateStr)}
              </span>
            );
            return null;
          })()}
        </div>
        {showQuick && !isDone && <QuickBtns task={task} mode="add"/>}
        {showQuickOverwrite && !isDone && <QuickBtns task={task} mode="overwrite"/>}
      </div>
    );
  };

  const SectionHead = ({icon,title,count,color,done}) => (
    <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:10,paddingBottom:7,
      borderBottom:`2px solid ${color}44`}}>
      <span style={{fontSize:14}}>{icon}</span>
      <span style={{fontSize:12,fontWeight:800,color,fontFamily:"'Playfair Display',serif",flex:1}}>{title}</span>
      {done !== undefined
        ? <span style={{fontSize:10,color:C.textMuted,background:C.surfHov,padding:"1px 7px",borderRadius:8}}>{done}/{count}</span>
        : <span style={{fontSize:10,color:C.textMuted,background:C.surfHov,padding:"1px 7px",borderRadius:8}}>{count}</span>}
    </div>
  );

  const ProgressBar = ({value,color,height=5}) => (
    <div style={{background:C.bg,borderRadius:99,height,overflow:"hidden"}}>
      <div style={{width:`${value}%`,height:"100%",background:color,borderRadius:99,transition:"width .5s"}}/>
    </div>
  );

  const cardStyle = color => ({
    background:C.surface,borderRadius:12,padding:16,
    border:`1px solid ${color}33`,display:"flex",flexDirection:"column",
  });

  const onRSStartDB = useResizeHandler(onUpdate, PPM);

  const hDropDB = (e, relY) => {
    e.preventDefault(); setDropH(null);
    const totalMin = Math.floor(relY / PPM) + DAY_START * 60;
    const snapped  = Math.round(totalMin / 15) * 15;
    const clampMin = Math.max(DAY_START * 60, Math.min((DAY_END - 1) * 60, snapped));
    const hh = Math.floor(clampMin / 60);
    const mm = clampMin % 60;
    const st = `${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}`;
    const tid = e.dataTransfer?.getData("taskId")||e.dataTransfer?.getData("laterTaskId");
    const t   = tid ? all.find(x=>x.id===tid)||dragTask : dragTask;
    if (!t) return;
    const et = t.duration ? addDur(st, Number(t.duration)) : "";
    const newSessions = (t.sessions||[]).length > 0
      ? t.sessions.map((s,i) => i===0 ? {...s, date:today, startDate:today, startTime:st, endTime:et} : s)
      : [{id:"s_main", date:today, startDate:today, startTime:st, endTime:et}];
    onUpdate({...t, sessions:newSessions, startDate:"", startTime:"", endTime:"", isLater:false});
    setDragTask&&setDragTask(null);
  };

  // タイムライン変数をここで計算（インライン展開でstale closureを防ぐ）
  const now = new Date();
  const nowMin = now.getHours()*60+now.getMinutes();
  const tlH = (DAY_END-DAY_START)*HH;

  const pcTimelineJSX = (
    <div style={{flex:1,overflowY:"auto",position:"relative",marginBottom:6}}>
      {/* GCal終日・時間なしイベント */}
      {gcalAllDay.length > 0 && (
        <div style={{padding:"5px 8px",background:"#4285f420",borderRadius:7,border:"1px solid #4285f444",marginBottom:5}}>
          <div style={{fontSize:9,fontWeight:700,color:"#4285f4",marginBottom:3,letterSpacing:.4}}>📅 Googleカレンダー（終日）</div>
          {gcalAllDay.map(ev => (
            <div key={ev.id}
              onClick={()=>ev.htmlLink&&window.open(ev.htmlLink,"_blank")}
              style={{display:"flex",alignItems:"center",gap:5,padding:"2px 5px",
                borderLeft:"3px solid #4285f4",borderRadius:"0 4px 4px 0",
                marginBottom:2,background:"#4285f415",cursor:"pointer"}}>
              <span style={{fontSize:10,fontWeight:600,color:"#4285f4",flex:1,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{ev.title}</span>
              {ev.location&&<span style={{fontSize:8,color:"#4285f4",opacity:.7,flexShrink:0}}>📍</span>}
            </div>
          ))}
        </div>
      )}
      {normalUntimed.length > 0 && (
        <div style={{padding:"5px 8px",background:C.surface,borderRadius:7,border:`1px solid ${C.border}`,marginBottom:5}}>
          <div style={{fontSize:9,fontWeight:700,color:C.textMuted,marginBottom:3,textTransform:"uppercase",letterSpacing:.4}}>時間未定</div>
          {normalUntimed.map(t => {
            const c = tags.find(tg=>t.tags?.includes(tg.id))?.color||C.accent;
            const isDone = t.repeat&&parseRepeat(t.repeat).type!=="なし"?(t.doneDates||[]).includes(today):t.done;
            return (
              <div key={t.id}>
                <div onClick={e=>openPopup(e,t)}
                  style={{display:"flex",alignItems:"center",gap:5,padding:"2px 5px",
                    borderLeft:`3px solid ${isDone?C.textMuted:c}`,borderRadius:"0 4px 4px 0",
                    marginBottom:2,background:(isDone?C.textMuted:c)+"18",cursor:"pointer",opacity:isDone?.5:1}}>
                  <div onClick={e=>{e.stopPropagation();hToggle(t.id);}}
                    style={{width:16,height:16,borderRadius:3,border:`2px solid ${isDone?C.textMuted:c}`,
                      background:isDone?c:"transparent",flexShrink:0,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
                    {isDone&&<span style={{color:"#fff",fontSize:9,fontWeight:900}}>✓</span>}
                  </div>
                  <span style={{fontSize:10,fontWeight:600,color:isDone?C.textMuted:c,
                    textDecoration:isDone?"line-through":"none",flex:1,overflow:"hidden",
                    whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{t.title}</span>
                  {t.deadlineDate&&<span style={{fontSize:8,color:C.warn,marginLeft:"auto",flexShrink:0}}>⚠{fd(t.deadlineDate)}</span>}
                </div>
                {!isDone && !t.deadlineDate && <QuickBtns task={t} mode="overwrite"/>}
              </div>
            );
          })}
        </div>
      )}
      {deadlineUntimed.length > 0 && (
        <div style={{padding:"5px 8px",background:C.danger+"12",borderRadius:7,border:`1px solid ${C.danger}44`,marginBottom:5}}>
          <div style={{fontSize:9,fontWeight:700,color:C.danger,marginBottom:3,letterSpacing:.4}}>⚠ 締切（時間未定）</div>
          {deadlineUntimed.map(t => (
            <div key={"dl_"+t.id} onClick={e=>openPopup(e,t)}
              style={{display:"flex",alignItems:"center",gap:5,padding:"2px 5px",
                borderLeft:`3px solid ${t.done?C.textMuted:C.danger}`,borderRadius:"0 4px 4px 0",
                marginBottom:2,background:C.danger+(t.done?"0a":"22"),cursor:"pointer",opacity:t.done?.4:1}}>
              <span style={{fontSize:10,fontWeight:700,color:t.done?C.textMuted:C.danger,
                textDecoration:t.done?"line-through":"none",flex:1,overflow:"hidden",
                whiteSpace:"nowrap",textOverflow:"ellipsis"}}>⚠ {t.title}</span>
              <span style={{fontSize:8,color:t.done?C.textMuted:C.danger,marginLeft:"auto",flexShrink:0}}>{fd(t.deadlineDate)}</span>
            </div>
          ))}
        </div>
      )}
      <div style={{display:"grid",gridTemplateColumns:"26px 1fr",position:"relative",height:tlH+HH}}>
        <div style={{position:"relative"}}>
          {Array.from({length:DAY_END-DAY_START+1},(_,i)=>DAY_START+i).map(h=>(
            <div key={h} style={{position:"absolute",top:(h-DAY_START)*HH,right:3,fontSize:8,color:C.textMuted,lineHeight:1}}>{h}</div>
          ))}
        </div>
        <div style={{position:"relative",borderLeft:`1px solid ${C.border}44`}}
          onDragOver={e=>{e.preventDefault();const rect=e.currentTarget.getBoundingClientRect();const snapped=Math.round((Math.floor((e.clientY-rect.top)/PPM)+DAY_START*60)/15)*15;setDropH(Math.max(DAY_START*60,Math.min((DAY_END-1)*60,snapped)));}}
          onDragLeave={()=>setDropH(null)}
          onDrop={e=>{const rect=e.currentTarget.getBoundingClientRect();hDropDB(e,e.clientY-rect.top);}}
          onClick={e=>{if(e.target===e.currentTarget||e.target.dataset.bg){const rect=e.currentTarget.getBoundingClientRect();const h=Math.max(DAY_START,Math.min(DAY_END-1,Math.floor((e.clientY-rect.top)/HH)+DAY_START));onAdd&&onAdd(today,h);}}}>
          {Array.from({length:DAY_END-DAY_START},(_,i)=>(
            <div key={i} style={{position:"absolute",top:i*HH,left:0,right:0,height:HH,borderTop:`1px solid ${C.border}20`,pointerEvents:"none"}}/>
          ))}
          {timedWithCols.map(t => {
            const sm = t2m(t.startTime)||0;
            const em = t.endTime?t2m(t.endTime):sm+(Number(t.duration)||60);
            const c = tags.find(tg=>t.tags?.includes(tg.id))?.color||C.accent;
            const isDone = t.repeat&&parseRepeat(t.repeat).type!=="なし"?(t.doneDates||[]).includes(today):t.done;
            const col = t._col||0, totalCols = t._totalCols||1;
            return (
              <TimelineChip key={t._sessionId||t.id} task={t} tags={tags} color={c}
                startMin={sm} endMin={em} dayStartMin={dayStartMin} ppm={PPM}
                onPopup={openPopup} onToggle={hToggle} onUpdate={onUpdate}
                onRSStart={onRSStartDB} col={col} totalCols={totalCols} isDone={isDone}
                onQuickReschedule={(task,label)=>{
                  const found = quickDates().find(d=>d.label===label);
                  if (found) quickScheduleOverwrite(task, found.date);
                }}/>
            );
          })}
          {nowMin>=dayStartMin&&nowMin<=DAY_END*60&&(
            <div style={{position:"absolute",top:(nowMin-dayStartMin)*PPM,left:0,right:0,height:1.5,background:C.danger,zIndex:5,pointerEvents:"none"}}>
              <div style={{width:5,height:5,borderRadius:"50%",background:C.danger,position:"absolute",left:-2,top:-2}}/>
            </div>
          )}
          {dropH!==null && (
            <div style={{position:"absolute",top:(dropH-dayStartMin)*PPM,left:0,right:0,height:HH,
              background:C.accentS,border:`2px dashed ${C.accent}`,borderRadius:5,
              display:"flex",alignItems:"center",justifyContent:"center",
              fontSize:10,color:C.accent,pointerEvents:"none",zIndex:6}}>
              {`${String(Math.floor(dropH/60)).padStart(2,"0")}:${String(dropH%60).padStart(2,"0")}`}{dragTask?` ← ${dragTask.title}`:""}
            </div>
          )}
          {/* GCalタイムチップ（右側表示・Slateタスクと重ならないようoffset） */}
          {gcalTimed.map(ev => {
            const sm = t2m(ev.startTime)||0;
            const em = ev.endTime ? t2m(ev.endTime) : sm+60;
            if (sm < dayStartMin || sm > DAY_END*60) return null;
            const top = (sm - dayStartMin)*PPM_DB;
            const h   = Math.max(20,(em-sm)*PPM_DB);
            return (
              <div key={"gcal_"+ev.id}
                onClick={e=>{e.stopPropagation();ev.htmlLink&&window.open(ev.htmlLink,"_blank");}}
                title={`${ev.title}${ev.location?" 📍"+ev.location:""}`}
                style={{position:"absolute",top,right:0,width:"40%",height:h,
                  background:"#4285f428",borderLeft:"3px solid #4285f4",
                  borderRadius:"0 5px 5px 0",overflow:"hidden",zIndex:2,
                  cursor:"pointer",padding:"2px 4px",pointerEvents:"auto"}}>
                <div style={{fontSize:9,fontWeight:600,color:"#4285f4",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                  {ev.startTime} {ev.title}
                </div>
              </div>
            );
          })}
          {timedDeadlines.map(t => {
            const dm = t2m(t.deadlineTime);
            if (dm === null || dm < dayStartMin || dm > DAY_END*60) return null;
            const top = (dm - dayStartMin) * PPM;
            return (
              <div key={"dl_"+t.id} onClick={e=>{e.stopPropagation();openPopup(e,t);}}
                style={{position:"absolute",top:top-1,left:0,right:0,height:3,zIndex:4,cursor:"pointer",display:"flex",alignItems:"center",pointerEvents:"auto"}}
                title={`⚠ 締切: ${t.title} ${t.deadlineTime}`}>
                <div style={{position:"absolute",right:2,top:-8,background:C.danger,color:"#fff",fontSize:8,fontWeight:700,padding:"1px 5px",borderRadius:8,whiteSpace:"nowrap",pointerEvents:"none"}}>
                  ⚠ {t.deadlineTime} {t.title}
                </div>
                <div style={{width:"100%",height:3,background:`linear-gradient(90deg,${C.danger}00,${C.danger},${C.danger}00)`}}/>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  // GCal連携トグルUI（PC・スマホ共通パーツ）
  const GCalToggle = () => (
    <div style={{display:"flex",alignItems:"center",gap:6}}>
      <span style={{fontSize:10,color:"#4285f4",fontWeight:700}}>📅 GCal</span>
      {gcalError==="no_token" && (
        <span style={{fontSize:9,color:C.warn}}>⚠ 再ログインでカレンダーを読込</span>
      )}
      {!gcalError && gcalEvents && (
        <span style={{fontSize:9,color:"#4285f4"}}>{gcalEvents.length}件取得済</span>
      )}
    </div>
  );

  const popupLayerJSX = popup ? (
    <Popup
      task={(popup.taskId ? all.find(x=>x.id===popup.taskId) : null) || popup.task} tags={tags} anchor={{x:popup.x,y:popup.y}}
      viewDate={today}
      onClose={()=>setPopup(null)}
      onEdit={t=>{onEdit(t);setPopup(null);}}
      onToggle={hToggle}
      onDelete={id=>{if(onDelete){onDelete(id);}setPopup(null);}}
      onDuplicate={t=>{if(onDuplicate){onDuplicate(t);}setPopup(null);}}
      onSkip={onSkip||((id,d)=>{})}
      onOverride={onOverride||((id,d,ov)=>{})}
      onAddSession={onAddSession}
      onRemoveSession={onRemoveSession}
      onMemoToggle={onMemoToggle||((id,idx)=>{})}
    />
  ) : null;

  if (isPC) {
    return (
      <>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
        <GCalToggle/>
        <button onClick={()=>onAdd&&onAdd()}
          style={{display:"flex",alignItems:"center",gap:5,padding:"7px 16px",borderRadius:8,
            background:C.accent,color:"#fff",border:"none",cursor:"pointer",
            fontSize:12,fontWeight:700,boxShadow:`0 2px 8px ${C.accent}44`}}>
          ＋ タスクを追加
        </button>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:14}}>
        <div style={{background:C.surface,borderRadius:10,padding:"12px 16px",border:`1px solid ${C.accent}33`,display:"flex",alignItems:"center",gap:14}}>
          <div style={{fontSize:32,fontWeight:800,color:C.accent,fontFamily:"'Playfair Display',serif",lineHeight:1,flexShrink:0}}>
            {pct}<span style={{fontSize:14}}>%</span>
          </div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:10,color:C.textMuted,marginBottom:5}}>📊 全体進捗</div>
            <ProgressBar value={pct} color={C.accent} height={5}/>
            <div style={{fontSize:9,color:C.textMuted,marginTop:3}}>{doneCnt} / {totalCnt} 完了</div>
          </div>
        </div>
        <div style={{background:C.surface,borderRadius:10,padding:"12px 16px",border:`1px solid ${C.success}33`,display:"flex",alignItems:"center",gap:14}}>
          <div style={{fontSize:32,fontWeight:800,color:C.success,fontFamily:"'Playfair Display',serif",lineHeight:1,flexShrink:0}}>
            {todayTasks.length?Math.round(todayDone/todayTasks.length*100):0}<span style={{fontSize:14}}>%</span>
          </div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:10,color:C.textMuted,marginBottom:5}}>📅 今日の進捗</div>
            <ProgressBar value={todayTasks.length?Math.round(todayDone/todayTasks.length*100):0} color={C.success} height={5}/>
            <div style={{fontSize:9,color:C.textMuted,marginTop:3}}>{todayDone} / {todayTasks.length} 完了</div>
          </div>
        </div>
        <div style={{background:C.surface,borderRadius:10,padding:"12px 16px",border:`1px solid ${C.border}`,overflow:"hidden"}}>
          <div style={{fontSize:10,color:C.textMuted,fontWeight:700,marginBottom:7}}>🏷 タグ別進捗</div>
          {tagStats.length===0
            ? <div style={{fontSize:11,color:C.textMuted}}>タグなし</div>
            : tagStats.map(tag=>(
                <div key={tag.id} style={{marginBottom:6}}>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:10,marginBottom:2}}>
                    <span style={{color:tag.color,fontWeight:700}}>{tag.name}</span>
                    <span style={{color:C.textMuted}}>{tag.pct}%</span>
                  </div>
                  <ProgressBar value={tag.pct} color={tag.color} height={4}/>
                </div>
              ))}
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,height:"calc(100vh - 230px)",minHeight:300,alignItems:"start"}}>
        <div style={{...cardStyle(C.success),overflow:"hidden",height:"100%"}}>
          <SectionHead icon="📅" title="今日" count={todayTasks.length} done={todayDone} color={C.success}/>
          {todayTasks.length===0
            ? <div style={{textAlign:"center",padding:"32px 0",color:C.textMuted,fontSize:12}}>今日のタスクなし 🎉</div>
            : pcTimelineJSX}
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:12,height:"100%",overflow:"hidden"}}>
          {(overdue.length > 0 || overdueScheduled.length > 0) ? (
            <div style={{background:C.surface,borderRadius:12,padding:"10px 14px",border:`2px solid ${C.danger}55`,flexShrink:0,overflowY:"auto",maxHeight:"50%"}}>
              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}>
                <span style={{fontSize:14}}>📅</span>
                <span style={{fontSize:12,fontWeight:800,color:C.danger,fontFamily:"'Playfair Display',serif",flex:1}}>日程超過</span>
                <span style={{fontSize:10,color:C.textMuted,background:C.dangerS,padding:"1px 7px",borderRadius:8,fontWeight:700}}>{overdue.length + overdueScheduled.length}件</span>
              </div>
              {overdue.map(t=>(
                <div key={t.id} style={{background:C.danger+"0a",borderRadius:6,padding:"2px 6px",marginBottom:4}}>
                  <div style={{fontSize:8,color:C.danger,fontWeight:700,marginBottom:1}}>⚠ 締切超過</div>
                  <MiniRow task={t} showDate={true} draggable showQuick/>
                </div>
              ))}
              {overdueScheduled.map(t=><MiniRow key={t.id} task={t} showDate={true} draggable showQuick/>)}
            </div>
          ) : null}
          <div style={{...cardStyle(C.warn),overflow:"hidden",flex:1,minHeight:0}}>
            <SectionHead icon="📆" title="今後7日間" count={week7Tasks.length} color={C.warn}/>
            <div style={{flex:1,overflowY:"auto"}}>
              {week7Tasks.length===0
                ? <div style={{textAlign:"center",padding:"32px 0",color:C.textMuted,fontSize:12}}>今後7日の予定なし 🎉</div>
                : week7Tasks.map(t=><MiniRow key={t.id} task={t} showDate={true} week7Mode={true}/>)}
            </div>
          </div>
        </div>
        <div style={{...cardStyle(C.textMuted),overflow:"hidden",height:"100%"}}>
          <SectionHead icon="📌" title="あとでやる" count={laterTasks.length} color={C.textMuted}/>
          <div style={{flex:1,overflowY:"auto"}}>
            {laterTasks.length===0
              ? <div style={{textAlign:"center",padding:"32px 0",color:C.textMuted,fontSize:12}}>あとでやるなし</div>
              : laterTasks.map(t=><TaskRow key={t.id} task={t} tags={tags} onEdit={onEdit} onDelete={onDelete} onToggle={onToggle} onDuplicate={onDuplicate} onMemoToggle={onMemoToggle||((id,idx)=>{})}/>)}
          </div>
        </div>
      </div>
      {popupLayerJSX}
      </>
    );
  }

  return (
    <>
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <GCalToggle/>
        <button onClick={()=>onAdd&&onAdd()}
          style={{display:"flex",alignItems:"center",gap:5,padding:"7px 16px",borderRadius:8,
            background:C.accent,color:"#fff",border:"none",cursor:"pointer",fontSize:12,fontWeight:700}}>
          ＋ タスクを追加
        </button>
      </div>
      <div style={cardStyle(C.success)}>
        <SectionHead icon="📅" title="今日" count={todayTasks.length} done={todayDone} color={C.success}/>
        {todayTasks.length===0
          ? <div style={{fontSize:11,color:C.textMuted}}>今日のタスクなし 🎉</div>
          : todayTasks.map(t=><MiniRow key={t.id} task={t} showDate={false} showQuickOverwrite={!t.deadlineDate && !t._isDeadline}/>)}
      </div>
      {(overdue.length > 0 || overdueScheduled.length > 0) && (
        <div style={{background:C.surface,borderRadius:12,padding:"10px 14px",border:`2px solid ${C.danger}55`}}>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}>
            <span style={{fontSize:14}}>📅</span>
            <span style={{fontSize:12,fontWeight:800,color:C.danger,fontFamily:"'Playfair Display',serif",flex:1}}>日程超過</span>
            <span style={{fontSize:10,color:C.textMuted,background:C.dangerS,padding:"1px 7px",borderRadius:8,fontWeight:700}}>{overdue.length + overdueScheduled.length}件</span>
          </div>
          {overdue.map(t=>(
            <div key={t.id} style={{background:C.danger+"0a",borderRadius:6,padding:"2px 6px",marginBottom:4}}>
              <div style={{fontSize:8,color:C.danger,fontWeight:700,marginBottom:1}}>⚠ 締切超過</div>
              <MiniRow task={t} showDate={true} draggable showQuick/>
            </div>
          ))}
          {overdueScheduled.map(t=><MiniRow key={t.id} task={t} showDate={true} draggable showQuick/>)}
        </div>
      )}
      <div style={cardStyle(C.warn)}>
        <SectionHead icon="📆" title="今後7日間" count={week7Tasks.length} color={C.warn}/>
        {week7Tasks.map(t=><MiniRow key={t.id} task={t} showDate={true} week7Mode={true}/>)}
        {week7Tasks.length===0&&<div style={{fontSize:11,color:C.textMuted}}>今後7日の予定なし 🎉</div>}
      </div>
      <div style={cardStyle(C.textMuted)}>
        <SectionHead icon="📌" title="あとでやる" count={laterTasks.length} color={C.textMuted}/>
        {laterTasks.length===0
          ? <div style={{fontSize:11,color:C.textMuted}}>あとでやるなし</div>
          : laterTasks.map(t=><TaskRow key={t.id} task={t} tags={tags} onEdit={onEdit} onDelete={onDelete} onToggle={onToggle} onDuplicate={onDuplicate} onMemoToggle={onMemoToggle||((id,idx)=>{})}/>)}
      </div>
      <div style={cardStyle(C.accent)}>
        <div style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer"}} onClick={()=>setShowStats(v=>!v)}>
          <span style={{fontSize:28,fontWeight:800,color:C.accent,fontFamily:"'Playfair Display',serif",lineHeight:1}}>
            {pct}<span style={{fontSize:14}}>%</span>
          </span>
          <div style={{flex:1}}>
            <div style={{fontSize:10,color:C.textMuted}}>📊 全体進捗</div>
            <ProgressBar value={pct} color={C.accent} height={5}/>
            <div style={{fontSize:9,color:C.textMuted,marginTop:2}}>{doneCnt} / {totalCnt} 完了</div>
          </div>
          <span style={{fontSize:10,color:C.textMuted}}>{showStats?"▲":"▼"}</span>
        </div>
        {showStats&&tagStats.length>0&&(
          <div style={{marginTop:10}}>
            {tagStats.map(tag=>(
              <div key={tag.id} style={{marginBottom:8}}>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:10,marginBottom:2}}>
                  <span style={{color:tag.color,fontWeight:700}}>{tag.name}</span>
                  <span style={{color:C.textMuted}}>{tag.pct}%</span>
                </div>
                <ProgressBar value={tag.pct} color={tag.color} height={4}/>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
    {popupLayerJSX}
    </>
  );
};
