import { useState, useEffect, useMemo } from "react";
import { C, SORTS } from "../constants";
import { parseRepeat, isLaterTask, localDate } from "../utils";
import { TaskRow } from "../components/TaskRow";

// ★ タイムラインチップ（開始〜終了の高さにまたがる）
export const TimelineChip = ({task,tags,color,startMin,endMin,dayStartMin,ppm,onPopup,onToggle,onUpdate,onRSStart}) => {
  const top  = (startMin - dayStartMin) * ppm;
  const h    = Math.max(22, (endMin - startMin) * ppm);
  const over = task.deadlineDate && !task.done && task.deadlineDate < localDate();
  return (
    <div className="drag" draggable
      onDragStart={e=>{e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("taskId",task.id);e.stopPropagation();}}
      onClick={e=>{e.stopPropagation();onPopup(e,task);}}
      style={{position:"absolute",top,left:1,right:1,height:h,background:task.done?C.border+"38":color+"22",borderLeft:`3px solid ${task.done?C.textMuted:color}`,borderRadius:"0 5px 5px 0",overflow:"hidden",display:"flex",flexDirection:"column",justifyContent:"space-between",zIndex:2,userSelect:"none",cursor:"grab",opacity:task.done?.5:1}}>
      <div style={{padding:"2px 5px 0",flex:1,minHeight:0,overflow:"hidden"}}>
        <div style={{display:"flex",alignItems:"center",gap:3}}>
          <div onClick={e=>{e.stopPropagation();onToggle(task.id);}} style={{width:7,height:7,borderRadius:1.5,border:`1.5px solid ${task.done?C.textMuted:color}`,background:task.done?color:"transparent",flexShrink:0,cursor:"pointer"}}/>
          <span style={{fontSize:10,fontWeight:600,color:task.done?C.textMuted:color,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis",textDecoration:task.done?"line-through":"none"}}>
            {task.startTime} {task.title}
          </span>
          {over && <span style={{fontSize:7,color:C.danger,flexShrink:0}}>⚠</span>}
        </div>
        {h > 34 && task.endTime && <div style={{fontSize:8,color:color,paddingLeft:11,opacity:.8}}>〜{task.endTime}（{task.duration}分）</div>}
        {h > 48 && task._pt    && <div style={{fontSize:7,color:C.textMuted,paddingLeft:11}}>📁{task._pt}</div>}
      </div>
      {/* ★ リサイズハンドル（下端ドラッグで終了時刻を変更） */}
      <div className="rh" onMouseDown={e=>onRSStart(e,task)} onTouchStart={e=>onRSStart(e,task)} onClick={e=>e.stopPropagation()}
        style={{height:7,background:color+"30",borderTop:`1px dashed ${color}55`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
        <div style={{width:14,height:1.5,borderRadius:1,background:color+"88"}}/>
      </div>
    </div>
  );
};

export const ListView = ({tasks,tags,filters,onEdit,onDelete,onToggle,onAddChild,onDuplicate,onMemoToggle,sortOrder,setSortOrder}) => {
  const filtered = useMemo(() => {
    let list = tasks;
    if (filters.tag)           list = list.filter(t => t.tags?.includes(filters.tag));
    if (filters.search)        list = list.filter(t => t.title.toLowerCase().includes(filters.search.toLowerCase()));
    if (filters.hideCompleted) list = list.filter(t => !t.done);
    if (sortOrder==="開始日順")     list = [...list].sort((a,b) => (a.startDate||"9")>(b.startDate||"9")?1:-1);
    else if (sortOrder==="締切日順") list = [...list].sort((a,b) => (a.deadlineDate||"9")>(b.deadlineDate||"9")?1:-1);
    else if (sortOrder==="タググループ順") list = [...list].sort((a,b) => (a.tags?.[0]||"")>(b.tags?.[0]||"")?1:-1);
    else if (sortOrder==="完了を最後に") list = [...list].sort((a,b) => a.done===b.done?0:a.done?1:-1);
    return list;
  }, [tasks, filters, sortOrder]);

  const later   = filtered.filter(t => t.isLater||isLaterTask(t));
  const habits  = filtered.filter(t => !(t.isLater||isLaterTask(t)) && t.repeat && parseRepeat(t.repeat).type !== "なし");
  const regular = filtered.filter(t => !(t.isLater||isLaterTask(t)) && (!t.repeat || parseRepeat(t.repeat).type === "なし"));

  // タググループ順：親タグ→その子タグでグループ化
  const TagGroupView = ({items}) => {
    if (items.length === 0) return null;
    const parentTags = tags.filter(t => !t.parentId && !t.archived);
    const noTagItems = items.filter(t => !t.tags?.length);
    return (
      <div>
        {parentTags.map(pt => {
          const childTags = tags.filter(ct => ct.parentId === pt.id && !ct.archived);
          const directItems = items.filter(t => t.tags?.includes(pt.id) && !childTags.some(ct => t.tags?.includes(ct.id)));
          const childGroups = childTags.map(ct => ({
            tag: ct,
            items: items.filter(t => t.tags?.includes(ct.id))
          })).filter(g => g.items.length > 0);
          if (directItems.length === 0 && childGroups.length === 0) return null;
          return (
            <div key={pt.id} style={{marginBottom:14}}>
              <div style={{display:"flex",alignItems:"center",gap:5,marginBottom:5,padding:"3px 0",borderBottom:`1px solid ${pt.color}33`}}>
                <div style={{width:9,height:9,borderRadius:2,background:pt.color,flexShrink:0}}/>
                <span style={{fontSize:11,fontWeight:700,color:pt.color}}>{pt.name}</span>
                <span style={{fontSize:9,color:C.textMuted,background:C.surfHov,padding:"0 5px",borderRadius:6}}>
                  {directItems.length + childGroups.reduce((s,g)=>s+g.items.length,0)}
                </span>
              </div>
              {directItems.map(t => <TaskRow key={t.id} task={t} tags={tags} onEdit={onEdit} onDelete={onDelete} onToggle={onToggle} onAddChild={onAddChild} onDuplicate={onDuplicate} onMemoToggle={onMemoToggle}/>)}
              {childGroups.map(({tag:ct, items:ci}) => (
                <div key={ct.id} style={{marginLeft:12,marginBottom:6}}>
                  <div style={{display:"flex",alignItems:"center",gap:4,marginBottom:3}}>
                    <div style={{width:6,height:6,borderRadius:1.5,background:ct.color,flexShrink:0}}/>
                    <span style={{fontSize:9,fontWeight:700,color:ct.color}}>{ct.name}</span>
                    <span style={{fontSize:8,color:C.textMuted}}>{ci.length}</span>
                  </div>
                  {ci.map(t => <TaskRow key={t.id} task={t} tags={tags} onEdit={onEdit} onDelete={onDelete} onToggle={onToggle} onAddChild={onAddChild} onDuplicate={onDuplicate} onMemoToggle={onMemoToggle}/>)}
                </div>
              ))}
            </div>
          );
        })}
        {noTagItems.length > 0 && (
          <div style={{marginBottom:14}}>
            <div style={{display:"flex",alignItems:"center",gap:5,marginBottom:5}}>
              <span style={{fontSize:10,color:C.textMuted}}>🏷</span>
              <span style={{fontSize:10,fontWeight:700,color:C.textMuted}}>タグなし</span>
              <span style={{fontSize:9,color:C.textMuted,background:C.surfHov,padding:"0 5px",borderRadius:6}}>{noTagItems.length}</span>
            </div>
            {noTagItems.map(t => <TaskRow key={t.id} task={t} tags={tags} onEdit={onEdit} onDelete={onDelete} onToggle={onToggle} onAddChild={onAddChild} onDuplicate={onDuplicate} onMemoToggle={onMemoToggle}/>)}
          </div>
        )}
      </div>
    );
  };

  const Sec = ({title,items,color,icon}) => items.length===0 ? null : (
    <div style={{marginBottom:14}}>
      <div style={{display:"flex",alignItems:"center",gap:5,marginBottom:5}}>
        <span>{icon}</span>
        <span style={{fontSize:10,fontWeight:700,color,textTransform:"uppercase",letterSpacing:.6}}>{title}</span>
        <span style={{fontSize:9,color:C.textMuted,background:C.surfHov,padding:"0 5px",borderRadius:6}}>{items.length}</span>
      </div>
      {sortOrder==="タググループ順"
        ? <TagGroupView items={items}/>
        : items.map(t=><TaskRow key={t.id} task={t} tags={tags} onEdit={onEdit} onDelete={onDelete} onToggle={onToggle} onAddChild={onAddChild} onDuplicate={onDuplicate} onMemoToggle={onMemoToggle}/>)
      }
    </div>
  );

  const [isPC, setIsPC] = useState(window.innerWidth >= 768);
  useEffect(() => {
    const fn = () => setIsPC(window.innerWidth >= 768);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);

  const sortBar = (
    <div style={{display:"flex",alignItems:"center",gap:4,marginBottom:11,flexWrap:"wrap"}}>
      <span style={{fontSize:9,color:C.textMuted,fontWeight:600}}>並び替え</span>
      {SORTS.map(s=><button key={s} onClick={()=>setSortOrder(s)} style={{fontSize:9,padding:"2px 7px",borderRadius:14,border:`1px solid ${sortOrder===s?C.accent:C.border}`,background:sortOrder===s?C.accentS:"transparent",color:sortOrder===s?C.accent:C.textMuted,cursor:"pointer",fontWeight:sortOrder===s?700:400}}>{s}</button>)}
    </div>
  );

  if (isPC) {
    return (
      <div>
        {sortBar}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,alignItems:"start"}}>
          <div>
            <Sec title="タスク" items={regular} color={C.accent} icon="📋"/>
            <Sec title="習慣・繰り返し" items={habits} color={C.success} icon="🔄"/>
            {regular.length===0 && habits.length===0 && <div style={{textAlign:"center",padding:"24px 0",color:C.textMuted,fontSize:12}}>タスクなし 🎉</div>}
          </div>
          <div>
            <Sec title="あとでやる" items={later} color={C.warn} icon="📌"/>
            {later.length===0 && <div style={{textAlign:"center",padding:"24px 0",color:C.textMuted,fontSize:12}}>あとでやるなし</div>}
          </div>
        </div>
        {filtered.length===0 && <div style={{textAlign:"center",padding:"36px 0",color:C.textMuted}}><div style={{fontSize:36,marginBottom:7}}>🎉</div>タスクがありません</div>}
      </div>
    );
  }

  return (
    <div>
      {sortBar}
      <Sec title="タスク"         items={regular} color={C.accent}  icon="📋"/>
      <Sec title="習慣・繰り返し" items={habits}  color={C.success} icon="🔄"/>
      <Sec title="あとでやる"     items={later}   color={C.warn}    icon="📌"/>
      {filtered.length===0 && <div style={{textAlign:"center",padding:"36px 0",color:C.textMuted}}><div style={{fontSize:36,marginBottom:7}}>🎉</div>タスクがありません</div>}
    </div>
  );
};
