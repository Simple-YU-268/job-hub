// Local-only Obsidian persistence through the Local REST API plugin.
const INDEX_FILE = '.jobhub-records.json';
const DASHBOARD_FILE = '看板.md';

function cleanBaseUrl(url) { return String(url || '').replace(/\/+$/, ''); }
function encodePath(path) { return path.split('/').map(encodeURIComponent).join('/'); }

async function request(config, path, options = {}) {
  const response = await fetch(`${cleanBaseUrl(config.baseUrl)}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${config.apiKey}`, ...(options.headers || {}) }
  });
  if (!response.ok) throw new Error(`Obsidian API 请求失败（${response.status}）`);
  return response;
}

export async function testConnection(config) {
  const response = await request(config, '/');
  const data = await response.json();
  if (!data.authenticated) throw new Error('Obsidian API Key 无效');
  return data;
}

async function loadIndex(config) {
  try {
    const response = await request(config, `/vault/${encodePath(config.folder)}/${INDEX_FILE}`);
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (error) {
    if (String(error.message).includes('404')) return [];
    throw error;
  }
}

async function writeText(config, path, content) {
  await request(config, `/vault/${encodePath(path)}`, {
    method: 'PUT', headers: { 'Content-Type': 'text/markdown; charset=utf-8' }, body: content
  });
}

function esc(value) { return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' '); }
function slug(value) { return String(value || '未命名').replace(/[\\/:*?"<>|]/g, '-').slice(0, 80); }

function notePath(config, record) {
  const date = new Date(record.appliedAt || Date.now()).toISOString().slice(0, 10);
  return `${config.folder}/Applications/${date} - ${slug(record.company)} - ${slug(record.position)}.md`;
}

function noteContent(record) {
  return `---\ncompany: "${esc(record.company)}"\nposition: "${esc(record.position)}"\nappliedAt: "${new Date(record.appliedAt).toISOString()}"\nstatus: "${esc(record.status)}"\nurl: "${esc(record.url)}"\n---\n\n# ${record.company || '未命名'} · ${record.position || '未命名'}\n\n${record.note || ''}\n`;
}

function dashboard(records) {
  const byStatus = records.reduce((all, item) => ({ ...all, [item.status]: (all[item.status] || 0) + 1 }), {});
  const recent = [...records].sort((a, b) => b.appliedAt - a.appliedAt).slice(0, 20);
  const week = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() - 6 + i);
    const next = new Date(date); next.setDate(next.getDate() + 1);
    return { date, count: records.filter(item => item.appliedAt >= date.getTime() && item.appliedAt < next.getTime()).length };
  });
  const interviewing = records.filter(item => ['一面', '二面', '三面', 'HR面'].includes(item.status)).length;
  const offers = records.filter(item => item.status === 'Offer').length;
  return `# 求职看板\n\n> 由 JobHub 自动更新 · ${new Date().toLocaleString('zh-CN')}\n\n## 概览\n\n| 总投递 | 面试中 | Offer |\n| ---: | ---: | ---: |\n| ${records.length} | ${interviewing} | ${offers} |\n\n## 状态分布\n\n| 状态 | 数量 |\n| --- | ---: |\n${Object.entries(byStatus).map(([status, count]) => `| ${status} | ${count} |`).join('\n') || '| 暂无 | 0 |'}\n\n## 近 7 天投递\n\n| 日期 | 数量 |\n| --- | ---: |\n${week.map(item => `| ${item.date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })} | ${item.count} |`).join('\n')}\n\n## 最近投递\n\n| 公司 | 岗位 | 状态 | 投递时间 | 链接 |\n| --- | --- | --- | --- | --- |\n${recent.map(item => `| ${item.company || '-'} | ${item.position || '-'} | ${item.status || '-'} | ${new Date(item.appliedAt).toLocaleDateString('zh-CN')} | ${item.url ? `[打开](${item.url})` : '-'} |`).join('\n') || '| 暂无 | - | - | - | - |'}\n`;
}

export async function saveRecord(config, record) {
  const records = await loadIndex(config);
  const id = record.id || crypto.randomUUID();
  const saved = { ...record, id, notePath: notePath(config, record) };
  await writeText(config, saved.notePath, noteContent(saved));
  const index = [saved, ...records.filter(item => item.id !== id)];
  await writeText(config, `${config.folder}/${INDEX_FILE}`, JSON.stringify(index, null, 2));
  await writeText(config, `${config.folder}/${DASHBOARD_FILE}`, dashboard(index));
  return saved;
}

export async function listRecords(config) { return loadIndex(config); }
