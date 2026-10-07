// Dependency-free XLSX writer. ZIP entries use the store method.
const { Buffer } = require('buffer');

function escapeXml(value) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(files) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of files) {
    const nameBytes = Buffer.from(name);
    const data = Buffer.from(content);
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    local.push(header, nameBytes, data);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(data.length, 20);
    directory.writeUInt32LE(data.length, 24);
    directory.writeUInt16LE(nameBytes.length, 28);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, nameBytes);
    offset += header.length + nameBytes.length + data.length;
  }
  const directoryBytes = Buffer.concat(central);
  const footer = Buffer.alloc(22);
  footer.writeUInt32LE(0x06054b50, 0);
  footer.writeUInt16LE(files.length, 8);
  footer.writeUInt16LE(files.length, 10);
  footer.writeUInt32LE(directoryBytes.length, 12);
  footer.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directoryBytes, footer]);
}

function columnName(index) {
  let name = '';
  for (let number = index; number > 0; number = Math.floor((number - 1) / 26)) {
    name = String.fromCharCode(65 + ((number - 1) % 26)) + name;
  }
  return name;
}

function textCell(column, row, value, style) {
  return `<c r="${column}${row}" s="${style}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
}

function numberCell(column, row, value, style) {
  return `<c r="${column}${row}" s="${style}"><v>${Number(value.toPrecision(15))}</v></c>`;
}

function blankCell(column, row, style) {
  return textCell(column, row, '', style);
}

function rowXml(row, cells, height) {
  return `<row r="${row}"${height ? ` ht="${height}" customHeight="1"` : ''}>${cells.join('')}</row>`;
}

function sumScores(values) {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total)) throw new Error('成绩总和超出可计算范围');
  return total;
}

function normalizeStudentNo(value) {
  const studentNo = String(value);
  return /^\d+$/.test(studentNo) ? String(Number(studentNo)).padStart(2, '0') : studentNo;
}

function groupRecords(records) {
  const dates = new Map();
  const studentNos = new Set();
  for (const record of records) {
    if (!dates.has(record.date)) dates.set(record.date, new Map());
    const subjects = dates.get(record.date);
    const subject = String(record.subject || '').trim() || '未设置科目';
    if (!subjects.has(subject)) subjects.set(subject, []);
    const scores = new Map();
    for (const entry of record.scores || []) {
      if (!entry || entry.score === null || entry.score === undefined || entry.score === '') continue;
      const score = Number(entry.score);
      if (!Number.isFinite(score)) continue;
      const studentNo = normalizeStudentNo(entry.studentNo);
      studentNos.add(studentNo);
      scores.set(studentNo, score);
    }
    subjects.get(subject).push({ content: String(record.content || '').trim(), scores });
  }
  return { dates, studentNos };
}

function dateLabel(date, showYear) {
  const [year, month, day] = date.split('-');
  return `${showYear ? `${year}.` : ''}${Number(month)}.${Number(day)}`;
}

function createStyleXml() {
  const fonts = [
    '<font><sz val="11"/><name val="Arial"/></font>',
    '<font><b/><sz val="11"/><name val="Arial"/></font>',
    '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>',
    '<font><b/><sz val="14"/><name val="Arial"/></font>'
  ];
  const fills = [
    '<fill><patternFill patternType="none"/></fill>',
    '<fill><patternFill patternType="gray125"/></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FFEAF2FD"/><bgColor indexed="64"/></patternFill></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FFAFCBF1"/><bgColor indexed="64"/></patternFill></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FF3979D8"/><bgColor indexed="64"/></patternFill></fill>'
  ];
  const allBorders = '<border><left style="thin"><color rgb="FF000000"/></left><right style="thin"><color rgb="FF000000"/></right><top style="thin"><color rgb="FF000000"/></top><bottom style="thin"><color rgb="FF000000"/></bottom><diagonal/></border>';
  // Styles 3/7: time range, 5/10: subject, 6/11: day. All other cells have no fill.
  const styles = [
    [0, 0], [3, 0], [1, 0, true], [2, 4, true],
    [0, 0, true], [1, 2, true], [1, 3, true], [2, 4],
    [0, 0], [0, 0], [1, 2], [1, 3]
  ];
  const cellXfs = styles.map(([font, fill, wrap], index) =>
    index === 0
      ? '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
      : `<xf numFmtId="0" fontId="${font}" fillId="${fill}" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"${fill ? ' applyFill="1"' : ''}><alignment horizontal="center" vertical="center"${wrap ? ' wrapText="1"' : ''}/></xf>`
  ).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="${fonts.length}">${fonts.join('')}</fonts><fills count="${fills.length}">${fills.join('')}</fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>${allBorders}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${styles.length}">${cellXfs}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
}

function createWorkbook(records, { startDate = '', endDate = '', classSize = 0, subjects: preferredSubjects = [] } = {}) {
  const { dates, studentNos } = groupRecords(records);
  const size = Number(classSize);
  if (Number.isInteger(size) && size > 0) {
    for (let number = 1; number <= size; number++) studentNos.add(String(number).padStart(2, '0'));
  }
  const students = [...studentNos].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
  const subjectOrder = new Map(preferredSubjects.map((name, index) => [name, index]));
  const allDates = [...dates.keys()].sort();
  const showYear = new Set(allDates.map(date => date.slice(0, 4))).size > 1;
  const columns = [{ type: 'student', width: 7 }, { type: 'period', width: 12 }];
  const days = [];

  for (const date of allDates) {
    const groups = dates.get(date);
    const day = { date, label: dateLabel(date, showYear), start: columns.length + 1, subjects: [] };
    const subjectNames = [...groups.keys()].sort((a, b) =>
      (subjectOrder.get(a) ?? Infinity) - (subjectOrder.get(b) ?? Infinity) || a.localeCompare(b, 'zh-CN'));
    for (const name of subjectNames) {
      const projects = groups.get(name);
      const subject = { name, start: columns.length + 1, projects: [] };
      const labelCounts = new Map();
      projects.forEach((project, index) => {
        const base = project.content || `内容${index + 1}`;
        const count = (labelCounts.get(base) || 0) + 1;
        labelCounts.set(base, count);
        const label = count === 1 ? base : `${base}（${count}）`;
        const width = Math.min(18, Math.max(8, Array.from(label).reduce((length, char) => length + (char.charCodeAt(0) > 127 ? 2 : 1), 0) + 2));
        const column = columns.length + 1;
        columns.push({ type: 'project', width });
        subject.projects.push({ column, label, scores: project.scores });
      });
      subject.totalColumn = columns.length + 1;
      columns.push({ type: 'subjectTotal', width: 8 });
      day.subjects.push(subject);
    }
    day.totalColumn = columns.length + 1;
    columns.push({ type: 'dayTotal', width: 11 });
    day.end = day.totalColumn;
    days.push(day);
  }

  const lastColumn = columnName(columns.length);
  const merges = [`A1:${lastColumn}1`, 'A2:A4', 'B2:B4'];
  const titleCells = columns.map((_, index) => blankCell(columnName(index + 1), 1, 1));
  titleCells[0] = textCell('A', 1, `${startDate} 至 ${endDate} 成绩表`, 1);
  const dateCells = columns.map((_, index) => blankCell(columnName(index + 1), 2, index === 1 ? 3 : 2));
  const subjectCells = columns.map((_, index) => blankCell(columnName(index + 1), 3, index === 1 ? 3 : 2));
  const projectCells = columns.map((_, index) => blankCell(columnName(index + 1), 4, index === 1 ? 3 : 2));
  dateCells[0] = textCell('A', 2, '学号', 2);
  dateCells[1] = textCell('B', 2, '时间段总分', 3);

  for (const day of days) {
    dateCells[day.start - 1] = textCell(columnName(day.start), 2, day.label, 2);
    merges.push(`${columnName(day.start)}2:${columnName(day.end)}2`);
    for (const subject of day.subjects) {
      subjectCells[subject.start - 1] = textCell(columnName(subject.start), 3, subject.name, 2);
      merges.push(`${columnName(subject.start)}3:${columnName(subject.totalColumn)}3`);
      for (const project of subject.projects) {
        projectCells[project.column - 1] = textCell(columnName(project.column), 4, project.label, 4);
      }
      projectCells[subject.totalColumn - 1] = textCell(columnName(subject.totalColumn), 4, '总分', 5);
    }
    subjectCells[day.totalColumn - 1] = textCell(columnName(day.totalColumn), 3, '当日总分', 6);
    projectCells[day.totalColumn - 1] = blankCell(columnName(day.totalColumn), 4, 6);
    merges.push(`${columnName(day.totalColumn)}3:${columnName(day.totalColumn)}4`);
  }

  const rows = [
    rowXml(1, titleCells, 25),
    rowXml(2, dateCells, 23),
    rowXml(3, subjectCells, 23),
    rowXml(4, projectCells, 30)
  ];
  for (const [index, studentNo] of students.entries()) {
    const row = index + 5;
    const styles = { student: 9, period: 7, project: 8, subjectTotal: 10, dayTotal: 11 };
    const cells = columns.map((column, columnIndex) => blankCell(columnName(columnIndex + 1), row, styles[column.type]));
    cells[0] = textCell('A', row, studentNo, 9);
    const dayTotals = [];
    for (const day of days) {
      const subjectTotals = [];
      for (const subject of day.subjects) {
        const scores = [];
        for (const project of subject.projects) {
          const score = project.scores.get(studentNo);
          if (score === undefined) continue;
          cells[project.column - 1] = numberCell(columnName(project.column), row, score, 8);
          scores.push(score);
        }
        if (scores.length) {
          const total = sumScores(scores);
          cells[subject.totalColumn - 1] = numberCell(columnName(subject.totalColumn), row, total, 10);
          subjectTotals.push(total);
        }
      }
      if (subjectTotals.length) {
        const total = sumScores(subjectTotals);
        cells[day.totalColumn - 1] = numberCell(columnName(day.totalColumn), row, total, 11);
        dayTotals.push(total);
      }
    }
    if (dayTotals.length) cells[1] = numberCell('B', row, sumScores(dayTotals), 7);
    rows.push(rowXml(row, cells, 19));
  }

  const widths = columns.map((column, index) => `<col min="${index + 1}" max="${index + 1}" width="${column.width}" customWidth="1"/>`).join('');
  const merged = merges.map(ref => `<mergeCell ref="${ref}"/>`).join('');
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${lastColumn}${rows.length}"/><sheetViews><sheetView workbookViewId="0" showGridLines="1"><pane xSplit="2" ySplit="4" topLeftCell="C5" activePane="bottomRight" state="frozen"/></sheetView></sheetViews><cols>${widths}</cols><sheetData>${rows.join('')}</sheetData><mergeCells count="${merges.length}">${merged}</mergeCells></worksheet>`;
  const styleXml = createStyleXml();
  return zip([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="成绩表" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ['xl/worksheets/sheet1.xml', sheet],
    ['xl/styles.xml', styleXml]
  ]);
}

module.exports = { createWorkbook };
