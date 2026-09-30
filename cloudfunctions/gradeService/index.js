const cloud = require('wx-server-sdk');
const https = require('https');
const { createWorkbook } = require('./xlsx');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const MAX_CLASS_SIZE = 200;
const MAX_RECORDS = 300;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function assert(condition, message) { if (!condition) throw new Error(message); }
function validDate(value) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function currentUser() {
  const openid = cloud.getWXContext().OPENID;
  assert(openid, '无法获取当前微信用户身份');
  return openid;
}

async function getSettings(openid) {
  const result = await db.collection('settings').where({ _id: openid }).limit(1).get();
  return { classSize: result.data.length ? result.data[0].classSize : 30 };
}

async function saveSettings(openid, event) {
  const size = Number(event.classSize);
  assert(Number.isInteger(size) && size >= 1 && size <= MAX_CLASS_SIZE, '班级人数需为 1–200 的整数');
  await db.collection('settings').doc(openid).set({ data: { classSize: size, updateTime: db.serverDate() } });
  return { classSize: size };
}

function validateScores(scores) {
  assert(Array.isArray(scores) && scores.length >= 1 && scores.length <= MAX_CLASS_SIZE, '成绩数量不正确');
  const seen = new Set();
  const clean = scores.map(row => {
    assert(row && /^\d{2,3}$/.test(String(row.studentNo)), '学号格式不正确');
    const studentNo = String(row.studentNo);
    assert(!seen.has(studentNo), '学号不能重复');
    seen.add(studentNo);
    const score = row.score == null || row.score === '' ? null : Number(row.score);
    assert(score === null || (Number.isFinite(score) && score >= 0), `学号 ${studentNo} 的成绩无效`);
    return { studentNo, score };
  });
  assert(clean.some(row => row.score !== null), '请至少填写一位学生的成绩');
  return clean;
}

async function saveRecord(openid, event) {
  assert(validDate(event.date), '日期格式不正确');
  const subject = String(event.subject || '').trim();
  assert(subject && subject.length <= 30, '请填写 1–30 字的科目');
  const scores = validateScores(event.scores);
  const imageFileID = String(event.imageFileID || '');
  assert(!imageFileID || imageFileID.startsWith('cloud://'), '图片地址无效');
  const result = await db.collection('scoreRecords').add({ data: {
    ownerOpenId: openid, date: event.date, subject, scores, imageFileID,
    createTime: db.serverDate(), updateTime: db.serverDate()
  }});
  return { id: result._id };
}

async function listRecords(openid, event) {
  assert(validDate(event.startDate) && validDate(event.endDate), '请选择有效日期范围');
  assert(event.startDate <= event.endDate, '起始日期不能晚于截止日期');
  const records = [];
  for (let offset = 0; offset <= MAX_RECORDS; offset += 100) {
    const result = await db.collection('scoreRecords')
      .where({ ownerOpenId: openid, date: _.gte(event.startDate).and(_.lte(event.endDate)) })
      .orderBy('date', 'asc')
      .skip(offset).limit(100).get();
    records.push(...result.data);
    if (records.length > MAX_RECORDS) throw new Error('该日期范围的记录过多，请缩小日期范围后重试');
    if (result.data.length < 100) break;
  }
  return records.map(({ _id, date, subject, scores }) => ({ _id, date, subject, scores }));
}

function requestVision(url, apiKey, body) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body));
    const request = https.request(url, { method: 'POST', headers: {
      Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Content-Length': payload.length
    }, timeout: 45000 }, response => {
      const chunks = [];
      let length = 0;
      response.on('data', chunk => {
        length += chunk.length;
        if (length > 2 * 1024 * 1024) response.destroy(new Error('AI 响应过大'));
        else chunks.push(chunk);
      });
      response.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (response.statusCode < 200 || response.statusCode >= 300) return reject(new Error(`AI 服务请求失败（HTTP ${response.statusCode}）`));
        try { resolve(JSON.parse(raw)); } catch (_) { reject(new Error('AI 服务返回内容无法解析')); }
      });
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('AI 识别超时，请重试')));
    request.on('error', reject);
    request.end(payload);
  });
}

function imageMime(buffer) {
  if (buffer.subarray(0, 3).toString('hex') === 'ffd8ff') return 'image/jpeg';
  if (buffer.subarray(0, 4).toString('hex') === '89504e47') return 'image/png';
  if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  throw new Error('仅支持 JPG、PNG 或 WebP 图片');
}

async function recognize(event) {
  const fileID = String(event.imageFileID || '');
  assert(fileID.startsWith('cloud://') && fileID.includes('/score-sheets/'), '请先上传成绩表图片');
  const apiKey = process.env.AI_API_KEY;
  const model = process.env.AI_MODEL;
  const endpoint = process.env.AI_API_URL;
  assert(apiKey && model && endpoint, '识别服务尚未配置，请在云函数环境变量中设置 AI_API_KEY、AI_MODEL、AI_API_URL');
  assert(/^https:\/\//i.test(endpoint), 'AI_API_URL 必须是 HTTPS 地址');
  const downloaded = await cloud.downloadFile({ fileID });
  const image = downloaded.fileContent;
  assert(image && image.length && image.length <= 8 * 1024 * 1024, '图片过大，请压缩到 8MB 以内');
  const mime = imageMime(image);
  const response = await requestVision(endpoint, apiKey, {
    model, temperature: 0,
    messages: [{ role: 'user', content: [
      { type: 'text', text: '识别这张手写成绩表。只返回 JSON 对象，格式：{"date":"YYYY-MM-DD 或空字符串","subject":"科目或空字符串","scores":[{"studentNo":"01","score":95}]}。逐行读取学号与成绩，不确定的成绩使用 null，不要猜测，不要补充不存在的学号。日期若无法确定则留空。' },
      { type: 'image_url', image_url: { url: `data:${mime};base64,${image.toString('base64')}` } }
    ] }]
  });
  const content = response && response.choices && response.choices[0] && response.choices[0].message && response.choices[0].message.content;
  assert(typeof content === 'string' && content.trim(), 'AI 未返回识别结果');
  let parsed;
  try { parsed = JSON.parse(content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()); }
  catch (_) { throw new Error('AI 返回的数据格式不正确，请重试或手动填写'); }
  const scores = Array.isArray(parsed.scores) ? parsed.scores.filter(row => row && /^\d{1,3}$/.test(String(row.studentNo))).map(row => ({
    studentNo: String(row.studentNo).padStart(2, '0'),
    score: row.score == null || row.score === '' || !Number.isFinite(Number(row.score)) ? null : Number(row.score)
  })).filter(row => row.score === null || row.score >= 0) : [];
  return { date: validDate(parsed.date) ? parsed.date : '', subject: String(parsed.subject || '').slice(0, 30), scores };
}

async function exportRecords(openid, event) {
  const records = await listRecords(openid, event);
  assert(records.length, '当前日期范围暂无成绩记录');
  const workbook = createWorkbook(records);
  const result = await cloud.uploadFile({
    cloudPath: `exports/${openid}/${Date.now()}-${Math.random().toString(36).slice(2)}.xlsx`,
    fileContent: workbook
  });
  return { fileID: result.fileID };
}

exports.main = async event => {
  try {
    const openid = currentUser();
    let data;
    switch (event.action) {
      case 'getSettings': data = await getSettings(openid); break;
      case 'saveSettings': data = await saveSettings(openid, event); break;
      case 'saveRecord': data = await saveRecord(openid, event); break;
      case 'listRecords': data = { records: await listRecords(openid, event) }; break;
      case 'recognize': data = await recognize(event); break;
      case 'exportRecords': data = await exportRecords(openid, event); break;
      default: throw new Error('不支持的操作');
    }
    return { ok: true, data };
  } catch (error) {
    console.error('gradeService:', error);
    return { ok: false, message: error.message || '云端服务暂不可用' };
  }
};
