const { runTest } = require('./_lib/sheets');
const { send, sendError } = require('./_lib/http');

// GET /api/test -> { ok, steps: [{ name, ok, detail }] }  (read + idempotent write check)
module.exports = async (req, res) => {
  try {
    const result = await runTest();
    return send(res, result.ok ? 200 : 500, result);
  } catch (err) {
    return sendError(res, err);
  }
};
