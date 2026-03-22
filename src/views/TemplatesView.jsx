import { useState } from "react";
import { C } from "../constants";
import { Btn, Modal, Inp, Pill } from "../components/ui";

export const TemplatesView = ({templates, setTemplates, onUse, tags}) => {
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({name: "", tasks: [{title: "", memo: "", tags: [], children: []}]});

  const pt = tags.filter(t => !t.parentId && !t.archived);
  const ct = pid => tags.filter(t => t.parentId === pid && !t.archived);

  const togT = (cur, tid, fn) => {
    const tag = tags.find(t => t.id === tid);
    let nt = [...cur];
    if (nt.includes(tid)) {
      nt = nt.filter(x => x !== tid);
      if (tag?.parentId) {
        const sib = tags.filter(t => t.parentId === tag.parentId && t.id !== tid).some(t => nt.includes(t.id));
        if (!sib) nt = nt.filter(x => x !== tag.parentId);
      } else {
        nt = nt.filter(x => !tags.filter(t => t.parentId === tid).map(t => t.id).includes(x));
      }
    } else {
      nt = [...nt, tid];
      if (tag?.parentId && !nt.includes(tag.parentId)) nt = [...nt, tag.parentId];
    }
    fn(nt);
  };

  const TagRow = ({sel, onChange}) => (
    <div style={{marginBottom: 5}}>
      {pt.map(p => (
        <div key={p.id} style={{marginBottom: 3}}>
          <div
            onClick={() => togT(sel, p.id, onChange)}
            style={{display: "inline-flex", padding: "2px 9px", borderRadius: 12, fontSize: 10, fontWeight: 700, cursor: "pointer", border: `1.5px solid ${p.color}55`, background: sel.includes(p.id) ? p.color + "1e" : "transparent", color: sel.includes(p.id) ? p.color : C.textMuted, marginBottom: 2}}
          >{p.name}</div>
          {ct(p.id).length > 0 && (
            <div style={{display: "flex", flexWrap: "wrap", gap: 3, paddingLeft: 10}}>
              {ct(p.id).map(c => (
                <div
                  key={c.id}
                  onClick={() => togT(sel, c.id, onChange)}
                  style={{display: "inline-flex", padding: "1px 7px", borderRadius: 12, fontSize: 9, fontWeight: 600, cursor: "pointer", border: `1.5px solid ${c.color}55`, background: sel.includes(c.id) ? c.color + "1e" : "transparent", color: sel.includes(c.id) ? c.color : C.textMuted}}
                >└ {c.name}</div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );

  const upT = (i, k, v) => setForm(f => {const ts = [...f.tasks]; ts[i] = {...ts[i], [k]: v}; return {...f, tasks: ts};});
  const upC = (i, j, k, v) => setForm(f => {const ts = [...f.tasks]; ts[i].children[j] = {...ts[i].children[j], [k]: v}; return {...f, tasks: ts};});

  const save = () => {
    if (!form.name.trim()) return;
    setTemplates(t => [...t, {id: "tpl_" + Date.now(), name: form.name, tasks: form.tasks.filter(t => t.title)}]);
    setForm({name: "", tasks: [{title: "", memo: "", tags: [], children: []}]});
    setShow(false);
  };

  return (
    <div>
      <div style={{display: "flex", justifyContent: "flex-end", marginBottom: 9}}>
        <Btn v="accent" onClick={() => setShow(true)}>+ テンプレートを作成</Btn>
      </div>
      {templates.length === 0 && (
        <div style={{textAlign: "center", padding: 28, color: C.textMuted}}>テンプレートがまだありません</div>
      )}
      <div style={{display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 9}}>
        {templates.map(tpl => (
          <div key={tpl.id} style={{background: C.surface, borderRadius: 11, padding: 11, border: `1px solid ${C.border}`, display: "flex", flexDirection: "column", gap: 8}}>
            <div style={{fontFamily: "'Playfair Display',serif", fontWeight: 700, fontSize: 13}}>{tpl.name}</div>
            <div style={{flex: 1}}>
              {tpl.tasks.map((t, i) => (
                <div key={i}>
                  <div style={{display: "flex", alignItems: "center", gap: 4, padding: "3px 0", borderBottom: `1px solid ${C.border}20`, fontSize: 11, color: C.textSub}}>
                    <div style={{width: 4, height: 4, borderRadius: "50%", background: C.accent, flexShrink: 0}}/>
                    {t.title}
                    {(t.tags || []).length > 0 && (
                      <div style={{display: "flex", gap: 2, marginLeft: "auto"}}>
                        {(t.tags || []).map(tid => {
                          const tg = tags.find(x => x.id === tid && x.parentId);
                          return tg ? <Pill key={tid} tag={tg}/> : null;
                        })}
                      </div>
                    )}
                  </div>
                  {(t.children || []).map((c, j) => (
                    <div key={j} style={{display: "flex", alignItems: "center", gap: 4, padding: "2px 0 2px 9px", fontSize: 10, color: C.textMuted}}>
                      <div style={{width: 3, height: 3, borderRadius: "50%", background: C.textMuted, flexShrink: 0}}/>
                      {c.title}
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div style={{display: "flex", gap: 5}}>
              <Btn v="accent" onClick={() => onUse(tpl)} style={{flex: 1, padding: "5px", fontSize: 10}}>使う</Btn>
              <Btn v="danger" onClick={() => setTemplates(t => t.filter(x => x.id !== tpl.id))} style={{padding: "5px 8px", fontSize: 10}}>削除</Btn>
            </div>
          </div>
        ))}
      </div>

      {show && (
        <Modal title="テンプレートを作成" onClose={() => setShow(false)} wide>
          <Inp label="テンプレート名" value={form.name} onChange={v => setForm(f => ({...f, name: v}))} placeholder="例: 週次レビュー"/>
          <div style={{marginBottom: 9}}>
            {form.tasks.map((t, i) => (
              <div key={i} style={{background: C.bgSub, borderRadius: 8, padding: 9, marginBottom: 6, border: `1px solid ${C.border}`}}>
                <div style={{display: "flex", gap: 5, marginBottom: 5}}>
                  <input
                    value={t.title}
                    onChange={e => upT(i, "title", e.target.value)}
                    placeholder={`タスク ${i + 1}`}
                    style={{flex: 1, background: C.surface, color: C.text, padding: "5px 8px", borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 11}}
                  />
                  <button
                    onClick={() => setForm(f => ({...f, tasks: f.tasks.filter((_, idx) => idx !== i)}))}
                    style={{background: C.dangerS, color: C.danger, border: "none", borderRadius: 5, width: 26, fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center"}}
                  >✕</button>
                </div>
                <textarea
                  value={t.memo || ""}
                  onChange={e => upT(i, "memo", e.target.value)}
                  placeholder="メモ"
                  rows={2}
                  style={{width: "100%", background: C.surface, color: C.text, padding: "5px 8px", borderRadius: 5, border: `1px solid ${C.border}`, fontSize: 10, resize: "none", marginBottom: 5}}
                />
                <TagRow sel={t.tags || []} onChange={nt => upT(i, "tags", nt)}/>
                {(t.children || []).map((c, j) => (
                  <div key={j} style={{marginLeft: 10, marginBottom: 4, background: C.surface, borderRadius: 6, padding: 7, border: `1px solid ${C.border}`}}>
                    <div style={{display: "flex", gap: 4, marginBottom: 4, alignItems: "center"}}>
                      <span style={{color: C.textMuted, fontSize: 10}}>└</span>
                      <input
                        value={c.title}
                        onChange={e => upC(i, j, "title", e.target.value)}
                        placeholder={`子タスク ${j + 1}`}
                        style={{flex: 1, background: C.bgSub, color: C.text, padding: "4px 7px", borderRadius: 5, border: `1px solid ${C.border}`, fontSize: 10}}
                      />
                      <button
                        onClick={() => setForm(f => {const ts = [...f.tasks]; ts[i].children = ts[i].children.filter((_, idx) => idx !== j); return {...f, tasks: ts};})}
                        style={{background: C.dangerS, color: C.danger, border: "none", borderRadius: 4, width: 20, height: 20, fontSize: 9, display: "flex", alignItems: "center", justifyContent: "center"}}
                      >✕</button>
                    </div>
                    <textarea
                      value={c.memo || ""}
                      onChange={e => upC(i, j, "memo", e.target.value)}
                      placeholder="子タスクのメモ"
                      rows={2}
                      style={{width: "100%", background: C.bgSub, color: C.text, padding: "4px 7px", borderRadius: 5, border: `1px solid ${C.border}`, fontSize: 9, resize: "none"}}
                    />
                  </div>
                ))}
                <button
                  onClick={() => setForm(f => {const ts = [...f.tasks]; ts[i] = {...ts[i], children: [...(ts[i].children || []), {title: "", memo: "", tags: []}]}; return {...f, tasks: ts};})}
                  style={{background: "none", color: C.accent, border: `1px dashed ${C.accent}44`, borderRadius: 5, padding: "2px 8px", fontSize: 9, cursor: "pointer", marginTop: 2}}
                >+ 子タスク追加</button>
              </div>
            ))}
            <Btn onClick={() => setForm(f => ({...f, tasks: [...f.tasks, {title: "", memo: "", tags: [], children: []}]}))} style={{width: "100%", justifyContent: "center"}}>+ タスク追加</Btn>
          </div>
          <div style={{display: "flex", gap: 6, justifyContent: "flex-end"}}>
            <Btn onClick={() => setShow(false)}>キャンセル</Btn>
            <Btn v="accent" onClick={save}>保存</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
};
