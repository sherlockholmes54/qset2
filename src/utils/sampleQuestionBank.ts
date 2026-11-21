import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

/**
 * Generates a realistic 3-page STEM Question Bank PDF entirely client-side
 * so users can immediately test scanning, cropping, and merging question sets.
 */
export async function createSampleQuestionBankPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 44;

  const drawHeader = (page: ReturnType<typeof doc.addPage>, title: string, pageNum: number) => {
    page.drawText(title, {
      x: margin,
      y: pageHeight - 40,
      size: 13,
      font: bold,
      color: rgb(0.08, 0.12, 0.2),
    });
    page.drawText(`Question Bank · Page ${pageNum} of 3`, {
      x: pageWidth - margin - 145,
      y: pageHeight - 40,
      size: 9.5,
      font,
      color: rgb(0.42, 0.48, 0.56),
    });
    page.drawLine({
      start: { x: margin, y: pageHeight - 50 },
      end: { x: pageWidth - margin, y: pageHeight - 50 },
      thickness: 0.75,
      color: rgb(0.82, 0.86, 0.91),
    });
  };

  // Page 1: Mechanics & Kinematics
  const p1 = doc.addPage([pageWidth, pageHeight]);
  drawHeader(p1, 'Comprehensive Physics & Mathematics Question Bank', 1);

  const p1Questions = [
    {
      y: 755,
      q: '1. A projectile is launched from level ground with an initial speed of 40 m/s at an angle of 30 deg',
      q2: 'above the horizontal. Neglecting air resistance (g = 9.8 m/s^2), what is the maximum height reached?',
      opts: ['(A) 10.2 m', '(B) 20.4 m', '(C) 40.8 m', '(D) 81.6 m'],
    },
    {
      y: 625,
      q: '2. A block of mass 4.0 kg rests on a rough horizontal table (mu_s = 0.45, mu_k = 0.30).',
      q2: 'A horizontal force of 15 N is applied. What is the magnitude of the friction force acting on it?',
      opts: ['(A) 11.8 N', '(B) 15.0 N', '(C) 17.6 N', '(D) 39.2 N'],
    },
    {
      y: 495,
      q: '3. Two capacitors of 6 uF and 12 uF are connected in series across a 24 V DC source.',
      q2: 'Find the total energy stored in the equivalent capacitor combination.',
      opts: ['(A) 0.58 mJ', '(B) 1.15 mJ', '(C) 2.30 mJ', '(D) 5.18 mJ'],
    },
    {
      y: 350,
      q: '4. Refer to the velocity-time graph below for a particle moving along a straight line.',
      q2: 'Calculate the total displacement of the particle between t = 0 s and t = 8 s.',
      opts: ['(A) 24 m', '(B) 36 m', '(C) 48 m', '(D) 60 m'],
      diagram: 'vt',
    },
  ];

  p1Questions.forEach((item) => {
    p1.drawText(item.q, { x: margin, y: item.y, size: 11, font: bold, color: rgb(0.08, 0.12, 0.2) });
    p1.drawText(item.q2, { x: margin + 14, y: item.y - 16, size: 10.5, font, color: rgb(0.18, 0.24, 0.33) });

    if (item.diagram === 'vt') {
      const gx = margin + 30;
      const gy = item.y - 130;
      p1.drawRectangle({
        x: gx - 10,
        y: gy - 12,
        width: 240,
        height: 98,
        borderColor: rgb(0.84, 0.87, 0.91),
        borderWidth: 0.75,
        color: rgb(0.98, 0.99, 1),
      });
      // Axes
      p1.drawLine({ start: { x: gx + 15, y: gy + 5 }, end: { x: gx + 210, y: gy + 5 }, thickness: 1.2, color: rgb(0.2, 0.25, 0.35) });
      p1.drawLine({ start: { x: gx + 15, y: gy + 5 }, end: { x: gx + 15, y: gy + 74 }, thickness: 1.2, color: rgb(0.2, 0.25, 0.35) });
      // Trapezoid velocity curve
      p1.drawLine({ start: { x: gx + 15, y: gy + 5 }, end: { x: gx + 75, y: gy + 60 }, thickness: 2, color: rgb(0.15, 0.39, 0.92) });
      p1.drawLine({ start: { x: gx + 75, y: gy + 60 }, end: { x: gx + 155, y: gy + 60 }, thickness: 2, color: rgb(0.15, 0.39, 0.92) });
      p1.drawLine({ start: { x: gx + 155, y: gy + 60 }, end: { x: gx + 195, y: gy + 5 }, thickness: 2, color: rgb(0.15, 0.39, 0.92) });
      p1.drawText('v (m/s)', { x: gx - 2, y: gy + 75, size: 8, font: bold, color: rgb(0.25, 0.3, 0.4) });
      p1.drawText('t (s):  0       2            6      8', { x: gx + 14, y: gy - 6, size: 8, font, color: rgb(0.35, 0.4, 0.48) });
      p1.drawText('12', { x: gx + 2, y: gy + 57, size: 8, font, color: rgb(0.35, 0.4, 0.48) });
    }

    const optY = item.diagram ? item.y - 165 : item.y - 44;
    item.opts.forEach((opt, idx) => {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      p1.drawText(opt, {
        x: margin + 22 + col * 210,
        y: optY - row * 18,
        size: 10,
        font,
        color: rgb(0.18, 0.24, 0.33),
      });
    });
  });

  // Page 2: Calculus & Algebra
  const p2 = doc.addPage([pageWidth, pageHeight]);
  drawHeader(p2, 'Calculus, Functions & Linear Algebra', 2);

  const p2Questions = [
    {
      y: 755,
      q: '5. Evaluate the definite integral:  I = integral from 0 to pi/2 of (sin x) / (sin x + cos x) dx.',
      q2: 'Show all intermediate symmetry steps or choose the exact value below.',
      opts: ['(A) pi / 6', '(B) pi / 4', '(C) pi / 2', '(D) 1'],
    },
    {
      y: 625,
      q: '6. Let f(x) = x^3 - 6x^2 + 9x + 2 for x in [0, 5].',
      q2: 'Determine the local maximum and absolute minimum values of f(x) on this closed interval.',
      opts: ['(A) Max = 6, Min = 2', '(B) Max = 22, Min = 2', '(C) Max = 6, Min = -2', '(D) Max = 22, Min = 0'],
    },
    {
      y: 495,
      q: '7. Find the eigenvalues of the 2x2 real symmetric matrix A = [[4, 2], [2, 4]].',
      q2: 'Also determine whether A is positive definite.',
      opts: ['(A) 2 and 6 (Positive definite)', '(B) -2 and 6 (Indefinite)', '(C) 4 and 4 (Positive)', '(D) 0 and 8 (Semi-definite)'],
    },
    {
      y: 365,
      q: '8. A tangent is drawn to the parabola y^2 = 8x at the point P(2, 4).',
      q2: 'Find the coordinates of the point where this tangent intersects the x-axis.',
      opts: ['(A) (-2, 0)', '(B) (-1, 0)', '(C) (0, 0)', '(D) (1, 0)'],
    },
  ];

  p2Questions.forEach((item) => {
    p2.drawText(item.q, { x: margin, y: item.y, size: 11, font: bold, color: rgb(0.08, 0.12, 0.2) });
    p2.drawText(item.q2, { x: margin + 14, y: item.y - 16, size: 10.5, font, color: rgb(0.18, 0.24, 0.33) });
    item.opts.forEach((opt, idx) => {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      p2.drawText(opt, {
        x: margin + 22 + col * 220,
        y: item.y - 46 - row * 18,
        size: 10,
        font,
        color: rgb(0.18, 0.24, 0.33),
      });
    });
  });

  // Page 3: Geometry & Chemistry
  const p3 = doc.addPage([pageWidth, pageHeight]);
  drawHeader(p3, 'Coordinate Geometry & General Chemistry', 3);

  const p3Questions = [
    {
      y: 755,
      q: '9. In a right triangle ABC (right-angled at B), AB = 9 cm and BC = 12 cm.',
      q2: 'What is the radius of the circle inscribed inside triangle ABC?',
      opts: ['(A) 2.5 cm', '(B) 3.0 cm', '(C) 3.5 cm', '(D) 4.0 cm'],
    },
    {
      y: 615,
      q: '10. Calculate the pH of a 0.01 M aqueous solution of acetic acid (CH3COOH) at 25 deg C.',
      q2: 'Given: Acid dissociation constant Ka = 1.8 x 10^-5.',
      opts: ['(A) 2.37', '(B) 3.37', '(C) 4.74', '(D) 5.12'],
    },
    {
      y: 475,
      q: '11. An ideal monatomic gas undergoes an isobaric expansion at 2.0 atm from 3.0 L to 8.0 L.',
      q2: 'Compute the work done by the gas in Joules (1 L*atm = 101.3 J).',
      opts: ['(A) 506.5 J', '(B) 810.4 J', '(C) 1013.0 J', '(D) 1620.8 J'],
    },
  ];

  p3Questions.forEach((item) => {
    p3.drawText(item.q, { x: margin, y: item.y, size: 11, font: bold, color: rgb(0.08, 0.12, 0.2) });
    p3.drawText(item.q2, { x: margin + 14, y: item.y - 16, size: 10.5, font, color: rgb(0.18, 0.24, 0.33) });
    item.opts.forEach((opt, idx) => {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      p3.drawText(opt, {
        x: margin + 22 + col * 220,
        y: item.y - 46 - row * 18,
        size: 10,
        font,
        color: rgb(0.18, 0.24, 0.33),
      });
    });
  });

  return doc.save();
}
