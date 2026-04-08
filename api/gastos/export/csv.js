import { connectDB, Gasto, Config } from '../../_db.js';
import { verifyAuth } from '../../_auth.js';
import moment from 'moment';
import { Parser } from 'json2csv';

function getBillingPeriod(billingCycleStartDay, referenceDate = moment()) {
  const currentDay = referenceDate.date();
  const currentMonth = referenceDate.month();
  const currentYear = referenceDate.year();
  let periodStart, periodEnd;
  if (billingCycleStartDay === 1) {
    periodStart = moment([currentYear, currentMonth, 1]);
    periodEnd = moment([currentYear, currentMonth]).endOf('month');
  } else {
    if (currentDay >= billingCycleStartDay) {
      periodStart = moment([currentYear, currentMonth, billingCycleStartDay]);
      periodEnd = moment([currentYear, currentMonth, billingCycleStartDay]).add(1, 'month').subtract(1, 'day').endOf('day');
    } else {
      periodStart = moment([currentYear, currentMonth, billingCycleStartDay]).subtract(1, 'month');
      periodEnd = moment([currentYear, currentMonth, billingCycleStartDay]).subtract(1, 'day').endOf('day');
    }
  }
  return { periodStart, periodEnd };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = await verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'No autorizado' });

  await connectDB();

  try {
    const { mes, año, currentPeriod } = req.query;
    let query = { user_id: user.id };
    let filename = '';

    if (currentPeriod === 'true') {
      const config = await Config.findOne({ user_id: user.id }) || { billingCycleStartDay: 1 };
      const { periodStart, periodEnd } = getBillingPeriod(config.billingCycleStartDay || 1);
      query.fecha = { $gte: periodStart.toDate(), $lte: periodEnd.toDate() };
      filename = `gastos_${periodStart.format('YYYYMMDD')}_${periodEnd.format('YYYYMMDD')}.csv`;
    } else if (mes && año) {
      const startDate = new Date(año, mes - 1, 1);
      const endDate = new Date(año, mes, 0, 23, 59, 59);
      query.fecha = { $gte: startDate, $lte: endDate };
      filename = `gastos_${mes}_${año}.csv`;
    } else {
      filename = 'gastos_todos.csv';
    }

    const gastos = await Gasto.find(query).sort({ fecha: -1 }).lean();
    const fields = ['fecha', 'categoria', 'descripcion', 'monto'];
    const parser = new Parser({ fields });
    const csv = parser.parse(gastos);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(csv);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
