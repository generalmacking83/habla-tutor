(() => {
"use strict";
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

const LANG = {
  es:{name:"Spanish", native:"Español", tts:"es"},
  en:{name:"English", native:"English", tts:"en"}
};
const SCENARIOS = [
  ["free","Free chat: get to know each other"],
  ["cafe","Ordering at a café"],
  ["travel","Asking for directions while travelling"],
  ["hotel","Checking into a hotel with a problem"],
  ["doctor","Describing symptoms at a clinic"],
  ["work","A team meeting at work"],
  ["interview","A job interview"],
  ["phone","Calling customer service about a wrong charge"]
];
const CATS = ["articles","gender/agreement","verb conjugation","tense/aspect","ser/estar","por/para","subjunctive","prepositions","word choice","word order","accents/spelling","punctuation","register","other"];

// ---------- storage ----------
const STORE = "habla-app-v1";
function load(){
  try{ const d = JSON.parse(localStorage.getItem(STORE)||"null"); if(d && d.notebook) return d; }catch(e){}
  return {notebook:{es:[],en:[]}, cats:{es:{},en:{}}, words:{es:0,en:0}, msgs:{es:0,en:0},
          cfg:{provider:"gemini", key:"", gemModel:"", baseUrl:"https://api.groq.com/openai/v1", oaModel:"openai/gpt-oss-120b", dialect:"es-ES"},
          lang:"es", convo:null};
}
let data = load();
function save(){ try{ localStorage.setItem(STORE, JSON.stringify(data)); }catch(e){} }
let lang = data.lang || "es";

// conversation state
let convo = data.convo; // {lang, level, scenario, explain, strict, history:[], view:[]}
let busy = false, ctl = null;

// ---------- AI ----------
function parseJSON(text){
  if(!text) throw new Error("Empty reply");
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if(fence) t = fence[1].trim();
  try{ return JSON.parse(t); }catch(_){}
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if(a>=0 && b>a) return JSON.parse(t.slice(a,b+1));
  throw new Error("The AI's reply wasn't in the expected format. Send again.");
}

async function callAI(system, turns, opts={}){
  const c = data.cfg;
  if(!c.key) throw new Error("Add your API key in Settings ⚙.");
  const signal = opts.signal;
  if(c.provider==="gemini"){
    if(!c.gemModel) throw new Error("Pick a model in Settings ⚙ (press Load list).");
    const model = c.gemModel.replace(/^models\//,"");
    const body = {
      systemInstruction:{parts:[{text:system}]},
      contents: turns.map(t=>({role: t.role==="assistant"?"model":"user", parts:[{text:t.content}]})),
      generationConfig:{temperature: opts.temperature ?? 0.7, responseMimeType:"application/json"}
    };
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method:"POST", headers:{"Content-Type":"application/json","x-goog-api-key":c.key}, body:JSON.stringify(body), signal});
    const j = await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(apiError(r.status, j.error && j.error.message));
    const cand = j.candidates && j.candidates[0];
    const text = cand && cand.content && cand.content.parts ? cand.content.parts.map(p=>p.text||"").join("") : "";
    if(!text) throw new Error(cand && cand.finishReason ? `No reply (${cand.finishReason}). Try rephrasing.` : "The AI sent an empty reply. Send again.");
    return parseJSON(text);
  } else {
    const base = (c.baseUrl||"").replace(/\/+$/,"");
    const payload = {model:c.oaModel, temperature: opts.temperature ?? 0.7,
      messages:[{role:"system",content:system}, ...turns.map(t=>({role:t.role, content:t.content}))],
      response_format:{type:"json_object"}};
    let r = await fetch(base+"/chat/completions", {method:"POST", headers:{"Content-Type":"application/json","Authorization":"Bearer "+c.key}, body:JSON.stringify(payload), signal});
    if(r.status===400){ // some models reject JSON mode; retry without it
      delete payload.response_format;
      r = await fetch(base+"/chat/completions", {method:"POST", headers:{"Content-Type":"application/json","Authorization":"Bearer "+c.key}, body:JSON.stringify(payload), signal});
    }
    const j = await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(apiError(r.status, j.error && (j.error.message||j.error)));
    const text = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    return parseJSON(text);
  }
}
function apiError(status, msg){
  if(status===400 && /api key/i.test(msg||"")) return "That API key isn't valid. Check it in Settings ⚙.";
  if(status===401||status===403) return "The AI service rejected your key. Check it in Settings ⚙.";
  if(status===404) return "That model wasn't found. Pick another in Settings ⚙.";
  if(status===429) return "You've hit the free tier's rate limit. Wait a minute (or until tomorrow for the daily limit) and try again.";
  if(status>=500) return "The AI service is having trouble. Try again in a moment.";
  return "Request failed ("+status+")"+(msg?": "+String(msg).slice(0,160):"");
}

// ---------- prompts ----------
function scenLabel(id){ const s = SCENARIOS.find(x=>x[0]===id); return s ? s[1] : id; }
function rules(c){
  const L = LANG[c.lang].name, lvl = c.level, ex = c.explain;
  const variety = c.lang==="es" ? (data.cfg.dialect==="es-MX" ? " Use Latin American (Mexican) Spanish: ustedes, not vosotros, and Latin American vocabulary." : " Use Spain Spanish (vosotros is fine).") : "";
  const strict = c.strict==="all"
    ? "Correct every error, including missing accents, ñ, ¿ ¡ marks, and capitalisation."
    : "Correct only errors that matter: grammar, wrong words, and anything that changes or blurs meaning. Ignore missing accents, punctuation, ¿ ¡ marks and capitalisation (the learner types on a phone).";
  return `You are a warm, patient ${L} conversation tutor. The learner's level is CEFR ${lvl}. Scenario: "${scenLabel(c.scenario)}". You play the other person in this scenario and stay in character.${variety}

Every time you answer, reply with ONLY one JSON object in this shape:
{"reply":"your next line in ${L}","reply_translation":"that line translated into ${ex}","correction":{"ok":true,"corrected":"","notes":[{"original":"exact words from the learner's message","better":"corrected words","why":"one short sentence in ${ex}","category":"word choice"}]},"new_words":[{"term":"a word or phrase from YOUR reply","meaning":"its meaning in ${ex}"}]}

Rules for "reply":
- Write only in ${L}, pitched at ${lvl}: ${lvl==="A1"||lvl==="A2"?"short sentences, common words, mostly present tense":lvl==="B1"?"everyday vocabulary, some past and future, simple linking words":"natural, idiomatic speech with a range of structures"}.
- One to three sentences. End with a question or prompt that keeps the conversation moving.
- If the learner writes in another language or says they don't understand, help them in simple ${L} and keep going.

Rules for "correction" (about the learner's LAST message only):
- ${strict}
- If nothing needs fixing: ok=true, corrected="", notes=[].
- Otherwise ok=false, "corrected" = their whole message rewritten correctly and naturally in ${L}, plus up to 3 notes, most important first. "original" must be copied exactly from their message.
- "category" must be one of: ${CATS.join(", ")}.
- If the last user turn is the [Start] instruction, set ok=true.

Rules for "new_words": 0 to 3 items from your own reply that are useful at ${lvl}. Skip words a ${lvl} learner surely knows.`;
}

// ---------- rendering ----------
function tutorHTML(r, i){
  const words = (r.new_words||[]).filter(w=>w&&w.term).slice(0,3);
  const saved = new Set(data.notebook[convo.lang].map(w=>w.term.toLowerCase()));
  return `<div class="bubble">${esc(r.reply)}</div>
    <div class="tools"><button class="tiny" data-say="${i}">🔊 Listen</button><button class="tiny" data-tr="${i}">Translation</button></div>
    <div class="trans" data-trbox="${i}" hidden>${esc(r.reply_translation||"")}</div>
    ${words.length?`<div class="words">${words.map(w=>{const s=saved.has(w.term.toLowerCase());return `<button class="word" data-term="${esc(w.term)}" data-mean="${esc(w.meaning||"")}" aria-pressed="${s}">${s?"✓":"+"} ${esc(w.term)}</button>`;}).join("")}</div>`:""}`;
}
function fixHTML(c){
  if(!c) return "";
  if(c.ok || !c.notes || !c.notes.length) return c.ok ? `<div class="fix ok">✓ Correct</div>` : (c.corrected?`<div class="fix"><div class="label">More natural</div><div class="better">${esc(c.corrected)}</div></div>`:"");
  return `<div class="fix">${c.corrected?`<div class="label">Corrected</div><div class="better">${esc(c.corrected)}</div>`:""}
    ${c.notes.slice(0,3).map(n=>`<div class="note"><div class="pair"><span class="chip">${esc(n.category||"other")}</span><del>${esc(n.original)}</del> → <ins>${esc(n.better)}</ins></div><div class="why">${esc(n.why)}</div></div>`).join("")}</div>`;
}
function renderThread(){
  const th = $("thread"); th.innerHTML = "";
  convo.view.forEach((v,i) => {
    const d = document.createElement("div");
    if(v.type==="t"){ d.className="msg t"; d.innerHTML = tutorHTML(v.r, i); }
    else { d.className="msg u"; d.innerHTML = `<div class="bubble">${esc(v.text)}</div>` + (v.pending?`<div class="typing">${esc(v.pending)}</div>`:fixHTML(v.correction)); }
    th.appendChild(d);
  });
  if(busy){ const d=document.createElement("div"); d.className="msg t"; d.innerHTML=`<div class="typing">Typing…</div>`; th.appendChild(d); }
  requestAnimationFrame(()=>{ const v=$("vChat"); v.scrollTop = v.scrollHeight; });
}
function renderChat(){
  const has = convo && convo.lang===lang;
  $("setupCard").hidden = has; $("convo").hidden = !has; $("composer").hidden = !has || $("vChat").hidden;
  $("setupTitle").textContent = lang==="es" ? "¿Listo para practicar?" : "Ready to practise?";
  $("keyNote").hidden = !!data.cfg.key;
  $("accents").hidden = lang!=="es";
  if(has){
    $("sceneTitle").textContent = `${LANG[convo.lang].native} · ${convo.level} · ${scenLabel(convo.scenario)}`;
    $("input").placeholder = lang==="es" ? "Escribe o habla…" : "Type or speak…";
    renderThread();
  }
  setControls();
}
function setControls(){
  $("sendBtn").disabled = busy; $("hintBtn").disabled = busy;
  $("reviewBtn").disabled = busy || !convo || convo.view.filter(v=>v.type==="u").length<3;
  $("startBtn").disabled = busy;
}
function alertMsg(msg, kind){ const a=$("alert"); if(!msg){a.hidden=true;return;} a.hidden=false; a.className="alert"+(kind?" "+kind:""); a.innerHTML=msg; }

// ---------- conversation flow ----------
async function turn(userText){
  const isStart = userText==null;
  busy = true; alertMsg(""); $("sugs").hidden = true;
  const content = isStart ? `[Start] Open the conversation in character: greet me and set the scene for "${scenLabel(convo.scenario)}". There is no learner message yet.` : userText;
  convo.history.push({role:"user", content});
  let uv = null;
  if(!isStart){ uv = {type:"u", text:userText, pending:"Checking…"}; convo.view.push(uv); }
  renderThread(); setControls();
  ctl = new AbortController();
  try{
    let hist = convo.history.slice(-24); while(hist.length && hist[0].role!=="user") hist.shift();
    const r = await callAI(rules(convo), hist, {signal: ctl.signal});
    if(!r || typeof r.reply!=="string" || !r.reply.trim()) throw new Error("The AI's reply wasn't in the expected format. Send again.");
    convo.history.push({role:"assistant", content:r.reply});
    if(uv){
      delete uv.pending; uv.correction = r.correction || null;
      const L = convo.lang;
      data.words[L] += (userText.match(/\S+/g)||[]).length; data.msgs[L] += 1;
      if(r.correction && !r.correction.ok) (r.correction.notes||[]).forEach(n=>{ const k=CATS.includes(n.category)?n.category:"other"; data.cats[L][k]=(data.cats[L][k]||0)+1; });
    }
    convo.view.push({type:"t", r:{reply:r.reply, reply_translation:r.reply_translation, new_words:r.new_words}});
  }catch(e){
    convo.history.pop();
    if(uv){ convo.view.pop(); $("input").value = userText; }
    if(e.name!=="AbortError") alertMsg(esc(e.message || "Something went wrong. Try again."), "err");
    if(isStart && !convo.view.length){ convo = null; }
  }finally{
    busy = false; ctl = null; data.convo = convo; save();
    if(convo) renderThread(); else renderChat();
    setControls(); renderSide();
  }
}

$("startBtn").onclick = () => {
  if(!data.cfg.key){ $("keyNote").hidden=false; openSettings(); return; }
  convo = {lang, level:$("level").value, scenario:$("scenario").value, explain:$("explain").value, strict:$("strict").value, history:[], view:[]};
  $("reviewCard").hidden = true;
  renderChat(); alertMsg("");
  // show composer area & thread while opening
  turn(null);
};
function send(){
  if(busy) return;
  if(recording) stopMic();
  const t = $("input").value.trim(); if(!t) return;
  $("input").value = ""; autosize(); turn(t);
}
$("sendBtn").onclick = send;
$("input").addEventListener("keydown", e => { if(e.key==="Enter" && !e.shiftKey && !e.isComposing){ e.preventDefault(); send(); } });
function autosize(){ const t=$("input"); t.style.height="auto"; t.style.height=Math.min(140,t.scrollHeight)+"px"; }
$("input").addEventListener("input", autosize);

$("newBtn").onclick = () => { if(ctl) ctl.abort(); convo = null; data.convo = null; save(); $("reviewCard").hidden=true; alertMsg(""); renderChat(); };

// thread clicks
$("thread").addEventListener("click", e => {
  const b = e.target.closest("button"); if(!b) return;
  if(b.dataset.say!=null){ const v=convo.view[+b.dataset.say]; if(v) speak(v.r.reply, convo.lang); }
  else if(b.dataset.tr!=null){ const box=$("thread").querySelector(`[data-trbox="${b.dataset.tr}"]`); if(box) box.hidden=!box.hidden; }
  else if(b.dataset.term){
    const nb = data.notebook[convo.lang], term=b.dataset.term;
    const i = nb.findIndex(w=>w.term.toLowerCase()===term.toLowerCase());
    if(i>=0){ nb.splice(i,1); b.setAttribute("aria-pressed","false"); b.textContent="+ "+term; }
    else { nb.unshift({term, meaning:b.dataset.mean, t:Date.now()}); b.setAttribute("aria-pressed","true"); b.textContent="✓ "+term; }
    save(); renderNotebook(); renderThread();
  }
});

// accents
const ACC = ["á","é","í","ó","ú","ñ","ü","¿","¡"];
$("accents").innerHTML = ACC.map(c=>`<button type="button" class="acc" data-c="${c}">${c}</button>`).join("");
$("accents").addEventListener("pointerdown", e => e.preventDefault()); // keep keyboard open
$("accents").addEventListener("click", e => {
  const c = e.target.dataset && e.target.dataset.c; if(!c) return;
  const t=$("input"); const s=t.selectionStart??t.value.length, en=t.selectionEnd??s;
  t.value = t.value.slice(0,s)+c+t.value.slice(en); t.focus(); t.selectionStart=t.selectionEnd=s+c.length;
});

// hints
$("hintBtn").onclick = async () => {
  if(busy || !convo) return;
  const last = [...convo.view].reverse().find(v=>v.type==="t"); if(!last) return;
  busy = true; setControls(); $("hintBtn").textContent = "Thinking…";
  try{
    const r = await callAI(`You help a ${convo.level} learner of ${LANG[convo.lang].name}. Reply with only JSON.`,
      [{role:"user", content:`Scenario: "${scenLabel(convo.scenario)}". The other person just said: "${last.r.reply}". Suggest 3 different short replies the learner could give, in ${LANG[convo.lang].name} at ${convo.level} level, each with a different intent. Reply with only {"suggestions":["...","...","..."]}`}], {temperature:0.9});
    const s = (r && r.suggestions || []).slice(0,3);
    $("sugs").innerHTML = s.map(x=>`<button class="sug">${esc(x)}</button>`).join("");
    $("sugs").hidden = !s.length;
  }catch(e){ alertMsg(esc(e.message), "err"); }
  finally{ busy=false; $("hintBtn").textContent="Suggest replies"; setControls(); }
};
$("sugs").addEventListener("click", e => { const b=e.target.closest(".sug"); if(!b) return; $("input").value=b.textContent; autosize(); $("input").focus(); $("sugs").hidden=true; });

// review
$("reviewBtn").onclick = async () => {
  if(busy || !convo) return;
  const msgs = convo.view.filter(v=>v.type==="u");
  if(msgs.length<3) return;
  busy = true; setControls();
  const rc = $("reviewCard"); rc.hidden = false; rc.innerHTML = `<p class="muted">Reviewing ${msgs.length} messages…</p>`;
  const log = msgs.map((m,i)=>{ const n=(m.correction&&!m.correction.ok&&m.correction.notes)||[]; return `${i+1}. ${m.text}${n.length?`  [errors: ${n.map(x=>`${x.original} → ${x.better} (${x.category})`).join("; ")}]`:"  [no errors]"}`; }).join("\n");
  try{
    const r = await callAI(`You are a ${LANG[convo.lang].name} tutor. Reply with only JSON.`, [{role:"user", content:
`Review this ${convo.level} learner's messages from one conversation ("${scenLabel(convo.scenario)}"). Write everything except example sentences in ${convo.explain}.

${log.slice(0,8000)}

Reply with only:
{"summary":"two sentences on how it went","strengths":["up to 2"],"patterns":[{"pattern":"name of a repeated issue","example":"a correct ${LANG[convo.lang].name} example sentence","tip":"one practical tip"}],"practice":"one specific thing to do next conversation"}
Up to 3 patterns, only ones that repeat or matter most. If there were few errors, say so.`}]);
    rc.innerHTML = `<div class="label">Session review</div><p style="margin:0">${esc(r.summary)}</p>
      ${r.strengths&&r.strengths.length?`<div><div class="label">Went well</div><ul>${r.strengths.map(s=>`<li>${esc(s)}</li>`).join("")}</ul></div>`:""}
      ${r.patterns&&r.patterns.length?`<div><div class="label">Work on</div><ul>${r.patterns.map(p=>`<li><b>${esc(p.pattern)}</b>: ${esc(p.tip)}<br><span style="font-family:var(--f-text);color:var(--ins)">${esc(p.example)}</span></li>`).join("")}</ul></div>`:""}
      ${r.practice?`<div><div class="label">Next time</div><p style="margin:0">${esc(r.practice)}</p></div>`:""}`;
  }catch(e){ rc.innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
  finally{ busy=false; setControls(); requestAnimationFrame(()=>rc.scrollIntoView({behavior:"smooth",block:"start"})); }
};

// ---------- speech ----------
function srLang(L){ return L==="es" ? (data.cfg.dialect||"es-ES") : "en-US"; }
function speak(text, L){
  try{
    const synth = window.speechSynthesis; if(!synth) throw 0;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const want = srLang(L).toLowerCase(); const voices = synth.getVoices();
    const v = voices.find(v=>v.lang && v.lang.toLowerCase().replace("_","-")===want) || voices.find(v=>v.lang && v.lang.toLowerCase().startsWith(LANG[L].tts));
    if(v) u.voice = v; u.lang = srLang(L);
    u.rate = convo && ["A1","A2"].includes(convo.level) ? 0.85 : 0.95;
    synth.speak(u);
  }catch(_){ alertMsg("Read-aloud isn't available on this device.", ""); }
}
if(window.speechSynthesis){ try{ speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged = () => {}; }catch(_){} }

let recording = false, rec = null;
function startMic(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR){ alertMsg("Speech recognition isn't supported in this browser. Use Chrome, or tap the mic on your keyboard."); return; }
  try{
    rec = new SR(); rec.lang = srLang(convo ? convo.lang : lang); rec.interimResults = true; rec.continuous = false;
    const base = $("input").value ? $("input").value.trim()+" " : "";
    rec.onresult = e => { let t=""; for(const r of e.results) t += r[0].transcript; $("input").value = base + t; autosize(); };
    rec.onerror = e => {
      if(e.error==="not-allowed"||e.error==="service-not-allowed") alertMsg("Microphone access is blocked. Allow it in Chrome's site settings for this app.", "err");
      else if(e.error==="network") alertMsg("Speech recognition needs an internet connection.", "err");
      else if(e.error!=="no-speech" && e.error!=="aborted") alertMsg("Couldn't hear that. Try again.", "");
    };
    rec.onend = () => stopMic();
    rec.start(); recording = true; $("micBtn").classList.add("on"); $("micBtn").setAttribute("aria-label","Stop listening");
  }catch(_){ stopMic(); }
}
function stopMic(){
  recording = false; const r = rec; rec = null; if(r){ try{ r.stop(); }catch(_){} }
  $("micBtn").classList.remove("on"); $("micBtn").setAttribute("aria-label","Speak");
}
$("micBtn").onclick = () => recording ? stopMic() : startMic();

// ---------- notebook & progress ----------
function renderNotebook(){
  const nb = data.notebook[lang];
  $("nbLang").textContent = `${LANG[lang].native} · ${nb.length} saved`;
  $("notebook").innerHTML = nb.length ? nb.map((w,i)=>`<div class="nb-item"><b>${esc(w.term)}</b><span>${esc(w.meaning)}</span><div class="acts"><button class="tiny" data-nbsay="${i}" aria-label="Listen to ${esc(w.term)}">🔊</button><button class="tiny" data-nbdel="${i}">Remove</button></div></div>`).join("")
    : `<p class="muted" style="margin-top:12px">Tap a gold word under the tutor's messages to save it here.</p>`;
}
$("notebook").addEventListener("click", e => {
  const b = e.target.closest("button"); if(!b) return; const nb = data.notebook[lang];
  if(b.dataset.nbsay!=null) speak(nb[+b.dataset.nbsay].term, lang);
  if(b.dataset.nbdel!=null){ nb.splice(+b.dataset.nbdel,1); save(); renderNotebook(); }
});
function renderSide(){
  renderNotebook();
  const c = Object.entries(data.cats[lang]).sort((a,b)=>b[1]-a[1]).slice(0,8);
  const w = data.words[lang]||0; const max = c.length?c[0][1]:1;
  $("cats").innerHTML = c.length ? c.map(([k,v])=>`<div class="cat-row"><span>${esc(k)}</span><span style="font-variant-numeric:tabular-nums">${v}${w?` <span class="muted" style="font-size:12px">· ${(v/w*100).toFixed(1)} per 100 words</span>`:""}</span><div class="cat-bar"><i style="width:${v/max*100}%"></i></div></div>`).join("") + `<div id="resetWrap"><button class="tiny" id="resetCats">Reset ${LANG[lang].name} counts</button></div>`
    : `<p class="muted">Corrections you get in ${LANG[lang].name} are counted here so you can see your patterns.</p>`;
  $("totals").innerHTML = `<p style="margin:0">${data.msgs[lang]||0} messages · ${w} words written in ${LANG[lang].name} · ${data.notebook[lang].length} words saved</p>`;
  const rb = $("resetCats"); if(rb) rb.onclick = () => { $("resetWrap").innerHTML = `Reset? <button class="tiny" id="yesR">Yes, reset</button> <button class="tiny" id="noR">Cancel</button>`; $("yesR").onclick=()=>{ data.cats[lang]={}; data.words[lang]=0; data.msgs[lang]=0; save(); renderSide(); }; $("noR").onclick=renderSide; };
}

// ---------- tabs & language ----------
function showTab(t){
  [["tChat","vChat"],["tNb","vNb"],["tPr","vPr"]].forEach(([b,v])=>{ $(b).setAttribute("aria-selected", b===t); $(v).hidden = b!==t; });
  renderChat();
}
$("tChat").onclick = () => showTab("tChat");
$("tNb").onclick = () => showTab("tNb");
$("tPr").onclick = () => showTab("tPr");
function setLang(l){
  if(busy) return;
  lang = l; data.lang = l; save();
  $("lEs").setAttribute("aria-pressed", l==="es"); $("lEn").setAttribute("aria-pressed", l==="en");
  if(convo && convo.lang!==l){ convo = null; data.convo = null; save(); }
  renderChat(); renderSide();
}
$("lEs").onclick = () => setLang("es");
$("lEn").onclick = () => setLang("en");

// ---------- settings ----------
const dlg = $("settings");
function syncProviderFields(){ const g = $("provider").value==="gemini"; $("gemFields").hidden=!g; $("oaFields").hidden=g; }
function openSettings(){
  const c = data.cfg;
  $("provider").value = c.provider; $("apiKey").value = c.key; $("baseUrl").value = c.baseUrl; $("oaModel").value = c.oaModel; $("dialect").value = c.dialect||"es-ES";
  const sel = $("gemModel"); if(c.gemModel && ![...sel.options].some(o=>o.value===c.gemModel)) sel.innerHTML = `<option value="${esc(c.gemModel)}">${esc(c.gemModel)}</option>` + sel.innerHTML;
  sel.value = c.gemModel || "";
  if(!sel.options.length) sel.innerHTML = `<option value="">Press Load list →</option>`;
  syncProviderFields(); setMsg("");
  if(typeof dlg.showModal==="function") dlg.showModal(); else dlg.setAttribute("open","");
}
function setMsg(m, k){ const a=$("setMsg"); if(!m){a.hidden=true;return;} a.hidden=false; a.className="alert"+(k?" "+k:""); a.textContent=m; }
function readForm(){ return {provider:$("provider").value, key:$("apiKey").value.trim(), gemModel:$("gemModel").value, baseUrl:$("baseUrl").value.trim(), oaModel:$("oaModel").value.trim(), dialect:$("dialect").value}; }
$("provider").onchange = syncProviderFields;
$("setBtn").onclick = openSettings;
dlg.addEventListener("click", e => { if(e.target===dlg) dlg.close(); });
$("loadModels").onclick = async () => {
  const key = $("apiKey").value.trim(); if(!key){ setMsg("Paste your API key first.","err"); return; }
  setMsg("Loading models…");
  try{
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", {headers:{"x-goog-api-key":key}});
    const j = await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(apiError(r.status, j.error && j.error.message));
    const ms = (j.models||[]).filter(m => (m.supportedGenerationMethods||[]).includes("generateContent"))
      .map(m=>m.name.replace(/^models\//,""))
      .filter(n => /gemini/i.test(n) && !/(tts|live|image|embedding|transcribe|translate|audio)/i.test(n));
    // flash models first (cheapest, free-tier friendly), lite last
    ms.sort((a,b)=>{ const s=n=>(/flash/.test(n)&&!/lite/.test(n)?0:/flash-lite/.test(n)?1:2); return s(a)-s(b) || b.localeCompare(a,undefined,{numeric:true}); });
    if(!ms.length) throw new Error("No chat models were found for this key.");
    const cur = $("gemModel").value;
    $("gemModel").innerHTML = ms.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join("");
    $("gemModel").value = ms.includes(cur) ? cur : ms[0];
    setMsg(`Found ${ms.length} models. A "flash" model is the usual free-tier choice.`, "ok");
  }catch(e){ setMsg(e.message, "err"); }
};
$("testBtn").onclick = async () => {
  const prev = data.cfg; data.cfg = readForm();
  setMsg("Testing…");
  try{
    const r = await callAI("Reply with only JSON.", [{role:"user", content:'Reply with only {"ok":true,"saludo":"a short Spanish greeting"}'}], {temperature:0});
    setMsg(`Connected. The AI replied: ${r.saludo || "ok"}`, "ok");
  }catch(e){ setMsg(e.message, "err"); }
  finally{ data.cfg = prev; }
};
$("saveBtn").onclick = () => { data.cfg = readForm(); save(); dlg.close(); renderChat(); };

// ---------- setup ----------
$("scenario").innerHTML = SCENARIOS.map(([v,l])=>`<option value="${v}">${esc(l)}</option>`).join("");
$("scenario").value = "cafe";
setLang(lang);
showTab("tChat");
if(!data.cfg.key) setTimeout(openSettings, 300);

if("serviceWorker" in navigator && location.protocol==="https:"){ navigator.serviceWorker.register("sw.js").catch(()=>{}); }
})();
