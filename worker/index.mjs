import { behaviour, productFacts, regulatoryFacts } from './knowledge.mjs';
import { catalogue, priceInstructions, verifiedReply, componentQuote } from './catalogue.mjs';
import { translationJob } from './translate.mjs';

const languages = {en:'English',de:'German',fr:'French',es:'Spanish',it:'Italian',nl:'Dutch',da:'Danish',sv:'Swedish'};
const MAX_BYTES = 65536;
class Fault extends Error {
  constructor(status, code) { super(code); this.status = status; }
}
function response(value, status, headers) {
  return Response.json(value, {status, headers: {'Cache-Control':'no-store', ...headers}});
}
async function readBody(request) {
  if (Number(request.headers.get('content-length')) > MAX_BYTES) throw new Fault(413, 'too_large');
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new Fault(415, 'invalid');
  const reader = request.body?.getReader();
  if (!reader) throw new Fault(400, 'invalid');
  const decoder = new TextDecoder();
  let size = 0, text = '';
  for (;;) {
    const {value, done} = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) { await reader.cancel(); throw new Fault(413, 'too_large'); }
    text += decoder.decode(value,{stream:true});
  }
  try { return JSON.parse(text + decoder.decode()); } catch { throw new Fault(400, 'invalid'); }
}
function validate(data) {
  if (!data || !Array.isArray(data.messages) || !data.messages.length || ![undefined,'chat','translate'].includes(data.mode)) throw new Fault(400,'invalid');
  const translating = data.mode === 'translate';
  const lang = data.language ? Object.hasOwn(languages, data.language) && languages[data.language] : data.targetLanguage;
  if ((data.language !== undefined || translating) && !Object.values(languages).includes(lang)) throw new Fault(400,'invalid');
  if (data.messages.length > (translating ? 16 : 32)) throw new Fault(413,'too_large');
  let length = 0;
  const messages = data.messages.map(m => {
    if (!m || !['user','assistant'].includes(m.role) || typeof m.content !== 'string' || !m.content.trim()) throw new Fault(400,'invalid');
    if (m.content.length > 10000) throw new Fault(413,'too_large');
    length += m.content.length;
    return {role:m.role,content:m.content};
  });
  if (length > (translating ? 10000 : 28000)) throw new Fault(413,'too_large');
  if (!translating && (messages[0].role !== 'user' || messages.at(-1).role !== 'user')) throw new Fault(400,'invalid');
  return {translating,lang,messages};
}
async function askClaude(env, model, system, messages, maxTokens, mode) {
  let result;
  const start = Date.now();
  const body = {model, system, messages, max_tokens:maxTokens};
  if (model.endsWith('5-5')) body.output_config = {effort:'low'};
  try {
    result = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST', signal:AbortSignal.timeout(30000),
      headers:{'content-type':'application/json','anthropic-version':'2023-06-01','x-api-key':env.ANTHROPIC_API_KEY},
      body:JSON.stringify(body)
    });
  } catch { throw new Fault(503,'unavailable'); }
  if (!result.ok) {
    console.warn(JSON.stringify({event:'provider_error',mode,model,status:result.status}));
    throw new Fault(result.status === 429 ? 429 : 503, result.status === 429 ? 'busy' : 'unavailable');
  }
  const data = await result.json();
  const text = data.content?.filter(b => b.type === 'text' && typeof b.text === 'string').map(b=>b.text).join('\n').trim();
  if (!text || data.stop_reason === 'max_tokens') throw new Fault(502,'incomplete');
  const usage = {input_tokens:data.usage?.input_tokens ?? 0,output_tokens:data.usage?.output_tokens ?? 0};
  console.log(JSON.stringify({event:'completion',mode,model,...usage,elapsed_ms:Date.now()-start}));
  return {text,model,usage};
}
export default {
  async fetch(request,env,ctx) {
    const path = new URL(request.url).pathname;
    const headers = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST, OPTIONS'};
    if (request.method === 'OPTIONS') return new Response(null,{status:204,headers});
    if (request.method === 'GET' && path === '/') return response({service:'Ask Dot API',status:'running',endpoint:'/api/chat'},200,headers);
    if (path !== '/api/chat') return response({error:'not_found'},404,headers);
    if (request.method !== 'POST') return response({error:'method'},405,{...headers,Allow:'POST, OPTIONS'});
    try {
      const {translating,lang,messages} = validate(await readBody(request));
      const key = request.headers.get('CF-Connecting-IP') || 'unknown';
      const {success} = await env.LIMITER.limit({key});
      if (!success) throw new Fault(429,'busy');
      if (translating) {
        const job = translationJob(messages,lang);
        const {text,model,usage} = await askClaude(env,env.TRANSLATION_MODEL,job.system,job.messages,6000,'translate');
        let translations;
        try { translations = job.decode(text); } catch { throw new Fault(502,'incomplete'); }
        return response({translations,model,usage,content:[{type:'text',text:JSON.stringify(translations)}]},200,headers);
      }
      const currency = lang && lang !== 'English' ? 'EUR' : 'GBP';
      const other = currency === 'GBP' ? 'EUR' : 'GBP';
      const entries = (await Promise.all([catalogue(currency,ctx), catalogue(other,ctx)])).flat();
      const direct=componentQuote(messages.at(-1).content,entries,lang,currency);
      if(direct) return response({content:[{type:'text',text:direct}],source:'shop'},200,headers);
      const instruction = lang ? 'Reply in ' + lang + '. ' : 'Reply in the language of the newest question. ';
      const system = [behaviour,productFacts,regulatoryFacts,instruction+'Prefer '+currency+' unless the user requests otherwise.',priceInstructions(entries)].join('\n\n');
      const {text,model,usage} = await askClaude(env,env.CHAT_MODEL,system,messages,1200,'chat');
      return response({content:[{type:'text',text:verifiedReply(text,entries,lang)}],model,usage},200,headers);
    } catch (err) {
      const status = err instanceof Fault ? err.status : 503;
      return response({error:err instanceof Fault ? err.message : 'unavailable'},status,status===429?{...headers,'Retry-After':'60'}:headers);
    }
  }
};
