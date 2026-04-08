const API_URL = '/api';
let supabase = null;

let currentLimits = null;

// Authenticated fetch helper - adds Authorization header to all API calls
async function authFetch(url, options = {}) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
        window.location.href = '/login.html';
        return;
    }
    const headers = {
        ...options.headers,
        'Authorization': `Bearer ${session.access_token}`
    };
    return fetch(url, { ...options, headers });
}

// Called by index.html after auth check passes
function bootApp(supabaseClient) {
    supabase = supabaseClient;
    initializeApp();
    setupEventListeners();
    loadDashboard();
    loadConfig();
    registerServiceWorker();
}

// Register Service Worker for PWA
function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('/sw.js').then(registration => {
        console.log('SW registered:', registration);

        // Force immediate update check
        registration.update();

        // Check for updates periodically
        setInterval(() => registration.update(), 60 * 1000);

        // Also check when app resumes (critical for iOS standalone PWA)
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                registration.update();
            }
        });

        // If a new SW is already waiting (e.g. from a previous visit), show banner
        if (registration.waiting) {
            showUpdateBanner(registration.waiting);
            return;
        }

        // Listen for new SW installing
        registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            if (!newWorker) return;

            newWorker.addEventListener('statechange', () => {
                // New SW installed and waiting to activate
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                    showUpdateBanner(newWorker);
                }
            });
        });
    }).catch(err => {
        console.log('SW registration failed:', err);
    });

    // When the new SW takes over, reload the page
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        window.location.reload();
    });
}

function showUpdateBanner(waitingWorker) {
    const banner = document.getElementById('update-banner');
    if (!banner) return;
    banner.classList.add('visible');

    document.getElementById('update-refresh-btn').addEventListener('click', () => {
        banner.classList.remove('visible');
        waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    });

    document.getElementById('update-dismiss-btn').addEventListener('click', () => {
        banner.classList.remove('visible');
    });
}

function initializeApp() {
    // Initialize date picker with today's date
    const dateInput = document.getElementById('quick-fecha');
    if (dateInput) {
        const today = new Date();
        dateInput.value = today.toISOString().split('T')[0];
    }
    updateGreeting();
}

function updateGreeting() {
    const el = document.getElementById('dashboard-greeting');
    if (!el) return;
    const h = new Date().getHours();
    el.textContent = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
}

function setupEventListeners() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const target = e.target.closest('.tab-btn');
            switchPage(target.dataset.page);
        });
    });

    document.getElementById('quick-expense-form').addEventListener('submit', handleQuickExpense);
    document.getElementById('save-config').addEventListener('click', handleConfigSave);
    document.getElementById('export-csv').addEventListener('click', exportToCSV);

    document.getElementById('filter-categoria').addEventListener('change', loadExpenses);
    document.getElementById('filter-mes').addEventListener('change', loadExpenses);
    document.getElementById('filter-año').addEventListener('change', loadExpenses);

    // Setup money input formatting
    setupMoneyInputFormatting('quick-monto');
    setupMoneyInputFormatting('limite-obligatorios');
    setupMoneyInputFormatting('limite-entretenimiento');
    setupMoneyInputFormatting('currency-multiplier');

    // Easter egg - recargar página al tocar "Obligatorios"
    document.getElementById('obligatorios-title').addEventListener('click', () => {
        window.location.reload();
    });

    setupBottomSheet();
}

function switchPage(page) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`[data-page="${page}"]`).classList.add('active');
    
    document.querySelectorAll('.page').forEach(p => {
        p.classList.remove('active');
    });
    document.getElementById(page).classList.add('active');
    
    if (page === 'dashboard') {
        loadDashboard();
    } else if (page === 'gastos') {
        populateMonthYearFilters();
        loadExpenses();
    } else if (page === 'config') {
        loadConfig();
    }
}

async function loadDashboard() {
    const loadingOverlay = document.getElementById('dashboard-loading');
    loadingOverlay.classList.add('active');
    
    try {
        const response = await authFetch(`${API_URL}/limits/current`);
        if (!response) return;
        const data = await response.json();
        currentLimits = data;
        
        updateCategoryDisplay(data);
    } catch (error) {
        console.error('Error loading dashboard:', error);
        showNotification('Error al cargar el dashboard', 'error');
    } finally {
        loadingOverlay.classList.remove('active');
    }
}

function updateCategoryDisplay(data) {
    // Show billing period if available
    if (data.billingPeriod) {
        const periodDisplay = document.getElementById('billing-period-display');
        const periodDates = document.getElementById('billing-period-dates');

        const startDate = new Date(data.billingPeriod.start);
        const endDate = new Date(data.billingPeriod.end);

        const formatDate = (date) => {
            const day = date.getDate();
            const month = date.getMonth() + 1;
            const year = date.getFullYear();
            return `${day}/${month}/${year}`;
        };

        periodDates.textContent = `${formatDate(startDate)} - ${formatDate(endDate)}`;
        periodDisplay.style.display = 'block';

        // Only show if it's not a standard calendar month (day != 1)
        if (data.billingPeriod.startDay === 1) {
            periodDisplay.style.display = 'none';
        }
    }

    // Obligatorios
    document.getElementById('obligatorios-available').textContent = formatNumber(data.obligatorios.disponible);
    document.getElementById('obligatorios-limit').textContent = formatNumber(data.obligatorios.limiteAcumuladoHastaHoy);
    document.getElementById('obligatorios-spent').textContent = formatNumber(data.obligatorios.totalGastado);
    
    const obligatoriosProgress = document.getElementById('progress-obligatorios');
    const obligatoriosPercentage = (data.obligatorios.totalGastado / data.obligatorios.limiteAcumuladoHastaHoy) * 100;
    obligatoriosProgress.style.width = `${Math.min(obligatoriosPercentage, 100)}%`;
    
    if (obligatoriosPercentage > 100) {
        obligatoriosProgress.classList.add('over-limit');
        document.getElementById('obligatorios-available').parentElement.style.color = '#ef4444';
    } else {
        obligatoriosProgress.classList.remove('over-limit');
        document.getElementById('obligatorios-available').parentElement.style.color = '#059669';
    }
    
    // Entretenimiento
    document.getElementById('entretenimiento-available').textContent = formatNumber(data.entretenimiento.disponible);
    document.getElementById('entretenimiento-limit').textContent = formatNumber(data.entretenimiento.limiteAcumuladoHastaHoy);
    document.getElementById('entretenimiento-spent').textContent = formatNumber(data.entretenimiento.totalGastado);
    
    const entretenimientoProgress = document.getElementById('progress-entretenimiento');
    const entretenimientoPercentage = (data.entretenimiento.totalGastado / data.entretenimiento.limiteAcumuladoHastaHoy) * 100;
    entretenimientoProgress.style.width = `${Math.min(entretenimientoPercentage, 100)}%`;
    
    if (entretenimientoPercentage > 100) {
        entretenimientoProgress.classList.add('over-limit');
        document.getElementById('entretenimiento-available').parentElement.style.color = '#ef4444';
    } else {
        entretenimientoProgress.classList.remove('over-limit');
        document.getElementById('entretenimiento-available').parentElement.style.color = '#059669';
    }
    
    // Update weekly breakdowns
    if (data.weeklyBreakdown) {
        updateWeeklyBreakdown('obligatorios', data.weeklyBreakdown);
        updateWeeklyBreakdown('entretenimiento', data.weeklyBreakdown);
    }
}

function toggleWeeklyBreakdown(category) {
    const content = document.getElementById(`${category}-weekly-content`);
    const icon = document.getElementById(`${category}-toggle-icon`);
    
    if (content.classList.contains('collapsed')) {
        content.classList.remove('collapsed');
        icon.textContent = '▼';
    } else {
        content.classList.add('collapsed');
        icon.textContent = '▶';
    }
}

function updateWeeklyBreakdown(category, weeks) {
    const container = document.getElementById(`${category}-weekly`);
    if (!container) return;
    
    let html = `
        <div class="weekly-header-toggle" onclick="toggleWeeklyBreakdown('${category}')">
            <span class="weekly-title">Desglose semanal</span>
            <span class="weekly-toggle-icon" id="${category}-toggle-icon">▶</span>
        </div>
        <div class="weekly-content collapsed" id="${category}-weekly-content">
    `;
    
    weeks.forEach(week => {
        const limit = category === 'obligatorios' ? week.limiteObligatorios : week.limiteEntretenimiento;
        const spent = category === 'obligatorios' ? week.gastadoObligatorios : week.gastadoEntretenimiento;
        const available = category === 'obligatorios' ? week.disponibleObligatorios : week.disponibleEntretenimiento;
        
        let statusClass = '';
        let statusText = '';
        
        if (week.isPast) {
            statusClass = 'week-past';
            const leftover = available;
            if (leftover > 0) {
                statusText = `<span class="week-leftover">Sobró: $${formatNumber(leftover)}</span>`;
            } else if (leftover < 0) {
                statusText = `<span class="week-overspent">Excedido: $${formatNumber(Math.abs(leftover))}</span>`;
            } else {
                statusText = '<span class="week-exact">Exacto</span>';
            }
        } else if (week.isCurrent) {
            statusClass = 'week-current';
            statusText = `<span class="week-available">Disponible: $${formatNumber(available)}</span>`;
        } else {
            statusClass = 'week-future';
            if (spent > 0) {
                statusText = `<span class="week-scheduled">Programado: $${formatNumber(spent)} / $${formatNumber(limit)}</span>`;
            } else {
                statusText = `<span class="week-limit">Límite: $${formatNumber(limit)}</span>`;
            }
        }
        
        const percentage = (spent / limit * 100);
        const shouldShowProgress = week.isPast || week.isCurrent || spent > 0;
        
        html += `
            <div class="week-item ${statusClass}">
                <div class="week-header">
                    <span class="week-label">Semana ${week.weekNumber} (${week.startDate} - ${week.endDate})</span>
                    ${statusText}
                </div>
                ${shouldShowProgress ? `
                    <div class="week-details">
                        <div class="week-amounts">
                            <span>${week.isPast || week.isCurrent ? 'Gastado' : 'Programado'}: $${formatNumber(spent)} / $${formatNumber(limit)}</span>
                        </div>
                        <div class="week-progress">
                            <div class="week-progress-bar ${percentage > 100 ? 'over-limit' : ''} ${!week.isPast && !week.isCurrent ? 'future-expense' : ''}" 
                                 style="width: ${Math.min(percentage, 100)}%"></div>
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
    });
    
    html += '</div>'; // Close weekly-content div
    container.innerHTML = html;
}

async function handleQuickExpense(e) {
    e.preventDefault();
    
    const categoryToggle = document.getElementById('category-toggle');
    const categoria = categoryToggle.checked ? 'Entretenimiento' : 'Obligatorios';
    const prorateCheckbox = document.getElementById('prorate-expense');
    
    const montoInput = document.getElementById('quick-monto');
    const montoValue = montoInput.cleaveInstance ? montoInput.cleaveInstance.getRawValue() : parseFormattedNumber(montoInput.value);
    
    const fechaInput = document.getElementById('quick-fecha');

    // Get currency multiplier from config (default to 1)
    const multiplierInput = document.getElementById('currency-multiplier');
    const multiplier = multiplierInput && multiplierInput.cleaveInstance
        ? parseFloat(multiplierInput.cleaveInstance.getRawValue()) || 1
        : parseFloat(parseFormattedNumber(multiplierInput?.value || '1')) || 1;

    const gasto = {
        categoria: categoria,
        descripcion: document.getElementById('quick-descripcion').value,
        monto: parseFloat(montoValue) * multiplier,
        prorate: prorateCheckbox.checked,
        fecha: fechaInput.value
    };
    
    if (!gasto.descripcion || !gasto.monto) {
        showNotification('Completa todos los campos', 'error');
        return;
    }
    
    // Disable form and show loading state
    const submitButton = e.target.querySelector('button[type="submit"]');
    const originalButtonText = submitButton.innerHTML;
    submitButton.disabled = true;
    submitButton.innerHTML = gasto.prorate 
        ? '<span class="button-spinner"></span> Prorrateando...' 
        : '<span class="button-spinner"></span> Agregando...';
    
    try {
        const response = await authFetch(`${API_URL}/gastos`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(gasto)
        });
        if (!response) return;
        
        if (response.ok) {
            const result = await response.json();
            e.target.reset();
            // Reset date to today after form reset
            const today = new Date();
            fechaInput.value = today.toISOString().split('T')[0];
            loadDashboard();
            
            closeBottomSheet();

            if (gasto.prorate && result.message) {
                showNotification(`✅ ${result.message}`, 'success');
            } else if (multiplier !== 1) {
                showNotification(`✅ Gasto agregado: $${formatNumber(gasto.monto)}`, 'success');
            } else {
                showNotification('✅ Gasto agregado', 'success');
            }
        } else {
            throw new Error('Error al agregar gasto');
        }
    } catch (error) {
        console.error('Error adding expense:', error);
        showNotification('Error al agregar gasto', 'error');
    } finally {
        // Re-enable form
        submitButton.disabled = false;
        submitButton.innerHTML = originalButtonText;
    }
}

async function loadExpenses() {
    const categoria = document.getElementById('filter-categoria').value;
    const mes = document.getElementById('filter-mes').value;
    const año = document.getElementById('filter-año').value;

    // Use current billing period by default if no month/year filter selected
    let url = `${API_URL}/gastos?`;
    if (!mes && !año) {
        url += `currentPeriod=true&`;
    }
    if (categoria) url += `categoria=${categoria}&`;
    if (mes) url += `mes=${mes}&`;
    if (año) url += `año=${año}`;
    
    try {
        const response = await authFetch(url);
        if (!response) return;
        const gastos = await response.json();
        
        const container = document.getElementById('expenses-list-mobile');
        container.innerHTML = '';
        
        if (gastos.length === 0) {
            container.innerHTML = '<div style="text-align: center; color: #6c757d; padding: 40px;">No hay gastos para el período seleccionado</div>';
            return;
        }
        
        gastos.forEach(gasto => {
            const gastoElement = document.createElement('div');
            gastoElement.className = `expense-item ${gasto.categoria.toLowerCase()}`;
            
            const categoriaIcon = gasto.categoria === 'Obligatorios' 
                ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/></svg>'
                : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>';
            
            gastoElement.innerHTML = `
                <div class="expense-header">
                    <div class="expense-amount">$${formatNumber(gasto.monto)}</div>
                    <div class="expense-date">${new Date(gasto.fecha).toLocaleDateString('es-AR')}</div>
                </div>
                <div class="expense-description">${gasto.descripcion}</div>
                <div class="expense-category">
                    <span class="category-with-icon">${categoriaIcon} ${gasto.categoria}</span>
                    <button class="delete-btn" onclick="deleteExpense('${gasto._id}')">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3,6 5,6 21,6"/>
                            <path d="M19,6v14a2,2 0,0,1-2,2H7a2,2 0,0,1-2-2V6m3,0V4a2,2 0,0,1,2-2h4a2,2 0,0,1,2,2v2"/>
                            <line x1="10" y1="11" x2="10" y2="17"/>
                            <line x1="14" y1="11" x2="14" y2="17"/>
                        </svg>
                    </button>
                </div>
            `;
            
            container.appendChild(gastoElement);
        });
    } catch (error) {
        console.error('Error loading expenses:', error);
        showNotification('Error al cargar gastos', 'error');
    }
}

async function deleteExpense(id) {
    if (!confirm('¿Eliminar este gasto?')) return;
    
    try {
        const response = await authFetch(`${API_URL}/gastos/${id}`, {
            method: 'DELETE'
        });
        if (!response) return;
        
        if (response.ok) {
            loadExpenses();
            loadDashboard();
            showNotification('✅ Gasto eliminado', 'success');
        } else {
            throw new Error('Error al eliminar gasto');
        }
    } catch (error) {
        console.error('Error deleting expense:', error);
        showNotification('Error al eliminar gasto', 'error');
    }
}

async function loadConfig() {
    try {
        const response = await authFetch(`${API_URL}/config`);
        if (!response) return;
        const config = await response.json();
        
        const obligatoriosInput = document.getElementById('limite-obligatorios');
        const entretenimientoInput = document.getElementById('limite-entretenimiento');
        
        // Set values using Cleave.js if available
        if (obligatoriosInput.cleaveInstance) {
            obligatoriosInput.cleaveInstance.setRawValue(config.limiteObligatorios);
        } else {
            obligatoriosInput.value = formatNumberWithSeparators(config.limiteObligatorios);
        }
        
        if (entretenimientoInput.cleaveInstance) {
            entretenimientoInput.cleaveInstance.setRawValue(config.limiteEntretenimiento);
        } else {
            entretenimientoInput.value = formatNumberWithSeparators(config.limiteEntretenimiento);
        }
        
        // Set week start day if it exists
        if (config.weekStartDay !== undefined) {
            document.getElementById('week-start-day').value = config.weekStartDay;
        }

        // Set billing cycle start day if it exists
        if (config.billingCycleStartDay !== undefined) {
            document.getElementById('billing-cycle-start-day').value = config.billingCycleStartDay;
        }

        // Set currency multiplier (default to 1)
        const multiplierInput = document.getElementById('currency-multiplier');
        const multiplierValue = config.currencyMultiplier !== undefined ? config.currencyMultiplier : 1;
        if (multiplierInput.cleaveInstance) {
            multiplierInput.cleaveInstance.setRawValue(multiplierValue);
        } else {
            multiplierInput.value = formatNumberWithSeparators(multiplierValue);
        }
    } catch (error) {
        console.error('Error loading config:', error);
        showNotification('Error al cargar configuración', 'error');
    }
}

async function handleConfigSave() {
    const obligatoriosInput = document.getElementById('limite-obligatorios');
    const entretenimientoInput = document.getElementById('limite-entretenimiento');
    const multiplierInput = document.getElementById('currency-multiplier');

    const obligatoriosValue = obligatoriosInput.cleaveInstance ? obligatoriosInput.cleaveInstance.getRawValue() : parseFormattedNumber(obligatoriosInput.value);
    const entretenimientoValue = entretenimientoInput.cleaveInstance ? entretenimientoInput.cleaveInstance.getRawValue() : parseFormattedNumber(entretenimientoInput.value);
    const multiplierValue = multiplierInput.cleaveInstance ? multiplierInput.cleaveInstance.getRawValue() : parseFormattedNumber(multiplierInput.value);

    const config = {
        limiteObligatorios: parseFloat(obligatoriosValue),
        limiteEntretenimiento: parseFloat(entretenimientoValue),
        weekStartDay: parseInt(document.getElementById('week-start-day').value),
        billingCycleStartDay: parseInt(document.getElementById('billing-cycle-start-day').value),
        currencyMultiplier: parseFloat(multiplierValue) || 1
    };
    
    if (!config.limiteObligatorios || !config.limiteEntretenimiento) {
        showNotification('Completa todos los campos', 'error');
        return;
    }
    
    try {
        const response = await authFetch(`${API_URL}/config`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(config)
        });
        if (!response) return;
        
        if (response.ok) {
            showNotification('✅ Configuración guardada', 'success');
            loadDashboard();
        } else {
            throw new Error('Error al guardar configuración');
        }
    } catch (error) {
        console.error('Error saving config:', error);
        showNotification('Error al guardar configuración', 'error');
    }
}

async function exportToCSV() {
    // Export current billing period instead of calendar month
    const url = `${API_URL}/gastos/export/csv?currentPeriod=true`;

    try {
        const response = await authFetch(url);
        if (!response) return;
        if (!response.ok) throw new Error('Error al exportar');
        const blob = await response.blob();
        const disposition = response.headers.get('Content-Disposition') || '';
        const filenameMatch = disposition.match(/filename="?(.+?)"?$/);
        const filename = filenameMatch ? filenameMatch[1] : 'gastos.csv';
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(a.href);
        showNotification('Descargando CSV...', 'success');
    } catch (error) {
        console.error('Error exporting CSV:', error);
        showNotification('Error al exportar CSV', 'error');
    }
}

function formatNumber(num) {
    return new Intl.NumberFormat('es-AR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(num);
}

function showNotification(message, type) {
    // Remover notificación anterior si existe
    const existingNotification = document.querySelector('.notification');
    if (existingNotification) {
        existingNotification.remove();
    }
    
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 3000);
}

function populateMonthYearFilters() {
    const mesSelect = document.getElementById('filter-mes');
    const añoSelect = document.getElementById('filter-año');
    
    // Solo poblar si están vacíos
    if (mesSelect.children.length > 1) return;
    
    const monthNames = [
        'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
        'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
    ];
    
    const currentDate = new Date();
    const currentMonth = currentDate.getMonth() + 1;
    const currentYear = currentDate.getFullYear();
    
    // Poblar meses
    monthNames.forEach((month, index) => {
        const option = document.createElement('option');
        option.value = index + 1;
        option.textContent = month;
        if (index + 1 === currentMonth) {
            option.selected = true;
        }
        mesSelect.appendChild(option);
    });
    
    // Poblar años (últimos 3 años)
    for (let year = currentYear; year >= currentYear - 2; year--) {
        const option = document.createElement('option');
        option.value = year;
        option.textContent = year;
        if (year === currentYear) {
            option.selected = true;
        }
        añoSelect.appendChild(option);
    }
}

function formatNumberWithSeparators(num) {
    return new Intl.NumberFormat('es-AR').format(num);
}

function parseFormattedNumber(formattedStr) {
    // Remove all non-digit characters except decimal point
    return formattedStr.replace(/[^\d.,]/g, '').replace(',', '.');
}

function setupMoneyInputFormatting(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;

    // Initialize Cleave.js for number formatting
    const cleave = new Cleave(input, {
        numeral: true,
        numeralThousandsGroupStyle: 'thousand',
        numeralDecimalMark: ',',
        delimiter: '.',
        numeralDecimalScale: 2,
        numeralPositiveOnly: true
    });

    // Store cleave instance for later use
    input.cleaveInstance = cleave;
}

// Logout
async function handleLogout() {
    if (!confirm('Cerrar sesion?')) return;
    await supabase.auth.signOut();
    window.location.href = '/login.html';
}

// Bottom Sheet
function setupBottomSheet() {
    document.getElementById('fab-add').addEventListener('click', openBottomSheet);
    document.getElementById('bottom-sheet-backdrop').addEventListener('click', closeBottomSheet);

    const sheet = document.getElementById('bottom-sheet');
    let startY = 0;

    sheet.addEventListener('touchstart', (e) => {
        startY = e.touches[0].clientY;
    }, { passive: true });

    sheet.addEventListener('touchend', (e) => {
        if (sheet.scrollTop <= 0 && e.changedTouches[0].clientY - startY > 80) {
            closeBottomSheet();
        }
    });
}

function openBottomSheet() {
    document.getElementById('bottom-sheet').classList.add('active');
    document.getElementById('bottom-sheet-backdrop').classList.add('active');
}

function closeBottomSheet() {
    document.getElementById('bottom-sheet').classList.remove('active');
    document.getElementById('bottom-sheet-backdrop').classList.remove('active');
}