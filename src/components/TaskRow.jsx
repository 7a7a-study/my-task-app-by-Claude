import { useState, useRef } from "react";
import { C } from "../constants";
import { localDate, fdt, isLaterTask, parseRepeat, repeatLabel, renderMemo } from "../utils";
import { CB, Pill, ConfirmDialog } from "./ui";

// ── タスク1行分のコンポーネント ──────────────────────────────────────
// depth: 子タスクのネスト深さ（0=親, 1=子, ...）
// isTouch: ListView側でマウント後に判定してpropsで渡す（タッチ/PC切り替え用）
// memoOpen/onMemoOpen: メモ開閉状態もListView側で管理（tasks更新時に閉じないようにするため）
export const TaskRow = ({task,tags,depth=0,onEdit,onDelete,onToggle,onAddChild,onDuplicate,onMemoToggle,isTouch=false,memoOpen=false,onMemoOpen}) => {

  // ── ローカルstate ───────────────────────────────────────────────
  const [exp, setExp]               = useState(true);   // 子タスク展開/折りたたみ
  const [confirmDel, setConfirmDel] = useState(false);  // 削除確認ダイアログ表示
  const [swipeX, setSwipeX]         = useState(0);      // スワイプ移動量（px）
  const [swiping, setSwiping]       = useState(false);  // スワイプ中フラグ

  // ── スワイプ用ref（stateより高速に参照できるのでrefを使う）─────────
  const touchStartX = useRef(null);
  const touchStartY = useRef(null);
  const swipeXRef   = useRef(0);    // setSwipeXと同期させる（非同期stateの参照ズレ防止）
  const SWIPE_OPEN  = -140;         // スワイプで開く位置（px）

  // ── タスクの状態フラグ ───────────────────────────────────────────
  const tTags   = tags.filter(t => task.tags?.includes(t.id) && t.parentId); // 子タグのみ表示
  const today   = localDate();
  const over    = task.deadlineDate && !task.done && task.deadlineDate < today;   // 期限超過
  const urgent  = task.deadlineDate && !task.done && task.deadlineDate === today;  // 今日締切
  const later   = task.isLater || isLaterTask(task); // あとでやる
  const tc      = tags.find(t => task.tags?.includes(t.id))?.color || C.accent;  // タスクの代表色
  const hasMemo = !!task.memo;

  // ── スワイプ操作ヘルパー ─────────────────────────────────────────
  const setSwipe   = v => { swipeXRef.current = v; setSwipeX(v); }; // refとstateを同時更新
  const closeSwipe = () => setSwipe(0);

  // ── タッチイベント（左スワイプでアクションボタンを表示）────────────
  const onTouchStart = e => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    setSwiping(false);
  };
  const onTouchMove = e => {
    if (touchStartX.current === null) return;
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - touchStartY.current;
    if (!swiping && Math.abs(dx) <= 8) return;           // 微小な動きは無視
    if (!swiping && Math.abs(dy) >= Math.abs(dx)) return; // 縦スクロールはスワイプ扱いしない
    setSwiping(true);
    e.preventDefault(); // スクロールと競合しないようにする
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
      // ── タップ判定 ───────────────────────────────────────────────
      const tag = e.target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "button" || tag === "select" || tag === "textarea") return;
      if (e.target?.closest?.("[data-memo-panel]")) return; // メモパネル内タップは無視
      if (e.target?.closest?.("[data-cb]")) return;         // チェックボックスタップは無視（メモ誤閉じ防止）
      e.preventDefault();
      if (swipeXRef.current <= SWIPE_OPEN / 2) { closeSwipe(); } // スワイプ開いた状態なら閉じる
      else if (hasMemo) { onMemoOpen?.(); }                       // メモがあればメモ開閉
    } else if (wasSwiping) {
      // ── スワイプ終了：途中の位置なら開/閉に吸着 ─────────────────
      setSwipe(swipeXRef.current < SWIPE_OPEN / 2 ? SWIPE_OPEN : 0);
    }
  };

  return (
    // ── 行全体ラッパー（スワイプアクションを overflow:hidden で隠す）──
    <div
      onTouchStart={e=>{if(e.target?.closest?.("[data-memo-panel]")){touchStartX.current=null;touchStartY.current=null;}}}
      style={{marginLeft:depth*16, position:"relative", overflow:"hidden", display:"block", borderRadius:memoOpen?"7px 7px 0 0":7, marginBottom:memoOpen?0:2}}>

      {/* スワイプで現れるアクションボタン群（スマホ専用・タスク行の高さのみ） */}
      <div className="swipe-actions" style={{position:"absolute",right:0,top:0,bottom:0,display:"flex",alignItems:"center",gap:2,paddingRight:6,background:C.bgSub,zIndex:0}}>
        <button onClick={()=>{onAddChild(task.id);closeSwipe();}} style={{background:C.accentS,color:C.accent,border:"none",borderRadius:6,width:28,height:28,fontSize:13,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>+</button>
        <button onClick={()=>{onDuplicate(task);closeSwipe();}}   style={{background:C.successS,color:C.success,border:"none",borderRadius:6,width:28,height:28,fontSize:12,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>⧉</button>
        <button onClick={()=>{onEdit(task);closeSwipe();}}         style={{background:C.surfHov,color:C.textSub,border:"none",borderRadius:6,width:28,height:28,fontSize:12,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>✎</button>
        <button onClick={()=>{setConfirmDel(true);closeSwipe();}} style={{background:C.dangerS,color:C.danger,border:"none",borderRadius:6,width:28,height:28,fontSize:12,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>✕</button>
      </div>

      {/* タスク行本体（スワイプでX軸移動、タッチイベントをここで捕捉） */}
      <div className="hov tr"
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
        style={{display:"flex",alignItems:"center",gap:6,padding:"5px 9px",
          background:depth===0?C.surface:C.bgSub,
          border:`1px solid ${over?C.danger+"55":depth===0?C.border:"transparent"}`,
          borderLeft:depth>0?`3px solid ${tc}55`:undefined, // 子タスクは左ボーダーで親色を示す
          opacity:task.done?.45:1,
          transform:`translateX(${swipeX}px)`,
          transition:swiping?"none":"transform .2s ease",
          position:"relative",zIndex:1,
        }}>

        {/* チェックボックス（data-cbでタッチイベントのバブリングを止める） */}
        <div data-cb="1" onClick={e=>e.stopPropagation()} onTouchEnd={e=>e.stopPropagation()} style={{flexShrink:0,alignSelf:"center"}}>
          <CB checked={task.done} onChange={()=>onToggle(task.id)} color={tc}/>
        </div>

        {/* タスク情報エリア（タップでメモ開閉） */}
        <div style={{flex:1,minWidth:0,cursor:hasMemo?"pointer":"default"}}
          onClick={hasMemo ? e=>{e.stopPropagation();if(e.target?.closest?.("[data-cb]"))return;onMemoOpen?.();} : undefined}>

          {/* 1行目：タイトル・バッジ類 */}
          <div style={{display:"flex",alignItems:"center",gap:4,flexWrap:"wrap",marginBottom:1}}>
            {task.children?.length>0 && <span onClick={e=>{e.stopPropagation();setExp(!exp);}} style={{cursor:"pointer",fontSize:8,color:C.textMuted,transform:exp?"rotate(90deg)":"",transition:"transform .15s",display:"inline-block"}}>▶</span>}
            <span style={{fontSize:12,fontWeight:depth===0?600:400,textDecoration:task.done?"line-through":"none",color:task.done?C.textMuted:C.text}}>{task.title}</span>
            {task.repeat && parseRepeat(task.repeat).type !== "なし" && <span style={{fontSize:8,padding:"1px 4px",borderRadius:6,background:C.successS,color:C.success,fontWeight:600}}>↻{repeatLabel(task.repeat)}</span>}
            {(()=>{const total=(task.sessions||[]).length+(task.startDate?1:0);return total>=1?<span style={{fontSize:8,padding:"1px 4px",borderRadius:6,background:C.accentS,color:C.accent,fontWeight:600}}>📆{total}枠</span>:null;})()}
            {later  && <span style={{fontSize:8,padding:"1px 4px",borderRadius:6,background:C.warnS,color:C.warn,fontWeight:600}}>📌</span>}
            {over   && <span style={{fontSize:8,padding:"1px 4px",borderRadius:6,background:C.dangerS,color:C.danger,fontWeight:600}}>⚠超過</span>}
            {urgent && <span style={{fontSize:8,padding:"1px 4px",borderRadius:6,background:C.warnS,color:C.warn,fontWeight:600}}>🔥今日</span>}
            {hasMemo && <span style={{fontSize:8,color:C.textMuted,opacity:.6}}>{memoOpen?"▲":"📝"}</span>}
          </div>

          {/* 2行目：タグ・日時・所要時間 */}
          <div style={{display:"flex",gap:4,flexWrap:"wrap",alignItems:"center"}}>
            {tTags.map(t=><Pill key={t.id} tag={t}/>)}
            {task.startDate    && <span style={{fontSize:9,color:C.textMuted}}>▶{fdt(task.startDate,task.startTime)}</span>}
            {task.duration     && <span style={{fontSize:9,color:C.accent}}>⏱{task.duration}分</span>}
            {task.deadlineDate && <span style={{fontSize:9,color:over?C.danger:C.warn}}>⚠{fdt(task.deadlineDate,task.deadlineTime)}</span>}
          </div>
        </div>

        {/* PCホバー時のアクションボタン群（.tr:hover .ta で表示、タッチ時は非表示） */}
        {!isTouch && !task.done && (
          <div className="ta" style={{display:"flex",gap:3,flexShrink:0}}>
            <button onClick={()=>onAddChild(task.id)} style={{background:C.accentS,color:C.accent,border:"none",borderRadius:6,width:28,height:28,fontSize:13,display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
            <button onClick={()=>onDuplicate(task)}   style={{background:C.successS,color:C.success,border:"none",borderRadius:6,width:28,height:28,fontSize:12,display:"flex",alignItems:"center",justifyContent:"center"}}>⧉</button>
            <button onClick={()=>onEdit(task)}         style={{background:C.surfHov,color:C.textSub,border:"none",borderRadius:6,width:28,height:28,fontSize:12,display:"flex",alignItems:"center",justifyContent:"center"}}>✎</button>
            <button onClick={()=>setConfirmDel(true)}  style={{background:C.dangerS,color:C.danger,border:"none",borderRadius:6,width:28,height:28,fontSize:12,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
          </div>
        )}
      </div>

      {/* 削除確認ダイアログ */}
      {confirmDel && <ConfirmDialog title="タスクを削除" message={`「${task.title}」を削除しますか？\n子タスクも一緒に削除されます。`} onConfirm={()=>{onDelete(task.id);setConfirmDel(false);}} onCancel={()=>setConfirmDel(false)}/>}

      {/* メモパネル（memoOpenがtrueのときのみ表示。タッチイベントを止めてスワイプと干渉しない） */}
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

      {/* 子タスクを再帰レンダリング（expがtrueのとき展開） */}
      {exp && task.children?.map(c=><TaskRow key={c.id} task={c} tags={tags} depth={depth+1} onEdit={onEdit} onDelete={onDelete} onToggle={onToggle} onAddChild={onAddChild} onDuplicate={onDuplicate} onMemoToggle={onMemoToggle}/>)}
    </div>
  );
};
