import mongoose from 'mongoose';

let cached = global._mongoose;
if (!cached) cached = global._mongoose = { conn: null, promise: null };

export async function connectDB() {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    cached.promise = mongoose.connect(process.env.MONGODB_URI).then(m => m);
  }
  cached.conn = await cached.promise;
  return cached.conn;
}

// Models
const gastoSchema = new mongoose.Schema({
  user_id: { type: String },
  descripcion: { type: String, required: true },
  monto: { type: Number, required: true },
  categoria: { type: String, required: true },
  fecha: { type: Date, default: Date.now },
}, { timestamps: true });

const categorySchema = new mongoose.Schema({
  id: { type: String, required: true },
  name: { type: String, required: true },
  limit: { type: Number, required: true },
  icon: { type: String, default: '💰' },
  color: { type: String, default: '#059669' },
}, { _id: false });

const configSchema = new mongoose.Schema({
  user_id: { type: String },
  categories: { type: [categorySchema], default: () => ([
    { id: 'obligatorios', name: 'Obligatorios', limit: 750000, icon: '🏠', color: '#059669' },
    { id: 'entretenimiento', name: 'Entretenimiento', limit: 750000, icon: '😄', color: '#8b5cf6' },
  ]) },
  // Keep legacy fields for backward compat during migration reads
  limiteObligatorios: { type: Number },
  limiteEntretenimiento: { type: Number },
  weekStartDay: { type: Number, default: 1, min: 0, max: 6 },
  billingCycleStartDay: { type: Number, default: 1, min: 1, max: 31 },
  currencyMultiplier: { type: Number, default: 1 },
}, { timestamps: true });

export const Gasto = mongoose.models.Gasto || mongoose.model('Gasto', gastoSchema);
export const Config = mongoose.models.Config || mongoose.model('Config', configSchema);
