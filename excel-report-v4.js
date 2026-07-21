(function () {
  'use strict';

  const BRAND = {
    navy: '234A5A',
    blue: '7EC3E3',
    section: '8DB4E2',
    paleBlue: 'DDEBF7',
    paleGreen: 'E2F0D9',
    paleRed: 'FCE4D6',
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
    return { formula, result: result == null || Number.isNaN(result) ? null : result };
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
    return `<c:numCache><c:formatCode>${xmlEscape(formatCode)}</c:formatCode><c:ptCount val="${points.length}"/>${points.map(point => `<c:pt idx="${point.index}"><c:v>${point.value}</c:v></c:pt>`).join('')}</c:numCache>`;
  }

  function referencedSeries(index, name, xFormula, xValues, yFormula, yValues, color, options = {}) {
    const marker = options.marker
      ? `<c:marker><c:symbol val="circle"/><c:size val="4"/><c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:ln></c:spPr></c:marker>`
      : '<c:marker><c:symbol val="none"/></c:marker>';
    const dash = options.dash ? `<a:prstDash val="${options.dash}"/>` : '<a:prstDash val="solid"/>';
    return `<c:ser><c:idx val="${index}"/><c:order val="${index}"/><c:tx><c:v>${xmlEscape(name)}</c:v></c:tx>${marker}<c:spPr><a:ln w="${options.width || 25400}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill>${dash}</a:ln></c:spPr><c:xVal><c:numRef><c:f>${xmlEscape(xFormula)}</c:f>${numberCache(xValues, '0.00')}</c:numRef></c:xVal><c:yVal><c:numRef><c:f>${xmlEscape(yFormula)}</c:f>${numberCache(yValues, '0.00')}</c:numRef></c:yVal><c:smooth val="0"/></c:ser>`;
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

  function chartTitleXml(title) {
    return '<c:autoTitleDeleted val="1"/>';
  }

  function axisTitleXml(title) {
    return `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-GB" sz="900"><a:solidFill><a:srgbClr val="1F2937"/></a:solidFill><a:latin typeface="Arial"/></a:rPr><a:t>${xmlEscape(title)}</a:t></a:r></a:p></c:rich></c:tx><c:layout/><c:overlay val="0"/></c:title>`;
  }

  function drainageChartXml(artifact, chartNumber) {
    const { name, points, results, firstDataRow, lastDataRow } = artifact;
    const times = points.map(point => point.time);
    const heads = points.map(point => results.excavation - point.depth);
    const minTime = times.length ? Math.min(...times) : 0;
    const maxTime = times.length ? Math.max(...times) : 1;
    const xAxisId = 70000000 + chartNumber * 10 + 1;
    const yAxisId = xAxisId + 1;
    const series = [
      referencedSeries(0, 'Head of water', chartFormula(name, `$C$${firstDataRow}:$C$${lastDataRow}`), times, chartFormula(name, `$E$${firstDataRow}:$E$${lastDataRow}`), heads, '00A651', { marker: true, width: 28575 }),
      referencedSeries(1, '75% effective depth', chartFormula(name, '$R$13:$R$14'), [minTime, maxTime], chartFormula(name, '$S$13:$S$14'), [results.level75, results.level75], 'C0504D', { width: 19050 }),
      referencedSeries(2, '25% effective depth', chartFormula(name, '$R$13:$R$14'), [minTime, maxTime], chartFormula(name, '$T$13:$T$14'), [results.level25, results.level25], '70AD47', { width: 19050 }),
    ].join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:date1904 val="0"/><c:lang val="en-GB"/><c:roundedCorners val="0"/><c:chart>${chartTitleXml('Head of water against time')}<c:plotArea><c:layout/><c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>${series}<c:dLbls><c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls><c:axId val="${xAxisId}"/><c:axId val="${yAxisId}"/></c:scatterChart><c:valAx><c:axId val="${xAxisId}"/><c:scaling><c:orientation val="minMax"/><c:min val="0"/></c:scaling><c:delete val="0"/><c:axPos val="b"/>${axisTitleXml('Time (minutes)')}<c:numFmt formatCode="0.0" sourceLinked="0"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln><a:solidFill><a:srgbClr val="234A5A"/></a:solidFill></a:ln></c:spPr><c:crossAx val="${yAxisId}"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/></c:valAx><c:valAx><c:axId val="${yAxisId}"/><c:scaling><c:orientation val="minMax"/><c:min val="0"/></c:scaling><c:delete val="0"/><c:axPos val="l"/>${axisTitleXml('Head of water (mm)')}<c:majorGridlines><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="DDEBF7"/></a:solidFill></a:ln></c:spPr></c:majorGridlines><c:numFmt formatCode="0" sourceLinked="0"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln><a:solidFill><a:srgbClr val="234A5A"/></a:solidFill></a:ln></c:spPr><c:crossAx val="${xAxisId}"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/></c:valAx></c:plotArea><c:legend><c:legendPos val="b"/><c:layout/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/><c:showDLblsOverMax val="0"/></c:chart><c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr><c:printSettings><c:headerFooter/><c:pageMargins b="0.75" l="0.7" r="0.7" t="0.75" header="0.3" footer="0.3"/><c:pageSetup/></c:printSettings></c:chartSpace>`;
  }

  function pitChartXml(artifact, chartNumber) {
    const { name, chartLabels } = artifact;
    const xAxisId = 80000000 + chartNumber * 10 + 1;
    const yAxisId = xAxisId + 1;
    const orange = 'F4B000';
    const dark = '1F2937';
    const blue = '7EC3E3';
    const series = [
      literalSeries(0, 'Top outline', [[2.2, 4.0], [3.5, 5.4], [8.3, 5.4], [7.2, 4.0], [2.2, 4.0]], orange, { width: 25400 }),
      literalSeries(1, 'Bottom outline', [[2.6, 1.0], [3.5, 2.0], [7.8, 2.0], [6.8, 1.0], [2.6, 1.0]], orange, { width: 19050 }),
      literalSeries(2, 'Front sides', [[2.2, 4.0], [2.6, 1.0]], orange),
      literalSeries(3, 'Front right side', [[7.2, 4.0], [6.8, 1.0]], orange),
      literalSeries(4, 'Back left side', [[3.5, 5.4], [3.5, 2.0]], orange, { dash: 'dash' }),
      literalSeries(5, 'Back right side', [[8.3, 5.4], [7.8, 2.0]], orange),
      literalSeries(6, 'Water surface front', [[2.4, 3.0], [7.0, 3.0]], blue, { width: 25400 }),
      literalSeries(7, 'Water surface back', [[3.4, 4.0], [8.0, 4.0]], blue, { width: 19050 }),
      literalSeries(8, 'Water surface left', [[2.4, 3.0], [3.4, 4.0]], blue, { width: 19050 }),
      literalSeries(9, 'Water surface right', [[7.0, 3.0], [8.0, 4.0]], blue, { width: 19050 }),
      literalSeries(10, 'Top length dimension', [[3.5, 5.85], [8.3, 5.85]], dark, { arrows: true, width: 12700 }),
      literalSeries(11, 'Depth dimension', [[1.75, 4.0], [1.75, 1.0]], dark, { arrows: true, width: 12700 }),
      literalSeries(12, 'Bottom length dimension', [[2.6, 0.55], [6.8, 0.55]], dark, { arrows: true, width: 12700 }),
      literalSeries(13, 'Top width dimension', [[7.35, 3.85], [8.35, 5.25]], dark, { arrows: true, width: 12700 }),
      literalSeries(14, 'Bottom width dimension', [[7.0, 0.75], [7.9, 1.8]], dark, { arrows: true, width: 12700 }),
      literalSeries(15, 'Water head dimension', [[8.65, 2.0], [8.65, 4.0]], blue, { arrows: true, width: 12700 }),
      literalLabelSeries(16, 'Top length label', [5.9, 5.85], chartFormula(name, '$Q$13'), chartLabels.topLength, 't', dark),
      literalLabelSeries(17, 'Top width label', [8.35, 5.2], chartFormula(name, '$Q$14'), chartLabels.topWidth, 'r', dark),
      literalLabelSeries(18, 'Excavation depth label', [1.75, 2.5], chartFormula(name, '$Q$15'), chartLabels.excavationDepth, 'l', dark),
      literalLabelSeries(19, 'Head of water label', [8.65, 3.0], chartFormula(name, '$Q$16'), chartLabels.headOfWater, 'r', blue),
      literalLabelSeries(20, 'Bottom width label', [7.9, 1.25], chartFormula(name, '$Q$17'), chartLabels.bottomWidth, 'r', dark),
      literalLabelSeries(21, 'Bottom length label', [4.7, 0.55], chartFormula(name, '$Q$18'), chartLabels.bottomLength, 'b', dark),
    ].join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:date1904 val="0"/><c:lang val="en-GB"/><c:roundedCorners val="0"/><c:chart><c:autoTitleDeleted val="1"/><c:plotArea><c:layout/><c:scatterChart><c:scatterStyle val="line"/><c:varyColors val="0"/>${series}<c:axId val="${xAxisId}"/><c:axId val="${yAxisId}"/></c:scatterChart><c:valAx><c:axId val="${xAxisId}"/><c:scaling><c:orientation val="minMax"/><c:max val="11.5"/><c:min val="0"/></c:scaling><c:delete val="1"/><c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="none"/><c:crossAx val="${yAxisId}"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/></c:valAx><c:valAx><c:axId val="${yAxisId}"/><c:scaling><c:orientation val="minMax"/><c:max val="6.2"/><c:min val="0"/></c:scaling><c:delete val="1"/><c:axPos val="l"/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="none"/><c:crossAx val="${xAxisId}"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/></c:valAx></c:plotArea><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/><c:showDLblsOverMax val="0"/></c:chart><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr><c:printSettings><c:headerFooter/><c:pageMargins b="0.75" l="0.7" r="0.7" t="0.75" header="0.3" footer="0.3"/><c:pageSetup/></c:printSettings></c:chartSpace>`;
  }

  function nativeChartAnchor(id, name, relationshipId, fromColumn, fromRow, toColumn, toRow) {
    return `<xdr:twoCellAnchor editAs="twoCell"><xdr:from><xdr:col>${fromColumn}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${fromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${toColumn}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${id}" name="${xmlEscape(name)}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/><a:ext cx="0" cy="0" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/></xdr:xfrm><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="${relationshipId}" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`;
  }

  async function addNativeChartsToBuffer(buffer, artifacts) {
    if (!window.JSZip) throw new Error('Excel chart packaging library did not load. Reload the app and try again.');
    const zip = await window.JSZip.loadAsync(buffer);
    let contentTypes = await zip.file('[Content_Types].xml').async('string');
    for (let index = 0; index < artifacts.length; index += 1) {
      const sheetNumber = index + 1;
      const pitChartNumber = index * 2 + 1;
      const drainageChartNumber = pitChartNumber + 1;
      const drawingPath = `xl/drawings/drawing${sheetNumber}.xml`;
      const relationshipsPath = `xl/drawings/_rels/drawing${sheetNumber}.xml.rels`;
      const drawingFile = zip.file(drawingPath);
      const relationshipsFile = zip.file(relationshipsPath);
      if (!drawingFile || !relationshipsFile) throw new Error(`Could not attach native charts to worksheet ${sheetNumber}.`);
      let drawingXml = await drawingFile.async('string');
      let relationshipsXml = await relationshipsFile.async('string');
      const pitRelationship = `rIdNativePit${sheetNumber}`;
      const drainageRelationship = `rIdNativeDrainage${sheetNumber}`;
      const anchors = nativeChartAnchor(100 + index * 2, 'Test pit construction', pitRelationship, 6, 12, 12, 22)
        + nativeChartAnchor(101 + index * 2, 'Head of water against time', drainageRelationship, 6, 24, 12, 35);
      drawingXml = drawingXml.replace('</xdr:wsDr>', `${anchors}</xdr:wsDr>`);
      const chartRelationships = `<Relationship Id="${pitRelationship}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${pitChartNumber}.xml"/><Relationship Id="${drainageRelationship}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${drainageChartNumber}.xml"/>`;
      relationshipsXml = relationshipsXml.replace('</Relationships>', `${chartRelationships}</Relationships>`);
      zip.file(drawingPath, drawingXml);
      zip.file(relationshipsPath, relationshipsXml);
      zip.file(`xl/charts/chart${pitChartNumber}.xml`, pitChartXml(artifacts[index], pitChartNumber));
      zip.file(`xl/charts/chart${drainageChartNumber}.xml`, drainageChartXml(artifacts[index], drainageChartNumber));
      contentTypes = contentTypes.replace('</Types>', `<Override PartName="/xl/charts/chart${pitChartNumber}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/><Override PartName="/xl/charts/chart${drainageChartNumber}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>`);
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
    const rowCount = Math.max(points.length, 43);
    const firstDataRow = 14;
    const lastDataRow = firstDataRow + rowCount - 1;
    const footerRow = Math.max(lastDataRow + 1, 57);
    const worksheet = workbook.addWorksheet(name, {
      views: [{ showGridLines: false, zoomScale: 85 }],
      properties: { defaultRowHeight: 15 },
    });

    worksheet.columns = [
      { width: 11 }, { width: 11 }, { width: 10 }, { width: 12 }, { width: 12 }, { width: 6 },
      { width: 18 }, { width: 8 }, { width: 8 }, { width: 12 }, { width: 8 }, { width: 10 }, { width: 11 },
      { width: 13, hidden: true }, { width: 13, hidden: true },
      { width: 20 }, { width: 24 }, { width: 12 }, { width: 12 }, { width: 12 },
    ];
    worksheet.pageSetup = {
      paperSize: 9,
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      horizontalCentered: true,
      verticalCentered: false,
      margins: { left: 0.25, right: 0.25, top: 0.3, bottom: 0.35, header: 0.1, footer: 0.15 },
      printArea: `A1:M${footerRow}`,
      showGridLines: false,
    };
    worksheet.headerFooter.oddFooter = `&L${safeSheetText(session.locationId) || 'Soakaway test'}&RPage &P of &N`;
    if (logoBase64) {
      const logoId = workbook.addImage({ base64: logoBase64, extension: 'png' });
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
      ['K9', 'Depth tested (mm)', 'L9', formulaValue(`=IFERROR($J$9-$D$${firstDataRow},"")`, results.initialHead)],
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

    mergeValue(worksheet, 'A12:F12', 'SITE RECORDED DATA', {
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
      headOfWater: Number.isFinite(results.initialHead) ? `Head of water\n${compactTestLabel(session.testNumber)} ${Math.round(results.initialHead)}mm` : 'Head of water',
      bottomWidth: dimensionText(asNumber(session.widthBottom || session.widthTop, NaN)),
      bottomLength: dimensionText(asNumber(session.lengthBottom || session.lengthTop, NaN)),
    };
    mergeValue(worksheet, 'P12:Q12', 'CHART LABEL SOURCES', {
      fill: BRAND.section,
      font: { name: 'Arial', size: 9, bold: true, color: { argb: BRAND.white } },
      alignment: { horizontal: 'center', vertical: 'middle' },
    });
    const labelSources = [
      [13, 'Length at top', '=TEXT($B$9,"0")&"mm"', chartLabels.topLength],
      [14, 'Width at top', '=TEXT($F$9,"0")&"mm"', chartLabels.topWidth],
      [15, 'Excavation depth', '=TEXT($J$9,"0")&"mm"', chartLabels.excavationDepth],
      [16, 'Head of water', '="Head of water"&CHAR(10)&IF(LEFT(LOWER($F$6),4)="test",$F$6,"Test "&$F$6)&" "&TEXT($L$9,"0")&"mm"', chartLabels.headOfWater],
      [17, 'Width at bottom', '=TEXT($H$9,"0")&"mm"', chartLabels.bottomWidth],
      [18, 'Length at bottom', '=TEXT($D$9,"0")&"mm"', chartLabels.bottomLength],
    ];
    labelSources.forEach(([row, label, formula, value]) => {
      worksheet.getCell(`P${row}`).value = label;
      applyCellStyle(worksheet.getCell(`P${row}`), { fill: BRAND.paleBlue, font: { name: 'Arial', size: 8, bold: true, color: { argb: BRAND.dark } } });
      worksheet.getCell(`Q${row}`).value = formulaValue(formula, value);
      applyCellStyle(worksheet.getCell(`Q${row}`), { fill: BRAND.white, font: { name: 'Arial', size: 9, color: { argb: BRAND.dark } }, alignment: { vertical: 'middle', wrapText: true } });
    });
    mergeValue(worksheet, 'P20:Q21', 'These cells sit outside the A:M print area. Change the white pit parameters in row 9 to update the plotted labels.', {
      fill: BRAND.paleBlue,
      font: { name: 'Arial', size: 8, italic: true, color: { argb: BRAND.dark } },
      alignment: { vertical: 'top', wrapText: true },
    });

    const chartTimes = points.map(point => point.time);
    const chartMinTime = chartTimes.length ? Math.min(...chartTimes) : 0;
    const chartMaxTime = chartTimes.length ? Math.max(...chartTimes) : 1;
    mergeValue(worksheet, 'R12:T12', 'DRAINAGE CHART HELPERS', {
      fill: BRAND.section,
      font: { name: 'Arial', size: 9, bold: true, color: { argb: BRAND.white } },
      alignment: { horizontal: 'center', vertical: 'middle' },
    });
    worksheet.getCell('R13').value = formulaValue(`=IF(COUNT($C$${firstDataRow}:$C$${lastDataRow})=0,0,MIN($C$${firstDataRow}:$C$${lastDataRow}))`, chartMinTime);
    worksheet.getCell('R14').value = formulaValue(`=IF(COUNT($C$${firstDataRow}:$C$${lastDataRow})=0,1,MAX($C$${firstDataRow}:$C$${lastDataRow}))`, chartMaxTime);
    worksheet.getCell('S13').value = formulaValue('=$J$40', results.level75);
    worksheet.getCell('S14').value = formulaValue('=$J$40', results.level75);
    worksheet.getCell('T13').value = formulaValue('=$J$41', results.level25);
    worksheet.getCell('T14').value = formulaValue('=$J$41', results.level25);
    ['R13', 'R14', 'S13', 'S14', 'T13', 'T14'].forEach(address => {
      applyCellStyle(worksheet.getCell(address), { fill: BRAND.paleBlue, numFmt: '0.00', alignment: { horizontal: 'right', vertical: 'middle' } });
    });

    mergeValue(worksheet, 'G37:M37', 'BRE 365 DATA ANALYSIS', {
      fill: BRAND.section,
      font: { name: 'Arial', size: 10, bold: true, color: { argb: BRAND.white } },
      alignment: { horizontal: 'center', vertical: 'middle' },
    });
    ['Date', 'Clock time', 'Time (mins)', 'Depth to water (mm)', 'Head of water (mm)', null].forEach((heading, index) => {
      const cell = worksheet.getCell(13, index + 1);
      cell.value = heading;
      applyCellStyle(cell, { fill: BRAND.section, font: { name: 'Arial', size: 8, bold: true, color: { argb: BRAND.white } }, alignment: { horizontal: 'center', vertical: 'middle', wrapText: true } });
    });
    worksheet.getRow(13).height = 30;

    for (let offset = 0; offset < rowCount; offset += 1) {
      const rowNumber = firstDataRow + offset;
      const point = points[offset];
      const timestamp = point && point.timestamp ? new Date(point.timestamp) : null;
      const head = point ? results.excavation - point.depth : null;
      const cells = [
        timestamp || null,
        timestamp || (point ? point.clockTime : null),
        point ? point.time : null,
        point ? point.depth : null,
        point ? formulaValue(`=IF(D${rowNumber}="","",$J$9-D${rowNumber})`, head) : null,
      ];
      cells.forEach((value, index) => {
        const cell = worksheet.getCell(rowNumber, index + 1);
        cell.value = value;
        applyCellStyle(cell, {
          fill: index === 4 ? BRAND.paleBlue : BRAND.white,
          alignment: { horizontal: 'center', vertical: 'middle' },
          numFmt: index === 0 ? 'dd/mm/yyyy' : index === 1 && timestamp ? 'hh:mm:ss' : index >= 2 ? '0.00' : undefined,
        });
      });
      worksheet.getCell(rowNumber, 6).border = { right: thinBorder.right };
      if (offset > 0 && point) {
        const previousHead = results.excavation - points[offset - 1].depth;
        const currentHead = head;
        const cross75 = previousHead >= results.level75 && currentHead <= results.level75
          ? points[offset - 1].time + ((previousHead - results.level75) * (point.time - points[offset - 1].time)) / (previousHead - currentHead || 1)
          : null;
        const cross25 = previousHead >= results.level25 && currentHead <= results.level25
          ? points[offset - 1].time + ((previousHead - results.level25) * (point.time - points[offset - 1].time)) / (previousHead - currentHead || 1)
          : null;
        worksheet.getCell(rowNumber, 14).value = formulaValue(`=IF(AND(E${rowNumber - 1}>=J$40,E${rowNumber}<=J$40,E${rowNumber - 1}<>E${rowNumber}),C${rowNumber - 1}+(E${rowNumber - 1}-J$40)*(C${rowNumber}-C${rowNumber - 1})/(E${rowNumber - 1}-E${rowNumber}),"")`, cross75);
        worksheet.getCell(rowNumber, 15).value = formulaValue(`=IF(AND(E${rowNumber - 1}>=J$41,E${rowNumber}<=J$41,E${rowNumber - 1}<>E${rowNumber}),C${rowNumber - 1}+(E${rowNumber - 1}-J$41)*(C${rowNumber}-C${rowNumber - 1})/(E${rowNumber - 1}-E${rowNumber}),"")`, cross25);
      }
    }

    const analysis = [
      [38, 'Initial head of water', `=IFERROR($J$9-$D$${firstDataRow},"")`, results.initialHead, 'mm', '0.00'],
      [39, 'Minimum recorded head', `=IF(COUNT(E${firstDataRow}:E${lastDataRow})=0,"",MIN(E${firstDataRow}:E${lastDataRow}))`, results.minimumHead, 'mm', '0.00'],
      [40, 'Water level at 75% effective depth', '=J38*0.75', results.level75, 'mm', '0.00'],
      [41, 'Water level at 25% effective depth', '=J38*0.25', results.level25, 'mm', '0.00'],
      [42, 'Interpolated time at 75% level', `=IF(COUNT(N${firstDataRow}:N${lastDataRow})=0,"",MAX(N${firstDataRow}:N${lastDataRow}))`, results.time75, 'mins', '0.00'],
      [43, 'Interpolated time at 25% level', `=IF(COUNT(O${firstDataRow}:O${lastDataRow})=0,"",MAX(O${firstDataRow}:O${lastDataRow}))`, results.time25, 'mins', '0.00'],
      [44, 'Time to drain 75% to 25%', '=IF(OR(J42="",J43=""),"",J43-J42)', results.drainTime, 'mins', '0.00'],
      [45, 'Factored volume of water', '=AVERAGE(B9*F9,D9*H9)/1000000*J38/1000*B10', results.factoredVolume, 'm³', '0.000000'],
      [46, 'Volume of water discharged', '=J45*0.5', results.volumeDischarged, 'm³', '0.000000'],
      [47, 'Discharge area', '=((2*AVERAGE(B9,D9)+2*AVERAGE(F9,H9))/1000)*AVERAGE(J40,J41)/1000+(D9*H9/1000000)', results.dischargeArea, 'm²', '0.000000'],
      [48, 'Soil infiltration rate', '=IFERROR(J46/J47/J44,"")', results.infiltrationMMin, 'm/min', '0.000E+00'],
      [49, 'Soil infiltration rate', '=IFERROR(J48/60,"")', results.infiltrationMSec, 'm/sec', '0.000E+00'],
    ];
    analysis.forEach(([row, label, formula, result, unit, format]) => {
      const isInfiltrationRate = row >= 48;
      mergeValue(worksheet, `G${row}:I${row}`, label, {
        fill: isInfiltrationRate ? BRAND.navy : BRAND.paleBlue,
        font: { name: 'Arial', size: isInfiltrationRate ? 9 : 8, bold: true, color: { argb: isInfiltrationRate ? BRAND.white : BRAND.dark } },
      });
      mergeValue(worksheet, `J${row}:K${row}`, formulaValue(formula, result), {
        fill: isInfiltrationRate ? BRAND.paleGreen : BRAND.white,
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
    mergeValue(worksheet, 'G50:I51', 'BRE 365 COMPLIANCE', { fill: BRAND.section, font: { name: 'Arial', size: 9, bold: true, color: { argb: BRAND.white } }, alignment: { horizontal: 'center', vertical: 'middle' } });
    const complianceFormula = `=IF(COUNT(E${firstDataRow}:E${lastDataRow})=0,"No readings recorded",IF(J39<=J41,"Compliant with BRE 365","Not compliant - test did not drain past 25% effective depth"))`;
    mergeValue(worksheet, 'J50:M51', formulaValue(complianceFormula, results.compliance), {
      fill: results.compliance.startsWith('Compliant') ? BRAND.paleGreen : BRAND.paleRed,
      font: { name: 'Arial', size: 9, bold: true, color: { argb: BRAND.dark } },
      alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
    });

    mergeValue(worksheet, `A${footerRow}:M${footerRow}`, 'Calculation basis: BRE Digest 365. All dimensions are in millimetres unless noted. White cells contain field-entered or editable report data.', {
      border: false,
      font: { name: 'Arial', size: 7, italic: true, color: { argb: '6B7280' } },
      alignment: { horizontal: 'left', vertical: 'middle', wrapText: true },
    });
    worksheet.getRow(footerRow).height = 20;
    worksheet.autoFilter = `A13:E${lastDataRow}`;
    worksheet.views = [{ showGridLines: false, zoomScale: 85, state: 'frozen', ySplit: 13 }];
    return { worksheet, name, points, results, chartLabels, footerRow, firstDataRow, lastDataRow };
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

  async function buildWorkbook(rawSessions) {
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
    const names = buildSheetNames(sessions);
    const artifacts = [];
    for (let index = 0; index < sessions.length; index += 1) {
      artifacts.push(await buildWorksheet(workbook, sessions[index], names[index], logoBase64));
    }
    return { workbook, sessions, names, artifacts };
  }

  async function buildAndDownload(rawSessions) {
    const { workbook, sessions, artifacts } = await buildWorkbook(rawSessions);
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
    _test: { buildSheetNames, calculateResults, normalizePoints, crossingTime, hasReportData, columnLetter },
  };
})();
