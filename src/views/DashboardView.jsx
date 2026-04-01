import { useState, useMemo } from "react";
import { C } from "../constants";
import { flatten, fd, sameDay, parseRepeat, matchesRepeat, isLaterTask, localDate, t2m, addDur, getTasksForDate, getDeadlineTasksForDate, useIsPC, useResizeHandler } from "../utils";
import { TimelineChip } from "./ListView";
import { Popup } from "../components/Popup";

export const DashboardView = ({tasks,tags,today,onToggle,onEdit,onDelete,onDuplicate,onSkip,onOverride,onAddSession,onRemoveSession,onMemoToggle,onAdd,onUpdate,dragTask,setDragTask}) => {
  const isPC = useIsPC();
  const [popup, setPopup] = useState(null);
  const [dropH, setDropH] = useState(null);
  const [focusOpen, setFocusOpen] = useState(true);

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
  const overdue  = nonRep.filter(t => t.deadlineDate && !t.done && t.deadlineDate < today)
                         .sort((a,b) => a.deadlineDate.localeCompare(b.deadlineDate));
  // 日時枠が今日より前にある未完了タスク（締切なし・締切は overdue に含める）
  const overdueScheduled = nonRep.filter(t => {
    if (t.done || t.deadlineDate) return false; // 締切あるものは overdue で扱う
    return (t.sessions||[]).some(s => {
      const sd = s.startDate || s.date || "";
      return sd && sd < today;
    });
  }).sort((a,b) => {
    const as = a.sessions?.[0]?.startDate || a.sessions?.[0]?.date || "";
    const bs = b.sessions?.[0]?.startDate || b.sessions?.[0]?.date || "";
    return as.localeCompare(bs);
  });
  const upcoming = nonRep.filter(t => t.deadlineDate && !t.done && t.deadlineDate >= today && t.deadlineDate <= in7)
                         .sort((a,b) => a.deadlineDate.localeCompare(b.deadlineDate));
  const startingIn7 = nonRep.filter(t => {
    const d = t.sessions?.[0]?.startDate || t.sessions?.[0]?.date;
    return d && d > today && d <= in7 && !t.done && !t.deadlineDate;
  }).sort((a,b) => (a.sessions?.[0]?.startDate||a.sessions?.[0]?.date||"").localeCompare(b.sessions?.[0]?.startDate||b.sessions?.[0]?.date||""));
  const week7 = [...overdue, ...upcoming, ...startingIn7];

  const laterTasks = all.filter(t => (t.isLater || isLaterTask(t)) && !t.done);

  // 親タグのみ表示
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
    setPopup({task, x: Math.min(r.right+8, window.innerWidth-308), y: Math.min(r.top, window.innerHeight-420)});
  };
  const hToggle = (id) => {
    const t = all.find(x=>x.id===id);
    const isRep = t?.repeat && parseRepeat(t.repeat).type !== "なし";
    onToggle(id, isRep ? today : undefined);
  };

  // タイムライン定数
  const DAY_START = 6, DAY_END = 23, PPM = 0.75;
  const HH = 60 * PPM;
  const dayStartMin = DAY_START * 60;

  const hDrop = (e, relY) => {
    e.preventDefault(); setDropH(null);
    const totalMin = Math.floor(relY / PPM) + DAY_START * 60;
    const snapped  = Math.round(totalMin / 15) * 15;
    const clampMin = Math.max(DAY_START * 60, Math.min((DAY_END - 1) * 60, snapped));
    const hh = Math.floor(clampMin / 60);
    const mm = clampMin % 60;
    const st = `${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}`;
    const tid = e.dataTransfer?.getData("taskId")||e.dataTransfer?.getData("laterTaskId");
    const t   = tid ? all.find(x=>x.id===tid)||dragTask : dragTask;
    if (!t) { onAdd&&onAdd(today, hh); return; }
    const et = t.duration ? addDur(st, Number(t.duration)) : "";
    const newSessions = (t.sessions||[]).length > 0
      ? t.sessions.map((s,i) => i===0 ? {...s, date:today, startDate:today, startTime:st, endTime:et} : s)
      : [{id:"s_main", date:today, startDate:today, startTime:st, endTime:et}];
    onUpdate({...t, sessions:newSessions, startDate:"", startTime:"", endTime:"", isLater:false});
    setDragTask&&setDragTask(null);
  };

  // タイムライン: DayViewと同じくgetTasksForDateから取得
  const tlTasks       = useMemo(() => getTasksForDate(tasks, today), [tasks, today]);
  const deadlineTasks = useMemo(() => getDeadlineTasksForDate(tasks, today), [tasks, today]);
  const timedTasks     = tlTasks.filter(t => t.startTime);
  const untimedTasks   = tlTasks.filter(t => !t.startTime);
  const normalUntimed  = untimedTasks.filter(t => !t._isDeadline);
  const deadlineUntimed = [
    ...untimedTasks.filter(t => t._isDeadline),
    ...deadlineTasks.filter(t => !t.deadlineTime && !tlTasks.some(s => s.id === t.id)),
  ];
  const timedDeadlines = deadlineTasks.filter(t => !!t.deadlineTime);

  // DayViewと同じ方式: 時間 or 表示が重なるチップを横分割
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

  const MiniRow = ({task, showDate, draggable: isDraggable}) => {
    const c = tags.find(tg => task.tags?.includes(tg.id))?.color || C.accent;
    const childTag = tags.find(tg => task.tags?.includes(tg.id) && tg.parentId);
    const isOver = task.deadlineDate && task.deadlineDate < today && !task.done;
    const isDone = task.repeat && parseRepeat(task.repeat).type !== "なし"
      ? (task.doneDates||[]).includes(today)
      : task.done;
    return (
      <div style={{display:"flex",alignItems:"center",gap:7,padding:"5px 0",
        borderBottom:`1px solid ${C.border}18`,cursor:isDraggable?"grab":"pointer",opacity:isDone?.55:1}}
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
        {showDate && task.deadlineDate &&
          <span style={{fontSize:9,color:isOver?C.danger:C.warn,flexShrink:0,fontWeight:isOver?700:400}}>
            {isOver?"⚠ ":""}{fd(task.deadlineDate)}
          </span>}
        {showDate && !task.deadlineDate && task.sessions?.[0]?.date &&
          <span style={{fontSize:9,color:C.accent,flexShrink:0}}>{fd(task.sessions[0].date)}〜</span>}
      </div>
    );
  };

  // ── 今日フォーカス用ヘルパー ──────────────────────────────────
  const addDaysStr = (base, n) => { const d = new Date(base); d.setDate(d.getDate()+n); return localDate(d); };
  const nextMonday = (base) => { const d = new Date(base); const dow = d.getDay(); d.setDate(d.getDate()+(dow===0?1:8-dow)); return localDate(d); };

  const focusTasks = (() => {
    const seen = new Set();
    const add = t => { if(!seen.has(t.id)){seen.add(t.id);return true;} return false; };
    return [
      ...overdue.filter(add),
      ...overdueScheduled.filter(add),
      ...nonRep.filter(t => !seen.has(t.id)&&!t.done&&sameDay(t.deadlineDate,today)).filter(add),
      ...nonRep.filter(t => !seen.has(t.id)&&!t.done&&(t.sessions||[]).some(s=>sameDay(s.startDate||s.date,today))).filter(add),
    ];
  })();

  const FocusRow = ({task}) => {
    const isDone = task.done;
    const isOver = task.deadlineDate && task.deadlineDate < today;
    return (
      <div style={{display:"flex",alignItems:"center",gap:6,padding:"6px 0",borderBottom:`1px solid ${C.border}22`}}>
        <div onClick={e=>{e.stopPropagation();hToggle(task.id);}}
          style={{width:13,height:13,borderRadius:3,border:`2px solid ${isDone?C.accent:C.border}`,
            background:isDone?C.accent:"transparent",flexShrink:0,cursor:"pointer",
            display:"flex",alignItems:"center",justifyContent:"center"}}>
          {isDone && <span style={{color:"#fff",fontSize:7,fontWeight:900}}>✓</span>}
        </div>
        <span onClick={e=>openPopup(e,task)}
          style={{fontSize:11,color:isDone?C.textMuted:C.text,flex:1,overflow:"hidden",
            whiteSpace:"nowrap",textOverflow:"ellipsis",cursor:"pointer",
            textDecoration:isDone?"line-through":"none"}}>
          {isOver&&<span style={{color:C.danger,marginRight:3}}>⚠</span>}
          {task.title}
        </span>
        {!isDone && onUpdate && (
          <div style={{display:"flex",gap:2,flexShrink:0}}>
            {[
              {label:"明日", date:addDaysStr(today,1), color:C.accent},
              {label:"来週", date:nextMonday(today), color:C.textMuted},
            ].map(({label,date,color})=>(
              <button key={label} onClick={()=>{
                const newSessions = (task.sessions||[]).length>0
                  ? task.sessions.map((s,i)=>i===0?{...s,startDate:date,date,startTime:s.startTime||"",endTime:s.endTime||""}:s)
                  : [{id:"s_main",startDate:date,date,startTime:"",endTime:""}];
                onUpdate({...task,sessions:newSessions,deadlineDate:task.deadlineDate||"",startDate:"",startTime:"",endTime:"",isLater:false});
              }}
                style={{fontSize:8,padding:"2px 5px",borderRadius:6,border:`1px solid ${color}44`,
                  background:color+"15",color,cursor:"pointer",fontWeight:600,lineHeight:1.3}}>
                {label}→
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  const TodayFocusCard = () => (
    <div style={{background:C.surface,borderRadius:12,padding:"10px 14px",border:`1px solid ${C.accent}44`,marginBottom:12}}>
      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:focusOpen?8:0,cursor:"pointer"}} onClick={()=>setFocusOpen(v=>!v)}>
        <span style={{fontSize:14}}>🎯</span>
        <span style={{fontSize:12,fontWeight:800,color:C.accent,fontFamily:"'Playfair Display',serif",flex:1}}>今日やること</span>
        <span style={{fontSize:10,color:C.textMuted,background:C.accentS,padding:"1px 7px",borderRadius:8,fontWeight:700}}>
          {focusTasks.filter(t=>!t.done).length}件
        </span>
        <span style={{fontSize:10,color:C.textMuted}}>{focusOpen?"▲":"▼"}</span>
      </div>
      {focusOpen && (
        focusTasks.length===0
          ? <div style={{fontSize:11,color:C.textMuted,padding:"8px 0"}}>今日やることなし 🎉</div>
          : focusTasks.map(t=><FocusRow key={t.id} task={t}/>)
      )}
    </div>
  );

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

  // PCタイムライン
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

  const PCTimeline = () => {
    const now = new Date();
    const nowMin = now.getHours()*60+now.getMinutes();
    const tlH = (DAY_END-DAY_START)*HH;
    return (
      <div style={{flex:1,overflowY:"auto",position:"relative",marginBottom:6}}>
        {/* 時間未定欄（DayViewと同じ方式） */}
        {normalUntimed.length > 0 && (
          <div style={{padding:"5px 8px",background:C.surface,borderRadius:7,border:`1px solid ${C.border}`,marginBottom:5}}>
            <div style={{fontSize:9,fontWeight:700,color:C.textMuted,marginBottom:3,textTransform:"uppercase",letterSpacing:.4}}>時間未定</div>
            {normalUntimed.map(t => {
              const c = tags.find(tg=>t.tags?.includes(tg.id))?.color||C.accent;
              const isDone = t.repeat&&parseRepeat(t.repeat).type!=="なし"?(t.doneDates||[]).includes(today):t.done;
              return (
                <div key={t.id} onClick={e=>openPopup(e,t)}
                  style={{display:"flex",alignItems:"center",gap:5,padding:"2px 5px",
                    borderLeft:`3px solid ${isDone?C.textMuted:c}`,borderRadius:"0 4px 4px 0",
                    marginBottom:2,background:(isDone?C.textMuted:c)+"18",cursor:"pointer",opacity:isDone?.5:1}}>
                  <div onClick={e=>{e.stopPropagation();hToggle(t.id);}}
                    style={{width:7,height:7,borderRadius:1.5,border:`1.5px solid ${isDone?C.textMuted:c}`,
                      background:isDone?c:"transparent",flexShrink:0,cursor:"pointer"}}/>
                  <span style={{fontSize:10,fontWeight:600,color:isDone?C.textMuted:c,
                    textDecoration:isDone?"line-through":"none",flex:1,overflow:"hidden",
                    whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{t.title}</span>
                  {t.deadlineDate&&<span style={{fontSize:8,color:C.warn,marginLeft:"auto",flexShrink:0}}>⚠{fd(t.deadlineDate)}</span>}
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
          {/* 時間軸 */}
          <div style={{position:"relative"}}>
            {Array.from({length:DAY_END-DAY_START+1},(_,i)=>DAY_START+i).map(h=>(
              <div key={h} style={{position:"absolute",top:(h-DAY_START)*HH,right:3,fontSize:8,color:C.textMuted,lineHeight:1}}>
                {h}
              </div>
            ))}
          </div>
          {/* チップエリア（ドロップゾーン） */}
          <div style={{position:"relative",borderLeft:`1px solid ${C.border}44`}}
            onDragOver={e=>{e.preventDefault();const rect=e.currentTarget.getBoundingClientRect();const snapped=Math.round((Math.floor((e.clientY-rect.top)/PPM)+DAY_START*60)/15)*15;setDropH(Math.max(DAY_START*60,Math.min((DAY_END-1)*60,snapped)));}}
            onDragLeave={()=>setDropH(null)}
            onDrop={e=>{const rect=e.currentTarget.getBoundingClientRect();hDropDB(e,e.clientY-rect.top);}}
            onClick={e=>{if(e.target===e.currentTarget||e.target.dataset.bg){const rect=e.currentTarget.getBoundingClientRect();const h=Math.max(DAY_START,Math.min(DAY_END-1,Math.floor((e.clientY-rect.top)/HH)+DAY_START));onAdd&&onAdd(today,h);}}}>
            {Array.from({length:DAY_END-DAY_START},(_,i)=>(
              <div key={i} style={{position:"absolute",top:i*HH,left:0,right:0,height:HH,borderTop:`1px solid ${C.border}20`}}/>
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
                  onRSStart={onRSStartDB} col={col} totalCols={totalCols} isDone={isDone}/>
              );
            })}
            {nowMin>=dayStartMin&&nowMin<=DAY_END*60&&(
              <div style={{position:"absolute",top:(nowMin-dayStartMin)*PPM,left:0,right:0,
                height:1.5,background:C.danger,zIndex:5,pointerEvents:"none"}}>
                <div style={{width:5,height:5,borderRadius:"50%",background:C.danger,
                  position:"absolute",left:-2,top:-2}}/>
              </div>
            )}
            {/* ドロップ位置インジケーター */}
            {dropH!==null && (
              <div style={{position:"absolute",top:(dropH-dayStartMin)*PPM,left:0,right:0,height:HH,
                background:C.accentS,border:`2px dashed ${C.accent}`,borderRadius:5,
                display:"flex",alignItems:"center",justifyContent:"center",
                fontSize:10,color:C.accent,pointerEvents:"none",zIndex:6}}>
                {`${String(Math.floor(dropH/60)).padStart(2,"0")}:${String(dropH%60).padStart(2,"0")}`}{dragTask?` ← ${dragTask.title}`:""}
              </div>
            )}
            {/* 締切ライン */}
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
  };

  const PopupLayer = () => popup ? (
    <Popup
      task={popup.task} tags={tags} anchor={{x:popup.x,y:popup.y}}
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
      {/* ── 追加ボタン ── */}
      <div style={{display:"flex",justifyContent:"flex-end",marginBottom:10}}>
        <button onClick={()=>onAdd&&onAdd()}
          style={{display:"flex",alignItems:"center",gap:5,padding:"7px 16px",borderRadius:8,
            background:C.accent,color:"#fff",border:"none",cursor:"pointer",
            fontSize:12,fontWeight:700,boxShadow:`0 2px 8px ${C.accent}44`}}>
          ＋ タスクを追加
        </button>
      </div>
      {/* ── 上段: 進捗サマリー ── */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:14}}>
        {/* 全体進捗 */}
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
        {/* 今日の進捗 */}
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
        {/* タグ別進捗 */}
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
      {/* ── 下段: タスク一覧（左:タイムライン / 中:要対応+今後7日 / 右:あとでやる） ── */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,
        height:"calc(100vh - 230px)",minHeight:300,alignItems:"start"}}>
        {/* 左: 今日（タイムライン） */}
        <div style={{...cardStyle(C.success),overflow:"hidden",height:"100%"}}>
          <SectionHead icon="📅" title="今日" count={todayTasks.length} done={todayDone} color={C.success}/>
          {todayTasks.length===0
            ? <div style={{textAlign:"center",padding:"32px 0",color:C.textMuted,fontSize:12}}>今日のタスクなし 🎉</div>
            : <PCTimeline/>}
        </div>
        {/* 中: 要対応（上）＋ 今後7日間（下） */}
        <div style={{display:"flex",flexDirection:"column",gap:12,height:"100%",overflow:"hidden"}}>
          {/* 要対応 */}
          {(overdue.length > 0 || overdueScheduled.length > 0) ? (
            <div style={{background:C.surface,borderRadius:12,padding:"10px 14px",border:`2px solid ${C.danger}55`,flexShrink:0,overflowY:"auto",maxHeight:"50%"}}>
              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}>
                <span style={{fontSize:14}}>🔥</span>
                <span style={{fontSize:12,fontWeight:800,color:C.danger,fontFamily:"'Playfair Display',serif",flex:1}}>要対応</span>
                <span style={{fontSize:10,color:C.textMuted,background:C.dangerS,padding:"1px 7px",borderRadius:8,fontWeight:700}}>{overdue.length + overdueScheduled.length}件</span>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                {overdue.length>0&&(
                  <div>
                    <div style={{fontSize:9,fontWeight:700,color:C.danger,marginBottom:5,textTransform:"uppercase",letterSpacing:.4}}>⚠ 締切超過</div>
                    {overdue.map(t=><MiniRow key={t.id} task={t} showDate={true} draggable/>)}
                  </div>
                )}
                {overdueScheduled.length>0&&(
                  <div>
                    <div style={{fontSize:9,fontWeight:700,color:C.warn,marginBottom:5,textTransform:"uppercase",letterSpacing:.4}}>📅 日程超過</div>
                    {overdueScheduled.map(t=><MiniRow key={t.id} task={t} showDate={true} draggable/>)}
                  </div>
                )}
              </div>
            </div>
          ) : null}
          {/* 今後7日間 */}
          <div style={{...cardStyle(C.warn),overflow:"hidden",flex:1,minHeight:0}}>
            <SectionHead icon="📆" title="今後7日間" count={week7.length} color={C.warn}/>
            <div style={{flex:1,overflowY:"auto"}}>
              {upcoming.length===0&&startingIn7.length===0&&overdue.length===0
                ? <div style={{textAlign:"center",padding:"32px 0",color:C.textMuted,fontSize:12}}>今後7日の予定なし 🎉</div>
                : <>{upcoming.map(t=><MiniRow key={t.id} task={t} showDate={true}/>)}
                    {startingIn7.length>0&&(<div style={{marginTop:8}}>
                      <div style={{fontSize:9,color:C.textMuted,fontWeight:700,textTransform:"uppercase",letterSpacing:.5,marginBottom:5,paddingTop:4,borderTop:`1px solid ${C.border}33`}}>開始予定</div>
                      {startingIn7.map(t=><MiniRow key={t.id} task={t} showDate={true}/>)}
                    </div>)}</>}
            </div>
          </div>
        </div>
        {/* 右: 今日フォーカス + あとでやる */}
        <div style={{display:"flex",flexDirection:"column",gap:12,height:"100%",overflow:"hidden"}}>
        <TodayFocusCard/>
        <div style={{...cardStyle(C.textMuted),overflow:"hidden",flex:1}}>
          <SectionHead icon="📌" title="あとでやる" count={laterTasks.length} color={C.textMuted}/>
          <div style={{flex:1,overflowY:"auto"}}>
            {laterTasks.length===0
              ? <div style={{textAlign:"center",padding:"32px 0",color:C.textMuted,fontSize:12}}>あとでやるなし</div>
              : laterTasks.map(t=><MiniRow key={t.id} task={t} showDate={true} draggable/>)}
          </div>
        </div>
        </div>
      </div>
      <PopupLayer/>
      </>
    );
  }

  // スマホ: リスト表示（今日→要対応→今後7日間→あとでやる→進捗関連）
  return (
    <>
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      <div style={{display:"flex",justifyContent:"flex-end"}}>
        <button onClick={()=>onAdd&&onAdd()}
          style={{display:"flex",alignItems:"center",gap:5,padding:"7px 16px",borderRadius:8,
            background:C.accent,color:"#fff",border:"none",cursor:"pointer",
            fontSize:12,fontWeight:700}}>
          ＋ タスクを追加
        </button>
      </div>
      {/* 今日 */}
      <div style={cardStyle(C.success)}>
        <SectionHead icon="📅" title="今日" count={todayTasks.length} done={todayDone} color={C.success}/>
        {todayTasks.length===0
          ? <div style={{fontSize:11,color:C.textMuted}}>今日のタスクなし 🎉</div>
          : todayTasks.map(t=><MiniRow key={t.id} task={t} showDate={false}/>)}
      </div>
      {/* 要対応 */}
      {(overdue.length > 0 || overdueScheduled.length > 0) && (
        <div style={{background:C.surface,borderRadius:12,padding:"10px 14px",border:`2px solid ${C.danger}55`}}>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}>
            <span style={{fontSize:14}}>🔥</span>
            <span style={{fontSize:12,fontWeight:800,color:C.danger,fontFamily:"'Playfair Display',serif",flex:1}}>要対応</span>
            <span style={{fontSize:10,color:C.textMuted,background:C.dangerS,padding:"1px 7px",borderRadius:8,fontWeight:700}}>{overdue.length + overdueScheduled.length}件</span>
          </div>
          {overdue.length>0&&(
            <div style={{marginBottom:6}}>
              <div style={{fontSize:9,fontWeight:700,color:C.danger,marginBottom:4,textTransform:"uppercase",letterSpacing:.4}}>⚠ 締切超過</div>
              {overdue.map(t=><MiniRow key={t.id} task={t} showDate={true} draggable/>)}
            </div>
          )}
          {overdueScheduled.length>0&&(
            <div>
              <div style={{fontSize:9,fontWeight:700,color:C.warn,marginBottom:4,textTransform:"uppercase",letterSpacing:.4}}>📅 日程超過</div>
              {overdueScheduled.map(t=><MiniRow key={t.id} task={t} showDate={true} draggable/>)}
            </div>
          )}
        </div>
      )}
      {/* 今後7日間 */}
      <div style={cardStyle(C.warn)}>
        <SectionHead icon="📆" title="今後7日間" count={week7.length} color={C.warn}/>
        {upcoming.map(t=><MiniRow key={t.id} task={t} showDate={true}/>)}
        {startingIn7.length>0&&(<div style={{marginTop:8}}>
          <div style={{fontSize:9,color:C.textMuted,fontWeight:700,textTransform:"uppercase",letterSpacing:.5,marginBottom:5,paddingTop:4,borderTop:`1px solid ${C.border}33`}}>開始予定</div>
          {startingIn7.map(t=><MiniRow key={t.id} task={t} showDate={true}/>)}
        </div>)}
        {week7.length===0&&<div style={{fontSize:11,color:C.textMuted}}>今後7日の予定なし 🎉</div>}
      </div>
      {/* 今日フォーカス */}
      <TodayFocusCard/>
      {/* あとでやる */}
      <div style={cardStyle(C.textMuted)}>
        <SectionHead icon="📌" title="あとでやる" count={laterTasks.length} color={C.textMuted}/>
        {laterTasks.length===0
          ? <div style={{fontSize:11,color:C.textMuted}}>あとでやるなし</div>
          : laterTasks.map(t=><MiniRow key={t.id} task={t} showDate={true} draggable/>)}
      </div>
      {/* 進捗関連（折りたたみ） */}
      <div style={cardStyle(C.accent)}>
        <div style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer"}} onClick={()=>setFocusOpen(v=>!v)}>
          <span style={{fontSize:28,fontWeight:800,color:C.accent,fontFamily:"'Playfair Display',serif",lineHeight:1}}>
            {pct}<span style={{fontSize:14}}>%</span>
          </span>
          <div style={{flex:1}}>
            <div style={{fontSize:10,color:C.textMuted}}>📊 全体進捗</div>
            <ProgressBar value={pct} color={C.accent} height={5}/>
            <div style={{fontSize:9,color:C.textMuted,marginTop:2}}>{doneCnt} / {totalCnt} 完了</div>
          </div>
          <span style={{fontSize:10,color:C.textMuted}}>{focusOpen?"▲":"▼"}</span>
        </div>
        {/* NOTE: 進捗詳細は折りたたみ対象 — 表示したい場合は !focusOpen を focusOpen に変更 */}
        {!focusOpen&&tagStats.length>0&&(
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
    <PopupLayer/>
    </>
  );
};
