import { useState, useEffect, useRef, useMemo } from "react";
import { C } from "../constants";
import { localDate, flatten, fd, sameDay, t2m, addDur, parseRepeat, getTasksForDate, getDeadlineTasksForDate, toggleMemo, fetchHolidays, holName, isRed, useResizeHandler } from "../utils";
import { getGCalEventsForDate } from "../gcal";
import { Popup } from "../components/Popup";
import { TimelineChip } from "./ListView";

export const DayView = ({tasks,tags,today,onUpdate,onAdd,onToggle,onEdit,onDelete,onDuplicate,onSkip,onOverride,onAddSession,onRemoveSession,dragTask,setDragTask,gcalEvents}) => {
  const DAY_START = 6;
  const DAY_END   = 23;
  const PPM       = 0.85;
  const HH        = 60 * PPM;
  const [popup, setPopup]   = useState(null);
  const [dropH, setDropH]   = useState(null);
  const [holReady, setHolReady] = useState(false);
  const [dayOffset, setDayOffset] = useState(0);

  const viewDate = useMemo(() => { const d=new Date(today); d.setDate(d.getDate()+dayOffset); return localDate(d); }, [today, dayOffset]);
  const isToday  = dayOffset === 0;

  const all = flatten(tasks);

  useEffect(() => { fetchHolidays(viewDate.slice(0,4)).then(()=>setHolReady(true)); }, [viewDate]);

  const startTasks    = useMemo(() => getTasksForDate(tasks, viewDate), [tasks, viewDate]);
  // GCalイベント（メモリキャッシュから。Firestoreに書かない）
  const gcalForDate   = useMemo(() => getGCalEventsForDate(gcalEvents, viewDate), [gcalEvents, viewDate]);
  const gcalTimed     = gcalForDate.filter(ev => ev.startTime && !ev.isAllDay);
  const gcalAllDay    = gcalForDate.filter(ev => ev.isAllDay || !ev.startTime);
  const deadlineTasks = useMemo(() => getDeadlineTasksForDate(tasks, viewDate), [tasks, viewDate]);
  const todayT = startTasks;
  // ① 繰り返し・通常タスク：startTimeなしでも「時間未定」欄に表示
  const timed   = todayT.filter(t => t.startTime);
  const untimed = [
    ...todayT.filter(t => !t.startTime),
    // 締切タスクは未完了なら日時枠の有無に関わらず常に表示
    ...deadlineTasks.filter(t => !t.deadlineTime),
  ];
  // ⑦ 締切ライン：deadlineTimeあり
  const timedDeadlines = deadlineTasks.filter(t => !!t.deadlineTime);

  const hp = (e,task,vd) => { const r=e.currentTarget.getBoundingClientRect(); setPopup({task,taskId:task.id,x:Math.min(r.right+8,window.innerWidth-308),y:Math.min(r.top,window.innerHeight-350),viewDate:vd||viewDate}); };
  const hMemo = (id,idx) => { const t=all.find(x=>x.id===id); if(t)onUpdate({...t,memo:toggleMemo(t.memo,idx)}); setPopup(p=>p?{...p,task:{...p.task,memo:toggleMemo(p.task.memo,idx)}}:null); };
  const hToggle = (id) => {
    if (typeof id === "string" && id.includes("_ov_")) {
      const [baseId, origDate] = id.split("_ov_");
      onToggle(baseId, origDate);
      return;
    }
    const t=all.find(x=>x.id===id); const isRep=t?.repeat&&parseRepeat(t.repeat).type!=="なし"; onToggle(id, isRep?viewDate:undefined);
  };

  const { onRSStart, rsPreview } = useResizeHandler(onUpdate, PPM);

  const hDrop = (e, relY) => {
    e.preventDefault(); setDropH(null);
    const totalMin = Math.floor(relY / PPM) + DAY_START * 60;
    const snapped  = Math.round(totalMin / 15) * 15;
    const clampMin = Math.max(DAY_START * 60, Math.min((DAY_END - 1) * 60, snapped));
    const hh = Math.floor(clampMin / 60);
    const mm = clampMin % 60;
    const st = `${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}`;
    const tid = e.dataTransfer.getData("taskId")||e.dataTransfer.getData("laterTaskId");
    const t   = tid ? all.find(x=>x.id===tid)||dragTask : dragTask;
    if (!t) return;
    const et = t.duration ? addDur(st, Number(t.duration)) : "";
    const newSessions = (t.sessions||[]).length > 0
      ? t.sessions.map((s,i) => i===0 ? {...s, date:viewDate, startDate:viewDate, startTime:st, endTime:et} : s)
      : [{id:"s_main", date:viewDate, startDate:viewDate, startTime:st, endTime:et}];
    onUpdate({...t, sessions:newSessions, startDate:"", startTime:"", endTime:"", isLater:false});
    setDragTask(null);
  };

  const now     = new Date();
  const dayStartMin = DAY_START * 60;
  const totalH  = (DAY_END - DAY_START) * HH;

  const viewDt = new Date(viewDate);
  const DAYS_JP2 = ["日","月","火","水","木","金","土"];
  const viewDow = DAYS_JP2[viewDt.getDay()];
  const isSat2 = viewDt.getDay()===6;
  const isRed2 = isRed(viewDate);
  const hName2 = holName(viewDate);
  const viewLabel = `${viewDate.slice(5).replace("-","/")}（${viewDow}）${hName2?" 🎌"+hName2:""}`;
  const dowColor = isSat2?C.info:isRed2||hName2?C.danger:C.text;

  return (
    <div>
      <div style={{position:"sticky",top:0,zIndex:20,background:C.bg,paddingBottom:4,marginBottom:0}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:10,marginBottom:8,padding:"5px 0"}}>
        <button onClick={()=>setDayOffset(o=>o-1)}
          style={{background:C.surfHov,color:C.text,border:`1px solid ${C.border}`,borderRadius:8,width:32,height:32,fontSize:16,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
          ‹
        </button>
        <div style={{minWidth:160,textAlign:"center"}}>
          <div style={{fontSize:13,fontWeight:700,color:dowColor,fontFamily:"'Playfair Display',serif"}}>{viewLabel}</div>
          {!isToday && (
            <button onClick={()=>setDayOffset(0)}
              style={{fontSize:9,color:C.accent,background:C.accentS,border:`1px solid ${C.accent}33`,borderRadius:10,padding:"1px 8px",cursor:"pointer",marginTop:2}}>
              今日に戻る
            </button>
          )}
          {isToday && <div style={{fontSize:9,color:C.accent,marginTop:1}}>今日</div>}
        </div>
        <button onClick={()=>setDayOffset(o=>o+1)}
          style={{background:C.surfHov,color:C.text,border:`1px solid ${C.border}`,borderRadius:8,width:32,height:32,fontSize:16,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
          ›
        </button>
      </div>
      </div>

      {/* GCal終日・時間なしイベント */}
      {gcalAllDay.length > 0 && (
        <div style={{padding:"5px 8px",background:"#4285f422",borderRadius:7,border:"1px solid #4285f444",marginBottom:4}}>
          <div style={{fontSize:9,fontWeight:700,color:"#4285f4",marginBottom:3,letterSpacing:.4}}>📅 Googleカレンダー</div>
          {gcalAllDay.map(ev => (
            <div key={ev.id}
              onClick={()=>window.open(ev.htmlLink,"_blank")}
              style={{display:"flex",alignItems:"center",gap:5,padding:"2px 5px",
                borderLeft:"3px solid #4285f4",borderRadius:"0 4px 4px 0",
                marginBottom:2,background:"#4285f415",cursor:"pointer"}}>
              <span style={{fontSize:10,fontWeight:600,color:"#4285f4",flex:1,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{ev.title}</span>
              {ev.location && <span style={{fontSize:8,color:"#4285f4",opacity:.7,flexShrink:0}}>📍</span>}
            </div>
          ))}
        </div>
      )}
      {(() => {
        const normalUntimed = untimed.filter(t => !t._isDeadline);
        const deadlineUntimed = untimed.filter(t => t._isDeadline);
        return (
          <>
            {normalUntimed.length > 0 && (
              <div style={{padding:"6px 9px",background:C.surface,borderRadius:8,border:`1px solid ${C.border}`,marginBottom:4}}>
                <div style={{fontSize:9,fontWeight:700,color:C.textMuted,marginBottom:4,textTransform:"uppercase",letterSpacing:.4}}>時間未定</div>
                {normalUntimed.map(t => {
                  const c = tags.find(tg=>t.tags?.includes(tg.id))?.color||C.accent;
                  const isDone = t.repeat && parseRepeat(t.repeat).type !== "なし" ? (t.doneDates||[]).includes(viewDate) : t.done;
                  return (
                    <div key={t.id} draggable className="drag"
                      onDragStart={e=>{e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("taskId",t.id);setDragTask(t);}}
                      onDragEnd={()=>setDragTask(null)}
                      onClick={e=>hp(e,t)}
                      style={{display:"flex",alignItems:"center",gap:6,padding:"3px 6px",borderLeft:`3px solid ${isDone?C.textMuted:c}`,borderRadius:"0 5px 5px 0",marginBottom:2,background:(isDone?C.textMuted:c)+"18",cursor:"grab",opacity:isDone?.5:1}}>
                      <div onClick={e=>{e.stopPropagation();hToggle(t.id);}} style={{width:16,height:16,borderRadius:3,border:`2px solid ${isDone?C.textMuted:c}`,background:isDone?c:"transparent",flexShrink:0,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>{isDone&&<span style={{color:"#fff",fontSize:9,fontWeight:900}}>✓</span>}</div>
                      <span style={{fontSize:10,fontWeight:600,color:isDone?C.textMuted:c,textDecoration:isDone?"line-through":"none"}}>{t.title}</span>
                      {t.deadlineDate && <span style={{fontSize:8,color:C.warn,marginLeft:"auto"}}>⚠{fd(t.deadlineDate)}</span>}
                    </div>
                  );
                })}
              </div>
            )}
            {deadlineUntimed.length > 0 && (
              <div style={{padding:"6px 9px",background:C.danger+"12",borderRadius:8,border:`1px solid ${C.danger}44`,marginBottom:4}}>
                <div style={{fontSize:9,fontWeight:700,color:C.danger,marginBottom:4,letterSpacing:.4}}>⚠ 締切</div>
                {deadlineUntimed.map(t => {
                  const c = tags.find(tg=>t.tags?.includes(tg.id))?.color||C.accent;
                  return (
                    <div key={"dl_"+t.id}
                      onClick={e=>hp(e,t)}
                      style={{display:"flex",alignItems:"center",gap:6,padding:"3px 6px",borderLeft:`3px solid ${t.done?C.textMuted:C.danger}`,borderRadius:"0 5px 5px 0",marginBottom:2,background:C.danger+(t.done?"0a":"22"),cursor:"pointer",opacity:t.done?.4:1}}>
                      <span style={{fontSize:10,fontWeight:700,color:t.done?C.textMuted:C.danger,textDecoration:t.done?"line-through":"none"}}>⚠ {t.title}</span>
                      <span style={{fontSize:8,color:t.done?C.textMuted:C.danger,marginLeft:"auto"}}>{fd(t.deadlineDate)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        );
      })()}

      <div style={{display:"grid",gridTemplateColumns:"40px 1fr"}}>
        <div style={{position:"relative",height:totalH}}>
          {Array.from({length:DAY_END-DAY_START},(_,i) => (
            <div key={i} style={{position:"absolute",top:i*HH-6,right:4,fontSize:9,color:C.textMuted,fontFamily:"'Playfair Display',serif",lineHeight:1,width:32,textAlign:"right"}}>
              {DAY_START+i}
            </div>
          ))}
        </div>
        <div style={{position:"relative",height:totalH,borderLeft:`1px solid ${C.border}44`}}
          onDragOver={e=>{e.preventDefault();const rect=e.currentTarget.getBoundingClientRect();setDropH(Math.floor((e.clientY-rect.top)/HH)+DAY_START);}}
          onDragLeave={()=>setDropH(null)}
          onDrop={e=>{const rect=e.currentTarget.getBoundingClientRect();hDrop(e,e.clientY-rect.top);}}
          onClick={e=>{const rect=e.currentTarget.getBoundingClientRect();const h=Math.max(DAY_START,Math.min(DAY_END-1,Math.floor((e.clientY-rect.top)/HH)+DAY_START));onAdd(viewDate,h);}}>
          {Array.from({length:DAY_END-DAY_START},(_,i) => (
            <div key={i} style={{position:"absolute",top:i*HH,left:0,right:0,height:HH,borderTop:`1px solid ${C.border}20`,pointerEvents:"none"}}>
              <div style={{position:"absolute",top:"50%",left:0,right:0,height:1,background:`${C.border}10`}}/>
            </div>
          ))}
          {isToday && (
            <div style={{position:"absolute",left:0,right:0,top:(now.getHours()*60+now.getMinutes()-dayStartMin)*PPM,height:2,background:C.danger,zIndex:3,pointerEvents:"none"}}>
              <div style={{width:5,height:5,borderRadius:"50%",background:C.danger,position:"absolute",left:-2.5,top:-1.5}}/>
            </div>
          )}
          {dropH!==null && (
            <div style={{position:"absolute",top:(dropH-DAY_START*60)*PPM,left:0,right:0,height:HH,background:C.accentS,border:`2px dashed ${C.accent}`,borderRadius:5,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:C.accent,pointerEvents:"none",zIndex:1}}>
              {dropH!=null?`${String(Math.floor(dropH/60)).padStart(2,"0")}:${String(dropH%60).padStart(2,"0")}`:""}{dragTask?` ← ${dragTask.title}`:""}
            </div>
          )}
          {(() => {
            // overlap計算: 時間が重なるチップを横分割
            const chips = timed.map(t => {
              const c  = tags.find(tg=>t.tags?.includes(tg.id))?.color||C.accent;
              const sm = t2m(t.startTime)||0;
              const dur = Number(t.duration)||60;
              const em = t.endTime ? t2m(t.endTime) : sm+dur;
              const isDone = t.repeat && parseRepeat(t.repeat).type !== "なし"
                ? (t.doneDates||[]).includes(viewDate)
                : t.done;
              return {t, c, sm, em, isDone};
            });
            // 各チップのcolumn割り当て
            const cols = chips.map((_,i) => {
              const overlaps = chips.filter((_,j) => j!==i && chips[j].sm < chips[i].em && chips[j].em > chips[i].sm);
              return overlaps.length;
            });
            const assigned = chips.map((chip, i) => {
              const chipDispEnd = chip.sm + Math.max(22, (chip.em - chip.sm) * PPM) / PPM;
              const group = chips.map((chip2, j) => {
                const c2DispEnd = chip2.sm + Math.max(22, (chip2.em - chip2.sm) * PPM) / PPM;
                return (chip2.sm < chipDispEnd && c2DispEnd > chip.sm) ? j : -1;
              }).filter(j => j !== -1);
              const totalCols = group.length;
              const col = group.indexOf(i);
              return {...chip, col, totalCols};
            });
            return assigned.map(({t,c,sm,em,isDone,col,totalCols}) => {
              const prev = rsPreview && rsPreview.id === t.id ? rsPreview : null;
              const dispEm = prev ? (prev.endTime ? t2m(prev.endTime) : em) : em;
              return (
                <TimelineChip key={t._sessionId||t.id} task={prev||t} tags={tags} color={c} startMin={sm} endMin={dispEm} dayStartMin={dayStartMin} ppm={PPM} onPopup={hp} onToggle={hToggle} onUpdate={onUpdate} onRSStart={onRSStart} col={col} totalCols={totalCols} isDone={isDone}/>
              );
            });
          })()}
          {/* GCalタイムチップ（右側に表示・クリックでGCalを開く） */}
          {gcalTimed.map(ev => {
            const sm = t2m(ev.startTime)||0;
            const em = ev.endTime ? t2m(ev.endTime) : sm+60;
            const top = (sm - dayStartMin)*PPM;
            const h   = Math.max(22,(em-sm)*PPM);
            return (
              <div key={"gcal_"+ev.id}
                onClick={e=>{e.stopPropagation();ev.htmlLink&&window.open(ev.htmlLink,"_blank");}}
                title={`${ev.title}${ev.location?" 📍"+ev.location:""}`}
                style={{position:"absolute",top,right:0,width:"42%",height:h,
                  background:"#4285f428",borderLeft:"3px solid #4285f4",
                  borderRadius:"0 5px 5px 0",overflow:"hidden",zIndex:2,
                  cursor:"pointer",pointerEvents:"auto",padding:"2px 4px"}}>
                <div style={{fontSize:9,fontWeight:600,color:"#4285f4",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                  {ev.startTime} {ev.title}
                </div>
              </div>
            );
          })}
          {/* 締切ライン（完了済みは除外済み） */}
          {timedDeadlines.map(t => {
            const dm = t2m(t.deadlineTime);
            if (dm === null || dm < dayStartMin || dm > DAY_END*60) return null;
            const top = (dm - dayStartMin) * PPM;
            return (
              <div key={"dl_"+t.id} onClick={e=>{e.stopPropagation();hp(e,t);}}
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
      {popup && <Popup task={popup.task||(popup.taskId ? flatten(tasks).find(x=>x.id===popup.taskId) : null)} tags={tags} anchor={popup} viewDate={popup.viewDate} onClose={()=>setPopup(null)} onEdit={onEdit} onToggle={id=>{onToggle(id);setPopup(null);}} onDelete={onDelete} onDuplicate={onDuplicate} onMemoToggle={hMemo} onAddSession={onAddSession} onRemoveSession={onRemoveSession} onSkip={(id,date)=>{onSkip(id,date);setPopup(null);}} onOverride={(id,orig,ov)=>{onOverride(id,orig,ov);setPopup(null);}}/> }
    </div>
  );
};
