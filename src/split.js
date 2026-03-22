function splitLongToken(token, maxLen, chunks) {
  for (let i = 0; i < token.length; i += maxLen) {
    chunks.push(token.slice(i, i + maxLen));
  }
}

export function splitForDiscord(text, maxLen = 2000) {
  const cleaned = String(text ?? "").trim();
  if (!cleaned) return [""];
  if (cleaned.length <= maxLen) return [cleaned];

  const chunks = [];
  let current = "";
  const paragraphs = cleaned.split(/\n{2,}/);

  for (const rawPara of paragraphs) {
    const para = rawPara.trim();
    if (!para) continue;

    const candidate = current ? `${current}\n\n${para}` : para;
    if (candidate.length <= maxLen) {
      current = candidate;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = "";
    }

    if (para.length <= maxLen) {
      current = para;
      continue;
    }

    const sentences = para.split(/(?<=[.!?])\s+/);
    for (const rawSentence of sentences) {
      const sentence = rawSentence.trim();
      if (!sentence) continue;

      if (sentence.length > maxLen) {
        if (current) {
          chunks.push(current);
          current = "";
        }
        splitLongToken(sentence, maxLen, chunks);
        continue;
      }

      const next = current ? `${current} ${sentence}` : sentence;
      if (next.length <= maxLen) {
        current = next;
      } else {
        if (current) chunks.push(current);
        current = sentence;
      }
    }
  }

  if (current) chunks.push(current);
  return chunks.length ? chunks : [cleaned.slice(0, maxLen)];
}
