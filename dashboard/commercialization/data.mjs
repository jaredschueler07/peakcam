import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';

const SPECS = {
  actions: ['Action_Register.csv', 'ID', 'Execution_action', ['Priority', 'Remaining_hours_estimate', 'Current_evidence', 'Completed_at', 'Evidence_link']],
  prospects: ['Prospect_Queue.csv', 'Prospect_ID', 'Company', ['Wave', 'Current_contact_route', 'Verification_note', 'Rechecked_local_date', 'Next_action', 'Status', 'Sender_identity_confirmed', 'Send_authorized', 'Sent_at', 'Last_touch', 'Next_followup', 'Opted_out', 'Qualified_buyer_or_licensor', 'Rights_proof', 'Deal_amount_USD', 'Currency', 'Commercial_evidence']],
  cameras: ['Camera_Source_Register.csv', 'Camera_ID', 'Camera_name', ['Last_manual_check_UTC', 'Source_owner_legal_entity', 'Licensor_authority', 'Rights_status', 'Commercial_embed_permission', 'Preview_hotlink_permission', 'Capture_storage_permission', 'Social_email_reuse_permission', 'Paid_ads_permission', 'Proof_reference', 'Approved_domains_territories', 'Required_credit', 'Cache_limit', 'Expiry', 'Revocation_contact', 'Fees_USD', 'Priority', 'Next_action']],
  resorts: ['Resort_Coverage.csv', 'Resort_ID', 'Name', ['Pilot_candidate', 'Manual_source_check', 'Rights_review', 'Certified_for_promotion', 'Next_action']],
  experiments: ['Experiment_Plan.csv', 'ID', 'Hypothesis', ['Learning', 'Execution_status', 'Result_sample_size', 'Result_numerator', 'Result_denominator', 'Observation_window', 'Evidence_link', 'Decision']],
  risks: ['Risk_Review.csv', 'ID', 'Risk', ['Mitigation', 'Current_exposure', 'Control_evidence', 'Review_status']],
  costs: ['Operating_Cost_Inputs.csv', 'Service', 'Service', ['Invoice_period', 'Actual_paid_USD', 'Committed_monthly_USD', 'One_time_USD', 'Renewal_date', 'Evidence_link', 'Input_status']],
  events: ['Event_Mapping.csv', 'Portfolio_event', 'Portfolio_event', ['Review', 'Validation', 'Production_payload_verified']],
  issues: ['Issue_Triage.csv', 'Issue', 'Title', ['Triage', 'Verified_fixed', 'Evidence']],
  chapters: ['Chapter_Coverage.csv', 'Chapter', 'Source_file', ['Review_disposition']],
  scenarios: ['Financial_Stress_Scenarios.csv', 'Scenario', 'Scenario', []],
  gates: ['Season_Gates.csv', 'ID', 'Gate', ['Actual_result', 'Decision']],
};

const DESCRIPTIONS = { actions: 'Execution actions and current-state work', prospects: 'Commercial prospect queue', cameras: 'Camera source and permissions register', resorts: 'Resort pilot coverage', experiments: 'Experiments and learning plan', risks: 'Commercial risk review', costs: 'Operating cost inputs', events: 'Measurement event mapping', issues: 'Issue triage', chapters: 'Source chapter coverage', scenarios: 'Financial stress scenarios', gates: 'Season gates and outcomes' };
const STATUSES = new Set(['Not started', 'In progress', 'Blocked', 'Done', 'Deferred']);
const DATE_FIELDS = /(^|_)(date|at|deadline|followup|expiry|renewal)$/i;
const NUM_FIELDS = /(_USD$|Remaining_hours_estimate$|Result_(sample_size|numerator|denominator)$)/;

function readCsv(file) {
  if (!fs.existsSync(file)) throw new Error(`Required register missing: ${path.basename(file)}`);
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  if (!text.trim()) return { columns: [], rows: [] };
  const rows = parse(text, { columns: true, skip_empty_lines: true, bom: true, trim: false });
  const columns = rows.length ? Object.keys(rows[0]) : parse(text.split(/\r?\n/)[0], { bom: true })[0] || [];
  return { columns, rows: rows.map(row => Object.fromEntries(columns.map(c => [c, row[c] ?? '']))) };
}
function clean(v) { return typeof v === 'string' ? v.slice(0, 10000) : v; }

export function loadDatasets(sourceDir, state = {}) {
  const datasets = Object.entries(SPECS).map(([key, [file, idField, titleField, editable]]) => {
    // Season gates are maintained beside the tracker UI; accepting a sourceDir
    // copy keeps isolated tests and future exports straightforward.
    const candidate = path.join(sourceDir, file);
    const gateFallback = path.join(path.dirname(fileURLToPath(import.meta.url)), file);
    const { columns, rows } = readCsv(fs.existsSync(candidate) || key !== 'gates' ? candidate : gateFallback);
    const saved = state.records?.[key] || {};
    return { key, label: key[0].toUpperCase() + key.slice(1), description: DESCRIPTIONS[key], idField, titleField, columns, editableFields: editable.filter(c => columns.includes(c)), rows: rows.map((source, index) => {
      const id = String(source[idField] ?? index + 1);
      const prior = saved[id] || {};
      let status = prior.status || 'Not started';
      if (!prior.status && key === 'actions' && /partially/i.test(source.Disposition || '')) status = 'In progress';
      if (!prior.status && key === 'actions' && source.Completed_at && source.Evidence_link) status = 'Done';
      const original = Object.fromEntries(columns.map(c => [c, clean(source[c] ?? '')]));
      return { id, source: original, tracking: { status, owner: prior.owner ?? source.Owner ?? source.Operational_owner ?? '', due: prior.due ?? source.Proposed_deadline ?? source.Proposed_action_date ?? source.Deadline ?? source.Target_date ?? '', notes: prior.notes || '', evidence: prior.evidence ?? source.Evidence_link ?? '', fields: prior.fields || {} } };
    }) };
  });
  return datasets;
}

export function mergedSource(row) { return { ...row.source, ...(row.tracking.fields || {}) }; }
export { SPECS, STATUSES, DATE_FIELDS, NUM_FIELDS };
