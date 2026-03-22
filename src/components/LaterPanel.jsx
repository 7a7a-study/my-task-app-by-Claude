import { useState } from "react";
import { C } from "../constants";
import { flatten, isLaterTask, fd } from "../utils";
import { Pill } from "./ui";

export const LaterPanel = ({tasks,tags,dragTask,setDragTask,onEdit}) => {
  const later = flatten(tasks).filter(t => t.isLater || isLaterTask(t));
  const [open, setOpen] = useState(true);
  return (
    <div style={{width:open?168:28,flexShrink:0,background:C.surface,borderLeft:`1px solid ${C.border}`,display:"flex",flexDirection:"column",overflow:"hidden",transition:"width .2s"}}>
      <div style={{padding:"8px 8px 4px",flexShrink:0,borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",minWidth:0}}>
        {open ? (
          <>
            <div>
              <div style={{fontSize:9,fontWeight:700,color:C.warn,textTransform:"uppercase",letterSpacing:1,whiteSpace:"nowrap"}}>📌 あとでやる</div>
              <div style={{fontSize:8,color:C.textMuted,marginTop:1,whiteSpace:"nowrap"}}>ドラッグで配置 / ✎で編集</div>
            </div>
            <button onClick={()=>setOpen(false)} title="閉じる"
              style={{background:"none",border:"none",color:C.textMuted,cursor:"pointer",fontSize:13,lineHeight:1,flexShrink:0,padding:"0 2px"}}>‹</button>
          </>
        ) : (
          <button onClick={()=>setOpen(true)} title="あとでやるを開く"
            style={{background:"none",border:"none",color:C.warn,cursor:"pointer",fontSize:13,lineHeight:1,width:"100%",padding:"2px 0",display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
            <span>›</span>
            {later.length>0 && <span style={{fontSize:8,background:C.warnS,color:C.warn,borderRadius:8,padding:"1px 3px",fontWeight:700}}>{later.length}</span>}
          </button>
        )}
      </div>
      {open && later.length===0 && <div style={{fontSize:11,color:C.textMuted,textAlign:"center",padding:"12px 0",flex:1}}>なし</div>}
      {open && <div style={{flex:1,overflowY:"auto",padding:"4px 6px 6px"}}>
        {later.map(t => {
          const c = tags.find(tg=>t.tags?.includes(tg.id))?.color || C.accent;
          const isDragging = dragTask?.id===t.id;
          const childTag = tags.find(tg=>t.tags?.includes(tg.id)&&tg.parentId);
          return (
            <div key={t.id} style={{background:isDragging?C.accentS:C.bgSub,borderLeft:`3px solid ${c}`,borderRadius:"0 6px 6px 0",padding:"5px 6px",marginBottom:4,opacity:isDragging?.4:1,position:"relative"}}>
              <div draggable className="drag"
                onDragStart={e=>{e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("laterTaskId",t.id);setDragTask(t);}}
                onDragEnd={()=>setDragTask(null)}>
                {t._pt && <div style={{fontSize:8,color:C.textMuted,marginBottom:1}}>📁{t._pt}</div>}
                <div style={{fontSize:10,fontWeight:600,color:C.text,lineHeight:1.3,paddingRight:16}}>{t.title}</div>
                <div style={{display:"flex",gap:3,flexWrap:"wrap",marginTop:2}}>
                  {t.duration && <span style={{fontSize:8,color:C.accent}}>⏱{t.duration}分</span>}
                  {t.deadlineDate && <span style={{fontSize:8,color:C.warn}}>⚠{fd(t.deadlineDate)}</span>}
                  {childTag && <Pill tag={childTag}/>}
                </div>
              </div>
              <button onClick={()=>onEdit(t)} title="編集"
                style={{position:"absolute",top:4,right:4,background:C.surfHov,color:C.textSub,border:"none",borderRadius:4,width:16,height:16,fontSize:8,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}>✎</button>
            </div>
          );
        })}
      </div>}
    </div>
  );
};
