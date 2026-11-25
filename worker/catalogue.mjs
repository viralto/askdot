const products = new Map([
  [4912, 'EasyTac software only'], [4911, 'Full kit, classic reader and Digidown'],
  [4910, 'Driver card kit, classic reader'], [4909, 'Full kit, modern reader and Digidown'],
  [4908, 'Driver card kit, modern reader'], [3308, 'Digidown VU download device'],
  [3300, 'Identiv uTrust 2700R reader']
]);
const shop = 'https://www.easytac.uk';
const shopLink = shop + '/shop/';
const vat = {English:'ex VAT',French:'hors TVA',German:'zzgl. MwSt.',Italian:'IVA esclusa',Spanish:'sin IVA',Dutch:'excl. btw',Swedish:'exkl. moms',Danish:'ekskl. moms'};
function entry(id,currency,minor,link) {
  if (!products.has(id) || !Number.isSafeInteger(minor) || minor<=0 || !link?.startsWith(shop+'/product/')) return null;
  return {key:currency+'_'+id,name:products.get(id),currency,minor,link};
}
async function shopCatalogue(currency) {
  const response=await fetch(shop+'/easytac-shop-for-owner-drivers-and-contract-drivers/',{
    method:'POST',body:new URLSearchParams({wcc_switcher:currency}),signal:AbortSignal.timeout(5500)
  });
  if (!response.ok) throw new Error('Shop unavailable');
  let item;
  const entries=[];
  const parser=new HTMLRewriter()
    .on('li.product',{element(el){item={id:Number(el.getAttribute('class')?.match(/\bpost-(\d+)\b/)?.[1]),price:'',tax:''};entries.push(item);}})
    .on('li.product a.woocommerce-loop-product__link',{element(el){item.link=el.getAttribute('href');}})
    .on('li.product .price bdi',{text(chunk){item.price+=chunk.text;}})
    .on('li.product .woocommerce-price-suffix',{text(chunk){item.tax+=chunk.text;}});
  await parser.transform(response).arrayBuffer();
  return entries.flatMap(p=>{
    const minor=shopAmount(p.price,currency);
    const row=minor !== null && /ex\.\s*VAT/i.test(p.tax) && entry(p.id,currency,minor,p.link);
    return row?[row]:[];
  });
}
export function shopAmount(raw,currency) {
  const text=raw.replace(/&(?:pound|#163|#x0*a3);/gi,'£').replace(/&(?:euro|#8364|#x0*20ac);/gi,'€').replace(/&(?:nbsp|#160|#xa0);/gi,' ');
  const match=text.trim().match(/^([£€])\s*([0-9]+)[.,]([0-9]{2})$/);
  return match && match[1]===(currency==='EUR'?'€':'£') ? Number(match[2]+match[3]) : null;
}
export async function catalogue(currency,ctx) {
  const key='https://askdot.viralto.workers.dev/catalogue-cache/v4/'+currency;
  try {
    const cached=await caches.default.match(key);
    if(cached)return await cached.json();
    const entries=await shopCatalogue(currency);
    if(entries.length)ctx.waitUntil(caches.default.put(key,Response.json(entries,{headers:{'Cache-Control':'public,max-age=900'}})).catch(()=>{}));
    return entries;
  } catch { return []; }
}
export function priceInstructions(entries) {
  const refs=entries.map(e=>e.name+' ('+e.currency+'): [[PRICE:'+e.key+']]');
  return 'To quote a price use the exact catalogue marker for the requested item and currency. The app replaces each marker with the amount, tax label and product link. Never write a monetary amount or a separate product link yourself. If there is no marker for the requested item and currency, refer to '+shopLink+'.\n'+refs.join('\n');
}
export function verifiedReply(text,entries,lang) {
  const values=new Map(entries.map(e=>[e.key,e]));
  const markers=/\[\[PRICE:([A-Z]+_\d+)\]\]/g;
  const plain=text.replace(markers,'');
  const money=/[£€$]\s*\d|(?:GBP|EUR)\s*\d|\d[\d.,]*\s*(?:GBP|EUR|euros?|pounds?|livres?|libras?|sterline|pund|pfund|€|£)/i;
  const unknown=[...text.matchAll(markers)].some(m=>!values.has(m[1]));
  if(unknown || /\bPRICE\s*[:_]/i.test(plain) || money.test(plain)) return shopLink;
  return text.replace(markers,(_,key)=>{
    const e=values.get(key);
    const number=(e.minor/100).toFixed(2);
    return e.currency+' '+(lang && lang!=='English'?number.replace('.',','):number)+' '+(vat[lang]||vat.English)+' '+e.link;
  });
}

export function componentQuote(question,entries,lang,defaultCurrency) {
  // A direct standalone component price can be answered from the shop without inference.
  if (!/how much|price|cost|prix|combien|coût|preis|kost|precio|cu[aá]nto|prezzo|quanto|prijs|hvor meget|hur mycket/i.test(question)) return null;
  if (/kit|bundle|together with|compare|compatib|recommend|difference|shipping|livraison|delivery|including vat/i.test(question)) return null;
  const ids=[];
  if (/digidown/i.test(question)) ids.push(3308);
  if (/identiv|2700r|utrust/i.test(question)) ids.push(3300);
  if (!ids.length) return null;
  const currencies=[];
  if (/gbp|pounds?|sterling|livres?|£/i.test(question)) currencies.push('GBP');
  if (/eur(?:o|os)?\b|€/i.test(question)) currencies.push('EUR');
  if (!currencies.length) currencies.push(defaultCurrency);
  const lines=[];
  for (const currency of currencies) for (const id of ids) {
    const row=entries.find(e=>e.key===currency+'_'+id);
    if(!row) return null;
    lines.push(products.get(id)+' · '+verifiedReply('[[PRICE:'+row.key+']]',entries,lang));
  }
  return lines.join('\n\n');
}
