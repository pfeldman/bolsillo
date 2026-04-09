const API_URL = '/api';
let supabase = null;

let currentLimits = null;
let appCategories = []; // loaded from config
let selectedCategory = null; // selected category name for new expense form

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
    document.getElementById('add-category-btn').addEventListener('click', addCategoryRow);

    document.getElementById('filter-categoria').addEventListener('change', loadExpenses);
    document.getElementById('filter-mes').addEventListener('change', loadExpenses);
    document.getElementById('filter-año').addEventListener('change', loadExpenses);

    // Setup money input formatting
    setupMoneyInputFormatting('quick-monto');
    setupMoneyInputFormatting('currency-multiplier');

    setupBottomSheet();
    setupShareModal();
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

    // Store categories for other uses (expense form, filters)
    if (data.categories && data.categories.length > 0) {
        appCategories = data.categories.map(c => ({
            id: c.id, name: c.name, icon: c.icon, color: c.color,
            isShared: c.isShared, isOwner: c.isOwner, owner_id: c.owner_id,
            shared_with: c.shared_with || [],
        }));
        updateCategoryPills();
        updateCategoryFilterOptions();
    }

    // Render category cards dynamically
    const container = document.getElementById('category-cards-container');
    container.innerHTML = '';

    data.categories.forEach((cat, index) => {
        const card = document.createElement('div');
        card.className = 'category-card';

        const percentage = cat.limiteAcumuladoHastaHoy > 0 ? (cat.totalGastado / cat.limiteAcumuladoHastaHoy) * 100 : 0;
        const isOverLimit = percentage > 100;
        const amountColor = isOverLimit ? '#ef4444' : (cat.color || '#059669');
        const progressClass = isOverLimit ? 'over-limit' : '';

        // Build weekly breakdown HTML
        let weeklyHtml = '';
        if (cat.weeklyBreakdown && cat.weeklyBreakdown.length > 0) {
            weeklyHtml = buildWeeklyBreakdownHtml(cat.id, cat.weeklyBreakdown, cat.color);
        }

        // Shared badge
        const sharedBadge = cat.isShared
            ? `<span class="card-shared-badge"><span class="shared-icon">👥</span>${(cat.shared_with || []).length + 1}</span>`
            : '';

        card.innerHTML = `
            <div class="card-top">
                <div class="card-label">${index === 0 ? `<span class="clickable-title" onclick="window.location.reload()">${cat.name.toUpperCase()}</span>` : cat.name.toUpperCase()}${sharedBadge}</div>
                <div class="card-icon" style="background: ${hexToRgba(cat.color || '#059669', 0.15)}; color: ${cat.color || '#059669'};">
                    <span style="font-size: 18px; line-height: 1;">${cat.icon || '💰'}</span>
                </div>
            </div>
            <div class="card-amounts">
                <div class="amount-large" style="color: ${amountColor};">$${formatNumber(cat.disponible)}</div>
                <div class="amount-detail">de $${formatNumber(cat.limiteAcumuladoHastaHoy)} · Gastado $${formatNumber(cat.totalGastado)}</div>
            </div>
            <div class="progress-container">
                <div class="progress-bar ${progressClass}" style="width: ${Math.min(percentage, 100)}%; background: linear-gradient(90deg, ${cat.color || '#059669'}, ${lightenColor(cat.color || '#059669', 30)});"></div>
            </div>
            ${weeklyHtml ? `<div class="weekly-breakdown">${weeklyHtml}</div>` : ''}
        `;

        container.appendChild(card);
    });
}

function buildWeeklyBreakdownHtml(categoryId, weeks, color) {
    let html = `
        <div class="weekly-header-toggle" onclick="toggleWeeklyBreakdown('${categoryId}')">
            <span class="weekly-title">Desglose semanal</span>
            <span class="weekly-toggle-icon" id="${categoryId}-toggle-icon">▶</span>
        </div>
        <div class="weekly-content collapsed" id="${categoryId}-weekly-content">
    `;

    weeks.forEach(week => {
        const limit = week.limite;
        const spent = week.gastado;
        const available = week.disponible;

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

    html += '</div>';
    return html;
}

function toggleWeeklyBreakdown(categoryId) {
    const content = document.getElementById(`${categoryId}-weekly-content`);
    const icon = document.getElementById(`${categoryId}-toggle-icon`);
    if (!content || !icon) return;

    if (content.classList.contains('collapsed')) {
        content.classList.remove('collapsed');
        icon.textContent = '▼';
    } else {
        content.classList.add('collapsed');
        icon.textContent = '▶';
    }
}

// ===== Category pills for expense form =====

function updateCategoryPills() {
    const container = document.getElementById('category-pills-container');
    if (!container) return;

    container.innerHTML = '';
    appCategories.forEach((cat, index) => {
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'category-pill' + (index === 0 ? ' active' : '');
        pill.dataset.category = cat.name;
        pill.style.setProperty('--pill-color', cat.color || '#059669');
        pill.innerHTML = `<span class="pill-icon">${cat.icon || '💰'}</span> ${cat.name}`;
        pill.addEventListener('click', () => selectCategoryPill(cat.name));
        container.appendChild(pill);
    });

    // Default to first category
    selectedCategory = appCategories.length > 0 ? appCategories[0].name : null;
}

function selectCategoryPill(categoryName) {
    selectedCategory = categoryName;
    document.querySelectorAll('.category-pill').forEach(pill => {
        pill.classList.toggle('active', pill.dataset.category === categoryName);
    });
}

// ===== Category filter options for history =====

function updateCategoryFilterOptions() {
    const select = document.getElementById('filter-categoria');
    if (!select) return;

    // Keep the first "Todas" option, remove the rest
    while (select.children.length > 1) {
        select.removeChild(select.lastChild);
    }

    appCategories.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat.name;
        option.textContent = cat.name;
        select.appendChild(option);
    });
}

// ===== Expense form =====

async function handleQuickExpense(e) {
    e.preventDefault();

    const categoria = selectedCategory;
    if (!categoria) {
        showNotification('Selecciona una categoría', 'error');
        return;
    }

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
            // Re-select first pill after form reset
            if (appCategories.length > 0) {
                selectCategoryPill(appCategories[0].name);
            }
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

// ===== Expenses list =====

async function loadExpenses() {
    const categoria = document.getElementById('filter-categoria').value;
    const mes = document.getElementById('filter-mes').value;
    const año = document.getElementById('filter-año').value;

    // Use current billing period by default if no month/year filter selected
    let url = `${API_URL}/gastos?`;
    if (!mes && !año) {
        url += `currentPeriod=true&`;
    }
    if (categoria) url += `categoria=${encodeURIComponent(categoria)}&`;
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
            gastoElement.className = 'expense-item';

            // Find category info for icon/color
            const catInfo = appCategories.find(c => c.name === gasto.categoria);
            const catIcon = catInfo ? catInfo.icon : '💰';
            const catColor = catInfo ? catInfo.color : '#059669';

            gastoElement.innerHTML = `
                <div class="expense-header">
                    <div class="expense-amount">$${formatNumber(gasto.monto)}</div>
                    <div class="expense-date">${new Date(gasto.fecha).toLocaleDateString('es-AR')}</div>
                </div>
                <div class="expense-description">${gasto.descripcion}</div>
                <div class="expense-category">
                    <span class="category-with-icon"><span style="margin-right: 4px;">${catIcon}</span> ${gasto.categoria}</span>
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

// ===== Config (Settings page) =====

// Track Cleave instances for dynamic category inputs
let categoryCleaveInstances = {};

async function loadConfig() {
    try {
        const response = await authFetch(`${API_URL}/config`);
        if (!response) return;
        const config = await response.json();

        // Resolve categories (handle old format migration)
        let categories = config.categories;
        if (!categories || categories.length === 0) {
            categories = [
                { id: 'obligatorios', name: 'Obligatorios', limit: config.limiteObligatorios || 750000, icon: '🏠', color: '#059669' },
                { id: 'entretenimiento', name: 'Entretenimiento', limit: config.limiteEntretenimiento || 750000, icon: '😄', color: '#8b5cf6' },
            ];
        }

        // Store globally (include sharing info)
        appCategories = categories.map(c => ({
            id: c.id, name: c.name, icon: c.icon || '💰', color: c.color || '#059669',
            isShared: c.isShared || false, isOwner: c.isOwner !== false,
            owner_id: c.owner_id || null, shared_with: c.shared_with || [],
        }));
        updateCategoryPills();
        updateCategoryFilterOptions();

        // Render categories in settings (own + shared)
        renderCategoriesConfig(categories, config.sharedCategories || []);

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

function renderCategoriesConfig(categories, sharedCategories = []) {
    const container = document.getElementById('categories-config-list');
    container.innerHTML = '';
    // Clean up old Cleave instances
    categoryCleaveInstances = {};

    categories.forEach((cat, index) => {
        const row = createCategoryConfigRow(cat, index);
        container.appendChild(row);
    });

    // Render shared categories (from other users) below own categories
    if (sharedCategories.length > 0) {
        const sharedHeader = document.createElement('div');
        sharedHeader.className = 'settings-header';
        sharedHeader.style.marginTop = '16px';
        sharedHeader.textContent = 'COMPARTIDAS CONMIGO';
        container.appendChild(sharedHeader);

        sharedCategories.forEach(cat => {
            const card = createSharedCategoryCard(cat);
            container.appendChild(card);
        });
    }
}

function createCategoryConfigRow(cat, index) {
    const wrapper = document.createElement('div');
    wrapper.className = 'settings-card category-config-card';
    wrapper.dataset.index = index;

    const sharedCount = (cat.shared_with && cat.shared_with.length > 0) ? cat.shared_with.length : 0;
    const sharedBadgeHtml = sharedCount > 0
        ? `<span class="card-shared-badge" style="margin-left:0; margin-right:4px;"><span class="shared-icon">👥</span>${sharedCount}</span>`
        : '';

    wrapper.innerHTML = `
        <div class="category-config-header">
            <div class="category-config-icon-color">
                <input type="text" class="category-icon-input" value="${cat.icon || '💰'}" maxlength="4" title="Emoji">
                <input type="color" class="category-color-input" value="${cat.color || '#059669'}" title="Color">
            </div>
            <div style="display:flex;align-items:center;gap:4px;">
                ${sharedBadgeHtml}
                <button type="button" class="category-share-btn" title="Compartir" data-category-id="${cat.id || ''}">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
                        <polyline points="16 6 12 2 8 6"/>
                        <line x1="12" y1="2" x2="12" y2="15"/>
                    </svg>
                </button>
                <button type="button" class="category-delete-btn" title="Eliminar categoría">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3,6 5,6 21,6"/>
                        <path d="M19,6v14a2,2 0,0,1-2,2H7a2,2 0,0,1-2-2V6m3,0V4a2,2 0,0,1,2-2h4a2,2 0,0,1,2,2v2"/>
                    </svg>
                </button>
            </div>
        </div>
        <div class="settings-row">
            <label>Nombre</label>
            <input type="text" class="category-name-input config-text-input" value="${cat.name}" placeholder="Nombre" required>
        </div>
        <div class="settings-separator"></div>
        <div class="settings-row">
            <label>Límite mensual</label>
            <div class="config-input">
                <span class="currency-symbol">$</span>
                <input type="text" class="category-limit-input" placeholder="0" inputmode="decimal" required>
            </div>
        </div>
    `;

    // Delete button handler
    const deleteBtn = wrapper.querySelector('.category-delete-btn');
    deleteBtn.addEventListener('click', () => {
        if (document.querySelectorAll('.category-config-card').length <= 1) {
            showNotification('Necesitas al menos una categoría', 'error');
            return;
        }
        wrapper.remove();
    });

    // Share button handler
    const shareBtn = wrapper.querySelector('.category-share-btn');
    shareBtn.addEventListener('click', () => {
        const catId = shareBtn.dataset.categoryId;
        const catName = wrapper.querySelector('.category-name-input').value.trim();
        // Find full category data from appCategories (to get shared_with)
        const catData = appCategories.find(c => c.id === catId) || {};
        openShareModal(catId || slugify(catName), catName, catData.shared_with || [], true);
    });

    // Setup Cleave.js for the limit input after it's in the DOM
    requestAnimationFrame(() => {
        const limitInput = wrapper.querySelector('.category-limit-input');
        if (limitInput && typeof Cleave !== 'undefined') {
            const cleave = new Cleave(limitInput, {
                numeral: true,
                numeralThousandsGroupStyle: 'thousand',
                numeralDecimalMark: ',',
                delimiter: '.',
                numeralDecimalScale: 2,
                numeralPositiveOnly: true
            });
            limitInput.cleaveInstance = cleave;
            cleave.setRawValue(cat.limit);
        } else if (limitInput) {
            limitInput.value = formatNumberWithSeparators(cat.limit);
        }
    });

    return wrapper;
}

function addCategoryRow() {
    const container = document.getElementById('categories-config-list');
    const index = container.children.length;
    const newCat = { id: '', name: '', limit: 0, icon: '💰', color: '#059669' };
    const row = createCategoryConfigRow(newCat, index);
    container.appendChild(row);

    // Focus the name input
    requestAnimationFrame(() => {
        const nameInput = row.querySelector('.category-name-input');
        if (nameInput) nameInput.focus();
    });
}

function slugify(text) {
    return text
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
}

function collectCategoriesFromConfig() {
    const cards = document.querySelectorAll('.category-config-card');
    const categories = [];

    cards.forEach(card => {
        const name = card.querySelector('.category-name-input').value.trim();
        const limitInput = card.querySelector('.category-limit-input');
        const limitValue = limitInput.cleaveInstance
            ? limitInput.cleaveInstance.getRawValue()
            : parseFormattedNumber(limitInput.value);
        const icon = card.querySelector('.category-icon-input').value.trim() || '💰';
        const color = card.querySelector('.category-color-input').value || '#059669';
        const catId = slugify(name);

        if (name) {
            // Preserve shared_with from existing appCategories data
            const existing = appCategories.find(c => c.id === catId);
            const shared_with = (existing && existing.shared_with) ? existing.shared_with : [];

            categories.push({
                id: catId,
                name: name,
                limit: parseFloat(limitValue) || 0,
                icon: icon,
                color: color,
                shared_with: shared_with,
            });
        }
    });

    return categories;
}

async function handleConfigSave() {
    const multiplierInput = document.getElementById('currency-multiplier');
    const multiplierValue = multiplierInput.cleaveInstance ? multiplierInput.cleaveInstance.getRawValue() : parseFormattedNumber(multiplierInput.value);

    const categories = collectCategoriesFromConfig();

    if (categories.length === 0) {
        showNotification('Necesitas al menos una categoría', 'error');
        return;
    }

    // Validate all categories have name and limit
    for (const cat of categories) {
        if (!cat.name) {
            showNotification('Todas las categorías necesitan un nombre', 'error');
            return;
        }
        if (!cat.limit || cat.limit <= 0) {
            showNotification(`La categoría "${cat.name}" necesita un límite mayor a 0`, 'error');
            return;
        }
    }

    const config = {
        categories: categories,
        weekStartDay: parseInt(document.getElementById('week-start-day').value),
        billingCycleStartDay: parseInt(document.getElementById('billing-cycle-start-day').value),
        currencyMultiplier: parseFloat(multiplierValue) || 1
    };

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
            // Update global categories
            appCategories = categories.map(c => ({ id: c.id, name: c.name, icon: c.icon, color: c.color }));
            updateCategoryPills();
            updateCategoryFilterOptions();
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

// ===== Utility functions =====

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

// Color utility: convert hex to rgba
function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Color utility: lighten a hex color
function lightenColor(hex, percent) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const lighten = (c) => Math.min(255, Math.round(c + (255 - c) * (percent / 100)));
    return `#${lighten(r).toString(16).padStart(2, '0')}${lighten(g).toString(16).padStart(2, '0')}${lighten(b).toString(16).padStart(2, '0')}`;
}

// Logout
async function handleLogout() {
    if (!confirm('Cerrar sesion?')) return;
    await supabase.auth.signOut();
    window.location.href = '/login.html';
}

async function handleDeleteAccount() {
    if (!confirm('¿Estás seguro de que querés eliminar tu cuenta? Todos tus datos se borrarán permanentemente.')) return;
    if (!confirm('Esta acción no se puede deshacer. ¿Estás completamente seguro?')) return;
    try {
        const res = await authFetch('/api/delete-account', { method: 'DELETE' });
        if (res && res.ok) {
            await supabase.auth.signOut();
            window.location.href = '/login.html';
        } else {
            alert('Error eliminando cuenta');
        }
    } catch {
        alert('Error eliminando cuenta');
    }
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

// ===== Shared category card (for categories shared WITH you from others) =====

function createSharedCategoryCard(cat) {
    const wrapper = document.createElement('div');
    wrapper.className = 'settings-card category-shared-card';

    wrapper.innerHTML = `
        <div class="category-config-header">
            <div class="category-config-icon-color">
                <span style="font-size:22px; width:44px; height:38px; display:flex; align-items:center; justify-content:center;">${cat.icon || '💰'}</span>
                <span style="width:38px; height:38px; border-radius:10px; background:${cat.color || '#059669'}; display:inline-block;"></span>
            </div>
            <button type="button" class="category-leave-btn" data-category-id="${cat.id}" data-owner-id="${cat.owner_id}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                    <polyline points="16 17 21 12 16 7"/>
                    <line x1="21" y1="12" x2="9" y2="12"/>
                </svg>
                Salir
            </button>
        </div>
        <div class="settings-row">
            <label>${cat.name}</label>
            <span style="font-size:14px; color:var(--text-tertiary);">$${formatNumber(cat.limit)}/mes</span>
        </div>
        <div class="shared-card-owner">
            <span>👥</span> Compartida · ${(cat.shared_with || []).length + 1} miembros
        </div>
    `;

    // Leave button handler
    const leaveBtn = wrapper.querySelector('.category-leave-btn');
    leaveBtn.addEventListener('click', async () => {
        if (!confirm('¿Salir de esta categoria compartida?')) return;
        try {
            const response = await authFetch(`${API_URL}/categories/share`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    categoryId: leaveBtn.dataset.categoryId,
                    ownerId: leaveBtn.dataset.ownerId,
                }),
            });
            if (!response) return;
            if (response.ok) {
                showNotification('Saliste de la categoria', 'success');
                loadConfig();
                loadDashboard();
            } else {
                const err = await response.json();
                showNotification(err.error || 'Error al salir', 'error');
            }
        } catch (error) {
            console.error('Error leaving category:', error);
            showNotification('Error al salir de la categoria', 'error');
        }
    });

    return wrapper;
}

// ===== Share Modal =====

let shareModalCategoryId = null;
let shareModalIsOwner = false;

function setupShareModal() {
    document.getElementById('share-modal-backdrop').addEventListener('click', closeShareModal);
    document.getElementById('share-modal-close').addEventListener('click', closeShareModal);
    document.getElementById('share-add-btn').addEventListener('click', handleShareInvite);

    // Allow Enter key in email input
    document.getElementById('share-email-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleShareInvite();
        }
    });
}

function openShareModal(categoryId, categoryName, sharedWith, isOwner) {
    shareModalCategoryId = categoryId;
    shareModalIsOwner = isOwner;

    document.getElementById('share-modal-title').textContent = `Compartir: ${categoryName}`;
    document.getElementById('share-email-input').value = '';

    renderShareMembers(sharedWith, isOwner);

    document.getElementById('share-modal').classList.add('active');
    document.getElementById('share-modal-backdrop').classList.add('active');

    // Focus email input
    requestAnimationFrame(() => {
        document.getElementById('share-email-input').focus();
    });
}

function closeShareModal() {
    document.getElementById('share-modal').classList.remove('active');
    document.getElementById('share-modal-backdrop').classList.remove('active');
    shareModalCategoryId = null;
}

function renderShareMembers(sharedWith, isOwner) {
    const list = document.getElementById('share-members-list');
    list.innerHTML = '';

    if (!sharedWith || sharedWith.length === 0) {
        list.innerHTML = '<div style="text-align:center; color:var(--text-tertiary); padding:12px; font-size:14px;">Nadie mas tiene acceso</div>';
        return;
    }

    sharedWith.forEach(member => {
        const item = document.createElement('div');
        item.className = 'share-member-item';

        const initial = (member.email || '?')[0].toUpperCase();

        item.innerHTML = `
            <div class="share-member-info">
                <div class="share-member-avatar">${initial}</div>
                <div>
                    <div class="share-member-email">${member.email}</div>
                    <div class="share-member-role">Miembro</div>
                </div>
            </div>
            ${isOwner ? `<button class="share-member-remove" data-user-id="${member.user_id}" title="Eliminar">&times;</button>` : ''}
        `;

        if (isOwner) {
            const removeBtn = item.querySelector('.share-member-remove');
            removeBtn.addEventListener('click', () => handleShareRemove(member.user_id, member.email));
        }

        list.appendChild(item);
    });
}

async function handleShareInvite() {
    const emailInput = document.getElementById('share-email-input');
    const email = emailInput.value.trim();
    if (!email) {
        showNotification('Ingresa un email', 'error');
        return;
    }

    if (!shareModalCategoryId) return;

    const btn = document.getElementById('share-add-btn');
    btn.disabled = true;
    btn.textContent = 'Invitando...';

    try {
        const response = await authFetch(`${API_URL}/categories/share`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                categoryId: shareModalCategoryId,
                email: email,
            }),
        });
        if (!response) return;

        const result = await response.json();
        if (response.ok) {
            showNotification('Categoria compartida', 'success');
            emailInput.value = '';
            // Update the members list
            renderShareMembers(result.shared_with, shareModalIsOwner);
            // Refresh config to update badges
            loadConfig();
            loadDashboard();
        } else {
            showNotification(result.error || 'Error al compartir', 'error');
        }
    } catch (error) {
        console.error('Error sharing category:', error);
        showNotification('Error al compartir', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Invitar';
    }
}

async function handleShareRemove(userId, email) {
    if (!confirm(`¿Eliminar a ${email}?`)) return;
    if (!shareModalCategoryId) return;

    try {
        const response = await authFetch(`${API_URL}/categories/share`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                categoryId: shareModalCategoryId,
                userId: userId,
            }),
        });
        if (!response) return;

        const result = await response.json();
        if (response.ok) {
            showNotification('Usuario eliminado', 'success');
            renderShareMembers(result.shared_with, shareModalIsOwner);
            loadConfig();
            loadDashboard();
        } else {
            showNotification(result.error || 'Error al eliminar', 'error');
        }
    } catch (error) {
        console.error('Error removing share:', error);
        showNotification('Error al eliminar usuario', 'error');
    }
}
