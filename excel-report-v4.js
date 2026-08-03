(function () {
  'use strict';

  const BRAND = {
    navy: '234A5A',
    blue: '7EC3E3',
    section: '8DB4E2',
    paleBlue: 'DDEBF7',
    paleGreen: 'E2F0D9',
    paleRed: 'FCE4D6',
    manualInput: 'FFF200',
    white: 'FFFFFF',
    dark: '1F2937',
    border: '7F8C8D',
    green: '00A651',
    red: 'C0504D',
  };

  const thinBorder = {
    top: { style: 'thin', color: { argb: BRAND.border } },
    left: { style: 'thin', color: { argb: BRAND.border } },
    bottom: { style: 'thin', color: { argb: BRAND.border } },
    right: { style: 'thin', color: { argb: BRAND.border } },
  };
  const reportDividerBorder = { style: 'thin', color: { argb: 'FF7F8C8D' } };

  function asNumber(value, fallback = 0) {
    if (value == null || (typeof value === 'string' && !value.trim())) return fallback;
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function hasReportData(session) {
    return Boolean(
      session && (
        String(session.locationId || '').trim() ||
        String(session.testNumber || '').trim() ||
        (Array.isArray(session.points) && session.points.length)
      )
    );
  }

  function safeSheetText(value) {
    return String(value || '').replace(/[\\/*?:[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function compactTestLabel(value) {
    const label = safeSheetText(value);
    if (!label) return 'Test';
    return /^test\b/i.test(label) ? label : `Test ${label}`;
  }

  function buildSheetNames(sessions) {
    const used = new Set();
    return sessions.map((session, index) => {
      const location = safeSheetText(session.locationId) || `Location ${index + 1}`;
      const base = `${location} - ${compactTestLabel(session.testNumber)}`.slice(0, 31).trim();
      let name = base || `Test ${index + 1}`;
      let duplicate = 2;
      while (used.has(name.toLowerCase())) {
        const suffix = ` (${duplicate++})`;
        name = `${base.slice(0, 31 - suffix.length).trim()}${suffix}`;
      }
      used.add(name.toLowerCase());
      return name;
    });
  }

  function pointTimestamp(point) {
    if (point && point.clockISO) {
      const parsed = Date.parse(point.clockISO);
      if (Number.isFinite(parsed)) return parsed;
    }
    const timestamp = Number(point && point.ts);
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  function normalizePoints(session) {
    return (Array.isArray(session.points) ? session.points : [])
      .map((point, index) => ({
        index,
        time: asNumber(point && point.timeMins, index ? NaN : 0),
        depth: asNumber(point && point.depth, NaN),
        timestamp: pointTimestamp(point),
        clockTime: String((point && point.clockTime) || ''),
      }))
      .filter(point => Number.isFinite(point.time) && Number.isFinite(point.depth));
  }

  function crossingTime(points, excavationDepth, targetHead) {
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const current = points[index];
      const previousHead = excavationDepth - previous.depth;
      const currentHead = excavationDepth - current.depth;
      if (previousHead >= targetHead && currentHead <= targetHead) {
        if (previousHead === currentHead) return current.time;
        return previous.time + ((previousHead - targetHead) * (current.time - previous.time)) / (previousHead - currentHead);
      }
    }
    return null;
  }

  function calculateResults(session, points = normalizePoints(session)) {
    const excavation = asNumber(session.depthExcavation, NaN);
    const initialHead = points.length && Number.isFinite(excavation) ? excavation - points[0].depth : null;
    const level75 = Number.isFinite(initialHead) ? initialHead * 0.75 : null;
    const level25 = Number.isFinite(initialHead) ? initialHead * 0.25 : null;
    const time75 = Number.isFinite(level75) ? crossingTime(points, excavation, level75) : null;
    const time25 = Number.isFinite(level25) ? crossingTime(points, excavation, level25) : null;
    const drainTime = Number.isFinite(time75) && Number.isFinite(time25) ? time25 - time75 : null;

    const lengthTop = asNumber(session.lengthTop);
    const lengthBottom = asNumber(session.lengthBottom || session.lengthTop);
    const widthTop = asNumber(session.widthTop);
    const widthBottom = asNumber(session.widthBottom || session.widthTop);
    const voidRatio = asNumber(session.voidRatio, 1);
    const averagePlanArea = ((lengthTop * widthTop) + (lengthBottom * widthBottom)) / 2 / 1_000_000;
    const factoredVolume = Number.isFinite(initialHead) ? averagePlanArea * (initialHead / 1000) * voidRatio : null;
    const volumeDischarged = Number.isFinite(factoredVolume) ? factoredVolume * 0.5 : null;
    const averageLength = (lengthTop + lengthBottom) / 2 / 1000;
    const averageWidth = (widthTop + widthBottom) / 2 / 1000;
    const averageHead = Number.isFinite(level75) && Number.isFinite(level25) ? (level75 + level25) / 2 / 1000 : null;
    const baseArea = (lengthBottom * widthBottom) / 1_000_000;
    const dischargeArea = Number.isFinite(averageHead)
      ? (2 * averageLength + 2 * averageWidth) * averageHead + baseArea
      : null;
    const infiltrationMMin = Number.isFinite(drainTime) && drainTime > 0 && dischargeArea > 0
      ? volumeDischarged / dischargeArea / drainTime
      : null;
    const infiltrationMSec = Number.isFinite(infiltrationMMin) ? infiltrationMMin / 60 : null;
    const heads = points.map(point => excavation - point.depth).filter(Number.isFinite);
    const minimumHead = heads.length ? Math.min(...heads) : null;
    const compliant = Number.isFinite(minimumHead) && Number.isFinite(level25) && minimumHead <= level25;

    return {
      excavation,
      initialHead,
      level75,
      level25,
      time75,
      time25,
      drainTime,
      factoredVolume,
      volumeDischarged,
      dischargeArea,
      infiltrationMMin,
      infiltrationMSec,
      minimumHead,
      compliance: points.length ? (compliant ? 'Compliant with BRE 365' : 'Not compliant - test did not drain past 25% effective depth') : 'No readings recorded',
    };
  }

  function requiresManualInfiltrationRate(points, results) {
    return points.length >= 2
      && Number.isFinite(results.initialHead)
      && !(Number.isFinite(results.time75)
        && Number.isFinite(results.time25)
        && Number.isFinite(results.drainTime)
        && results.drainTime > 0);
  }

  function representativePointIndices(points, capacity, excavationDepth, levels = []) {
    if (!Array.isArray(points) || points.length <= capacity) return points.map((_, index) => index);
    const selected = new Set([0, points.length - 1]);
    const finiteLevels = levels.filter(Number.isFinite);
    finiteLevels.forEach(targetHead => {
      for (let index = 1; index < points.length; index += 1) {
        const previousHead = excavationDepth - points[index - 1].depth;
        const currentHead = excavationDepth - points[index].depth;
        if (previousHead >= targetHead && currentHead <= targetHead) {
          selected.add(index - 1);
          selected.add(index);
          break;
        }
      }
    });

    const firstTime = points[0].time;
    const lastTime = points[points.length - 1].time;
    for (let slot = 0; slot < capacity && selected.size < capacity; slot += 1) {
      const targetTime = firstTime + (lastTime - firstTime) * slot / Math.max(1, capacity - 1);
      let nearestIndex = -1;
      let nearestDistance = Infinity;
      points.forEach((point, index) => {
        if (selected.has(index)) return;
        const distance = Math.abs(point.time - targetTime);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = index;
        }
      });
      if (nearestIndex >= 0) selected.add(nearestIndex);
    }

    while (selected.size < capacity) {
      const selectedTimes = [...selected].map(index => points[index].time);
      let bestIndex = -1;
      let widestGap = -1;
      points.forEach((point, index) => {
        if (selected.has(index)) return;
        const nearestDistance = Math.min(...selectedTimes.map(time => Math.abs(point.time - time)));
        if (nearestDistance > widestGap) {
          widestGap = nearestDistance;
          bestIndex = index;
        }
      });
      if (bestIndex < 0) break;
      selected.add(bestIndex);
    }
    return [...selected].sort((left, right) => left - right).slice(0, capacity);
  }

  function fill(color) {
    return { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
  }

  function styleRange(worksheet, address, style) {
    worksheet.getCell(address.split(':')[0]);
    worksheet.eachRow({ includeEmpty: true }, () => {});
    const [start, end = start] = address.split(':');
    const startCell = worksheet.getCell(start);
    const endCell = worksheet.getCell(end);
    for (let row = startCell.row; row <= endCell.row; row += 1) {
      for (let column = startCell.col; column <= endCell.col; column += 1) {
        Object.assign(worksheet.getCell(row, column), style);
      }
    }
  }

  function applyCellStyle(cell, options = {}) {
    cell.font = options.font || { name: 'Arial', size: 9, color: { argb: BRAND.dark } };
    cell.alignment = options.alignment || { vertical: 'middle', wrapText: true };
    cell.border = options.border === false ? {} : thinBorder;
    if (options.fill) cell.fill = fill(options.fill);
    if (options.numFmt) cell.numFmt = options.numFmt;
  }

  function mergeValue(worksheet, range, value, options = {}) {
    worksheet.mergeCells(range);
    const cell = worksheet.getCell(range.split(':')[0]);
    cell.value = value;
    applyCellStyle(cell, options);
    const [start, end] = range.split(':');
    if (end) {
      const startCell = worksheet.getCell(start);
      const endCell = worksheet.getCell(end);
      for (let row = startCell.row; row <= endCell.row; row += 1) {
        for (let column = startCell.col; column <= endCell.col; column += 1) {
          worksheet.getCell(row, column).border = options.border === false ? {} : thinBorder;
          if (options.fill) worksheet.getCell(row, column).fill = fill(options.fill);
        }
      }
    }
    return cell;
  }

  function formulaValue(formula, result) {
    return { formula: String(formula || '').replace(/^=/, ''), result: result == null || Number.isNaN(result) ? null : result };
  }

  function columnLetter(column) {
    let value = column;
    let result = '';
    while (value > 0) {
      const remainder = (value - 1) % 26;
      result = String.fromCharCode(65 + remainder) + result;
      value = Math.floor((value - 1) / 26);
    }
    return result;
  }

  function drawChartCanvas(points, results) {
    const canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 360;
    const context = canvas.getContext('2d');
    context.fillStyle = '#FFFFFF';
    context.fillRect(0, 0, canvas.width, canvas.height);

    const left = 78;
    const top = 38;
    const right = 28;
    const bottom = 58;
    const width = canvas.width - left - right;
    const height = canvas.height - top - bottom;
    const heads = points.map(point => results.excavation - point.depth);
    const maxTime = Math.max(1, ...points.map(point => point.time));
    const maxHead = Math.max(1, results.initialHead || 0, ...heads);
    const x = value => left + (value / maxTime) * width;
    const y = value => top + height - (value / maxHead) * height;

    context.strokeStyle = '#D9E1E8';
    context.lineWidth = 1;
    context.font = '18px Arial';
    context.fillStyle = '#4B5563';
    for (let tick = 0; tick <= 4; tick += 1) {
      const xPos = left + (tick / 4) * width;
      const yPos = top + (tick / 4) * height;
      context.beginPath(); context.moveTo(xPos, top); context.lineTo(xPos, top + height); context.stroke();
      context.beginPath(); context.moveTo(left, yPos); context.lineTo(left + width, yPos); context.stroke();
      context.fillText((maxTime * tick / 4).toFixed(1), xPos - 12, top + height + 30);
      context.fillText((maxHead * (4 - tick) / 4).toFixed(0), 18, yPos + 6);
    }

    context.strokeStyle = '#374151';
    context.lineWidth = 2;
    context.beginPath(); context.moveTo(left, top); context.lineTo(left, top + height); context.lineTo(left + width, top + height); context.stroke();

    const threshold = (value, color) => {
      if (!Number.isFinite(value)) return;
      context.strokeStyle = color;
      context.lineWidth = 3;
      context.beginPath(); context.moveTo(left, y(value)); context.lineTo(left + width, y(value)); context.stroke();
    };
    threshold(results.level75, '#C0504D');
    threshold(results.level25, '#9BBB59');

    if (points.length) {
      context.strokeStyle = '#00A651';
      context.lineWidth = 4;
      context.beginPath();
      points.forEach((point, index) => {
        const xPos = x(point.time);
        const yPos = y(results.excavation - point.depth);
        if (index === 0) context.moveTo(xPos, yPos); else context.lineTo(xPos, yPos);
      });
      context.stroke();
    }

    context.fillStyle = '#1F2937';
    context.font = 'bold 22px Arial';
    context.fillText('Head of water against time', left, 25);
    context.font = '18px Arial';
    context.fillText('Time (minutes)', left + width / 2 - 55, canvas.height - 10);
    context.save();
    context.translate(18, top + height / 2 + 55);
    context.rotate(-Math.PI / 2);
    context.fillText('Head of water (mm)', 0, 0);
    context.restore();
    return canvas;
  }

  function drawPitDiagramCanvas() {
    const canvas = document.createElement('canvas');
    canvas.width = 820;
    canvas.height = 390;
    const context = canvas.getContext('2d');
    context.fillStyle = '#FFFFFF';
    context.fillRect(0, 0, canvas.width, canvas.height);

    const line = (points, color, width = 3, dash = []) => {
      context.save();
      context.strokeStyle = color;
      context.lineWidth = width;
      context.setLineDash(dash);
      context.beginPath();
      points.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y));
      context.stroke();
      context.restore();
    };
    const polygon = (points, fillColor, strokeColor, width = 2) => {
      context.beginPath();
      points.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y));
      context.closePath();
      context.fillStyle = fillColor;
      context.fill();
      context.strokeStyle = strokeColor;
      context.lineWidth = width;
      context.stroke();
    };
    const arrowHead = (x, y, angle, color = '#111827') => {
      const length = 13;
      context.fillStyle = color;
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x - length * Math.cos(angle - Math.PI / 6), y - length * Math.sin(angle - Math.PI / 6));
      context.lineTo(x - length * Math.cos(angle + Math.PI / 6), y - length * Math.sin(angle + Math.PI / 6));
      context.closePath();
      context.fill();
    };
    const doubleArrow = (x1, y1, x2, y2) => {
      const angle = Math.atan2(y2 - y1, x2 - x1);
      line([[x1, y1], [x2, y2]], '#111827', 2);
      arrowHead(x2, y2, angle);
      arrowHead(x1, y1, angle + Math.PI);
    };

    const topBackLeft = [240, 70];
    const topBackRight = [665, 70];
    const topFrontLeft = [105, 190];
    const topFrontRight = [545, 190];
    const bottomFrontLeft = [145, 330];
    const bottomFrontRight = [505, 330];
    const bottomBackLeft = [240, 265];
    const bottomBackRight = [625, 265];

    polygon([topFrontLeft, topFrontRight, bottomFrontRight, bottomFrontLeft], 'rgba(126,195,227,0.13)', '#F4B000');
    polygon([topFrontRight, topBackRight, bottomBackRight, bottomFrontRight], 'rgba(35,74,90,0.18)', '#F4B000');
    polygon([bottomFrontLeft, bottomFrontRight, bottomBackRight, bottomBackLeft], 'rgba(141,180,226,0.15)', '#F4B000');
    line([topFrontLeft, topBackLeft, topBackRight, topFrontRight, topFrontLeft], '#F4B000', 3);
    line([topBackLeft, bottomBackLeft], '#F4B000', 2, [9, 7]);
    line([topBackRight, bottomBackRight], '#F4B000', 3);
    line([bottomFrontLeft, bottomBackLeft, bottomBackRight, bottomFrontRight], '#B7C63D', 2, [8, 6]);

    const waterFrontLeft = [125, 250];
    const waterFrontRight = [525, 250];
    const waterBackLeft = [225, 172];
    const waterBackRight = [645, 172];
    polygon([waterFrontLeft, waterFrontRight, waterBackRight, waterBackLeft], 'rgba(126,195,227,0.22)', '#7EC3E3', 2);
    line([waterFrontLeft, bottomFrontLeft], '#7EC3E3', 2);
    line([waterFrontRight, bottomFrontRight], '#7EC3E3', 2);

    doubleArrow(240, 42, 665, 42);
    doubleArrow(72, 190, 72, 330);
    doubleArrow(145, 360, 505, 360);
    doubleArrow(540, 345, 625, 278);
    doubleArrow(555, 190, 665, 82);
    doubleArrow(690, 172, 690, 265);
    return canvas;
  }

  function xmlEscape(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function chartFormula(sheetName, range) {
    return `'${String(sheetName).replace(/'/g, "''")}'!${range}`;
  }

  function numberCache(values, formatCode = '0.00') {
    const points = values
      .map((value, index) => ({ value: Number(value), index }))
      .filter(point => Number.isFinite(point.value));
    return `<c:numCache><c:formatCode>${xmlEscape(formatCode)}</c:formatCode><c:ptCount val="${values.length}"/>${points.map(point => `<c:pt idx="${point.index}"><c:v>${point.value}</c:v></c:pt>`).join('')}</c:numCache>`;
  }

  function referencedSeries(index, name, xFormula, xValues, yFormula, yValues, color, options = {}) {
    const marker = options.markerOnly
      ? `<c:marker><c:symbol val="${options.markerSymbol || 'circle'}"/><c:size val="${options.markerSize || 4}"/><c:spPr><a:solidFill><a:srgbClr val="${options.markerFill || color}"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="${options.markerBorder || color}"/></a:solidFill></a:ln></c:spPr></c:marker>`
      : options.marker
        ? `<c:marker><c:symbol val="circle"/><c:size val="4"/><c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:ln></c:spPr></c:marker>`
        : '<c:marker><c:symbol val="none"/></c:marker>';
    const dash = options.dash ? `<a:prstDash val="${options.dash}"/>` : '<a:prstDash val="solid"/>';
    const arrowheads = options.arrows ? '<a:headEnd type="triangle" w="sm" len="sm"/><a:tailEnd type="triangle" w="sm" len="sm"/>' : '';
    const line = options.markerOnly
      ? '<a:ln><a:noFill/></a:ln>'
      : `<a:ln w="${options.width || 25400}"><a:solidFill><a:srgbClr val="${color}">${options.alpha ? `<a:alpha val="${options.alpha}"/>` : ''}</a:srgbClr></a:solidFill>${dash}${arrowheads}</a:ln>`;
    return `<c:ser><c:idx val="${index}"/><c:order val="${index}"/><c:tx><c:v>${xmlEscape(name)}</c:v></c:tx>${marker}<c:spPr>${line}</c:spPr><c:xVal><c:numRef><c:f>${xmlEscape(xFormula)}</c:f>${numberCache(xValues, '0.00')}</c:numRef></c:xVal><c:yVal><c:numRef><c:f>${xmlEscape(yFormula)}</c:f>${numberCache(yValues, '0.00')}</c:numRef></c:yVal><c:smooth val="0"/></c:ser>`;
  }

  function literalSeries(index, name, points, color, options = {}) {
    const xValues = points.map(point => point[0]);
    const yValues = points.map(point => point[1]);
    const dash = options.dash ? `<a:prstDash val="${options.dash}"/>` : '<a:prstDash val="solid"/>';
    const arrowheads = options.arrows ? '<a:headEnd type="triangle" w="sm" len="sm"/><a:tailEnd type="triangle" w="sm" len="sm"/>' : '';
    return `<c:ser><c:idx val="${index}"/><c:order val="${index}"/><c:tx><c:v>${xmlEscape(name)}</c:v></c:tx><c:marker><c:symbol val="none"/></c:marker><c:spPr><a:ln w="${options.width || 19050}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill>${dash}${arrowheads}</a:ln></c:spPr><c:xVal><c:numLit>${numberCache(xValues).replace(/^<c:numCache>|<\/c:numCache>$/g, '')}</c:numLit></c:xVal><c:yVal><c:numLit>${numberCache(yValues).replace(/^<c:numCache>|<\/c:numCache>$/g, '')}</c:numLit></c:yVal><c:smooth val="0"/></c:ser>`;
  }

  function literalLabelSeries(index, name, point, labelFormula, labelValue, position = 't', color = '1F2937') {
    const xLiteral = numberCache([point[0]]).replace(/^<c:numCache>|<\/c:numCache>$/g, '');
    const yLiteral = numberCache([point[1]]).replace(/^<c:numCache>|<\/c:numCache>$/g, '');
    const labelCache = `<c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${xmlEscape(labelValue)}</c:v></c:pt></c:strCache>`;
    const textProperties = `<c:txPr><a:bodyPr wrap="square"/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="850" b="1"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="Arial"/></a:defRPr></a:pPr><a:endParaRPr lang="en-GB" sz="850"/></a:p></c:txPr>`;
    return `<c:ser><c:idx val="${index}"/><c:order val="${index}"/><c:tx><c:v>${xmlEscape(name)}</c:v></c:tx><c:spPr><a:ln><a:noFill/></a:ln></c:spPr><c:marker><c:symbol val="none"/></c:marker><c:dLbls><c:dLbl><c:idx val="0"/><c:tx><c:strRef><c:f>${xmlEscape(labelFormula)}</c:f>${labelCache}</c:strRef></c:tx>${textProperties}<c:dLblPos val="${position}"/><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbl><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/><c:showLeaderLines val="0"/></c:dLbls><c:xVal><c:numLit>${xLiteral}</c:numLit></c:xVal><c:yVal><c:numLit>${yLiteral}</c:numLit></c:yVal><c:smooth val="0"/></c:ser>`;
  }

  function referencedLabelSeries(index, name, xFormula, xValue, yFormula, yValue, labelFormula, labelValue, position = 't', color = '1F2937') {
    const labelCache = `<c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${xmlEscape(labelValue)}</c:v></c:pt></c:strCache>`;
    const textProperties = `<c:txPr><a:bodyPr wrap="square"/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="850" b="1"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="Arial"/></a:defRPr></a:pPr><a:endParaRPr lang="en-GB" sz="850"/></a:p></c:txPr>`;
    return `<c:ser><c:idx val="${index}"/><c:order val="${index}"/><c:tx><c:v>${xmlEscape(name)}</c:v></c:tx><c:spPr><a:ln><a:noFill/></a:ln></c:spPr><c:marker><c:symbol val="none"/></c:marker><c:dLbls><c:dLbl><c:idx val="0"/><c:tx><c:strRef><c:f>${xmlEscape(labelFormula)}</c:f>${labelCache}</c:strRef></c:tx>${textProperties}<c:dLblPos val="${position}"/><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbl><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/><c:showLeaderLines val="0"/></c:dLbls><c:xVal><c:numRef><c:f>${xmlEscape(xFormula)}</c:f>${numberCache([xValue])}</c:numRef></c:xVal><c:yVal><c:numRef><c:f>${xmlEscape(yFormula)}</c:f>${numberCache([yValue])}</c:numRef></c:yVal><c:smooth val="0"/></c:ser>`;
  }

  function chartTitleXml(title) {
    return '<c:autoTitleDeleted val="1"/>';
  }

  function axisTitleXml(title) {
    return `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-GB" sz="900"><a:solidFill><a:srgbClr val="1F2937"/></a:solidFill><a:latin typeface="Arial"/></a:rPr><a:t>${xmlEscape(title)}</a:t></a:r></a:p></c:rich></c:tx><c:layout/><c:overlay val="0"/></c:title>`;
  }

  function drainageChartXml(artifact, chartNumber) {
    const { name, points, results, firstDataRow, lastDataRow, drainageBand } = artifact;
    const timeRange = artifact.chartTimeRange || `$C$${firstDataRow}:$C$${lastDataRow}`;
    const headRange = artifact.chartHeadRange || `$E$${firstDataRow}:$E$${lastDataRow}`;
    const thresholdTimeRange = artifact.thresholdTimeRange || '$S$13:$S$14';
    const threshold75Range = artifact.threshold75Range || '$T$13:$T$14';
    const threshold25Range = artifact.threshold25Range || '$U$13:$U$14';
    const bandXRange = drainageBand.xRange || `$V$${drainageBand.startRow}:$V$${drainageBand.endRow}`;
    const bandYRange = drainageBand.yRange || `$W$${drainageBand.startRow}:$W$${drainageBand.endRow}`;
    const times = points.map(point => point.time);
    const heads = points.map(point => results.excavation - point.depth);
    const minTime = times.length ? Math.min(...times) : 0;
    const maxTime = times.length ? Math.max(...times) : 1;
    const xAxisId = 70000000 + chartNumber * 10 + 1;
    const yAxisId = xAxisId + 1;
    const series = [
      referencedSeries(0, '25% to 75% effective depth band', chartFormula(name, bandXRange), drainageBand.xValues, chartFormula(name, bandYRange), drainageBand.yValues, 'FFF59D', { width: 38100, alpha: 30000 }),
      referencedSeries(1, 'Head of water', chartFormula(name, timeRange), times, chartFormula(name, headRange), heads, '00A651', { marker: true, width: 28575 }),
      referencedSeries(2, '75% effective depth', chartFormula(name, thresholdTimeRange), [minTime, maxTime], chartFormula(name, threshold75Range), [results.level75, results.level75], 'C0504D', { width: 19050 }),
      referencedSeries(3, '25% effective depth', chartFormula(name, thresholdTimeRange), [minTime, maxTime], chartFormula(name, threshold25Range), [results.level25, results.level25], '70AD47', { width: 19050 }),
    ].join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:date1904 val="0"/><c:lang val="en-GB"/><c:roundedCorners val="0"/><c:chart>${chartTitleXml('Head of water against time')}<c:plotArea><c:layout/><c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>${series}<c:dLbls><c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls><c:axId val="${xAxisId}"/><c:axId val="${yAxisId}"/></c:scatterChart><c:valAx><c:axId val="${xAxisId}"/><c:scaling><c:orientation val="minMax"/><c:min val="0"/></c:scaling><c:delete val="0"/><c:axPos val="b"/>${axisTitleXml('Time (minutes)')}<c:numFmt formatCode="0.0" sourceLinked="0"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln><a:solidFill><a:srgbClr val="234A5A"/></a:solidFill></a:ln></c:spPr><c:crossAx val="${yAxisId}"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/></c:valAx><c:valAx><c:axId val="${yAxisId}"/><c:scaling><c:orientation val="minMax"/><c:min val="0"/></c:scaling><c:delete val="0"/><c:axPos val="l"/>${axisTitleXml('Head of water (mm)')}<c:majorGridlines><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="DDEBF7"/></a:solidFill></a:ln></c:spPr></c:majorGridlines><c:numFmt formatCode="0" sourceLinked="0"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln><a:solidFill><a:srgbClr val="234A5A"/></a:solidFill></a:ln></c:spPr><c:crossAx val="${xAxisId}"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/></c:valAx></c:plotArea><c:legend><c:legendPos val="b"/><c:legendEntry><c:idx val="0"/><c:delete val="1"/></c:legendEntry><c:layout/><c:overlay val="0"/></c:legend><c:plotVisOnly val="0"/><c:dispBlanksAs val="gap"/><c:showDLblsOverMax val="0"/></c:chart><c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr><c:printSettings><c:headerFooter/><c:pageMargins b="0.75" l="0.7" r="0.7" t="0.75" header="0.3" footer="0.3"/><c:pageSetup/></c:printSettings></c:chartSpace>`;
  }

  function calculatePitGeometry(pitDimensions = {}) {
    const positive = (value, fallback) => {
      const number = Number(value);
      return Number.isFinite(number) && number > 0 ? number : fallback;
    };
    const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
    const interpolate = (from, to, ratio) => [from[0] + (to[0] - from[0]) * ratio, from[1] + (to[1] - from[1]) * ratio];
    const midpoint = (from, to) => interpolate(from, to, 0.5);
    const lengthTop = positive(pitDimensions.lengthTop, 1000);
    const lengthBottom = positive(pitDimensions.lengthBottom, lengthTop);
    const widthTop = positive(pitDimensions.widthTop, lengthTop);
    const widthBottom = positive(pitDimensions.widthBottom, widthTop);
    const excavationDepth = positive(pitDimensions.depthExcavation, lengthTop);
    const initialHead = clamp(Number(pitDimensions.initialHead) || 0, 0, excavationDepth);
    const waterFraction = initialHead / excavationDepth;
    const requestedStoneDepth = Number(pitDimensions.stoneDepth);
    const stoneDepth = clamp(Number.isFinite(requestedStoneDepth) ? requestedStoneDepth : excavationDepth, 0, excavationDepth);
    const stoneFraction = stoneDepth / excavationDepth;
    const projection = 0.42;
    const raw = {
      bottomFrontLeft: [-lengthBottom / 2, 0],
      bottomFrontRight: [lengthBottom / 2, 0],
      bottomBackLeft: [-lengthBottom / 2 + widthBottom * projection, widthBottom * projection],
      bottomBackRight: [lengthBottom / 2 + widthBottom * projection, widthBottom * projection],
      topFrontLeft: [-lengthTop / 2, excavationDepth],
      topFrontRight: [lengthTop / 2, excavationDepth],
      topBackLeft: [-lengthTop / 2 + widthTop * projection, excavationDepth + widthTop * projection],
      topBackRight: [lengthTop / 2 + widthTop * projection, excavationDepth + widthTop * projection],
    };
    const rawPoints = Object.values(raw);
    const rawMinX = Math.min(...rawPoints.map(point => point[0]));
    const rawMaxX = Math.max(...rawPoints.map(point => point[0]));
    const rawMaxY = Math.max(...rawPoints.map(point => point[1]));
    const scale = Math.min(7 / (rawMaxX - rawMinX), 4.6 / rawMaxY);
    const translateX = 4.9 - ((rawMinX + rawMaxX) * scale) / 2;
    const translateY = 0.7;
    const project = point => [point[0] * scale + translateX, point[1] * scale + translateY];
    const points = Object.fromEntries(Object.entries(raw).map(([key, point]) => [key, project(point)]));
    points.waterFrontLeft = interpolate(points.bottomFrontLeft, points.topFrontLeft, waterFraction);
    points.waterFrontRight = interpolate(points.bottomFrontRight, points.topFrontRight, waterFraction);
    points.waterBackLeft = interpolate(points.bottomBackLeft, points.topBackLeft, waterFraction);
    points.waterBackRight = interpolate(points.bottomBackRight, points.topBackRight, waterFraction);
    const pitPoints = Object.values(points).slice(0, 8);
    const pitMinX = Math.min(...pitPoints.map(point => point[0]));
    const pitMaxX = Math.max(...pitPoints.map(point => point[0]));
    const topLengthY = Math.max(points.topBackLeft[1], points.topBackRight[1]) + 0.35;
    const bottomLengthY = Math.min(points.bottomFrontLeft[1], points.bottomFrontRight[1]) - 0.35;
    const depthX = pitMinX - 0.45;
    const headX = pitMaxX + 0.48;
    points.topLengthLeft = [points.topBackLeft[0], topLengthY];
    points.topLengthRight = [points.topBackRight[0], topLengthY];
    points.depthBottom = [depthX, points.bottomFrontLeft[1]];
    points.depthTop = [depthX, points.topFrontLeft[1]];
    points.bottomLengthLeft = [points.bottomFrontLeft[0], bottomLengthY];
    points.bottomLengthRight = [points.bottomFrontRight[0], bottomLengthY];
    points.topWidthStart = [points.topFrontRight[0] + 0.16, points.topFrontRight[1] - 0.12];
    points.topWidthEnd = [points.topBackRight[0] + 0.16, points.topBackRight[1] - 0.12];
    points.bottomWidthStart = [points.bottomFrontRight[0] + 0.16, points.bottomFrontRight[1] - 0.12];
    points.bottomWidthEnd = [points.bottomBackRight[0] + 0.16, points.bottomBackRight[1] - 0.12];
    points.headBottom = [headX, points.bottomBackRight[1]];
    points.headTop = [headX, points.waterBackRight[1]];
    points.topLengthLabel = midpoint(points.topLengthLeft, points.topLengthRight);
    points.topWidthLabel = interpolate(points.topWidthStart, points.topWidthEnd, 0.62);
    points.depthLabel = midpoint(points.depthBottom, points.depthTop);
    points.headLabel = midpoint(points.headBottom, points.headTop);
    const bottomWidthLabel = interpolate(points.bottomWidthStart, points.bottomWidthEnd, 0.55);
    points.bottomWidthLabel = [bottomWidthLabel[0], bottomWidthLabel[1] + 0.18];
    points.bottomLengthLabel = midpoint(points.bottomLengthLeft, points.bottomLengthRight);
    return { lengthTop, lengthBottom, widthTop, widthBottom, excavationDepth, initialHead, waterFraction, stoneDepth, stoneFraction, projection, rawMinX, rawMaxX, rawMaxY, scale, translateX, translateY, pitMinX, pitMaxX, topLengthY, bottomLengthY, depthX, headX, points, interpolate };
  }

  function buildPitChartModel(worksheet, sheetName, pitDimensions, chartLabels, options = {}) {
    const geometry = calculatePitGeometry(pitDimensions);
    const stoneEnabled = Math.abs(Number(pitDimensions.voidRatio) - 0.3) < 0.001;
    const labelCells = options.labelCells || ['$R$13', '$R$14', '$R$15', '$R$16', '$R$17', '$R$18'];
    const stoneDepthCell = options.stoneDepthCell || '$R$27';
    const pointRows = {
      bottomFrontLeft: 90, bottomFrontRight: 91, bottomBackLeft: 92, bottomBackRight: 93,
      topFrontLeft: 94, topFrontRight: 95, topBackLeft: 96, topBackRight: 97,
      waterFrontLeft: 98, waterFrontRight: 99, waterBackLeft: 100, waterBackRight: 101,
      topLengthLeft: 102, topLengthRight: 103, depthBottom: 104, depthTop: 105,
      bottomLengthLeft: 106, bottomLengthRight: 107, topWidthStart: 108, topWidthEnd: 109,
      bottomWidthStart: 110, bottomWidthEnd: 111, headBottom: 112, headTop: 113,
      topLengthLabel: 114, topWidthLabel: 115, depthLabel: 116, headLabel: 117,
      bottomWidthLabel: 118, bottomLengthLabel: 119,
    };
    for (let column = 22; column <= 29; column += 1) worksheet.getColumn(column).hidden = true;
    const writeFormula = (address, formula, result) => {
      const cell = worksheet.getCell(address);
      cell.value = formulaValue(formula, result);
      cell.numFmt = '0.000000';
      cell.protection = { locked: true };
    };
    const scalars = [
      [61, 'Length top', '=MAX(IFERROR($B$9,0),1)', geometry.lengthTop],
      [62, 'Length bottom', '=MAX(IFERROR($D$9,0),1)', geometry.lengthBottom],
      [63, 'Width top', '=MAX(IFERROR($F$9,0),1)', geometry.widthTop],
      [64, 'Width bottom', '=MAX(IFERROR($H$9,0),1)', geometry.widthBottom],
      [65, 'Excavation depth', '=MAX(IFERROR($J$9,0),1)', geometry.excavationDepth],
      [66, 'Initial head', '=MAX(0,MIN(IFERROR($L$9,0),$AC$65))', geometry.initialHead],
      [67, 'Water fraction', '=IFERROR($AC$66/$AC$65,0)', geometry.waterFraction],
      [68, 'Projection X', '=0.42', geometry.projection],
      [69, 'Projection Y', '=0.42', geometry.projection],
      [70, 'Raw minimum X', '=MIN(-$AC$62/2,$AC$62/2,-$AC$62/2+$AC$64*$AC$68,$AC$62/2+$AC$64*$AC$68,-$AC$61/2,$AC$61/2,-$AC$61/2+$AC$63*$AC$68,$AC$61/2+$AC$63*$AC$68)', geometry.rawMinX],
      [71, 'Raw maximum X', '=MAX(-$AC$62/2,$AC$62/2,-$AC$62/2+$AC$64*$AC$68,$AC$62/2+$AC$64*$AC$68,-$AC$61/2,$AC$61/2,-$AC$61/2+$AC$63*$AC$68,$AC$61/2+$AC$63*$AC$68)', geometry.rawMaxX],
      [72, 'Raw maximum Y', '=MAX($AC$64*$AC$69,$AC$65+$AC$63*$AC$69)', geometry.rawMaxY],
      [73, 'Common scale', '=MIN(7/($AC$71-$AC$70),4.6/$AC$72)', geometry.scale],
      [74, 'Translate X', '=4.9-($AC$70+$AC$71)*$AC$73/2', geometry.translateX],
      [75, 'Translate Y', '=0.7', geometry.translateY],
      [76, 'Pit minimum X', '=MIN($Z$90:$Z$97)', geometry.pitMinX],
      [77, 'Pit maximum X', '=MAX($Z$90:$Z$97)', geometry.pitMaxX],
      [78, 'Top length dimension Y', '=MAX($AA$96,$AA$97)+0.35', geometry.topLengthY],
      [79, 'Bottom length dimension Y', '=MIN($AA$90,$AA$91)-0.35', geometry.bottomLengthY],
      [80, 'Depth dimension X', '=$AC$76-0.45', geometry.depthX],
      [81, 'Head dimension X', '=$AC$77+0.48', geometry.headX],
      [82, 'Stone fill depth', `=MAX(0,MIN(IF(${stoneDepthCell}="",$AC$65,IFERROR(${stoneDepthCell},$AC$65)),$AC$65))`, geometry.stoneDepth],
      [83, 'Stone fill fraction', '=IFERROR($AC$82/$AC$65,1)', geometry.stoneFraction],
    ];
    scalars.forEach(([row, label, formula, result]) => {
      worksheet.getCell(`AB${row}`).value = label;
      writeFormula(`AC${row}`, formula, result);
    });
    const pointDefinitions = {
      bottomFrontLeft: ['=(-$AC$62/2)*$AC$73+$AC$74', '=$AC$75'],
      bottomFrontRight: ['=($AC$62/2)*$AC$73+$AC$74', '=$AC$75'],
      bottomBackLeft: ['=(-$AC$62/2+$AC$64*$AC$68)*$AC$73+$AC$74', '=($AC$64*$AC$69)*$AC$73+$AC$75'],
      bottomBackRight: ['=($AC$62/2+$AC$64*$AC$68)*$AC$73+$AC$74', '=($AC$64*$AC$69)*$AC$73+$AC$75'],
      topFrontLeft: ['=(-$AC$61/2)*$AC$73+$AC$74', '=$AC$65*$AC$73+$AC$75'],
      topFrontRight: ['=($AC$61/2)*$AC$73+$AC$74', '=$AC$65*$AC$73+$AC$75'],
      topBackLeft: ['=(-$AC$61/2+$AC$63*$AC$68)*$AC$73+$AC$74', '=($AC$65+$AC$63*$AC$69)*$AC$73+$AC$75'],
      topBackRight: ['=($AC$61/2+$AC$63*$AC$68)*$AC$73+$AC$74', '=($AC$65+$AC$63*$AC$69)*$AC$73+$AC$75'],
      waterFrontLeft: ['=$Z$90+($Z$94-$Z$90)*$AC$67', '=$AA$90+($AA$94-$AA$90)*$AC$67'],
      waterFrontRight: ['=$Z$91+($Z$95-$Z$91)*$AC$67', '=$AA$91+($AA$95-$AA$91)*$AC$67'],
      waterBackLeft: ['=$Z$92+($Z$96-$Z$92)*$AC$67', '=$AA$92+($AA$96-$AA$92)*$AC$67'],
      waterBackRight: ['=$Z$93+($Z$97-$Z$93)*$AC$67', '=$AA$93+($AA$97-$AA$93)*$AC$67'],
      topLengthLeft: ['=$Z$96', '=$AC$78'], topLengthRight: ['=$Z$97', '=$AC$78'],
      depthBottom: ['=$AC$80', '=$AA$90'], depthTop: ['=$AC$80', '=$AA$94'],
      bottomLengthLeft: ['=$Z$90', '=$AC$79'], bottomLengthRight: ['=$Z$91', '=$AC$79'],
      topWidthStart: ['=$Z$95+0.16', '=$AA$95-0.12'], topWidthEnd: ['=$Z$97+0.16', '=$AA$97-0.12'],
      bottomWidthStart: ['=$Z$91+0.16', '=$AA$91-0.12'], bottomWidthEnd: ['=$Z$93+0.16', '=$AA$93-0.12'],
      headBottom: ['=$AC$81', '=$AA$93'], headTop: ['=$AC$81', '=$AA$101'],
      topLengthLabel: ['=AVERAGE($Z$102:$Z$103)', '=AVERAGE($AA$102:$AA$103)'],
      topWidthLabel: ['=$Z$108+($Z$109-$Z$108)*0.62', '=$AA$108+($AA$109-$AA$108)*0.62'],
      depthLabel: ['=AVERAGE($Z$104:$Z$105)', '=AVERAGE($AA$104:$AA$105)'],
      headLabel: ['=AVERAGE($Z$112:$Z$113)', '=AVERAGE($AA$112:$AA$113)'],
      bottomWidthLabel: ['=$Z$110+($Z$111-$Z$110)*0.55', '=$AA$110+($AA$111-$AA$110)*0.55+0.18'],
      bottomLengthLabel: ['=AVERAGE($Z$106:$Z$107)', '=AVERAGE($AA$106:$AA$107)'],
    };
    Object.entries(pointRows).forEach(([key, row]) => {
      worksheet.getCell(`Y${row}`).value = key;
      writeFormula(`Z${row}`, pointDefinitions[key][0], geometry.points[key][0]);
      writeFormula(`AA${row}`, pointDefinitions[key][1], geometry.points[key][1]);
    });

    const ref = key => ({ point: geometry.points[key], xFormula: `=$Z$${pointRows[key]}`, yFormula: `=$AA$${pointRows[key]}` });
    const between = (fromKey, toKey, ratio) => ({
      point: geometry.interpolate(geometry.points[fromKey], geometry.points[toKey], ratio),
      xFormula: `=$Z$${pointRows[fromKey]}+($Z$${pointRows[toKey]}-$Z$${pointRows[fromKey]})*${ratio}`,
      yFormula: `=$AA$${pointRows[fromKey]}+($AA$${pointRows[toKey]}-$AA$${pointRows[fromKey]})*${ratio}`,
    });
    const stripFormula = formula => String(formula).replace(/^=/, '');
    const mixSpecs = (from, to, ratio) => ({
      point: geometry.interpolate(from.point, to.point, ratio),
      xFormula: `=(${stripFormula(from.xFormula)})+((${stripFormula(to.xFormula)})-(${stripFormula(from.xFormula)}))*${ratio}`,
      yFormula: `=(${stripFormula(from.yFormula)})+((${stripFormula(to.yFormula)})-(${stripFormula(from.yFormula)}))*${ratio}`,
    });
    const conditionalStoneSpec = (spec, verticalRatio, wet) => {
      const waterTest = wet ? `$AC$67>=${verticalRatio}` : `$AC$67<${verticalRatio}`;
      const visible = stoneEnabled && geometry.stoneFraction >= verticalRatio && (wet ? geometry.waterFraction >= verticalRatio : geometry.waterFraction < verticalRatio);
      return {
        point: visible ? spec.point : [NaN, NaN],
        xFormula: `=IF(AND(ABS($B$10-0.3)<0.001,$AC$83>=${verticalRatio},${waterTest}),${stripFormula(spec.xFormula)},NA())`,
        yFormula: `=IF(AND(ABS($B$10-0.3)<0.001,$AC$83>=${verticalRatio},${waterTest}),${stripFormula(spec.yFormula)},NA())`,
      };
    };
    const series = [];
    let seriesRow = 130;
    const addSeries = (definition, pointSpecs) => {
      const startRow = seriesRow;
      pointSpecs.forEach(spec => {
        worksheet.getCell(`V${seriesRow}`).value = definition.name;
        writeFormula(`W${seriesRow}`, spec.xFormula, spec.point[0]);
        writeFormula(`X${seriesRow}`, spec.yFormula, spec.point[1]);
        seriesRow += 1;
      });
      series.push({ ...definition, startRow, endRow: seriesRow - 1, xValues: pointSpecs.map(spec => spec.point[0]), yValues: pointSpecs.map(spec => spec.point[1]) });
      seriesRow += 1;
    };
    const orange = 'F4B000';
    const dark = '1F2937';
    const blue = '7EC3E3';
    const waterSurface = '1268E8';
    const blendHex = (from, to, ratio) => [0, 2, 4].map(offset => {
      const start = parseInt(from.slice(offset, offset + 2), 16);
      const end = parseInt(to.slice(offset, offset + 2), 16);
      return Math.round(start + (end - start) * ratio).toString(16).padStart(2, '0');
    }).join('').toUpperCase();
    for (let band = 0; band < 32; band += 1) {
      const ratio = (band + 0.5) / 32;
      addSeries({
        type: 'line',
        name: `Water volume front ${band + 1}`,
        color: blendHex('159FC4', '8ADCEB', ratio),
        options: { width: 28575, alpha: Math.round(52000 - ratio * 25000) },
      }, [between('bottomFrontLeft', 'waterFrontLeft', ratio), between('bottomFrontRight', 'waterFrontRight', ratio)]);
    }
    for (let band = 0; band < 32; band += 1) {
      const ratio = (band + 0.5) / 32;
      addSeries({
        type: 'line',
        name: `Water volume side ${band + 1}`,
        color: blendHex('126E8D', '64B6CA', ratio),
        options: { width: 28575, alpha: Math.round(60000 - ratio * 28000) },
      }, [between('bottomFrontRight', 'waterFrontRight', ratio), between('bottomBackRight', 'waterBackRight', ratio)]);
    }
    for (let band = 0; band < 16; band += 1) {
      const ratio = (band + 0.5) / 16;
      addSeries({
        type: 'line',
        name: `Water volume surface ${band + 1}`,
        color: blendHex('A9E6F1', '6BC9DE', ratio),
        options: { width: 28575, alpha: Math.round(26000 + ratio * 12000) },
      }, [between('waterFrontLeft', 'waterBackLeft', ratio), between('waterFrontRight', 'waterBackRight', ratio)]);
    }
    const dryStonePoints = [[], [], []];
    const wetStonePoints = [[], [], []];
    const clampRatio = value => Math.max(0.015, Math.min(0.985, value));
    const gravelNoise = (row, column, seed) => {
      const raw = Math.sin((row + 1) * 12.9898 + (column + 1) * 78.233 + seed * 37.719) * 43758.5453;
      return raw - Math.floor(raw);
    };
    const stoneLevels = 41;
    const frontStonePositions = 41;
    const sideStonePositions = 15;
    const verticalStep = 0.97 / (stoneLevels - 1);
    for (let levelIndex = 0; levelIndex < stoneLevels; levelIndex += 1) {
      const baseVerticalRatio = 0.015 + levelIndex * verticalStep;
      const frontStep = 0.94 / (frontStonePositions - 1);
      for (let positionIndex = 0; positionIndex < frontStonePositions; positionIndex += 1) {
        const verticalRatio = clampRatio(baseVerticalRatio + (gravelNoise(levelIndex, positionIndex, 1) - 0.5) * verticalStep * 0.82);
        const frontLeft = between('bottomFrontLeft', 'topFrontLeft', verticalRatio);
        const frontRight = between('bottomFrontRight', 'topFrontRight', verticalRatio);
        const basePosition = 0.03 + positionIndex * frontStep;
        const rowOffset = (levelIndex % 2 ? 0.16 : -0.16) * frontStep;
        const randomOffset = (gravelNoise(levelIndex, positionIndex, 2) - 0.5) * frontStep * 0.72;
        const position = positionIndex === 0 ? 0.03 : positionIndex === frontStonePositions - 1 ? 0.97 : Math.max(0.03, Math.min(0.97, basePosition + rowOffset + randomOffset));
        const point = mixSpecs(frontLeft, frontRight, position);
        const shade = Math.min(2, Math.floor(gravelNoise(levelIndex, positionIndex, 3) * 3));
        dryStonePoints[shade].push(conditionalStoneSpec(point, verticalRatio, false));
        wetStonePoints[shade].push(conditionalStoneSpec(point, verticalRatio, true));
      }
      const sideStep = 0.9 / (sideStonePositions - 1);
      for (let positionIndex = 0; positionIndex < sideStonePositions; positionIndex += 1) {
        const verticalRatio = clampRatio(baseVerticalRatio + (gravelNoise(levelIndex, positionIndex, 4) - 0.5) * verticalStep * 0.82);
        const sideFront = between('bottomFrontRight', 'topFrontRight', verticalRatio);
        const sideBack = between('bottomBackRight', 'topBackRight', verticalRatio);
        const basePosition = 0.05 + positionIndex * sideStep;
        const rowOffset = (levelIndex % 2 ? 0.13 : -0.13) * sideStep;
        const randomOffset = (gravelNoise(levelIndex, positionIndex, 5) - 0.5) * sideStep * 0.62;
        const position = positionIndex === 0 ? 0.05 : positionIndex === sideStonePositions - 1 ? 0.95 : Math.max(0.05, Math.min(0.95, basePosition + rowOffset + randomOffset));
        const point = mixSpecs(sideFront, sideBack, position);
        const shade = Math.min(2, Math.floor(gravelNoise(levelIndex, positionIndex, 6) * 3));
        dryStonePoints[shade].push(conditionalStoneSpec(point, verticalRatio, false));
        wetStonePoints[shade].push(conditionalStoneSpec(point, verticalRatio, true));
      }
    }
    const stoneSurfaceEdge = (bottomKey, topKey) => ({
      point: geometry.interpolate(geometry.points[bottomKey], geometry.points[topKey], geometry.stoneFraction),
      xFormula: `=$Z$${pointRows[bottomKey]}+($Z$${pointRows[topKey]}-$Z$${pointRows[bottomKey]})*$AC$83`,
      yFormula: `=$AA$${pointRows[bottomKey]}+($AA$${pointRows[topKey]}-$AA$${pointRows[bottomKey]})*$AC$83`,
    });
    const surfaceFrontLeft = stoneSurfaceEdge('bottomFrontLeft', 'topFrontLeft');
    const surfaceFrontRight = stoneSurfaceEdge('bottomFrontRight', 'topFrontRight');
    const surfaceBackLeft = stoneSurfaceEdge('bottomBackLeft', 'topBackLeft');
    const surfaceBackRight = stoneSurfaceEdge('bottomBackRight', 'topBackRight');
    const conditionalStoneSurfaceSpec = (spec, wet) => {
      const waterTest = wet ? '$AC$67>=$AC$83' : '$AC$67<$AC$83';
      const visible = stoneEnabled && geometry.stoneFraction > 0 && (wet ? geometry.waterFraction >= geometry.stoneFraction : geometry.waterFraction < geometry.stoneFraction);
      return {
        point: visible ? spec.point : [NaN, NaN],
        xFormula: `=IF(AND(ABS($B$10-0.3)<0.001,$AC$83>0,${waterTest}),${stripFormula(spec.xFormula)},NA())`,
        yFormula: `=IF(AND(ABS($B$10-0.3)<0.001,$AC$83>0,${waterTest}),${stripFormula(spec.yFormula)},NA())`,
      };
    };
    const stoneSurfaceBands = 17;
    const stoneSurfacePositions = 41;
    const surfaceDepthStep = 0.9 / (stoneSurfaceBands - 1);
    for (let depthIndex = 0; depthIndex < stoneSurfaceBands; depthIndex += 1) {
      const baseDepthRatio = 0.05 + depthIndex * surfaceDepthStep;
      const surfaceStep = 0.94 / (stoneSurfacePositions - 1);
      for (let positionIndex = 0; positionIndex < stoneSurfacePositions; positionIndex += 1) {
        const depthRatio = Math.max(0.05, Math.min(0.95, baseDepthRatio + (gravelNoise(depthIndex, positionIndex, 7) - 0.5) * surfaceDepthStep * 0.72));
        const left = mixSpecs(surfaceFrontLeft, surfaceBackLeft, depthRatio);
        const right = mixSpecs(surfaceFrontRight, surfaceBackRight, depthRatio);
        const basePosition = 0.03 + positionIndex * surfaceStep;
        const bandOffset = (depthIndex % 2 ? 0.16 : -0.16) * surfaceStep;
        const randomOffset = (gravelNoise(depthIndex, positionIndex, 8) - 0.5) * surfaceStep * 0.72;
        const position = positionIndex === 0 ? 0.03 : positionIndex === stoneSurfacePositions - 1 ? 0.97 : Math.max(0.03, Math.min(0.97, basePosition + bandOffset + randomOffset));
        const point = mixSpecs(left, right, position);
        const shade = Math.min(2, Math.floor(gravelNoise(depthIndex, positionIndex, 9) * 3));
        dryStonePoints[shade].push(conditionalStoneSurfaceSpec(point, false));
        wetStonePoints[shade].push(conditionalStoneSurfaceSpec(point, true));
      }
    }
    const dryStoneStyles = [
      { fill: 'D6D6D6', border: '9C9C9C' },
      { fill: 'BEBEBE', border: '858585' },
      { fill: 'E4E4E4', border: 'AAAAAA' },
    ];
    const wetStoneStyles = [
      { fill: 'AFC5CE', border: '7899A6' },
      { fill: '91AFBC', border: '628796' },
      { fill: 'C4D3D9', border: '86A4AF' },
    ];
    dryStoneStyles.forEach((style, shade) => addSeries({ type: 'line', name: `Single-size stone dry ${shade + 1}`, color: style.border, options: { markerOnly: true, markerSymbol: 'circle', markerSize: 3, markerFill: style.fill, markerBorder: style.border } }, dryStonePoints[shade]));
    wetStoneStyles.forEach((style, shade) => addSeries({ type: 'line', name: `Single-size stone wet ${shade + 1}`, color: style.border, options: { markerOnly: true, markerSymbol: 'circle', markerSize: 3, markerFill: style.fill, markerBorder: style.border } }, wetStonePoints[shade]));
    addSeries({ type: 'line', name: 'Water surface front', color: waterSurface, options: { width: 38100 } }, [ref('waterFrontLeft'), ref('waterFrontRight')]);
    addSeries({ type: 'line', name: 'Water surface back', color: waterSurface, options: { width: 38100 } }, [ref('waterBackLeft'), ref('waterBackRight')]);
    addSeries({ type: 'line', name: 'Water surface left', color: waterSurface, options: { width: 38100 } }, [ref('waterFrontLeft'), ref('waterBackLeft')]);
    addSeries({ type: 'line', name: 'Water surface right', color: waterSurface, options: { width: 38100 } }, [ref('waterFrontRight'), ref('waterBackRight')]);
    addSeries({ type: 'line', name: 'Top length dimension', color: dark, options: { arrows: true, width: 12700 } }, [ref('topLengthLeft'), ref('topLengthRight')]);
    addSeries({ type: 'line', name: 'Depth dimension', color: dark, options: { arrows: true, width: 12700 } }, [ref('depthBottom'), ref('depthTop')]);
    addSeries({ type: 'line', name: 'Bottom length dimension', color: dark, options: { arrows: true, width: 12700 } }, [ref('bottomLengthLeft'), ref('bottomLengthRight')]);
    addSeries({ type: 'line', name: 'Top width dimension', color: dark, options: { arrows: true, width: 12700 } }, [ref('topWidthStart'), ref('topWidthEnd')]);
    addSeries({ type: 'line', name: 'Bottom width dimension', color: dark, options: { arrows: true, width: 12700 } }, [ref('bottomWidthStart'), ref('bottomWidthEnd')]);
    addSeries({ type: 'line', name: 'Water head top marker', color: blue, options: { dash: 'dash', width: 9525 } }, [ref('waterBackRight'), ref('headTop')]);
    addSeries({ type: 'line', name: 'Water head bottom marker', color: blue, options: { dash: 'dash', width: 9525 } }, [ref('bottomBackRight'), ref('headBottom')]);
    addSeries({ type: 'line', name: 'Water head dimension', color: blue, options: { arrows: true, width: 12700 } }, [ref('headBottom'), ref('headTop')]);
    const labels = [
      ['Top length label', 'topLengthLabel', labelCells[0], chartLabels.topLength, 't', dark],
      ['Top width label', 'topWidthLabel', labelCells[1], chartLabels.topWidth, 'r', dark],
      ['Excavation depth label', 'depthLabel', labelCells[2], chartLabels.excavationDepth, 'l', dark],
      ['Head of water label', 'headLabel', labelCells[3], chartLabels.headOfWater, 'r', blue],
      ['Bottom width label', 'bottomWidthLabel', labelCells[4], chartLabels.bottomWidth, 't', dark],
      ['Bottom length label', 'bottomLengthLabel', labelCells[5], chartLabels.bottomLength, 'b', dark],
    ];
    labels.forEach(([labelName, pointKey, labelCell, labelValue, position, color]) => addSeries({ type: 'label', name: labelName, color, options: {}, labelFormula: chartFormula(sheetName, labelCell), labelValue, position }, [ref(pointKey)]));
    addSeries({ type: 'line', name: 'Top outline foreground', color: orange, options: { width: 38100 } }, [ref('topFrontLeft'), ref('topBackLeft'), ref('topBackRight'), ref('topFrontRight'), ref('topFrontLeft')]);
    addSeries({ type: 'line', name: 'Bottom outline foreground', color: orange, options: { width: 31750 } }, [ref('bottomFrontLeft'), ref('bottomBackLeft'), ref('bottomBackRight'), ref('bottomFrontRight'), ref('bottomFrontLeft')]);
    addSeries({ type: 'line', name: 'Front left side foreground', color: orange, options: { width: 31750 } }, [ref('topFrontLeft'), ref('bottomFrontLeft')]);
    addSeries({ type: 'line', name: 'Front right side foreground', color: orange, options: { width: 31750 } }, [ref('topFrontRight'), ref('bottomFrontRight')]);
    addSeries({ type: 'line', name: 'Back left side foreground', color: orange, options: { dash: 'dash', width: 31750 } }, [ref('topBackLeft'), ref('bottomBackLeft')]);
    addSeries({ type: 'line', name: 'Back right side foreground', color: orange, options: { width: 31750 } }, [ref('topBackRight'), ref('bottomBackRight')]);

    // Excel can paint scatter markers above line-only series regardless of the
    // series order. Repeat only the front/right silhouette as a densely sampled
    // orange marker layer. Rear and left depth edges deliberately remain behind
    // the gravel markers to preserve the pit's three-dimensional appearance.
    const foregroundEdge = (fromKey, toKey, steps = 96) => Array.from(
      { length: steps + 1 },
      (_, index) => between(fromKey, toKey, index / steps),
    );
    const foregroundCover = { markerOnly: true, markerSymbol: 'circle', markerSize: 4, markerFill: orange, markerBorder: orange };
    [
      ['Top right edge cover', 'topBackRight', 'topFrontRight'],
      ['Top front edge cover', 'topFrontRight', 'topFrontLeft'],
      ['Bottom right edge cover', 'bottomBackRight', 'bottomFrontRight'],
      ['Bottom front edge cover', 'bottomFrontRight', 'bottomFrontLeft'],
      ['Front left wall edge cover', 'topFrontLeft', 'bottomFrontLeft'],
      ['Front right wall edge cover', 'topFrontRight', 'bottomFrontRight'],
      ['Back right wall edge cover', 'topBackRight', 'bottomBackRight'],
    ].forEach(([name, fromKey, toKey]) => addSeries(
      { type: 'line', name, color: orange, options: foregroundCover },
      foregroundEdge(fromKey, toKey),
    ));
    return series;
  }

  function dynamicPitChartXml(artifact, chartNumber) {
    const { name, pitChartSeries } = artifact;
    const xAxisId = 80000000 + chartNumber * 10 + 1;
    const yAxisId = xAxisId + 1;
    const series = pitChartSeries.map((definition, index) => {
      const xFormula = chartFormula(name, `$W$${definition.startRow}:$W$${definition.endRow}`);
      const yFormula = chartFormula(name, `$X$${definition.startRow}:$X$${definition.endRow}`);
      if (definition.type === 'label') return referencedLabelSeries(index, definition.name, xFormula, definition.xValues[0], yFormula, definition.yValues[0], definition.labelFormula, definition.labelValue, definition.position, definition.color);
      return referencedSeries(index, definition.name, xFormula, definition.xValues, yFormula, definition.yValues, definition.color, definition.options);
    }).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:date1904 val="0"/><c:lang val="en-GB"/><c:roundedCorners val="0"/><c:chart><c:autoTitleDeleted val="1"/><c:plotArea><c:layout/><c:scatterChart><c:scatterStyle val="line"/><c:varyColors val="0"/>${series}<c:axId val="${xAxisId}"/><c:axId val="${yAxisId}"/></c:scatterChart><c:valAx><c:axId val="${xAxisId}"/><c:scaling><c:orientation val="minMax"/><c:max val="11.5"/><c:min val="0"/></c:scaling><c:delete val="1"/><c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="none"/><c:crossAx val="${yAxisId}"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/></c:valAx><c:valAx><c:axId val="${yAxisId}"/><c:scaling><c:orientation val="minMax"/><c:max val="6.2"/><c:min val="0"/></c:scaling><c:delete val="1"/><c:axPos val="l"/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="none"/><c:crossAx val="${xAxisId}"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/></c:valAx></c:plotArea><c:plotVisOnly val="0"/><c:dispBlanksAs val="gap"/><c:showDLblsOverMax val="0"/></c:chart><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr><c:printSettings><c:headerFooter/><c:pageMargins b="0.75" l="0.7" r="0.7" t="0.75" header="0.3" footer="0.3"/><c:pageSetup/></c:printSettings></c:chartSpace>`;
  }

  function pitChartXml(artifact, chartNumber) {
    if (Array.isArray(artifact.pitChartSeries) && artifact.pitChartSeries.length) return dynamicPitChartXml(artifact, chartNumber);
    const { name, chartLabels, pitDimensions = {} } = artifact;
    const xAxisId = 80000000 + chartNumber * 10 + 1;
    const yAxisId = xAxisId + 1;
    const orange = 'F4B000';
    const dark = '1F2937';
    const blue = '7EC3E3';
    const waterSurface = '1268E8';
    const seriesParts = [];
    let seriesIndex = 0;

    const positive = (value, fallback) => {
      const number = Number(value);
      return Number.isFinite(number) && number > 0 ? number : fallback;
    };
    const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
    const interpolatePoint = (from, to, ratio) => [
      from[0] + (to[0] - from[0]) * ratio,
      from[1] + (to[1] - from[1]) * ratio,
    ];
    const midpoint = (from, to) => interpolatePoint(from, to, 0.5);

    const lengthTop = positive(pitDimensions.lengthTop, 1000);
    const lengthBottom = positive(pitDimensions.lengthBottom, lengthTop);
    const widthTop = positive(pitDimensions.widthTop, lengthTop);
    const widthBottom = positive(pitDimensions.widthBottom, widthTop);
    const excavationDepth = positive(pitDimensions.depthExcavation, lengthTop);
    const initialHead = clamp(Number(pitDimensions.initialHead) || 0, 0, excavationDepth);
    const waterFraction = initialHead / excavationDepth;

    // Use one common scale for length, width and depth. Uniformly scaling every
    // input therefore produces the same drawing, while their ratios remain visible.
    const widthProjectionX = 0.42;
    const widthProjectionY = 0.42;
    const raw = {
      bottomFrontLeft: [-lengthBottom / 2, 0],
      bottomFrontRight: [lengthBottom / 2, 0],
      bottomBackLeft: [-lengthBottom / 2 + widthBottom * widthProjectionX, widthBottom * widthProjectionY],
      bottomBackRight: [lengthBottom / 2 + widthBottom * widthProjectionX, widthBottom * widthProjectionY],
      topFrontLeft: [-lengthTop / 2, excavationDepth],
      topFrontRight: [lengthTop / 2, excavationDepth],
      topBackLeft: [-lengthTop / 2 + widthTop * widthProjectionX, excavationDepth + widthTop * widthProjectionY],
      topBackRight: [lengthTop / 2 + widthTop * widthProjectionX, excavationDepth + widthTop * widthProjectionY],
    };
    const rawPoints = Object.values(raw);
    const rawMinX = Math.min(...rawPoints.map(point => point[0]));
    const rawMaxX = Math.max(...rawPoints.map(point => point[0]));
    const rawMinY = Math.min(...rawPoints.map(point => point[1]));
    const rawMaxY = Math.max(...rawPoints.map(point => point[1]));
    const scale = Math.min(7 / (rawMaxX - rawMinX), 4.6 / (rawMaxY - rawMinY));
    const translateX = 4.9 - ((rawMinX + rawMaxX) * scale) / 2;
    const translateY = 0.7 - rawMinY * scale;
    const project = point => [point[0] * scale + translateX, point[1] * scale + translateY];

    const bottomFrontLeft = project(raw.bottomFrontLeft);
    const bottomFrontRight = project(raw.bottomFrontRight);
    const bottomBackLeft = project(raw.bottomBackLeft);
    const bottomBackRight = project(raw.bottomBackRight);
    const topFrontLeft = project(raw.topFrontLeft);
    const topFrontRight = project(raw.topFrontRight);
    const topBackLeft = project(raw.topBackLeft);
    const topBackRight = project(raw.topBackRight);
    const waterFrontLeft = interpolatePoint(bottomFrontLeft, topFrontLeft, waterFraction);
    const waterFrontRight = interpolatePoint(bottomFrontRight, topFrontRight, waterFraction);
    const waterBackLeft = interpolatePoint(bottomBackLeft, topBackLeft, waterFraction);
    const waterBackRight = interpolatePoint(bottomBackRight, topBackRight, waterFraction);

    const allPitPoints = [bottomFrontLeft, bottomFrontRight, bottomBackLeft, bottomBackRight, topFrontLeft, topFrontRight, topBackLeft, topBackRight];
    const pitMinX = Math.min(...allPitPoints.map(point => point[0]));
    const pitMaxX = Math.max(...allPitPoints.map(point => point[0]));
    const topLengthY = Math.max(topBackLeft[1], topBackRight[1]) + 0.35;
    const bottomLengthY = Math.min(bottomFrontLeft[1], bottomFrontRight[1]) - 0.35;
    const depthDimensionX = pitMinX - 0.45;
    const headDimensionX = pitMaxX + 0.48;
    const topWidthDimensionStart = [topFrontRight[0] + 0.16, topFrontRight[1] - 0.12];
    const topWidthDimensionEnd = [topBackRight[0] + 0.16, topBackRight[1] - 0.12];
    const bottomWidthDimensionStart = [bottomFrontRight[0] + 0.16, bottomFrontRight[1] - 0.12];
    const bottomWidthDimensionEnd = [bottomBackRight[0] + 0.16, bottomBackRight[1] - 0.12];

    // Excel scatter charts do not support polygon fills. Closely spaced native line
    // series create editable filled faces while retaining the dimensional outlines.
    if (waterFraction > 0) {
      const frontWaterHeight = Math.abs(waterFrontLeft[1] - bottomFrontLeft[1]);
      const surfaceProjectionHeight = Math.abs(waterBackLeft[1] - waterFrontLeft[1]);
      const frontFillWidth = clamp(Math.round(76200 * frontWaterHeight / 2), 12700, 76200);
      const surfaceFillWidth = clamp(Math.round(76200 * surfaceProjectionHeight), 12700, 76200);
      const frontBands = 16;
      for (let band = 0; band < frontBands; band += 1) {
        const ratio = (band + 0.5) / frontBands;
        const left = interpolatePoint(bottomFrontLeft, waterFrontLeft, ratio);
        const right = interpolatePoint(bottomFrontRight, waterFrontRight, ratio);
        seriesParts.push(literalSeries(seriesIndex++, `Water volume front ${band + 1}`, [left, right], '42C5E8', { width: frontFillWidth }));
      }
      const rightBands = 16;
      for (let band = 0; band < rightBands; band += 1) {
        const ratio = (band + 0.5) / rightBands;
        const front = interpolatePoint(bottomFrontRight, waterFrontRight, ratio);
        const back = interpolatePoint(bottomBackRight, waterBackRight, ratio);
        seriesParts.push(literalSeries(seriesIndex++, `Water volume side ${band + 1}`, [front, back], '2DB3D8', { width: frontFillWidth }));
      }
      const topBands = 8;
      for (let band = 0; band < topBands; band += 1) {
        const ratio = (band + 0.5) / topBands;
        const left = interpolatePoint(waterFrontLeft, waterBackLeft, ratio);
        const right = interpolatePoint(waterFrontRight, waterBackRight, ratio);
        seriesParts.push(literalSeries(seriesIndex++, `Water volume surface ${band + 1}`, [left, right], '76D8EF', { width: surfaceFillWidth }));
      }
    }

    seriesParts.push(
      literalSeries(seriesIndex++, 'Top outline', [topFrontLeft, topBackLeft, topBackRight, topFrontRight, topFrontLeft], orange, { width: 25400 }),
      literalSeries(seriesIndex++, 'Bottom outline', [bottomFrontLeft, bottomBackLeft, bottomBackRight, bottomFrontRight, bottomFrontLeft], orange, { width: 19050 }),
      literalSeries(seriesIndex++, 'Front left side', [topFrontLeft, bottomFrontLeft], orange),
      literalSeries(seriesIndex++, 'Front right side', [topFrontRight, bottomFrontRight], orange),
      literalSeries(seriesIndex++, 'Back left side', [topBackLeft, bottomBackLeft], orange, { dash: 'dash' }),
      literalSeries(seriesIndex++, 'Back right side', [topBackRight, bottomBackRight], orange),
    );
    if (waterFraction > 0) {
      seriesParts.push(
        literalSeries(seriesIndex++, 'Water surface front', [waterFrontLeft, waterFrontRight], waterSurface, { width: 38100 }),
        literalSeries(seriesIndex++, 'Water surface back', [waterBackLeft, waterBackRight], waterSurface, { width: 38100 }),
        literalSeries(seriesIndex++, 'Water surface left', [waterFrontLeft, waterBackLeft], waterSurface, { width: 38100 }),
        literalSeries(seriesIndex++, 'Water surface right', [waterFrontRight, waterBackRight], waterSurface, { width: 38100 }),
      );
    }
    seriesParts.push(
      literalSeries(seriesIndex++, 'Top length dimension', [[topBackLeft[0], topLengthY], [topBackRight[0], topLengthY]], dark, { arrows: true, width: 12700 }),
      literalSeries(seriesIndex++, 'Depth dimension', [[depthDimensionX, bottomFrontLeft[1]], [depthDimensionX, topFrontLeft[1]]], dark, { arrows: true, width: 12700 }),
      literalSeries(seriesIndex++, 'Bottom length dimension', [[bottomFrontLeft[0], bottomLengthY], [bottomFrontRight[0], bottomLengthY]], dark, { arrows: true, width: 12700 }),
      literalSeries(seriesIndex++, 'Top width dimension', [topWidthDimensionStart, topWidthDimensionEnd], dark, { arrows: true, width: 12700 }),
      literalSeries(seriesIndex++, 'Bottom width dimension', [bottomWidthDimensionStart, bottomWidthDimensionEnd], dark, { arrows: true, width: 12700 }),
    );
    if (waterFraction > 0) {
      seriesParts.push(
        literalSeries(seriesIndex++, 'Water head top marker', [waterBackRight, [headDimensionX, waterBackRight[1]]], blue, { dash: 'dash', width: 9525 }),
        literalSeries(seriesIndex++, 'Water head bottom marker', [bottomBackRight, [headDimensionX, bottomBackRight[1]]], blue, { dash: 'dash', width: 9525 }),
        literalSeries(seriesIndex++, 'Water head dimension', [[headDimensionX, bottomBackRight[1]], [headDimensionX, waterBackRight[1]]], blue, { arrows: true, width: 12700 }),
      );
    }
    seriesParts.push(
      literalLabelSeries(seriesIndex++, 'Top length label', midpoint([topBackLeft[0], topLengthY], [topBackRight[0], topLengthY]), chartFormula(name, '$R$13'), chartLabels.topLength, 't', dark),
      literalLabelSeries(seriesIndex++, 'Top width label', interpolatePoint(topWidthDimensionStart, topWidthDimensionEnd, 0.62), chartFormula(name, '$R$14'), chartLabels.topWidth, 'r', dark),
      literalLabelSeries(seriesIndex++, 'Excavation depth label', [depthDimensionX, (bottomFrontLeft[1] + topFrontLeft[1]) / 2], chartFormula(name, '$R$15'), chartLabels.excavationDepth, 'l', dark),
    );
    if (waterFraction > 0) {
      seriesParts.push(literalLabelSeries(seriesIndex++, 'Head of water label', [headDimensionX, (bottomBackRight[1] + waterBackRight[1]) / 2], chartFormula(name, '$R$16'), chartLabels.headOfWater, 'r', blue));
    }
    seriesParts.push(
      literalLabelSeries(seriesIndex++, 'Bottom width label', (() => {
        const point = interpolatePoint(bottomWidthDimensionStart, bottomWidthDimensionEnd, 0.55);
        return [point[0], point[1] + 0.18];
      })(), chartFormula(name, '$R$17'), chartLabels.bottomWidth, 't', dark),
      literalLabelSeries(seriesIndex++, 'Bottom length label', midpoint([bottomFrontLeft[0], bottomLengthY], [bottomFrontRight[0], bottomLengthY]), chartFormula(name, '$R$18'), chartLabels.bottomLength, 'b', dark),
    );
    const series = seriesParts.join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:date1904 val="0"/><c:lang val="en-GB"/><c:roundedCorners val="0"/><c:chart><c:autoTitleDeleted val="1"/><c:plotArea><c:layout/><c:scatterChart><c:scatterStyle val="line"/><c:varyColors val="0"/>${series}<c:axId val="${xAxisId}"/><c:axId val="${yAxisId}"/></c:scatterChart><c:valAx><c:axId val="${xAxisId}"/><c:scaling><c:orientation val="minMax"/><c:max val="11.5"/><c:min val="0"/></c:scaling><c:delete val="1"/><c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="none"/><c:crossAx val="${yAxisId}"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/></c:valAx><c:valAx><c:axId val="${yAxisId}"/><c:scaling><c:orientation val="minMax"/><c:max val="6.2"/><c:min val="0"/></c:scaling><c:delete val="1"/><c:axPos val="l"/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="none"/><c:crossAx val="${xAxisId}"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/></c:valAx></c:plotArea><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/><c:showDLblsOverMax val="0"/></c:chart><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr><c:printSettings><c:headerFooter/><c:pageMargins b="0.75" l="0.7" r="0.7" t="0.75" header="0.3" footer="0.3"/><c:pageSetup/></c:printSettings></c:chartSpace>`;
  }

  function nativeChartAnchor(id, name, relationshipId, fromColumn, fromRow, toColumn, toRow) {
    return `<xdr:twoCellAnchor editAs="twoCell"><xdr:from><xdr:col>${fromColumn}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${fromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${toColumn}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${id}" name="${xmlEscape(name)}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/><a:ext cx="0" cy="0" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/></xdr:xfrm><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="${relationshipId}" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`;
  }

  async function addNativeChartsToBuffer(buffer, artifacts) {
    if (!window.JSZip) throw new Error('Excel chart packaging library did not load. Reload the app and try again.');
    const zip = await window.JSZip.loadAsync(buffer);
    let contentTypes = await zip.file('[Content_Types].xml').async('string');
    let nextChartNumber = 1;
    let nextDrawingId = 100;
    for (let index = 0; index < artifacts.length; index += 1) {
      const sheetNumber = index + 1;
      const drawingPath = `xl/drawings/drawing${sheetNumber}.xml`;
      const relationshipsPath = `xl/drawings/_rels/drawing${sheetNumber}.xml.rels`;
      const drawingFile = zip.file(drawingPath);
      const relationshipsFile = zip.file(relationshipsPath);
      if (!drawingFile || !relationshipsFile) throw new Error(`Could not attach native charts to worksheet ${sheetNumber}.`);
      let drawingXml = await drawingFile.async('string');
      let relationshipsXml = await relationshipsFile.async('string');
      const chartDefinitions = artifacts[index].nativeCharts || [
        { kind: 'pit', name: 'Test pit construction', artifact: artifacts[index], fromColumn: 6, fromRow: 12, toColumn: 12, toRow: 22 },
        { kind: 'drainage', name: 'Head of water against time', artifact: artifacts[index], fromColumn: 6, fromRow: 25, toColumn: 12, toRow: 40 },
      ];
      let anchors = '';
      let chartRelationships = '';
      let chartOverrides = '';
      chartDefinitions.forEach((definition, chartIndex) => {
        const chartNumber = nextChartNumber++;
        const relationshipId = `rIdNativeChart${sheetNumber}x${chartIndex + 1}`;
        anchors += nativeChartAnchor(
          nextDrawingId++,
          definition.name,
          relationshipId,
          definition.fromColumn,
          definition.fromRow,
          definition.toColumn,
          definition.toRow,
        );
        chartRelationships += `<Relationship Id="${relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${chartNumber}.xml"/>`;
        const chartArtifact = definition.artifact || artifacts[index];
        zip.file(
          `xl/charts/chart${chartNumber}.xml`,
          definition.kind === 'pit' ? pitChartXml(chartArtifact, chartNumber) : drainageChartXml(chartArtifact, chartNumber),
        );
        chartOverrides += `<Override PartName="/xl/charts/chart${chartNumber}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`;
      });
      drawingXml = drawingXml.replace('</xdr:wsDr>', `${anchors}</xdr:wsDr>`);
      relationshipsXml = relationshipsXml.replace('</Relationships>', `${chartRelationships}</Relationships>`);
      zip.file(drawingPath, drawingXml);
      zip.file(relationshipsPath, relationshipsXml);
      contentTypes = contentTypes.replace('</Types>', `${chartOverrides}</Types>`);
    }
    zip.file('[Content_Types].xml', contentTypes);
    return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  }

  function loadReportLogoBase64() {
    if (typeof window.BROWNFIELD_LOGO_DATA_URL === 'string' && window.BROWNFIELD_LOGO_DATA_URL.startsWith('data:image/png;base64,')) {
      return window.BROWNFIELD_LOGO_DATA_URL;
    }
    console.warn('Embedded report logo data is unavailable; continuing without it.');
    return null;
  }

  async function buildWorksheet(workbook, session, name, logoBase64) {
    const points = normalizePoints(session);
    const results = calculateResults(session, points);
    const mainDataCapacity = 42;
    const mainReservedRows = 43;
    const hasDataAppendix = points.length > mainDataCapacity;
    const representativeIndices = representativePointIndices(points, mainDataCapacity, results.excavation, [results.level75, results.level25]);
    const displayedPoints = hasDataAppendix ? representativeIndices.map(index => points[index]) : points;
    const firstDataRow = 14;
    const lastDataRow = firstDataRow + mainReservedRows - 1;
    const lastDisplayedDataRow = firstDataRow + Math.max(0, displayedPoints.length - 1);
    const sourceFirstRow = 1;
    const sourceLastRow = Math.max(points.length, 1);
    const appendixPageCapacity = 84;
    const appendixPageHeight = 55;
    const appendixFirstRow = 57;
    const appendixPageCount = hasDataAppendix ? Math.ceil(points.length / appendixPageCapacity) : 0;
    const footerRow = hasDataAppendix ? 56 + appendixPageCount * appendixPageHeight : 56;
    const worksheet = workbook.addWorksheet(name, {
      views: [{ showGridLines: false, zoomScale: 85 }],
      properties: { defaultRowHeight: 15 },
    });

    worksheet.columns = [
      { width: 11 }, { width: 11 }, { width: 10 }, { width: 12 }, { width: 12 }, { width: 6 },
      { width: 18 }, { width: 8 }, { width: 8 }, { width: 12 }, { width: 8 }, { width: 10 }, { width: 11 },
      { width: 3 },
      { width: 18 }, { width: 18 },
      { width: 20 }, { width: 24 }, { width: 12 }, { width: 12 }, { width: 12 },
    ];
    worksheet.pageSetup = {
      paperSize: 9,
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: hasDataAppendix ? 0 : 1,
      horizontalCentered: true,
      verticalCentered: false,
      margins: { left: 0.25, right: 0.25, top: 0.3, bottom: 0.35, header: 0.1, footer: 0.15 },
      printArea: `A1:M${footerRow}`,
      showGridLines: false,
    };
    worksheet.headerFooter.oddFooter = `&L${safeSheetText(session.locationId) || 'Soakaway test'}&RPage &P of &N`;
    let logoId = null;
    if (logoBase64) {
      logoId = workbook.addImage({ base64: logoBase64, extension: 'png' });
      worksheet.addImage(logoId, { tl: { col: 0.15, row: 0.2 }, ext: { width: 235, height: 92 } });
    }
    mergeValue(worksheet, 'D1:M2', 'SOAKAWAY INFILTRATION TEST REPORT', {
      border: false,
      font: { name: 'Arial', size: 18, bold: true, color: { argb: BRAND.navy } },
      alignment: { horizontal: 'right', vertical: 'middle' },
    });
    mergeValue(worksheet, 'D3:M4', `${safeSheetText(session.locationId) || 'Unnamed location'} — ${compactTestLabel(session.testNumber)}`, {
      border: false,
      font: { name: 'Arial', size: 12, bold: true, color: { argb: BRAND.blue } },
      alignment: { horizontal: 'right', vertical: 'top' },
    });
    worksheet.getRow(1).height = 27;
    worksheet.getRow(2).height = 27;
    worksheet.getRow(3).height = 20;
    worksheet.getRow(4).height = 20;

    mergeValue(worksheet, 'A5:M5', 'TEST DETAILS', {
      fill: BRAND.section,
      font: { name: 'Arial', size: 10, bold: true, color: { argb: BRAND.white } },
      alignment: { horizontal: 'center', vertical: 'middle' },
    });
    const firstTimestamp = points.find(point => point.timestamp)?.timestamp;
    const dateValue = firstTimestamp ? new Date(firstTimestamp) : '';
    const details = [
      ['A6', 'Location ID', 'B6:D6', safeSheetText(session.locationId)],
      ['E6', 'Test Number', 'F6:G6', safeSheetText(session.testNumber)],
      ['H6', 'Date of Test', 'I6:J6', dateValue],
      ['K6', 'Logged By', 'L6:M6', null],
      ['A7', 'Site / Project', 'B7:G7', null],
      ['H7', 'Checked By', 'I7:M7', null],
    ];
    details.forEach(([labelCell, label, valueRange, value]) => {
      const labelTarget = worksheet.getCell(labelCell);
      labelTarget.value = label;
      applyCellStyle(labelTarget, { fill: BRAND.paleBlue, font: { name: 'Arial', size: 8, bold: true, color: { argb: BRAND.dark } } });
      const valueTarget = mergeValue(worksheet, valueRange, value, { fill: BRAND.white, font: { name: 'Arial', size: 9, color: { argb: BRAND.dark } } });
      if (value instanceof Date) valueTarget.numFmt = 'dd/mm/yyyy';
    });
    worksheet.getRow(6).height = 22;
    worksheet.getRow(7).height = 22;

    mergeValue(worksheet, 'A8:M8', 'TEST PIT PARAMETERS', {
      fill: BRAND.section,
      font: { name: 'Arial', size: 10, bold: true, color: { argb: BRAND.white } },
      alignment: { horizontal: 'center', vertical: 'middle' },
    });
    const parameters = [
      ['A9', 'Length at top (mm)', 'B9', asNumber(session.lengthTop, null)],
      ['C9', 'Length at bottom (mm)', 'D9', asNumber(session.lengthBottom || session.lengthTop, null)],
      ['E9', 'Width at top (mm)', 'F9', asNumber(session.widthTop, null)],
      ['G9', 'Width at bottom (mm)', 'H9', asNumber(session.widthBottom || session.widthTop, null)],
      ['I9', 'Excavation depth (mm)', 'J9', asNumber(session.depthExcavation, null)],
      ['K9', 'Depth tested (mm)', 'L9', formulaValue('=IFERROR($J$9-$AI$1,"")', results.initialHead)],
      ['A10', 'Void ratio', 'B10', asNumber(session.voidRatio, 1)],
    ];
    parameters.forEach(([labelCell, label, valueCell, value]) => {
      worksheet.getCell(labelCell).value = label;
      applyCellStyle(worksheet.getCell(labelCell), { fill: BRAND.paleBlue, font: { name: 'Arial', size: 8, bold: true, color: { argb: BRAND.dark } } });
      worksheet.getCell(valueCell).value = value;
      applyCellStyle(worksheet.getCell(valueCell), {
        fill: BRAND.white,
        alignment: { horizontal: 'center', vertical: 'middle' },
        numFmt: labelCell === 'A10' ? '0.00' : '0',
      });
    });
    worksheet.getRow(9).height = 30;
    worksheet.getCell('B10').dataValidation = {
      type: 'list',
      allowBlank: false,
      formulae: ['"1.00,0.30"'],
      showInputMessage: true,
      promptTitle: 'Void ratio',
      prompt: '1.00 = open pit; 0.30 = single-size stone',
      showErrorMessage: true,
      errorStyle: 'stop',
      errorTitle: 'Select a void ratio',
      error: 'Choose either 1.00 (open pit) or 0.30 (single-size stone).',
    };
    worksheet.getCell('M9').value = 'mm';
    applyCellStyle(worksheet.getCell('M9'), { fill: BRAND.paleBlue, alignment: { horizontal: 'center', vertical: 'middle' } });
    worksheet.getCell('C10').value = 'Strata description';
    applyCellStyle(worksheet.getCell('C10'), { fill: BRAND.paleBlue, font: { name: 'Arial', size: 8, bold: true, color: { argb: BRAND.dark } } });
    mergeValue(worksheet, 'D10:H10', session.strataDescription ? String(session.strataDescription) : null, {
      fill: BRAND.white,
      font: { name: 'Arial', size: 8, color: { argb: BRAND.dark } },
      alignment: { horizontal: 'left', vertical: 'middle', wrapText: false },
    });
    worksheet.getCell('I10').value = 'Pit details';
    applyCellStyle(worksheet.getCell('I10'), { fill: BRAND.paleBlue, font: { name: 'Arial', size: 8, bold: true, color: { argb: BRAND.dark } } });
    mergeValue(worksheet, 'J10:M10', session.pitDetails ? String(session.pitDetails) : null, {
      fill: BRAND.white,
      font: { name: 'Arial', size: 8, color: { argb: BRAND.dark } },
      alignment: { horizontal: 'left', vertical: 'middle', wrapText: false },
    });
    worksheet.getRow(10).height = 20;
    worksheet.getRow(11).height = 6;

    const recordedDataTitle = hasDataAppendix
      ? `SITE RECORDED DATA — REPRESENTATIVE SAMPLE (${representativeIndices.length} OF ${points.length})`
      : 'SITE RECORDED DATA';
    mergeValue(worksheet, 'A12:F12', recordedDataTitle, {
      fill: BRAND.section,
      font: { name: 'Arial', size: 10, bold: true, color: { argb: BRAND.white } },
      alignment: { horizontal: 'center', vertical: 'middle' },
    });
    mergeValue(worksheet, 'G12:M12', 'TEST PIT CONSTRUCTION', {
      fill: BRAND.section,
      font: { name: 'Arial', size: 10, bold: true, color: { argb: BRAND.white } },
      alignment: { horizontal: 'center', vertical: 'middle' },
    });
    for (let row = 13; row <= 23; row += 1) worksheet.getRow(row).height = 21;
    mergeValue(worksheet, 'G24:M24', 'HEAD OF WATER AGAINST TIME', {
      fill: BRAND.section,
      font: { name: 'Arial', size: 10, bold: true, color: { argb: BRAND.white } },
      alignment: { horizontal: 'center', vertical: 'middle' },
    });
    for (let row = 25; row <= 36; row += 1) worksheet.getRow(row).height = 18;

    const dimensionText = value => (Number.isFinite(value) ? `${Math.round(value)}mm` : '');
    const chartLabels = {
      topLength: dimensionText(asNumber(session.lengthTop, NaN)),
      topWidth: dimensionText(asNumber(session.widthTop, NaN)),
      excavationDepth: dimensionText(asNumber(session.depthExcavation, NaN)),
      headOfWater: Number.isFinite(results.initialHead) ? `Head of water\n${Math.round(results.initialHead)}mm` : 'Head of water',
      bottomWidth: dimensionText(asNumber(session.widthBottom || session.widthTop, NaN)),
      bottomLength: dimensionText(asNumber(session.lengthBottom || session.lengthTop, NaN)),
    };
    const pitDimensions = {
      lengthTop: asNumber(session.lengthTop, NaN),
      lengthBottom: asNumber(session.lengthBottom || session.lengthTop, NaN),
      widthTop: asNumber(session.widthTop, NaN),
      widthBottom: asNumber(session.widthBottom || session.widthTop, NaN),
      depthExcavation: asNumber(session.depthExcavation, NaN),
      initialHead: results.initialHead,
      voidRatio: asNumber(session.voidRatio, 1),
      stoneDepth: asNumber(session.stoneFillDepth, asNumber(session.depthExcavation, 0)),
    };
    mergeValue(worksheet, 'Q12:R12', 'CHART LABEL SOURCES', {
      fill: BRAND.section,
      font: { name: 'Arial', size: 9, bold: true, color: { argb: BRAND.white } },
      alignment: { horizontal: 'center', vertical: 'middle' },
    });
    const labelSources = [
      [13, 'Length at top', '=TEXT($B$9,"0")&"mm"', chartLabels.topLength],
      [14, 'Width at top', '=TEXT($F$9,"0")&"mm"', chartLabels.topWidth],
      [15, 'Excavation depth', '=TEXT($J$9,"0")&"mm"', chartLabels.excavationDepth],
      [16, 'Head of water', '="Head of water"&CHAR(10)&TEXT($L$9,"0")&"mm"', chartLabels.headOfWater],
      [17, 'Width at bottom', '=TEXT($H$9,"0")&"mm"', chartLabels.bottomWidth],
      [18, 'Length at bottom', '=TEXT($D$9,"0")&"mm"', chartLabels.bottomLength],
    ];
    labelSources.forEach(([row, label, formula, value]) => {
      worksheet.getCell(`Q${row}`).value = label;
      applyCellStyle(worksheet.getCell(`Q${row}`), { fill: BRAND.paleBlue, font: { name: 'Arial', size: 8, bold: true, color: { argb: BRAND.dark } } });
      worksheet.getCell(`R${row}`).value = formulaValue(formula, value);
      applyCellStyle(worksheet.getCell(`R${row}`), { fill: 'E7E6E6', font: { name: 'Arial', size: 9, italic: true, color: { argb: '666666' } }, alignment: { vertical: 'middle', wrapText: true } });
      worksheet.getCell(`R${row}`).protection = { locked: true };
    });
    mergeValue(worksheet, 'Q20:R21', 'Locked formula sources. Edit the white report cells or the Stone fill depth input at R27; the chart and labels will update automatically.', {
      fill: BRAND.paleBlue,
      font: { name: 'Arial', size: 8, italic: true, color: { argb: BRAND.dark } },
      alignment: { vertical: 'top', wrapText: true },
    });
    mergeValue(worksheet, 'Q23:R23', 'PIT FILL TYPE', {
      fill: BRAND.section,
      font: { name: 'Arial', size: 9, bold: true, color: { argb: BRAND.white } },
      alignment: { horizontal: 'center', vertical: 'middle' },
    });
    mergeValue(worksheet, 'Q24:R24', formulaValue('=IF(ABS($B$10-0.3)<0.001,"Single-size stone","Open pit")', Math.abs(asNumber(session.voidRatio, 1) - 0.3) < 0.001 ? 'Single-size stone' : 'Open pit'), {
      fill: 'E7E6E6',
      font: { name: 'Arial', size: 9, bold: true, color: { argb: '666666' } },
      alignment: { horizontal: 'center', vertical: 'middle' },
    });
    mergeValue(worksheet, 'Q25:R26', '1.00 = open pit\n0.30 = single-size stone', {
      fill: BRAND.paleBlue,
      font: { name: 'Arial', size: 8, italic: true, color: { argb: BRAND.dark } },
      alignment: { horizontal: 'left', vertical: 'middle', wrapText: true },
    });
    worksheet.getCell('Q27').value = 'Stone fill depth (mm)';
    applyCellStyle(worksheet.getCell('Q27'), {
      fill: BRAND.paleBlue,
      font: { name: 'Arial', size: 8, bold: true, color: { argb: BRAND.dark } },
      alignment: { horizontal: 'left', vertical: 'middle', wrapText: true },
    });
    worksheet.getCell('R27').value = pitDimensions.stoneDepth;
    applyCellStyle(worksheet.getCell('R27'), {
      fill: BRAND.white,
      font: { name: 'Arial', size: 9, bold: true, color: { argb: BRAND.dark } },
      alignment: { horizontal: 'center', vertical: 'middle' },
      numFmt: '0',
    });
    worksheet.getCell('R27').dataValidation = {
      type: 'decimal',
      operator: 'between',
      allowBlank: true,
      formulae: [0, '$J$9'],
      showInputMessage: true,
      promptTitle: 'Stone fill depth',
      prompt: 'Depth of stone measured upward from the pit base. Leave blank for the full excavation depth.',
      showErrorMessage: true,
      errorStyle: 'stop',
      errorTitle: 'Invalid stone depth',
      error: 'Enter a value from 0 to the excavation depth in J9.',
    };
    mergeValue(worksheet, 'Q28:R29', 'Measured upward from the pit base. Leave blank to use the full excavation depth.', {
      fill: BRAND.paleBlue,
      font: { name: 'Arial', size: 8, italic: true, color: { argb: BRAND.dark } },
      alignment: { horizontal: 'left', vertical: 'middle', wrapText: true },
    });
    const pitChartSeries = buildPitChartModel(worksheet, name, pitDimensions, chartLabels);

    const chartTimes = points.map(point => point.time);
    const chartMinTime = chartTimes.length ? Math.min(...chartTimes) : 0;
    const chartMaxTime = chartTimes.length ? Math.max(...chartTimes) : 1;
    mergeValue(worksheet, 'S12:U12', 'DRAINAGE CHART HELPERS', {
      fill: BRAND.section,
      font: { name: 'Arial', size: 9, bold: true, color: { argb: BRAND.white } },
      alignment: { horizontal: 'center', vertical: 'middle' },
    });
    worksheet.getCell('S13').value = formulaValue(`=IF(COUNT($AH$${sourceFirstRow}:$AH$${sourceLastRow})=0,0,MIN($AH$${sourceFirstRow}:$AH$${sourceLastRow}))`, chartMinTime);
    worksheet.getCell('S14').value = formulaValue(`=IF(COUNT($AH$${sourceFirstRow}:$AH$${sourceLastRow})=0,1,MAX($AH$${sourceFirstRow}:$AH$${sourceLastRow}))`, chartMaxTime);
    worksheet.getCell('T13').value = formulaValue('=$J$44', results.level75);
    worksheet.getCell('T14').value = formulaValue('=$J$44', results.level75);
    worksheet.getCell('U13').value = formulaValue('=$J$45', results.level25);
    worksheet.getCell('U14').value = formulaValue('=$J$45', results.level25);
    ['S13', 'S14', 'T13', 'T14', 'U13', 'U14'].forEach(address => {
      applyCellStyle(worksheet.getCell(address), { fill: BRAND.paleBlue, numFmt: '0.00', alignment: { horizontal: 'right', vertical: 'middle' } });
    });
    const drainageBand = { startRow: 10000, endRow: 10000, xValues: [], yValues: [] };
    const drainageBandStripes = 128;
    let drainageBandRow = drainageBand.startRow;
    for (let stripe = 0; stripe < drainageBandStripes; stripe += 1) {
      const ratio = stripe / (drainageBandStripes - 1);
      const xValue = chartMinTime + (chartMaxTime - chartMinTime) * ratio;
      const xFormula = `=$S$13+($S$14-$S$13)*${ratio}`;
      [[xFormula, '=$U$13', xValue, results.level25], [xFormula, '=$T$13', xValue, results.level75], ['=NA()', '=NA()', NaN, NaN]].forEach(([xFormulaText, yFormulaText, xResult, yResult]) => {
        worksheet.getCell(`V${drainageBandRow}`).value = formulaValue(xFormulaText, xResult);
        worksheet.getCell(`W${drainageBandRow}`).value = formulaValue(yFormulaText, yResult);
        worksheet.getCell(`V${drainageBandRow}`).protection = { locked: true };
        worksheet.getCell(`W${drainageBandRow}`).protection = { locked: true };
        drainageBand.xValues.push(xResult);
        drainageBand.yValues.push(yResult);
        drainageBandRow += 1;
      });
    }
    drainageBand.endRow = drainageBandRow - 1;

    mergeValue(worksheet, 'G41:M41', 'BRE 365 DATA ANALYSIS', {
      fill: BRAND.section,
      font: { name: 'Arial', size: 10, bold: true, color: { argb: BRAND.white } },
      alignment: { horizontal: 'center', vertical: 'middle' },
    });
    ['Date', 'Clock time', 'Time (mins)', 'Depth to water (mm)', 'Head of water (mm)', null].forEach((heading, index) => {
      const cell = worksheet.getCell(13, index + 1);
      cell.value = heading;
      if (heading == null) {
        cell.fill = fill(BRAND.white);
        cell.border = { right: thinBorder.right };
        return;
      }
      applyCellStyle(cell, { fill: BRAND.section, font: { name: 'Arial', size: 8, bold: true, color: { argb: BRAND.white } }, alignment: { horizontal: 'center', vertical: 'middle', wrapText: true } });
    });
    worksheet.getRow(13).height = 30;

    mergeValue(worksheet, 'O12:P12', 'INTERPOLATED CROSSING TIMES', {
      fill: BRAND.section,
      font: { name: 'Arial', size: 9, bold: true, color: { argb: BRAND.white } },
      alignment: { horizontal: 'center', vertical: 'middle' },
    });
    [['O13', '75% level time (mins)'], ['P13', '25% level time (mins)']].forEach(([address, heading]) => {
      const cell = worksheet.getCell(address);
      cell.value = heading;
      applyCellStyle(cell, {
        fill: BRAND.paleBlue,
        font: { name: 'Arial', size: 8, bold: true, color: { argb: BRAND.dark } },
        alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
      });
    });

    const visiblePointSources = new Array(points.length);
    const appendixHeadings = ['No.', 'Date', 'Clock time', 'Time (mins)', 'Depth to water (mm)', 'Head of water (mm)'];
    const writeAppendixPoint = (pointIndex, rowNumber, startColumn) => {
      const point = points[pointIndex];
      const timestamp = point && point.timestamp ? new Date(point.timestamp) : null;
      const depthAddress = worksheet.getCell(rowNumber, startColumn + 4).address;
      const head = point ? results.excavation - point.depth : null;
      const values = point ? [
        pointIndex + 1,
        timestamp || null,
        timestamp || point.clockTime || null,
        point.time,
        point.depth,
        formulaValue(`=IF(${depthAddress}="","",$J$9-${depthAddress})`, head),
      ] : [null, null, null, null, null, null];
      values.forEach((value, offset) => {
        const cell = worksheet.getCell(rowNumber, startColumn + offset);
        cell.value = value;
        applyCellStyle(cell, {
          fill: offset === 5 ? BRAND.paleBlue : BRAND.white,
          font: { name: 'Arial', size: 8, color: { argb: BRAND.dark } },
          alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
          numFmt: offset === 1 ? 'dd/mm/yyyy' : offset === 2 && timestamp ? 'hh:mm:ss' : offset >= 3 ? '0.00' : undefined,
        });
        cell.protection = { locked: !point || offset === 0 || offset === 5 };
      });
      if (point) {
        visiblePointSources[pointIndex] = {
          date: worksheet.getCell(rowNumber, startColumn + 1).address,
          clock: worksheet.getCell(rowNumber, startColumn + 2).address,
          time: worksheet.getCell(rowNumber, startColumn + 3).address,
          depth: worksheet.getCell(rowNumber, startColumn + 4).address,
          head: worksheet.getCell(rowNumber, startColumn + 5).address,
        };
      }
    };

    const appendixValue = (formula, result) => formulaValue(formula, result == null ? '' : result);
    const buildAppendixPage = pageIndex => {
      const startRow = appendixFirstRow + pageIndex * appendixPageHeight;
      const pointOffset = pageIndex * appendixPageCapacity;
      if (logoBase64) {
        const appendixLogoId = workbook.addImage({ base64: logoBase64, extension: 'png' });
        worksheet.addImage(appendixLogoId, { tl: { col: 0.15, row: startRow - 0.2 }, ext: { width: 235, height: 92 } });
      }
      mergeValue(worksheet, `D${startRow}:M${startRow + 1}`, 'SOAKAWAY INFILTRATION TEST REPORT', {
        border: false,
        font: { name: 'Arial', size: 14, bold: true, color: { argb: BRAND.navy } },
        alignment: { horizontal: 'right', vertical: 'middle' },
      });
      mergeValue(worksheet, `D${startRow + 2}:M${startRow + 3}`, `${safeSheetText(session.locationId) || 'Unnamed location'} — ${compactTestLabel(session.testNumber)} — COMPLETE RECORDED DATA`, {
        border: false,
        font: { name: 'Arial', size: 12, bold: true, color: { argb: BRAND.blue } },
        alignment: { horizontal: 'right', vertical: 'top' },
      });
      worksheet.getRow(startRow).height = 27;
      worksheet.getRow(startRow + 1).height = 27;
      worksheet.getRow(startRow + 2).height = 20;
      worksheet.getRow(startRow + 3).height = 20;

      mergeValue(worksheet, `A${startRow + 4}:M${startRow + 4}`, 'TEST DETAILS', {
        fill: BRAND.section,
        font: { name: 'Arial', size: 10, bold: true, color: { argb: BRAND.white } },
        alignment: { horizontal: 'center', vertical: 'middle' },
      });
      const detailRows = [
        [`A${startRow + 5}`, 'Location ID', `B${startRow + 5}:D${startRow + 5}`, appendixValue('=$B$6', safeSheetText(session.locationId))],
        [`E${startRow + 5}`, 'Test Number', `F${startRow + 5}:G${startRow + 5}`, appendixValue('=$F$6', safeSheetText(session.testNumber))],
        [`H${startRow + 5}`, 'Date of Test', `I${startRow + 5}:J${startRow + 5}`, appendixValue('=IF($I$6="","",$I$6)', dateValue)],
        [`K${startRow + 5}`, 'Logged By', `L${startRow + 5}:M${startRow + 5}`, appendixValue('=IF($L$6="","",$L$6)', '')],
        [`A${startRow + 6}`, 'Site / Project', `B${startRow + 6}:G${startRow + 6}`, appendixValue('=IF($B$7="","",$B$7)', '')],
        [`H${startRow + 6}`, 'Checked By', `I${startRow + 6}:M${startRow + 6}`, appendixValue('=IF($I$7="","",$I$7)', '')],
      ];
      detailRows.forEach(([labelCell, label, valueRange, value]) => {
        worksheet.getCell(labelCell).value = label;
        applyCellStyle(worksheet.getCell(labelCell), { fill: BRAND.paleBlue, font: { name: 'Arial', size: 8, bold: true, color: { argb: BRAND.dark } } });
        const target = mergeValue(worksheet, valueRange, value, { fill: BRAND.white, font: { name: 'Arial', size: 9, color: { argb: BRAND.dark } } });
        if (label === 'Date of Test') target.numFmt = 'dd/mm/yyyy';
      });
      worksheet.getRow(startRow + 5).height = 22;
      worksheet.getRow(startRow + 6).height = 22;

      mergeValue(worksheet, `A${startRow + 7}:M${startRow + 7}`, 'TEST PIT PARAMETERS', {
        fill: BRAND.section,
        font: { name: 'Arial', size: 10, bold: true, color: { argb: BRAND.white } },
        alignment: { horizontal: 'center', vertical: 'middle' },
      });
      const parameterRow = startRow + 8;
      const appendixParameters = [
        ['A', 'Length at top (mm)', 'B', '=$B$9', asNumber(session.lengthTop, null)],
        ['C', 'Length at bottom (mm)', 'D', '=$D$9', asNumber(session.lengthBottom || session.lengthTop, null)],
        ['E', 'Width at top (mm)', 'F', '=$F$9', asNumber(session.widthTop, null)],
        ['G', 'Width at bottom (mm)', 'H', '=$H$9', asNumber(session.widthBottom || session.widthTop, null)],
        ['I', 'Excavation depth (mm)', 'J', '=$J$9', asNumber(session.depthExcavation, null)],
        ['K', 'Depth tested (mm)', 'L', '=$L$9', results.initialHead],
      ];
      appendixParameters.forEach(([labelColumn, label, valueColumn, formula, result]) => {
        worksheet.getCell(`${labelColumn}${parameterRow}`).value = label;
        applyCellStyle(worksheet.getCell(`${labelColumn}${parameterRow}`), { fill: BRAND.paleBlue, font: { name: 'Arial', size: 8, bold: true, color: { argb: BRAND.dark } } });
        worksheet.getCell(`${valueColumn}${parameterRow}`).value = appendixValue(formula, result);
        applyCellStyle(worksheet.getCell(`${valueColumn}${parameterRow}`), { fill: BRAND.white, alignment: { horizontal: 'center', vertical: 'middle' }, numFmt: '0' });
      });
      worksheet.getCell(`M${parameterRow}`).value = 'mm';
      applyCellStyle(worksheet.getCell(`M${parameterRow}`), { fill: BRAND.paleBlue, alignment: { horizontal: 'center', vertical: 'middle' } });
      worksheet.getRow(parameterRow).height = 30;
      const parameterSecondRow = startRow + 9;
      worksheet.getCell(`A${parameterSecondRow}`).value = 'Void ratio';
      applyCellStyle(worksheet.getCell(`A${parameterSecondRow}`), { fill: BRAND.paleBlue, font: { name: 'Arial', size: 8, bold: true, color: { argb: BRAND.dark } } });
      worksheet.getCell(`B${parameterSecondRow}`).value = appendixValue('=$B$10', asNumber(session.voidRatio, 1));
      applyCellStyle(worksheet.getCell(`B${parameterSecondRow}`), { fill: BRAND.white, alignment: { horizontal: 'center', vertical: 'middle' }, numFmt: '0.00' });
      worksheet.getCell(`C${parameterSecondRow}`).value = 'Strata description';
      applyCellStyle(worksheet.getCell(`C${parameterSecondRow}`), { fill: BRAND.paleBlue, font: { name: 'Arial', size: 8, bold: true, color: { argb: BRAND.dark } } });
      mergeValue(worksheet, `D${parameterSecondRow}:H${parameterSecondRow}`, appendixValue('=IF($D$10="","",$D$10)', session.strataDescription || ''), { fill: BRAND.white, font: { name: 'Arial', size: 8, color: { argb: BRAND.dark } }, alignment: { horizontal: 'left', vertical: 'middle' } });
      worksheet.getCell(`I${parameterSecondRow}`).value = 'Pit details';
      applyCellStyle(worksheet.getCell(`I${parameterSecondRow}`), { fill: BRAND.paleBlue, font: { name: 'Arial', size: 8, bold: true, color: { argb: BRAND.dark } } });
      mergeValue(worksheet, `J${parameterSecondRow}:M${parameterSecondRow}`, appendixValue('=IF($J$10="","",$J$10)', session.pitDetails || ''), { fill: BRAND.white, font: { name: 'Arial', size: 8, color: { argb: BRAND.dark } }, alignment: { horizontal: 'left', vertical: 'middle' } });
      worksheet.getRow(parameterSecondRow).height = 20;
      worksheet.getRow(startRow + 10).height = 6;

      mergeValue(worksheet, `A${startRow + 11}:M${startRow + 11}`, `COMPLETE SITE RECORDED DATA — ${points.length} READINGS`, {
        fill: BRAND.section,
        font: { name: 'Arial', size: 10, bold: true, color: { argb: BRAND.white } },
        alignment: { horizontal: 'center', vertical: 'middle' },
      });
      [1, 8].forEach(startColumn => appendixHeadings.forEach((heading, offset) => {
        const cell = worksheet.getCell(startRow + 12, startColumn + offset);
        cell.value = heading;
        applyCellStyle(cell, { fill: BRAND.section, font: { name: 'Arial', size: 7, bold: true, color: { argb: BRAND.white } }, alignment: { horizontal: 'center', vertical: 'middle', wrapText: true } });
      }));
      worksheet.getCell(startRow + 12, 7).fill = fill(BRAND.white);
      worksheet.getCell(startRow + 12, 7).border = {};
      worksheet.getRow(startRow + 12).height = 30;
      for (let localIndex = 0; localIndex < 42; localIndex += 1) {
        const rowNumber = startRow + 13 + localIndex;
        writeAppendixPoint(pointOffset + localIndex, rowNumber, 1);
        writeAppendixPoint(pointOffset + 42 + localIndex, rowNumber, 8);
        worksheet.getCell(rowNumber, 7).fill = fill(BRAND.white);
        worksheet.getCell(rowNumber, 7).border = {};
        worksheet.getRow(rowNumber).height = 15;
      }
    };

    if (hasDataAppendix) {
      for (let pageIndex = 0; pageIndex < appendixPageCount; pageIndex += 1) buildAppendixPage(pageIndex);
      for (let pageIndex = 0; pageIndex < appendixPageCount; pageIndex += 1) worksheet.getRow(56 + pageIndex * appendixPageHeight).addPageBreak();
    }

    for (let offset = 0; offset < mainReservedRows; offset += 1) {
      const rowNumber = firstDataRow + offset;
      const point = displayedPoints[offset];
      const sourceIndex = hasDataAppendix ? representativeIndices[offset] : offset;
      const timestamp = point && point.timestamp ? new Date(point.timestamp) : null;
      const head = point ? results.excavation - point.depth : null;
      const source = point && hasDataAppendix ? visiblePointSources[sourceIndex] : null;
      const cells = point ? (hasDataAppendix ? [
        formulaValue(`=${source.date}`, timestamp || ''),
        formulaValue(`=${source.clock}`, timestamp || point.clockTime || ''),
        formulaValue(`=${source.time}`, point.time),
        formulaValue(`=${source.depth}`, point.depth),
        formulaValue(`=${source.head}`, head),
      ] : [
        timestamp || null,
        timestamp || point.clockTime || null,
        point.time,
        point.depth,
        formulaValue(`=IF(D${rowNumber}="","",$J$9-D${rowNumber})`, head),
      ]) : [null, null, null, null, null];
      cells.forEach((value, index) => {
        const cell = worksheet.getCell(rowNumber, index + 1);
        cell.value = value;
        applyCellStyle(cell, {
          fill: index === 4 ? BRAND.paleBlue : BRAND.white,
          alignment: { horizontal: 'center', vertical: 'middle' },
          numFmt: index === 0 ? 'dd/mm/yyyy' : index === 1 && timestamp ? 'hh:mm:ss' : index >= 2 ? '0.00' : undefined,
        });
        if (hasDataAppendix) cell.protection = { locked: true };
      });
      worksheet.getCell(rowNumber, 6).border = { right: thinBorder.right };
      if (point && !hasDataAppendix) {
        visiblePointSources[offset] = {
          date: `A${rowNumber}`,
          clock: `B${rowNumber}`,
          time: `C${rowNumber}`,
          depth: `D${rowNumber}`,
          head: `E${rowNumber}`,
        };
      }
    }

    for (let column = 34; column <= 36; column += 1) worksheet.getColumn(column).hidden = true;
    for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
      const source = visiblePointSources[pointIndex];
      const helperRow = sourceFirstRow + pointIndex;
      const head = results.excavation - points[pointIndex].depth;
      worksheet.getCell(`AH${helperRow}`).value = formulaValue(`=${source.time}`, points[pointIndex].time);
      worksheet.getCell(`AI${helperRow}`).value = formulaValue(`=${source.depth}`, points[pointIndex].depth);
      worksheet.getCell(`AJ${helperRow}`).value = formulaValue(`=${source.head}`, head);
      ['AH', 'AI', 'AJ'].forEach(column => {
        worksheet.getCell(`${column}${helperRow}`).numFmt = '0.00';
        worksheet.getCell(`${column}${helperRow}`).protection = { locked: true };
      });
    }
    if (!points.length) ['AH1', 'AI1', 'AJ1'].forEach(address => {
      worksheet.getCell(address).value = null;
      worksheet.getCell(address).protection = { locked: true };
    });

    const crossingLastRow = firstDataRow + Math.max(points.length, 1) - 1;
    for (let pointIndex = 0; pointIndex < Math.max(points.length, 1); pointIndex += 1) {
      const rowNumber = firstDataRow + pointIndex;
      [15, 16].forEach(column => applyCellStyle(worksheet.getCell(rowNumber, column), {
        fill: BRAND.white,
        alignment: { horizontal: 'right', vertical: 'middle' },
        numFmt: '0.00',
      }));
      if (pointIndex === 0 || !points[pointIndex]) continue;
      const previousHead = results.excavation - points[pointIndex - 1].depth;
      const currentHead = results.excavation - points[pointIndex].depth;
      const cross75 = previousHead >= results.level75 && currentHead <= results.level75
        ? points[pointIndex - 1].time + ((previousHead - results.level75) * (points[pointIndex].time - points[pointIndex - 1].time)) / (previousHead - currentHead || 1)
        : null;
      const cross25 = previousHead >= results.level25 && currentHead <= results.level25
        ? points[pointIndex - 1].time + ((previousHead - results.level25) * (points[pointIndex].time - points[pointIndex - 1].time)) / (previousHead - currentHead || 1)
        : null;
      const previousSourceRow = sourceFirstRow + pointIndex - 1;
      const currentSourceRow = sourceFirstRow + pointIndex;
      worksheet.getCell(rowNumber, 15).value = formulaValue(`=IF(AND($AJ$${previousSourceRow}>=J$44,$AJ$${currentSourceRow}<=J$44,$AJ$${previousSourceRow}<>$AJ$${currentSourceRow}),$AH$${previousSourceRow}+($AJ$${previousSourceRow}-J$44)*($AH$${currentSourceRow}-$AH$${previousSourceRow})/($AJ$${previousSourceRow}-$AJ$${currentSourceRow}),"")`, cross75);
      worksheet.getCell(rowNumber, 16).value = formulaValue(`=IF(AND($AJ$${previousSourceRow}>=J$45,$AJ$${currentSourceRow}<=J$45,$AJ$${previousSourceRow}<>$AJ$${currentSourceRow}),$AH$${previousSourceRow}+($AJ$${previousSourceRow}-J$45)*($AH$${currentSourceRow}-$AH$${previousSourceRow})/($AJ$${previousSourceRow}-$AJ$${currentSourceRow}),"")`, cross25);
    }

    const manualRateRequired = requiresManualInfiltrationRate(points, results);
    const selectedWaterLevel1 = manualRateRequired ? 'J46' : 'J44';
    const selectedWaterLevel2 = manualRateRequired ? 'J47' : 'J45';
    const manualVolumeDischargedFormula = '=IF(OR(J46="",J47=""),"",AVERAGE(B9*F9,D9*H9)/1000000*ABS(J46-J47)/1000*B10)';
    const analysis = [
      [42, 'Initial head of water', '=IFERROR($J$9-$AI$1,"")', results.initialHead, 'mm', '0.00'],
      [43, 'Minimum recorded head', `=IF(COUNT($AJ$${sourceFirstRow}:$AJ$${sourceLastRow})=0,"",MIN($AJ$${sourceFirstRow}:$AJ$${sourceLastRow}))`, results.minimumHead, 'mm', '0.00'],
      [44, 'Water level at 75% effective depth', '=J42*0.75', results.level75, 'mm', '0.00'],
      [45, 'Water level at 25% effective depth', '=J42*0.25', results.level25, 'mm', '0.00'],
      [46, manualRateRequired ? 'User chosen Water Level 1' : 'Interpolated time at 75% level', manualRateRequired ? null : `=IF(COUNT(O${firstDataRow}:O${crossingLastRow})=0,"",MAX(O${firstDataRow}:O${crossingLastRow}))`, manualRateRequired ? null : results.time75, manualRateRequired ? 'mm' : 'mins', '0.00', manualRateRequired],
      [47, manualRateRequired ? 'User chosen Water Level 2' : 'Interpolated time at 25% level', manualRateRequired ? null : `=IF(COUNT(P${firstDataRow}:P${crossingLastRow})=0,"",MAX(P${firstDataRow}:P${crossingLastRow}))`, manualRateRequired ? null : results.time25, manualRateRequired ? 'mm' : 'mins', '0.00', manualRateRequired],
      [48, manualRateRequired ? 'Time to drain from Water Level 1 to 2' : 'Time to drain 75% to 25%', manualRateRequired ? null : '=IF(OR(J46="",J47=""),"",J47-J46)', manualRateRequired ? null : results.drainTime, 'mins', '0.00', manualRateRequired],
      [49, 'Factored volume of water', '=AVERAGE(B9*F9,D9*H9)/1000000*J42/1000*B10', results.factoredVolume, 'm³', '0.000000'],
      [50, 'Volume of water discharged', manualRateRequired ? manualVolumeDischargedFormula : '=J49*0.5', manualRateRequired ? null : results.volumeDischarged, 'm³', '0.000000'],
      [51, 'Discharge area', manualRateRequired
        ? `=IF(OR(${selectedWaterLevel1}="",${selectedWaterLevel2}=""),"",((2*AVERAGE(B9,D9)+2*AVERAGE(F9,H9))/1000)*AVERAGE(${selectedWaterLevel1},${selectedWaterLevel2})/1000+(D9*H9/1000000))`
        : `=((2*AVERAGE(B9,D9)+2*AVERAGE(F9,H9))/1000)*AVERAGE(${selectedWaterLevel1},${selectedWaterLevel2})/1000+(D9*H9/1000000)`, manualRateRequired ? null : results.dischargeArea, 'm²', '0.000000'],
      [53, 'Soil infiltration rate', '=IFERROR(J50/J51/J48,"")', manualRateRequired ? null : results.infiltrationMMin, 'm/min', '0.000E+00'],
      [54, 'Soil infiltration rate', '=IF(J53="","",J53/60)', manualRateRequired ? null : results.infiltrationMSec, 'm/sec', '0.000E+00'],
    ];
    analysis.forEach(([row, label, formula, result, unit, format, isManualInput = false]) => {
      const isInfiltrationRate = row >= 53;
      mergeValue(worksheet, `G${row}:I${row}`, label, {
        fill: isInfiltrationRate ? BRAND.navy : BRAND.paleBlue,
        font: { name: 'Arial', size: isInfiltrationRate ? 9 : 8, bold: true, color: { argb: isInfiltrationRate ? BRAND.white : BRAND.dark } },
      });
      mergeValue(worksheet, `J${row}:K${row}`, formula ? formulaValue(formula, result) : null, {
        fill: isManualInput ? BRAND.manualInput : isInfiltrationRate ? BRAND.paleGreen : BRAND.white,
        font: { name: 'Arial', size: isInfiltrationRate ? 10 : 9, bold: isInfiltrationRate, color: { argb: BRAND.dark } },
        alignment: { horizontal: 'right', vertical: 'middle' },
        numFmt: format,
      });
      mergeValue(worksheet, `L${row}:M${row}`, unit, {
        fill: BRAND.paleBlue,
        font: { name: 'Arial', size: 9, bold: isInfiltrationRate, color: { argb: BRAND.dark } },
        alignment: { horizontal: 'center', vertical: 'middle' },
      });
      if (isInfiltrationRate) worksheet.getRow(row).height = 20;
    });
    if (manualRateRequired) worksheet.getRow(48).height = 24;
    worksheet.getRow(52).height = 12;
    mergeValue(worksheet, 'G55:I56', 'BRE 365 COMPLIANCE', { fill: BRAND.section, font: { name: 'Arial', size: 9, bold: true, color: { argb: BRAND.white } }, alignment: { horizontal: 'center', vertical: 'middle' } });
    const complianceFormula = `=IF(COUNT($AJ$${sourceFirstRow}:$AJ$${sourceLastRow})=0,"No readings recorded",IF(J43<=J45,"Compliant with BRE 365","Not compliant - test did not drain past 25% effective depth"))`;
    mergeValue(worksheet, 'J55:M56', formulaValue(complianceFormula, results.compliance), {
      fill: results.compliance.startsWith('Compliant') ? BRAND.paleGreen : BRAND.paleRed,
      font: { name: 'Arial', size: 9, bold: true, color: { argb: BRAND.dark } },
      alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
    });
    if (hasDataAppendix) worksheet.getRow(56).height = 6;

    for (let row = 5; row <= 10; row += 1) {
      worksheet.getCell(row, 1).border = { ...worksheet.getCell(row, 1).border, left: thinBorder.left };
      worksheet.getCell(row, 13).border = { ...worksheet.getCell(row, 13).border, right: thinBorder.right };
    }
    for (let row = 12; row <= 56; row += 1) {
      worksheet.getCell(row, 1).border = { ...worksheet.getCell(row, 1).border, left: thinBorder.left };
      worksheet.getCell(row, 6).border = { ...worksheet.getCell(row, 6).border, right: reportDividerBorder };
      worksheet.getCell(row, 7).border = { ...worksheet.getCell(row, 7).border, left: reportDividerBorder };
    }
    [[12, 36], [41, 56]].forEach(([startRow, endRow]) => {
      for (let row = startRow; row <= endRow; row += 1) {
        worksheet.getCell(row, 13).border = { ...worksheet.getCell(row, 13).border, right: thinBorder.right };
      }
    });
    worksheet.autoFilter = `A13:E${lastDataRow}`;
    worksheet.views = [{ showGridLines: false, zoomScale: 85 }];
    const setLocked = (address, locked) => {
      const [start, end = start] = address.split(':');
      const startCell = worksheet.getCell(start);
      const endCell = worksheet.getCell(end);
      for (let row = startCell.row; row <= endCell.row; row += 1) {
        for (let column = startCell.col; column <= endCell.col; column += 1) worksheet.getCell(row, column).protection = { locked };
      }
    };
    [
      'B6:D6', 'F6:G6', 'I6:J6', 'L6:M6', 'B7:G7', 'I7:M7',
      'B9', 'D9', 'F9', 'H9', 'J9', 'B10', 'D10:H10', 'J10:M10', 'R27',
    ].forEach(address => setLocked(address, false));
    if (manualRateRequired) setLocked('J46:K48', false);
    if (!hasDataAppendix) setLocked(`A${firstDataRow}:D${lastDataRow}`, false);
    setLocked('R13:R18', true);
    await worksheet.protect('', {
      spinCount: 1000,
      selectLockedCells: true,
      selectUnlockedCells: true,
      autoFilter: true,
      objects: false,
      scenarios: true,
    });
    return {
      worksheet,
      name,
      points,
      results,
      chartLabels,
      pitDimensions,
      pitChartSeries,
      drainageBand,
      footerRow,
      firstDataRow,
      lastDataRow,
      chartTimeRange: `$AH$${sourceFirstRow}:$AH$${sourceLastRow}`,
      chartHeadRange: `$AJ$${sourceFirstRow}:$AJ$${sourceLastRow}`,
      hasDataAppendix,
      appendixPageCount,
      representativeIndices,
      lastDisplayedDataRow,
    };
  }

  function groupedLocationId(sessions) {
    const locations = [...new Set(sessions.map(session => safeSheetText(session.locationId).toLocaleLowerCase()).filter(Boolean))];
    if (sessions.length < 2 || sessions.length > 3 || locations.length !== 1) {
      throw new Error('Grouped export requires two or three selected sessions with the same nonblank Location ID.');
    }
    return safeSheetText(sessions[0].locationId);
  }

  async function buildGroupedWorksheet(workbook, sessions, name, logoBase64) {
    const locationId = groupedLocationId(sessions);
    const contexts = sessions.map((session, index) => {
      const points = normalizePoints(session);
      return {
        session,
        index,
        points,
        results: calculateResults(session, points),
        sources: new Array(points.length),
      };
    });
    const first = contexts[0];
    const appendixPageCapacity = 84;
    const appendixPageHeight = 55;
    const appendixFirstRow = 57;
    const totalAppendixPages = contexts.reduce(
      (total, context) => total + Math.max(1, Math.ceil(context.points.length / appendixPageCapacity)),
      0,
    );
    const footerRow = 56 + totalAppendixPages * appendixPageHeight;
    const worksheet = workbook.addWorksheet(name, {
      views: [{ showGridLines: false, zoomScale: 78 }],
      properties: { defaultRowHeight: 15 },
    });
    worksheet.columns = [
      { width: 11 }, { width: 11 }, { width: 10 }, { width: 11 }, { width: 11 }, { width: 7 },
      { width: 10 }, { width: 10 }, { width: 10 }, { width: 11 }, { width: 9 }, { width: 10 }, { width: 11 },
      { width: 3 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 },
      { width: 16 }, { width: 16 }, { width: 16 },
    ];
    worksheet.pageSetup = {
      paperSize: 9,
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      verticalCentered: false,
      margins: { left: 0.2, right: 0.2, top: 0.25, bottom: 0.3, header: 0.1, footer: 0.15 },
      printArea: `A1:M${footerRow}`,
      showGridLines: false,
    };
    worksheet.headerFooter.oddFooter = `&L${locationId} — grouped tests&RPage &P of &N`;

    const addLogo = row => {
      if (!logoBase64) return;
      const imageId = workbook.addImage({ base64: logoBase64, extension: 'png' });
      const anchorRow = row === 0 ? 0.2 : row - 0.2;
      worksheet.addImage(imageId, { tl: { col: 0.15, row: anchorRow }, ext: { width: 235, height: 92 } });
    };
    addLogo(0);

    const testLabels = contexts.map(context => compactTestLabel(context.session.testNumber));
    mergeValue(worksheet, 'D1:M2', 'SOAKAWAY INFILTRATION TEST REPORT — GROUPED RUNS', {
      border: false,
      font: { name: 'Arial', size: 14, bold: true, color: { argb: BRAND.navy } },
      alignment: { horizontal: 'right', vertical: 'middle' },
    });
    mergeValue(worksheet, 'D3:M4', `${locationId} — ${testLabels.join(' / ')}`, {
      border: false,
      font: { name: 'Arial', size: 12, bold: true, color: { argb: BRAND.blue } },
      alignment: { horizontal: 'right', vertical: 'top' },
    });
    [1, 2].forEach(row => { worksheet.getRow(row).height = 27; });
    [3, 4].forEach(row => { worksheet.getRow(row).height = 20; });

    mergeValue(worksheet, 'A5:M5', 'TEST DETAILS', {
      fill: BRAND.section,
      font: { name: 'Arial', size: 10, bold: true, color: { argb: BRAND.white } },
      alignment: { horizontal: 'center', vertical: 'middle' },
    });
    const firstTimestamp = contexts
      .flatMap(context => context.points)
      .map(point => point.timestamp)
      .filter(Number.isFinite)
      .sort((left, right) => left - right)[0];
    const testDate = Number.isFinite(firstTimestamp) ? new Date(firstTimestamp) : '';
    const details = [
      ['A6', 'Location ID', 'B6:D6', locationId],
      ['E6', 'Test runs', 'F6:H6', testLabels.join(', ')],
      ['I6', 'Date of first run', 'J6:K6', testDate],
      ['L6', 'Logged By', 'M6', null],
      ['A7', 'Site / Project', 'B7:H7', null],
      ['I7', 'Checked By', 'J7:M7', null],
    ];
    details.forEach(([labelCell, label, valueRange, value]) => {
      worksheet.getCell(labelCell).value = label;
      applyCellStyle(worksheet.getCell(labelCell), { fill: BRAND.paleBlue, font: { name: 'Arial', size: 8, bold: true, color: { argb: BRAND.dark } } });
      const target = mergeValue(worksheet, valueRange, value, { fill: BRAND.white, font: { name: 'Arial', size: 9, color: { argb: BRAND.dark } } });
      if (value instanceof Date) target.numFmt = 'dd/mm/yyyy';
    });
    worksheet.getRow(6).height = 22;
    worksheet.getRow(7).height = 22;

    mergeValue(worksheet, 'A8:M8', 'SHARED TEST PIT PARAMETERS', {
      fill: BRAND.section,
      font: { name: 'Arial', size: 10, bold: true, color: { argb: BRAND.white } },
      alignment: { horizontal: 'center', vertical: 'middle' },
    });
    const session = first.session;
    const parameters = [
      ['A9', 'Length at top (mm)', 'B9', asNumber(session.lengthTop, null)],
      ['C9', 'Length at bottom (mm)', 'D9', asNumber(session.lengthBottom || session.lengthTop, null)],
      ['E9', 'Width at top (mm)', 'F9', asNumber(session.widthTop, null)],
      ['G9', 'Width at bottom (mm)', 'H9', asNumber(session.widthBottom || session.widthTop, null)],
      ['I9', 'Excavation depth (mm)', 'J9', asNumber(session.depthExcavation, null)],
      ['K9', `${testLabels[0]} initial head (mm)`, 'L9', first.results.initialHead],
    ];
    parameters.forEach(([labelCell, label, valueCell, value]) => {
      worksheet.getCell(labelCell).value = label;
      applyCellStyle(worksheet.getCell(labelCell), { fill: BRAND.paleBlue, font: { name: 'Arial', size: 8, bold: true, color: { argb: BRAND.dark } } });
      worksheet.getCell(valueCell).value = value;
      applyCellStyle(worksheet.getCell(valueCell), { fill: BRAND.white, alignment: { horizontal: 'center', vertical: 'middle' }, numFmt: '0' });
    });
    worksheet.getCell('M9').value = 'mm';
    applyCellStyle(worksheet.getCell('M9'), { fill: BRAND.paleBlue, alignment: { horizontal: 'center', vertical: 'middle' } });
    worksheet.getRow(9).height = 30;
    worksheet.getCell('A10').value = 'Void ratio';
    applyCellStyle(worksheet.getCell('A10'), { fill: BRAND.paleBlue, font: { name: 'Arial', size: 8, bold: true, color: { argb: BRAND.dark } } });
    worksheet.getCell('B10').value = asNumber(session.voidRatio, 1);
    applyCellStyle(worksheet.getCell('B10'), { fill: BRAND.white, alignment: { horizontal: 'center', vertical: 'middle' }, numFmt: '0.00' });
    worksheet.getCell('B10').dataValidation = {
      type: 'list', allowBlank: false, formulae: ['"1.00,0.30"'],
      showInputMessage: true, promptTitle: 'Void ratio', prompt: '1.00 = open pit; 0.30 = single-size stone',
      showErrorMessage: true, errorStyle: 'stop', errorTitle: 'Select a void ratio',
      error: 'Choose either 1.00 (open pit) or 0.30 (single-size stone).',
    };
    worksheet.getCell('C10').value = 'Strata description';
    applyCellStyle(worksheet.getCell('C10'), { fill: BRAND.paleBlue, font: { name: 'Arial', size: 8, bold: true, color: { argb: BRAND.dark } } });
    mergeValue(worksheet, 'D10:H10', session.strataDescription ? String(session.strataDescription) : null, {
      fill: BRAND.white, font: { name: 'Arial', size: 8, color: { argb: BRAND.dark } },
      alignment: { horizontal: 'left', vertical: 'middle', wrapText: false },
    });
    worksheet.getCell('I10').value = 'Pit details';
    applyCellStyle(worksheet.getCell('I10'), { fill: BRAND.paleBlue, font: { name: 'Arial', size: 8, bold: true, color: { argb: BRAND.dark } } });
    mergeValue(worksheet, 'J10:M10', session.pitDetails ? String(session.pitDetails) : null, {
      fill: BRAND.white, font: { name: 'Arial', size: 8, color: { argb: BRAND.dark } },
      alignment: { horizontal: 'left', vertical: 'middle', wrapText: false },
    });
    worksheet.getCell('A11').value = 'Stone fill depth (mm)';
    applyCellStyle(worksheet.getCell('A11'), { fill: BRAND.paleBlue, font: { name: 'Arial', size: 8, bold: true, color: { argb: BRAND.dark } } });
    worksheet.getCell('B11').value = asNumber(session.stoneFillDepth, asNumber(session.depthExcavation, 0));
    applyCellStyle(worksheet.getCell('B11'), { fill: BRAND.white, alignment: { horizontal: 'center', vertical: 'middle' }, numFmt: '0' });
    worksheet.getCell('B11').dataValidation = {
      type: 'decimal', operator: 'between', allowBlank: true, formulae: [0, '$J$9'],
      showInputMessage: true, promptTitle: 'Stone fill depth',
      prompt: 'Depth of stone measured upward from the pit base.',
      showErrorMessage: true, errorStyle: 'stop', errorTitle: 'Invalid stone depth',
      error: 'Enter a value from 0 to the excavation depth in J9.',
    };
    worksheet.getRow(10).height = 20;
    mergeValue(worksheet, 'C11:M11', 'One construction graphic is shared by all grouped runs. Its water level uses the first selected run.', {
      fill: BRAND.paleBlue, font: { name: 'Arial', size: 8, italic: true, color: { argb: BRAND.dark } },
      alignment: { horizontal: 'left', vertical: 'middle', wrapText: false },
    });
    worksheet.getRow(11).height = 20;

    const graphBlocks = [[7, 13], [1, 6], [7, 13]];
    mergeValue(worksheet, 'A12:F12', 'TEST PIT CONSTRUCTION', {
      fill: BRAND.section,
      font: { name: 'Arial', size: 10, bold: true, color: { argb: BRAND.white } },
      alignment: { horizontal: 'center', vertical: 'middle' },
    });
    contexts.forEach((context, index) => {
      const [startColumn, endColumn] = graphBlocks[index];
      const headerRow = index === 0 ? 12 : 25;
      mergeValue(worksheet, `${columnLetter(startColumn)}${headerRow}:${columnLetter(endColumn)}${headerRow}`, `${testLabels[index]} — HEAD OF WATER AGAINST TIME`, {
        fill: BRAND.section,
        font: { name: 'Arial', size: 8, bold: true, color: { argb: BRAND.white } },
        alignment: { horizontal: 'center', vertical: 'middle' },
      });
    });
    for (let row = 13; row <= 24; row += 1) worksheet.getRow(row).height = 18;
    for (let row = 26; row <= 36; row += 1) worksheet.getRow(row).height = 17;
    worksheet.getRow(37).height = 6;

    const dimensionText = value => (Number.isFinite(value) ? `${Math.round(value)}mm` : '');
    const chartLabels = {
      topLength: dimensionText(asNumber(session.lengthTop, NaN)),
      topWidth: dimensionText(asNumber(session.widthTop, NaN)),
      excavationDepth: dimensionText(asNumber(session.depthExcavation, NaN)),
      headOfWater: Number.isFinite(first.results.initialHead) ? `Head of water\n${Math.round(first.results.initialHead)}mm` : 'Head of water',
      bottomWidth: dimensionText(asNumber(session.widthBottom || session.widthTop, NaN)),
      bottomLength: dimensionText(asNumber(session.lengthBottom || session.lengthTop, NaN)),
    };
    const pitDimensions = {
      lengthTop: asNumber(session.lengthTop, NaN),
      lengthBottom: asNumber(session.lengthBottom || session.lengthTop, NaN),
      widthTop: asNumber(session.widthTop, NaN),
      widthBottom: asNumber(session.widthBottom || session.widthTop, NaN),
      depthExcavation: asNumber(session.depthExcavation, NaN),
      initialHead: first.results.initialHead,
      voidRatio: asNumber(session.voidRatio, 1),
      stoneDepth: asNumber(session.stoneFillDepth, asNumber(session.depthExcavation, 0)),
    };
    const groupedLabelCells = ['$AF$13', '$AF$14', '$AF$15', '$AF$16', '$AF$17', '$AF$18'];
    const groupedLabelSources = [
      [13, '=TEXT($B$9,"0")&"mm"', chartLabels.topLength],
      [14, '=TEXT($F$9,"0")&"mm"', chartLabels.topWidth],
      [15, '=TEXT($J$9,"0")&"mm"', chartLabels.excavationDepth],
      [16, '="Head of water"&CHAR(10)&TEXT($L$9,"0")&"mm"', chartLabels.headOfWater],
      [17, '=TEXT($H$9,"0")&"mm"', chartLabels.bottomWidth],
      [18, '=TEXT($D$9,"0")&"mm"', chartLabels.bottomLength],
    ];
    groupedLabelSources.forEach(([row, formula, result]) => {
      worksheet.getCell(`AE${row}`).value = `Pit label ${row - 12}`;
      worksheet.getCell(`AF${row}`).value = formulaValue(formula, result);
      worksheet.getCell(`AF${row}`).protection = { locked: true };
    });
    const pitChartSeries = buildPitChartModel(worksheet, name, pitDimensions, chartLabels, {
      labelCells: groupedLabelCells,
      stoneDepthCell: '$B$11',
    });

    const appendixHeadings = ['No.', 'Date', 'Clock time', 'Time (mins)', 'Depth to water (mm)', 'Head of water (mm)'];
    const writeAppendixPoint = (context, pointIndex, rowNumber, startColumn) => {
      const point = context.points[pointIndex];
      const timestamp = point && point.timestamp ? new Date(point.timestamp) : null;
      const depthAddress = worksheet.getCell(rowNumber, startColumn + 4).address;
      const head = point ? context.results.excavation - point.depth : null;
      const values = point ? [
        pointIndex + 1,
        timestamp || null,
        timestamp || point.clockTime || null,
        point.time,
        point.depth,
        formulaValue(`=IF(${depthAddress}="","",$J$9-${depthAddress})`, head),
      ] : [null, null, null, null, null, null];
      values.forEach((value, offset) => {
        const cell = worksheet.getCell(rowNumber, startColumn + offset);
        cell.value = value;
        applyCellStyle(cell, {
          fill: offset === 5 ? BRAND.paleBlue : BRAND.white,
          font: { name: 'Arial', size: 8, color: { argb: BRAND.dark } },
          alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
          numFmt: offset === 1 ? 'dd/mm/yyyy' : offset === 2 && timestamp ? 'hh:mm:ss' : offset >= 3 ? '0.00' : undefined,
        });
        cell.protection = { locked: !point || offset === 0 || offset === 5 };
      });
      if (point) {
        context.sources[pointIndex] = {
          date: worksheet.getCell(rowNumber, startColumn + 1).address,
          clock: worksheet.getCell(rowNumber, startColumn + 2).address,
          time: worksheet.getCell(rowNumber, startColumn + 3).address,
          depth: worksheet.getCell(rowNumber, startColumn + 4).address,
          head: worksheet.getCell(rowNumber, startColumn + 5).address,
        };
      }
    };

    let appendixPageIndex = 0;
    contexts.forEach(context => {
      const pageCount = Math.max(1, Math.ceil(context.points.length / appendixPageCapacity));
      for (let testPageIndex = 0; testPageIndex < pageCount; testPageIndex += 1) {
        const startRow = appendixFirstRow + appendixPageIndex * appendixPageHeight;
        const pointOffset = testPageIndex * appendixPageCapacity;
        addLogo(startRow);
        mergeValue(worksheet, `D${startRow}:M${startRow + 1}`, 'SOAKAWAY INFILTRATION TEST REPORT — COMPLETE RECORDED DATA', {
          border: false,
          font: { name: 'Arial', size: 14, bold: true, color: { argb: BRAND.navy } },
          alignment: { horizontal: 'right', vertical: 'middle' },
        });
        mergeValue(worksheet, `D${startRow + 2}:M${startRow + 3}`, `${locationId} — ${testLabels[context.index]} — DATA PAGE ${testPageIndex + 1} OF ${pageCount}`, {
          border: false,
          font: { name: 'Arial', size: 11, bold: true, color: { argb: BRAND.blue } },
          alignment: { horizontal: 'right', vertical: 'top' },
        });
        [startRow, startRow + 1].forEach(row => { worksheet.getRow(row).height = 27; });
        [startRow + 2, startRow + 3].forEach(row => { worksheet.getRow(row).height = 20; });
        mergeValue(worksheet, `A${startRow + 4}:M${startRow + 4}`, 'TEST DETAILS', {
          fill: BRAND.section, font: { name: 'Arial', size: 10, bold: true, color: { argb: BRAND.white } },
          alignment: { horizontal: 'center', vertical: 'middle' },
        });
        const contextDate = context.points.find(point => point.timestamp)?.timestamp;
        const detailRows = [
          [`A${startRow + 5}`, 'Location ID', `B${startRow + 5}:D${startRow + 5}`, locationId],
          [`E${startRow + 5}`, 'Test Number', `F${startRow + 5}:G${startRow + 5}`, safeSheetText(context.session.testNumber)],
          [`H${startRow + 5}`, 'Date of Test', `I${startRow + 5}:J${startRow + 5}`, contextDate ? new Date(contextDate) : ''],
          [`K${startRow + 5}`, 'Logged By', `L${startRow + 5}:M${startRow + 5}`, formulaValue('=IF($M$6="","",$M$6)', '')],
          [`A${startRow + 6}`, 'Site / Project', `B${startRow + 6}:G${startRow + 6}`, formulaValue('=IF($B$7="","",$B$7)', '')],
          [`H${startRow + 6}`, 'Checked By', `I${startRow + 6}:M${startRow + 6}`, formulaValue('=IF($J$7="","",$J$7)', '')],
        ];
        detailRows.forEach(([labelCell, label, valueRange, value]) => {
          worksheet.getCell(labelCell).value = label;
          applyCellStyle(worksheet.getCell(labelCell), { fill: BRAND.paleBlue, font: { name: 'Arial', size: 8, bold: true, color: { argb: BRAND.dark } } });
          const target = mergeValue(worksheet, valueRange, value, { fill: BRAND.white, font: { name: 'Arial', size: 9, color: { argb: BRAND.dark } } });
          if (label === 'Date of Test') target.numFmt = 'dd/mm/yyyy';
        });
        worksheet.getRow(startRow + 5).height = 22;
        worksheet.getRow(startRow + 6).height = 22;
        mergeValue(worksheet, `A${startRow + 7}:M${startRow + 7}`, 'TEST PIT PARAMETERS', {
          fill: BRAND.section, font: { name: 'Arial', size: 10, bold: true, color: { argb: BRAND.white } },
          alignment: { horizontal: 'center', vertical: 'middle' },
        });
        const parameterRow = startRow + 8;
        const linkedParameters = [
          ['A', 'Length at top (mm)', 'B', '=$B$9', asNumber(session.lengthTop, null)],
          ['C', 'Length at bottom (mm)', 'D', '=$D$9', asNumber(session.lengthBottom || session.lengthTop, null)],
          ['E', 'Width at top (mm)', 'F', '=$F$9', asNumber(session.widthTop, null)],
          ['G', 'Width at bottom (mm)', 'H', '=$H$9', asNumber(session.widthBottom || session.widthTop, null)],
          ['I', 'Excavation depth (mm)', 'J', '=$J$9', asNumber(session.depthExcavation, null)],
          ['K', 'Initial head (mm)', 'L', `=$${columnLetter(34 + context.index * 3 + 2)}$1`, context.results.initialHead],
        ];
        linkedParameters.forEach(([labelColumn, label, valueColumn, formula, result]) => {
          worksheet.getCell(`${labelColumn}${parameterRow}`).value = label;
          applyCellStyle(worksheet.getCell(`${labelColumn}${parameterRow}`), { fill: BRAND.paleBlue, font: { name: 'Arial', size: 8, bold: true, color: { argb: BRAND.dark } } });
          worksheet.getCell(`${valueColumn}${parameterRow}`).value = formulaValue(formula, result);
          applyCellStyle(worksheet.getCell(`${valueColumn}${parameterRow}`), { fill: BRAND.white, alignment: { horizontal: 'center', vertical: 'middle' }, numFmt: '0.00' });
        });
        worksheet.getCell(`M${parameterRow}`).value = 'mm';
        applyCellStyle(worksheet.getCell(`M${parameterRow}`), { fill: BRAND.paleBlue, alignment: { horizontal: 'center', vertical: 'middle' } });
        worksheet.getRow(parameterRow).height = 30;
        const parameterSecondRow = startRow + 9;
        worksheet.getCell(`A${parameterSecondRow}`).value = 'Void ratio';
        applyCellStyle(worksheet.getCell(`A${parameterSecondRow}`), { fill: BRAND.paleBlue, font: { name: 'Arial', size: 8, bold: true, color: { argb: BRAND.dark } } });
        worksheet.getCell(`B${parameterSecondRow}`).value = formulaValue('=$B$10', asNumber(session.voidRatio, 1));
        applyCellStyle(worksheet.getCell(`B${parameterSecondRow}`), { fill: BRAND.white, alignment: { horizontal: 'center', vertical: 'middle' }, numFmt: '0.00' });
        worksheet.getCell(`C${parameterSecondRow}`).value = 'Strata description';
        applyCellStyle(worksheet.getCell(`C${parameterSecondRow}`), { fill: BRAND.paleBlue, font: { name: 'Arial', size: 8, bold: true, color: { argb: BRAND.dark } } });
        mergeValue(worksheet, `D${parameterSecondRow}:H${parameterSecondRow}`, formulaValue('=IF($D$10="","",$D$10)', session.strataDescription || ''), { fill: BRAND.white, font: { name: 'Arial', size: 8, color: { argb: BRAND.dark } }, alignment: { horizontal: 'left', vertical: 'middle' } });
        worksheet.getCell(`I${parameterSecondRow}`).value = 'Pit details';
        applyCellStyle(worksheet.getCell(`I${parameterSecondRow}`), { fill: BRAND.paleBlue, font: { name: 'Arial', size: 8, bold: true, color: { argb: BRAND.dark } } });
        mergeValue(worksheet, `J${parameterSecondRow}:M${parameterSecondRow}`, formulaValue('=IF($J$10="","",$J$10)', session.pitDetails || ''), { fill: BRAND.white, font: { name: 'Arial', size: 8, color: { argb: BRAND.dark } }, alignment: { horizontal: 'left', vertical: 'middle' } });
        worksheet.getRow(parameterSecondRow).height = 20;
        worksheet.getRow(startRow + 10).height = 6;
        mergeValue(worksheet, `A${startRow + 11}:M${startRow + 11}`, `${testLabels[context.index]} — COMPLETE SITE RECORDED DATA — ${context.points.length} READINGS`, {
          fill: BRAND.section, font: { name: 'Arial', size: 10, bold: true, color: { argb: BRAND.white } },
          alignment: { horizontal: 'center', vertical: 'middle' },
        });
        [1, 8].forEach(startColumn => appendixHeadings.forEach((heading, offset) => {
          const cell = worksheet.getCell(startRow + 12, startColumn + offset);
          cell.value = heading;
          applyCellStyle(cell, { fill: BRAND.section, font: { name: 'Arial', size: 7, bold: true, color: { argb: BRAND.white } }, alignment: { horizontal: 'center', vertical: 'middle', wrapText: true } });
        }));
        worksheet.getCell(startRow + 12, 7).fill = fill(BRAND.white);
        worksheet.getCell(startRow + 12, 7).border = {};
        worksheet.getRow(startRow + 12).height = 30;
        for (let localIndex = 0; localIndex < 42; localIndex += 1) {
          const rowNumber = startRow + 13 + localIndex;
          writeAppendixPoint(context, pointOffset + localIndex, rowNumber, 1);
          writeAppendixPoint(context, pointOffset + 42 + localIndex, rowNumber, 8);
          worksheet.getCell(rowNumber, 7).fill = fill(BRAND.white);
          worksheet.getCell(rowNumber, 7).border = {};
          worksheet.getRow(rowNumber).height = 15;
        }
        appendixPageIndex += 1;
      }
    });
    for (let pageIndex = 0; pageIndex < totalAppendixPages; pageIndex += 1) {
      worksheet.getRow(56 + pageIndex * appendixPageHeight).addPageBreak();
    }
    worksheet.getRow(56).height = 6;

    const drainageArtifacts = [];
    const manualInputRanges = [];
    const analysisBlocks = [
      { start: 1, labelEnd: 2, valueStart: 3, valueEnd: 4 },
      { start: 5, labelEnd: 6, valueStart: 7, valueEnd: 8 },
      { start: 9, labelEnd: 11, valueStart: 12, valueEnd: 13 },
    ];
    contexts.forEach((context, index) => {
      const helperStartColumn = 34 + index * 3;
      const timeColumn = columnLetter(helperStartColumn);
      const depthColumn = columnLetter(helperStartColumn + 1);
      const headColumn = columnLetter(helperStartColumn + 2);
      [helperStartColumn, helperStartColumn + 1, helperStartColumn + 2].forEach(column => { worksheet.getColumn(column).hidden = true; });
      context.points.forEach((point, pointIndex) => {
        const helperRow = pointIndex + 1;
        const source = context.sources[pointIndex];
        const head = context.results.excavation - point.depth;
        worksheet.getCell(`${timeColumn}${helperRow}`).value = formulaValue(`=${source.time}`, point.time);
        worksheet.getCell(`${depthColumn}${helperRow}`).value = formulaValue(`=${source.depth}`, point.depth);
        worksheet.getCell(`${headColumn}${helperRow}`).value = formulaValue(`=${source.head}`, head);
        [timeColumn, depthColumn, headColumn].forEach(column => {
          worksheet.getCell(`${column}${helperRow}`).numFmt = '0.00';
          worksheet.getCell(`${column}${helperRow}`).protection = { locked: true };
        });
      });
      if (!context.points.length) [timeColumn, depthColumn, headColumn].forEach(column => {
        worksheet.getCell(`${column}1`).value = null;
        worksheet.getCell(`${column}1`).protection = { locked: true };
      });
      const sourceLastRow = Math.max(context.points.length, 1);
      const cross75Column = columnLetter(44 + index * 2);
      const cross25Column = columnLetter(45 + index * 2);
      worksheet.getColumn(44 + index * 2).hidden = true;
      worksheet.getColumn(45 + index * 2).hidden = true;
      for (let pointIndex = 1; pointIndex < sourceLastRow; pointIndex += 1) {
        const row = pointIndex + 1;
        const previousHead = context.results.excavation - context.points[pointIndex - 1].depth;
        const currentHead = context.results.excavation - context.points[pointIndex].depth;
        const cross75 = previousHead >= context.results.level75 && currentHead <= context.results.level75
          ? context.points[pointIndex - 1].time + ((previousHead - context.results.level75) * (context.points[pointIndex].time - context.points[pointIndex - 1].time)) / (previousHead - currentHead || 1)
          : null;
        const cross25 = previousHead >= context.results.level25 && currentHead <= context.results.level25
          ? context.points[pointIndex - 1].time + ((previousHead - context.results.level25) * (context.points[pointIndex].time - context.points[pointIndex - 1].time)) / (previousHead - currentHead || 1)
          : null;
        const level75ValueCell = `${columnLetter(analysisBlocks[index].valueStart)}41`;
        const level25ValueCell = `${columnLetter(analysisBlocks[index].valueStart)}42`;
        worksheet.getCell(`${cross75Column}${row}`).value = formulaValue(`=IF(AND($${headColumn}$${row - 1}>=${level75ValueCell},$${headColumn}$${row}<=${level75ValueCell},$${headColumn}$${row - 1}<>$${headColumn}$${row}),$${timeColumn}$${row - 1}+($${headColumn}$${row - 1}-${level75ValueCell})*($${timeColumn}$${row}-$${timeColumn}$${row - 1})/($${headColumn}$${row - 1}-$${headColumn}$${row}),"")`, cross75);
        worksheet.getCell(`${cross25Column}${row}`).value = formulaValue(`=IF(AND($${headColumn}$${row - 1}>=${level25ValueCell},$${headColumn}$${row}<=${level25ValueCell},$${headColumn}$${row - 1}<>$${headColumn}$${row}),$${timeColumn}$${row - 1}+($${headColumn}$${row - 1}-${level25ValueCell})*($${timeColumn}$${row}-$${timeColumn}$${row - 1})/($${headColumn}$${row - 1}-$${headColumn}$${row}),"")`, cross25);
      }

      const block = analysisBlocks[index];
      const labelStart = columnLetter(block.start);
      const labelEnd = columnLetter(block.labelEnd);
      const valueStart = columnLetter(block.valueStart);
      const valueEnd = columnLetter(block.valueEnd);
      const manualRateRequired = requiresManualInfiltrationRate(context.points, context.results);
      const selectedWaterLevel1 = `${valueStart}${manualRateRequired ? 43 : 41}`;
      const selectedWaterLevel2 = `${valueStart}${manualRateRequired ? 44 : 42}`;
      const manualVolumeDischargedFormula = `=IF(OR(${valueStart}43="",${valueStart}44=""),"",AVERAGE($B$9*$F$9,$D$9*$H$9)/1000000*ABS(${valueStart}43-${valueStart}44)/1000*$B$10)`;
      if (manualRateRequired) manualInputRanges.push(`${valueStart}43:${valueEnd}45`);
      mergeValue(worksheet, `${labelStart}38:${valueEnd}38`, `BRE 365 DATA ANALYSIS — ${testLabels[index]}`, {
        fill: BRAND.section, font: { name: 'Arial', size: 8, bold: true, color: { argb: BRAND.white } },
        alignment: { horizontal: 'center', vertical: 'middle' },
      });
      const initialFormula = `=IFERROR($J$9-$${depthColumn}$1,"")`;
      const rows = [
        [39, 'Initial head (mm)', initialFormula, context.results.initialHead, '0.00'],
        [40, 'Minimum head (mm)', `=IF(COUNT($${headColumn}$1:$${headColumn}$${sourceLastRow})=0,"",MIN($${headColumn}$1:$${headColumn}$${sourceLastRow}))`, context.results.minimumHead, '0.00'],
        [41, '75% water level (mm)', `=${valueStart}39*0.75`, context.results.level75, '0.00'],
        [42, '25% water level (mm)', `=${valueStart}39*0.25`, context.results.level25, '0.00'],
        [43, manualRateRequired ? 'User chosen Water Level 1 (mm)' : 'Time at 75% (mins)', manualRateRequired ? null : `=IF(COUNT($${cross75Column}$1:$${cross75Column}$${sourceLastRow})=0,"",MAX($${cross75Column}$1:$${cross75Column}$${sourceLastRow}))`, manualRateRequired ? null : context.results.time75, '0.00', manualRateRequired],
        [44, manualRateRequired ? 'User chosen Water Level 2 (mm)' : 'Time at 25% (mins)', manualRateRequired ? null : `=IF(COUNT($${cross25Column}$1:$${cross25Column}$${sourceLastRow})=0,"",MAX($${cross25Column}$1:$${cross25Column}$${sourceLastRow}))`, manualRateRequired ? null : context.results.time25, '0.00', manualRateRequired],
        [45, manualRateRequired ? 'Time to drain from Water Level 1 to 2 (mins)' : 'Drain time (mins)', manualRateRequired ? null : `=IF(OR(${valueStart}43="",${valueStart}44=""),"",${valueStart}44-${valueStart}43)`, manualRateRequired ? null : context.results.drainTime, '0.00', manualRateRequired],
        [46, 'Factored volume (m³)', `=AVERAGE($B$9*$F$9,$D$9*$H$9)/1000000*${valueStart}39/1000*$B$10`, context.results.factoredVolume, '0.000000'],
        [47, 'Water discharged (m³)', manualRateRequired ? manualVolumeDischargedFormula : `=${valueStart}46*0.5`, manualRateRequired ? null : context.results.volumeDischarged, '0.000000'],
        [48, 'Discharge area (m²)', manualRateRequired
          ? `=IF(OR(${selectedWaterLevel1}="",${selectedWaterLevel2}=""),"",((2*AVERAGE($B$9,$D$9)+2*AVERAGE($F$9,$H$9))/1000)*AVERAGE(${selectedWaterLevel1},${selectedWaterLevel2})/1000+($D$9*$H$9/1000000))`
          : `=((2*AVERAGE($B$9,$D$9)+2*AVERAGE($F$9,$H$9))/1000)*AVERAGE(${selectedWaterLevel1},${selectedWaterLevel2})/1000+($D$9*$H$9/1000000)`, manualRateRequired ? null : context.results.dischargeArea, '0.000000'],
        [50, 'Infiltration rate (m/min)', `=IFERROR(${valueStart}47/${valueStart}48/${valueStart}45,"")`, manualRateRequired ? null : context.results.infiltrationMMin, '0.000E+00'],
        [51, 'Infiltration rate (m/sec)', `=IF(${valueStart}50="","",${valueStart}50/60)`, manualRateRequired ? null : context.results.infiltrationMSec, '0.000E+00'],
      ];
      rows.forEach(([row, label, formula, result, format, isManualInput = false]) => {
        const highlight = row >= 50;
        mergeValue(worksheet, `${labelStart}${row}:${labelEnd}${row}`, label, {
          fill: highlight ? BRAND.navy : BRAND.paleBlue,
          font: { name: 'Arial', size: 7, bold: true, color: { argb: highlight ? BRAND.white : BRAND.dark } },
          alignment: { horizontal: 'left', vertical: 'middle', wrapText: true },
        });
        mergeValue(worksheet, `${valueStart}${row}:${valueEnd}${row}`, formula ? formulaValue(formula, result) : null, {
          fill: isManualInput ? BRAND.manualInput : highlight ? BRAND.paleGreen : BRAND.white,
          font: { name: 'Arial', size: highlight ? 9 : 8, bold: highlight, color: { argb: BRAND.dark } },
          alignment: { horizontal: 'right', vertical: 'middle' }, numFmt: format,
        });
      });
      mergeValue(worksheet, `${labelStart}53:${labelEnd}54`, 'BRE 365 COMPLIANCE', {
        fill: BRAND.section, font: { name: 'Arial', size: 7, bold: true, color: { argb: BRAND.white } },
        alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
      });
      const complianceFormula = `=IF(COUNT($${headColumn}$1:$${headColumn}$${sourceLastRow})=0,"No readings recorded",IF(${valueStart}40<=${valueStart}42,"Compliant with BRE 365","Not compliant - test did not drain past 25% effective depth"))`;
      mergeValue(worksheet, `${valueStart}53:${valueEnd}54`, formulaValue(complianceFormula, context.results.compliance), {
        fill: context.results.compliance.startsWith('Compliant') ? BRAND.paleGreen : BRAND.paleRed,
        font: { name: 'Arial', size: 7, bold: true, color: { argb: BRAND.dark } },
        alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
      });

      const thresholdRow = 13 + index * 3;
      const chartTimes = context.points.map(point => point.time);
      const chartMinTime = chartTimes.length ? Math.min(...chartTimes) : 0;
      const chartMaxTime = chartTimes.length ? Math.max(...chartTimes) : 1;
      worksheet.getCell(`S${thresholdRow}`).value = formulaValue(`=IF(COUNT($${timeColumn}$1:$${timeColumn}$${sourceLastRow})=0,0,MIN($${timeColumn}$1:$${timeColumn}$${sourceLastRow}))`, chartMinTime);
      worksheet.getCell(`S${thresholdRow + 1}`).value = formulaValue(`=IF(COUNT($${timeColumn}$1:$${timeColumn}$${sourceLastRow})=0,1,MAX($${timeColumn}$1:$${timeColumn}$${sourceLastRow}))`, chartMaxTime);
      worksheet.getCell(`T${thresholdRow}`).value = formulaValue(`=${valueStart}41`, context.results.level75);
      worksheet.getCell(`T${thresholdRow + 1}`).value = formulaValue(`=${valueStart}41`, context.results.level75);
      worksheet.getCell(`U${thresholdRow}`).value = formulaValue(`=${valueStart}42`, context.results.level25);
      worksheet.getCell(`U${thresholdRow + 1}`).value = formulaValue(`=${valueStart}42`, context.results.level25);
      const bandColumns = [['V', 'W'], ['X', 'Y'], ['Z', 'AA']][index];
      const drainageBand = { startRow: 10000, endRow: 10000, xValues: [], yValues: [], xRange: '', yRange: '' };
      let bandRow = drainageBand.startRow;
      for (let stripe = 0; stripe < 128; stripe += 1) {
        const ratio = stripe / 127;
        const xValue = chartMinTime + (chartMaxTime - chartMinTime) * ratio;
        const xFormula = `=$S$${thresholdRow}+($S$${thresholdRow + 1}-$S$${thresholdRow})*${ratio}`;
        [[xFormula, `=$U$${thresholdRow}`, xValue, context.results.level25], [xFormula, `=$T$${thresholdRow}`, xValue, context.results.level75], ['=NA()', '=NA()', NaN, NaN]].forEach(([xFormulaText, yFormulaText, xResult, yResult]) => {
          worksheet.getCell(`${bandColumns[0]}${bandRow}`).value = formulaValue(xFormulaText, xResult);
          worksheet.getCell(`${bandColumns[1]}${bandRow}`).value = formulaValue(yFormulaText, yResult);
          drainageBand.xValues.push(xResult);
          drainageBand.yValues.push(yResult);
          bandRow += 1;
        });
      }
      drainageBand.endRow = bandRow - 1;
      drainageBand.xRange = `$${bandColumns[0]}$${drainageBand.startRow}:$${bandColumns[0]}$${drainageBand.endRow}`;
      drainageBand.yRange = `$${bandColumns[1]}$${drainageBand.startRow}:$${bandColumns[1]}$${drainageBand.endRow}`;
      drainageArtifacts.push({
        name, points: context.points, results: context.results, firstDataRow: 1, lastDataRow: sourceLastRow,
        chartTimeRange: `$${timeColumn}$1:$${timeColumn}$${sourceLastRow}`,
        chartHeadRange: `$${headColumn}$1:$${headColumn}$${sourceLastRow}`,
        thresholdTimeRange: `$S$${thresholdRow}:$S$${thresholdRow + 1}`,
        threshold75Range: `$T$${thresholdRow}:$T$${thresholdRow + 1}`,
        threshold25Range: `$U$${thresholdRow}:$U$${thresholdRow + 1}`,
        drainageBand,
      });
    });
    worksheet.getRow(38).height = 20;
    for (let row = 39; row <= 54; row += 1) worksheet.getRow(row).height = row === 49 || row === 52 ? 7 : 17;
    if (manualInputRanges.length) worksheet.getRow(45).height = 24;

    const setLocked = (address, locked) => {
      const [start, end = start] = address.split(':');
      const startCell = worksheet.getCell(start);
      const endCell = worksheet.getCell(end);
      for (let row = startCell.row; row <= endCell.row; row += 1) {
        for (let column = startCell.col; column <= endCell.col; column += 1) worksheet.getCell(row, column).protection = { locked };
      }
    };
    ['M6', 'B7:H7', 'J7:M7', 'B9', 'D9', 'F9', 'H9', 'J9', 'B10', 'D10:H10', 'J10:M10', 'B11'].forEach(address => setLocked(address, false));
    manualInputRanges.forEach(address => setLocked(address, false));
    await worksheet.protect('', {
      spinCount: 1000, selectLockedCells: true, selectUnlockedCells: true,
      autoFilter: true, objects: false, scenarios: true,
    });
    worksheet.views = [{ showGridLines: false, zoomScale: 78 }];
    const pitArtifact = { name, chartLabels, pitDimensions, pitChartSeries };
    const nativeCharts = [
      { kind: 'pit', name: 'Shared test pit construction', artifact: pitArtifact, fromColumn: 0, fromRow: 12, toColumn: 6, toRow: 24 },
      { kind: 'drainage', name: `${testLabels[0]} head of water against time`, artifact: drainageArtifacts[0], fromColumn: 6, fromRow: 12, toColumn: 13, toRow: 24 },
      { kind: 'drainage', name: `${testLabels[1]} head of water against time`, artifact: drainageArtifacts[1], fromColumn: 0, fromRow: 25, toColumn: 6, toRow: 36 },
      ...(drainageArtifacts[2] ? [{ kind: 'drainage', name: `${testLabels[2]} head of water against time`, artifact: drainageArtifacts[2], fromColumn: 6, fromRow: 25, toColumn: 13, toRow: 36 }] : []),
    ];
    return {
      worksheet, name, sessions, contexts, footerRow, pitArtifact, drainageArtifacts, nativeCharts,
      grouped: true, appendixPageCount: totalAppendixPages,
    };
  }

  function downloadBuffer(buffer, filename) {
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  async function buildWorkbook(rawSessions, options = {}) {
    if (!window.ExcelJS) throw new Error('Excel report library did not load. Reload the app and try again.');
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    const sessions = rawSessions.filter(hasReportData).sort((left, right) => {
      const locationCompare = collator.compare(String(left.locationId || ''), String(right.locationId || ''));
      return locationCompare || collator.compare(String(left.testNumber || ''), String(right.testNumber || ''));
    });
    if (!sessions.length) throw new Error('No test data is available to export.');

    const workbook = new window.ExcelJS.Workbook();
    workbook.creator = 'Brownfield Solutions Soakaway Logger v4';
    workbook.lastModifiedBy = 'Brownfield Solutions Soakaway Logger v4';
    workbook.created = new Date();
    workbook.modified = new Date();
    workbook.calcProperties.fullCalcOnLoad = true;
    workbook.calcProperties.forceFullCalc = true;
    const logoBase64 = await loadReportLogoBase64();
    const grouped = Boolean(options.groupSameLocation);
    const names = grouped
      ? [`${groupedLocationId(sessions)} - Grouped Tests`.slice(0, 31)]
      : buildSheetNames(sessions);
    const artifacts = [];
    if (grouped) {
      artifacts.push(await buildGroupedWorksheet(workbook, sessions, names[0], logoBase64));
    } else {
      for (let index = 0; index < sessions.length; index += 1) {
        artifacts.push(await buildWorksheet(workbook, sessions[index], names[index], logoBase64));
      }
    }
    return { workbook, sessions, names, artifacts, grouped };
  }

  async function buildAndDownload(rawSessions, options = {}) {
    const { workbook, sessions, artifacts } = await buildWorkbook(rawSessions, options);
    const excelJsBuffer = await workbook.xlsx.writeBuffer();
    const buffer = await addNativeChartsToBuffer(excelJsBuffer, artifacts);
    const locations = [...new Set(sessions.map(session => safeSheetText(session.locationId)).filter(Boolean))];
    const locationLabel = locations.length === 1 ? locations[0] : 'Multiple_Locations';
    const now = new Date();
    const pad = value => String(value).padStart(2, '0');
    const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
    const filename = `Soakaway_Report_${(locationLabel || 'Tests').replace(/[^\w.-]+/g, '_')}_${timestamp}.xlsx`;
    downloadBuffer(buffer, filename);
    return filename;
  }

  window.DepthLoggerExcel = {
    buildAndDownload,
    buildWorkbook,
    _test: { buildSheetNames, calculateResults, normalizePoints, crossingTime, requiresManualInfiltrationRate, hasReportData, columnLetter, groupedLocationId },
  };
})();
