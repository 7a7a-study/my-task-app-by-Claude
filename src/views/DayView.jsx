import { useState, useEffect, useRef, useCallback } from "react";
import { C } from "../constants";
import { localDate, flatten, fd, sameDay, t2m, addDur, parseRepeat, matchesRepeat, expandOverrides, isLaterTask, toggleMemo, fetchHolidays, holName, isRed } from "../utils";
import { Popup } from "../components/Popup";
import { TimelineChip } from "./ListView";

export const DayView = ({tasks,tags,today,onUpdate,onAdd,onToggle,onEdit,onDelete,onDuplicate,onSkip,onOverride,onAddSession,onRemoveSession,dragTask,setDragTask}) => {
  const DAY_START = 6;
  const DAY_END   = 23;
  const PPM       = 0.85;
  const HH        = 60 * PPM;
  const [popup, setPopup]   = useState(null);
  const [dropH, setDropH]   = useState(null);
  const [holReady, setHolReady] = useState(false);
  const [dayOffset, setDayOffset] = useState(0);

  const viewDate = (() => { const d=new Date(today); d.setDate(d.getDate()+dayOffset); return localDate(d); })();
  const isToday  = dayOffset === 0;

  const all = flatten(tasks);

  useEffect(() => { fetchHolidays(viewDate.slice(0,4)).then(()=>setHolReady(true)); }, [viewDate]);

  const todayT = [
    ...all.filter(t => {
      if (t.repeat && parseRepeat(t.repeat).type !== "なし") return matchesRepeat(t, viewDate);
      return sameDay(t.startDate,viewDate) || sameDay(t.deadlineDate,viewDate);
    }),
    ...expandOverrides(tasks).filter(t => sameDay(t.startDate,viewDate) || sameDay(t.deadlineDate,viewDate)),
    ...all.filter(t=>(t.sessions||[]).some(s=>s.date===viewDate)).map(t=>{
      const ss=(t.sessions||[]).filter(s=>s.date===viewDate);
      return ss.map(s=>({...t,startDate:s.date,startTime:s.startTime,endTime:s.endTime,duration:s.startTime&&s.endTime?String(t2m(s.endTime)-t2m(s.startTime)):"",_sessionId:s.id||s.startTime,_sessionOnly:true}));
    }).flat(),
  ];
  const timed   = todayT.filter(t =>  t.startTime && !(t.isLater||isLaterTask(t)));
  const untimed = todayT.filter(t => !t.startTime && !(t.isLater||isLaterTask(t)));

  const hp = (e,task,vd) => { const r=e.currentTarget.getBoundingClientRect(); setPopup({task,x:Math.min(r.right+8,window.innerWidth-308),y:Math.min(r.top,window.innerHeight-350),viewDate:vd||viewDate}); };
  const hMemo = (id,idx) => { const t=all.find(x=>x.id===id); if(t)onUpdate({...t,memo:toggleMemo(t.memo,idx)}); setPopup(p=>p?{...p,task:{...p.task,memo:toggleMemo(p.task.memo,idx)}}:null); };
  const hToggle = (id) => { const t=all.find(x=>x.id===id); const isRep=t?.repeat&&parseRepeat(t.repeat).type!=="なし"; onToggle(id, isRep?viewDate:undefined); };

  const rsRef=useRef(false), rsTask=useRef(null), rsY=useRef(0), rsDur=useRef(0);
  const onRSStart = useCallback((e,task) => {
    e.stopPropagation(); e.preventDefault();
    rsRef.current=true; rsTask.current=task;
    rsY.current=e.clientY||(e.touches?.[0]?.clientY)||0;
    rsDur.current=Number(task.duration)||60;
    const mv = ev => {
      if (!rsRef.current) return;
      const y = ev.clientY||(ev.touches?.[0]?.clientY)||0;
      const nd = Math.max(15, Math.round((rsDur.current+(y-rsY.current)/PPM)/15)*15);
      onUpdate({...rsTask.current, duration:String(nd), endTime:rsTask.current.startTime?addDur(rsTask.current.startTime,nd):""});
    };
    const up = () => { rsRef.current=false; document.removeEventListener("mousemove",mv); document.removeEventListener("mouseup",up); document.removeEventListener("touchmove",mv); document.removeEventListener("touchend",up); };
    document.addEventListener("mousemove",mv); document.addEventListener("mouseup",up);
    document.addEventListener("touchmove",mv,{passive:false}); document.addEventListener("touchend",up);
  }, [onUpdate]);

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
    onUpdate({...t, startDate:viewDate, startTime:st, endTime:t.duration?addDur(st,Number(t.duration)):"", isLater:false});
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
      {untimed.length>0 && (
        <div style={{padding:"6px 9px",background:C.surface,borderRadius:8,border:`1px solid ${C.border}`,marginBottom:8}}>
          <div style={{fontSize:9,fontWeight:700,color:C.textMuted,marginBottom:4,textTransform:"uppercase",letterSpacing:.4}}>時間未定</div>
          {untimed.map(t => {
            const c = tags.find(tg=>t.tags?.includes(tg.id))?.color||C.accent;
            return (
              <div key={t.id} draggable className="drag"
                onDragStart={e=>{e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("taskId",t.id);setDragTask(t);}}
                onDragEnd={()=>setDragTask(null)}
                onClick={e=>hp(e,t)}
                style={{display:"flex",alignItems:"center",gap:6,padding:"3px 6px",borderLeft:`3px solid ${c}`,borderRadius:"0 5px 5px 0",marginBottom:2,background:c+"18",cursor:"grab"}}>
                <div onClick={e=>{e.stopPropagation();hToggle(t.id);}} style={{width:7,height:7,borderRadius:1.5,border:`1.5px solid ${t.done?C.textMuted:c}`,background:t.done?c:"transparent",flexShrink:0,cursor:"pointer"}}/>
                <span style={{fontSize:10,fontWeight:600,color:t.done?C.textMuted:c,textDecoration:t.done?"line-through":"none"}}>{t.title}</span>
                {t.deadlineDate && <span style={{fontSize:8,color:C.warn,marginLeft:"auto"}}>⚠{fd(t.deadlineDate)}</span>}
              </div>
            );
          })}
        </div>
      )}

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
            <div key={i} style={{position:"absolute",top:i*HH,left:0,right:0,height:HH,borderTop:`1px solid ${C.border}20`}}>
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
              const group = chips.map((_, j) => j).filter(j => chips[j].sm < chip.em && chips[j].em > chip.sm);
              const totalCols = group.length;
              const col = group.indexOf(i);
              return {...chip, col, totalCols};
            });
            return assigned.map(({t,c,sm,em,isDone,col,totalCols}) => (
              <TimelineChip key={t._sessionId||t.id} task={t} tags={tags} color={c} startMin={sm} endMin={em} dayStartMin={dayStartMin} ppm={PPM} onPopup={hp} onToggle={hToggle} onUpdate={onUpdate} onRSStart={onRSStart} col={col} totalCols={totalCols} isDone={isDone}/>
            ));
          })()}
        </div>
      </div>
      {popup && <Popup task={popup.task} tags={tags} anchor={popup} viewDate={popup.viewDate} onClose={()=>setPopup(null)} onEdit={onEdit} onToggle={id=>{onToggle(id);setPopup(null);}} onDelete={onDelete} onDuplicate={onDuplicate} onMemoToggle={hMemo} onAddSession={onAddSession} onRemoveSession={onRemoveSession} onSkip={(id,date)=>{onSkip(id,date);setPopup(null);}} onOverride={(id,orig,ov)=>{onOverride(id,orig,ov);setPopup(null);}}/> }
    </div>
  );
};
