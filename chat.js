const labels = {
  en:['Send','Try again','Edit question','Dot couldn’t finish that request. Your question is still here.','Dot is busy. Please try again in a minute.','Couldn’t translate this conversation.','Done','That’s not what I see','Email support','New chat','Copy summary','Copied','Question','Recent steps','Clear this conversation?'],
  de:['Senden','Erneut versuchen','Frage bearbeiten','Die Anfrage ist fehlgeschlagen. Ihre Frage ist noch da.','Bitte versuchen Sie es in einer Minute erneut.','Das Gespräch konnte nicht übersetzt werden.','Erledigt','Bei mir sieht das anders aus','Support kontaktieren','Neuer Chat','Zusammenfassung kopieren','Kopiert','Frage','Letzte Schritte','Dieses Gespräch löschen?'],
  fr:['Envoyer','Réessayer','Modifier la question','La demande a échoué. Votre question a été conservée.','Réessayez dans une minute.','Impossible de traduire la conversation.','C’est fait','Mon écran est différent','Contacter le support','Nouvelle discussion','Copier le résumé','Copié','Question','Étapes récentes','Effacer cette conversation ?'],
  es:['Enviar','Reintentar','Editar pregunta','La solicitud ha fallado. Tu pregunta sigue aquí.','Inténtalo de nuevo en un minuto.','No se pudo traducir la conversación.','Hecho','Mi pantalla es diferente','Contactar con soporte','Nuevo chat','Copiar resumen','Copiado','Pregunta','Pasos recientes','¿Borrar esta conversación?'],
  it:['Invia','Riprova','Modifica domanda','La richiesta non è riuscita. La domanda è ancora qui.','Riprova tra un minuto.','Impossibile tradurre la conversazione.','Fatto','La schermata è diversa','Contatta il supporto','Nuova chat','Copia riepilogo','Copiato','Domanda','Ultimi passaggi','Cancellare questa conversazione?'],
  nl:['Versturen','Opnieuw proberen','Vraag bewerken','Het verzoek is mislukt. Je vraag staat er nog.','Probeer het over een minuut opnieuw.','Het gesprek kon niet worden vertaald.','Gedaan','Mijn scherm ziet er anders uit','Mail de helpdesk','Nieuw gesprek','Samenvatting kopiëren','Gekopieerd','Vraag','Recente stappen','Dit gesprek wissen?'],
  da:['Send','Prøv igen','Redigér spørgsmål','Anmodningen mislykkedes. Dit spørgsmål er bevaret.','Prøv igen om et minut.','Samtalen kunne ikke oversættes.','Færdig','Min skærm ser anderledes ud','Skriv til support','Ny samtale','Kopiér resumé','Kopieret','Spørgsmål','Seneste trin','Slet denne samtale?'],
  sv:['Skicka','Försök igen','Redigera frågan','Begäran misslyckades. Din fråga finns kvar.','Försök igen om en minut.','Det gick inte att översätta samtalet.','Klart','Min skärm ser annorlunda ut','Mejla supporten','Ny chatt','Kopiera sammanfattning','Kopierat','Fråga','Senaste steg','Radera den här konversationen?']
};
const $ = id => document.getElementById(id);
const sessionKey = 'askdot.review.v1';
let lang = 'en', turns = [], busy = '', queued = '', failure = null, guided = false;
const originalWelcome = $('welcome').cloneNode(true);
function save() {
  try { sessionStorage.setItem(sessionKey, JSON.stringify({lang,turns,guided})); } catch { /* private browsing or full session storage */ }
}
function restore() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(sessionKey));
    if (saved && Object.hasOwn(LANGS,saved.lang) && Array.isArray(saved.turns) &&
        saved.turns.every(t => ['user','assistant'].includes(t.role) && typeof t.text === 'string' && t.translations && typeof t.translations === 'object')) {
      lang=saved.lang; turns=saved.turns; guided=saved.guided === true;
      if (turns.at(-1)?.role==='user') failure={mode:'chat'};
    }
  } catch { /* Start a clean session. */ }
}
function shown(t) { return t.translations[lang] || t.text; }
function linkText(node, text) {
  const allowed = ['www.easytac.uk','www.easytac.eu','www.gov.uk','transport.ec.europa.eu'];
  for (const part of text.split(/(https:\/\/[^\s<>"\])]+)/g)) {
    let url;
    if(part.startsWith('https://')) { try { url=new URL(part.replace(/[.,;:!?]+$/,'')); } catch {} }
    if(url && allowed.includes(url.hostname)) {
      const label=part.replace(/[.,;:!?]+$/,''); const a=document.createElement('a'); a.href=url.href; a.textContent=label; a.target='_blank'; a.rel='noopener noreferrer'; node.append(a,part.slice(label.length));
    } else node.append(document.createTextNode(part));
  }
}
function render() {
  const area=$('chatArea'); area.replaceChildren();
  if (!turns.length) {
    area.append(originalWelcome.cloneNode(true));
    $('welcomeTitle').textContent=LANGS[lang].title; $('welcomeText').textContent=LANGS[lang].text;
    [...$('suggestions').children].forEach((el,i)=>el.textContent=LANGS[lang].suggestions[i]||LANGS[lang].other);
  }
  for (const t of turns) {
    const row=document.createElement('div'); row.className='msg-row '+t.role;
    if(t.role==='assistant'){const dot=document.createElement('div');dot.className='msg-avatar';dot.textContent='dot';row.append(dot);}
    const bubble=document.createElement('div');bubble.className='msg-bubble '+t.role;linkText(bubble,shown(t));row.append(bubble);area.append(row);
  }
  if(busy==='chat'){const row=document.createElement('div');row.className='msg-row assistant';row.textContent='Dot …';area.append(row);}
  area.scrollTop=area.scrollHeight;
  const l=labels[lang];
  document.documentElement.lang=lang;
  for(const [id,i] of Object.entries({retry:1,edit:2,done:6,different:7,handoff:8,reset:9,copy:10,email:8})) $(id).textContent=l[i];
  $('summary').setAttribute('aria-label',l[10]);$('sendBtn').setAttribute('aria-label',l[0]);
  $('userInput').placeholder=LANGS[lang].placeholder;$('userInput').setAttribute('aria-label',LANGS[lang].placeholder);$('footerNote').textContent=LANGS[lang].footer;
  for(const b of document.querySelectorAll('.lang-flag')){const active=b.dataset.code.toLowerCase()===(queued||lang);b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));}
  document.body.classList.toggle('translating',busy==='translate');$('translatingBanner').textContent=LANGS[queued||lang].translating+'…';
  $('notice').textContent=failure ? l[failure.status===429?4:failure.mode==='translate'?5:3] : '';
  $('recovery').hidden=!failure||!!busy;$('edit').hidden=failure?.mode!=='chat';
  $('guide').hidden=!guided||!!busy||!!failure||turns.at(-1)?.role!=='assistant';
  $('tools').hidden=!turns.length||!!busy;$('supportBox').hidden=true;
  updateSendBtn();
}
function updateSendBtn() {
  $('sendBtn').disabled=!!busy||failure?.mode==='chat'||!$('userInput').value.trim();
  $('sendBtn').classList.toggle('active',!$('sendBtn').disabled);
}
function handleKey(e){if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();sendMessage();}}
function useSuggestion(btn){guided=btn===btn.parentElement.firstElementChild;$('userInput').value=btn.textContent;sendMessage();}
async function post(body) {
  const res=await fetch(API_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
  if(!res.ok) throw Object.assign(new Error('request'),{status:res.status});
  return res.json();
}
function append(role,text,language){turns.push({role,text,translations:{[language]:text}});save();}
function history() {
  const items=turns.slice(-31).map(t=>({role:t.role,content:t.text}));
  let total=items.reduce((s,t)=>s+t.content.length,0);
  while(items.length>1 && (total>27500||items[0].role!=='user')) total-=items.shift().content.length;
  return items;
}
function resumeSwitch(){const next=queued;queued='';render();if(next&&next!==lang)void setLang(next);}
async function sendMessage(retry=false) {
  if(busy || (failure?.mode==='chat'&&!retry))return;
  const input=$('userInput'),language=lang;
  if(!retry){const text=input.value.trim();if(!text||text.length>3000)return;input.value='';append('user',text,language);}
  failure=null;busy='chat';render();
  try {
    const result=await post({messages:history(),language});
    const answer=result.content?.filter(b=>b.type==='text'&&typeof b.text==='string').map(b=>b.text).join('\n').trim();
    if(!answer)throw new Error('empty');
    append('assistant',answer,language);
  } catch(err){failure={mode:'chat',status:err.status};}
  finally{busy='';resumeSwitch();input.focus();}
}
async function setLang(target) {
  if(!Object.hasOwn(LANGS,target))return;
  if(busy){queued=target;render();return;}
  if(target===lang)return;
  const priorFailure=failure?.mode==='chat'?failure:null;
  failure=null;busy='translate';queued=target;render();
  try {
    const missing=turns.filter(t=>!t.translations[target]);
    for(let i=0;i<missing.length;){
      const batch=[];let size=0;
      while(i<missing.length&&batch.length<8&&(!batch.length||size+missing[i].text.length<=6000)){size+=missing[i].text.length;batch.push(missing[i++]);}
      const data=await post({mode:'translate',language:target,messages:batch.map(t=>({role:t.role,content:t.text}))});
      if(!Array.isArray(data.translations)||data.translations.length!==batch.length||data.translations.some(t=>typeof t!=='string'||!t.trim()))throw new Error('shape');
      batch.forEach((t,j)=>t.translations[target]=data.translations[j]);save();
    }
    lang=target;save();failure=priorFailure;
  }catch(err){failure=priorFailure||{mode:'translate',target,status:err.status};if(queued===target)queued='';}
  finally{busy='';resumeSwitch();}
}
$('retry').onclick=()=>failure?.mode==='chat'?sendMessage(true):setLang(failure.target);
$('edit').onclick=()=>{if(busy||failure?.mode!=='chat')return;$('userInput').value=turns.pop().text;failure=null;save();render();$('userInput').focus();};
for(const id of ['done','different'])$(id).onclick=()=>{$('userInput').value=$(id).textContent;sendMessage();};
$('reset').onclick=()=>{if(!busy&&confirm(labels[lang][14])){turns=[];failure=null;guided=false;$('userInput').value='';save();render();}};
$('handoff').onclick=()=>{
  const l=labels[lang], tail=turns.slice(1).slice(-4);
  const summary=l[12]+': '+shown(turns[0]).slice(0,600)+'\n\n'+l[13]+':\n'+tail.map(t=>(t.role==='assistant'?'Dot':'›')+'  '+shown(t).slice(0,360)).join('\n');
  $('summary').value=summary;$('supportBox').hidden=false;
  $('email').href='mailto:support@easytac.uk?subject='+encodeURIComponent('EasyTac support')+'&body='+encodeURIComponent(summary);
};
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText($('summary').value);$('copy').textContent=labels[lang][11];}catch{$('summary').focus();$('summary').select();}};
restore();render();
