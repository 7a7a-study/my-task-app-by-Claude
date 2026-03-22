import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { C } from "../constants";
import { localDate, flatten, dimOf, parseRepeat, isLaterTask, toggleMemo, fetchHolidays, holName, isHol, isRed } from "../utils";
import { CB, Pill } from "../components/ui";
import { Popup } from "../components/Popup";

export const GanttView = ({tasks,tags,today,onUpdate,onAdd,onToggle,onEdit,onDelete,onDuplicate,onSkip,onOverride,hideCompleted,dragTask,setDragTask}) => {
  const [vy,setVy] = useState(new Date(today).getFullYear());
  const [vm,setVm] = useState(new Date(today).getMonth());
  const [popup,setPopup]   = useState(null);
  const [dragBar,setDragBar] = useState(null);
  const [dragDL, setDragDL]  = useState(null);
  const [dropDay,setDropDay] = useState(null);
  const [holReady,setHolReady] = useState(false);
  const D   = dimOf(vy,vm);
  const DW  = 30;
  const RH  = 28;
  const all = flatten(tasks);
  const vis = all.filter(t => (t.startDate||t.endDate||t.deadlineDate||(t.sessions||[]).length>0) && !(t.isLater||isLaterTask(t)) && !(hideCompleted&&t.done));

  useEffect(() => { fetchHolidays(vy).then(()=>setHolReady(true)); }, [vy]);

  const groups = useMemo(() => {
    const g = {};
    vis.forEach(t => {
      const pid = t.tags?.find(id=>tags.find(tg=>tg.id===id&&!tg.parentId)) || "__none__";
      if (!g[pid]) g[pid]=[];
      g[pid].push(t);
    });
    return g;
  }, [vis.map(t=>t.id+t.done+t.startDate+t.endDate+t.deadlineDate).join(), tags.map(t=>t.id).join()]);

  const getBar = task => {
    const s = task.startDate ? new Date(task.startDate) : null;
    const e = task.endDate   ? new Date(task.endDate)   : s;
    if (!s) return null;
    const ms=new Date(vy,vm,1), me=new Date(vy,vm,D);
    if (e<ms||s>me) return null;
    const cs=s<ms?ms:s, ce=e>me?me:e;
    return { startDay:cs.getDate(), width:Math.max(1,ce.getDate()-cs.getDate()+1) };
  };
  const getSessionSegs = task => {
    if (!(task.sessions||[]).length) return [];
    return (task.sessions||[]).filter(s=>{
      if (!s.date) return false;
      const d=new Date(s.date);
      return d.getFullYear()===vy && d.getMonth()===vm;
    }).map(s=>({day:new Date(s.date).getDate(), s}));
  };
  const getDL = task => {
    if (!task.deadlineDate) return null;
    const x=new Date(task.deadlineDate);
    const ms=new Date(vy,vm,1), me=new Date(vy,vm,D);
    if (x<ms||x>me) return null;
    return x.getDate();
  };

  const ds = n => `${vy}-${String(vm+1).padStart(2,"0")}-${String(n).padStart(2,"0")}`;
  const MN = ["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"];
  const todD = today.startsWith(`${vy}-${String(vm+1).padStart(2,"0")}`) ? parseInt(today.slice(8)) : null;

  const hp = (e,task,vd) => { e.stopPropagation(); const r=e.currentTarget.getBoundingClientRect(); setPopup({task,x:Math.min(r.right+8,window.innerWidth-308),y:Math.min(r.top,window.innerHeight-350),viewDate:vd||task.startDate||today}); };
  const hMemo = (id,idx) => { const t=all.find(x=>x.id===id); if(t)onUpdate({...t,memo:toggleMemo(t.memo,idx)}); setPopup(p=>p?{...p,task:{...p.task,memo:toggleMemo(p.task.memo,idx)}}:null); };

  const hDrop = (e,n) => {
    e.preventDefault(); setDropDay(null);
    if (dragDL) { onUpdate({...dragDL,deadlineDate:ds(n)}); setDragDL(null); return; }
    if (dragBar) {
      const diff=n-dragBar.startDay, t=dragBar.task;
      const sh = x => { if(!x)return x; const dt=new Date(x); dt.setDate(dt.getDate()+diff); return localDate(dt); };
      onUpdate({...t,startDate:sh(t.startDate),endDate:sh(t.endDate),isLater:false});
      setDragBar(null); return;
    }
    const tid=e.dataTransfer.getData("taskId")||e.dataTransfer.getData("laterTaskId");
    const t=tid?all.find(x=>x.id===tid)||dragTask:dragTask;
    if (t) { onUpdate({...t,startDate:ds(n),isLater:false}); setDragTask(null); }
  };

  const brsRef=useRef(false),brsTask=useRef(null),brsX=useRef(0),brsW=useRef(0);
  const onBRS = useCallback((e,task,barW) => {
    e.stopPropagation(); e.preventDefault();
    brsRef.current=true; brsTask.current=task; brsX.current=e.clientX||(e.touches?.[0]?.clientX)||0; brsW.current=barW;
    const mv = ev => {
      if (!brsRef.current) return;
      const x=ev.clientX||(ev.touches?.[0]?.clientX)||0;
      const nw=Math.max(1,brsW.current+Math.round((x-brsX.current)/DW));
      const t=brsTask.current, sd=t.startDate||t.endDate; if(!sd)return;
      const ne=new Date(sd); ne.setDate(ne.getDate()+nw-1);
      onUpdate({...t, endDate:localDate(ne)});
    };
    const up = () => { brsRef.current=false; document.removeEventListener("mousemove",mv); document.removeEventListener("mouseup",up); document.removeEventListener("touchmove",mv); document.removeEventListener("touchend",up); };
    document.addEventListener("mousemove",mv); document.addEventListener("mouseup",up);
    document.addEventListener("touchmove",mv,{passive:false}); document.addEventListener("touchend",up);
  }, [onUpdate]);

  const renderTaskRow = (task, ri, gc, indent=0) => {
    const bar = getBar(task);
    const segs = getSessionSegs(task);
    const dlDay = getDL(task);
    const c = tags.find(t=>task.tags?.includes(t.id))?.color||C.accent;
    const isParent = !task._pid;
    const isBarDrag = dragBar?.task?.id===task.id;
    const isDLDrag  = dragDL?.id===task.id;
    const todStr = localDate();
    const isOver = task.deadlineDate && !task.done && task.deadlineDate < todStr;
    const leftPad = 10 + indent * 14;
    return (
      <div key={task.id} style={{display:"flex",borderBottom:`1px solid ${C.border}18`,height:RH,background:ri%2===0?"transparent":"rgba(255,255,255,.01)"}}
        onMouseEnter={e=>e.currentTarget.style.background=C.surfHov+"44"}
        onMouseLeave={e=>e.currentTarget.style.background=ri%2===0?"transparent":"rgba(255,255,255,.01)"}>
        <div onClick={e=>hp(e,task,task.startDate||today)} style={{width:280,flexShrink:0,display:"flex",alignItems:"center",gap:5,padding:`0 7px 0 ${leftPad}px`,borderRight:`1px solid ${C.border}`,overflow:"hidden",cursor:"pointer"}}>
          {task._pid && <span style={{color:C.textMuted,fontSize:9,flexShrink:0}}>└</span>}
          <CB checked={task.done} onChange={()=>onToggle(task.id)} size={12} color={c}/>
          <span style={{fontSize:10,fontWeight:isParent?600:400,color:task.done?C.textMuted:C.text,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis",textDecoration:task.done?"line-through":"none",flex:1}}>{task.title}</span>
          {isOver && <span style={{fontSize:8,color:C.danger,flexShrink:0}}>⚠</span>}
        </div>
        <div style={{flex:1,position:"relative",overflow:"visible"}}
          onDragOver={e=>{e.preventDefault();const n=Math.ceil(e.nativeEvent.offsetX/DW);setDropDay(Math.max(1,Math.min(D,n)));}}
          onDragLeave={()=>setDropDay(null)}
          onDrop={e=>{const n=Math.ceil(e.nativeEvent.offsetX/DW);hDrop(e,Math.max(1,Math.min(D,n)));}}>
          {todD && <div style={{position:"absolute",left:(todD-1)*DW+DW/2,top:0,bottom:0,width:2,background:`${C.accent}55`,pointerEvents:"none",zIndex:1}}/>}
          {bar && (
            <div draggable
              onDragStart={e=>{e.stopPropagation();e.dataTransfer.effectAllowed="move";setDragBar({task,startDay:bar.startDay});}}
              onDragEnd={()=>{setDragBar(null);setDropDay(null);}}
              onClick={e=>hp(e,task)}
              style={{position:"absolute",left:(bar.startDay-1)*DW+1,width:Math.max(bar.width*DW-2,DW/2),height:isParent?18:13,top:(RH-(isParent?18:13))/2,background:isBarDrag?`${c}38`:task.done?C.border+"44":`linear-gradient(90deg,${c}55,${c}38)`,border:`1px solid ${c}77`,borderRadius:4,display:"flex",alignItems:"center",paddingLeft:4,fontSize:8,color:task.done?C.textMuted:c,fontWeight:600,overflow:"hidden",whiteSpace:"nowrap",cursor:"grab",textDecoration:task.done?"line-through":"none",zIndex:3,userSelect:"none"}}>
              {task.startTime
                ? <span style={{fontSize:7,fontWeight:700,opacity:.9}}>{task.startTime}{task.endTime?`–${task.endTime}`:""}</span>
                : (bar.width>1 ? task.title.slice(0,16) : "")
              }
              <div className="ew" onMouseDown={e=>onBRS(e,task,bar.width)} onTouchStart={e=>onBRS(e,task,bar.width)} onClick={e=>e.stopPropagation()}
                style={{position:"absolute",right:0,top:0,bottom:0,width:6,background:`${c}55`,borderRadius:"0 3px 3px 0",display:"flex",alignItems:"center",justifyContent:"center"}}>
                <div style={{width:1.5,height:7,background:"rgba(255,255,255,.5)",borderRadius:1}}/>
              </div>
            </div>
          )}
          {segs.map(({day,s},si)=>(
            <div key={s.id||si}
              onClick={e=>hp(e,task,s.date)}
              title={`${s.date} ${s.startTime}–${s.endTime}`}
              style={{position:"absolute",left:(day-1)*DW+1,width:Math.max(DW-2,8),height:isParent?18:13,top:(RH-(isParent?18:13))/2,background:task.done?C.border+"44":`${c}88`,border:`1.5px solid ${c}`,borderRadius:4,zIndex:4,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden"}}>
              <span style={{fontSize:7,color:task.done?C.textMuted:"#fff",fontWeight:700,lineHeight:1,padding:"0 2px",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                {s.startTime}
              </span>
            </div>
          ))}
          {dlDay && (
            <div draggable
              onDragStart={e=>{e.stopPropagation();e.dataTransfer.effectAllowed="move";setDragDL(task);}}
              onDragEnd={()=>{setDragDL(null);setDropDay(null);}}
              onClick={e=>e.stopPropagation()}
              title={`締切: ${task.deadlineDate}`}
              style={{position:"absolute",left:(dlDay-1)*DW+DW/2-4,top:(RH-14)/2,width:8,height:14,zIndex:4,cursor:"grab",display:"flex",flexDirection:"column",alignItems:"center",opacity:isDLDrag?.4:1}}>
              <div style={{width:1.5,height:7,background:C.danger,borderRadius:1}}/>
              <div style={{width:0,height:0,borderLeft:"4px solid transparent",borderRight:"4px solid transparent",borderTop:`5px solid ${C.danger}`}}/>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderGroup = (tagId, gTasks) => {
    const tag = tags.find(t=>t.id===tagId);
    const gc  = tag?.color || C.textMuted;
    const subMap = {};
    gTasks.forEach(t => {
      const ctid = t.tags?.find(id => tags.find(tg=>tg.id===id&&tg.parentId)) || "__none__";
      if (!subMap[ctid]) subMap[ctid] = [];
      subMap[ctid].push(t);
    });
    const hasSubGroups = Object.keys(subMap).some(k => k !== "__none__");
    return (
      <div key={tagId}>
        {tagId !== "__none__" && (
          <div style={{display:"flex",background:`${gc}0a`,borderTop:`2px solid ${gc}44`,borderBottom:`1px solid ${gc}30`}}>
            <div style={{width:280,flexShrink:0,padding:"4px 10px",display:"flex",alignItems:"center",gap:5,borderRight:`1px solid ${C.border}`}}>
              <div style={{width:8,height:8,borderRadius:"50%",background:gc,boxShadow:`0 0 6px ${gc}88`,flexShrink:0}}/>
              <span style={{fontSize:11,fontWeight:700,color:gc}}>{tag?.name}</span>
              <span style={{fontSize:8,color:C.textMuted,marginLeft:"auto"}}>{gTasks.length}</span>
            </div>
            <div style={{flex:1,position:"relative"}}>
              {todD && <div style={{position:"absolute",left:(todD-1)*DW+DW/2,top:0,bottom:0,width:2,background:`${C.accent}55`,pointerEvents:"none"}}/>}
            </div>
          </div>
        )}
        {hasSubGroups ? (
          Object.entries(subMap).map(([ctid, ctTasks]) => {
            const ctag = tags.find(t=>t.id===ctid);
            return (
              <div key={ctid}>
                {ctid !== "__none__" && ctag && (
                  <div style={{display:"flex",background:`${ctag.color}08`,borderTop:`1px solid ${ctag.color}33`,borderBottom:`1px solid ${ctag.color}22`}}>
                    <div style={{width:280,flexShrink:0,padding:"3px 10px 3px 20px",display:"flex",alignItems:"center",gap:6,borderRight:`1px solid ${C.border}`}}>
                      <span style={{color:C.textMuted,fontSize:9}}>└</span>
                      <Pill tag={ctag}/>
                      <span style={{fontSize:8,color:C.textMuted,marginLeft:"auto"}}>{ctTasks.length}</span>
                    </div>
                    <div style={{flex:1}}/>
                  </div>
                )}
                {ctTasks.map((task,ri) => renderTaskRow(task,ri,gc, task._pid ? 2 : 1))}
              </div>
            );
          })
        ) : (
          gTasks.map((task,ri) => renderTaskRow(task,ri,gc))
        )}
      </div>
    );
  };

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:7,flexWrap:"wrap"}}>
        <button onClick={()=>{if(vm===0){setVy(y=>y-1);setVm(11);}else setVm(m=>m-1);}} style={{background:C.surfHov,color:C.text,border:`1px solid ${C.border}`,borderRadius:6,padding:"3px 9px",fontSize:13,cursor:"pointer"}}>‹</button>
        <span style={{fontFamily:"'Playfair Display',serif",fontWeight:700,fontSize:14}}>{vy}年 {MN[vm]}</span>
        <button onClick={()=>{if(vm===11){setVy(y=>y+1);setVm(0);}else setVm(m=>m+1);}} style={{background:C.surfHov,color:C.text,border:`1px solid ${C.border}`,borderRadius:6,padding:"3px 9px",fontSize:13,cursor:"pointer"}}>›</button>
        <span style={{fontSize:9,color:C.textMuted}}>バー=開始〜終了 / 🔴=締切 / ドラッグ移動・右端で期間変更</span>
      </div>
      <div style={{overflowX:"auto",borderRadius:10,border:`1px solid ${C.border}`,background:C.surface}}>
        <div style={{minWidth:D*DW+280}}>
          <div style={{display:"flex",borderBottom:`2px solid ${C.border}`,background:C.bgSub,position:"sticky",top:0,zIndex:10}}>
            <div style={{width:280,flexShrink:0,padding:"6px 10px",fontSize:9,fontWeight:700,color:C.textMuted,textTransform:"uppercase",borderRight:`1px solid ${C.border}`,display:"flex",alignItems:"center"}}>タスク名</div>
            <div style={{display:"flex"}}>
              {Array.from({length:D},(_,i) => {
                const n=i+1, dStr=ds(n), dt=new Date(vy,vm,n);
                const isSat=dt.getDay()===6, isR=isRed(dStr), isT=n===todD;
                const hName=holName(dStr);
                return (
                  <div key={n}
                    onDragOver={e=>{e.preventDefault();setDropDay(n);}}
                    onDragLeave={()=>setDropDay(null)}
                    onDrop={e=>hDrop(e,n)}
                    onClick={()=>{if(!dragTask&&!dragBar&&!dragDL)onAdd(dStr,null);}}
                    style={{width:DW,flexShrink:0,textAlign:"center",fontSize:9,fontWeight:isT?800:400,fontFamily:"'Playfair Display',serif",color:isT?C.accent:isSat?C.info:isR?C.danger:C.textMuted,background:isT?C.accentS:isSat?"rgba(119,216,255,.05)":isR?"rgba(255,136,153,.07)":"transparent",borderLeft:`1px solid ${C.border}20`,padding:"5px 0",cursor:"pointer",position:"relative"}} title={hName||undefined}>
                    {n}
                    {isHol(dStr) && <div style={{fontSize:6,color:C.danger,lineHeight:1}}>祝</div>}
                    {isT && <div style={{position:"absolute",bottom:1,left:"50%",transform:"translateX(-50%)",width:3,height:3,borderRadius:"50%",background:C.accent}}/>}
                    {dropDay===n && <div style={{position:"absolute",inset:0,background:`${C.accent}16`,borderLeft:`2px dashed ${C.accent}`,pointerEvents:"none"}}/>}
                  </div>
                );
              })}
            </div>
          </div>
          {Object.entries(groups).map(([tagId,gTasks]) => renderGroup(tagId,gTasks))}
          {vis.length===0 && <div style={{padding:"28px 0",textAlign:"center",color:C.textMuted,fontSize:11}}>この月にタスクがありません</div>}
        </div>
      </div>
      {popup && <Popup task={popup.task} tags={tags} anchor={popup} viewDate={popup.viewDate} onClose={()=>setPopup(null)} onEdit={onEdit} onToggle={id=>{onToggle(id);setPopup(null);}} onDelete={onDelete} onDuplicate={onDuplicate} onMemoToggle={hMemo} onSkip={(id,date)=>{onSkip(id,date);setPopup(null);}} onOverride={(id,orig,ov)=>{onOverride(id,orig,ov);setPopup(null);}}/> }
    </div>
  );
};
