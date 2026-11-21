"use strict";
const { fail } = require('./domain.cjs');
function mountThreatAlertDetail(app, { pool, allow }) {
  app.get('/api/alerts/:id', allow('alerts.read'), async (req, res) => {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(req.params.id) || Object.keys(req.query).length)
      fail(400, 'Invalid alert identifier.');
    const alert = (await pool.query('SELECT * FROM plant_app.threat_alert_history WHERE id=$1', [req.params.id])).rows[0];
    if (!alert) fail(404, 'Alert not found.');
    const rows = (await pool.query(`SELECT * FROM plant_app.threat_response WHERE alert_id=$1
      ORDER BY created_at DESC,id DESC LIMIT 501`, [req.params.id])).rows;
    res.json({ alert, responses: rows.slice(0, 500), history_capped: rows.length > 500 });
  });
}
module.exports = { mountThreatAlertDetail };
