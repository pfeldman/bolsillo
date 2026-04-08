import { connectDB, Gasto, Config } from '../_db.js';
import { verifyAuth } from '../_auth.js';
import moment from 'moment';

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
  const user = await verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'No autorizado' });

  await connectDB();

  if (req.method === 'GET') {
    try {
      const { categoria, mes, año, currentPeriod } = req.query;
      let query = { user_id: user.id };
      if (categoria) query.categoria = categoria;
      if (currentPeriod === 'true') {
        const config = await Config.findOne({ user_id: user.id }) || { billingCycleStartDay: 1 };
        const { periodStart, periodEnd } = getBillingPeriod(config.billingCycleStartDay || 1);
        query.fecha = { $gte: periodStart.toDate(), $lte: periodEnd.toDate() };
      } else if (mes && año) {
        const startDate = new Date(año, mes - 1, 1);
        const endDate = new Date(año, mes, 0, 23, 59, 59);
        query.fecha = { $gte: startDate, $lte: endDate };
      }
      let gastos = await Gasto.find(query).sort({ createdAt: -1 });

      // Also include expenses from shared categories where this user is a member
      // Find categories shared with this user
      const sharedConfigs = await Config.find({
        'categories.shared_with.user_id': user.id,
        user_id: { $ne: user.id },
      });

      const sharedCategoryQueries = [];
      for (const otherConfig of sharedConfigs) {
        for (const cat of otherConfig.categories) {
          if (cat.shared_with && cat.shared_with.some(s => s.user_id === user.id)) {
            // Get all member IDs for this shared category
            const memberIds = [otherConfig.user_id, ...cat.shared_with.map(s => s.user_id)];
            const sharedQuery = {
              user_id: { $in: memberIds },
              categoria: cat.name,
            };
            // Apply same date filters
            if (query.fecha) sharedQuery.fecha = query.fecha;
            // If filtering by category, only include if it matches
            if (categoria && cat.name !== categoria) continue;
            sharedCategoryQueries.push(sharedQuery);
          }
        }
      }

      if (sharedCategoryQueries.length > 0) {
        for (const sq of sharedCategoryQueries) {
          const sharedGastos = await Gasto.find(sq).sort({ createdAt: -1 });
          // Add shared gastos, avoiding duplicates (own expenses already included)
          const existingIds = new Set(gastos.map(g => g._id.toString()));
          for (const sg of sharedGastos) {
            if (!existingIds.has(sg._id.toString())) {
              gastos.push(sg);
            }
          }
        }
        // Re-sort combined results
        gastos.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      }

      return res.json(gastos);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  if (req.method === 'POST') {
    try {
      const { prorate, ...gastoData } = req.body;
      gastoData.user_id = user.id;
      gastoData.owner_id = user.id;

      if (prorate) {
        const config = await Config.findOne({ user_id: user.id }) || { weekStartDay: 1, billingCycleStartDay: 1 };
        const weekStartDay = config.weekStartDay !== undefined ? config.weekStartDay : 1;
        const now = moment();
        const { periodStart, periodEnd } = getBillingPeriod(config.billingCycleStartDay || 1, now);
        const weeks = [];
        let currentWeekStart = periodStart.clone();
        while (currentWeekStart.day() !== weekStartDay && currentWeekStart.isSameOrBefore(periodEnd)) {
          currentWeekStart.add(1, 'day');
        }
        if (currentWeekStart.isAfter(periodStart)) {
          weeks.push({ start: periodStart.clone(), end: currentWeekStart.clone().subtract(1, 'day').endOf('day'), days: currentWeekStart.diff(periodStart, 'days') });
        }
        while (currentWeekStart.isSameOrBefore(periodEnd)) {
          const weekEnd = currentWeekStart.clone().add(6, 'days');
          const actualWeekEnd = weekEnd.isAfter(periodEnd) ? periodEnd : weekEnd;
          weeks.push({ start: currentWeekStart.clone(), end: actualWeekEnd.clone().endOf('day'), days: actualWeekEnd.diff(currentWeekStart, 'days') + 1 });
          currentWeekStart.add(7, 'days');
        }
        const amountPerWeek = gastoData.monto / weeks.length;
        const createdExpenses = [];
        for (let i = 0; i < weeks.length; i++) {
          const week = weeks[i];
          const expenseDate = week.start.clone().add(Math.floor(week.days / 2), 'days');
          const weekGasto = new Gasto({ ...gastoData, monto: Math.round(amountPerWeek * 100) / 100, descripcion: `${gastoData.descripcion} (Semana ${i + 1}/${weeks.length})`, fecha: expenseDate.toDate() });
          await weekGasto.save();
          createdExpenses.push(weekGasto);
        }
        return res.status(201).json({ message: `Gasto prorrateado en ${weeks.length} semanas`, expenses: createdExpenses });
      } else {
        const gasto = new Gasto(gastoData);
        await gasto.save();
        return res.status(201).json(gasto);
      }
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
