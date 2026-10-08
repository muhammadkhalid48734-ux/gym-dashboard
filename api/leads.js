const { listAll, appendLead, updateLead, ValidationError } = require('./_lib/sheets');
const { send, sendError, readBody } = require('./_lib/http');

// GET   /api/leads  -> { leads, activity, warnings }
// POST  /api/leads  -> body { lead }                          -> { row }
// PATCH /api/leads  -> body { row, expectGym, updates, log? } -> { ok, row, logged, logError? }
module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') return send(res, 200, await listAll());
    if (req.method === 'POST') {
      const body = readBody(req);
      return send(res, 200, await appendLead(body.lead));
    }
    if (req.method === 'PATCH') {
      const body = readBody(req);
      if (body.row === undefined) throw new ValidationError('row is required');
      return send(res, 200, await updateLead({
        row: Number(body.row), expectGym: body.expectGym, updates: body.updates, log: body.log,
      }));
    }
    res.setHeader('Allow', 'GET, POST, PATCH');
    return send(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    return sendError(res, err);
  }
};
