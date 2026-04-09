import { connectDB, Gasto, Config } from './_db.js';
import { verifyAuth } from './_auth.js';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });

  const user = await verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'No autorizado' });

  await connectDB();

  try {
    // Delete all user data from MongoDB
    await Gasto.deleteMany({ user_id: user.id });
    await Gasto.deleteMany({ owner_id: user.id });
    await Config.deleteMany({ user_id: user.id });

    // Remove user from any shared categories
    await Config.updateMany(
      { 'categories.shared_with.user_id': user.id },
      { $pull: { 'categories.$[].shared_with': { user_id: user.id } } }
    );

    // Delete Supabase auth account
    const supabaseAdmin = createClient(
      'https://fqelzbjdseukdujnxeqg.supabase.co',
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );
    const { error } = await supabaseAdmin.auth.admin.deleteUser(user.id);
    if (error) {
      return res.status(500).json({ error: 'Error eliminando cuenta' });
    }

    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
