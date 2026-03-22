import { useState, useRef } from "react";
import { C } from "../constants";
import { Btn, Inp, ConfirmDialog } from "../components/ui";

export const TagsView = ({tags, setTags}) => {
  const [form, setForm]         = useState({name: "", color: "#8bb8d4", parentId: null});
  const [colorOpen, setColorOpen] = useState(false);
  const [editId, setEditId]     = useState(null);
  const [ef, setEf]             = useState(null);
  const [showA, setShowA]       = useState(false);
  const [confirmTag, setConfirmTag] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const dragIdRef  = useRef(null);
  const dragCtxRef = useRef(null);
  const touchDragRef = useRef(null);
  const touchOverRef = useRef(null);

  const add = () => {
    if (!form.name.trim()) return;
    setTags(t => [...t, {id: "tag_" + Date.now(), name: form.name, color: form.color, parentId: form.parentId || null, archived: false}]);
    setForm({name: "", color: "#8bb8d4", parentId: null});
    setColorOpen(false);
  };

  const arch      = id => setTags(ts => ts.map(t => t.id === id ? {...t, archived: true} : t));
  const rest      = id => setTags(ts => ts.map(t => t.id === id ? {...t, archived: false} : t));
  const deleteTag = id => { setTags(ts => ts.filter(t => t.id !== id && t.parentId !== id)); setConfirmTag(null); };

  const reorder = (fromId, targetId) => {
    setTags(ts => {
      const a = [...ts];
      const fi = a.findIndex(t => t.id === fromId);
      const ti = a.findIndex(t => t.id === targetId);
      if (fi < 0 || ti < 0) return ts;
      const [m] = a.splice(fi, 1);
      a.splice(ti, 0, m);
      return a;
    });
  };

  const onParentDragStart = (e, id) => { e.stopPropagation(); dragIdRef.current = id; dragCtxRef.current = "parent"; e.dataTransfer.effectAllowed = "move"; };
  const onParentDragOver  = (e, id) => { e.preventDefault(); e.stopPropagation(); setDragOverId(id); };
  const onParentDrop      = (e, targetId) => {
    e.preventDefault(); e.stopPropagation(); setDragOverId(null);
    if (dragCtxRef.current !== "parent") return;
    const fromId = dragIdRef.current;
    if (!fromId || fromId === targetId) return;
    reorder(fromId, targetId);
    dragIdRef.current = null; dragCtxRef.current = null;
  };

  const onChildDragStart = (e, id, parentId) => { e.stopPropagation(); dragIdRef.current = id; dragCtxRef.current = parentId; e.dataTransfer.effectAllowed = "move"; };
  const onChildDragOver  = (e, id) => { e.preventDefault(); e.stopPropagation(); setDragOverId(id); };
  const onChildDrop      = (e, targetId, parentId) => {
    e.preventDefault(); e.stopPropagation(); setDragOverId(null);
    if (dragCtxRef.current !== parentId) return;
    const fromId = dragIdRef.current;
    if (!fromId || fromId === targetId) return;
    reorder(fromId, targetId);
    dragIdRef.current = null; dragCtxRef.current = null;
  };

  const onTouchStart = (e, id, ctx) => {
    e.stopPropagation();
    const touch = e.touches[0];
    touchDragRef.current = null;
    touchOverRef.current = null;
    window._tagLongPress = setTimeout(() => {
      touchDragRef.current = {id, ctx, startY: touch.clientY};
    }, 500);
  };
  const onTouchMove = (e) => {
    if (!touchDragRef.current) { clearTimeout(window._tagLongPress); return; }
    e.preventDefault();
    const touch = e.touches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    if (!el) return;
    const row = el.closest("[data-tagid]");
    if (row) {
      const overId = row.getAttribute("data-tagid");
      if (overId !== touchOverRef.current) { touchOverRef.current = overId; setDragOverId(overId); }
    }
  };
  const onTouchEnd = (e, ctx) => {
    clearTimeout(window._tagLongPress);
    if (!touchDragRef.current) return;
    const fromId = touchDragRef.current.id;
    const fromCtx = touchDragRef.current.ctx;
    const targetId = touchOverRef.current;
    setDragOverId(null); touchDragRef.current = null; touchOverRef.current = null;
    if (!targetId || targetId === fromId) return;
    if (fromCtx === ctx) reorder(fromId, targetId);
  };

  const pt = tags.filter(t => !t.parentId && !t.archived);
  const ct = pid => tags.filter(t => t.parentId === pid && !t.archived);
  const at = tags.filter(t => t.archived);

  const saveEdit = () => {
    const isParent = !tags.find(t => t.id === editId)?.parentId;
    setTags(ts => ts.map(t => {
      if (t.id === editId) return {...t, ...ef};
      if (isParent && t.parentId === editId) return {...t, color: ef.color};
      return t;
    }));
    setEditId(null);
  };

  const ER = ({t}) => editId === t.id && ef ? (
    <div style={{background: C.bgSub, borderRadius: 6, padding: 8, marginTop: 5, display: "flex", gap: 6, alignItems: "flex-end", flexWrap: "wrap"}}>
      <div style={{flex: 1, minWidth: 100}}>
        <Inp label="タグ名" value={ef.name} onChange={v => setEf(f => ({...f, name: v}))}/>
      </div>
      <div style={{marginBottom: 7}}>
        <div style={{fontSize: 8, color: C.textMuted, marginBottom: 2, fontWeight: 700}}>色</div>
        <input type="color" value={ef.color} onChange={e => setEf(f => ({...f, color: e.target.value}))} style={{width: 34, height: 30, borderRadius: 5, border: `1px solid ${C.border}`, background: "none", cursor: "pointer", padding: 2}}/>
      </div>
      {!tags.find(x => x.id === editId)?.parentId && (
        <div style={{fontSize: 8, color: C.textMuted, marginBottom: 7, alignSelf: "flex-end", paddingBottom: 8}}>※色変更時は子タグも連動</div>
      )}
      <div style={{marginBottom: 7, display: "flex", gap: 4}}>
        <Btn v="accent" onClick={saveEdit}>保存</Btn>
        <Btn onClick={() => setEditId(null)}>✕</Btn>
      </div>
    </div>
  ) : null;

  return (
    <div>
      {confirmTag && (
        <ConfirmDialog
          title="タグを削除"
          message={confirmTag.isParent
            ? `「${confirmTag.name}」と、その子タグをすべて削除しますか？\nタスクのタグ設定も外れます。`
            : `「${confirmTag.name}」を削除しますか？\nタスクのタグ設定も外れます。`}
          onConfirm={() => deleteTag(confirmTag.id)}
          onCancel={() => setConfirmTag(null)}
        />
      )}

      {/* 新規作成フォーム */}
      <div style={{background: C.surface, borderRadius: 11, padding: 11, border: `1px solid ${C.border}`, marginBottom: 9}}>
        <div style={{fontFamily: "'Playfair Display',serif", fontWeight: 700, marginBottom: 8, fontSize: 13}}>新しいタグを作成</div>
        <div style={{display: "grid", gridTemplateColumns: "1fr 50px", gap: 6, marginBottom: 6}}>
          <Inp label="タグ名" value={form.name} onChange={v => setForm(f => ({...f, name: v}))} placeholder="タグ名..."/>
          <div style={{position: "relative"}}>
            <div style={{fontSize: 8, color: C.textMuted, marginBottom: 3, fontWeight: 700}}>色</div>
            <div
              onClick={() => setColorOpen(o => !o)}
              style={{width: 32, height: 28, borderRadius: 6, background: form.color, cursor: "pointer", border: `2px solid ${C.border}`, boxShadow: "0 2px 6px rgba(0,0,0,.3)"}}
            />
            {colorOpen && (
              <div style={{position: "absolute", top: 54, right: 0, zIndex: 200, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 10, boxShadow: "0 8px 24px rgba(0,0,0,.5)", width: 136}}>
                <div style={{display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6, marginBottom: 8}}>
                  {["#8bb8d4","#7aaa82","#c47878","#c8a96e","#b8c4b0","#a89bc4","#d4a882","#94b8a0"].map(col => (
                    <div key={col} onClick={() => {setForm(f => ({...f, color: col})); setColorOpen(false);}} style={{width: 24, height: 24, borderRadius: 5, background: col, cursor: "pointer", border: `2px solid ${form.color === col ? "#fff" : "transparent"}`}}/>
                  ))}
                </div>
                <input type="color" value={form.color} onChange={e => setForm(f => ({...f, color: e.target.value}))} style={{width: "100%", height: 26, borderRadius: 5, border: `1px solid ${C.border}`, background: "none", cursor: "pointer", padding: 2}}/>
                <div style={{fontSize: 9, color: C.textMuted, marginTop: 3, textAlign: "center"}}>カスタム色</div>
              </div>
            )}
          </div>
        </div>
        <div style={{marginBottom: 6}}>
          <div style={{fontSize: 8, color: C.textMuted, marginBottom: 2, fontWeight: 700, textTransform: "uppercase", letterSpacing: .4}}>親タグ</div>
          <select
            value={form.parentId || ""}
            onChange={e => { const p = tags.find(t => t.id === e.target.value); setForm(f => ({...f, parentId: e.target.value || null, color: p ? p.color : f.color})); }}
            style={{width: "100%", background: C.bgSub, color: C.text, padding: "5px 8px", borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 11}}
          >
            <option value="">なし（親タグ）</option>
            {pt.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <Btn v="accent" onClick={add}>追加</Btn>
      </div>

      <div style={{fontSize: 9, color: C.textMuted, marginBottom: 5}}>⠿ ドラッグ（PC）またはロングタップ後スワイプ（モバイル）で順序変更</div>

      {/* 親タグ一覧 */}
      <div style={{display: "flex", flexDirection: "column", gap: 6}}>
        {pt.map(p => (
          <div
            key={p.id} data-tagid={p.id} draggable
            onDragStart={e => onParentDragStart(e, p.id)}
            onDragOver={e => onParentDragOver(e, p.id)}
            onDrop={e => onParentDrop(e, p.id)}
            onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOverId(null); }}
            onDragEnd={() => setDragOverId(null)}
            onTouchStart={e => onTouchStart(e, p.id, "parent")}
            onTouchMove={e => onTouchMove(e)}
            onTouchEnd={e => onTouchEnd(e, "parent")}
            style={{background: C.surface, borderRadius: 10, padding: 10, border: `2px solid ${dragOverId === p.id ? C.accent : p.color + "33"}`, cursor: "grab", transition: "border-color .15s"}}
          >
            <div style={{display: "flex", justifyContent: "space-between", alignItems: "center"}}>
              <div style={{display: "flex", alignItems: "center", gap: 6}}>
                <span style={{color: C.textMuted, fontSize: 13, userSelect: "none"}}>⠿</span>
                <div style={{width: 10, height: 10, borderRadius: "50%", background: p.color}}/>
                <span style={{fontWeight: 700, color: p.color, fontSize: 13}}>{p.name}</span>
                <span style={{fontSize: 8, color: C.textMuted, background: C.surfHov, padding: "0 4px", borderRadius: 5}}>親</span>
              </div>
              <div style={{display: "flex", gap: 3}}>
                <Btn onClick={e => { e.stopPropagation(); setEditId(p.id); setEf({name: p.name, color: p.color}); }} style={{padding: "2px 7px", fontSize: 9}}>編集</Btn>
                <Btn v="danger" onClick={e => { e.stopPropagation(); arch(p.id); }} style={{padding: "2px 7px", fontSize: 9}}>アーカイブ</Btn>
                <Btn v="danger" onClick={e => { e.stopPropagation(); setConfirmTag({id: p.id, name: p.name, isParent: true}); }} style={{padding: "2px 7px", fontSize: 9}}>削除</Btn>
              </div>
            </div>
            <ER t={p}/>
            {ct(p.id).length > 0 && (
              <div style={{paddingLeft: 14, marginTop: 6, display: "flex", flexDirection: "column", gap: 3}}>
                {ct(p.id).map(c => (
                  <div
                    key={c.id} data-tagid={c.id} draggable
                    onDragStart={e => onChildDragStart(e, c.id, p.id)}
                    onDragOver={e => onChildDragOver(e, c.id)}
                    onDrop={e => onChildDrop(e, c.id, p.id)}
                    onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOverId(null); }}
                    onDragEnd={() => setDragOverId(null)}
                    onTouchStart={e => onTouchStart(e, c.id, p.id)}
                    onTouchMove={e => onTouchMove(e)}
                    onTouchEnd={e => onTouchEnd(e, p.id)}
                    style={{background: C.bgSub, borderRadius: 7, border: `2px solid ${dragOverId === c.id ? C.accent : c.color + "33"}`, padding: "5px 8px", cursor: "grab", transition: "border-color .15s"}}
                  >
                    <div style={{display: "flex", justifyContent: "space-between", alignItems: "center"}}>
                      <div style={{display: "flex", alignItems: "center", gap: 5}}>
                        <span style={{color: C.textMuted, fontSize: 11, userSelect: "none"}}>⠿</span>
                        <div style={{width: 7, height: 7, borderRadius: "50%", background: c.color}}/>
                        <span style={{fontSize: 11, color: c.color, fontWeight: 600}}>{c.name}</span>
                      </div>
                      <div style={{display: "flex", gap: 3}}>
                        <Btn onClick={e => { e.stopPropagation(); setEditId(c.id); setEf({name: c.name, color: c.color}); }} style={{padding: "2px 6px", fontSize: 9}}>編集</Btn>
                        <Btn v="danger" onClick={e => { e.stopPropagation(); arch(c.id); }} style={{padding: "2px 6px", fontSize: 9}}>アーカイブ</Btn>
                        <Btn v="danger" onClick={e => { e.stopPropagation(); setConfirmTag({id: c.id, name: c.name, isParent: false}); }} style={{padding: "2px 6px", fontSize: 9}}>削除</Btn>
                      </div>
                    </div>
                    <ER t={c}/>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* アーカイブ済み */}
      {at.length > 0 && (
        <div style={{marginTop: 12}}>
          <button onClick={() => setShowA(!showA)} style={{background: "none", border: "none", color: C.textMuted, fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, marginBottom: 5}}>
            {showA ? "▼" : "▶"} アーカイブ済み ({at.length})
          </button>
          {showA && (
            <div style={{display: "flex", flexDirection: "column", gap: 4}}>
              {at.map(t => (
                <div key={t.id} style={{background: C.surface, borderRadius: 7, padding: "6px 10px", border: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", opacity: .55}}>
                  <div style={{display: "flex", alignItems: "center", gap: 5}}>
                    <div style={{width: 7, height: 7, borderRadius: "50%", background: t.color}}/>
                    <span style={{fontSize: 11, color: C.textSub}}>{t.name}</span>
                  </div>
                  <div style={{display: "flex", gap: 3}}>
                    <Btn onClick={() => rest(t.id)} style={{padding: "2px 6px", fontSize: 9}}>復元</Btn>
                    <Btn v="danger" onClick={() => setConfirmTag({id: t.id, name: t.name, isParent: !t.parentId})} style={{padding: "2px 6px", fontSize: 9}}>完全削除</Btn>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
