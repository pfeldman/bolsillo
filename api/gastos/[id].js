import { connectDB, Gasto } from '../_db.js';
import { verifyAuth } from '../_auth.js';

export default async function handler(req, res) {
  const user = await verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'No autorizado' });

  await connectDB();

  if (req.method === 'DELETE') {
    try {
      // First try finding by user_id (own expense)
      let gasto = await Gasto.findOne({ _id: req.query.id, user_id: user.id });

      // If not found, check if this expense was created by the user (owner_id) in a shared context
      if (!gasto) {
        gasto = await Gasto.findOne({ _id: req.query.id, owner_id: user.id });
      }

      if (!gasto) return res.status(404).json({ error: 'Gasto no encontrado' });
      await Gasto.findByIdAndDelete(req.query.id);
      return res.json({ message: 'Gasto eliminado' });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
