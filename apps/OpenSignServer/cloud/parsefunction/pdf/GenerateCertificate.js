import { PDFDocument, PDFName, StandardFonts, rgb } from 'pdf-lib';
import fs from 'node:fs';
import QRCode from 'qrcode';
import { formatDateTime } from '../../../Utils.js';

const formatDateStr = (dateStr, DateFormat, timezone, Is12Hr) => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  return formatDateTime(date, DateFormat, timezone, Is12Hr);
};

// formatDateStr's output is "DD/MM/YYYY, hh:mm:ss a GMT +05:30" - roughly
// 34 characters, which is far too wide for the narrow table columns this
// file uses (confirmed by actually rendering a generated certificate:
// the full string overflowed straight into the next column, overlapping
// the IP Address / Event text next to it). Table cells use just the
// time-of-day portion instead; the full date is already shown elsewhere
// on the certificate (Document Summary's Created/Completed rows).
function shortTime(fullLabel) {
  if (!fullLabel) return '';
  const match = fullLabel.match(/,\s*([\d:]+(?:\s*[AP]M)?)/i);
  return match ? match[1] : fullLabel;
}

// Same overflow problem, lighter fix: some rows have room for date+time but
// not the "GMT +05:30" suffix on top of it - drop just that trailing part
// rather than the whole thing down to time-only.
function withoutGmtSuffix(fullLabel) {
  if (!fullLabel) return '';
  return fullLabel.replace(/\s*GMT\s*[+-]\d{2}:?\d{2}\s*$/i, '');
}

// Deterministic, not random - the same document always produces the same
// Transaction ID / Certificate ID, so regenerating a certificate for an
// already-completed document (the download-certificate flow) doesn't hand
// out a different ID each time.
function shortHash(input) {
  let hash = 0;
  const str = String(input || '');
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36).toUpperCase().padStart(6, '0').slice(0, 6);
}

function initialsOf(name) {
  const parts = String(name || '?')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ---- text fitting helpers ----------------------------------------------
// Breaks text into chunks at whitespace *and* after hyphens (keeping the
// hyphen with the preceding chunk), so a long hyphenated ID wraps at a
// hyphen the way a word processor would instead of mid-character.
function tokenizeForWrap(text) {
  const tokens = [];
  let current = '';
  for (const ch of String(text ?? '')) {
    current += ch;
    if (ch === ' ' || ch === '-') {
      tokens.push(current);
      current = '';
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

// Wraps text to a max width at those break points, falling back to
// character-level wrapping only for a single chunk that's too long on its
// own (e.g. a long email/URL segment with no space or hyphen to break on).
// Used everywhere a dynamic field (document name, org name, certificate ID,
// hash, ...) needs to stay inside its box instead of being blindly cut off.
function wrapText(text, font, size, maxWidth) {
  const tokens = tokenizeForWrap(text);
  if (tokens.length === 0) return [''];
  const lines = [];
  let current = '';
  for (const token of tokens) {
    const candidate = current + token;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) {
      lines.push(current.trimEnd());
      current = '';
    }
    if (font.widthOfTextAtSize(token, size) <= maxWidth) {
      current = token;
      continue;
    }
    // The chunk alone doesn't fit - break it at the character level.
    let chunk = '';
    for (const ch of token) {
      const test = chunk + ch;
      if (font.widthOfTextAtSize(test, size) <= maxWidth) {
        chunk = test;
      } else {
        if (chunk) lines.push(chunk);
        chunk = ch;
      }
    }
    current = chunk;
  }
  if (current) lines.push(current.trimEnd());
  return lines.length ? lines : [''];
}

// Wraps to at most maxLines, ellipsizing the last line if content still
// overflows - the "prefer wrapping, fall back to a clean ellipsis" rule
// applied everywhere a field can legitimately run long.
function fitLines(text, font, size, maxWidth, maxLines) {
  const lines = wrapText(text, font, size, maxWidth);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last.length > 1 && font.widthOfTextAtSize(`${last}…`, size) > maxWidth) {
    last = last.slice(0, -1);
  }
  kept[maxLines - 1] = `${last}…`;
  return kept;
}

// Single-line variant for table cells that must not grow taller: shrinks
// the font within a safe minimum before resorting to an ellipsis, so a long
// value never spills into the next column.
function fitSingleLine(text, font, size, maxWidth, minSize = 6.5) {
  const str = String(text ?? '');
  let s = size;
  while (s > minSize && font.widthOfTextAtSize(str, s) > maxWidth) {
    s -= 0.5;
  }
  if (font.widthOfTextAtSize(str, s) <= maxWidth) {
    return { text: str, size: s };
  }
  let trimmed = str;
  while (trimmed.length > 1 && font.widthOfTextAtSize(`${trimmed}…`, s) > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return { text: `${trimmed}…`, size: s };
}

// Deliberately only the most stable pdf-lib primitives below (rectangles,
// ellipses, lines, text) - no drawSvgPath. A malformed path string is a
// silent, hard-to-catch way to break every certificate generated from this
// file, and none of these shapes need anything an SVG path could do that a
// rectangle/ellipse pair can't already do reliably.

// A rounded "pill" shape: a rectangle capped with two circles of the same
// fill color, exactly matching the rectangle's height - no native
// rounded-rect primitive in this pdf-lib version, this is the safe
// equivalent.
function drawPill(page, { x, y, width, height, color }) {
  const r = height / 2;
  page.drawRectangle({ x: x + r, y, width: width - height, height, color });
  page.drawEllipse({ x: x + r, y: y + r, xScale: r, yScale: r, color });
  page.drawEllipse({ x: x + width - r, y: y + r, xScale: r, yScale: r, color });
}

// A stable outlined pill made from the same primitives as drawPill: draw a
// green outer pill, then inset a white pill to leave a uniform thin border.
function drawOutlinedPill(
  page,
  { x, y, width, height, borderColor, fillColor, borderWidth = 0.9 }
) {
  drawPill(page, { x, y, width, height, color: borderColor });
  drawPill(page, {
    x: x + borderWidth,
    y: y + borderWidth,
    width: width - borderWidth * 2,
    height: height - borderWidth * 2,
    color: fillColor,
  });
}

// An outlined status circle with a proportionally centered two-line check.
function drawOutlinedCheckCircle(
  page,
  { x, y, diameter, color, fillColor, borderWidth = 1, checkWidth = 1 }
) {
  const r = diameter / 2;
  page.drawEllipse({
    x: x + r,
    y: y + r,
    xScale: r,
    yScale: r,
    color: fillColor,
    borderColor: color,
    borderWidth,
  });
  page.drawLine({
    start: { x: x + diameter * 0.25, y: y + diameter * 0.5 },
    end: { x: x + diameter * 0.43, y: y + diameter * 0.32 },
    thickness: checkWidth,
    color,
  });
  page.drawLine({
    start: { x: x + diameter * 0.43, y: y + diameter * 0.32 },
    end: { x: x + diameter * 0.76, y: y + diameter * 0.68 },
    thickness: checkWidth,
    color,
  });
}

function drawAvatarCircle(page, { x, y, diameter, name, font, bgColor, textColor }) {
  const r = diameter / 2;
  page.drawEllipse({ x: x + r, y: y + r, xScale: r, yScale: r, color: bgColor });
  const initials = initialsOf(name);
  const size = diameter * 0.38;
  const textWidth = font.widthOfTextAtSize(initials, size);
  page.drawText(initials, {
    x: x + r - textWidth / 2,
    y: y + r - size / 2.8,
    size,
    font,
    color: textColor,
  });
}

// Small checkmark built from two lines, not a path - reliable at any size.
function drawCheckIcon(page, { x, y, size, color, thickness = 1.6 }) {
  page.drawLine({
    start: { x: x, y: y + size * 0.45 },
    end: { x: x + size * 0.38, y: y + size * 0.15 },
    thickness,
    color,
  });
  page.drawLine({
    start: { x: x + size * 0.38, y: y + size * 0.15 },
    end: { x: x + size, y: y + size * 0.75 },
    thickness,
    color,
  });
}

// Shared "heading + divider line" pattern used by every section (Document
// Summary, Participants, Event History) so all three look consistent -
// same size, weight, color, and spacing above/below.
function drawSectionHeading(page, { x, text, y, width, font, color, lineColor }) {
  page.drawText(text, { x, y, size: 11, font, color });
  y -= 9;
  page.drawLine({ start: { x, y }, end: { x: x + width, y }, thickness: 1, color: lineColor });
  y -= 14;
  return y;
}

export default async function GenerateCertificate(docDetails) {
  const timezone = docDetails?.ExtUserPtr?.Timezone || '';
  const Is12Hr = docDetails?.ExtUserPtr?.Is12HourTime || false;
  const DateFormat = docDetails?.ExtUserPtr?.DateFormat || 'MM/DD/YYYY';
  const pdfDoc = await PDFDocument.create();
  // Standard PDF fonts - no font files to load/embed, so nothing here can
  // fail from a missing or corrupt .ttf on disk. Courier (monospace) is
  // used only for the SHA-256 hash, where fixed character width keeps a
  // long hex string readable and evenly spaced.
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontMono = await pdfDoc.embedFont(StandardFonts.Courier);
  const pngUrl = fs.readFileSync('./images/logo.png').buffer;
  const pngImage = await pdfDoc.embedPng(pngUrl);

  // ---- palette (matches the approved reference design - unchanged) ----
  const navy = rgb(0.043, 0.176, 0.353);
  const green = rgb(0.086, 0.639, 0.29);
  const gray = rgb(0.42, 0.45, 0.49);
  const lightGray = rgb(0.9, 0.91, 0.93);
  const rowStripe = rgb(0.975, 0.978, 0.985);
  const black = rgb(0.1, 0.1, 0.12);
  const white = rgb(1, 1, 1);
  const avatarPalette = [
    { bg: rgb(0.85, 0.88, 0.98), fg: rgb(0.22, 0.32, 0.62) },
    { bg: rgb(0.93, 0.86, 0.98), fg: rgb(0.48, 0.24, 0.62) },
    { bg: rgb(0.85, 0.96, 0.9), fg: rgb(0.15, 0.5, 0.32) },
    { bg: rgb(0.99, 0.9, 0.83), fg: rgb(0.68, 0.38, 0.12) },
  ];

  // ---- spacing system - a small fixed scale instead of scattered
  // one-off numbers, so paddings/margins/gaps are predictable throughout ----
  const SPACE = { xxs: 4, xs: 6, sm: 8, md: 12, base: 16, lg: 20, xl: 24, xxl: 32 };
  const TYPE = { title: 24, heading: 11, label: 8, value: 8, small: 7 };

  const startX = 18;
  const startY = 18;
  const marginX = 36;

  // ---- derived data (only from fields that actually exist on docDetails -
  // nothing invented) ----
  const completedAt = docDetails?.completedAt ? new Date(docDetails.completedAt) : new Date();
  const completedAtLabel = formatDateStr(completedAt, DateFormat, timezone, Is12Hr);
  const createdAt = docDetails?.DocSentAt?.iso || docDetails.createdAt;
  const createdAtLabel = formatDateStr(createdAt, DateFormat, timezone, Is12Hr);
  const generatedOnLabel =
    'Generated On ' + formatDateTime(new Date(), DateFormat, timezone, Is12Hr);
  const company = docDetails?.ExtUserPtr?.Company || '';
  const documentHash = docDetails?.DocumentHash || '';
  const IsEnableOTP = docDetails?.IsEnableOTP || false;
  const ownerName = docDetails?.SenderName || docDetails.ExtUserPtr?.Name || 'n/a';
  const ownerEmail = docDetails?.SenderMail || docDetails.ExtUserPtr?.Email || 'n/a';
  const objectId = docDetails.objectId || '';
  const docName = docDetails?.Name || '';

  // Real page count, derived from where the signature/date fields actually
  // sit in the source document - not invented, and not available any other
  // way without also changing PDF.js's call site, which is out of scope for
  // this file. Placeholders already carry `pageNumber` (0-indexed) - see
  // Utils.js on the frontend for the same field used the same way.
  const placeholders = Array.isArray(docDetails?.Placeholders) ? docDetails.Placeholders : [];
  const pageNumbers = placeholders.map(p => p?.pageNumber).filter(n => Number.isFinite(n));
  const pageCount = pageNumbers.length ? Math.max(...pageNumbers) + 1 : 1;

  const dateKey = completedAt.toISOString().slice(0, 10);
  const transactionId = `TXN-${dateKey}-${shortHash(objectId + 'txn')}`;
  const certificateId = `CERT-${dateKey}-${shortHash(objectId + completedAt.toISOString())}`;

  const filteredAudit = (docDetails?.AuditTrail || []).filter(x => x?.UserPtr?.objectId);
  const toTs = v => {
    if (!v) return 0;
    if (typeof v === 'object' && v?.iso) return new Date(v.iso).getTime() || 0;
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : 0;
  };
  const participants =
    docDetails?.Signers?.length > 0
      ? filteredAudit
          .map(x => {
            const data = docDetails.Signers.find(y => y.objectId === x.UserPtr.objectId);
            return {
              ...data,
              ipAddress: x.ipAddress,
              SignedOn: x?.SignedOn || null,
              ViewedOn: x?.ViewedOn || x?.SignedOn || null,
              Signature: x?.Signature || '',
              _signedOnTs: toTs(x?.SignedOn),
            };
          })
          .sort((a, b) => (a._signedOnTs || 0) - (b._signedOnTs || 0))
      : filteredAudit[0]
        ? [
            {
              ...docDetails.ExtUserPtr,
              ipAddress: filteredAudit[0].ipAddress,
              SignedOn: filteredAudit[0]?.SignedOn || null,
              ViewedOn: filteredAudit[0]?.ViewedOn || filteredAudit[0]?.SignedOn || null,
              Signature: filteredAudit[0]?.Signature || '',
            },
          ]
        : [];

  // Flat chronological event list for the "Event History" table - built
  // from the same AuditTrail data the old layout already used, just
  // reshaped into one row per event instead of one block per signer.
  const events = [
    { label: 'Document created', ts: toTs(createdAt), when: shortTime(createdAtLabel) },
  ];
  for (const p of participants) {
    if (p.ViewedOn) {
      events.push({
        label: `${p.Name || 'Signer'} viewed document`,
        ts: toTs(p.ViewedOn),
        when: shortTime(formatDateStr(p.ViewedOn, DateFormat, timezone, Is12Hr)),
      });
    }
    if (p.SignedOn) {
      events.push({
        label: `${p.Name || 'Signer'} signed document`,
        ts: toTs(p.SignedOn),
        when: shortTime(formatDateStr(p.SignedOn, DateFormat, timezone, Is12Hr)),
      });
    }
  }
  events.sort((a, b) => a.ts - b.ts);
  events.push({
    label: 'Signing process completed',
    ts: Infinity,
    when: shortTime(completedAtLabel),
    highlight: true,
  });

  const publicOrigin = process.env.PUBLIC_ORIGIN || '';
  const verifyUrl = `${publicOrigin}/verify-document?certId=${encodeURIComponent(certificateId)}`;
  let qrImage = null;
  try {
    const qrBuffer = await QRCode.toBuffer(verifyUrl, { type: 'png', margin: 1, width: 240 });
    qrImage = await pdfDoc.embedPng(qrBuffer);
  } catch (err) {
    // A broken/unreachable QR generation must never take down certificate
    // generation itself - the certificate is still legally meaningful
    // without it, just without the scan-to-verify shortcut.
    console.log(
      'GenerateCertificate: QR code generation failed, continuing without it:',
      err.message
    );
  }

  // ---- page management (same overflow-then-new-page technique the
  // previous version of this file already used, just driven off row height
  // instead of one fixed per-signer block height) ----
  let page = pdfDoc.addPage();
  const { width, height } = page.getSize();
  const contentRight = width - marginX;
  const contentWidth = contentRight - marginX;
  let y = 0;

  function drawPageBorder(p) {
    p.drawRectangle({
      x: startX,
      y: startY,
      width: width - 2 * startX,
      height: height - 2 * startY,
      borderColor: lightGray,
      borderWidth: 1,
    });
  }

  function newPage() {
    page = pdfDoc.addPage();
    drawPageBorder(page);
    y = height - SPACE.xxl;
    return page;
  }

  function ensureSpace(neededHeight) {
    if (y - neededHeight < startY + SPACE.md) {
      newPage();
    }
  }

  drawPageBorder(page);
  y = height - SPACE.xxl;

  // ---------------- Header ----------------
  // Logo (left) and the COMPLETED badge (right) share one visual center
  // line instead of being placed with independent, slightly-mismatched
  // offsets.
  const HEADER_LOGO_H = 24;
  const HEADER_BADGE_H = 32;
  const headerCenterY = y - 12;

  const logoY = headerCenterY - HEADER_LOGO_H / 2;
  page.drawImage(pngImage, {
    x: marginX,
    y: logoY,
    width: HEADER_LOGO_H * (pngImage.width / pngImage.height),
    height: HEADER_LOGO_H,
  });

  const headerStatusCircleD = 22;
  const headerStatusGap = 8;
  const completedW = fontBold.widthOfTextAtSize('COMPLETED', 10);
  const statusSubtitleW = font.widthOfTextAtSize('All signatures collected', 7);
  const headerStatusTextW = Math.max(completedW, statusSubtitleW);
  const headerStatusX = contentRight - (headerStatusCircleD + headerStatusGap + headerStatusTextW);
  const headerStatusCircleY = headerCenterY - headerStatusCircleD / 2;
  const headerStatusTextX = headerStatusX + headerStatusCircleD + headerStatusGap;
  drawOutlinedCheckCircle(page, {
    x: headerStatusX,
    y: headerStatusCircleY,
    diameter: headerStatusCircleD,
    color: green,
    fillColor: white,
    borderWidth: 1.1,
    checkWidth: 1.6,
  });
  page.drawText('COMPLETED', {
    x: headerStatusTextX,
    y: headerCenterY + 3,
    size: 10,
    font: fontBold,
    color: green,
  });
  page.drawText('All signatures collected', {
    x: headerStatusTextX,
    y: headerCenterY - 9,
    size: 7,
    font,
    color: gray,
  });

  // Straight separator below the whole header row (logo + badge), not
  // running through either of them.
  const headerDividerY = headerCenterY - HEADER_BADGE_H / 2 - SPACE.md;
  page.drawLine({
    start: { x: marginX, y: headerDividerY },
    end: { x: contentRight, y: headerDividerY },
    thickness: 1.5,
    color: navy,
  });

  // "Generated On" - secondary metadata, clearly smaller/muted, with its
  // own breathing room above (from the divider) and below (before the
  // title), so it never crowds either neighbor.
  const generatedOnY = headerDividerY - SPACE.base;
  page.drawText(generatedOnLabel, {
    x: marginX,
    y: generatedOnY,
    size: 8,
    font,
    color: gray,
  });

  y = generatedOnY - 28;

  // ---------------- Title ----------------
  page.drawText('Certificate of Completion', {
    x: marginX,
    y,
    size: TYPE.title,
    font: fontBold,
    color: navy,
  });
  y -= 15;
  const descLines = [
    'This is to certify that the electronic document listed below has been completed',
    'and signed by all required parties using a secure electronic-signature process.',
  ];
  for (const line of descLines) {
    page.drawText(line, { x: marginX, y, size: 8.5, font, color: gray });
    y -= 13;
  }
  y -= SPACE.xs;

  // ---------------- Document Summary ----------------
  y = drawSectionHeading(page, {
    x: marginX,
    text: 'Document Summary',
    y,
    width: contentWidth,
    font: fontBold,
    color: navy,
    lineColor: lightGray,
  });

  const leftRows = [
    ['Document Name', docName],
    ['Document ID', objectId],
    ['Transaction ID', transactionId],
    ['Document Type', 'PDF'],
    ['Pages', String(pageCount)],
    ['Created', withoutGmtSuffix(createdAtLabel)],
    ['Completed', withoutGmtSuffix(completedAtLabel)],
  ];
  const rightRows = [
    ['Sender / Initiator', ownerName],
    ['Email', ownerEmail],
    ['Organization', company],
    ['Signing Method', 'Electronic Signature'],
    ['Completion Status', '__badge__'],
    ['Completion Time', withoutGmtSuffix(completedAtLabel)],
    ['Timezone', timezone ? `${timezone}` : 'n/a'],
  ];

  // The right side carries naturally denser sender/organization metadata,
  // so give it a little more room. Each half also sizes its own label column
  // instead of letting the widest label on either side constrain both value
  // columns. Left/right rows still share one height to remain aligned.
  const leftLabelW =
    Math.ceil(
      Math.max(...leftRows.map(([label]) => fontBold.widthOfTextAtSize(label, TYPE.label)))
    ) + SPACE.sm;
  const rightLabelW =
    Math.ceil(
      Math.max(...rightRows.map(([label]) => fontBold.widthOfTextAtSize(label, TYPE.label)))
    ) + SPACE.sm;
  const GRID_ROW_LINE_H = 11.5;
  const GRID_ROW_GAP = 4;
  const colGap = SPACE.base;
  const availableGridWidth = contentWidth - colGap;
  const leftColWidth = Math.round(availableGridWidth * 0.46);
  const rightColWidth = availableGridWidth - leftColWidth;
  const leftLabelX = marginX;
  const leftValueX = marginX + leftLabelW;
  const rightLabelX = marginX + leftColWidth + colGap;
  const rightValueX = rightLabelX + rightLabelW;
  const leftValueMaxW = leftColWidth - leftLabelW - SPACE.xs;
  const rightValueMaxW = rightColWidth - rightLabelW - SPACE.xs;
  const gridTopY = y;

  const rowCount = Math.max(leftRows.length, rightRows.length);
  let rowY = gridTopY;
  for (let i = 0; i < rowCount; i++) {
    const leftRow = leftRows[i];
    const rightRow = rightRows[i];
    const isBadgeRow = rightRow && rightRow[1] === '__badge__';
    const leftLines = leftRow
      ? fitLines(String(leftRow[1] ?? ''), font, TYPE.value, leftValueMaxW, 2)
      : [''];
    const rightLines =
      rightRow && !isBadgeRow
        ? fitLines(String(rightRow[1] ?? ''), font, TYPE.value, rightValueMaxW, 2)
        : [''];
    const rowLines = Math.max(leftLines.length, rightLines.length, 1);
    const rowHeight = Math.max(rowLines * GRID_ROW_LINE_H, isBadgeRow ? 16 : 0);

    if (leftRow) {
      page.drawText(leftRow[0], {
        x: leftLabelX,
        y: rowY,
        size: TYPE.label,
        font: fontBold,
        color: black,
      });
      leftLines.forEach((line, li) =>
        page.drawText(line, {
          x: leftValueX,
          y: rowY - li * GRID_ROW_LINE_H,
          size: TYPE.value,
          font,
          color: gray,
        })
      );
    }
    if (rightRow) {
      page.drawText(rightRow[0], {
        x: rightLabelX,
        y: rowY,
        size: TYPE.label,
        font: fontBold,
        color: black,
      });
      if (isBadgeRow) {
        const completedBadgeY = rowY - 4;
        drawOutlinedPill(page, {
          x: rightValueX,
          y: completedBadgeY,
          width: 78,
          height: 14,
          borderColor: green,
          fillColor: white,
        });
        drawOutlinedCheckCircle(page, {
          x: rightValueX + 6,
          y: completedBadgeY + 3,
          diameter: 8,
          color: green,
          fillColor: white,
          borderWidth: 0.8,
          checkWidth: 0.75,
        });
        page.drawText('Completed', {
          x: rightValueX + 19,
          y: completedBadgeY + 4.25,
          size: 7.5,
          font: fontBold,
          color: green,
        });
      } else {
        rightLines.forEach((line, li) =>
          page.drawText(line, {
            x: rightValueX,
            y: rowY - li * GRID_ROW_LINE_H,
            size: TYPE.value,
            font,
            color: gray,
          })
        );
      }
    }
    rowY -= rowHeight + GRID_ROW_GAP;
  }
  const gridBottomY = rowY + GRID_ROW_GAP;

  page.drawLine({
    start: { x: marginX + leftColWidth + colGap / 2, y: gridTopY + 8 },
    end: { x: marginX + leftColWidth + colGap / 2, y: gridBottomY + 4 },
    thickness: 0.75,
    color: lightGray,
  });

  y = gridBottomY - SPACE.sm;

  // SHA-256 hash - a full-width, monospaced, label-above-value block
  // instead of a single cramped inline row, since this is a technical
  // field readers may actually want to compare character-by-character.
  if (documentHash) {
    const hashFontSize = 9.25;
    const hashLineH = 12.5;
    const hashValueW = contentWidth;
    const hashLines = fitLines(documentHash, fontMono, hashFontSize, hashValueW, 2);
    ensureSpace(TYPE.label + SPACE.sm + hashLines.length * hashLineH + SPACE.md);
    page.drawText('Document hash (SHA-256)', {
      x: marginX,
      y,
      size: TYPE.label,
      font: fontBold,
      color: black,
    });
    y -= TYPE.label + SPACE.xs;
    hashLines.forEach((line, li) => {
      page.drawText(line, {
        x: marginX,
        y: y - li * hashLineH,
        size: hashFontSize,
        font: fontMono,
        color: gray,
      });
    });
    y -= hashLines.length * hashLineH + SPACE.md;
  }

  y -= SPACE.xxs;

  // ---------------- Participants ----------------
  ensureSpace(SPACE.xxl + SPACE.xl);
  y = drawSectionHeading(page, {
    x: marginX,
    text: 'Participants',
    y,
    width: contentWidth,
    font: fontBold,
    color: navy,
    lineColor: lightGray,
  });

  // Column widths are computed from contentWidth (not hardcoded absolute
  // offsets), so the table always fills the page's actual content grid -
  // Name & Email gets the most room since it carries the most information,
  // Authentication takes whatever is left over and shrink-fits its text.
  const CELL_PAD = 8;
  const colSpecs = [
    { key: 'idx', label: '#', width: 20 },
    { key: 'name', label: 'Name & Email', width: 184 },
    { key: 'role', label: 'Role', width: 44 },
    { key: 'status', label: 'Status', width: 68 },
    { key: 'signedAt', label: 'Signed At', width: 68 },
    { key: 'ip', label: 'IP Address', width: 64 },
  ];
  const fixedColsWidth = colSpecs.reduce((sum, c) => sum + c.width, 0);
  const authHeaderMinW = fontBold.widthOfTextAtSize('Authentication', 8) + CELL_PAD * 2;
  colSpecs.push({
    key: 'auth',
    label: 'Authentication',
    width: Math.max(authHeaderMinW, contentWidth - fixedColsWidth),
  });
  let cx = marginX;
  const cols = colSpecs.map(c => {
    const col = { ...c, x: cx };
    cx += c.width;
    return col;
  });
  const colByKey = Object.fromEntries(cols.map(c => [c.key, c]));

  function drawTableHeader() {
    const headerH = 20;
    page.drawRectangle({
      x: marginX,
      y: y - headerH,
      width: contentWidth,
      height: headerH,
      color: navy,
    });
    for (const c of cols) {
      if (c.key === 'idx') {
        const tw = fontBold.widthOfTextAtSize(c.label, 8);
        page.drawText(c.label, {
          x: c.x + (c.width - tw) / 2,
          y: y - headerH + 7,
          size: 8,
          font: fontBold,
          color: white,
        });
      } else {
        page.drawText(c.label, {
          x: c.x + CELL_PAD,
          y: y - headerH + 7,
          size: 8,
          font: fontBold,
          color: white,
        });
      }
    }
    y -= headerH;
  }

  ensureSpace(20 + 38);
  drawTableHeader();

  const rowH = 38;
  participants.forEach((p, idx) => {
    // Keep the first three signers together on the certificate page. A
    // fourth signer starts a clean continuation page; rows four and five
    // then remain together instead of being split by incidental coordinates.
    if (idx > 0 && idx % 3 === 0) {
      newPage();
      y = drawSectionHeading(page, {
        x: marginX,
        text: 'Participants (continued)',
        y,
        width: contentWidth,
        font: fontBold,
        color: navy,
        lineColor: lightGray,
      });
      ensureSpace(20 + rowH);
      drawTableHeader();
    } else if (y - rowH < startY + SPACE.md) {
      newPage();
      ensureSpace(20 + rowH);
      drawTableHeader();
    }
    if (idx % 2 === 1) {
      page.drawRectangle({
        x: marginX,
        y: y - rowH,
        width: contentWidth,
        height: rowH,
        color: rowStripe,
      });
    }
    const rowTop = y;
    const rowMidBaseline = rowTop - rowH / 2 - 3;
    const palette = avatarPalette[idx % avatarPalette.length];

    const idxCol = colByKey.idx;
    const idxText = String(idx + 1);
    const idxW = font.widthOfTextAtSize(idxText, 7.5);
    page.drawText(idxText, {
      x: idxCol.x + (idxCol.width - idxW) / 2,
      y: rowMidBaseline,
      size: 7.5,
      font,
      color: black,
    });

    const nameCol = colByKey.name;
    const avatarD = 22;
    const avatarX = nameCol.x + CELL_PAD;
    const avatarY = rowTop - rowH / 2 - avatarD / 2;
    drawAvatarCircle(page, {
      x: avatarX,
      y: avatarY,
      diameter: avatarD,
      name: p?.Name,
      font: fontBold,
      bgColor: palette.bg,
      textColor: palette.fg,
    });
    const textX = avatarX + avatarD + SPACE.sm;
    const textMaxW = nameCol.x + nameCol.width - textX - SPACE.xs;
    const [nameLine] = fitLines(p?.Name || '', fontBold, 8.5, textMaxW, 1);
    const [emailLine] = fitLines(p?.Email || '', font, 7, textMaxW, 1);
    page.drawText(nameLine, { x: textX, y: rowTop - 15, size: 8.5, font: fontBold, color: black });
    page.drawText(emailLine, { x: textX, y: rowTop - 27, size: 7, font, color: gray });

    const roleCol = colByKey.role;
    page.drawText('Signer', {
      x: roleCol.x + CELL_PAD,
      y: rowMidBaseline,
      size: 7.5,
      font,
      color: gray,
    });

    const statusCol = colByKey.status;
    const statusPad = 5;
    const badgeW = 58;
    const badgeH = 16;
    const badgeYr = rowTop - rowH / 2 - badgeH / 2;
    if (p?.SignedOn) {
      const signedBadgeW = 54;
      const signedBadgeX = statusCol.x + (statusCol.width - signedBadgeW) / 2;
      drawOutlinedPill(page, {
        x: signedBadgeX,
        y: badgeYr,
        width: signedBadgeW,
        height: badgeH,
        borderColor: green,
        fillColor: white,
      });
      drawOutlinedCheckCircle(page, {
        x: signedBadgeX + 6,
        y: badgeYr + 4,
        diameter: 8,
        color: green,
        fillColor: white,
        borderWidth: 0.8,
        checkWidth: 0.75,
      });
      page.drawText('Signed', {
        x: signedBadgeX + 19,
        y: badgeYr + 5,
        size: 7.5,
        font: fontBold,
        color: green,
      });
    } else {
      drawPill(page, {
        x: statusCol.x + statusPad,
        y: badgeYr,
        width: badgeW,
        height: badgeH,
        color: lightGray,
      });
      page.drawText('Pending', {
        x: statusCol.x + statusPad + 8,
        y: badgeYr + 5,
        size: 7.5,
        font: fontBold,
        color: gray,
      });
    }

    const signedAtCol = colByKey.signedAt;
    const signedLabel = p?.SignedOn
      ? shortTime(formatDateStr(p.SignedOn, DateFormat, timezone, Is12Hr))
      : '—';
    const signedFit = fitSingleLine(signedLabel, font, 7.5, signedAtCol.width - CELL_PAD * 2, 6.5);
    page.drawText(signedFit.text, {
      x: signedAtCol.x + CELL_PAD,
      y: rowMidBaseline,
      size: signedFit.size,
      font,
      color: gray,
    });

    const ipCol = colByKey.ip;
    const ipFit = fitSingleLine(p?.ipAddress || '', font, 7.5, ipCol.width - CELL_PAD * 2, 6.5);
    page.drawText(ipFit.text, {
      x: ipCol.x + CELL_PAD,
      y: rowMidBaseline,
      size: ipFit.size,
      font,
      color: gray,
    });

    const authCol = colByKey.auth;
    const authLabel = IsEnableOTP ? 'Email, OTP' : 'Email verification';
    const authFit = fitSingleLine(authLabel, font, 7, authCol.width - CELL_PAD * 2, 6);
    page.drawText(authFit.text, {
      x: authCol.x + CELL_PAD,
      y: rowMidBaseline,
      size: authFit.size,
      font,
      color: gray,
    });

    page.drawLine({
      start: { x: marginX, y: rowTop - rowH },
      end: { x: contentRight, y: rowTop - rowH },
      thickness: 0.5,
      color: lightGray,
    });
    y -= rowH;
  });

  y -= SPACE.base;

  // ---------------- Event History + Verification ----------------
  ensureSpace(SPACE.xxl);
  y = drawSectionHeading(page, {
    x: marginX,
    text: 'Event History / Audit Trail',
    y,
    width: contentWidth,
    font: fontBold,
    color: navy,
    lineColor: lightGray,
  });

  const colSplitGap = SPACE.base;
  const verifyColWidth = Math.min(190, Math.round(contentWidth * 0.36));
  const eventColWidth = contentWidth - colSplitGap - verifyColWidth;
  const verifyColX = marginX + eventColWidth + colSplitGap;

  // Verification card - a fixed-content block (it never grows with
  // signer/event count), drawn once on whatever page the Event History
  // table starts on. Height is computed from where its own content
  // actually ends, not a hand-tuned constant, so the QR code can never
  // collide with the text above it regardless of future copy changes.
  const CARD_PAD = 11;
  const verifyBoxTop = y;
  let vy = verifyBoxTop - CARD_PAD - 3;
  page.drawText('Verification', {
    x: verifyColX + CARD_PAD,
    y: vy,
    size: 10,
    font: fontBold,
    color: navy,
  });
  vy -= 13;
  const verifyDescMaxW = verifyColWidth - CARD_PAD * 2;
  const verifyDesc = fitLines(
    'A verification record of this transaction - validate using the QR code or Certificate ID.',
    font,
    7,
    verifyDescMaxW,
    3
  );
  for (const line of verifyDesc) {
    page.drawText(line, { x: verifyColX + CARD_PAD, y: vy, size: 7, font, color: gray });
    vy -= 9;
  }
  vy -= SPACE.xs;
  const verifyRows = [
    ['Certificate ID', certificateId],
    ['Issued On', completedAtLabel],
    ['Issued By', 'SignToowix'],
  ];

  // QR and metadata share the lower half of the card. This preserves useful
  // internal whitespace without stacking two tall blocks vertically.
  const qrSize = 54;
  const qrX = verifyColX + CARD_PAD;
  const lowerTopY = vy;
  const metaX = qrX + qrSize + SPACE.sm;
  const metaMaxW = verifyColX + verifyColWidth - CARD_PAD - metaX;
  let metaY = lowerTopY;
  for (const [label, value] of verifyRows) {
    page.drawText(label, { x: metaX, y: metaY, size: 7, font: fontBold, color: black });
    metaY -= 8.5;
    const lines = fitLines(String(value), font, 7, metaMaxW, 2);
    lines.forEach((line, li) => {
      page.drawText(line, { x: metaX, y: metaY - li * 8.5, size: 7, font, color: gray });
    });
    metaY -= lines.length * 8.5 + SPACE.xxs;
  }

  if (qrImage) {
    const qrTopY = lowerTopY;
    const qrBottomY = qrTopY - qrSize;
    page.drawImage(qrImage, { x: qrX, y: qrBottomY, width: qrSize, height: qrSize });
    page.drawText('Scan to verify', {
      x: qrX,
      y: qrBottomY - 10,
      size: 7,
      font,
      color: gray,
    });
    page.drawText('Certificate verification', {
      x: qrX,
      y: qrBottomY - 19,
      size: 7,
      font,
      color: gray,
    });
    vy = Math.min(metaY, qrBottomY - 19);
  } else {
    vy = metaY;
  }

  const verifyBoxHeight = verifyBoxTop - vy + CARD_PAD;
  page.drawRectangle({
    x: verifyColX,
    y: verifyBoxTop - verifyBoxHeight,
    width: verifyColWidth,
    height: verifyBoxHeight,
    borderColor: lightGray,
    borderWidth: 1,
  });

  // Event log - independent pagination from the verification card above,
  // both starting from the same y so the two columns begin level with
  // each other.
  let ey = y;
  const eventHeaderH = 17;
  const eventFontSize = 7.5;
  const eventLineH = 10;
  const eventTimeColW = 84;
  function drawEventHeader() {
    page.drawRectangle({
      x: marginX,
      y: ey - eventHeaderH,
      width: eventColWidth,
      height: eventHeaderH,
      color: navy,
    });
    // Not hardcoded "Time (IST)" - this app has tenants outside India too,
    // and the actual timezone (whatever it is) is already spelled out in
    // the Document Summary's own Timezone row above, so it isn't lost.
    page.drawText('Time', {
      x: marginX + CELL_PAD,
      y: ey - eventHeaderH + 5.5,
      size: 8,
      font: fontBold,
      color: white,
    });
    page.drawText('Event', {
      x: marginX + eventTimeColW,
      y: ey - eventHeaderH + 5.5,
      size: 8,
      font: fontBold,
      color: white,
    });
    ey -= eventHeaderH;
  }
  drawEventHeader();
  const eventTextMaxW = eventColWidth - eventTimeColW - CELL_PAD;
  for (const ev of events) {
    const evFont = ev.highlight ? fontBold : font;
    const eventLines = fitLines(ev.label || '', evFont, eventFontSize, eventTextMaxW, 2);
    const eventRowH = Math.max(18, eventLines.length * eventLineH + 7);
    if (ey - eventRowH < startY + SPACE.md) {
      newPage();
      ey = y;
      drawEventHeader();
    }
    page.drawText(String(ev.when || ''), {
      x: marginX + CELL_PAD,
      y: ey - 11.5,
      size: 7.5,
      font,
      color: ev.highlight ? green : gray,
    });
    eventLines.forEach((line, li) => {
      page.drawText(line, {
        x: marginX + eventTimeColW,
        y: ey - 11.5 - li * eventLineH,
        size: eventFontSize,
        font: evFont,
        color: ev.highlight ? green : black,
      });
    });
    page.drawLine({
      start: { x: marginX, y: ey - eventRowH },
      end: { x: marginX + eventColWidth, y: ey - eventRowH },
      thickness: 0.4,
      color: lightGray,
    });
    ey -= eventRowH;
  }

  y = Math.min(ey, verifyBoxTop - verifyBoxHeight) - SPACE.md;

  // ---------------- Footer (last page only) ----------------
  const footerNoteSize = 6.5;
  const footerMetaSize = 7;
  const footerLineH = 10.5;
  const footerNotes = [
    'This is a system generated certificate and does not require a digital signature.',
    'All times are recorded in the timezone shown above unless otherwise noted.',
    'This certificate is governed by the SignToowix Terms of Service.',
  ];
  const footerFits = footerTop =>
    footerTop - footerNotes.length * footerLineH - SPACE.xs >= startY + SPACE.xs;
  let footerY = Math.max(y - SPACE.sm, startY + SPACE.xl);
  if (!footerFits(footerY)) {
    newPage();
    footerY = Math.max(y - SPACE.sm, startY + SPACE.xl);
  }
  // Hug whatever content actually ended above it instead of always pinning
  // to a fixed spot near the bottom of the page - a short (few-signer)
  // certificate was leaving a large dead gap between the Event
  // History/Verification section and the footer. Still never sits closer
  // to the bottom border than a comfortable minimum.
  page.drawLine({
    start: { x: marginX, y: footerY + SPACE.base },
    end: { x: contentRight, y: footerY + SPACE.base },
    thickness: 0.5,
    color: lightGray,
  });
  let fy = footerY;
  for (const note of footerNotes) {
    page.drawText(note, { x: marginX, y: fy, size: footerNoteSize, font, color: gray });
    fy -= footerLineH;
  }
  // Follows on from the notes above rather than a hardcoded startY - with
  // footerY now dynamic, a fixed position here would leave its own gap
  // between the notes and this last row.
  const copyrightY = fy - SPACE.xs;
  const yearNow = new Date().getFullYear();
  const copyright = `© ${yearNow} SignToowix. All rights reserved.`;
  page.drawText(copyright, { x: marginX, y: copyrightY, size: footerMetaSize, font, color: gray });
  const tagline = 'Secure · Compliant · Legally Enforceable';
  const taglineWidth = font.widthOfTextAtSize(tagline, footerMetaSize);
  page.drawText(tagline, {
    x: contentRight - taglineWidth,
    y: copyrightY,
    size: footerMetaSize,
    font,
    color: navy,
  });

  // For the common single-page case, crop away the unused whitespace below
  // the footer so the certificate looks like a properly-sized one-page
  // document instead of a mostly-empty page. Safe because nothing is ever
  // drawn below this point, so no already-placed coordinate needs to move -
  // only the page's visible bounds shrink. Multi-page documents are left at
  // full size; cropping only the last of several pages would look
  // inconsistent next to the others.
  if (pdfDoc.getPageCount() === 1) {
    const bottomMargin = SPACE.xl;
    const cropY = Math.max(startY, copyrightY - bottomMargin);
    if (cropY > startY + 40) {
      page.node.set(PDFName.of('MediaBox'), pdfDoc.context.obj([0, cropY, width, height]));
      // The original border rectangle was sized for the full page and its
      // bottom edge now falls outside the cropped view - redraw it to close
      // cleanly against the new bottom edge.
      page.drawRectangle({
        x: startX,
        y: cropY + 5,
        width: width - 2 * startX,
        height: height - startY - (cropY + 5),
        borderColor: lightGray,
        borderWidth: 1,
      });
    }
  }

  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}
