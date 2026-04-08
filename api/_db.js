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
  descripcion: { type: String, required: true },
  monto: { type: Number, required: true },
  categoria: { type: String, enum: ['Obligatorios', 'Entretenimiento'], required: true },
  fecha: { type: Date, default: Date.now },
}, { timestamps: true });

const configSchema = new mongoose.Schema({
  limiteObligatorios: { type: Number, default: 750000 },
  limiteEntretenimiento: { type: Number, default: 750000 },
  weekStartDay: { type: Number, default: 1, min: 0, max: 6 },
  billingCycleStartDay: { type: Number, default: 1, min: 1, max: 31 },
  currencyMultiplier: { type: Number, default: 1 },
}, { timestamps: true });

export const Gasto = mongoose.models.Gasto || mongoose.model('Gasto', gastoSchema);
export const Config = mongoose.models.Config || mongoose.model('Config', configSchema);
