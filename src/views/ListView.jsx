import { useState, useEffect, useMemo } from "react";
import { C, SORTS } from "../constants";
import { parseRepeat, isLaterTask, localDate } from "../utils";
import { TaskRow } from "../components/TaskRow";

// ── タイムラインチップ（日/週ビューで使う時間軸上のタスクブロック）──
// col/totalCols: overlap時の横分割位置（デフォルト0/1=全幅）
// isDone: 繰り返しタスクの当日done判定（通常タスクはtask.doneをそのまま使う）
export const TimelineChip = ({task,tags,color,startMin,endMin,dayStartMin,ppm,onPopup,onToggle,onUpdate,onRSStart,col=0,totalCols=1,isDone}) => {
  const top  = (startMin - dayStartMin) * ppm;
  const h    = Math.max(22, (endMin - startMin) * ppm);
  const over = task.deadlineDate && !task.done && task.deadlineDate < localDate();
  const done = isDone !== undefined ? isDone : task.done;
  const colW = `${100 / totalCols}%`;
  const colL = `${col * 100 / totalCols}%`;
  return (
    <div className="drag" draggable
      onDragStart={e=>{e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("taskId",task.id);e.stopPropagation();}}
      onClick={e=>{e.stopPropagation();onPopup(e,task);}}
      style={{position:"absolute",top,left:`calc(${colL} + 1px)`,width:`calc(${colW} - 2px)`,height:h,
        background:done?C.border+"38":color+"22",
        borderLeft:`3px solid ${done?C.textMuted:color}`,
        borderRadius:"0 5px 5px 0",overflow:"hidden",display:"flex",flexDirection:"column",
        justifyContent:"space-between",zIndex:2,userSelect:"none",cursor:"grab",opacity:done?.5:1}}>
      <div style={{padding:"2px 4px 0",flex:1,minHeight:0,overflow:"hidden"}}>
        {/* 1行目: 時間 */}
        <div style={{display:"flex",alignItems:"center",gap:3,marginBottom:1}}>
          <div onClick={e=>{e.stopPropagation();onToggle(task.id);}}
            style={{width:7,height:7,borderRadius:1.5,border:`1.5px solid ${done?C.textMuted:color}`,
              background:done?color:"transparent",flexShrink:0,cursor:"pointer",
              display:"flex",alignItems:"center",justifyContent:"center"}}>
            {done && <span style={{color:"#fff",fontSize:5,fontWeight:900,lineHeight:1}}>✓</span>}
          </div>
          <span style={{fontSize:9,color:done?C.textMuted:color,opacity:.9,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
            {task.startTime}{task.endTime?`〜${task.endTime}`:""}
          </span>
          {over && <span style={{fontSize:7,color:C.danger,flexShrink:0}}>⚠</span>}
        </div>
        {/* 2行目: タイトル */}
        <div style={{fontSize:10,fontWeight:600,color:done?C.textMuted:color,
          overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis",
          textDecoration:done?"line-through":"none",paddingLeft:10}}>
          {task.title}
        </div>
        {h > 52 && task._pt && <div style={{fontSize:7,color:C.textMuted,paddingLeft:10}}>📁{task._pt}</div>}
      </div>
      <div className="rh" onMouseDown={e=>onRSStart(e,task)} onTouchStart={e=>onRSStart(e,task)} onClick={e=>e.stopPropagation()}
        style={{height:7,background:color+"30",borderTop:`1px dashed ${color}55`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
        <div style={{width:14,height:1.5,borderRadius:1,background:color+"88"}}/>
      </div>
    </div>
  );
};

// ── リストビュー本体 ──────────────────────────────────────────────────
export const ListView = ({tasks,tags,filters,onEdit,onDelete,onToggle,onAddChild,onDuplicate,onMemoToggle,sortOrder,setSortOrder}) => {

  // ── フィルタ＆ソート（filtersやsortOrderが変わったときだけ再計算）──
  const filtered = useMemo(() => {
    let list = tasks;
    if (filters.tag)           list = list.filter(t => t.tags?.includes(filters.tag));
    if (filters.search)        list = list.filter(t => t.title.toLowerCase().includes(filters.search.toLowerCase()));
    if (filters.hideCompleted) list = list.filter(t => !t.done);
    if (sortOrder==="開始日順")       list = [...list].sort((a,b) => (a.startDate||"9")>(b.startDate||"9")?1:-1);
    else if (sortOrder==="締切日順")   list = [...list].sort((a,b) => (a.deadlineDate||"9")>(b.deadlineDate||"9")?1:-1);
    else if (sortOrder==="タググループ順") list = [...list].sort((a,b) => (a.tags?.[0]||"")>(b.tags?.[0]||"")?1:-1);
    else if (sortOrder==="完了を最後に") list = [...list].sort((a,b) => a.done===b.done?0:a.done?1:-1);
    return list;
  }, [tasks, filters, sortOrder]);

  // ── セクション分類（通常タスク / 繰り返し / あとでやる）────────────
  const later   = filtered.filter(t => t.isLater||isLaterTask(t));
  const habits  = filtered.filter(t => !(t.isLater||isLaterTask(t)) && t.repeat && parseRepeat(t.repeat).type !== "なし");
  const regular = filtered.filter(t => !(t.isLater||isLaterTask(t)) && (!t.repeat || parseRepeat(t.repeat).type === "なし"));

  // ── タググループ表示（ソート「タググループ順」のときに使うサブコンポーネント）──
  const TagGroupView = ({items}) => {
    if (items.length === 0) return null;
    const parentTags = tags.filter(t => !t.parentId && !t.archived);
    const noTagItems = items.filter(t => !t.tags?.length);
    return (
      <div>
        {parentTags.map(pt => {
          const childTags   = tags.filter(ct => ct.parentId === pt.id && !ct.archived);
          const directItems = items.filter(t => t.tags?.includes(pt.id) && !childTags.some(ct => t.tags?.includes(ct.id)));
          const childGroups = childTags.map(ct => ({
            tag: ct,
            items: items.filter(t => t.tags?.includes(ct.id))
          })).filter(g => g.items.length > 0);
          if (directItems.length === 0 && childGroups.length === 0) return null;
          return (
            <div key={pt.id} style={{marginBottom:14}}>
              {/* 親タグのヘッダー */}
              <div style={{display:"flex",alignItems:"center",gap:5,marginBottom:5,padding:"3px 0",borderBottom:`1px solid ${pt.color}33`}}>
                <div style={{width:9,height:9,borderRadius:2,background:pt.color,flexShrink:0}}/>
                <span style={{fontSize:11,fontWeight:700,color:pt.color}}>{pt.name}</span>
                <span style={{fontSize:9,color:C.textMuted,background:C.surfHov,padding:"0 5px",borderRadius:6}}>
                  {directItems.length + childGroups.reduce((s,g)=>s+g.items.length,0)}
                </span>
              </div>
              {directItems.map(t => <TaskRow key={t.id} task={t} tags={tags} onEdit={onEdit} onDelete={onDelete} onToggle={onToggle} onAddChild={onAddChild} onDuplicate={onDuplicate} onMemoToggle={onMemoToggle} isTouch={isTouch} memoOpen={!!memoOpenMap[t.id]} onMemoOpen={()=>toggleMemo(t.id)}/>)}
              {/* 子タグのグループ */}
              {childGroups.map(({tag:ct, items:ci}) => (
                <div key={ct.id} style={{marginLeft:12,marginBottom:6}}>
                  <div style={{display:"flex",alignItems:"center",gap:4,marginBottom:3}}>
                    <div style={{width:6,height:6,borderRadius:1.5,background:ct.color,flexShrink:0}}/>
                    <span style={{fontSize:9,fontWeight:700,color:ct.color}}>{ct.name}</span>
                    <span style={{fontSize:8,color:C.textMuted}}>{ci.length}</span>
                  </div>
                  {ci.map(t => <TaskRow key={t.id} task={t} tags={tags} onEdit={onEdit} onDelete={onDelete} onToggle={onToggle} onAddChild={onAddChild} onDuplicate={onDuplicate} onMemoToggle={onMemoToggle} isTouch={isTouch} memoOpen={!!memoOpenMap[t.id]} onMemoOpen={()=>toggleMemo(t.id)}/>)}
                </div>
              ))}
            </div>
          );
        })}
        {/* タグなしのタスク */}
        {noTagItems.length > 0 && (
          <div style={{marginBottom:14}}>
            <div style={{display:"flex",alignItems:"center",gap:5,marginBottom:5}}>
              <span style={{fontSize:10,color:C.textMuted}}>🏷</span>
              <span style={{fontSize:10,fontWeight:700,color:C.textMuted}}>タグなし</span>
              <span style={{fontSize:9,color:C.textMuted,background:C.surfHov,padding:"0 5px",borderRadius:6}}>{noTagItems.length}</span>
            </div>
            {noTagItems.map(t => <TaskRow key={t.id} task={t} tags={tags} onEdit={onEdit} onDelete={onDelete} onToggle={onToggle} onAddChild={onAddChild} onDuplicate={onDuplicate} onMemoToggle={onMemoToggle} isTouch={isTouch} memoOpen={!!memoOpenMap[t.id]} onMemoOpen={()=>toggleMemo(t.id)}/>)}
          </div>
        )}
      </div>
    );
  };

  // ── セクションヘッダー付きのタスクリスト（Sec = Section）──────────
  const Sec = ({title,items,color,icon}) => items.length===0 ? null : (
    <div style={{marginBottom:14}}>
      <div style={{display:"flex",alignItems:"center",gap:5,marginBottom:5}}>
        <span>{icon}</span>
        <span style={{fontSize:10,fontWeight:700,color,textTransform:"uppercase",letterSpacing:.6}}>{title}</span>
        <span style={{fontSize:9,color:C.textMuted,background:C.surfHov,padding:"0 5px",borderRadius:6}}>{items.length}</span>
      </div>
      {sortOrder==="タググループ順"
        ? <TagGroupView items={items}/>
        : items.map(t=><TaskRow key={t.id} task={t} tags={tags} onEdit={onEdit} onDelete={onDelete} onToggle={onToggle} onAddChild={onAddChild} onDuplicate={onDuplicate} onMemoToggle={onMemoToggle} isTouch={isTouch} memoOpen={!!memoOpenMap[t.id]} onMemoOpen={()=>toggleMemo(t.id)}/>)
      }
    </div>
  );

  // ── デバイス判定・メモ開閉状態（ここで管理することでtasks更新時に閉じない）──
  const [isPC, setIsPC]       = useState(window.innerWidth >= 768);
  const [isTouch, setIsTouch] = useState(true); // 安全側デフォルト=true（スマホ扱い）
  const [memoOpenMap, setMemoOpenMap] = useState({}); // { taskId: bool } でメモ開閉を管理
  useEffect(() => {
    setIsPC(window.innerWidth >= 768);
    // ontouchstart の有無でタッチデバイスを判定（matchMediaより確実）
    setIsTouch("ontouchstart" in window || navigator.maxTouchPoints > 0);
    const fn = () => setIsPC(window.innerWidth >= 768);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);
  const toggleMemo = (id) => setMemoOpenMap(m => ({...m, [id]: !m[id]}));

  // ── 並び替えボタンバー ───────────────────────────────────────────
  const sortBar = (
    <div style={{display:"flex",alignItems:"center",gap:4,marginBottom:11,flexWrap:"wrap"}}>
      <span style={{fontSize:9,color:C.textMuted,fontWeight:600}}>並び替え</span>
      {SORTS.map(s=><button key={s} onClick={()=>setSortOrder(s)} style={{fontSize:9,padding:"2px 7px",borderRadius:14,border:`1px solid ${sortOrder===s?C.accent:C.border}`,background:sortOrder===s?C.accentS:"transparent",color:sortOrder===s?C.accent:C.textMuted,cursor:"pointer",fontWeight:sortOrder===s?700:400}}>{s}</button>)}
    </div>
  );

  // ── PC表示：4カラムレイアウト（左2列: タスク+繰り返し / 右2列: あとでやる）──
  if (isPC) {
    return (
      <div>
        {sortBar}
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:16,alignItems:"start"}}>
          {/* 左2列: タスク + 習慣 */}
          <div style={{gridColumn:"1 / 3"}}>
            <Sec title="タスク"         items={regular} color={C.accent}  icon="📋"/>
            <Sec title="習慣・繰り返し" items={habits}  color={C.success} icon="🔄"/>
            {regular.length===0 && habits.length===0 && <div style={{textAlign:"center",padding:"24px 0",color:C.textMuted,fontSize:12}}>タスクなし 🎉</div>}
          </div>
          {/* 右2列: あとでやる */}
          <div style={{gridColumn:"3 / 5",borderLeft:`1px solid ${C.border}`,paddingLeft:16}}>
            <Sec title="あとでやる" items={later} color={C.warn} icon="📌"/>
            {later.length===0 && <div style={{textAlign:"center",padding:"24px 0",color:C.textMuted,fontSize:12}}>あとでやるなし</div>}
          </div>
        </div>
        {filtered.length===0 && <div style={{textAlign:"center",padding:"36px 0",color:C.textMuted}}><div style={{fontSize:36,marginBottom:7}}>🎉</div>タスクがありません</div>}
      </div>
    );
  }

  // ── スマホ表示：1カラムレイアウト ───────────────────────────────
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
