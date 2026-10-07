const DEFAULT_CLASS_SIZE = 30;
const MAX_CLASS_SIZE = 200;

function today() {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function studentNo(index) {
  return String(index + 1).padStart(2, '0');
}

function rowsForSize(size, previous) {
  const byNo = {};
  (previous || []).forEach(row => { byNo[row.studentNo] = row; });
  return Array.from({ length: size }, (_, index) => {
    const no = studentNo(index);
    const row = byNo[no] || {};
    return {
      studentNo: no,
      rawText: typeof row.rawText === 'string' ? row.rawText : '',
      score: row.score == null ? '' : String(row.score)
    };
  });
}

function errorMessage(error, fallback) {
  if (error && error.message) return error.message;
  if (error && error.errMsg) return error.errMsg;
  return fallback || '操作失败，请稍后重试';
}

async function callGrade(action, data) {
  const response = await wx.cloud.callFunction({ name: 'gradeService', data: Object.assign({ action }, data || {}) });
  const result = response.result;
  if (!result || !result.ok) throw new Error(result && result.message || '云端服务暂不可用');
  return result.data;
}

module.exports = { DEFAULT_CLASS_SIZE, MAX_CLASS_SIZE, today, studentNo, rowsForSize, errorMessage, callGrade };
