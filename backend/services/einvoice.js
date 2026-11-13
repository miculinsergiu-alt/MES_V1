/**
 * Electronic invoices (EN 16931): ZUGFeRD / Factur-X (PDF with embedded XML)
 * and XRechnung (XML), generated with @e-invoice-eu/core.
 *
 * The invoice is described once in the library's UBL-based JSON format and
 * rendered into the required syntax by the library.
 */
const { InvoiceService } = require('@e-invoice-eu/core');
const { VATEX } = require('../lib/vat');
const { badRequest } = require('../lib/errors');

const FORMATS = {
  zugferd: 'Factur-X-EN16931',
  xrechnung: 'XRECHNUNG-CII',
};

// German / common unit names -> UN/ECE Recommendation 20 codes (required in e-invoices)
const UNIT_CODES = {
  stk: 'H87', 'stk.': 'H87', st: 'H87', 'st.': 'H87', 'stück': 'H87', stueck: 'H87', pcs: 'H87', pc: 'H87', buc: 'H87', ea: 'H87',
  kg: 'KGM', g: 'GRM', t: 'TNE', to: 'TNE',
  m: 'MTR', mm: 'MMT', cm: 'CMT', km: 'KMT', lfm: 'MTR',
  m2: 'MTK', 'm²': 'MTK', qm: 'MTK', m3: 'MTQ', 'm³': 'MTQ', cbm: 'MTQ',
  l: 'LTR', ltr: 'LTR', ml: 'MLT',
  h: 'HUR', std: 'HUR', 'std.': 'HUR', stunde: 'HUR', stunden: 'HUR', min: 'MIN', tag: 'DAY', tage: 'DAY', d: 'DAY',
  psch: 'LS', pauschal: 'LS', 'psch.': 'LS', pausch: 'LS',
  satz: 'SET', set: 'SET', paar: 'PR', karton: 'CT', pal: 'PF', palette: 'PF', rolle: 'RO', pack: 'PK', pkg: 'PK',
};

function unitCode(unit) {
  const u = String(unit || '').trim().toLowerCase();
  if (UNIT_CODES[u]) return UNIT_CODES[u];
  if (/^[A-Z0-9]{2,3}$/.test(String(unit || '').trim())) return String(unit).trim(); // already a code
  return 'C62'; // "one" (unit)
}

const amount = (v) => Number(v).toFixed(2);
const qty = (v) => String(Number(Number(v).toFixed(3)));
const price = (v) => String(Number(Number(v).toFixed(4)));

function splitAddress(street) {
  return street ? { 'cbc:StreetName': street } : {};
}

/** Customer postal data from the frozen document address ("Name\nName2\nStreet\nPLZ City\nCountry"). */
function customerPostal(doc, customer) {
  return {
    ...splitAddress(customer?.street),
    ...(customer?.city ? { 'cbc:CityName': customer.city } : {}),
    ...(customer?.postal_code ? { 'cbc:PostalZone': customer.postal_code } : {}),
    'cac:Country': { 'cbc:IdentificationCode': doc.customer_country === 'EL' ? 'GR' : (doc.customer_country || 'DE') },
  };
}

function paymentTermsNote(doc) {
  const parts = [];
  if (doc.due_date) parts.push(`Zahlbar bis ${doc.due_date.split('-').reverse().join('.')} ohne Abzug.`);
  if (doc.skonto_days && Number(doc.skonto_percent) > 0) {
    // German XRechnung convention for early payment discount (rule BR-DE-18);
    // the Skonto line must end with a line break.
    parts.push(`#SKONTO#TAGE=${doc.skonto_days}#PROZENT=${Number(doc.skonto_percent).toFixed(2)}#\n`);
  }
  return parts.join('\n');
}

/**
 * Builds the invoice in the library's internal (UBL-like) JSON format.
 * doc: issued sales document with lines; company: companies row; customer: customers row.
 */
function buildInvoiceData(doc, company, customer, { originalInvoice } = {}) {
  if (!['invoice', 'credit_note'].includes(doc.doc_type)) throw badRequest('Only invoices and credit notes can be e-invoices');
  const cur = doc.currency || 'EUR';
  const sellerVat = company.vat_id;
  const notes = [doc.intro_text, doc.closing_text].filter(Boolean).join('\n');

  const sellerTaxSchemes = [];
  if (sellerVat) sellerTaxSchemes.push({ 'cbc:CompanyID': sellerVat, 'cac:TaxScheme': { 'cbc:ID': 'VAT' } });
  if (company.tax_number) sellerTaxSchemes.push({ 'cbc:CompanyID': company.tax_number, 'cac:TaxScheme': { 'cbc:ID': 'FC' } });

  const legalInfo = [
    company.register_court && company.register_number ? `${company.register_court}, ${company.register_number}` : null,
    company.managing_directors ? `Geschäftsführung: ${company.managing_directors}` : null,
  ].filter(Boolean).join('; ');

  const sellerEmail = company.email || undefined;
  const buyerEmail = customer?.invoice_email || customer?.email || undefined;

  const hasExempt = doc.lines.some((l) => l.tax_category !== 'S');

  const invoice = {
    'cbc:ID': doc.number,
    'cbc:IssueDate': doc.document_date,
    ...(doc.due_date ? { 'cbc:DueDate': doc.due_date } : {}),
    'cbc:InvoiceTypeCode': doc.doc_type === 'credit_note' ? '381' : '380',
    ...(notes ? { 'cbc:Note': notes } : {}),
    'cbc:DocumentCurrencyCode': cur,
    'cbc:BuyerReference': doc.buyer_reference || doc.customer_reference || customer?.customer_number || doc.number,
    ...(doc.service_date && doc.service_period_end ? {
      'cac:InvoicePeriod': { 'cbc:StartDate': doc.service_date, 'cbc:EndDate': doc.service_period_end },
    } : {}),
    ...(doc.customer_reference ? { 'cac:OrderReference': { 'cbc:ID': doc.customer_reference } } : {}),
    ...(originalInvoice ? {
      'cac:BillingReference': [{ 'cac:InvoiceDocumentReference': { 'cbc:ID': originalInvoice.number, 'cbc:IssueDate': originalInvoice.document_date } }],
    } : {}),
    'cac:AccountingSupplierParty': {
      'cac:Party': {
        ...(sellerEmail ? { 'cbc:EndpointID': sellerEmail, 'cbc:EndpointID@schemeID': 'EM' } : {}),
        'cac:PartyName': { 'cbc:Name': company.name },
        'cac:PostalAddress': {
          ...splitAddress(company.street),
          'cbc:CityName': company.city,
          'cbc:PostalZone': company.postal_code,
          'cac:Country': { 'cbc:IdentificationCode': company.country || 'DE' },
        },
        ...(sellerTaxSchemes.length ? { 'cac:PartyTaxScheme': sellerTaxSchemes } : {}),
        'cac:PartyLegalEntity': {
          'cbc:RegistrationName': company.legal_name || company.name,
          ...(company.register_number ? { 'cbc:CompanyID': company.register_number } : {}),
          ...(legalInfo ? { 'cbc:CompanyLegalForm': legalInfo } : {}),
        },
        'cac:Contact': {
          'cbc:Name': company.legal_name || company.name,
          ...(company.phone ? { 'cbc:Telephone': company.phone } : {}),
          ...(sellerEmail ? { 'cbc:ElectronicMail': sellerEmail } : {}),
        },
      },
    },
    'cac:AccountingCustomerParty': {
      'cac:Party': {
        ...(buyerEmail ? { 'cbc:EndpointID': buyerEmail, 'cbc:EndpointID@schemeID': 'EM' } : {}),
        ...(customer?.customer_number ? { 'cac:PartyIdentification': { 'cbc:ID': customer.customer_number } } : {}),
        'cac:PostalAddress': customerPostal(doc, customer),
        ...(doc.customer_vat_id ? { 'cac:PartyTaxScheme': { 'cbc:CompanyID': doc.customer_vat_id, 'cac:TaxScheme': { 'cbc:ID': 'VAT' } } } : {}),
        'cac:PartyLegalEntity': { 'cbc:RegistrationName': doc.customer_name },
      },
    },
    ...(() => {
      const delivery = {
        ...(doc.service_date && !doc.service_period_end ? { 'cbc:ActualDeliveryDate': doc.service_date } : {}),
        // Intra-Community supplies must state the country of delivery (BR-IC-12).
        ...(hasExempt ? { 'cac:DeliveryLocation': { 'cac:Address': customerPostal(doc, customer) } } : {}),
      };
      return Object.keys(delivery).length ? { 'cac:Delivery': delivery } : {};
    })(),
    ...(company.iban ? {
      'cac:PaymentMeans': [{
        'cbc:PaymentMeansCode': '58', // SEPA credit transfer
        'cbc:PaymentID': doc.number,
        'cac:PayeeFinancialAccount': {
          'cbc:ID': company.iban,
          'cbc:Name': company.legal_name || company.name,
          ...(company.bic ? { 'cac:FinancialInstitutionBranch': { 'cbc:ID': company.bic } } : {}),
        },
      }],
    } : {}),
    ...(paymentTermsNote(doc) ? { 'cac:PaymentTerms': { 'cbc:Note': paymentTermsNote(doc) } } : {}),
    'cac:TaxTotal': [{
      'cbc:TaxAmount': amount(doc.tax_total),
      'cbc:TaxAmount@currencyID': cur,
      'cac:TaxSubtotal': doc.tax_breakdown.map((b) => ({
        'cbc:TaxableAmount': amount(b.net_amount),
        'cbc:TaxableAmount@currencyID': cur,
        'cbc:TaxAmount': amount(b.tax_amount),
        'cbc:TaxAmount@currencyID': cur,
        'cac:TaxCategory': {
          'cbc:ID': b.tax_category,
          'cbc:Percent': amount(b.tax_rate),
          ...(VATEX[b.tax_category] ? {
            'cbc:TaxExemptionReasonCode': VATEX[b.tax_category].code,
            'cbc:TaxExemptionReason': VATEX[b.tax_category].text,
          } : {}),
          'cac:TaxScheme': { 'cbc:ID': 'VAT' },
        },
      })),
    }],
    'cac:LegalMonetaryTotal': {
      'cbc:LineExtensionAmount': amount(doc.net_total),
      'cbc:LineExtensionAmount@currencyID': cur,
      'cbc:TaxExclusiveAmount': amount(doc.net_total),
      'cbc:TaxExclusiveAmount@currencyID': cur,
      'cbc:TaxInclusiveAmount': amount(doc.gross_total),
      'cbc:TaxInclusiveAmount@currencyID': cur,
      'cbc:PayableAmount': amount(doc.gross_total),
      'cbc:PayableAmount@currencyID': cur,
    },
    'cac:InvoiceLine': doc.lines.map((l) => {
      const gross = Math.round(Number(l.quantity) * Number(l.unit_price) * 100) / 100;
      const allowance = Math.round((gross - Number(l.line_net)) * 100) / 100;
      const [name, ...rest] = String(l.description).split('\n');
      return {
        'cbc:ID': String(l.position),
        'cbc:InvoicedQuantity': qty(l.quantity),
        'cbc:InvoicedQuantity@unitCode': unitCode(l.unit),
        'cbc:LineExtensionAmount': amount(l.line_net),
        'cbc:LineExtensionAmount@currencyID': cur,
        ...(allowance > 0 ? {
          'cac:AllowanceCharge': [{
            'cbc:ChargeIndicator': 'false',
            'cbc:AllowanceChargeReason': `Rabatt ${Number(l.discount_percent)} %`,
            'cbc:MultiplierFactorNumeric': String(Number(l.discount_percent)),
            'cbc:Amount': amount(allowance),
            'cbc:Amount@currencyID': cur,
            'cbc:BaseAmount': amount(gross),
            'cbc:BaseAmount@currencyID': cur,
          }],
        } : {}),
        'cac:Item': {
          ...(rest.length ? { 'cbc:Description': rest.join('\n') } : {}),
          'cbc:Name': name.slice(0, 200) || 'Position',
          ...(l.item_code ? { 'cac:SellersItemIdentification': { 'cbc:ID': l.item_code } } : {}),
          'cac:ClassifiedTaxCategory': {
            'cbc:ID': l.tax_category,
            'cbc:Percent': amount(l.tax_rate),
            'cac:TaxScheme': { 'cbc:ID': 'VAT' },
          },
        },
        'cac:Price': {
          'cbc:PriceAmount': price(l.unit_price),
          'cbc:PriceAmount@currencyID': cur,
        },
      };
    }),
  };
  return { 'ubl:Invoice': invoice };
}

/** Problems that make an XRechnung impossible (stricter than ZUGFeRD). */
function xrechnungProblems(company, customer) {
  const p = [];
  if (!company.email) p.push('Company e-mail address (Settings) is required for XRechnung');
  if (!company.phone) p.push('Company phone number (Settings) is required for XRechnung');
  if (!(customer?.invoice_email || customer?.email)) p.push('Customer e-mail address is required for XRechnung');
  return p;
}

const silentLogger = { log() {}, warn() {}, error(...a) { console.error(...a); } };

/**
 * Renders an e-invoice.
 * kind 'zugferd': returns a PDF/A-3 with embedded XML (needs the visual PDF).
 * kind 'xrechnung': returns the XML.
 */
async function render(kind, data, { pdf, filename } = {}) {
  const service = new InvoiceService(silentLogger);
  const options = { format: FORMATS[kind], lang: 'de-de' };
  if (kind === 'zugferd') {
    options.pdf = { buffer: pdf, filename: filename || 'invoice.pdf', mimetype: 'application/pdf' };
  }
  const out = await service.generate(data, options);
  return Buffer.isBuffer(out) ? out : Buffer.from(out);
}

module.exports = { buildInvoiceData, render, unitCode, xrechnungProblems, FORMATS };
