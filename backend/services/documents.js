/**
 * PDF and e-invoice generation (filled in by the PDF/e-invoice step).
 */
const { AppError } = require('../lib/errors');

async function archiveDocument() {}

async function pdfFor() {
  throw new AppError(501, 'NOT_IMPLEMENTED', 'PDF generation is not available yet');
}

module.exports = { archiveDocument, pdfFor };
