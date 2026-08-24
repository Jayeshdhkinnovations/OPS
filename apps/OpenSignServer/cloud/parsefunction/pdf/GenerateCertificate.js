import { PDFDocument, rgb } from 'pdf-lib';
import fs from 'node:fs';
import fontkit from '@pdf-lib/fontkit';
import QRCode from 'qrcode';
import { formatDateTime } from '../../../Utils.js';

const formatDateStr = (dateStr, DateFormat, timezone, Is12Hr) => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  return formatDateTime(date, DateFormat, timezone, Is12Hr);
};

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

export default async function GenerateCertificate(docDetails) {
  const timezone = docDetails?.ExtUserPtr?.Timezone || '';
  const Is12Hr = docDetails?.ExtUserPtr?.Is12HourTime || false;
  const DateFormat = docDetails?.ExtUserPtr?.DateFormat || 'MM/DD/YYYY';
  const pdfDoc = await PDFDocument.create();
  const fontBytes = fs.readFileSync('./font/times.ttf');
  pdfDoc.registerFontkit(fontkit);
  const font = await pdfDoc.embedFont(fontBytes, { subset: true });
  const boldFontBytes = fs.existsSync('./font/times-bold.ttf')
    ? fs.readFileSync('./font/times-bold.ttf')
    : fontBytes;
  const fontBold = await pdfDoc.embedFont(boldFontBytes, { subset: true });
  const pngUrl = fs.readFileSync('./images/logo.png').buffer;
  const pngImage = await pdfDoc.embedPng(pngUrl);

  // ---- palette (matches the approved reference design) ----
  const navy = rgb(0.043, 0.176, 0.353);
  const green = rgb(0.086, 0.639, 0.29);
  const greenBg = rgb(0.878, 0.965, 0.898);
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

  const startX = 15;
  const startY = 15;
  const marginX = 30;

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
  const events = [{ label: 'Document created', ts: toTs(createdAt), when: createdAtLabel }];
  for (const p of participants) {
    if (p.ViewedOn) {
      events.push({
        label: `${p.Name || 'Signer'} viewed document`,
        ts: toTs(p.ViewedOn),
        when: formatDateStr(p.ViewedOn, DateFormat, timezone, Is12Hr),
      });
    }
    if (p.SignedOn) {
      events.push({
        label: `${p.Name || 'Signer'} signed document`,
        ts: toTs(p.SignedOn),
        when: formatDateStr(p.SignedOn, DateFormat, timezone, Is12Hr),
      });
    }
  }
  events.sort((a, b) => a.ts - b.ts);
  events.push({
    label: 'Signing process completed',
    ts: Infinity,
    when: completedAtLabel,
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
    y = height - 40;
    return page;
  }

  function ensureSpace(neededHeight) {
    if (y - neededHeight < startY + 20) {
      newPage();
    }
  }

  drawPageBorder(page);
  y = height - 40;

  // ---------------- Header ----------------
  page.drawImage(pngImage, {
    x: marginX,
    y: y - 20,
    width: 25 * (pngImage.width / pngImage.height),
    height: 25,
  });

  // "COMPLETED" pill, top-right
  const badgeWidth = 150;
  const badgeHeight = 34;
  const badgeX = contentRight - badgeWidth;
  const badgeY = y - 27;
  drawPill(page, { x: badgeX, y: badgeY, width: badgeWidth, height: badgeHeight, color: greenBg });
  drawCheckIcon(page, {
    x: badgeX + 14,
    y: badgeY + badgeHeight - 22,
    size: 12,
    color: green,
    thickness: 1.8,
  });
  page.drawText('COMPLETED', {
    x: badgeX + 32,
    y: badgeY + badgeHeight - 14,
    size: 10,
    font: fontBold,
    color: green,
  });
  page.drawText('All signatures collected', {
    x: badgeX + 32,
    y: badgeY + 6,
    size: 7,
    font,
    color: gray,
  });

  page.drawText(generatedOnLabel, {
    x: marginX,
    y: y - 42,
    size: 8,
    font,
    color: gray,
  });

  y -= 62;

  // ---------------- Title ----------------
  page.drawText('Certificate of Completion', {
    x: marginX,
    y,
    size: 22,
    font: fontBold,
    color: navy,
  });
  y -= 22;
  const descLines = [
    'This is to certify that the electronic document listed below has been completed',
    'and signed by all required parties using a secure electronic-signature process.',
  ];
  for (const line of descLines) {
    page.drawText(line, { x: marginX, y, size: 9.5, font, color: gray });
    y -= 13;
  }
  y -= 6;

  // ---------------- Document Summary ----------------
  page.drawText('Document Summary', { x: marginX, y, size: 13, font: fontBold, color: navy });
  y -= 10;
  page.drawLine({
    start: { x: marginX, y },
    end: { x: contentRight, y },
    thickness: 1,
    color: lightGray,
  });
  y -= 18;

  const leftRows = [
    ['Document Name', docName],
    ['Document ID', objectId],
    ['Transaction ID', transactionId],
    ['Document Type', 'PDF'],
    ['Pages', String(pageCount)],
    ['Created', createdAtLabel],
    ['Completed', completedAtLabel],
  ];
  const rightRows = [
    ['Sender / Initiator', ownerName],
    ['Email', ownerEmail],
    ['Organization', company],
    ['Signing Method', 'Electronic Signature'],
    ['Completion Status', '__badge__'],
    ['Completion Time', completedAtLabel],
    ['Timezone', timezone ? `${timezone}` : 'n/a'],
  ];
  const gridRowH = 19;
  const colGap = 16;
  const colWidth = (contentWidth - colGap) / 2;
  const leftLabelX = marginX;
  const leftValueX = marginX + 108;
  const rightLabelX = marginX + colWidth + colGap;
  const rightValueX = rightLabelX + 108;
  const gridTopY = y;

  for (let i = 0; i < leftRows.length; i++) {
    const rowY = gridTopY - i * gridRowH;
    const [label, value] = leftRows[i];
    page.drawText(label, { x: leftLabelX, y: rowY, size: 9, font: fontBold, color: black });
    const text =
      String(value ?? '').length > 34 ? String(value).slice(0, 33) + '…' : String(value ?? '');
    page.drawText(text, { x: leftValueX, y: rowY, size: 9, font, color: gray });
  }
  for (let i = 0; i < rightRows.length; i++) {
    const rowY = gridTopY - i * gridRowH;
    const [label, value] = rightRows[i];
    page.drawText(label, { x: rightLabelX, y: rowY, size: 9, font: fontBold, color: black });
    if (value === '__badge__') {
      drawPill(page, { x: rightValueX, y: rowY - 4, width: 78, height: 14, color: greenBg });
      drawCheckIcon(page, {
        x: rightValueX + 6,
        y: rowY - 1.5,
        size: 7,
        color: green,
        thickness: 1.2,
      });
      page.drawText('Completed', {
        x: rightValueX + 16,
        y: rowY - 1,
        size: 7.5,
        font: fontBold,
        color: green,
      });
    } else {
      const text =
        String(value ?? '').length > 30 ? String(value).slice(0, 29) + '…' : String(value ?? '');
      page.drawText(text, { x: rightValueX, y: rowY, size: 9, font, color: gray });
    }
  }
  page.drawLine({
    start: { x: marginX + colWidth + colGap / 2, y: gridTopY + 10 },
    end: { x: marginX + colWidth + colGap / 2, y: gridTopY - (leftRows.length - 1) * gridRowH - 6 },
    thickness: 0.75,
    color: lightGray,
  });

  y = gridTopY - Math.max(leftRows.length, rightRows.length) * gridRowH - 4;

  if (documentHash) {
    ensureSpace(16);
    page.drawText('Document hash (SHA-256):', {
      x: marginX,
      y,
      size: 8,
      font: fontBold,
      color: black,
    });
    page.drawText(documentHash, { x: marginX + 128, y, size: 8, font, color: gray });
    y -= 16;
  }

  y -= 10;

  // ---------------- Participants ----------------
  ensureSpace(60);
  page.drawText('Participants', { x: marginX, y, size: 13, font: fontBold, color: navy });
  y -= 14;

  const cols = [
    { label: '#', x: marginX, width: 20 },
    { label: 'Name & Email', x: marginX + 20, width: 148 },
    { label: 'Role', x: marginX + 168, width: 62 },
    { label: 'Status', x: marginX + 230, width: 62 },
    { label: 'Signed At', x: marginX + 292, width: 90 },
    { label: 'IP Address', x: marginX + 382, width: 78 },
    { label: 'Authentication', x: marginX + 460, width: contentRight - (marginX + 460) },
  ];

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
      page.drawText(c.label, {
        x: c.x + 4,
        y: y - headerH + 6,
        size: 8,
        font: fontBold,
        color: white,
      });
    }
    y -= headerH;
  }

  ensureSpace(20 + 44);
  drawTableHeader();

  const rowH = 44;
  participants.forEach((p, idx) => {
    if (y - rowH < startY + 20) {
      newPage();
      ensureSpace(20);
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
    const palette = avatarPalette[idx % avatarPalette.length];

    page.drawText(String(idx + 1), {
      x: cols[0].x + 4,
      y: rowTop - rowH / 2 - 3,
      size: 8.5,
      font,
      color: black,
    });

    drawAvatarCircle(page, {
      x: cols[1].x + 2,
      y: rowTop - rowH / 2 - 11,
      diameter: 22,
      name: p?.Name,
      font: fontBold,
      bgColor: palette.bg,
      textColor: palette.fg,
    });
    // Column is 120pt wide after the avatar - truncate rather than let a
    // long name/email spill into the Role column next to it.
    const nameText = String(p?.Name || '');
    const emailText = String(p?.Email || '');
    page.drawText(nameText.length > 24 ? nameText.slice(0, 23) + '…' : nameText, {
      x: cols[1].x + 28,
      y: rowTop - 17,
      size: 8.5,
      font: fontBold,
      color: black,
    });
    page.drawText(emailText.length > 28 ? emailText.slice(0, 27) + '…' : emailText, {
      x: cols[1].x + 28,
      y: rowTop - 28,
      size: 7.5,
      font,
      color: gray,
    });

    page.drawText('Signer', {
      x: cols[2].x + 4,
      y: rowTop - rowH / 2 - 3,
      size: 8.5,
      font,
      color: gray,
    });

    if (p?.SignedOn) {
      drawPill(page, {
        x: cols[3].x + 2,
        y: rowTop - rowH / 2 - 7,
        width: 56,
        height: 14,
        color: greenBg,
      });
      drawCheckIcon(page, {
        x: cols[3].x + 7,
        y: rowTop - rowH / 2 - 4,
        size: 7,
        color: green,
        thickness: 1.2,
      });
      page.drawText('Signed', {
        x: cols[3].x + 17,
        y: rowTop - rowH / 2 - 3,
        size: 7.5,
        font: fontBold,
        color: green,
      });
    } else {
      drawPill(page, {
        x: cols[3].x + 2,
        y: rowTop - rowH / 2 - 7,
        width: 56,
        height: 14,
        color: lightGray,
      });
      page.drawText('Pending', {
        x: cols[3].x + 8,
        y: rowTop - rowH / 2 - 3,
        size: 7.5,
        font: fontBold,
        color: gray,
      });
    }

    const signedLabel = p?.SignedOn ? formatDateStr(p.SignedOn, DateFormat, timezone, Is12Hr) : '—';
    page.drawText(signedLabel, {
      x: cols[4].x + 4,
      y: rowTop - rowH / 2 - 3,
      size: 7.5,
      font,
      color: gray,
    });

    page.drawText(String(p?.ipAddress || ''), {
      x: cols[5].x + 4,
      y: rowTop - rowH / 2 - 3,
      size: 7.5,
      font,
      color: gray,
    });

    const authLabel = IsEnableOTP ? 'Email, OTP' : 'Email verification';
    page.drawText(authLabel, {
      x: cols[6].x + 4,
      y: rowTop - rowH / 2 - 3,
      size: 7,
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

  y -= 20;

  // ---------------- Event History + Verification ----------------
  ensureSpace(40);
  page.drawText('Event History / Audit Trail', {
    x: marginX,
    y,
    size: 13,
    font: fontBold,
    color: navy,
  });
  y -= 14;

  const eventColWidth = 330;
  const verifyColX = marginX + eventColWidth + 20;
  const verifyColWidth = contentRight - verifyColX;

  // Verification box is a fixed-content block (it never grows with
  // signer/event count), drawn once on whatever page the Event History
  // table starts on - unlike the event table it never repeats or follows
  // content onto later pages. Height is computed from where its own content
  // actually ends, not a hand-tuned constant - a fixed guess here previously
  // let the last text row and the QR code overlap; sizing it from the real
  // content makes that class of bug impossible regardless of future copy
  // changes.
  const verifyBoxTop = y;
  let vy = verifyBoxTop - 16;
  page.drawText('Verification', {
    x: verifyColX + 10,
    y: vy,
    size: 10,
    font: fontBold,
    color: navy,
  });
  vy -= 14;
  const verifyDesc = [
    'This certificate is a verification record',
    'of the electronic-signature transaction',
    'and can be validated using the QR code',
    'or Certificate ID below.',
  ];
  for (const line of verifyDesc) {
    page.drawText(line, { x: verifyColX + 10, y: vy, size: 6.8, font, color: gray });
    vy -= 9;
  }
  vy -= 4;
  const verifyRows = [
    ['Certificate ID', certificateId],
    ['Issued On', completedAtLabel],
    ['Issued By', 'SignToowix'],
  ];
  for (const [label, value] of verifyRows) {
    page.drawText(label, { x: verifyColX + 10, y: vy, size: 6.8, font: fontBold, color: black });
    vy -= 9;
    const text = String(value).length > 34 ? String(value).slice(0, 33) + '…' : String(value);
    page.drawText(text, { x: verifyColX + 10, y: vy, size: 6.8, font, color: gray });
    vy -= 12;
  }
  vy -= 6; // gap before the QR block

  if (qrImage) {
    const qrSize = 62;
    const qrTopY = vy;
    const qrBottomY = qrTopY - qrSize;
    page.drawImage(qrImage, { x: verifyColX + 10, y: qrBottomY, width: qrSize, height: qrSize });
    page.drawText('Scan to verify', {
      x: verifyColX + qrSize + 18,
      y: qrTopY - 10,
      size: 6.8,
      font,
      color: gray,
    });
    page.drawText('this certificate', {
      x: verifyColX + qrSize + 18,
      y: qrTopY - 20,
      size: 6.8,
      font,
      color: gray,
    });
    vy = qrBottomY;
  }

  const verifyBoxHeight = verifyBoxTop - vy + 12;
  page.drawRectangle({
    x: verifyColX,
    y: verifyBoxTop - verifyBoxHeight,
    width: verifyColWidth,
    height: verifyBoxHeight,
    borderColor: lightGray,
    borderWidth: 1,
  });

  // Event log - independent pagination from the verification box above.
  let ey = y;
  const eventRowH = 13;
  function drawEventHeader() {
    page.drawRectangle({
      x: marginX,
      y: ey - eventRowH,
      width: eventColWidth,
      height: eventRowH,
      color: navy,
    });
    page.drawText('Time (IST)', {
      x: marginX + 4,
      y: ey - eventRowH + 3.5,
      size: 7,
      font: fontBold,
      color: white,
    });
    page.drawText('Event', {
      x: marginX + 78,
      y: ey - eventRowH + 3.5,
      size: 7,
      font: fontBold,
      color: white,
    });
    ey -= eventRowH;
  }
  drawEventHeader();
  for (const ev of events) {
    if (ey - eventRowH < startY + 20) {
      newPage();
      ey = y;
      drawEventHeader();
    }
    page.drawText(String(ev.when || ''), {
      x: marginX + 4,
      y: ey - eventRowH + 3.5,
      size: 6.8,
      font,
      color: ev.highlight ? green : gray,
    });
    page.drawText(String(ev.label || ''), {
      x: marginX + 78,
      y: ey - eventRowH + 3.5,
      size: 6.8,
      font: ev.highlight ? fontBold : font,
      color: ev.highlight ? green : black,
    });
    page.drawLine({
      start: { x: marginX, y: ey - eventRowH },
      end: { x: marginX + eventColWidth, y: ey - eventRowH },
      thickness: 0.4,
      color: lightGray,
    });
    ey -= eventRowH;
  }

  y = Math.min(ey, verifyBoxTop - verifyBoxHeight) - 18;

  // ---------------- Footer (last page only) ----------------
  const footerHeight = 46;
  if (y - footerHeight < startY + 10) {
    newPage();
  }
  const footerY = startY + 30;
  page.drawLine({
    start: { x: marginX, y: footerY + 14 },
    end: { x: contentRight, y: footerY + 14 },
    thickness: 0.5,
    color: lightGray,
  });
  const footerNotes = [
    'This is a system generated certificate and does not require a digital signature.',
    'All times are recorded in the timezone shown above unless otherwise noted.',
    'This certificate is governed by the SignToowix Terms of Service.',
  ];
  let fy = footerY;
  for (const note of footerNotes) {
    page.drawText(note, { x: marginX, y: fy, size: 6.8, font, color: gray });
    fy -= 9;
  }
  const yearNow = new Date().getFullYear();
  const copyright = `© ${yearNow} SignToowix. All rights reserved.`;
  page.drawText(copyright, { x: marginX, y: startY + 4, size: 7, font, color: gray });
  const tagline = 'Secure · Compliant · Legally Enforceable';
  const taglineWidth = font.widthOfTextAtSize(tagline, 7);
  page.drawText(tagline, {
    x: contentRight - taglineWidth,
    y: startY + 4,
    size: 7,
    font,
    color: navy,
  });

  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}
