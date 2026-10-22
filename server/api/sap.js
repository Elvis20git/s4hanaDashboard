// Read-only OData v2 client for S/4HANA Public Cloud.
// Hard guarantee: GET only. No POST/PATCH/DELETE ever reaches production.
import { CFG, redact } from '../lib/env.js';

const AUTH = 'Basic ' + Buffer.from(`${CFG.SAP_USER}:${CFG.SAP_PASS}`).toString('base64');

export const SERVICES = {
  billing:  '/sap/opu/odata/sap/API_BILLING_DOCUMENT_SRV',
  delivery: '/sap/opu/odata/sap/API_INBOUND_DELIVERY_SRV;v=0002',
  orderBatch: '/sap/opu/odata/sap/YY1_AIF_ORDER_BATCH_CDS',
  journal:  '/sap/opu/odata/sap/YY1_AIF_JOURNAL_REV_CDS',
  product:  '/sap/opu/odata/sap/API_PRODUCT_SRV',
  bp:       '/sap/opu/odata/sap/API_BUSINESS_PARTNER',
};

export class SapError extends Error {
  constructor(msg, { status, url } = {}) {
    super(redact(msg));
    this.name = 'SapError';
    this.status = status;
    this.url = redact(url || '');
  }
}

let callCount = 0;
export const stats = () => ({ calls: callCount });

async function rawGet(url, { timeout = 120000, accept = 'application/json' } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  callCount++;
  try {
    const res = await fetch(url, {
      method: 'GET',                        // read-only, always
      headers: { Authorization: AUTH, Accept: accept },
      signal: ctl.signal,
    });
    const body = await res.text();
    if (!res.ok) {
      let detail = body.slice(0, 400);
      try { detail = JSON.parse(body)?.error?.message?.value ?? detail; } catch {}
      throw new SapError(`HTTP ${res.status} — ${detail}`, { status: res.status, url });
    }
    return body;
  } catch (e) {
    if (e instanceof SapError) throw e;
    throw new SapError(`${e.name}: ${e.message}`, { url });
  } finally {
    clearTimeout(timer);
  }
}

/** Raw $metadata XML for a service. */
export function metadata(service) {
  return rawGet(CFG.SAP_HOST + SERVICES[service] + '/$metadata', { accept: 'application/xml' });
}

/** One page of an entity set as parsed JSON. */
export async function getJson(service, entitySet, params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') qs.set(k, v);
  qs.set('$format', 'json');
  const url = `${CFG.SAP_HOST}${SERVICES[service]}/${entitySet}?${qs}`;
  const body = await rawGet(url);
  let j;
  try { j = JSON.parse(body); }
  catch { throw new SapError('Response was not JSON (check entity set name)', { url }); }
  return j.d ?? j;
}

/** Page through an entity set until exhausted. Returns all rows. */
export async function getAll(service, entitySet, params = {}, { page = 5000, max = Infinity, onPage } = {}) {
  const rows = [];
  let skip = 0;
  for (;;) {
    const d = await getJson(service, entitySet, { ...params, $top: page, $skip: skip });
    const batch = d.results ?? (Array.isArray(d) ? d : []);
    rows.push(...batch);
    if (onPage) onPage(rows.length);
    if (batch.length < page || rows.length >= max) break;
    skip += page;
  }
  return rows;
}

/** OData v2 Edm.Decimal/String numeric -> JS number. */
export const num = v => (v == null || v === '' ? 0 : Number(v));

/** /Date(1767225600000)/ or ISO -> 'YYYY-MM-DD'. */
export function odataDate(v) {
  if (!v) return null;
  const m = /\/Date\((-?\d+)/.exec(v);
  const d = m ? new Date(Number(m[1])) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * Fetch an entity set filtered by a set of key values, chunked to keep $filter short.
 * Deduplicates the key list first (rule 8 — several batches share one order).
 */
export async function getByKeys(service, entitySet, field, keys, { chunk = 50, params = {}, onChunk } = {}) {
  const uniq = [...new Set(keys.filter(k => k != null && k !== ''))];
  const rows = [];
  for (let i = 0; i < uniq.length; i += chunk) {
    const slice = uniq.slice(i, i + chunk);
    const filter = slice.map(k => `${field} eq '${String(k).replace(/'/g, "''")}'`).join(' or ');
    const base = params.$filter ? `(${params.$filter}) and (${filter})` : filter;
    rows.push(...await getAll(service, entitySet, { ...params, $filter: base }, { page: 5000 }));
    if (onChunk) onChunk(Math.min(i + chunk, uniq.length), uniq.length, rows.length);
  }
  return rows;
}
