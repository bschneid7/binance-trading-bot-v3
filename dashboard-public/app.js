// Grid Trading Bot Dashboard - JavaScript

// State
let bots = [];
let systemStatus = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadSystemStatus();
    loadBots();
    
    // Refresh every 30 seconds
    setInterval(() => {
        loadSystemStatus();
        loadBots();
    }, 30000);
});

// API Functions
async function apiCall(endpoint, options = {}) {
    try {
        const response = await fetch(`/api${endpoint}`, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            }
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'API request failed');
        }
        
        return await response.json();
    } catch (error) {
        console.error('API Error:', error);
        showNotification(error.message, 'error');
        throw error;
    }
}

// Load System Status
async function loadSystemStatus() {
    try {
        const status = await apiCall('/status');
        systemStatus = status;
        updateSystemStatus(status);
    } catch (error) {
        console.error('Failed to load system status:', error);
    }
}

function updateSystemStatus(status) {
    // Mode badge
    const modeBadge = document.getElementById('mode-badge');
    modeBadge.textContent = status.mode === 'paper' ? 'Paper Trading' : 'Live Trading';
    modeBadge.className = `badge ${status.mode}`;
    
    // Connection badge
    const connBadge = document.getElementById('connection-badge');
    connBadge.textContent = status.connected ? 'Connected' : 'Disconnected';
    connBadge.className = `badge ${status.connected ? 'connected' : 'disconnected'}`;
    
    // Balance
    if (status.balance) {
        document.getElementById('usd-balance').textContent = formatCurrency(status.balance.usd);
        document.getElementById('btc-balance').textContent = status.balance.btc.toFixed(8);
    }
}

// Load Bots
async function loadBots() {
    try {
        bots = await apiCall('/bots');
        updateBotsDisplay();
        updateStats();
    } catch (error) {
        console.error('Failed to load bots:', error);
        document.getElementById('bots-container').innerHTML = 
            '<div class="empty">Failed to load bots. Please refresh the page.</div>';
    }
}

function updateBotsDisplay() {
    const container = document.getElementById('bots-container');
    
    if (bots.length === 0) {
        container.innerHTML = '<div class="empty">No bots created yet. Create your first bot above!</div>';
        return;
    }
    
    container.innerHTML = bots.map(bot => `
        <div class="bot-card" onclick="showBotDetails(${bot.id})">
            <div class="bot-card-header">
                <div class="bot-card-title">${bot.name}</div>
                <div class="bot-status ${bot.status}">${bot.status}</div>
            </div>
            <div class="bot-card-info">
                <div class="bot-info-row">
                    <span class="bot-info-label">Symbol</span>
                    <span class="bot-info-value">${bot.symbol}</span>
                </div>
                <div class="bot-info-row">
                    <span class="bot-info-label">Range</span>
                    <span class="bot-info-value">${formatCurrency(bot.lower_price)} - ${formatCurrency(bot.upper_price)}</span>
                </div>
                <div class="bot-info-row">
                    <span class="bot-info-label">Grid Levels</span>
                    <span class="bot-info-value">${bot.grid_count}</span>
                </div>
                <div class="bot-info-row">
                    <span class="bot-info-label">Order Size</span>
                    <span class="bot-info-value">${formatCurrency(bot.order_size)}</span>
                </div>
                <div class="bot-info-row">
                    <span class="bot-info-label">Trades</span>
                    <span class="bot-info-value">${bot.stats.trade_count}</span>
                </div>
                <div class="bot-info-row">
                    <span class="bot-info-label">Profit</span>
                    <span class="bot-info-value ${bot.stats.total_profit >= 0 ? 'text-success' : 'text-danger'}">
                        ${formatCurrency(bot.stats.total_profit)}
                    </span>
                </div>
            </div>
            <div class="bot-card-actions" onclick="event.stopPropagation()">
                ${bot.status === 'stopped' 
                    ? `<button class="btn btn-success btn-small" onclick="startBot(${bot.id})">▶ Start</button>`
                    : `<button class="btn btn-danger btn-small" onclick="stopBot(${bot.id})">⏸ Stop</button>`
                }
                <button class="btn btn-danger btn-small" onclick="deleteBot(${bot.id})">🗑 Delete</button>
            </div>
        </div>
    `).join('');
}

function updateStats() {
    const activeBots = bots.filter(b => b.status === 'running').length;
    const totalProfit = bots.reduce((sum, b) => sum + (b.stats.total_profit || 0), 0);
    
    document.getElementById('active-bots').textContent = activeBots;
    document.getElementById('total-profit').textContent = formatCurrency(totalProfit);
}

// Show Bot Details
async function showBotDetails(botId) {
    try {
        const bot = await apiCall(`/bots/${botId}`);
        
        const modal = document.getElementById('bot-modal');
        const modalBody = document.getElementById('modal-body');
        document.getElementById('modal-bot-name').textContent = bot.name;
        
        const gridSpacing = (bot.upper_price - bot.lower_price) / (bot.grid_count - 1);
        
        modalBody.innerHTML = `
            <div style="display: grid; gap: 24px;">
                <div>
                    <h3 style="margin-bottom: 12px;">Configuration</h3>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px;">
                        <div>
                            <div class="bot-info-label">Symbol</div>
                            <div class="bot-info-value">${bot.symbol}</div>
                        </div>
                        <div>
                            <div class="bot-info-label">Status</div>
                            <div class="bot-status ${bot.status}">${bot.status}</div>
                        </div>
                        <div>
                            <div class="bot-info-label">Price Range</div>
                            <div class="bot-info-value">${formatCurrency(bot.lower_price)} - ${formatCurrency(bot.upper_price)}</div>
                        </div>
                        <div>
                            <div class="bot-info-label">Grid Spacing</div>
                            <div class="bot-info-value">${formatCurrency(gridSpacing)}</div>
                        </div>
                        <div>
                            <div class="bot-info-label">Order Size</div>
                            <div class="bot-info-value">${formatCurrency(bot.order_size)}</div>
                        </div>
                        <div>
                            <div class="bot-info-label">Current Price</div>
                            <div class="bot-info-value">${bot.current_price ? formatCurrency(bot.current_price) : 'N/A'}</div>
                        </div>
                    </div>
                </div>
                
                <div>
                    <h3 style="margin-bottom: 12px;">Statistics</h3>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px;">
                        <div>
                            <div class="bot-info-label">Total Trades</div>
                            <div class="bot-info-value">${bot.stats.trade_count}</div>
                        </div>
                        <div>
                            <div class="bot-info-label">Buy Orders</div>
                            <div class="bot-info-value">${bot.stats.buy_count}</div>
                        </div>
                        <div>
                            <div class="bot-info-label">Sell Orders</div>
                            <div class="bot-info-value">${bot.stats.sell_count}</div>
                        </div>
                        <div>
                            <div class="bot-info-label">Total Profit</div>
                            <div class="bot-info-value">${formatCurrency(bot.stats.total_profit)}</div>
                        </div>
                        <div>
                            <div class="bot-info-label">Avg Profit/Trade</div>
                            <div class="bot-info-value">${formatCurrency(bot.stats.avg_profit)}</div>
                        </div>
                    </div>
                </div>
                
                <div>
                    <h3 style="margin-bottom: 12px;">Grid Levels (${bot.grid_levels.length})</h3>
                    <div class="grid-levels">
                        ${bot.grid_levels.map((level, index) => `
                            <div class="grid-level ${level.type.toLowerCase()}">
                                <span>Level ${index + 1}: ${level.type}</span>
                                <span>${formatCurrency(level.price)}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
                
                ${bot.trades.length > 0 ? `
                    <div>
                        <h3 style="margin-bottom: 12px;">Recent Trades (${bot.trades.length})</h3>
                        <div class="trades-list">
                            ${bot.trades.map(trade => `
                                <div class="trade-item ${trade.trade_type.toLowerCase()}">
                                    <div>
                                        <strong>${trade.trade_type}</strong> 
                                        ${formatCurrency(trade.price)} x ${trade.amount.toFixed(8)}
                                    </div>
                                    <div>
                                        ${trade.profit ? formatCurrency(trade.profit) : ''}
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}
                
                <div style="display: flex; gap: 12px; flex-wrap: wrap;">
                    ${bot.status === 'stopped' 
                        ? `<button class="btn btn-success" onclick="startBot(${bot.id}); closeModal();">▶ Start Bot</button>`
                        : `<button class="btn btn-danger" onclick="stopBot(${bot.id}); closeModal();">⏸ Stop Bot</button>`
                    }
                    <button class="btn btn-danger" onclick="deleteBot(${bot.id}); closeModal();">🗑 Delete Bot</button>
                    <button class="btn btn-secondary" onclick="closeModal()">Close</button>
                </div>
            </div>
        `;
        
        modal.classList.add('active');
    } catch (error) {
        console.error('Failed to load bot details:', error);
    }
}

function closeModal() {
    document.getElementById('bot-modal').classList.remove('active');
}

// Bot Actions
async function createBot() {
    const name = document.getElementById('bot-name').value;
    const symbol = document.getElementById('bot-symbol').value;
    const lowerPrice = parseFloat(document.getElementById('bot-lower').value);
    const upperPrice = parseFloat(document.getElementById('bot-upper').value);
    const gridCount = parseInt(document.getElementById('bot-grids').value);
    const orderSize = parseFloat(document.getElementById('bot-size').value);
    
    if (!name || !lowerPrice || !upperPrice || !gridCount || !orderSize) {
        showNotification('Please fill in all required fields', 'error');
        return;
    }
    
    if (lowerPrice >= upperPrice) {
        showNotification('Lower price must be less than upper price', 'error');
        return;
    }
    
    if (gridCount < 2) {
        showNotification('Grid count must be at least 2', 'error');
        return;
    }
    
    try {
        const bot = await apiCall('/bots', {
            method: 'POST',
            body: JSON.stringify({
                name,
                symbol,
                lower_price: lowerPrice,
                upper_price: upperPrice,
                grid_count: gridCount,
                order_size: orderSize
            })
        });
        
        showNotification(`Bot "${name}" created successfully!`, 'success');
        
        if (bot.warning) {
            showNotification(bot.warning, 'warning');
        }
        
        // Clear form
        document.getElementById('bot-name').value = '';
        document.getElementById('bot-lower').value = '';
        document.getElementById('bot-upper').value = '';
        document.getElementById('bot-grids').value = '';
        document.getElementById('bot-size').value = '';
        
        toggleCreateForm();
        loadBots();
    } catch (error) {
        console.error('Failed to create bot:', error);
    }
}

async function startBot(botId) {
    try {
        await apiCall(`/bots/${botId}/start`, { method: 'POST' });
        showNotification('Bot started successfully!', 'success');
        loadBots();
    } catch (error) {
        console.error('Failed to start bot:', error);
    }
}

async function stopBot(botId) {
    try {
        await apiCall(`/bots/${botId}/stop`, { method: 'POST' });
        showNotification('Bot stopped successfully!', 'success');
        loadBots();
    } catch (error) {
        console.error('Failed to stop bot:', error);
    }
}

async function deleteBot(botId) {
    if (!confirm('Are you sure you want to delete this bot? This action cannot be undone.')) {
        return;
    }
    
    try {
        await apiCall(`/bots/${botId}?force=true`, { method: 'DELETE' });
        showNotification('Bot deleted successfully!', 'success');
        loadBots();
    } catch (error) {
        console.error('Failed to delete bot:', error);
    }
}

// UI Functions
function toggleCreateForm() {
    const form = document.getElementById('create-bot-form');
    const toggleText = document.getElementById('create-toggle-text');
    
    if (form.style.display === 'none') {
        form.style.display = 'block';
        toggleText.textContent = 'Hide Form';
    } else {
        form.style.display = 'none';
        toggleText.textContent = 'Show Form';
    }
}

function showNotification(message, type = 'info') {
    // Simple notification (you can enhance this with a library)
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 16px 24px;
        background: ${type === 'success' ? 'var(--success)' : type === 'error' ? 'var(--danger)' : 'var(--warning)'};
        color: white;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        z-index: 10000;
        font-weight: 600;
        max-width: 400px;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 5000);
}

// Utility Functions
function formatCurrency(value) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(value);
}

// Close modal on outside click
document.getElementById('bot-modal').addEventListener('click', (e) => {
    if (e.target.id === 'bot-modal') {
        closeModal();
    }
});
