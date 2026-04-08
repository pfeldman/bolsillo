import { connectDB, Gasto, Config } from '../_db.js';
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

function calculateDailyLimit(limiteTotal, periodStart, periodEnd) {
  const daysInPeriod = periodEnd.diff(periodStart, 'days') + 1;
  return limiteTotal / daysInPeriod;
}

function getDaysFromStartOfPeriodToToday(periodStart, periodEnd, today = moment()) {
  const targetDate = today.isAfter(periodEnd) ? periodEnd : today.clone().endOf('day');
  const daysFromStart = targetDate.diff(periodStart, 'days') + 1;
  return { daysFromStart, targetDate: targetDate.toDate(), isEndOfPeriod: today.isAfter(periodEnd) };
}

function calculateWeeklyBreakdown(periodStart, periodEnd, weekStartDay, dailyLimitObligatorios, dailyLimitEntretenimiento, gastosDelPeriodo) {
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
    const weekExpenses = gastosDelPeriodo.filter(g => { const d = moment(g.fecha); return d.isSameOrAfter(weekStartDate) && d.isSameOrBefore(weekEndDate); });
    const gastadoO = weekExpenses.filter(g => g.categoria === 'Obligatorios').reduce((s, g) => s + g.monto, 0);
    const gastadoE = weekExpenses.filter(g => g.categoria === 'Entretenimiento').reduce((s, g) => s + g.monto, 0);
    const limO = Math.round(dailyLimitObligatorios * daysInPartialWeek);
    const limE = Math.round(dailyLimitEntretenimiento * daysInPartialWeek);
    weeks.push({ weekNumber: 1, startDate: weekStartDate.format('DD/MM'), endDate: weekEndDate.format('DD/MM'), days: daysInPartialWeek, isPast: weekEndDate.isBefore(today), isCurrent: weekStartDate.isSameOrBefore(today) && weekEndDate.isSameOrAfter(today), limiteObligatorios: limO, limiteEntretenimiento: limE, gastadoObligatorios: Math.round(gastadoO), gastadoEntretenimiento: Math.round(gastadoE), disponibleObligatorios: Math.round(limO - gastadoO), disponibleEntretenimiento: Math.round(limE - gastadoE) });
  }

  let weekNumber = weeks.length + 1;
  while (currentWeekStart.isSameOrBefore(periodEnd)) {
    const weekEnd = currentWeekStart.clone().add(6, 'days');
    const actualWeekEnd = weekEnd.isAfter(periodEnd) ? periodEnd : weekEnd;
    const daysInWeek = actualWeekEnd.diff(currentWeekStart, 'days') + 1;
    const weekExpenses = gastosDelPeriodo.filter(g => { const d = moment(g.fecha); return d.isSameOrAfter(currentWeekStart) && d.isSameOrBefore(actualWeekEnd.endOf('day')); });
    const gastadoO = weekExpenses.filter(g => g.categoria === 'Obligatorios').reduce((s, g) => s + g.monto, 0);
    const gastadoE = weekExpenses.filter(g => g.categoria === 'Entretenimiento').reduce((s, g) => s + g.monto, 0);
    const limO = Math.round(dailyLimitObligatorios * daysInWeek);
    const limE = Math.round(dailyLimitEntretenimiento * daysInWeek);
    weeks.push({ weekNumber, startDate: currentWeekStart.format('DD/MM'), endDate: actualWeekEnd.format('DD/MM'), days: daysInWeek, isPast: actualWeekEnd.isBefore(today), isCurrent: currentWeekStart.isSameOrBefore(today) && actualWeekEnd.isSameOrAfter(today), limiteObligatorios: limO, limiteEntretenimiento: limE, gastadoObligatorios: Math.round(gastadoO), gastadoEntretenimiento: Math.round(gastadoE), disponibleObligatorios: Math.round(limO - gastadoO), disponibleEntretenimiento: Math.round(limE - gastadoE) });
    currentWeekStart.add(7, 'days');
    weekNumber++;
  }
  return weeks;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  await connectDB();

  try {
    const now = moment();
    const config = await Config.findOne() || { limiteObligatorios: 750000, limiteEntretenimiento: 750000, weekStartDay: 1, billingCycleStartDay: 1 };
    const { periodStart, periodEnd } = getBillingPeriod(config.billingCycleStartDay || 1, now);
    const gastosDelPeriodo = await Gasto.find({ fecha: { $gte: periodStart.toDate(), $lte: periodEnd.toDate() } });

    const dailyLimitO = calculateDailyLimit(config.limiteObligatorios, periodStart, periodEnd);
    const dailyLimitE = calculateDailyLimit(config.limiteEntretenimiento, periodStart, periodEnd);
    const weekStartDay = config.weekStartDay !== undefined ? config.weekStartDay : 1;
    const { daysFromStart, targetDate } = getDaysFromStartOfPeriodToToday(periodStart, periodEnd, now);

    const weeklyBreakdown = calculateWeeklyBreakdown(periodStart, periodEnd, weekStartDay, dailyLimitO, dailyLimitE, gastosDelPeriodo);

    let totalGastadoO = 0, totalGastadoE = 0, currentLimitO = 0, currentLimitE = 0;
    weeklyBreakdown.forEach(week => {
      if (week.isPast || week.isCurrent) {
        totalGastadoO += week.gastadoObligatorios;
        totalGastadoE += week.gastadoEntretenimiento;
        currentLimitO += week.limiteObligatorios;
        currentLimitE += week.limiteEntretenimiento;
      }
    });

    return res.json({
      billingPeriod: { start: periodStart.format('YYYY-MM-DD'), end: periodEnd.format('YYYY-MM-DD'), startDay: config.billingCycleStartDay || 1 },
      fechaCalculoHasta: targetDate,
      diasTranscurridos: daysFromStart,
      config: { limiteObligatorios: config.limiteObligatorios, limiteEntretenimiento: config.limiteEntretenimiento },
      weeklyBreakdown,
      obligatorios: { limiteMensual: config.limiteObligatorios, limiteDiario: Math.round(dailyLimitO), limiteAcumuladoHastaHoy: Math.round(currentLimitO), totalGastado: totalGastadoO, disponible: Math.round(Math.max(0, currentLimitO - totalGastadoO)), disponibleMes: config.limiteObligatorios - totalGastadoO },
      entretenimiento: { limiteMensual: config.limiteEntretenimiento, limiteDiario: Math.round(dailyLimitE), limiteAcumuladoHastaHoy: Math.round(currentLimitE), totalGastado: totalGastadoE, disponible: Math.round(Math.max(0, currentLimitE - totalGastadoE)), disponibleMes: config.limiteEntretenimiento - totalGastadoE },
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
