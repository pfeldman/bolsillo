import { connectDB, Gasto, Config } from '../_db.js';
import { verifyAuth } from '../_auth.js';
import moment from 'moment';

const DEFAULT_CATEGORIES = [
  { id: 'obligatorios', name: 'Obligatorios', limit: 750000, icon: '🏠', color: '#059669' },
  { id: 'entretenimiento', name: 'Entretenimiento', limit: 750000, icon: '😄', color: '#8b5cf6' },
];

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

function calculateDailyLimit(limiteTotal, periodStart, periodEnd) {
  const daysInPeriod = periodEnd.diff(periodStart, 'days') + 1;
  return limiteTotal / daysInPeriod;
}

function getDaysFromStartOfPeriodToToday(periodStart, periodEnd, today = moment()) {
  const targetDate = today.isAfter(periodEnd) ? periodEnd : today.clone().endOf('day');
  const daysFromStart = targetDate.diff(periodStart, 'days') + 1;
  return { daysFromStart, targetDate: targetDate.toDate(), isEndOfPeriod: today.isAfter(periodEnd) };
}

function calculateWeeklyBreakdownForCategory(periodStart, periodEnd, weekStartDay, dailyLimit, categoryName, gastosDelPeriodo) {
  const today = moment();
  const weeks = [];
  let currentWeekStart = periodStart.clone();

  while (currentWeekStart.day() !== weekStartDay && currentWeekStart.isSameOrBefore(periodEnd)) {
    currentWeekStart.add(1, 'day');
  }

  if (currentWeekStart.isAfter(periodStart)) {
    const weekStartDate = periodStart.clone();
    const weekEndDate = currentWeekStart.clone().subtract(1, 'day').endOf('day');
    const daysInPartialWeek = currentWeekStart.diff(periodStart, 'days');
    const weekExpenses = gastosDelPeriodo.filter(g => { const d = moment(g.fecha); return d.isSameOrAfter(weekStartDate) && d.isSameOrBefore(weekEndDate) && g.categoria === categoryName; });
    const spent = weekExpenses.reduce((s, g) => s + g.monto, 0);
    const lim = Math.round(dailyLimit * daysInPartialWeek);
    weeks.push({ weekNumber: 1, startDate: weekStartDate.format('DD/MM'), endDate: weekEndDate.format('DD/MM'), days: daysInPartialWeek, isPast: weekEndDate.isBefore(today), isCurrent: weekStartDate.isSameOrBefore(today) && weekEndDate.isSameOrAfter(today), limite: lim, gastado: Math.round(spent), disponible: Math.round(lim - spent) });
  }

  let weekNumber = weeks.length + 1;
  while (currentWeekStart.isSameOrBefore(periodEnd)) {
    const weekEnd = currentWeekStart.clone().add(6, 'days');
    const actualWeekEnd = weekEnd.isAfter(periodEnd) ? periodEnd : weekEnd;
    const daysInWeek = actualWeekEnd.diff(currentWeekStart, 'days') + 1;
    const weekExpenses = gastosDelPeriodo.filter(g => { const d = moment(g.fecha); return d.isSameOrAfter(currentWeekStart) && d.isSameOrBefore(actualWeekEnd.endOf('day')) && g.categoria === categoryName; });
    const spent = weekExpenses.reduce((s, g) => s + g.monto, 0);
    const lim = Math.round(dailyLimit * daysInWeek);
    weeks.push({ weekNumber, startDate: currentWeekStart.format('DD/MM'), endDate: actualWeekEnd.format('DD/MM'), days: daysInWeek, isPast: actualWeekEnd.isBefore(today), isCurrent: currentWeekStart.isSameOrBefore(today) && actualWeekEnd.isSameOrAfter(today), limite: lim, gastado: Math.round(spent), disponible: Math.round(lim - spent) });
    currentWeekStart.add(7, 'days');
    weekNumber++;
  }
  return weeks;
}

// Migrate old config format on the fly
function getCategories(config) {
  if (config.categories && config.categories.length > 0) return config.categories;
  // Legacy format
  return [
    { id: 'obligatorios', name: 'Obligatorios', limit: config.limiteObligatorios || 750000, icon: '🏠', color: '#059669' },
    { id: 'entretenimiento', name: 'Entretenimiento', limit: config.limiteEntretenimiento || 750000, icon: '😄', color: '#8b5cf6' },
  ];
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = await verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'No autorizado' });

  await connectDB();

  try {
    const now = moment();
    const config = await Config.findOne({ user_id: user.id }) || { categories: DEFAULT_CATEGORIES, weekStartDay: 1, billingCycleStartDay: 1 };
    const categories = getCategories(config);
    const { periodStart, periodEnd } = getBillingPeriod(config.billingCycleStartDay || 1, now);

    // Fetch own expenses
    const ownGastos = await Gasto.find({ user_id: user.id, fecha: { $gte: periodStart.toDate(), $lte: periodEnd.toDate() } });

    // For shared categories (owned by this user), also fetch expenses from shared members
    const sharedMemberIds = new Set();
    categories.forEach(cat => {
      if (cat.shared_with && cat.shared_with.length > 0) {
        cat.shared_with.forEach(s => sharedMemberIds.add(s.user_id));
      }
    });

    let sharedMemberGastos = [];
    if (sharedMemberIds.size > 0) {
      sharedMemberGastos = await Gasto.find({
        user_id: { $in: Array.from(sharedMemberIds) },
        fecha: { $gte: periodStart.toDate(), $lte: periodEnd.toDate() },
      });
    }

    const allGastos = [...ownGastos, ...sharedMemberGastos];

    const weekStartDay = config.weekStartDay !== undefined ? config.weekStartDay : 1;
    const { daysFromStart, targetDate } = getDaysFromStartOfPeriodToToday(periodStart, periodEnd, now);

    const categoriesResult = categories.map(cat => {
      const isShared = cat.shared_with && cat.shared_with.length > 0;

      // For shared categories, count expenses from all members; for private, only own
      let relevantGastos;
      if (isShared) {
        const memberIds = [user.id, ...cat.shared_with.map(s => s.user_id)];
        relevantGastos = allGastos.filter(g => memberIds.includes(g.user_id) && g.categoria === cat.name);
      } else {
        relevantGastos = ownGastos.filter(g => g.categoria === cat.name);
      }

      // Build a filtered list for the weekly breakdown (needs all expenses in the period for that category)
      const gastosForBreakdown = isShared
        ? allGastos.filter(g => {
            const memberIds = [user.id, ...cat.shared_with.map(s => s.user_id)];
            return memberIds.includes(g.user_id);
          })
        : ownGastos;

      const dailyLimit = calculateDailyLimit(cat.limit, periodStart, periodEnd);
      const weeklyBreakdown = calculateWeeklyBreakdownForCategory(periodStart, periodEnd, weekStartDay, dailyLimit, cat.name, gastosForBreakdown);

      let totalGastado = 0, currentLimit = 0;
      weeklyBreakdown.forEach(week => {
        if (week.isPast || week.isCurrent) {
          totalGastado += week.gastado;
          currentLimit += week.limite;
        }
      });

      return {
        id: cat.id,
        name: cat.name,
        icon: cat.icon || '💰',
        color: cat.color || '#059669',
        limiteMensual: cat.limit,
        limiteDiario: Math.round(dailyLimit),
        limiteAcumuladoHastaHoy: Math.round(currentLimit),
        totalGastado,
        disponible: Math.round(Math.max(0, currentLimit - totalGastado)),
        disponibleMes: cat.limit - totalGastado,
        weeklyBreakdown,
        isShared: isShared,
        isOwner: true,
        shared_with: cat.shared_with || [],
      };
    });

    // Also include categories shared WITH this user from other users
    const sharedConfigs = await Config.find({
      'categories.shared_with.user_id': user.id,
      user_id: { $ne: user.id },
    });

    for (const otherConfig of sharedConfigs) {
      const otherPeriod = getBillingPeriod(otherConfig.billingCycleStartDay || 1, now);
      const otherWeekStartDay = otherConfig.weekStartDay !== undefined ? otherConfig.weekStartDay : 1;

      for (const cat of otherConfig.categories) {
        if (!cat.shared_with || !cat.shared_with.some(s => s.user_id === user.id)) continue;

        // Gather all member IDs (owner + all shared)
        const memberIds = [otherConfig.user_id, ...cat.shared_with.map(s => s.user_id)];

        // Fetch all members' expenses in the owner's billing period
        const allSharedGastos = await Gasto.find({
          user_id: { $in: memberIds },
          fecha: { $gte: otherPeriod.periodStart.toDate(), $lte: otherPeriod.periodEnd.toDate() },
        });

        const dailyLimit = calculateDailyLimit(cat.limit, otherPeriod.periodStart, otherPeriod.periodEnd);
        const weeklyBreakdown = calculateWeeklyBreakdownForCategory(otherPeriod.periodStart, otherPeriod.periodEnd, otherWeekStartDay, dailyLimit, cat.name, allSharedGastos);

        let totalGastado = 0, currentLimit = 0;
        weeklyBreakdown.forEach(week => {
          if (week.isPast || week.isCurrent) {
            totalGastado += week.gastado;
            currentLimit += week.limite;
          }
        });

        categoriesResult.push({
          id: cat.id,
          name: cat.name,
          icon: cat.icon || '💰',
          color: cat.color || '#059669',
          limiteMensual: cat.limit,
          limiteDiario: Math.round(dailyLimit),
          limiteAcumuladoHastaHoy: Math.round(currentLimit),
          totalGastado,
          disponible: Math.round(Math.max(0, currentLimit - totalGastado)),
          disponibleMes: cat.limit - totalGastado,
          weeklyBreakdown,
          isShared: true,
          isOwner: false,
          owner_id: otherConfig.user_id,
          shared_with: cat.shared_with || [],
        });
      }
    }

    return res.json({
      billingPeriod: { start: periodStart.format('YYYY-MM-DD'), end: periodEnd.format('YYYY-MM-DD'), startDay: config.billingCycleStartDay || 1 },
      fechaCalculoHasta: targetDate,
      diasTranscurridos: daysFromStart,
      categories: categoriesResult,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
