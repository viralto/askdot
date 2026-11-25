import test, {beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.mjs';
import {verifiedReply,shopAmount,componentQuote} from '../worker/catalogue.mjs';
import {translationJob} from '../worker/translate.mjs';

const originalFetch = globalThis.fetch;
const env = {LIMITER:{limit: async()=>({success:true})},CHAT_MODEL:'claude-sonnet-5-5',TRANSLATION_MODEL:'claude-haiku-5-5',ANTHROPIC_API_KEY:'test-only'};
const question = {language:'en',messages:[{role:'user',content:'How do I check my version?'}]};
const send=(body,bindings=env)=>worker.fetch(new Request('https://example.test/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),bindings,{waitUntil(){}});
beforeEach(()=>{globalThis.caches={default:{match:async()=>Response.json([])}};});
afterEach(()=>{globalThis.fetch=originalFetch;delete globalThis.caches;});
test('handles thinking blocks and ignores model overrides from the client',async()=>{
  globalThis.fetch=async(_,init)=>{const req=JSON.parse(init.body);assert.equal(req.model,env.CHAT_MODEL);return Response.json({content:[{type:'thinking'},{type:'text',text:'Open Help.'},{type:'text',text:'Choose About.'}],stop_reason:'end_turn'});};
  const res=await send({...question,model:'other'});assert.equal(res.status,200);assert.equal((await res.json()).content[0].text,'Open Help.\nChoose About.');
});
test('upstream busy is retryable and stays out of the conversation',async()=>{
  globalThis.fetch=async()=>new Response(null,{status:429});const r=await send(question);assert.equal(r.status,429);assert.equal(r.headers.get('retry-after'),'60');assert.equal((await r.json()).content,undefined);
});
test('a truncated reply is a recoverable error',async()=>{
  globalThis.fetch=async()=>Response.json({stop_reason:'max_tokens',content:[{type:'text',text:'Half'}]});assert.equal((await send(question)).status,502);
});
test('rejects excessive history, invalid languages, roles and oversized input before inference',async()=>{
  globalThis.fetch=()=>assert.fail();
  for(const [body,status] of [[{...question,language:'constructor'},400],[{messages:[{role:'system',content:'hello'}]},400],[{messages:Array(33).fill(question.messages[0])},413],[{messages:[{role:'user',content:'x'.repeat(70000)}]},413],[{mode:'translate',targetLanguage:'unsupported',messages:question.messages},400]]) assert.equal((await send(body)).status,status);
});
test('local rate limiter covers chat and translation',async()=>{
  globalThis.fetch=()=>assert.fail();const limited={...env,LIMITER:{limit:async()=>({success:false})}};
  for(const mode of ['chat','translate'])assert.equal((await send({...question,mode},limited)).status,429);
});
test('translates once using Haiku and restores exact terms, prices and URLs',async()=>{
  const messages=[{role:'user',content:'My EasyTac reader cost £25.00 or EUR 30,00. https://www.easytac.uk/help/'}];
  globalThis.fetch=async(_,init)=>{const b=JSON.parse(init.body);assert.equal(b.model,env.TRANSLATION_MODEL);const strings=JSON.parse(b.messages[0].content);assert.ok(!strings[0].includes('£25.00'));assert.ok(!strings[0].includes('30,00'));return Response.json({content:[{type:'thinking'},{type:'text',text:JSON.stringify(strings.map(s=>s.replace('My','Mon')))}]});};
  const res=await send({mode:'translate',targetLanguage:'French',messages});assert.equal(res.status,200);const v=await res.json();assert.deepEqual(v.translations,[messages[0].content.replace('My','Mon')]);assert.deepEqual(JSON.parse(v.content[0].text),v.translations);
});
test('rejects a translation that drops or duplicates a protected reference',()=>{
  const j=translationJob([{role:'user',content:'EasyTac'}],'French');assert.throws(()=>j.decode('["texte"]'));const [key]=JSON.parse(j.messages[0].content);assert.throws(()=>j.decode(JSON.stringify([key+key])));
});
test('April chat payload is still accepted',async()=>{
  globalThis.fetch=async()=>Response.json({content:[{type:'text',text:'Hello'}]});assert.equal((await send({messages:question.messages})).status,200);
});

test('prices and links are rendered from shop data in the requested language',()=>{
  const rows=[{key:'EUR_3308',currency:'EUR',minor:22680,link:'https://www.easytac.uk/product/digidown/'}];
  assert.equal(verifiedReply('Digidown: [[PRICE:EUR_3308]]',rows,'French'),'Digidown: EUR 226,80 hors TVA https://www.easytac.uk/product/digidown/');
  for(const text of ['226,00 EUR hors TVA','[[PRICE:EUR_999]]','£189.00','EUR 226.00'])assert.equal(verifiedReply(text,rows,'French'),'https://www.easytac.uk/shop/');
});

test('reads HTML-encoded currencies, rejects a mismatched currency and keeps the pence',()=>{
  assert.equal(shopAmount('&pound;189.00','GBP'),18900);
  assert.equal(shopAmount('&#8364;&nbsp;226,80','EUR'),22680);
  assert.equal(shopAmount('£189.00','EUR'),null);
  const rows=[{key:'EUR_3308',currency:'EUR',minor:22680,link:'https://www.easytac.uk/product/digidown/'}];
  assert.match(componentQuote('Quel est le prix en euros du Digidown seul ?',rows,'French','EUR'),/226,80 hors TVA/);
});
