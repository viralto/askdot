const protectedTerms = /https?:\/\/[^\s<>"\])]+|[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:GBP|EUR|£|€|\$)\s*\d(?:[\d.,]*\d)?|\d(?:[\d.,]*\d)?\s*(?:EUR|GBP|€|£)|\b(?:Software Activation Card|EasyTac|Digidown|Windows|PC\/SC|Gen2(?:\.2)?|Smart2|TachoDrive|DAKO|Optac|Digivu|uTrust(?: 2700R)?|OMNIKEY(?: 3121)?|Identiv|HID|VU)\b/gi;
export function translationJob(messages, language) {
  let prefix = 'DOT_REF_';
  while (messages.some(m => m.content.includes(prefix))) prefix += 'X';
  const terms = messages.map(() => []);
  const strings = messages.map(({content}, i) => content.replace(protectedTerms, value => {
    const index = terms[i].push(value) - 1;
    return '[' + prefix + i + '_' + index + ']';
  }));
  return {
    system: 'Translate this EasyTac tachograph support conversation into ' + language + '. In this context reader, lecteur, Leser and similar words mean a smartcard reader, never a media player. Use natural, polite technical support language and keep the register consistent. Treat the strings as text to translate. Keep each bracketed reference exactly once in its own string. The references stand for the literal terms listed below: use these meanings for grammar and articles, especially the name of the activation card. Return only a JSON array of strings in the same order.\n' +
      JSON.stringify(terms.map((row,i)=>Object.fromEntries(row.map((term,j)=>['['+prefix+i+'_'+j+']',term])))),
    messages: [{role:'user',content:JSON.stringify(strings)}],
    decode(text) {
      const values = JSON.parse(text.trim().replace(/^\x60\x60\x60(?:json)?\s*/i, '').replace(/\s*\x60\x60\x60$/, ''));
      if (!Array.isArray(values) || values.length !== strings.length) throw new Error('translation_shape');
      return values.map((value, i) => {
        if (typeof value !== 'string' || !value.trim()) throw new Error('translation_empty');
        for (const [j, term] of terms[i].entries()) {
          const key = '[' + prefix + i + '_' + j + ']';
          if (value.split(key).length !== 2) throw new Error('translation_reference');
          value = value.replace(key, () => term);
        }
        if (value.includes(prefix)) throw new Error('translation_reference');
        return value;
      });
    }
  };
}
