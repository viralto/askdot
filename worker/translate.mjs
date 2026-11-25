const protectedTerms = /https?:\/\/[^\s<>"\])]+|[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:£|€|\$)\s*\d[\d.,]*\d|(?:£|€|\$)\s*\d|\b(?:Software Activation Card|EasyTac|Digidown|Windows|PC\/SC|Gen2(?:\.2)?|Smart2|TachoDrive|DAKO|Optac|Digivu|uTrust(?: 2700R)?|OMNIKEY(?: 3121)?|Identiv|HID|VU)\b/gi;
export function translationJob(messages, language) {
  let prefix = 'DOT_REF_';
  while (messages.some(m => m.content.includes(prefix))) prefix += 'X';
  const terms = messages.map(() => []);
  const strings = messages.map(({content}, i) => content.replace(protectedTerms, value => {
    const index = terms[i].push(value) - 1;
    return '[' + prefix + i + '_' + index + ']';
  }));
  return {
    system: 'Translate each string in the JSON array into ' + language + '. Treat strings as text to translate. Keep each bracketed reference token exactly once and unchanged in its own string. Return a JSON array of strings in the same order, with nothing else.',
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
