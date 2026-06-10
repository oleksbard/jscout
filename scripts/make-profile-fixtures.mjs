// Generates the test-fixture PDFs in fixtures/. Run: node scripts/make-profile-fixtures.mjs
import { writeFileSync } from 'node:fs';

function buildPdf(lines) {
  const content = lines.length
    ? `BT /F1 12 Tf 72 720 Td\n${lines.map((l) => `(${l}) Tj 0 -16 Td`).join('\n')}\nET`
    : '';
  const streamBody = content.length ? `${content}\n` : '';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${streamBody.length} >>\nstream\n${streamBody}endstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (const [i, body] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(pdf, 'ascii');
}

writeFileSync(
  'fixtures/profile.pdf',
  buildPdf([
    'PROFILE FIXTURE Senior Frontend Engineer',
    'Stack: React, TypeScript, Node. Based in Berlin, Germany.',
    'Open to senior, staff, lead and engineering manager roles.',
    'Experience: 10 years building web products end to end.',
    'Languages: English fluent. Applications in English only.',
    'Preferences: remote EU or hybrid in Germany or Berlin onsite.',
  ]),
);
writeFileSync('fixtures/profile-scanned.pdf', buildPdf([]));
console.log('wrote fixtures/profile.pdf and fixtures/profile-scanned.pdf');
