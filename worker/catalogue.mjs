const products = new Map([
  [4912, 'EasyTac software only'], [4911, 'Full kit, classic reader and Digidown'],
  [4910, 'Driver card kit, classic reader'], [4909, 'Full kit, modern reader and Digidown'],
  [4908, 'Driver card kit, modern reader'], [3308, 'Digidown VU download device'],
  [3300, 'Identiv uTrust 2700R reader']
]);
const shop = 'https://www.easytac.uk';
async function euroCatalogue() {
  const response = await fetch(shop + '/easytac-shop-for-owner-drivers-and-contract-drivers/', {
    method:'POST', body:new URLSearchParams({wcc_switcher:'EUR'}), signal:AbortSignal.timeout(5500)
  });
  if (!response.ok) throw new Error('Shop unavailable');
  let item;
  const entries = [];
  const parser = new HTMLRewriter()
    .on('li.product', {element(el) {
      const id = Number(el.getAttribute('class')?.match(/\bpost-(\d+)\b/)?.[1]);
      item = {id,price:'',tax:''}; entries.push(item);
    }})
    .on('li.product a.woocommerce-loop-product__link', {element(el) {item.link = el.getAttribute('href');}})
    .on('li.product .price bdi', {text(chunk) {item.price += chunk.text;}})
    .on('li.product .woocommerce-price-suffix', {text(chunk) {item.tax += chunk.text;}});
  await parser.transform(response).arrayBuffer();
  return entries.filter(p => products.has(p.id) && p.link?.startsWith(shop + '/product/') &&
    /^€\s*[0-9]+[.,][0-9]{2}$/.test(p.price.trim()) && /ex\.\s*VAT/i.test(p.tax))
    .map(p => products.get(p.id) + ': EUR ' + p.price.trim().slice(1).trim() + ' ex VAT ' + p.link).join('\n');
}
export async function catalogue(currency,ctx) {
  const key = 'https://askdot.viralto.workers.dev/catalogue-cache/v1/' + currency;
  try {
    const cached = await caches.default.match(key);
    if (cached) return await cached.text();
    const text = currency === 'EUR' ? await euroCatalogue() : await sterlingCatalogue();
    if (text) {
      ctx.waitUntil(caches.default.put(key,new Response(text,{headers:{'Cache-Control':'public,max-age=900'}})).catch(()=>{}));
      return text;
    }
  } catch { /* Use the verified shop link if the feed is unavailable. */ }
  return 'No verified ' + currency + ' prices available. Use https://www.easytac.uk/shop/ and its currency selector.';
}
async function sterlingCatalogue() {
  const currency = 'GBP';
  const url = new URL('/wp-json/wc/store/v1/products', shop);
  url.searchParams.set('include', [...products.keys()].join(','));
  url.searchParams.set('currency', currency);
  try {
    const response = await fetch(url, { cf: { cacheEverything: true, cacheTtlByStatus: { '200-299': 900, '400-599': 0 } }, signal: AbortSignal.timeout(3500) });
    if (!response.ok) throw new Error('Shop unavailable');
    const rows = [];
    for (const item of await response.json()) {
      const p = item.prices;
      if (!products.has(item.id) || !p || p.currency_code !== currency || !/^\d+$/.test(p.price) || p.currency_minor_unit !== 2) continue;
      const link = new URL(item.permalink);
      if (link.origin !== shop || !link.pathname.startsWith('/product/')) continue;
      rows.push(products.get(item.id) + ': ' + currency + ' ' + (Number(p.price) / 100).toFixed(2) + ' ex VAT ' + link.href);
    }
    if (rows.length) return rows.join('\n');
  } catch { /* A shop outage must not prevent ordinary troubleshooting. */ }
  return '';
}
