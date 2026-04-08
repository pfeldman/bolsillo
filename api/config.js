import { connectDB, Config } from './_db.js';

export default async function handler(req, res) {
  await connectDB();

  if (req.method === 'GET') {
    try {
      let config = await Config.findOne();
      if (!config) {
        config = await Config.create({ limiteObligatorios: 750000, limiteEntretenimiento: 750000, weekStartDay: 1, billingCycleStartDay: 1 });
      }
      return res.json(config);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  if (req.method === 'PUT') {
    try {
      let config = await Config.findOne();
      if (!config) {
        config = new Config(req.body);
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
