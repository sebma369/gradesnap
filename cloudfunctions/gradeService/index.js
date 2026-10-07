const cloud = require('wx-server-sdk');
const https = require('https');
const crypto = require('crypto');
const { createWorkbook } = require('./xlsx');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const MAX_CLASS_SIZE = 200;
const MAX_SUBJECTS = 50;
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
  const settings = result.data[0] || {};
  return {
    classSize: settings.classSize || 30,
    subjects: Array.isArray(settings.subjects) ? settings.subjects : []
  };
}

async function saveSettings(openid, event) {
  const size = Number(event.classSize);
  assert(Number.isInteger(size) && size >= 1 && size <= MAX_CLASS_SIZE, '班级人数需为 1–200 的整数');
  const subjects = event.subjects === undefined ? (await getSettings(openid)).subjects : event.subjects;
  assert(Array.isArray(subjects) && subjects.length <= MAX_SUBJECTS, `科目数量不能超过 ${MAX_SUBJECTS} 个`);
  const cleanSubjects = subjects.map(name => {
    assert(typeof name === 'string' && name.trim().length >= 1 && name.trim().length <= 30, '科目名称需为 1–30 字');
    return name.trim();
  });
  assert(new Set(cleanSubjects).size === cleanSubjects.length, '科目不能重复');
  await db.collection('settings').doc(openid).set({ data: { classSize: size, subjects: cleanSubjects, updateTime: db.serverDate() } });
  return { classSize: size, subjects: cleanSubjects };
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
    assert(score === null || Number.isFinite(score), `学号 ${studentNo} 的成绩无效`);
    return { studentNo, score };
  });
  assert(clean.some(row => row.score !== null), '请至少填写一位学生的成绩');
  return clean;
}

async function saveRecord(openid, event) {
  assert(validDate(event.date), '日期格式不正确');
  const subject = String(event.subject || '').trim();
  assert(subject && subject.length <= 30, '请选择有效科目');
  const content = String(event.content || '').trim();
  assert(content.length <= 100, '内容不能超过 100 字');
  const scores = validateScores(event.scores);
  const imageFileID = String(event.imageFileID || '');
  assert(!imageFileID || imageFileID.startsWith('cloud://'), '图片地址无效');
  const result = await db.collection('scoreRecords').add({ data: {
    ownerOpenId: openid, date: event.date, subject, content, scores, imageFileID,
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
  return records.map(({ _id, date, subject, content, scores }) => ({ _id, date, subject, content: content || '', scores }));
}

function requestVision(url, apiKey, body) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body));
    // 不记录图片内容、请求地址或 API Key。
    console.info('gradeService AI request', { requestBytes: payload.length });
    const handleNetworkError = error => {
      if (error && error.code === 'ECONNRESET') {
        reject(new Error('AI 服务连接被重置（ECONNRESET）。请检查云函数到 AI_API_URL 域名的网络连接；若只在大图时发生，请压缩图片后重试'));
      } else {
        reject(error);
      }
    };
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
        if (response.statusCode < 200 || response.statusCode >= 300) {
          let apiError;
          try { apiError = JSON.parse(raw).error; } catch (_) { /* 使用 HTTP 状态码提示 */ }
          const hints = {
            400: '请求参数无效，请确认模型支持图片输入和 Chat Completions 格式',
            401: 'API Key 无效，请核对 AI_API_KEY',
            403: '当前 API Key 无权调用该模型',
            404: '接口路径或模型不存在，请核对 AI_API_URL 服务根地址及 AI_MODEL',
            413: '图片超过 AI 服务允许的请求大小',
            429: '请求过于频繁或服务额度不足'
          };
          const code = typeof apiError?.code === 'string' && /^[\w.-]{1,80}$/.test(apiError.code)
            ? `，错误码 ${apiError.code}` : '';
          const hint = hints[response.statusCode] || '请查看 AI 服务状态和云函数日志';
          return reject(new Error(`AI 服务请求失败（HTTP ${response.statusCode}${code}）：${hint}`));
        }
        try { resolve(JSON.parse(raw)); } catch (_) { reject(new Error('AI 服务返回内容无法解析')); }
      });
      response.on('error', handleNetworkError);
    });
    request.on('timeout', () => request.destroy(new Error('AI 识别超时，请重试')));
    request.on('error', handleNetworkError);
    request.end(payload);
  });
}

function imageMime(buffer) {
  if (buffer.subarray(0, 3).toString('hex') === 'ffd8ff') return 'image/jpeg';
  if (buffer.subarray(0, 4).toString('hex') === '89504e47') return 'image/png';
  if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  throw new Error('仅支持 JPG、PNG 或 WebP 图片');
}

async function recognize(event, openid) {
  const fileID = String(event.imageFileID || '');
  assert(fileID.startsWith('cloud://') && fileID.includes('/score-sheets/'), '请先上传成绩表图片');
  const apiKey = process.env.AI_API_KEY;
  const model = process.env.AI_MODEL;
  const baseUrl = process.env.AI_API_URL;
  assert(apiKey && model && baseUrl, '识别服务尚未配置，请在云函数环境变量中设置 AI_API_KEY、AI_MODEL 和 AI_API_URL');
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/v1/chat/completions`;
  const [downloaded, settings] = await Promise.all([
    cloud.downloadFile({ fileID }), getSettings(openid)
  ]);
  const image = downloaded.fileContent;
  assert(image && image.length && image.length <= 8 * 1024 * 1024, '图片过大，请压缩到 8MB 以内');
  const mime = imageMime(image);
  const subjectRule = settings.subjects.length
    ? `科目应从已设置科目 ${JSON.stringify(settings.subjects)} 中选择；若图片未直接写明，可根据内容判断，无法确定则填空字符串。`
    : '根据图片中的科目文字识别科目；无法确定则填空字符串。';
  const prompt = [
    '识别这张手写成绩表中的日期、科目、内容、学号和成绩。',
    '如果日期没有年份则默认为今年，无法确定或置信度底的日期填空字符串。',
    subjectRule,
    '内容取图片中明确写出的课题、练习或考试内容；若没有明确内容或识别确信度不高则填空字符串，不要用科目或日期代替，也不要猜测。',
    '学号逐个读取，不要猜测或补充不存在的学号。学号保留前导零。图片中已出现的学号即使成绩格为空，也要返回对应的 scores 条目。',
    '成绩有两种记分规则，第一种为字母等级，需要进行等级到数值的转换，A+ 对应 2 分，A 对应 0 分，A- 对应 0 分，B+ 对应 0 分，B 对应 -2 分，B- 对应 -2 分，所有C等级对应 -3 分，所有D等级对应 -4 分，空白对应 -2 分。老师手写成绩有时会在字母旁打一个点，请忽略此点号，不要将它识别为减号，如果无法确定识别，则将此成绩填为null。',
    '第二种记分方式中有以下规则：对勾符号对应0分，正值数字对应相应数值分（如 +4 对应 4 分），空白对应 -2 分。如果无法确定识别，则将此成绩填为null。',
    '每个学号的成绩先识别原始文本 rawText，再按上述规则转换为 score。rawText 必须原样保留图片中写出的内容，例如 A+、+4、√；确认为空白时填“空白”。有笔迹但无法辨认时 rawText和score都填 null，不要把无法辨认当作空白。',
    '只返回 JSON 对象，字段名严格为 date、subject、content、scores；scores 中每项的字段名严格为 studentNo、rawText、score。date 为 YYYY-MM-DD 或空字符串；subject、content、rawText 为字符串；score 为数字或 null。示例：{"date":"2026-10-07","subject":"数学","content":"单元练习","scores":[{"studentNo":"01","rawText":"A+","score":2},{"studentNo":"02","rawText":"空白","score":-2}]}。'
  ].join('\n');
  const imageUrl = `data:${mime};base64,${image.toString('base64')}`;
  const response = await requestVision(endpoint, apiKey, {
    model, messages: [{ role: 'user', content: [
      { type: 'text', text: prompt },
      { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } }
    ] }]
  });
  const message = response.choices?.[0]?.message;
  assert(!message?.refusal, 'AI 未能识别这张图片，请手动填写成绩');
  const content = message?.content;
  assert(typeof content === 'string' && content.trim(), 'AI 未返回识别结果');
  let parsed;
  try { parsed = JSON.parse(content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()); }
  catch (_) { throw new Error('AI 返回的数据格式不正确，请重试或手动填写'); }
  const scores = Array.isArray(parsed.scores) ? parsed.scores.filter(row => row && /^\d{1,3}$/.test(String(row.studentNo))).map(row => ({
    studentNo: String(row.studentNo).padStart(2, '0'),
    rawText: typeof row.rawText === 'string' ? row.rawText : '',
    score: row.score == null || row.score === '' || !Number.isFinite(Number(row.score)) ? null : Number(row.score)
  })) : [];
  return {
    date: validDate(parsed.date) ? parsed.date : '',
    subject: typeof parsed.subject === 'string' ? parsed.subject.trim().slice(0, 30) : '',
    content: typeof parsed.content === 'string' ? parsed.content.trim().slice(0, 100) : '',
    scores
  };
}

async function exportRecords(openid, event) {
  const records = await listRecords(openid, event);
  assert(records.length, '当前日期范围暂无成绩记录');
  const settings = await getSettings(openid);
  const workbook = createWorkbook(records, {
    startDate: event.startDate, endDate: event.endDate,
    classSize: settings.classSize, subjects: settings.subjects
  });
  const startMonth = event.startDate.slice(0, 7);
  const endMonth = event.endDate.slice(0, 7);
  const rangeFolder = startMonth === endMonth ? startMonth : `${startMonth}_至_${endMonth}`;
  // 云函数默认可能使用 UTC；文件名统一写北京时间。
  const beijingTime = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
  const exportedAt = `${beijingTime.slice(0, 10)}_${beijingTime.slice(11, 23).replace(/[:.]/g, '-')}`;
  const uniqueSuffix = crypto.randomBytes(3).toString('hex');
  const fileName = `成绩表_${event.startDate}_至_${event.endDate}_导出于_${exportedAt}_${uniqueSuffix}.xlsx`;
  const cloudPath = `成绩导出/${openid}/${rangeFolder}/${fileName}`;
  const result = await cloud.uploadFile({
    cloudPath,
    fileContent: workbook
  });
  return { fileID: result.fileID, fileName };
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
      case 'recognize': data = await recognize(event, openid); break;
      case 'exportRecords': data = await exportRecords(openid, event); break;
      default: throw new Error('不支持的操作');
    }
    return { ok: true, data };
  } catch (error) {
    console.error('gradeService:', error);
    return { ok: false, message: error.message || '云端服务暂不可用' };
  }
};
