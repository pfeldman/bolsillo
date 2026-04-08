import { connectDB, Config } from './_db.js';
import { verifyAuth } from './_auth.js';

export default async function handler(req, res) {
  const user = await verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'No autorizado' });

  await connectDB();

  if (req.method === 'GET') {
    try {
      let config = await Config.findOne({ user_id: user.id });
      if (!config) {
        config = await Config.create({ user_id: user.id, limiteObligatorios: 750000, limiteEntretenimiento: 750000, weekStartDay: 1, billingCycleStartDay: 1 });
      }
      return res.json(config);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  if (req.method === 'PUT') {
    try {
      let config = await Config.findOne({ user_id: user.id });
      if (!config) {
        config = new Config({ ...req.body, user_id: user.id });
      } else {
        if (req.body.limiteObligatorios !== undefined) config.limiteObligatorios = req.body.limiteObligatorios;
        if (req.body.limiteEntretenimiento !== undefined) config.limiteEntretenimiento = req.body.limiteEntretenimiento;
        if (req.body.weekStartDay !== undefined) config.weekStartDay = req.body.weekStartDay;
        if (req.body.billingCycleStartDay !== undefined) config.billingCycleStartDay = req.body.billingCycleStartDay;
        if (req.body.currencyMultiplier !== undefined) config.currencyMultiplier = req.body.currencyMultiplier;
      }
      await config.save();
      return res.json(config);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
