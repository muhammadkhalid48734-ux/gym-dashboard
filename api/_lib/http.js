const { ConfigError, ValidationError, ConflictError, explain } = require('./sheets');

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function sendError(res, err) {
  let status = 500;
  if (err instanceof ValidationError) status = 400;
  else if (err instanceof ConflictError) status = 409;
  else if (err instanceof ConfigError) status = 500;
  console.error('[api error]', err && err.message);
  send(res, status, { error: explain(err) });
}

function readBody(req) {
  const b = req.body;
  if (b === undefined || b === null || b === '') return {};
  if (typeof b === 'string') {
    try { return JSON.parse(b); } catch { throw new ValidationError('Request body is not valid JSON'); }
  }
  return b;
}

module.exports = { send, sendError, readBody };
