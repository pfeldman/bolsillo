import { connectDB, Gasto } from '../_db.js';

export default async function handler(req, res) {
  await connectDB();

  if (req.method === 'DELETE') {
    try {
      await Gasto.findByIdAndDelete(req.query.id);
      return res.json({ message: 'Gasto eliminado' });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
