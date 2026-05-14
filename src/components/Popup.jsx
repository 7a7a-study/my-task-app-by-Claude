import { useState } from "react";
import { C } from "../constants";
import { localDate, fdt, renderMemo, parseRepeat, repeatLabel } from "../utils";
import { CB, Btn, Pill, ConfirmDialog } from "./ui";

export const Popup = ({task,tags,onClose,onEdit,onToggle,onDelete,onMemoToggle,onDuplicate,onSkip,onOverride,onAddSession,onRemoveSession,anchor,viewDate}) => {
  const tTags = tags.filter(t => task.tags?.includes(t.id) && t.parentId);
  const tc = tags.find(t => task.tags?.includes(t.id))?.color || C.accent;
  const over = task.deadlineDate && !task.done && task.deadlineDate < localDate();
  const isRepeat = (task.repeat && parseRepeat(task.repeat).type !== "なし") || !!task._overrideKey;
  const s0 = task.sessions?.[0] || {};
  const origDate = task._overrideKey || viewDate || s0.date || task.deadlineDate || "";
  const [showOverride, setShowOverride] = useState(false);
  const [confirmDel, setConfirmDel]   = useState(false);
  const [showAddSession, setShowAddSession] = useState(false);
  const [newSession, setNewSession] = useState({startDate: viewDate||"", startTime:"", endDate: viewDate||"", endTime:""});
  const [ov, setOv] = useState({
    startDate: viewDate||s0.date||"", startTime: s0.startTime||"",
    endDate: task.endDate||"",     endTime: s0.endTime||"",
    deadlineDate: task.deadlineDate||"", deadlineTime: task.deadlineTime||"",
  });
  const ovInp = (k,v) => {
    if (k === "startDate") {
      setOv(p => {
        const prevStart = p.startDate || "";
        const prevEnd = p.endDate || "";
        let newEnd = v;
        if (prevStart && prevEnd && prevEnd >= prevStart) {
          const diff = (new Date(prevEnd) - new Date(prevStart)) / 86400000;
          const d = new Date(v); d.setDate(d.getDate() + Math.round(diff));
          newEnd = d.toISOString().slice(0,10);
        }
        return {...p, startDate:v, endDate:newEnd};
      });
    } else {
      setOv(p=>({...p,[k]:v}));
    }
  };
  const inpStyle = {background:C.bgSub,color:C.text,padding:"3px 6px",borderRadius:5,border:`1px solid ${C.border}`,fontSize:10,width:"100%"};
  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,zIndex:500}}>
      <div onClick={e=>e.stopPropagation()} style={{position:"fixed",top:Math.min(anchor?.y||80,window.innerHeight-420),left:Math.min(anchor?.x||80,window.innerWidth-308),background:C.surface,borderRadius:12,padding:13,border:`1px solid ${C.border}`,width:296,boxShadow:"0 16px 48px rgba(0,0,0,.68)",zIndex:501,maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{position:"absolute",top:0,left:0,right:0,height:3,borderRadius:"12px 12px 0 0",background:`linear-gradient(90deg,${tc},${tc}55)`}}/>
        <div style={{display:"flex",alignItems:"flex-start",gap:8,marginBottom:8,marginTop:3}}>
          <CB checked={task.done} onChange={()=>{onToggle(task._overrideId||task.id, task._overrideKey||undefined);onClose();}} size={16} color={tc}/>
          <div style={{flex:1,minWidth:0}}>
            {task._pt && <div style={{fontSize:9,color:C.textMuted,marginBottom:1}}>📁 {task._pt}</div>}
            <div style={{fontSize:13,fontWeight:700,textDecoration:task.done?"line-through":"none",color:task.done?C.textMuted:C.text,lineHeight:1.3}}>{task.title}</div>
            {task._overrideKey && <div style={{fontSize:8,color:C.accent,marginTop:2}}>📅 今回だけ変更済み（元：{task._overrideKey}）</div>}
            {tTags.length>0 && <div style={{display:"flex",flexWrap:"wrap",gap:3,marginTop:4}}>{tTags.map(t=><Pill key={t.id} tag={t}/>)}</div>}
          </div>
        </div>
        {((task.sessions||[]).length > 0 || task.duration || task.deadlineDate || task.repeat !== "なし") && (
          <div style={{background:C.bg,borderRadius:7,padding:"6px 8px",marginBottom:8,fontSize:11,display:"flex",flexDirection:"column",gap:3}}>
            {(s0.startDate||s0.date) && (() => {
              const sd = s0.startDate||s0.date;
              const ed = s0.endDate||task.endDate||"";
              const diffDay = ed && ed !== sd;
              return (
                <div style={{color:C.textSub,display:"flex",gap:4,flexWrap:"wrap"}}>
                  <span style={{color:C.accent}}>▶</span>
                  {fdt(sd, s0.startTime)}
                  {(diffDay || s0.endTime) && <span style={{color:C.textMuted}}>→</span>}
                  {diffDay && <span>{fdt(ed, s0.endTime)}</span>}
                  {!diffDay && s0.endTime && <span>{s0.endTime}</span>}
                </div>
              );
            })()}
            {task.duration && <div style={{color:C.accent}}>⏱ {task.duration}分</div>}
            {task.deadlineDate && <div style={{color:over?C.danger:C.warn}}>⚠ {fdt(task.deadlineDate,task.deadlineTime)}</div>}
            {task.repeat && parseRepeat(task.repeat).type !== "なし" && <div style={{color:C.success}}>↻ {repeatLabel(task.repeat)}</div>}
          </div>
        )}
        {task.memo && <div onClick={e=>e.stopPropagation()} style={{background:C.bg,borderRadius:7,padding:"6px 8px",marginBottom:8,maxHeight:110,overflowY:"auto"}}>{renderMemo(task.memo, idx=>onMemoToggle(task._overrideId||task.id,idx))}</div>}
        {isRepeat && !showOverride && (
          <div style={{display:"flex",gap:4,marginBottom:8}}>
            <button onClick={()=>setShowOverride(true)}
              style={{flex:1,padding:"4px 6px",borderRadius:6,border:`1px solid ${C.accent}44`,background:C.accentS,color:C.accent,fontSize:9,cursor:"pointer",fontWeight:600}}>
              📅 今回だけ日程変更
            </button>
            <button onClick={()=>{onSkip(task._overrideId||task.id, origDate);onClose();}}
              style={{flex:1,padding:"4px 6px",borderRadius:6,border:`1px solid ${C.warn}44`,background:C.warnS,color:C.warn,fontSize:9,cursor:"pointer",fontWeight:600}}>
              ⏭ 今回だけスキップ
            </button>
          </div>
        )}
        {showOverride && (
          <div style={{background:C.bg,borderRadius:8,padding:"8px 9px",marginBottom:8,border:`1px solid ${C.accent}44`}}>
            <div style={{fontSize:9,fontWeight:700,color:C.accent,marginBottom:6}}>📅 今回だけ日程変更</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr",gap:3,marginBottom:4}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:3}}>
                <div><div style={{fontSize:8,color:C.textMuted,marginBottom:2}}>開始日</div><input type="date" value={ov.startDate} onChange={e=>ovInp("startDate",e.target.value)} style={inpStyle}/></div>
                <div><div style={{fontSize:8,color:C.textMuted,marginBottom:2}}>開始時刻</div><input type="time" value={ov.startTime} onChange={e=>ovInp("startTime",e.target.value)} style={inpStyle}/></div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:3}}>
                <div><div style={{fontSize:8,color:C.textMuted,marginBottom:2}}>終了日</div><input type="date" value={ov.endDate} onChange={e=>ovInp("endDate",e.target.value)} style={inpStyle}/></div>
                <div><div style={{fontSize:8,color:C.textMuted,marginBottom:2}}>終了時刻</div><input type="time" value={ov.endTime} onChange={e=>ovInp("endTime",e.target.value)} style={inpStyle}/></div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:3}}>
                <div><div style={{fontSize:8,color:C.textMuted,marginBottom:2}}>締切日</div><input type="date" value={ov.deadlineDate} onChange={e=>ovInp("deadlineDate",e.target.value)} style={inpStyle}/></div>
                <div><div style={{fontSize:8,color:C.textMuted,marginBottom:2}}>締切時刻</div><input type="time" value={ov.deadlineTime} onChange={e=>ovInp("deadlineTime",e.target.value)} style={inpStyle}/></div>
              </div>
            </div>
            <div style={{fontSize:8,color:C.textMuted,marginBottom:6}}>元の日付（キー）: {origDate}</div>
            <div style={{display:"flex",gap:4}}>
              <Btn onClick={()=>setShowOverride(false)} style={{flex:1,padding:"4px",fontSize:9}}>キャンセル</Btn>
              <Btn v="accent" onClick={()=>{onOverride(task._overrideId||task.id, origDate, ov);onClose();}} style={{flex:1,padding:"4px",fontSize:9}}>保存</Btn>
            </div>
          </div>
        )}
        {onAddSession && !showOverride && (
          <div style={{marginBottom:8}}>
            {!showAddSession ? (
              <button onClick={()=>setShowAddSession(true)}
                style={{width:"100%",padding:"4px 6px",borderRadius:6,border:`1px solid ${C.success}44`,background:C.successS,color:C.success,fontSize:9,cursor:"pointer",fontWeight:600}}>
                📆 時間枠を追加
              </button>
            ) : (
              <div style={{background:C.bg,borderRadius:8,padding:"8px 9px",border:`1px solid ${C.success}44`}}>
                <div style={{fontSize:9,fontWeight:700,color:C.success,marginBottom:6}}>📆 時間枠を追加</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:3,marginBottom:6}}>
                  <div><div style={{fontSize:8,color:C.textMuted,marginBottom:2}}>開始日</div><input type="date" value={newSession.startDate} onChange={e=>{
  const nv=e.target.value;
  setNewSession(p=>{
    const prevS=p.startDate||"", prevE=p.endDate||"";
    let ne=nv;
    if(prevS&&prevE&&prevE>=prevS){const diff=(new Date(prevE)-new Date(prevS))/86400000;const d=new Date(nv);d.setDate(d.getDate()+Math.round(diff));ne=d.toISOString().slice(0,10);}
    return {...p,startDate:nv,endDate:ne};
  });
}} style={inpStyle}/></div>
                  <div><div style={{fontSize:8,color:C.textMuted,marginBottom:2}}>開始時刻</div><input type="time" value={newSession.startTime} onChange={e=>setNewSession(p=>({...p,startTime:e.target.value}))} style={inpStyle}/></div>
                  <div><div style={{fontSize:8,color:C.textMuted,marginBottom:2}}>終了日</div><input type="date" value={newSession.endDate} onChange={e=>setNewSession(p=>({...p,endDate:e.target.value}))} style={inpStyle}/></div>
                  <div><div style={{fontSize:8,color:C.textMuted,marginBottom:2}}>終了時刻</div><input type="time" value={newSession.endTime} onChange={e=>setNewSession(p=>({...p,endTime:e.target.value}))} style={inpStyle}/></div>
                </div>
                <div style={{display:"flex",gap:4}}>
                  <Btn onClick={()=>setShowAddSession(false)} style={{flex:1,padding:"4px",fontSize:9}}>キャンセル</Btn>
                  <Btn v="success" onClick={()=>{
                    if(!newSession.startDate) return;
                    onAddSession(task._overrideId||task.id, {...newSession, date:newSession.startDate, id:"s_"+Date.now()});
                    setShowAddSession(false);
                    setNewSession({startDate:viewDate||"",startTime:"",endDate:viewDate||"",endTime:""});
                    onClose();
                  }} style={{flex:1,padding:"4px",fontSize:9}}>追加</Btn>
                </div>
              </div>
            )}
          </div>
        )}
        {!confirmDel && (
          <div style={{display:"flex",gap:5}}>
            <Btn v="accent" onClick={()=>{onEdit(task._overrideKey ? {...task,id:task._overrideId} : task);onClose();}} style={{flex:1,padding:"5px 7px",fontSize:10}}>✎ 編集</Btn>
            <Btn v="success" onClick={()=>{onDuplicate(task._overrideKey ? {...task,id:task._overrideId} : task);onClose();}} style={{padding:"5px 8px",fontSize:10}} title="複製して編集">⧉</Btn>
            <Btn v="danger" onClick={e=>{e.stopPropagation();setConfirmDel(true);}} style={{padding:"5px 8px",fontSize:10}} title="削除">✕</Btn>
          </div>
        )}
        {confirmDel && (
          <div onClick={e=>e.stopPropagation()} style={{background:C.bg,borderRadius:9,padding:12,marginTop:8,border:`1px solid ${C.danger}44`}}>
            <div style={{fontSize:10,fontWeight:700,color:C.danger,marginBottom:10}}>
              {task._sessionOnly ? "⚠️ この時間枠をどうしますか？" : "⚠️ 削除方法を選択"}
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {onRemoveSession && (s0.startDate||s0.date) && (
                <Btn v="warn" style={{fontSize:10,padding:"8px 10px",textAlign:"left",borderRadius:8}} onClick={e=>{e.stopPropagation(); onRemoveSession(task.id, task._sessionId||null); onClose();}}>
                  📅 この時間枠を削除（タスクは残す）
                </Btn>
              )}
              <div style={{borderTop:`1px solid ${C.border}`,margin:"2px 0"}}/>
              <Btn v="danger" style={{fontSize:10,padding:"8px 10px",textAlign:"left",borderRadius:8}} onClick={e=>{e.stopPropagation(); onDelete(task._overrideId||task.id); onClose();}}>
                🗑 タスクごと完全に削除
              </Btn>
              <Btn style={{fontSize:10,padding:"6px 8px"}} onClick={e=>{e.stopPropagation();setConfirmDel(false);}}>キャンセル</Btn>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
