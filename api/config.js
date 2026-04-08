import { connectDB, Config } from './_db.js';
import { verifyAuth } from './_auth.js';

const DEFAULT_CATEGORIES = [
  { id: 'obligatorios', name: 'Obligatorios', limit: 750000, icon: '🏠', color: '#059669' },
  { id: 'entretenimiento', name: 'Entretenimiento', limit: 750000, icon: '😄', color: '#8b5cf6' },
];

// Migrate old format (limiteObligatorios/limiteEntretenimiento) to new categories array
function migrateConfig(config) {
  if (config.categories && config.categories.length > 0) return false; // already migrated
  // Old format detected
  const categories = [
    { id: 'obligatorios', name: 'Obligatorios', limit: config.limiteObligatorios || 750000, icon: '🏠', color: '#059669' },
    { id: 'entretenimiento', name: 'Entretenimiento', limit: config.limiteEntretenimiento || 750000, icon: '😄', color: '#8b5cf6' },
  ];
  config.categories = categories;
  return true; // was migrated
}

export default async function handler(req, res) {
  const user = await verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'No autorizado' });

  await connectDB();

  if (req.method === 'GET') {
    try {
      let config = await Config.findOne({ user_id: user.id });
      if (!config) {
        config = await Config.create({
          user_id: user.id,
          categories: DEFAULT_CATEGORIES,
          weekStartDay: 1,
          billingCycleStartDay: 1,
          currencyMultiplier: 1,
        });
      } else if (migrateConfig(config)) {
        await config.save();
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
        if (req.body.categories !== undefined) config.categories = req.body.categories;
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
