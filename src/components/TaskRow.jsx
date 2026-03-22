import { useState, useRef } from "react";
import { C, IS_TOUCH, SORTS } from "../constants";
import { localDate, fdt, isLaterTask, parseRepeat, repeatLabel, renderMemo } from "../utils";
import { CB, Pill, ConfirmDialog } from "./ui";

export const TaskRow = ({task,tags,depth=0,onEdit,onDelete,onToggle,onAddChild,onDuplicate,onMemoToggle}) => {
  const [exp, setExp]               = useState(true);
  const [memoOpen, setMemoOpen]     = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [swipeX, setSwipeX]         = useState(0);
  const [swiping, setSwiping]       = useState(false);
  const touchStartX = useRef(null);
  const touchStartY = useRef(null);
  const swipeXRef   = useRef(0);
  const memoRef     = useRef(false);
  const SWIPE_OPEN  = -140;

  const tTags   = tags.filter(t => task.tags?.includes(t.id) && t.parentId);
  const today   = localDate();
  const over    = task.deadlineDate && !task.done && task.deadlineDate < today;
  const urgent  = task.deadlineDate && !task.done && task.deadlineDate === today;
  const later   = task.isLater || isLaterTask(task);
  const tc      = tags.find(t => task.tags?.includes(t.id))?.color || C.accent;
  const hasMemo = !!task.memo;

  const setSwipe = v => { swipeXRef.current = v; setSwipeX(v); };
  const setMemo  = v => { memoRef.current = v; setMemoOpen(v); };
  const closeSwipe = () => setSwipe(0);

  const onTouchStart = e => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    setSwiping(false);
  };
  const onTouchMove = e => {
    if (touchStartX.current === null) return;
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - touchStartY.current;
    if (!swiping && Math.abs(dx) <= 8) return;
    if (!swiping && Math.abs(dy) >= Math.abs(dx)) return;
    setSwiping(true);
    e.preventDefault();
    const base = swipeXRef.current <= SWIPE_OPEN / 2 ? SWIPE_OPEN : 0;
    setSwipe(Math.max(SWIPE_OPEN, Math.min(0, base + dx)));
  };
  const onTouchEnd = e => {
    const dx = touchStartX.current !== null ? e.changedTouches[0].clientX - touchStartX.current : 0;
    const dy = touchStartY.current !== null ? e.changedTouches[0].clientY - touchStartY.current : 0;
    const wasSwiping = swiping;
    touchStartX.current = null;
    touchStartY.current = null;
    setSwiping(false);
    if (!wasSwiping && Math.abs(dx) < 8 && Math.abs(dy) < 8) {
      const tag = e.target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "button" || tag === "select" || tag === "textarea") return;
      if (e.target?.closest?.("[data-memo-panel]")) return;
      e.preventDefault();
      if (swipeXRef.current <= SWIPE_OPEN / 2) { closeSwipe(); }
      else if (hasMemo) { setMemo(!memoRef.current); }
    } else if (wasSwiping) {
      setSwipe(swipeXRef.current < SWIPE_OPEN / 2 ? SWIPE_OPEN : 0);
    }
  };

  return (
    <div
      onTouchStart={e=>{if(e.target?.closest?.("[data-memo-panel]")){touchStartX.current=null;touchStartY.current=null;}}}
      style={{marginLeft:depth*16, position:"relative", overflow:"hidden", borderRadius:memoOpen?"7px 7px 0 0":7, marginBottom:memoOpen?0:2}}>
      <div className="swipe-actions" style={{position:"absolute",right:0,top:0,bottom:0,display:"flex",alignItems:"center",gap:2,paddingRight:6,background:C.bgSub,zIndex:0}}>
        <button onClick={()=>{onAddChild(task.id);closeSwipe();}} style={{background:C.accentS,color:C.accent,border:"none",borderRadius:6,width:28,height:28,fontSize:13,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>+</button>
        <button onClick={()=>{onDuplicate(task);closeSwipe();}}   style={{background:C.successS,color:C.success,border:"none",borderRadius:6,width:28,height:28,fontSize:12,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>⧉</button>
        <button onClick={()=>{onEdit(task);closeSwipe();}}         style={{background:C.surfHov,color:C.textSub,border:"none",borderRadius:6,width:28,height:28,fontSize:12,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>✎</button>
        <button onClick={()=>{setConfirmDel(true);closeSwipe();}} style={{background:C.dangerS,color:C.danger,border:"none",borderRadius:6,width:28,height:28,fontSize:12,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>✕</button>
      </div>
      <div className="hov tr"
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
        style={{display:"flex",alignItems:"center",gap:6,padding:"5px 9px",
          background:depth===0?C.surface:C.bgSub,
          border:`1px solid ${over?C.danger+"55":depth===0?C.border:"transparent"}`,
          borderLeft:depth>0?`3px solid ${tc}55`:undefined,
          opacity:task.done?.45:1,
          transform:`translateX(${swipeX}px)`,
          transition:swiping?"none":"transform .2s ease",
          position:"relative",zIndex:1,
        }}>
        <div style={{paddingTop:1,flexShrink:0}}><CB checked={task.done} onChange={()=>onToggle(task.id)} color={tc}/></div>
        <div style={{flex:1,minWidth:0,cursor:hasMemo?"pointer":"default"}}
          onClick={hasMemo ? e=>{e.stopPropagation();setMemo(!memoRef.current);} : undefined}>
          <div style={{display:"flex",alignItems:"center",gap:4,flexWrap:"wrap",marginBottom:1}}>
            {task.children?.length>0 && <span onClick={e=>{e.stopPropagation();setExp(!exp);}} style={{cursor:"pointer",fontSize:8,color:C.textMuted,transform:exp?"rotate(90deg)":"",transition:"transform .15s",display:"inline-block"}}>▶</span>}
            <span style={{fontSize:12,fontWeight:depth===0?600:400,textDecoration:task.done?"line-through":"none",color:task.done?C.textMuted:C.text}}>{task.title}</span>
            {task.repeat && parseRepeat(task.repeat).type !== "なし" && <span style={{fontSize:8,padding:"1px 4px",borderRadius:6,background:C.successS,color:C.success,fontWeight:600}}>↻{repeatLabel(task.repeat)}</span>}
            {(()=>{const total=(task.sessions||[]).length+(task.startDate?1:0);return total>1?<span style={{fontSize:8,padding:"1px 4px",borderRadius:6,background:C.accentS,color:C.accent,fontWeight:600}}>📆{total}枠</span>:null;})()}
            {later  && <span style={{fontSize:8,padding:"1px 4px",borderRadius:6,background:C.warnS,color:C.warn,fontWeight:600}}>📌</span>}
            {over   && <span style={{fontSize:8,padding:"1px 4px",borderRadius:6,background:C.dangerS,color:C.danger,fontWeight:600}}>⚠超過</span>}
            {urgent && <span style={{fontSize:8,padding:"1px 4px",borderRadius:6,background:C.warnS,color:C.warn,fontWeight:600}}>🔥今日</span>}
            {hasMemo && <span style={{fontSize:8,color:C.textMuted,opacity:.6}}>{memoOpen?"▲":"📝"}</span>}
          </div>
          <div style={{display:"flex",gap:4,flexWrap:"wrap",alignItems:"center"}}>
            {tTags.map(t=><Pill key={t.id} tag={t}/>)}
            {task.startDate    && <span style={{fontSize:9,color:C.textMuted}}>▶{fdt(task.startDate,task.startTime)}</span>}
            {task.duration     && <span style={{fontSize:9,color:C.accent}}>⏱{task.duration}分</span>}
            {task.deadlineDate && <span style={{fontSize:9,color:over?C.danger:C.warn}}>⚠{fdt(task.deadlineDate,task.deadlineTime)}</span>}
          </div>
        </div>
        {!IS_TOUCH && !task.done && (
          <div className="ta" style={{display:"flex",gap:3,flexShrink:0,alignSelf:"center"}}>
            <button onClick={()=>onAddChild(task.id)} style={{background:C.accentS,color:C.accent,border:"none",borderRadius:6,width:28,height:28,fontSize:13,display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
            <button onClick={()=>onDuplicate(task)}   style={{background:C.successS,color:C.success,border:"none",borderRadius:6,width:28,height:28,fontSize:12,display:"flex",alignItems:"center",justifyContent:"center"}}>⧉</button>
            <button onClick={()=>onEdit(task)}         style={{background:C.surfHov,color:C.textSub,border:"none",borderRadius:6,width:28,height:28,fontSize:12,display:"flex",alignItems:"center",justifyContent:"center"}}>✎</button>
            <button onClick={()=>setConfirmDel(true)}  style={{background:C.dangerS,color:C.danger,border:"none",borderRadius:6,width:28,height:28,fontSize:12,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
          </div>
        )}
      </div>
      {confirmDel && <ConfirmDialog title="タスクを削除" message={`「${task.title}」を削除しますか？\n子タスクも一緒に削除されます。`} onConfirm={()=>{onDelete(task.id);setConfirmDel(false);}} onCancel={()=>setConfirmDel(false)}/>}
      {memoOpen && hasMemo && (
        <div
          data-memo-panel="1"
          onClick={e=>e.stopPropagation()}
          onTouchStart={e=>{e.stopPropagation(); touchStartX.current=null; touchStartY.current=null;}}
          onTouchMove={e=>e.stopPropagation()}
          onTouchEnd={e=>e.stopPropagation()}
          style={{background:depth===0?C.surface:C.bgSub,borderTop:`1px solid ${C.border}22`,borderRadius:"0 0 7px 7px",padding:"6px 12px 8px 36px",marginBottom:2,border:`1px solid ${over?C.danger+"55":depth===0?C.border:"transparent"}`,borderLeft:depth>0?`3px solid ${tc}55`:undefined}}>
          {renderMemo(task.memo, onMemoToggle ? idx=>onMemoToggle(task.id,idx) : null)}
        </div>
      )}
      {exp && task.children?.map(c=><TaskRow key={c.id} task={c} tags={tags} depth={depth+1} onEdit={onEdit} onDelete={onDelete} onToggle={onToggle} onAddChild={onAddChild} onDuplicate={onDuplicate} onMemoToggle={onMemoToggle}/>)}
    </div>
  );
};
