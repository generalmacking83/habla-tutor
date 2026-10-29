(() => {
"use strict";
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const Score = window.HablaScore;

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
  ["smalltalk","Small talk with a new colleague"],
  ["work","A team meeting at work"],
  ["presentation","Giving a short update or presentation"],
  ["client","A client call: handling a complaint"],
  ["phone","Calling customer service about a wrong charge"],
  ["interview","A job interview"],
  ["exam","Speaking exam practice"]
];
const CATS = ["articles","gender/agreement","verb conjugation","tense/aspect","ser/estar","por/para","subjunctive","prepositions","word choice","word order","accents/spelling","punctuation","register","other"];

// Built-in drill sentences: work offline and without an API key.
const STARTER = {
  en:[
    {text:"Thank you for joining the call this Thursday.", focus:"th"},
    {text:"I think the three options are worth thinking through.", focus:"th"},
    {text:"Our five-person team finished the file on Friday.", focus:"f / p"},
    {text:"Please confirm the final price for the project.", focus:"f / p"},
    {text:"The vendor will deliver the revised version very soon.", focus:"v / b"},
    {text:"We value every client's feedback.", focus:"v / f"},
    {text:"She shared the schedule for the next shift.", focus:"sh / s"},
    {text:"Let me walk you through the key results.", focus:"linking"},
    {text:"I'd like to clarify the next steps before we wrap up.", focus:"consonant clusters"},
    {text:"Could you send it over by the end of the day?", focus:"linking"},
    {text:"We've already resolved the issue for the customer.", focus:"v, -ed endings"},
    {text:"I asked, checked, and fixed the problem yesterday.", focus:"-ed endings"}
  ],
  es:[
    {text:"El perro corre por la carretera.", tr:"The dog runs along the road.", focus:"rr"},
    {text:"Pero quiero un poco más de agua.", tr:"But I want a little more water.", focus:"r / rr"},
    {text:"Mañana voy a la montaña con mi hermana.", tr:"Tomorrow I'm going to the mountains with my sister.", focus:"ñ"},
    {text:"Me gustaría reservar una mesa para dos.", tr:"I'd like to book a table for two.", focus:"r, v"},
    {text:"¿Dónde está la estación de tren?", tr:"Where is the train station?", focus:"vowels"},
    {text:"Juan juega en el jardín los jueves.", tr:"Juan plays in the garden on Thursdays.", focus:"j"},
    {text:"Yo llamo a mi amiga todos los lunes.", tr:"I call my friend every Monday.", focus:"ll / y"},
    {text:"La reunión empieza a las nueve y media.", tr:"The meeting starts at half past nine.", focus:"diphthongs"},
    {text:"¿Podría repetirlo más despacio, por favor?", tr:"Could you repeat it more slowly, please?", focus:"r"},
    {text:"Necesito cambiar la fecha de mi vuelo.", tr:"I need to change the date of my flight.", focus:"b / v"}
  ]
};
const FOCUS = {
  en:["Mixed sounds","th sounds (think, this)","f vs p","v vs b","sh vs s","-ed and -s endings","r and l","Workplace phrases","Numbers, dates and prices"],
  es:["Mixed sounds","r vs rr","ñ and ll","j and g","Pure vowels","b and v","Workplace phrases","Numbers, dates and prices"]
};

// ---------- storage ----------
const STORE = "habla-app-v1";
function defaults(){
  return {notebook:{es:[],en:[]}, cats:{es:{},en:{}}, words:{es:0,en:0}, msgs:{es:0,en:0},
    cfg:{provider:"gemini", key:"", gemModel:"", baseUrl:"https://api.groq.com/openai/v1", oaModel:"openai/gpt-oss-120b", dialect:"es-ES", voice:{es:"",en:""}, rate:1},
    lang:"es", convo:null, voiceMode:false,
    mine:{es:[],en:[]}, aiset:{es:[],en:[]}, dbest:{es:{},en:{}}, dset:"starter", didx:0};
}
function load(){
  const def = defaults();
  let d = null;
  try{ d = JSON.parse(localStorage.getItem(STORE)||"null"); }catch(e){}
  if(!d || !d.notebook) return def;
  // fill in anything added since the data was saved
  for(const k of Object.keys(def)) if(d[k]===undefined) d[k] = def[k];
  d.cfg = Object.assign({}, def.cfg, d.cfg||{});
  d.cfg.voice = Object.assign({}, def.cfg.voice, d.cfg.voice||{});
  return d;
}
let data = load();
function save(){ try{ localStorage.setItem(STORE, JSON.stringify(data)); }catch(e){} }
let lang = data.lang || "es";

// conversation state
let convo = data.convo; // {lang, level, scenario, explain, strict, spoken, history:[], view:[]}
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
function scenLabel(id, L){
  if(id==="exam") return (L||lang)==="es" ? "Speaking exam practice (DELE-style)" : "Speaking exam practice (IELTS-style)";
  const s = SCENARIOS.find(x=>x[0]===id); return s ? s[1] : id;
}
function rules(c){
  const L = LANG[c.lang].name, lvl = c.level, ex = c.explain;
  const variety = c.lang==="es" ? (data.cfg.dialect==="es-MX" ? " Use Latin American (Mexican) Spanish: ustedes, not vosotros, and Latin American vocabulary." : " Use Spain Spanish (vosotros is fine).") : "";
  const strict = c.strict==="all"
    ? "Correct every error, including missing accents, ñ, ¿ ¡ marks, and capitalisation."
    : "Correct only errors that matter: grammar, wrong words, and anything that changes or blurs meaning. Ignore missing accents, punctuation, ¿ ¡ marks and capitalisation (the learner types on a phone).";
  const role = c.scenario==="exam"
    ? `You are a friendly but professional speaking examiner (${c.lang==="es"?"DELE":"IELTS"}-style). Ask ONE question at a time: start with short personal questions, later give one "describe something" task, then ask discussion questions. Do not teach inside "reply"; corrections go only in the "correction" field.`
    : `You play the other person in this scenario and stay in character.`;
  const spoken = c.spoken
    ? `\n- The learner is SPEAKING; their messages are speech-recognition transcripts. Ignore punctuation, capitalisation and spelling, and do not correct words that look like the recognizer mis-heard them. Focus on grammar and word choice.`
    : "";
  const short = data.voiceMode ? " Keep it to one or two short sentences because it will be read aloud." : "";
  return `You are a warm, patient ${L} conversation tutor. The learner's level is CEFR ${lvl}. Scenario: "${scenLabel(c.scenario, c.lang)}". ${role}${variety}

Every time you answer, reply with ONLY one JSON object in this shape:
{"reply":"your next line in ${L}","reply_translation":"that line translated into ${ex}","correction":{"ok":true,"corrected":"","natural":"","notes":[{"original":"exact words from the learner's message","better":"corrected words","why":"one short sentence in ${ex}","category":"word choice"}]},"new_words":[{"term":"a word or phrase from YOUR reply","meaning":"its meaning in ${ex}"}]}

Rules for "reply":
- Write only in ${L}, pitched at ${lvl}: ${lvl==="A1"||lvl==="A2"?"short sentences, common words, mostly present tense":lvl==="B1"?"everyday vocabulary, some past and future, simple linking words":"natural, idiomatic speech with a range of structures"}.
- One to three sentences.${short} End with a question or prompt that keeps the conversation moving.
- If the learner writes in another language or says they don't understand, help them in simple ${L} and keep going.

Rules for "correction" (about the learner's LAST message only):
- ${strict}${spoken}
- If nothing needs fixing: ok=true, corrected="", notes=[].
- Otherwise ok=false, "corrected" = their whole message rewritten correctly in ${L}, keeping their wording where possible, plus up to 3 notes, most important first. "original" must be copied exactly from their message.
- "natural" = how a native speaker would most likely say the same thing in this situation, at about ${lvl} level. Fill it even when ok=true if a native speaker would phrase it noticeably differently; leave it "" if their message already sounds natural or is the same as "corrected".
- "category" must be one of: ${CATS.join(", ")}.
- If the last user turn is the [Start] instruction, set ok=true and natural="".

Rules for "new_words": 0 to 3 items from your own reply that are useful at ${lvl}. Skip words a ${lvl} learner surely knows.`;
}

// ---------- rendering ----------
function tutorHTML(r, i){
  const words = (r.new_words||[]).filter(w=>w&&w.term).slice(0,3);
  const saved = new Set(data.notebook[convo.lang].map(w=>w.term.toLowerCase()));
  return `<div class="bubble">${esc(r.reply)}</div>
    <div class="tools"><button class="tiny" data-say="${i}">🔊 Listen</button><button class="tiny" data-tr="${i}">Translation</button><button class="tiny" data-shadow="${i}">🎯 Repeat it</button></div>
    <div class="trans" data-trbox="${i}" hidden>${esc(r.reply_translation||"")}</div>
    ${words.length?`<div class="words">${words.map(w=>{const s=saved.has(w.term.toLowerCase());return `<button class="word" data-term="${esc(w.term)}" data-mean="${esc(w.meaning||"")}" aria-pressed="${s}">${s?"✓":"+"} ${esc(w.term)}</button>`;}).join("")}</div>`:""}`;
}
function sentenceActions(text){
  return `<div class="tools"><button class="tiny" data-sayline="${esc(text)}">🔊 Listen</button><button class="tiny" data-practise="${esc(text)}">🎯 Practise saying it</button></div>`;
}
function fixHTML(c){
  if(!c) return "";
  const nat = c.natural && c.natural.trim() && c.natural.trim()!==(c.corrected||"").trim() ? c.natural.trim() : "";
  const natBox = nat ? `<div class="fix nat"><div class="label">Sounds more natural</div><div class="better">${esc(nat)}</div>${sentenceActions(nat)}</div>` : "";
  if(c.ok || !c.notes || !c.notes.length){
    if(c.ok) return `<div class="fix ok">✓ Correct</div>` + natBox;
    return (c.corrected?`<div class="fix"><div class="label">Corrected</div><div class="better">${esc(c.corrected)}</div>${sentenceActions(c.corrected)}</div>`:"") + natBox;
  }
  return `<div class="fix">${c.corrected?`<div class="label">Corrected</div><div class="better">${esc(c.corrected)}</div>`:""}
    ${c.notes.slice(0,3).map(n=>`<div class="note"><div class="pair"><span class="chip">${esc(n.category||"other")}</span><del>${esc(n.original)}</del> → <ins>${esc(n.better)}</ins></div><div class="why">${esc(n.why)}</div></div>`).join("")}
    ${c.corrected?sentenceActions(c.corrected):""}</div>` + natBox;
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
  const sv = $("scenario").value;
  $("scenario").innerHTML = SCENARIOS.map(([v])=>`<option value="${v}">${esc(scenLabel(v, lang))}</option>`).join("");
  $("scenario").value = sv || "cafe";
  if(has){
    $("sceneTitle").textContent = `${LANG[convo.lang].native} · ${convo.level} · ${scenLabel(convo.scenario, convo.lang)}`;
    $("input").placeholder = lang==="es" ? "Escribe o habla…" : "Type or speak…";
    renderThread();
  }
  renderVoiceBtn();
  setControls();
}
function setControls(){
  $("sendBtn").disabled = busy; $("hintBtn").disabled = busy;
  $("reviewBtn").disabled = busy || !convo || convo.view.filter(v=>v.type==="u").length<3;
  $("startBtn").disabled = busy;
  $("startBtn").textContent = busy && convo && !convo.view.length ? "Starting…" : "Start conversation";
}
function alertMsg(msg, kind){ const a=$("alert"); if(!msg){a.hidden=true;return;} a.hidden=false; a.className="alert"+(kind?" "+kind:""); a.innerHTML=msg; }
function startMsg(msg){ const a=$("startMsg"); if(!msg){a.hidden=true;return;} a.hidden=false; a.innerHTML=msg; a.scrollIntoView && a.scrollIntoView({block:"nearest"}); }

// ---------- conversation flow ----------
async function turn(userText){
  const isStart = userText==null;
  busy = true; alertMsg(""); $("sugs").hidden = true;
  const content = isStart ? `[Start] Open the conversation in character: greet me and set the scene for "${scenLabel(convo.scenario, convo.lang)}". There is no learner message yet.` : userText;
  convo.history.push({role:"user", content});
  let uv = null, toSpeak = null;
  if(!isStart){ uv = {type:"u", text:userText, pending:"Checking…"}; convo.view.push(uv); }
  renderThread(); setControls();
  ctl = new AbortController();
  const myCtl = ctl, timer = setTimeout(() => { myCtl.timedOut = true; myCtl.abort(); }, 60000);
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
    toSpeak = r.reply;
  }catch(e){
    convo.history.pop();
    if(uv){ convo.view.pop(); $("input").value = userText; }
    const m = e.name==="AbortError" ? (ctl && ctl.timedOut ? "The AI took too long to answer. Check your internet and try again." : "") : (e.message || "Something went wrong. Try again.");
    if(isStart && !convo.view.length){ convo = null; if(m) startMsg("Couldn't start: "+esc(m)); }
    else if(m) alertMsg(esc(m), "err");
  }finally{
    clearTimeout(timer);
    busy = false; ctl = null; data.convo = convo; save();
    if(convo) renderThread(); else renderChat();
    setControls(); renderSide();
  }
  if(toSpeak && data.voiceMode && convo) speakThenListen(toSpeak);
}

// Voice mode: the tutor reads its reply, then the mic opens, and the reply is sent when you stop talking.
function speakThenListen(text){
  const L = convo.lang;
  speak(text, L, {onDone: () => {
    if(data.voiceMode && convo && convo.lang===L && !busy && !$("vChat").hidden && !document.hidden && !recording) startMic();
  }});
}

$("startBtn").onclick = () => {
  startMsg("");
  if(!data.cfg.key){ $("keyNote").hidden=false; openSettings(); return; }
  if(data.cfg.provider==="gemini" && !data.cfg.gemModel){ openSettings(); return; }
  convo = {lang, level:$("level").value, scenario:$("scenario").value, explain:$("explain").value, strict:$("strict").value, spoken:data.voiceMode, history:[], view:[]};
  $("reviewCard").hidden = true;
  renderChat(); alertMsg("");
  primeSpeech();
  turn(null);
};
function send(){
  if(busy) return;
  if(recording) abortMic();
  stopSpeaking();
  const t = $("input").value.trim(); if(!t) return;
  $("input").value = ""; autosize(); turn(t);
}
$("sendBtn").onclick = send;
$("input").addEventListener("keydown", e => { if(e.key==="Enter" && !e.shiftKey && !e.isComposing){ e.preventDefault(); send(); } });
function autosize(){ const t=$("input"); t.style.height="auto"; t.style.height=Math.min(140,t.scrollHeight)+"px"; }
$("input").addEventListener("input", autosize);

$("newBtn").onclick = () => { if(ctl) ctl.abort(); abortMic(); stopSpeaking(); convo = null; data.convo = null; save(); $("reviewCard").hidden=true; alertMsg(""); renderChat(); };

function renderVoiceBtn(){
  const b = $("voiceBtn"); if(!b) return;
  b.setAttribute("aria-pressed", String(!!data.voiceMode));
  b.textContent = data.voiceMode ? "🗣 Voice chat: on" : "🗣 Voice chat: off";
  $("voiceSetup").checked = !!data.voiceMode;
}
function setVoiceMode(on){
  data.voiceMode = !!on; save(); renderVoiceBtn();
  if(on){
    if(convo){ convo.spoken = true; data.convo = convo; save(); }
    primeSpeech();
    alertMsg("Voice chat is on: the tutor reads each reply aloud, then listens. Your answer is sent when you stop talking.", "ok");
    const last = convo && [...convo.view].reverse().find(v=>v.type==="t");
    if(last && !busy) speakThenListen(last.r.reply);
  } else { abortMic(); stopSpeaking(); alertMsg(""); }
}
$("voiceBtn").onclick = () => setVoiceMode(!data.voiceMode);
$("voiceSetup").onchange = e => { data.voiceMode = e.target.checked; save(); renderVoiceBtn(); };

// thread clicks
$("thread").addEventListener("click", e => {
  const b = e.target.closest("button"); if(!b) return;
  if(b.dataset.say!=null){ const v=convo.view[+b.dataset.say]; if(v) speak(v.r.reply, convo.lang); }
  else if(b.dataset.tr!=null){ const box=$("thread").querySelector(`[data-trbox="${b.dataset.tr}"]`); if(box) box.hidden=!box.hidden; }
  else if(b.dataset.shadow!=null){ const v=convo.view[+b.dataset.shadow]; if(v) practise(v.r.reply, v.r.reply_translation, convo.lang); }
  else if(b.dataset.sayline!=null){ speak(b.dataset.sayline, convo.lang); }
  else if(b.dataset.practise!=null){ practise(b.dataset.practise, "", convo.lang); }
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
      [{role:"user", content:`Scenario: "${scenLabel(convo.scenario, convo.lang)}". The other person just said: "${last.r.reply}". Suggest 3 different short replies the learner could give, in ${LANG[convo.lang].name} at ${convo.level} level, each with a different intent. Reply with only {"suggestions":["...","...","..."]}`}], {temperature:0.9});
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
`Review this ${convo.level} learner's messages from one conversation ("${scenLabel(convo.scenario, convo.lang)}"). Write everything except example sentences in ${convo.explain}.

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

// ---------- speech output ----------
function srLang(L){ return L==="es" ? (data.cfg.dialect||"es-ES") : "en-US"; }
function voicesFor(L){
  const synth = window.speechSynthesis; if(!synth) return [];
  return synth.getVoices().filter(v=>v.lang && v.lang.toLowerCase().startsWith(LANG[L].tts));
}
function pickVoice(L){
  const all = voicesFor(L); if(!all.length) return null;
  const chosen = data.cfg.voice && data.cfg.voice[L];
  if(chosen){ const v = all.find(v=>v.voiceURI===chosen || v.name===chosen); if(v) return v; }
  const want = srLang(L).toLowerCase();
  return all.find(v=>v.lang.toLowerCase().replace("_","-")===want) || all[0];
}
let speakToken = 0;
function speak(text, L, opts={}){
  const done = opts.onDone || (()=>{});
  const synth = window.speechSynthesis;
  if(!synth || !window.SpeechSynthesisUtterance){ alertMsg("Read-aloud isn't available on this device.", ""); return; }
  try{
    synth.cancel();
    const my = ++speakToken;
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice(L); if(v) u.voice = v;
    u.lang = v ? v.lang : srLang(L);
    const levelRate = convo && ["A1","A2"].includes(convo.level) ? 0.9 : 1;
    u.rate = Math.max(0.5, Math.min(1.5, (data.cfg.rate||1) * levelRate * (opts.slow ? 0.7 : 1)));
    let finished = false, guard = 0;
    const finish = () => { if(finished || my!==speakToken) return; finished = true; clearTimeout(guard); done(); };
    u.onend = finish; u.onerror = finish;
    // Some Android voices never fire onend; don't leave voice chat stuck.
    guard = setTimeout(finish, 4000 + text.length * 90 / u.rate);
    synth.speak(u);
  }catch(_){ alertMsg("Read-aloud isn't available on this device.", ""); }
}
function stopSpeaking(){ speakToken++; try{ window.speechSynthesis && speechSynthesis.cancel(); }catch(_){} }
// Speaking once inside a tap unlocks speech on browsers that block it otherwise.
function primeSpeech(){ try{ if(window.speechSynthesis){ const u = new SpeechSynthesisUtterance(""); u.volume = 0; speechSynthesis.speak(u); } }catch(_){} }
if(window.speechSynthesis){ try{ speechSynthesis.getVoices(); speechSynthesis.addEventListener("voiceschanged", () => { if(dlg.open) fillVoices(); }); }catch(_){} }

// ---------- speech input ----------
// One recognizer at a time. done(finals, error, aborted) is called exactly once.
let rec = null;
function listen(L, {onInterim, done}){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR){ done(null, "unsupported", false); return false; }
  abortListening();
  const r = new SR();
  r.lang = srLang(L); r.interimResults = true; r.continuous = false; r.maxAlternatives = 3;
  let finals = [], err = null;
  const ctx = {r, done, finished:false};
  const finish = (aborted) => { if(ctx.finished) return; ctx.finished = true; if(rec===ctx) rec = null; done(finals, err, aborted); };
  ctx.finish = finish;
  r.onresult = e => {
    let text = ""; finals = [];
    for(let i=0;i<e.results.length;i++){
      const res = e.results[i];
      text += res[0].transcript;
      if(res.isFinal){ const alts=[]; for(let k=0;k<res.length;k++) alts.push(res[k].transcript); finals.push(alts); }
    }
    if(onInterim) onInterim(text);
  };
  r.onerror = e => { err = e.error; };
  r.onend = () => finish(false);
  try{ r.start(); }catch(_){ err = "start-failed"; finish(false); return false; }
  rec = ctx;
  return true;
}
function stopListening(){ if(rec) try{ rec.r.stop(); }catch(_){} }       // keeps what was heard
function abortListening(){ const c = rec; if(!c) return; rec = null; try{ c.r.abort(); }catch(_){} c.finish(true); }
// Joins each final result's alternatives into whole-sentence candidates.
function candidates(finals){
  if(!finals || !finals.length) return [];
  const firsts = finals.map(a=>a[0]).join(" ");
  if(finals.length===1) return finals[0];
  return [firsts];
}
function micErrorText(err){
  if(err==="unsupported") return "Speech recognition isn't supported in this browser. Use Chrome on Android or a computer.";
  if(err==="not-allowed"||err==="service-not-allowed") return "Microphone access is blocked. Allow it in Chrome's site settings for this app.";
  if(err==="network") return "Speech recognition needs an internet connection.";
  if(err==="audio-capture") return "No microphone was found.";
  return "Couldn't hear that. Try again.";
}

// chat mic
let recording = false;
function micUI(on){ recording = on; $("micBtn").classList.toggle("on", on); $("micBtn").setAttribute("aria-label", on?"Stop listening":"Speak"); }
function startMic(){
  if(convo){ convo.spoken = true; data.convo = convo; }
  const base = $("input").value ? $("input").value.trim()+" " : "";
  const ok = listen(convo ? convo.lang : lang, {
    onInterim: t => { $("input").value = base + t; autosize(); },
    done: (finals, err, aborted) => {
      micUI(false);
      if(aborted) return;
      if(err && err!=="no-speech" && err!=="aborted"){ alertMsg(micErrorText(err), "err"); return; }
      if(err==="no-speech"){ if(data.voiceMode) alertMsg("I didn't catch anything. Tap 🎙 when you're ready.", ""); return; }
      if(data.voiceMode && $("input").value.trim()) send();
    }
  });
  if(ok){ micUI(true); alertMsg(""); }
}
function abortMic(){ abortListening(); micUI(false); }
$("micBtn").onclick = () => { if(recording){ stopListening(); } else { stopSpeaking(); startMic(); } };

// ---------- pronunciation drills ----------
let dBusy = false, drillListening = false;
function drillList(){
  if(data.dset==="mine") return data.mine[lang];
  if(data.dset==="ai") return data.aiset[lang];
  return STARTER[lang];
}
function bestOf(text){ return data.dbest[lang][text] || null; }
function scoreClass(s){ return s==null ? "" : s>=90 ? "good" : s>=70 ? "mid" : "low"; }
function practise(text, tr, L){
  if(!text) return;
  if(L!==lang) setLang(L);
  const list = data.mine[lang];
  let i = list.findIndex(x=>x.text===text);
  if(i<0){ list.unshift({text, tr:tr||"", focus:"from chat", t:Date.now()}); i = 0; }
  data.dset = "mine"; data.didx = i; save();
  abortMic(); stopSpeaking();
  showTab("tSp");
}
function renderDrills(){
  const list = drillList();
  ["starter","mine","ai"].forEach(k => $("ds_"+k).setAttribute("aria-pressed", String(data.dset===k)));
  $("ds_mine").textContent = `Mine (${data.mine[lang].length})`;
  $("ds_ai").textContent = `AI set (${data.aiset[lang].length})`;
  $("aiGen").hidden = data.dset!=="ai";
  $("dFocus").innerHTML = FOCUS[lang].map(f=>`<option>${esc(f)}</option>`).join("");
  if(!list.length){
    $("drillCard").hidden = true; $("drillEmpty").hidden = false;
    $("drillEmpty").innerHTML = data.dset==="mine"
      ? `<p class="muted">No sentences yet. In a chat, tap <b>🎯 Practise saying it</b> under a correction, or <b>🎯 Repeat it</b> under the tutor's line.</p>`
      : `<p class="muted">No AI sentences yet. Pick a focus below and press <b>Make a new set</b>.</p>`;
    $("dList").innerHTML = ""; return;
  }
  $("drillEmpty").hidden = true; $("drillCard").hidden = false;
  if(data.didx >= list.length || data.didx < 0) data.didx = 0;
  const item = list[data.didx], b = bestOf(item.text);
  $("dMeta").textContent = `${data.didx+1} of ${list.length}${item.focus?` · ${item.focus}`:""}${b?` · best ${b.best}%`:""}`;
  $("dTarget").innerHTML = esc(item.text);
  $("dTr").textContent = item.tr || ""; $("dTr").hidden = !item.tr;
  $("dResult").hidden = true; $("dResult").innerHTML = "";
  $("dPrev").disabled = data.didx===0; $("dNext").disabled = data.didx>=list.length-1;
  renderSayBtn();
  $("dList").innerHTML = list.map((x,i)=>{ const s = bestOf(x.text); return `<div class="d-item${i===data.didx?" cur":""}"><button class="d-pick" data-di="${i}">${esc(x.text)}</button><span class="score ${scoreClass(s&&s.best)}">${s?s.best+"%":"–"}</span>${data.dset!=="starter"?`<button class="tiny" data-ddel="${i}" aria-label="Remove sentence">Remove</button>`:""}</div>`; }).join("");
}
function renderSayBtn(){
  $("dSay").textContent = drillListening ? "■ Stop" : "🎙 Say it";
  $("dSay").classList.toggle("rec", drillListening);
}
$("dListen").onclick = () => { const it = drillList()[data.didx]; if(it) speak(it.text, lang); };
$("dSlow").onclick = () => { const it = drillList()[data.didx]; if(it) speak(it.text, lang, {slow:true}); };
$("dSay").onclick = () => {
  if(drillListening){ stopListening(); return; }
  const it = drillList()[data.didx]; if(!it) return;
  stopSpeaking();
  const box = $("dResult"); box.hidden = false; box.innerHTML = `<p class="muted">Listening… read the sentence aloud.</p>`;
  const ok = listen(lang, {
    onInterim: t => { box.innerHTML = `<p class="muted">Hearing: <i>${esc(t)}</i></p>`; },
    done: (finals, err, aborted) => {
      drillListening = false; renderSayBtn();
      if(aborted){ box.hidden = true; return; }
      if(err && err!=="no-speech"){ box.innerHTML = `<div class="alert err">${esc(micErrorText(err))}</div>`; return; }
      const res = Score.scoreBest(it.text, candidates(finals), lang);
      if(!res){ box.innerHTML = `<p class="muted">I didn't hear anything. Tap <b>🎙 Say it</b> and read the sentence.</p>`; return; }
      const rec0 = data.dbest[lang][it.text] || {best:0, tries:0};
      rec0.tries++; rec0.best = Math.max(rec0.best, res.score); rec0.last = res.score; rec0.t = Date.now();
      data.dbest[lang][it.text] = rec0; save();
      showResult(res, it);
      renderDrillListOnly();
      renderSide();
    }
  });
  if(ok){ drillListening = true; renderSayBtn(); }
};
function showResult(res, it){
  const verdict = res.score>=90 ? "Clear. The recognizer understood every word." : res.score>=70 ? "Almost. Listen to the red words and try again." : "Not yet. Listen first, then try it slower.";
  const missed = res.words.filter(w=>w.st==="miss"||w.st==="part").map(w=>w.w.replace(/^[¿¡"(]+|[.,!?;:")]+$/g,""));
  $("dTarget").innerHTML = res.words.map(w=>`<span class="w ${w.st}">${esc(w.w)}</span>`).join(" ");
  $("dResult").innerHTML = `<div class="result"><span class="big score ${scoreClass(res.score)}">${res.score}%</span><span>${esc(verdict)}</span></div>
    <p class="small">Heard: <i>${esc(res.heard)}</i></p>
    ${missed.length?`<div class="words">${missed.map(w=>`<button class="word" data-wsay="${esc(w)}">🔊 ${esc(w)}</button>`).join("")}</div>`:""}`;
  const b = bestOf(it.text);
  $("dMeta").textContent = `${data.didx+1} of ${drillList().length}${it.focus?` · ${it.focus}`:""}${b?` · best ${b.best}%`:""}`;
}
function renderDrillListOnly(){
  const list = drillList();
  $("dList").querySelectorAll(".d-item").forEach((row,i) => { const s = bestOf(list[i].text); const sc = row.querySelector(".score"); sc.className = "score "+scoreClass(s&&s.best); sc.textContent = s?s.best+"%":"–"; });
}
$("dResult").addEventListener("click", e => { const b = e.target.closest("[data-wsay]"); if(b) speak(b.dataset.wsay, lang, {slow:true}); });
$("dPrev").onclick = () => { abortListening(); if(data.didx>0){ data.didx--; save(); renderDrills(); } };
$("dNext").onclick = () => { abortListening(); if(data.didx<drillList().length-1){ data.didx++; save(); renderDrills(); } };
$("dList").addEventListener("click", e => {
  const p = e.target.closest("[data-di]"), d = e.target.closest("[data-ddel]");
  if(p){ abortListening(); data.didx = +p.dataset.di; save(); renderDrills(); window.scrollTo && $("drillCard").scrollIntoView({behavior:"smooth", block:"start"}); }
  if(d){ const list = data.dset==="mine" ? data.mine[lang] : data.aiset[lang]; list.splice(+d.dataset.ddel,1); if(data.didx>=list.length) data.didx = Math.max(0,list.length-1); save(); renderDrills(); }
});
["starter","mine","ai"].forEach(k => $("ds_"+k).onclick = () => { abortListening(); data.dset = k; data.didx = 0; save(); renderDrills(); });
$("dGen").onclick = async () => {
  if(dBusy) return;
  if(!data.cfg.key){ openSettings(); return; }
  dBusy = true; $("dGen").disabled = true; $("dGen").textContent = "Writing sentences…"; $("dGenMsg").hidden = true;
  const lvl = $("dLevel").value, focus = $("dFocus").value, ex = $("explain").value;
  try{
    const r = await callAI(`You write pronunciation practice sentences for language learners. Reply with only JSON.`, [{role:"user", content:
`Write 8 ${LANG[lang].name} sentences for a CEFR ${lvl} learner to read aloud.
Focus: ${focus}.${lang==="en"?" Choose words that contain the focus sounds several times.":""}
Each sentence: 5 to 14 words, natural and useful in real life, varied topics. Avoid unusual names, because speech recognition handles them badly.
Give a translation of each into ${ex}${lang==="en"&&ex==="English"?" (leave it empty)":""}.
Reply with only {"sentences":[{"text":"...","tr":"...","focus":"short label of the sound or theme"}]}`}], {temperature:0.9});
    const s = (r && r.sentences || []).filter(x=>x && typeof x.text==="string" && x.text.trim()).slice(0,10)
      .map(x=>({text:x.text.trim(), tr:(x.tr||"").trim(), focus:(x.focus||focus).trim()}));
    if(!s.length) throw new Error("The AI didn't return any sentences. Try again.");
    data.aiset[lang] = s; data.didx = 0; save(); renderDrills();
  }catch(e){ $("dGenMsg").hidden = false; $("dGenMsg").textContent = e.message; }
  finally{ dBusy = false; $("dGen").disabled = false; $("dGen").textContent = "Make a new set"; }
};

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
  $("totals").innerHTML = `<p style="margin:0">${data.msgs[lang]||0} messages · ${w} words in ${LANG[lang].name} · ${data.notebook[lang].length} words saved</p>`;
  const ds = Object.values(data.dbest[lang]);
  if(ds.length){
    const avg = Math.round(ds.reduce((a,x)=>a+x.best,0)/ds.length), clear = ds.filter(x=>x.best>=90).length, tries = ds.reduce((a,x)=>a+x.tries,0);
    $("pron").innerHTML = `<p style="margin:0">${ds.length} sentences practised · ${tries} attempts · average best ${avg}% · ${clear} at 90%+</p>`;
  } else $("pron").innerHTML = `<p class="muted">Use the Speak tab to practise sentences aloud. Your scores show here.</p>`;
  const rb = $("resetCats"); if(rb) rb.onclick = () => { $("resetWrap").innerHTML = `Reset? <button class="tiny" id="yesR">Yes, reset</button> <button class="tiny" id="noR">Cancel</button>`; $("yesR").onclick=()=>{ data.cats[lang]={}; data.words[lang]=0; data.msgs[lang]=0; save(); renderSide(); }; $("noR").onclick=renderSide; };
}

// ---------- tabs & language ----------
const TABS = [["tChat","vChat"],["tSp","vSp"],["tNb","vNb"],["tPr","vPr"]];
function showTab(t){
  if(t!=="tChat"){ abortMic(); }
  if(t!=="tSp"){ abortListening(); }
  TABS.forEach(([b,v])=>{ $(b).setAttribute("aria-selected", b===t); $(v).hidden = b!==t; });
  renderChat();
  if(t==="tSp") renderDrills();
}
TABS.forEach(([b]) => $(b).onclick = () => { stopSpeaking(); showTab(b); });
function setLang(l){
  if(busy) return;
  abortListening(); stopSpeaking();
  lang = l; data.lang = l; data.didx = 0; save();
  $("lEs").setAttribute("aria-pressed", l==="es"); $("lEn").setAttribute("aria-pressed", l==="en");
  if(convo && convo.lang!==l){ convo = null; data.convo = null; save(); }
  renderChat(); renderSide();
  if(!$("vSp").hidden) renderDrills();
}
$("lEs").onclick = () => setLang("es");
$("lEn").onclick = () => setLang("en");
document.addEventListener("visibilitychange", () => { if(document.hidden){ abortListening(); micUI(false); stopSpeaking(); } });

// ---------- settings ----------
const dlg = $("settings");
function syncProviderFields(){ const g = $("provider").value==="gemini"; $("gemFields").hidden=!g; $("oaFields").hidden=g; }
function fillVoices(){
  ["es","en"].forEach(L => {
    const sel = $("voice_"+L), cur = sel.value || (data.cfg.voice&&data.cfg.voice[L]) || "";
    const vs = voicesFor(L);
    sel.innerHTML = `<option value="">Automatic</option>` + vs.map(v=>`<option value="${esc(v.voiceURI)}">${esc(v.name)} (${esc(v.lang)})</option>`).join("");
    sel.value = vs.some(v=>v.voiceURI===cur) ? cur : "";
  });
  $("noVoices").hidden = !!(voicesFor("es").length || voicesFor("en").length);
}
function openSettings(){
  const c = data.cfg;
  $("provider").value = c.provider; $("apiKey").value = c.key; $("baseUrl").value = c.baseUrl; $("oaModel").value = c.oaModel; $("dialect").value = c.dialect||"es-ES";
  $("rate").value = c.rate||1; $("rateOut").textContent = (+$("rate").value).toFixed(1)+"×";
  const sel = $("gemModel"); if(c.gemModel && ![...sel.options].some(o=>o.value===c.gemModel)) sel.innerHTML = `<option value="${esc(c.gemModel)}">${esc(c.gemModel)}</option>` + sel.innerHTML;
  sel.value = c.gemModel || "";
  if(!sel.options.length || !sel.value) sel.innerHTML = `<option value="">(no model yet)</option>` + [...sel.options].filter(o=>o.value).map(o=>o.outerHTML).join("");
  sel.value = c.gemModel || sel.value;
  modelMsg("");
  $("voice_es").value = ""; $("voice_en").value = "";
  fillVoices();
  syncProviderFields(); setMsg("");
  if(typeof dlg.showModal==="function") dlg.showModal(); else dlg.setAttribute("open","");
  if(c.provider==="gemini" && c.key && !c.gemModel) loadModelList();
}
function setMsg(m, k){ const a=$("setMsg"); if(!m){a.hidden=true;return;} a.hidden=false; a.className="alert"+(k?" "+k:""); a.textContent=m; }
function readForm(){ return {provider:$("provider").value, key:$("apiKey").value.replace(/\s+/g,""), gemModel:$("gemModel").value, baseUrl:$("baseUrl").value.trim(), oaModel:$("oaModel").value.trim(), dialect:$("dialect").value,
  voice:{es:$("voice_es").value, en:$("voice_en").value}, rate:+$("rate").value||1}; }
$("provider").onchange = syncProviderFields;
$("setBtn").onclick = openSettings;
$("rate").oninput = () => { $("rateOut").textContent = (+$("rate").value).toFixed(1)+"×"; };
dlg.addEventListener("click", e => { if(e.target===dlg) dlg.close(); });
dlg.addEventListener("click", e => {
  const b = e.target.closest("[data-preview]"); if(!b) return;
  const L = b.dataset.preview, prev = data.cfg;
  data.cfg = readForm();
  speak(L==="es" ? "Hola, soy tu tutor. ¿Practicamos un poco?" : "Hi, I'm your tutor. Shall we practise a little?", L);
  data.cfg = prev;
});
async function fetchModels(key){
  let r;
  try{ r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", {headers:{"x-goog-api-key":key}}); }
  catch(_){ throw new Error("Couldn't reach Google. Check your internet connection."); }
  const j = await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(apiError(r.status, j.error && j.error.message));
  const ms = (j.models||[]).filter(m => (m.supportedGenerationMethods||[]).includes("generateContent"))
    .map(m=>m.name.replace(/^models\//,""))
    .filter(n => /gemini/i.test(n) && !/(tts|live|image|embedding|transcribe|translate|audio)/i.test(n));
  // stable flash models first (free-tier friendly), lite next, others last; previews after stable ones
  const rank = n => (/flash/.test(n)&&!/lite/.test(n) ? 0 : /flash-lite/.test(n) ? 1 : 2) + (/(preview|exp)/.test(n) ? 3 : 0);
  ms.sort((a,b)=> rank(a)-rank(b) || b.localeCompare(a,undefined,{numeric:true}));
  if(!ms.length) throw new Error("No chat models were found for this key.");
  return ms;
}
function modelMsg(m, k){ const a=$("modelMsg"); if(!m){a.hidden=true;return;} a.hidden=false; a.className="alert"+(k?" "+k:""); a.textContent=m; }
let loadingModels = null;
function loadModelList(){
  // one load at a time; callers that arrive mid-load wait for the same result
  if(!loadingModels) loadingModels = doLoadModels().finally(() => { loadingModels = null; });
  return loadingModels;
}
async function doLoadModels(){
  const key = $("apiKey").value.replace(/\s+/g,"");
  if(!key){ modelMsg("Paste your API key above first.","err"); return; }
  $("loadModels").disabled = true; $("loadModels").textContent = "Loading…"; modelMsg("Loading models…");
  try{
    const ms = await fetchModels(key);
    const cur = $("gemModel").value;
    $("gemModel").innerHTML = ms.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join("");
    $("gemModel").value = ms.includes(cur) ? cur : ms[0];
    modelMsg(`Found ${ms.length} models and picked ${$("gemModel").value}. Press Save at the bottom.`, "ok");
  }catch(e){ modelMsg(e.message, "err"); }
  finally{ $("loadModels").disabled = false; $("loadModels").textContent = "Load list"; }
}
$("loadModels").onclick = loadModelList;
// load automatically once a key is pasted
$("showKey").onclick = () => {
  const masked = $("apiKey").classList.toggle("masked");
  $("showKey").textContent = masked ? "Show" : "Hide"; $("showKey").setAttribute("aria-pressed", String(!masked));
};
$("pasteKey").onclick = async () => {
  try{
    if(!navigator.clipboard || !navigator.clipboard.readText) throw new Error("no clipboard");
    const t = (await navigator.clipboard.readText()).trim();
    if(!t){ modelMsg("Your clipboard is empty. Copy the key from Google AI Studio first.", "err"); return; }
    $("apiKey").value = t.replace(/\s+/g, "");
    $("apiKey").dispatchEvent(new Event("input"));
  }catch(_){
    modelMsg("This browser didn't allow reading the clipboard. Long-press inside the key box and choose Paste instead.", "err");
    $("apiKey").focus();
  }
};
let keyTimer = 0, lastLoadedKey = "";
$("apiKey").addEventListener("input", () => {
  clearTimeout(keyTimer);
  keyTimer = setTimeout(() => {
    const k = $("apiKey").value.trim();
    if($("provider").value==="gemini" && k.length >= 20 && k !== lastLoadedKey){ lastLoadedKey = k; loadModelList(); }
  }, 500);
});
$("testBtn").onclick = async () => {
  const prev = data.cfg; data.cfg = readForm();
  setMsg("Testing…");
  try{
    const r = await callAI("Reply with only JSON.", [{role:"user", content:'Reply with only {"ok":true,"saludo":"a short Spanish greeting"}'}], {temperature:0});
    setMsg(`Connected. The AI replied: ${r.saludo || "ok"}`, "ok");
  }catch(e){ setMsg(e.message, "err"); }
  finally{ data.cfg = prev; }
};
$("saveBtn").onclick = async () => {
  if($("provider").value==="gemini" && $("apiKey").value.trim() && !$("gemModel").value){
    await loadModelList();
    if(!$("gemModel").value){ setMsg("Not saved yet: no model could be loaded. See the message under Model.", "err"); $("modelMsg").scrollIntoView({block:"center"}); return; }
  }
  data.cfg = readForm(); save(); dlg.close(); startMsg(""); renderChat();
};

// ---------- setup ----------
$("scenario").value = "cafe";
setLang(lang);
showTab("tChat");
if(!data.cfg.key) setTimeout(openSettings, 300);

if("serviceWorker" in navigator && location.protocol==="https:"){ navigator.serviceWorker.register("sw.js").catch(()=>{}); }
})();
