const { DEFAULT_CLASS_SIZE, today, rowsForSize, errorMessage, callGrade, getSelectedClassId, setSelectedClassId } = require('../../utils/grade');

function showReturnModal(content) {
  wx.showModal({ title: '请补全信息', content, showCancel: false, confirmText: '返回' });
}

function selectImageArea(path) {
  return new Promise((resolve, reject) => wx.navigateTo({
    url: `/pages/crop/crop?src=${encodeURIComponent(path)}`,
    events: {
      cropDone: result => resolve(result.tempFilePath),
      cropCancel: () => resolve('')
    },
    fail: reject
  }));
}

Page({
  data: {
    date: today(), subject: '', subjectIndex: -1, subjects: [], content: '', classSize: DEFAULT_CLASS_SIZE,
    scores: rowsForSize(DEFAULT_CLASS_SIZE), imageFileID: '', imagePath: '', classId: '', className: '', classManagementEnabled: false,
    busy: false, selectingImage: false, busyText: '', recognized: false, loadingSettings: false, settingsReady: false
  },

  onShow() {
    const classId = getSelectedClassId();
    if (this.data.selectingImage && this.data.classId === classId) return;
    if (this.data.classId && this.data.classId !== classId) {
      this.setData({
        subject: '', subjectIndex: -1, content: '', classSize: DEFAULT_CLASS_SIZE,
        scores: rowsForSize(DEFAULT_CLASS_SIZE), imageFileID: '', imagePath: '',
        recognized: false, classId: '', className: '', subjects: [], settingsReady: false,
        busy: false, selectingImage: false, busyText: ''
      });
    }
    return this.loadSettings();
  },

  async loadSettings() {
    const requestId = this.settingsRequestId = (this.settingsRequestId || 0) + 1;
    const requestedClassId = getSelectedClassId();
    this.setData({ loadingSettings: true, settingsReady: false, classManagementEnabled: false });
    try {
      const settings = await callGrade('getSettings');
      if (requestId !== this.settingsRequestId) return;
      const enabled = settings.classManagementEnabled !== false;
      if (!enabled) setSelectedClassId(settings.classId);
      else if (requestedClassId !== getSelectedClassId()) return;
      if (this.data.classId && this.data.classId !== settings.classId) this.setData({
        subject: '', subjectIndex: -1, content: '', classSize: DEFAULT_CLASS_SIZE,
        scores: rowsForSize(DEFAULT_CLASS_SIZE), imageFileID: '', imagePath: '', recognized: false
      });
      const size = settings.classSize || DEFAULT_CLASS_SIZE;
      const subjects = Array.isArray(settings.subjects) ? settings.subjects : [];
      this.applyClassSize(size);
      this.applySubjects(subjects);
      this.setData({ classId: settings.classId, className: settings.className, classManagementEnabled: enabled, loadingSettings: false, settingsReady: true });
    } catch (error) {
      if (requestId !== this.settingsRequestId || requestedClassId !== getSelectedClassId()) return;
      this.setData({ classId: '', className: '', subjects: [], subject: '', subjectIndex: -1, loadingSettings: false, settingsReady: false });
      if (error.code !== 'CLASS_REQUIRED') wx.showToast({ title: '云端设置读取失败，请重试', icon: 'none' });
    }
  },

  applyClassSize(size) {
    if (size < 1 || size > 200 || size === this.data.classSize) return;
    this.setData({ classSize: size, scores: rowsForSize(size, this.data.scores) });
  },

  applySubjects(subjects) {
    const index = subjects.indexOf(this.data.subject);
    this.setData({ subjects, subject: index >= 0 ? this.data.subject : '', subjectIndex: index });
  },

  chooseImage() {
    if (this.data.busy || this.data.selectingImage || !this.data.settingsReady || this.data.classId !== getSelectedClassId()) return;
    wx.showActionSheet({
      itemList: ['拍照', '从相册选择'],
      success: result => this.pickImage(result.tapIndex === 0 ? 'camera' : 'album')
    });
  },

  async pickImage(sourceType) {
    if (this.data.busy || this.data.selectingImage || !this.data.settingsReady || this.data.classId !== getSelectedClassId()) return;
    const classId = this.data.classId;
    this.setData({ selectingImage: true });
    let uploadStarted = false;
    try {
      const media = await wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: [sourceType], sizeType: ['original'] });
      if (classId !== getSelectedClassId()) return;
      const path = await selectImageArea(media.tempFiles[0].tempFilePath);
      if (!path || classId !== getSelectedClassId()) return;
      const extension = (path.match(/\.(jpe?g|png|webp)$/i) || [,'jpg'])[1].toLowerCase();
      uploadStarted = true;
      this.setData({
        busy: true, busyText: '正在上传成绩表…', subject: '', subjectIndex: -1, imageFileID: '', imagePath: path,
        scores: this.data.scores.map(row => ({ studentNo: row.studentNo, score: row.score, rawText: '' }))
      });
      const upload = await wx.cloud.uploadFile({ cloudPath: `score-sheets/${classId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`, filePath: path });
      if (classId !== getSelectedClassId()) return;
      this.setData({ imageFileID: upload.fileID, imagePath: path, busyText: '正在识别成绩表…' });
      const result = await callGrade('recognize', { imageFileID: upload.fileID });
      if (classId !== getSelectedClassId()) return;
      const recognized = (result.scores || []).map(row => ({
        studentNo: String(row.studentNo).padStart(2, '0'),
        rawText: typeof row.rawText === 'string' ? row.rawText : '',
        score: row.score
      }));
      const recognizedSubject = String(result.subject || '').trim();
      const subjectIndex = this.data.subjects.indexOf(recognizedSubject);
      const scores = rowsForSize(this.data.classSize, recognized);
      const recognizedCount = scores.filter(row => row.rawText.trim()).length;
      const lowRecognition = recognizedCount * 10 < this.data.classSize * 9;
      this.setData({
        date: result.date || this.data.date,
        subject: subjectIndex >= 0 ? recognizedSubject : '', subjectIndex,
        content: typeof result.content === 'string' ? result.content : '',
        scores, recognized: true
      });
      const notices = [];
      if (lowRecognition) {
        const rate = (recognizedCount / this.data.classSize * 100).toFixed(1);
        notices.push(`识别出 ${recognizedCount}/${this.data.classSize} 位学生的原始成绩（${rate}%），低于 90%。建议规范书写，核对图片并手动补全，必要时重新拍摄。`);
      }
      if (recognizedSubject && subjectIndex < 0) notices.push(`识别到“${recognizedSubject}”，但科目设置中没有该项。请从现有科目中选择，或到设置页添加。`);
      if (scores.some(row => row.rawText.trim() && (row.score === null || row.score === ''))) notices.push('部分识别结果暂无数字分数映射，请核对原始文本并手动填写；保存后会记录本次对应关系。');
      if (notices.length) {
        wx.showModal({ title: lowRecognition ? '识别结果较少' : subjectIndex < 0 && recognizedSubject ? '请选择科目' : '请补全成绩', content: notices.join('\n'), showCancel: false });
      } else if (recognized.some(row => row.score !== null && row.score !== '')) {
        wx.showToast({ title: '识别完成，请核对', icon: 'success' });
      } else {
        wx.showModal({ title: '未识别到成绩', content: '请查看原图并手动填写成绩后保存。', showCancel: false });
      }
    } catch (error) {
      if (classId !== getSelectedClassId()) return;
      if (!String(error.errMsg || '').includes('cancel')) {
        if (!uploadStarted) {
          wx.showModal({ title: '图片处理失败', content: errorMessage(error), showCancel: false });
          return;
        }
        const hint = this.data.imageFileID ? '图片已保留，您仍可手动填写。' : '图片尚未保存到云端，手动录入不会关联图片；也可重新选择图片。';
        wx.showModal({ title: '识别未完成', content: `${errorMessage(error)}。${hint}`, showCancel: false });
      }
    } finally {
      this.setData({ busy: false, selectingImage: false, busyText: '' });
    }
  },

  onDateChange(event) { this.setData({ date: event.detail.value }); },
  onSubjectChange(event) {
    const index = Number(event.detail.value);
    const selected = event.detail.value != null && event.detail.value !== '' && Number.isInteger(index) && index >= 0 && index < this.data.subjects.length;
    this.setData({ subject: selected ? this.data.subjects[index] : '', subjectIndex: selected ? index : -1 });
  },
  onContentInput(event) { this.setData({ content: event.detail.value }); },
  onScoreInput(event) {
    const index = Number(event.currentTarget.dataset.index);
    this.setData({ [`scores[${index}].score`]: event.detail.value });
  },
  previewImage() {
    if (this.data.imagePath) wx.previewImage({ urls: [this.data.imagePath] });
  },

  async save() {
    if (this.data.busy || this.data.selectingImage || !this.data.settingsReady || this.data.classId !== getSelectedClassId()) return;
    const date = String(this.data.date || '').trim();
    const subject = String(this.data.subject || '').trim();
    const content = String(this.data.content || '').trim();
    const missing = [];
    if (!date) missing.push('日期');
    if (!subject || this.data.subjectIndex < 0 || this.data.subjects[this.data.subjectIndex] !== subject) missing.push('科目');
    if (!content) missing.push('内容');
    const missingNos = this.data.scores.filter(row => row.score == null || String(row.score).trim() === '').map(row => row.studentNo);
    if (missingNos.length) {
      const shown = missingNos.slice(0, 5).join('、');
      missing.push(`学号 ${shown}${missingNos.length > 5 ? ` 等 ${missingNos.length} 位学生` : ''}的成绩`);
    }
    if (missing.length) return showReturnModal(`请填写：${missing.join('、')}。`);
    const invalid = this.data.scores.find(row => !/^-?\d+(?:\.\d+)?$/.test(String(row.score).trim()));
    if (invalid) return showReturnModal(`学号 ${invalid.studentNo} 的成绩格式不正确，请填写数字。`);
    if (this.data.recognized) {
      const confirmed = await new Promise(resolve => wx.showModal({
        title: '请核对成绩', content: this.data.classManagementEnabled
          ? `内容由AI识别生成，请仔细核对。当前选择的日期：${date}。请确认成绩与当前选中班级。`
          : `内容由AI识别生成，请仔细核对。当前选择的日期：${date}。请确认成绩。`,
        showCancel: true, cancelText: '返回', confirmText: '确定',
        success: result => resolve(result.confirm), fail: () => resolve(false)
      }));
      if (!confirmed) return;
    }
    if (this.data.classId !== getSelectedClassId()) return;
    const classId = this.data.classId;
    this.setData({ busy: true, busyText: '正在保存成绩…' });
    try {
      const saved = await callGrade('saveRecord', {
        date, subject, content,
        scores: this.data.scores.map(row => ({
          studentNo: row.studentNo, score: row.score === '' ? null : Number(row.score),
          rawText: this.data.recognized ? row.rawText : ''
        })),
        imageFileID: this.data.imageFileID
      });
      if (classId !== getSelectedClassId()) return;
      this.setData({ subject: '', subjectIndex: -1, content: '', scores: rowsForSize(this.data.classSize), imageFileID: '', imagePath: '', recognized: false });
      wx.showModal({ title: '保存成功', content: saved.mappingWarning || '本次成绩已保存到云端，可在“导出”页查询。', showCancel: false });
    } catch (error) {
      if (classId !== getSelectedClassId()) return;
      wx.showModal({ title: '保存失败', content: errorMessage(error), showCancel: false });
    } finally {
      this.setData({ busy: false, busyText: '' });
    }
  }
});
