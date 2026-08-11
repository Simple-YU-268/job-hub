// ================================================================
// JobHub — AI 驱动的字段匹配引擎
// 需要配置 AI API Key。无 Key 时扫描按钮禁用。
// ================================================================
import { callAI, isAiEnabled, getAiConfig } from './ai-client.js';

// A privacy-friendly first pass for ordinary application forms.  It deliberately
// only fills unambiguous fields; AI remains available for the long tail.
const FIELD_ALIASES = {
  '姓名': ['name', '姓名', '真实姓名', '中文名', '英文名'],
  '手机': ['phone', 'mobile', 'tel', '电话', '手机号', '手机'],
  '邮箱': ['email', 'e-mail', '邮箱', '邮件'],
  '城市': ['city', 'location', '城市', '所在地', '现居地'],
  '个人链接': ['website', 'homepage', 'portfolio', 'linkedin', 'github', '个人链接', '个人主页'],
  '求职意向': ['position', 'job', 'role', '职位', '岗位', '求职意向']
};

function normalise(value) {
  return String(value || '').toLowerCase().replace(/[\s_\-:：/\\()[\]{}]/g, '');
}

function candidatesFor(label) {
  const normalisedLabel = normalise(label);
  const aliases = Object.entries(FIELD_ALIASES).find(([key, values]) =>
    normalise(key) === normalisedLabel || values.some(value => normalise(value) === normalisedLabel)
  );
  return [label, ...(aliases ? aliases[1] : [])].map(normalise).filter(Boolean);
}

export function matchFieldsLocally(resumeFields, pageElements) {
  const used = new Set();
  const matches = [];
  for (const field of resumeFields) {
    const candidates = candidatesFor(field.label);
    let best = null;
    pageElements.forEach((element, index) => {
      if (used.has(index)) return;
      const descriptor = normalise([element.labelText, element.placeholder, element.name, element.id].filter(Boolean).join(' '));
      if (!descriptor) return;
      const exact = candidates.some(candidate => descriptor === candidate);
      const contained = candidates.some(candidate => candidate.length >= 2 && descriptor.includes(candidate));
      if (exact || contained) {
        const confidence = exact || candidates.some(candidate => descriptor === candidate) ? 'high' : 'medium';
        if (!best || confidence === 'high') best = { field, element, index, confidence };
      }
    });
    if (best) {
      used.add(best.index);
      matches.push({ field: best.field, element: best.element, confidence: best.confidence, source: 'local' });
    }
  }
  return matches;
}

export async function matchFieldsWithAI(resumeFields, pageElements) {
  const config = await getAiConfig();
  if (!isAiEnabled(config)) throw new Error('AI 未配置');

  const fieldList = resumeFields.map((f, i) =>
    `[${i}] label="${f.label}" value="${f.value.slice(0, 80)}"`
  ).join('\n');

  const elementList = pageElements.map((el, i) => {
    const label = el.labelText || el.placeholder || el.name || el.id || '';
    return `[${i}] tag=${el.tag} type=${el.type || 'text'} label="${label.slice(0, 60)}"`;
  }).join('\n');

  const response = await callAI({
    systemPrompt: '你是表单匹配专家。根据语义将简历字段匹配到网页表单元素。返回 JSON 数组：[{"fieldIndex":0,"elementIndex":2,"confidence":"high"}]。confidence: high/medium/low。只输出 JSON。',
    userMessage: `简历字段：\n${fieldList}\n\n网页表单元素：\n${elementList}`,
    temperature: 0.0,
    jsonMode: true
  });

  let jsonStr = response;
  const m = response.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
  if (m) jsonStr = m[1].trim();
  else { const s = response.indexOf('['), e = response.lastIndexOf(']'); if (s>=0 && e>s) jsonStr = response.slice(s, e+1); }

  let pairs;
  try { pairs = JSON.parse(jsonStr); if (!Array.isArray(pairs)) throw null; }
  catch { return []; }

  const matches = [], used = new Set();
  for (const p of pairs) {
    const field = resumeFields[p.fieldIndex], el = pageElements[p.elementIndex];
    if (!field || !el || used.has(p.elementIndex)) continue;
    used.add(p.elementIndex);
    matches.push({ field, element: el, confidence: p.confidence || 'medium' });
  }
  return matches;
}
