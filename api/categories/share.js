import { connectDB, Config } from '../_db.js';
import { verifyAuth, getSupabaseAdmin } from '../_auth.js';

export default async function handler(req, res) {
  const user = await verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'No autorizado' });

  await connectDB();

  // POST: Share a category with a user by email
  if (req.method === 'POST') {
    try {
      const { categoryId, email } = req.body;
      if (!categoryId || !email) {
        return res.status(400).json({ error: 'categoryId y email son requeridos' });
      }

      // Find the current user's config and category
      const config = await Config.findOne({ user_id: user.id });
      if (!config) return res.status(404).json({ error: 'Configuracion no encontrada' });

      const category = config.categories.find(c => c.id === categoryId);
      if (!category) return res.status(404).json({ error: 'Categoria no encontrada' });

      // Look up the target user by email using Supabase admin
      const admin = getSupabaseAdmin();
      const { data, error } = await admin.auth.admin.listUsers();
      if (error) {
        console.error('Error listing users:', error);
        return res.status(500).json({ error: 'Error al buscar usuario' });
      }

      const targetUser = data.users.find(u => u.email === email.toLowerCase().trim());
      if (!targetUser) {
        return res.status(404).json({ error: 'No se encontro un usuario con ese email' });
      }

      // Can't share with yourself
      if (targetUser.id === user.id) {
        return res.status(400).json({ error: 'No podes compartir una categoria con vos mismo' });
      }

      // Check if already shared
      if (!category.shared_with) category.shared_with = [];
      const alreadyShared = category.shared_with.some(s => s.user_id === targetUser.id);
      if (alreadyShared) {
        return res.status(400).json({ error: 'Esta categoria ya esta compartida con ese usuario' });
      }

      // Add to shared_with
      category.shared_with.push({
        user_id: targetUser.id,
        email: targetUser.email,
      });

      await config.save();

      return res.json({
        message: 'Categoria compartida exitosamente',
        shared_with: category.shared_with,
      });
    } catch (error) {
      console.error('Error sharing category:', error);
      return res.status(500).json({ error: error.message });
    }
  }

  // DELETE: Remove a user from a shared category (owner removes, or user leaves)
  if (req.method === 'DELETE') {
    try {
      const { categoryId, userId, ownerId } = req.body;
      if (!categoryId) {
        return res.status(400).json({ error: 'categoryId es requerido' });
      }

      // Case 1: Owner removing a shared user from their own category
      // Case 2: A shared user leaving someone else's category (ownerId provided)
      if (ownerId && ownerId !== user.id) {
        // User is leaving a category that belongs to ownerId
        const ownerConfig = await Config.findOne({ user_id: ownerId });
        if (!ownerConfig) return res.status(404).json({ error: 'Configuracion no encontrada' });

        const category = ownerConfig.categories.find(c => c.id === categoryId);
        if (!category) return res.status(404).json({ error: 'Categoria no encontrada' });

        if (!category.shared_with) category.shared_with = [];
        category.shared_with = category.shared_with.filter(s => s.user_id !== user.id);

        await ownerConfig.save();
        return res.json({ message: 'Saliste de la categoria compartida' });
      }

      // Owner removing a shared user
      const targetUserId = userId;
      if (!targetUserId) {
        return res.status(400).json({ error: 'userId es requerido' });
      }

      const config = await Config.findOne({ user_id: user.id });
      if (!config) return res.status(404).json({ error: 'Configuracion no encontrada' });

      const category = config.categories.find(c => c.id === categoryId);
      if (!category) return res.status(404).json({ error: 'Categoria no encontrada' });

      if (!category.shared_with) category.shared_with = [];
      category.shared_with = category.shared_with.filter(s => s.user_id !== targetUserId);

      await config.save();
      return res.json({
        message: 'Usuario eliminado de la categoria',
        shared_with: category.shared_with,
      });
    } catch (error) {
      console.error('Error unsharing category:', error);
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
