import { useState, useEffect, useMemo } from "react";
import { C, DAYS_JP } from "../constants";
import { localDate, flatten, sameDay, t2m, addDur, parseRepeat, getTasksForDate, getDeadlineTasksForDate, toggleMemo, fetchHolidays, holName, isRed, useResizeHandler } from "../utils";
import { getGCalEventsForDate } from "../gcal";
import { Popup } from "../components/Popup";
import { TimelineChip } from "./ListView";

export const WeekView = ({tasks,tags,today,onUpdate,onAdd,onToggle,onEdit,onDelete,onDuplicate,onSkip,onOverride,onAddSession,onRemoveSession,dragTask,setDragTask,gcalEvents}) => {
  const DAY_START = 6;
  const DAY_END   = 23;
  const PPM       = 0.85;
  const HH        = 60 * PPM;
  const [weekOffset, setWeekOffset] = useState(0);
  const baseDate = (() => {
    const d = new Date(today);
    d.setDate(d.getDate() + weekOffset * 7);
    return localDate(d);
  })();
  const wd = (() => {
    const d=new Date(baseDate), w=d.getDay(), m=new Date(d);
    m.setDate(d.getDate()-w+1);
    return Array.from({length:7},(_,i)=>{const x=new Date(m);x.setDate(m.getDate()+i);return localDate(x);});
  })();
  const isCurrentWeek = weekOffset === 0;
  const [popup, setPopup]     = useState(null);
  const [holReady,setHolReady]= useState(false);

  useEffect(() => {
    const years = [...new Set(wd.map(d=>d.slice(0,4)))];
    Promise.all(years.map(y=>fetchHolidays(y))).then(()=>setHolReady(true));
  }, [wd.join(",")]);

  const all = useMemo(() => flatten(tasks), [tasks]);
  const dayDataMap = useMemo(() =>
    Object.fromEntries(wd.map(d => [d, {
      tasks: getTasksForDate(tasks, d),
      deadlines: getDeadlineTasksForDate(tasks, d),
    }])),
  [tasks, wd.join(",")]); // eslint-disable-line
  const getDay         = date => dayDataMap[date]?.tasks || [];
  // GCalイベント（メモリキャッシュのみ・Firestoreに書かない）
  const gcalDayMap = useMemo(() =>
    Object.fromEntries(wd.map(d => [d, getGCalEventsForDate(gcalEvents, d)])),
  [gcalEvents, wd.join(",")]); // eslint-disable-line
  const getGCalDay  = date => gcalDayMap[date] || [];
  const getDeadlineDay = date => dayDataMap[date]?.deadlines || [];

  const hp = (e,task,vd) => { const r=e.currentTarget.getBoundingClientRect(); setPopup({task,taskId:task.id,x:Math.min(r.right+8,window.innerWidth-308),y:Math.min(r.top,window.innerHeight-350),viewDate:vd}); };
  const hMemo = (id,idx) => { const t=all.find(x=>x.id===id); if(t)onUpdate({...t,memo:toggleMemo(t.memo,idx)}); setPopup(p=>p?{...p,task:{...p.task,memo:toggleMemo(p.task.memo,idx)}}:null); };
  const hToggle = (id, date) => { const t=all.find(x=>x.id===id); const isRep=t?.repeat&&parseRepeat(t.repeat).type!=="なし"; onToggle(id, isRep?(date||localDate()):undefined); };

  const { onRSStart, rsPreview } = useResizeHandler(onUpdate, PPM);

  const dayStartMin = DAY_START * 60;
  const totalH      = (DAY_END - DAY_START) * HH;
  const weekLabel = `${wd[0].slice(5).replace("-","/")} 〜 ${wd[6].slice(5).replace("-","/")}`;

  return (
    <div style={{overflowX:"auto"}}>
      <div style={{position:"sticky",top:0,zIndex:20,background:C.bg,paddingBottom:2}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:10,marginBottom:8,padding:"5px 0"}}>
        <button onClick={()=>setWeekOffset(o=>o-1)}
          style={{background:C.surfHov,color:C.text,border:`1px solid ${C.border}`,borderRadius:8,width:32,height:32,fontSize:16,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
          ‹
        </button>
        <div style={{minWidth:140,textAlign:"center"}}>
          <div style={{fontSize:12,fontWeight:700,color:C.text,fontFamily:"'Playfair Display',serif"}}>{weekLabel}</div>
          {!isCurrentWeek && (
            <button onClick={()=>setWeekOffset(0)}
              style={{fontSize:9,color:C.accent,background:C.accentS,border:`1px solid ${C.accent}33`,borderRadius:10,padding:"1px 8px",cursor:"pointer",marginTop:2}}>
              今週に戻る
            </button>
          )}
          {isCurrentWeek && <div style={{fontSize:9,color:C.accent,marginTop:1}}>今週</div>}
        </div>
        <button onClick={()=>setWeekOffset(o=>o+1)}
          style={{background:C.surfHov,color:C.text,border:`1px solid ${C.border}`,borderRadius:8,width:32,height:32,fontSize:16,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
          ›
        </button>
      </div>
      </div>
      {/* GCal終日・時間なしイベント行 */}
      {(() => {
        const gcalAllDayRows = wd.map(d => ({d, evs: getGCalDay(d).filter(ev => ev.isAllDay || !ev.startTime)}));
        if (!gcalAllDayRows.some(r => r.evs.length > 0)) return null;
        return (
          <div style={{display:"grid",gridTemplateColumns:"38px repeat(7,1fr)",minWidth:540,marginBottom:3,background:"#4285f410",borderRadius:"8px 8px 0 0",border:"1px solid #4285f433"}}>
            <div style={{fontSize:7,color:"#4285f4",fontWeight:700,padding:"6px 3px 4px",textAlign:"right",borderRight:"1px solid #4285f422"}}>📅GC</div>
            {gcalAllDayRows.map(({d,evs}) => (
              <div key={d} style={{padding:"3px 2px",minHeight:22,borderLeft:"1px solid #4285f420"}}>
                {evs.map(ev => (
                  <div key={ev.id}
                    onClick={()=>ev.htmlLink&&window.open(ev.htmlLink,"_blank")}
                    style={{fontSize:8,fontWeight:600,color:"#4285f4",whiteSpace:"nowrap",overflow:"hidden",
                      textOverflow:"ellipsis",padding:"1px 3px",borderLeft:"2px solid #4285f4",
                      marginBottom:1,background:"#4285f415",borderRadius:"0 3px 3px 0",cursor:"pointer"}}>
                    {ev.title}
                  </div>
                ))}
              </div>
            ))}
          </div>
        );
      })()}
      {/* 時間未定タスク（最上部） */}
      {(() => {
        const normalRows = wd.map(d => ({d, ts: getDay(d).filter(t=>!t.startTime)}));
        // 締切タスクは未完了なら日時枠の有無に関わらず常に表示
        const deadlineRows = wd.map(d => ({d, ts: getDeadlineDay(d).filter(t=>!t.deadlineTime)}));
        const hasNormal = normalRows.some(r=>r.ts.length>0);
        const hasDeadline = deadlineRows.some(r=>r.ts.length>0);
        if (!hasNormal && !hasDeadline) return null;
        return (
          <>
          {hasNormal && (
          <div style={{display:"grid",gridTemplateColumns:"38px repeat(7,1fr)",minWidth:540,marginBottom:3,background:C.surface,borderRadius:"8px 8px 0 0",border:`1px solid ${C.border}`}}>
            <div style={{fontSize:7,color:C.textMuted,padding:"6px 3px 4px",textAlign:"right",borderRight:`1px solid ${C.border}20`}}>未定</div>
            {normalRows.map(({d,ts}) => {
              const isSat=new Date(d).getDay()===6, isR=isRed(d);
              return (
                <div key={d} style={{padding:"3px 2px",minHeight:22,borderLeft:`1px solid ${C.border}20`,background:isSat?"rgba(119,216,255,.04)":isR?"rgba(255,136,153,.04)":"transparent"}}>
                  {ts.map(t => {
                    const isDone = t.repeat && parseRepeat(t.repeat).type!=="なし" ? (t.doneDates||[]).includes(d) : t.done;
                    const c=tags.find(tg=>t.tags?.includes(tg.id))?.color||C.accent;
                    return (
                      <div key={t.id}
                        style={{display:"flex",alignItems:"center",gap:3,padding:"2px 3px",borderLeft:`2px solid ${isDone?C.textMuted:c}`,marginBottom:1,background:(isDone?C.textMuted:c)+"15",borderRadius:"0 3px 3px 0",overflow:"hidden",opacity:isDone?.5:1}}>
                        <div draggable className="drag"
                          onDragStart={e=>{e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("taskId",t.id);setDragTask(t);e.stopPropagation();}}
                          onDragEnd={()=>setDragTask(null)}
                          onClick={e=>hp(e,t,d)}
                          style={{display:"flex",alignItems:"center",gap:3,flex:1,minWidth:0,cursor:"grab"}}>
                          <div onClick={e=>{e.stopPropagation();hToggle(t.id,d);}} style={{width:16,height:16,borderRadius:3,border:`2px solid ${t.done?C.textMuted:c}`,background:t.done?c:"transparent",flexShrink:0,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>{t.done&&<span style={{color:"#fff",fontSize:9,fontWeight:900}}>✓</span>}</div>
                          <span style={{fontSize:8,fontWeight:600,color:t.done?C.textMuted:c,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",textDecoration:t.done?"line-through":"none"}}>{t.title}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
          )}
          {hasDeadline && (
          <div style={{display:"grid",gridTemplateColumns:"38px repeat(7,1fr)",minWidth:540,marginBottom:3,background:C.danger+"10",borderRadius:8,border:`1px solid ${C.danger}33`}}>
            <div style={{fontSize:7,color:C.danger,fontWeight:700,padding:"6px 3px 4px",textAlign:"right",borderRight:`1px solid ${C.danger}22`}}>⚠締切</div>
            {deadlineRows.map(({d,ts}) => {
              const isSat=new Date(d).getDay()===6, isR=isRed(d);
              return (
                <div key={d} style={{padding:"3px 2px",minHeight:22,borderLeft:`1px solid ${C.danger}20`,background:isSat?"rgba(119,216,255,.04)":isR?"rgba(255,136,153,.04)":"transparent"}}>
                  {ts.map(t => (
                    <div key={"dl_"+t.id} onClick={e=>hp(e,t,d)}
                      style={{display:"flex",alignItems:"center",gap:3,padding:"2px 3px",borderLeft:`2px solid ${t.done?C.textMuted:C.danger}`,marginBottom:1,background:C.danger+(t.done?"08":"20"),borderRadius:"0 3px 3px 0",overflow:"hidden",cursor:"pointer",opacity:t.done?.4:1}}>
                      <span style={{fontSize:8,fontWeight:700,color:t.done?C.textMuted:C.danger,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",textDecoration:t.done?"line-through":"none"}}>⚠ {t.title}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
          )}
          </>
        );
      })()}

      <div style={{display:"grid",gridTemplateColumns:"38px repeat(7,1fr)",minWidth:540}}>
        <div/>
        {wd.map((d,i) => {
          const isT=d===today, dt=new Date(d), isSat=dt.getDay()===6, isR=isRed(d);
          const hName = holName(d);
          return (
            <div key={d} style={{padding:"4px 2px",textAlign:"center",borderBottom:`2px solid ${isT?C.accent:C.border}`,color:isT?C.accent:isSat?C.info:isR?C.danger:C.textSub,background:isT?C.accentS:"transparent"}} title={hName||undefined}>
              <div style={{fontSize:8,fontWeight:700}}>{DAYS_JP[i]}{hName?<span style={{fontSize:7}}> 祝</span>:null}</div>
              <div style={{fontSize:13,fontWeight:isT?700:400,fontFamily:"'Playfair Display',serif"}}>{dt.getDate()}</div>
              {isT && <div style={{width:5,height:5,borderRadius:"50%",background:C.accent,margin:"1px auto 0"}}/>}
            </div>
          );
        })}
        <div style={{position:"relative",height:totalH}}>
          {Array.from({length:DAY_END-DAY_START},(_,i) => (
            <div key={i} style={{position:"absolute",top:i*HH-6,right:3,fontSize:8,color:C.textMuted,fontFamily:"'Playfair Display',serif",lineHeight:1}}>{DAY_START+i}</div>
          ))}
        </div>
        {wd.map(d => {
          const dayTasks = getDay(d).filter(t => !!t.startTime);  // timed only
          const isSat=new Date(d).getDay()===6, isR=isRed(d);
          return (
            <div key={d} style={{position:"relative",height:totalH,borderLeft:`1px solid ${C.border}20`,background:d===today?"rgba(139,184,212,.06)":isSat?"rgba(119,216,255,.04)":isR?"rgba(255,136,153,.04)":"transparent"}}
              onDragOver={e=>e.preventDefault()}
              onDrop={e=>{
                e.preventDefault();
                const tid=e.dataTransfer.getData("taskId")||e.dataTransfer.getData("laterTaskId");
                const task=tid?all.find(x=>x.id===tid)||dragTask:dragTask;
                if (!task) return;
                const rect=e.currentTarget.getBoundingClientRect();
                const relY=e.clientY-rect.top;
                const totalMin=Math.floor(relY/PPM)+DAY_START*60;
                const snapped=Math.round(totalMin/15)*15;
                const clampMin=Math.max(DAY_START*60,Math.min((DAY_END-1)*60,snapped));
                const hh=Math.floor(clampMin/60), mm=clampMin%60;
                const st=`${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}`;
                const et=task.duration?addDur(st,Number(task.duration)):"";
                const newSessions=(task.sessions||[]).length>0
                  ?task.sessions.map((s,i)=>i===0?{...s,date:d,startDate:d,startTime:st,endTime:et}:s)
                  :[{id:"s_main",date:d,startDate:d,startTime:st,endTime:et}];
                onUpdate({...task,sessions:newSessions,startDate:"",startTime:"",endTime:"",isLater:false});
                setDragTask(null);
              }}
              onClick={e=>{
                if (dragTask) return;
                const rect=e.currentTarget.getBoundingClientRect();
                const h=Math.max(DAY_START,Math.min(DAY_END-1,Math.floor((e.clientY-rect.top)/HH)+DAY_START));
                onAdd(d,h);
              }}>
              {Array.from({length:DAY_END-DAY_START},(_,i) => (
                <div key={i} style={{position:"absolute",top:i*HH,left:0,right:0,height:HH,borderTop:`1px solid ${C.border}18`,pointerEvents:"none"}}>
                  <div style={{position:"absolute",top:"50%",left:0,right:0,height:1,background:`${C.border}08`}}/>
                </div>
              ))}
              {(() => {
                const chips = dayTasks.map(t => {
                  const c  = tags.find(tg=>t.tags?.includes(tg.id))?.color||C.accent;
                  const sm = t2m(t.startTime)||0;
                  const dur = Number(t.duration)||60;
                  const em = t.endTime ? t2m(t.endTime) : sm+dur;
                  const isDone = t.repeat && parseRepeat(t.repeat).type !== "なし"
                    ? (t.doneDates||[]).includes(d)
                    : t.done;
                  return {t, c, sm, em, isDone};
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
                    <TimelineChip key={t._sessionId||t.id} task={prev||t} tags={tags} color={c} startMin={sm} endMin={dispEm} dayStartMin={dayStartMin} ppm={PPM} onPopup={(e,tk)=>hp(e,tk,d)} onToggle={(id)=>hToggle(id,d)} onUpdate={onUpdate} onRSStart={onRSStart} col={col} totalCols={totalCols} isDone={isDone}/>
                  );
                });
              })()}
              {/* GCalタイムチップ */}
              {getGCalDay(d).filter(ev=>ev.startTime&&!ev.isAllDay).map(ev => {
                const sm = t2m(ev.startTime)||0;
                const em = ev.endTime ? t2m(ev.endTime) : sm+60;
                const top = (sm - dayStartMin)*PPM;
                const h   = Math.max(18,(em-sm)*PPM);
                return (
                  <div key={"gcal_"+ev.id}
                    onClick={e=>{e.stopPropagation();ev.htmlLink&&window.open(ev.htmlLink,"_blank");}}
                    title={ev.title}
                    style={{position:"absolute",top,right:0,width:"44%",height:h,
                      background:"#4285f428",borderLeft:"2px solid #4285f4",
                      borderRadius:"0 3px 3px 0",overflow:"hidden",zIndex:2,
                      cursor:"pointer",padding:"1px 3px"}}>
                    <div style={{fontSize:8,fontWeight:600,color:"#4285f4",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                      {ev.startTime} {ev.title}
                    </div>
                  </div>
                );
              })}
              {/* 締切ライン（完了済みは除外済み） */}
              {getDeadlineDay(d).filter(t=>t.deadlineTime).map(t => {
                const dm = t2m(t.deadlineTime);
                if (dm===null||dm<dayStartMin||dm>DAY_END*60) return null;
                return (
                  <div key={"dl_"+t.id} onClick={e=>{e.stopPropagation();hp(e,t,d);}}
                    style={{position:"absolute",top:(dm-dayStartMin)*PPM-1,left:0,right:0,height:3,background:C.danger,zIndex:4,cursor:"pointer"}}
                    title={`⚠ 締切: ${t.title} ${t.deadlineTime}`}>
                    <div style={{position:"absolute",right:1,top:-8,background:C.danger,color:"#fff",fontSize:7,fontWeight:700,padding:"1px 4px",borderRadius:6,whiteSpace:"nowrap",overflow:"hidden",maxWidth:80,textOverflow:"ellipsis"}}>
                      ⚠ {t.title}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {popup && <Popup task={popup.task||(popup.taskId ? flatten(tasks).find(x=>x.id===popup.taskId) : null)} tags={tags} anchor={popup} viewDate={popup.viewDate} onClose={()=>setPopup(null)} onEdit={onEdit} onToggle={id=>{onToggle(id);setPopup(null);}} onDelete={onDelete} onDuplicate={onDuplicate} onMemoToggle={hMemo} onAddSession={onAddSession} onRemoveSession={onRemoveSession} onSkip={(id,date)=>{onSkip(id,date);setPopup(null);}} onOverride={(id,orig,ov)=>{onOverride(id,orig,ov);setPopup(null);}}/> }
    </div>
  );
};
