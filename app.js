const { createApp, ref, computed, watch, onMounted, nextTick } = Vue;

let _registerCooldownTimer = null;

const STORAGE_KEYS = {
  cards: 'fa_cards',
  transactions: 'fa_transactions',
  expenseCategories: 'fa_expense_categories',
  incomeCategories: 'fa_income_categories',
  settings: 'fa_settings',
};

function loadLocal(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function hasLocalData() {
  return localStorage.getItem(STORAGE_KEYS.cards) !== null
    || localStorage.getItem(STORAGE_KEYS.transactions) !== null;
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const DEFAULT_EXPENSE_CATEGORIES = [
  { id: uid(), name: '餐饮', icon: '🍜', type: 'expense' },
  { id: uid(), name: '交通', icon: '🚌', type: 'expense' },
  { id: uid(), name: '购物', icon: '🛒', type: 'expense' },
  { id: uid(), name: '娱乐', icon: '🎮', type: 'expense' },
  { id: uid(), name: '居住', icon: '🏠', type: 'expense' },
  { id: uid(), name: '通讯', icon: '📱', type: 'expense' },
  { id: uid(), name: '医疗', icon: '🏥', type: 'expense' },
  { id: uid(), name: '教育', icon: '📚', type: 'expense' },
  { id: uid(), name: '服饰', icon: '👔', type: 'expense' },
  { id: uid(), name: '日用', icon: '🧴', type: 'expense' },
  { id: uid(), name: '其他', icon: '📦', type: 'expense' },
];

const DEFAULT_INCOME_CATEGORIES = [
  { id: uid(), name: '工资', icon: '💼', type: 'income' },
  { id: uid(), name: '奖金', icon: '🎁', type: 'income' },
  { id: uid(), name: '兼职', icon: '💪', type: 'income' },
  { id: uid(), name: '投资', icon: '📈', type: 'income' },
  { id: uid(), name: '红包', icon: '🧧', type: 'income' },
  { id: uid(), name: '其他', icon: '💡', type: 'income' },
];

const CARD_COLORS = [
  '#4F46E5', '#7C3AED', '#DB2777', '#DC2626',
  '#EA580C', '#D97706', '#65A30D', '#059669',
  '#0891B2', '#2563EB', '#4338CA', '#374151',
];

// Paul Tol bright 配色扩展，色相分散、色盲友好
const CHART_CATEGORY_COLORS = [
  '#4477AA', '#EE6677', '#228833', '#CCBB44', '#66CCEE',
  '#AA3377', '#EE7733', '#009988', '#CC3311', '#7A5195', '#5C5C5C',
];

const ANALYTICS_CHART_IDS = [
  'dailyTrendChart',
  'categoryPieChart',
  'monthlyCompareChart',
  'spendingLineChart',
  'qualityTrendChart',
];

const EMOJI_OPTIONS = [
  '🍜','🍔','🍕','☕','🚌','🚗','✈️','🚇',
  '🛒','🎮','🎬','🎵','🏠','💡','📱','💻',
  '🏥','💊','📚','🎓','👔','👟','🧴','🔧',
  '📦','🎁','💼','💪','📈','🧧','💡','🏦',
  '🐱','🐶','🌸','🎯','⚽','🎨','🍺','🧸',
];

// ========== 账期计算 ==========
function getBillingPeriod(offset = 0, payday = 10) {
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth();

  if (now.getDate() < payday) {
    month -= 1;
  }
  month += offset;

  while (month < 0) { month += 12; year--; }
  while (month > 11) { month -= 12; year++; }

  const start = new Date(year, month, payday);

  let endYear = year;
  let endMonth = month + 1;
  if (endMonth > 11) { endMonth -= 12; endYear++; }
  const end = new Date(endYear, endMonth, payday);

  return { start, end };
}

function formatPeriodLabel(offset, payday = 10) {
  const { start, end } = getBillingPeriod(offset, payday);
  const fmt = d => `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
  return `${fmt(start)} — ${fmt(end)}`;
}

// ========== Vue App ==========
const app = createApp({
  data() {
    return {
      configReady: FaStore.isConfigured(),
      authLoading: true,
      dataLoading: false,
      authSubmitting: false,
      registerCooldownLeft: 0,
      user: null,
      authMode: 'login',
      authForm: { email: '', password: '' },
      authError: '',

      currentView: 'dashboard',
      sidebarCollapsed: false,
      showMobileUserMenu: false,
      activeModal: null,
      txSubmitting: false,

      cards: [],
      transactions: [],
      expenseCategories: [],
      incomeCategories: [],
      settings: { payday: 10 },
      showMigrateBanner: false,

      navItems: [
        { view: 'dashboard', icon: '📊', label: '仪表盘' },
        { view: 'cards', icon: '💳', label: '卡片管理' },
        { view: 'transaction', icon: '📝', label: '记一笔' },
        { view: 'records', icon: '📋', label: '账单记录' },
        { view: 'analytics', icon: '📈', label: '数据分析' },
        { view: 'export', icon: '📤', label: '数据导出' },
        { view: 'settings', icon: '⚙️', label: '设置' },
      ],

      txForm: {
        type: 'expense',
        date: new Date().toISOString().slice(0, 10),
        category: '',
        amount: null,
        cardId: '',
        fromCardId: '',
        toCardId: '',
        description: '',
      },

      newCard: { name: '', type: 'debit', balance: 0, creditLimit: 0, color: CARD_COLORS[0] },
      editCardForm: { id: '', name: '', type: 'debit', balance: 0, creditLimit: 0, color: CARD_COLORS[0], createdAt: 0 },
      newCategory: { name: '', type: 'expense', icon: '📦' },

      recordFilter: {
        type: 'all',
        cardId: 'all',
        category: 'all',
        startDate: '',
        endDate: '',
      },

      analyticsPeriodOffset: 0,
      exportPeriodOffset: 0,

      cardColors: CARD_COLORS,
      emojiOptions: EMOJI_OPTIONS,

      toast: { show: false, message: '', type: 'info' },

      chartInstances: {},
      selectedDoughnutIndex: {},
      doughnutChartData: {},
      hiddenDoughnutIndices: {},
      _chartRenderGen: 0,
    };
  },

  computed: {
    totalBalance() {
      return this.cards
        .filter(c => c.type === 'debit')
        .reduce((sum, c) => sum + c.balance, 0);
    },

    totalDebt() {
      return this.cards
        .filter(c => c.type === 'credit')
        .reduce((sum, c) => sum + this.getCardDebt(c), 0);
    },

    netWorth() {
      return this.totalBalance - this.totalDebt;
    },

    currentPeriod() {
      return getBillingPeriod(0, this.settings.payday);
    },

    currentPeriodTransactions() {
      const { start, end } = this.currentPeriod;
      return this.transactions.filter(tx => {
        const d = new Date(tx.date);
        return d >= start && d < end;
      });
    },

    currentPeriodExpense() {
      return this.currentPeriodTransactions
        .filter(tx => tx.type === 'expense')
        .reduce((s, tx) => s + tx.amount, 0);
    },

    recentTransactions() {
      return [...this.transactions]
        .sort((a, b) => new Date(b.date) - new Date(a.date) || b.createdAt - a.createdAt)
        .slice(0, 10);
    },

    allCategories() {
      return [...this.expenseCategories, ...this.incomeCategories];
    },

    filteredTransactions() {
      let list = [...this.transactions];
      const f = this.recordFilter;

      if (f.type !== 'all') list = list.filter(tx => tx.type === f.type);
      if (f.cardId !== 'all') list = list.filter(tx =>
        tx.cardId === f.cardId || tx.fromCardId === f.cardId || tx.toCardId === f.cardId
      );
      if (f.category !== 'all') list = list.filter(tx => tx.category === f.category);
      if (f.startDate) list = list.filter(tx => tx.date >= f.startDate);
      if (f.endDate) list = list.filter(tx => tx.date <= f.endDate);

      return list.sort((a, b) => new Date(b.date) - new Date(a.date) || b.createdAt - a.createdAt);
    },

    filteredExpenseTotal() {
      return this.filteredTransactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    },

    filteredIncomeTotal() {
      return this.filteredTransactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    },

    analyticsPeriodLabel() {
      return formatPeriodLabel(this.analyticsPeriodOffset, this.settings.payday);
    },

    analyticsPeriodTransactions() {
      const { start, end } = getBillingPeriod(this.analyticsPeriodOffset, this.settings.payday);
      return this.transactions.filter(tx => {
        const d = new Date(tx.date);
        return d >= start && d < end;
      });
    },

    exportPeriodOptions() {
      const options = [];
      for (let i = 0; i >= -11; i--) {
        options.push({ offset: i, label: formatPeriodLabel(i, this.settings.payday) });
      }
      return options;
    },

    exportTransactions() {
      const { start, end } = getBillingPeriod(this.exportPeriodOffset, this.settings.payday);
      return this.transactions
        .filter(tx => {
          const d = new Date(tx.date);
          return d >= start && d < end;
        })
        .sort((a, b) => new Date(a.date) - new Date(b.date));
    },

    exportExpenseTotal() {
      return this.exportTransactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    },

    exportIncomeTotal() {
      return this.exportTransactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    },

    // 生活质量指标
    engelCoefficient() {
      const expenses = this.analyticsPeriodTransactions.filter(t => t.type === 'expense');
      const total = expenses.reduce((s, t) => s + t.amount, 0);
      if (total === 0) return 0;
      const food = expenses.filter(t => t.category === '餐饮').reduce((s, t) => s + t.amount, 0);
      return Math.round((food / total) * 100);
    },

    engelClass() {
      const v = this.engelCoefficient;
      if (v <= 30) return 'good';
      if (v <= 50) return 'medium';
      return 'poor';
    },

    engelRating() {
      const v = this.engelCoefficient;
      if (v === 0) return '暂无数据';
      if (v <= 20) return '极其富裕';
      if (v <= 30) return '富裕';
      if (v <= 40) return '小康';
      if (v <= 50) return '温饱';
      return '贫困';
    },

    savingsRate() {
      const txs = this.analyticsPeriodTransactions;
      const income = txs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
      const expense = txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
      if (income === 0) return 0;
      return Math.round(((income - expense) / income) * 100);
    },

    savingsRateClass() {
      const v = this.savingsRate;
      if (v >= 30) return 'good';
      if (v >= 10) return 'medium';
      return 'poor';
    },

    savingsRateRating() {
      const v = this.savingsRate;
      if (v === 0) return '暂无数据';
      if (v >= 50) return '储蓄能力极强';
      if (v >= 30) return '储蓄能力优秀';
      if (v >= 10) return '储蓄能力一般';
      if (v >= 0) return '收支基本平衡';
      return '入不敷出';
    },

    spendingChange() {
      const curr = this.analyticsPeriodTransactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
      const { start, end } = getBillingPeriod(this.analyticsPeriodOffset - 1, this.settings.payday);
      const prev = this.transactions
        .filter(tx => { const d = new Date(tx.date); return d >= start && d < end && tx.type === 'expense'; })
        .reduce((s, t) => s + t.amount, 0);
      if (prev === 0) return 0;
      return Math.round(((curr - prev) / prev) * 100);
    },

    spendingChangeClass() {
      const v = this.spendingChange;
      if (v <= -10) return 'good';
      if (v <= 10) return 'medium';
      return 'poor';
    },

    spendingChangeRating() {
      const v = this.spendingChange;
      if (v === 0 && this.analyticsPeriodTransactions.filter(t => t.type === 'expense').length === 0) return '暂无数据';
      if (v <= -20) return '消费大幅减少';
      if (v <= -5) return '消费有所减少';
      if (v <= 5) return '消费基本持平';
      if (v <= 20) return '消费有所增加';
      return '消费大幅增加';
    },

    lifeQualityScore() {
      let score = 50;
      const engel = this.engelCoefficient;
      if (engel > 0) {
        if (engel <= 20) score += 25;
        else if (engel <= 30) score += 20;
        else if (engel <= 40) score += 10;
        else if (engel <= 50) score += 0;
        else score -= 10;
      }

      const sr = this.savingsRate;
      if (sr >= 50) score += 20;
      else if (sr >= 30) score += 15;
      else if (sr >= 10) score += 5;
      else if (sr >= 0) score += 0;
      else score -= 10;

      const sc = Math.abs(this.spendingChange);
      if (sc <= 5) score += 5;
      else if (sc <= 15) score += 0;
      else score -= 5;

      return Math.max(0, Math.min(100, score));
    },

    lifeQualityRating() {
      const s = this.lifeQualityScore;
      if (s >= 85) return '生活质量优秀';
      if (s >= 70) return '生活质量良好';
      if (s >= 50) return '生活质量一般';
      if (s >= 30) return '生活质量偏低';
      return '需要关注财务状况';
    },

    authButtonDisabled() {
      return this.authSubmitting || (this.authMode === 'register' && this.registerCooldownLeft > 0);
    },

    authButtonText() {
      if (this.authSubmitting) return '处理中...';
      if (this.authMode === 'register' && this.registerCooldownLeft > 0) {
        return `请等待 ${this.registerCooldownLeft}s`;
      }
      return this.authMode === 'login' ? '登录' : '注册';
    },
  },

  watch: {
    currentView(newView, oldView) {
      if (oldView === 'analytics') {
        this.destroyAnalyticsCharts();
      }
      this.scheduleChartRender();
    },
    analyticsPeriodOffset() {
      this.scheduleChartRender();
    },
  },

  async mounted() {
    if (!this.configReady) {
      this.authLoading = false;
      return;
    }

    // 主动读取本地缓存的 session，避免刷新/重开时卡在加载界面
    try {
      const session = await FaStore.getSession();
      this.user = session?.user ?? null;
      if (this.user) {
        await this.loadCloudData();
        this.startRealtime(this.user.id);
      }
    } catch (err) {
      this.user = null;
    } finally {
      this.authLoading = false;
    }

    // authLoading 变为 false 后主模板才会渲染出 canvas 元素，
    // 需要在这里再触发一次图表渲染，确保 canvas 已挂载到 DOM
    if (this.user) {
      this.scheduleChartRender();
    }

    // 监听后续登录 / 退出事件
    FaStore.onAuthStateChange(async (session) => {
      const newUser = session?.user ?? null;
      // 用户未发生变化则跳过，避免重复加载
      if (newUser?.id === this.user?.id) return;
      this.user = newUser;
      if (this.user) {
        await this.loadCloudData();
        this.startRealtime(this.user.id);
      } else {
        this.resetLocalState();
      }
    });

    // 页面重新可见时（从后台切回、从休眠恢复）补刷一次，
    // 作为 Realtime 断线兜底
    this._visibilityHandler = () => {
      if (document.visibilityState === 'visible' && this.user) {
        this.loadCloudData();
      }
    };
    document.addEventListener('visibilitychange', this._visibilityHandler);
  },

  beforeUnmount() {
    this.stopRealtime();
    if (this._visibilityHandler) {
      document.removeEventListener('visibilitychange', this._visibilityHandler);
      this._visibilityHandler = null;
    }
  },

  methods: {
    // ========== 认证与云端同步 ==========
    resetLocalState() {
      this.stopRealtime();
      this.cards = [];
      this.transactions = [];
      this.expenseCategories = [];
      this.incomeCategories = [];
      this.settings = { payday: 10 };
      this.showMigrateBanner = false;
    },

    startRealtime(userId) {
      this.stopRealtime();
      this._realtimeUnsubscribe = FaStore.subscribeDataChanges(userId, () => {
        // 防抖：500ms 内连续触发只刷新一次
        clearTimeout(this._realtimeDebounce);
        this._realtimeDebounce = setTimeout(() => this.loadCloudData(), 500);
      });
    },

    stopRealtime() {
      clearTimeout(this._realtimeDebounce);
      if (this._realtimeUnsubscribe) {
        this._realtimeUnsubscribe();
        this._realtimeUnsubscribe = null;
      }
    },

    // 按名称去重，保留每个名称的第一条（防止数据库中存在重复分类记录）
    dedupeCategories(cats) {
      const seen = new Set();
      return cats.filter(c => {
        if (seen.has(c.name)) return false;
        seen.add(c.name);
        return true;
      });
    },

    async loadCloudData() {
      if (!this.user) return;
      this.dataLoading = true;
      try {
        const data = await FaStore.loadAll(this.user.id);
        const isEmpty = !data.cards.length && !data.transactions.length
          && !data.expenseCategories.length && !data.incomeCategories.length;

        if (isEmpty) {
          const expense = DEFAULT_EXPENSE_CATEGORIES.map(c => ({ ...c, id: uid() }));
          const income = DEFAULT_INCOME_CATEGORIES.map(c => ({ ...c, id: uid() }));
          await FaStore.seedDefaults(this.user.id, expense, income);
          this.expenseCategories = expense;
          this.incomeCategories = income;
          this.settings = { payday: 10 };
          this.showMigrateBanner = hasLocalData();
        } else {
          this.cards = data.cards;
          this.transactions = data.transactions;
          this.expenseCategories = this.dedupeCategories(
            data.expenseCategories.length
              ? data.expenseCategories
              : DEFAULT_EXPENSE_CATEGORIES.map(c => ({ ...c, id: uid() }))
          );
          this.incomeCategories = this.dedupeCategories(
            data.incomeCategories.length
              ? data.incomeCategories
              : DEFAULT_INCOME_CATEGORIES.map(c => ({ ...c, id: uid() }))
          );
          this.settings = data.settings || { payday: 10 };
        }

        this.initRecordFilter();
        this.scheduleChartRender();
      } catch (err) {
        this.showToast('加载数据失败: ' + err.message, 'error');
      } finally {
        this.dataLoading = false;
      }
    },

    async handleAuth() {
      this.authError = '';

      if (this.authMode === 'register' && this.registerCooldownLeft > 0) {
        this.authError = `请等待 ${this.registerCooldownLeft} 秒后再试`;
        return;
      }

      const { email, password } = this.authForm;
      if (!email.trim() || !password) {
        this.authError = '请输入邮箱和密码';
        return;
      }

      this.authSubmitting = true;
      try {
        if (this.authMode === 'login') {
          await FaStore.signIn(email.trim(), password);
          this.showToast('登录成功', 'success');
        } else {
          await FaStore.signUp(email.trim(), password);
          this.showToast('注册成功，请查收验证邮件', 'success');
          this.startRegisterCooldown(60);
        }
        this.authForm.password = '';
      } catch (err) {
        let msg = err.message || '认证失败';
        if (msg.toLowerCase().includes('email rate limit exceeded')) {
          msg = '邮件发送过于频繁，请稍后再试（Supabase 免费版每小时限发 4 封验证邮件）';
          this.startRegisterCooldown(300);
        }
        this.authError = msg;
      } finally {
        this.authSubmitting = false;
      }
    },

    startRegisterCooldown(seconds) {
      this.registerCooldownLeft = seconds;
      if (_registerCooldownTimer) clearInterval(_registerCooldownTimer);
      _registerCooldownTimer = setInterval(() => {
        this.registerCooldownLeft--;
        if (this.registerCooldownLeft <= 0) {
          this.registerCooldownLeft = 0;
          clearInterval(_registerCooldownTimer);
          _registerCooldownTimer = null;
        }
      }, 1000);
    },

    async handleLogout() {
      if (!confirm('确定要退出登录吗？')) return;
      try {
        await FaStore.signOut();
        this.showToast('已退出登录', 'info');
      } catch (err) {
        this.showToast('退出失败: ' + err.message, 'error');
      }
    },

    async persistCard(card) {
      if (!this.user) return;
      await FaStore.upsertCard(card, this.user.id);
    },

    async persistCards(cards) {
      await Promise.all(cards.map(c => this.persistCard(c)));
    },

    async persistTransaction(tx) {
      if (!this.user) return;
      await FaStore.upsertTransaction(tx, this.user.id);
    },

    async persistCategory(cat) {
      if (!this.user) return;
      await FaStore.upsertCategory(cat, this.user.id);
    },

    async migrateLocalData() {
      if (!this.user || !hasLocalData()) return;
      if (!confirm('将本地浏览器数据上传到云端，云端现有数据将被覆盖。确定继续吗？')) return;
      this.dataLoading = true;
      try {
        const data = {
          cards: loadLocal(STORAGE_KEYS.cards, []),
          transactions: loadLocal(STORAGE_KEYS.transactions, []),
          expenseCategories: loadLocal(STORAGE_KEYS.expenseCategories, DEFAULT_EXPENSE_CATEGORIES),
          incomeCategories: loadLocal(STORAGE_KEYS.incomeCategories, DEFAULT_INCOME_CATEGORIES),
          settings: loadLocal(STORAGE_KEYS.settings, { payday: 10 }),
        };
        await FaStore.replaceAllData(this.user.id, data);
        Object.values(STORAGE_KEYS).forEach(k => localStorage.removeItem(k));
        await this.loadCloudData();
        this.showMigrateBanner = false;
        this.showToast('本地数据已迁移到云端', 'success');
      } catch (err) {
        this.showToast('迁移失败: ' + err.message, 'error');
      } finally {
        this.dataLoading = false;
      }
    },

    // ========== 工具方法 ==========
    formatMoney(val) {
      return Number(val || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    },

    formatDate(dateStr) {
      const d = new Date(dateStr);
      return `${d.getMonth()+1}月${d.getDate()}日`;
    },

    getCardName(cardId) {
      const card = this.cards.find(c => c.id === cardId);
      return card ? card.name : '已删除卡片';
    },

    getCardDebt(card) {
      if (card.type !== 'credit') return 0;
      return card.balance < 0 ? Math.abs(card.balance) : 0;
    },

    showToast(message, type = 'info') {
      this.toast = { show: true, message, type };
      setTimeout(() => { this.toast.show = false; }, 2500);
    },

    showModal(name) { this.activeModal = name; },
    closeModal() { this.activeModal = null; },

    switchView(view) {
      this.currentView = view;
      this.showMobileUserMenu = false;
    },

    changeAnalyticsPeriod(delta) {
      const next = this.analyticsPeriodOffset + delta;
      if (delta > 0 && next > 0) return;
      this.analyticsPeriodOffset = next;
      this.selectedDoughnutIndex['categoryPieChart'] = null;
    },

    initRecordFilter() {
      const { start, end } = this.currentPeriod;
      this.recordFilter.startDate = start.toISOString().slice(0, 10);
      this.recordFilter.endDate = end.toISOString().slice(0, 10);
    },

    async saveSettings() {
      try {
        await FaStore.upsertSettings(this.settings, this.user.id);
        this.showToast('设置已保存', 'success');
      } catch (err) {
        this.showToast('保存失败: ' + err.message, 'error');
      }
    },

    // ========== 卡片管理 ==========
    async addCard() {
      if (!this.newCard.name.trim()) {
        this.showToast('请输入卡片名称', 'error');
        return;
      }
      const card = {
        id: uid(),
        name: this.newCard.name.trim(),
        type: this.newCard.type,
        balance: this.newCard.type === 'credit' ? -(this.newCard.balance || 0) : (this.newCard.balance || 0),
        creditLimit: this.newCard.type === 'credit' ? (this.newCard.creditLimit || 0) : 0,
        color: this.newCard.color,
        createdAt: Date.now(),
      };
      try {
        await this.persistCard(card);
        this.cards.push(card);
        this.newCard = { name: '', type: 'debit', balance: 0, creditLimit: 0, color: CARD_COLORS[0] };
        this.closeModal();
        this.showToast('卡片添加成功', 'success');
      } catch (err) {
        this.showToast('添加失败: ' + err.message, 'error');
      }
    },

    openEditCard(card) {
      this.editCardForm = {
        id: card.id,
        name: card.name,
        type: card.type,
        balance: card.type === 'credit' ? this.getCardDebt(card) : card.balance,
        creditLimit: card.creditLimit || 0,
        color: card.color,
        createdAt: card.createdAt,
      };
      this.showModal('editCard');
    },

    async saveEditCard() {
      if (!this.editCardForm.name.trim()) {
        this.showToast('请输入卡片名称', 'error');
        return;
      }
      const idx = this.cards.findIndex(c => c.id === this.editCardForm.id);
      if (idx === -1) return;

      const card = {
        id: this.editCardForm.id,
        name: this.editCardForm.name.trim(),
        type: this.editCardForm.type,
        balance: this.editCardForm.type === 'credit'
          ? -(this.editCardForm.balance || 0)
          : (this.editCardForm.balance || 0),
        creditLimit: this.editCardForm.type === 'credit' ? (this.editCardForm.creditLimit || 0) : 0,
        color: this.editCardForm.color,
        createdAt: this.editCardForm.createdAt,
      };

      try {
        await this.persistCard(card);
        this.cards[idx] = card;
        this.closeModal();
        this.showToast('卡片已更新', 'success');
      } catch (err) {
        this.showToast('更新失败: ' + err.message, 'error');
      }
    },

    confirmDeleteCard(card) {
      if (confirm(`确定要删除「${card.name}」吗？删除后该卡片相关的交易记录将保留。`)) {
        FaStore.deleteCard(card.id).then(() => {
          this.cards = this.cards.filter(c => c.id !== card.id);
          this.showToast('卡片已删除', 'success');
        }).catch(err => {
          this.showToast('删除失败: ' + err.message, 'error');
        });
      }
    },

    // ========== 分类管理 ==========
    async addCategory() {
      if (!this.newCategory.name.trim()) {
        this.showToast('请输入分类名称', 'error');
        return;
      }
      const cat = {
        id: uid(),
        name: this.newCategory.name.trim(),
        icon: this.newCategory.icon,
        type: this.newCategory.type,
      };
      try {
        await this.persistCategory(cat);
        if (cat.type === 'expense') {
          this.expenseCategories.push(cat);
        } else {
          this.incomeCategories.push(cat);
        }
        this.newCategory = { name: '', type: this.newCategory.type, icon: '📦' };
        this.closeModal();
        this.showToast('分类添加成功', 'success');
      } catch (err) {
        this.showToast('添加失败: ' + err.message, 'error');
      }
    },

    deleteCategory(cat) {
      if (confirm(`确定要删除分类「${cat.name}」吗？`)) {
        FaStore.deleteCategory(cat.id).then(() => {
          if (cat.type === 'expense') {
            this.expenseCategories = this.expenseCategories.filter(c => c.id !== cat.id);
          } else {
            this.incomeCategories = this.incomeCategories.filter(c => c.id !== cat.id);
          }
          this.showToast('分类已删除', 'success');
        }).catch(err => {
          this.showToast('删除失败: ' + err.message, 'error');
        });
      }
    },

    // ========== 交易管理 ==========
    async addTransaction() {
      if (this.txSubmitting) return;
      const f = this.txForm;

      if (!f.amount || f.amount <= 0) {
        this.showToast('请输入有效金额', 'error');
        return;
      }

      if (f.type === 'transfer') {
        if (!f.fromCardId || !f.toCardId) {
          this.showToast('请选择转出和转入卡片', 'error');
          return;
        }
        if (f.fromCardId === f.toCardId) {
          this.showToast('转出和转入卡片不能相同', 'error');
          return;
        }
      } else {
        if (!f.cardId) {
          this.showToast('请选择卡片', 'error');
          return;
        }
        if (!f.category) {
          this.showToast('请选择分类', 'error');
          return;
        }
      }

      const tx = {
        id: uid(),
        date: f.date,
        type: f.type,
        category: f.type === 'transfer' ? '转账' : f.category,
        description: f.description,
        amount: f.amount,
        cardId: f.type !== 'transfer' ? f.cardId : '',
        fromCardId: f.type === 'transfer' ? f.fromCardId : '',
        toCardId: f.type === 'transfer' ? f.toCardId : '',
        createdAt: Date.now(),
      };

      const affectedCards = this.getAffectedCards(tx);
      this.updateCardBalance(tx);

      this.txSubmitting = true;
      try {
        await this.persistTransaction(tx);
        await this.persistCards(affectedCards);
        this.transactions.push(tx);

        this.txForm = {
          type: f.type,
          date: new Date().toISOString().slice(0, 10),
          category: '',
          amount: null,
          cardId: '',
          fromCardId: '',
          toCardId: '',
          description: '',
        };

        this.showToast('记账成功', 'success');
        this.scheduleChartRender();
      } catch (err) {
        this.reverseCardBalance(tx);
        this.showToast('记账失败: ' + err.message, 'error');
      } finally {
        this.txSubmitting = false;
      }
    },

    getAffectedCards(tx) {
      const ids = new Set();
      if (tx.cardId) ids.add(tx.cardId);
      if (tx.fromCardId) ids.add(tx.fromCardId);
      if (tx.toCardId) ids.add(tx.toCardId);
      return this.cards.filter(c => ids.has(c.id));
    },

    updateCardBalance(tx) {
      if (tx.type === 'expense') {
        const card = this.cards.find(c => c.id === tx.cardId);
        if (card) {
          if (card.type === 'debit') {
            card.balance -= tx.amount;
          } else {
            card.balance -= tx.amount;
          }
        }
      } else if (tx.type === 'income') {
        const card = this.cards.find(c => c.id === tx.cardId);
        if (card) {
          card.balance += tx.amount;
        }
      } else if (tx.type === 'transfer') {
        const from = this.cards.find(c => c.id === tx.fromCardId);
        const to = this.cards.find(c => c.id === tx.toCardId);
        if (from) from.balance -= tx.amount;
        if (to) to.balance += tx.amount;
      }
    },

    reverseCardBalance(tx) {
      if (tx.type === 'expense') {
        const card = this.cards.find(c => c.id === tx.cardId);
        if (card) card.balance += tx.amount;
      } else if (tx.type === 'income') {
        const card = this.cards.find(c => c.id === tx.cardId);
        if (card) card.balance -= tx.amount;
      } else if (tx.type === 'transfer') {
        const from = this.cards.find(c => c.id === tx.fromCardId);
        const to = this.cards.find(c => c.id === tx.toCardId);
        if (from) from.balance += tx.amount;
        if (to) to.balance -= tx.amount;
      }
    },

    deleteTransaction(tx) {
      if (confirm('确定要删除这条记录吗？卡片余额将自动恢复。')) {
        const affectedCards = this.getAffectedCards(tx);
        this.reverseCardBalance(tx);
        FaStore.deleteTransaction(tx.id).then(async () => {
          await this.persistCards(affectedCards);
          this.transactions = this.transactions.filter(t => t.id !== tx.id);
          this.showToast('记录已删除', 'success');
        }).catch(err => {
          this.updateCardBalance(tx);
          this.showToast('删除失败: ' + err.message, 'error');
        });
      }
    },

    // ========== 数据导出 ==========
    exportCSV() {
      const txs = this.exportTransactions;
      if (txs.length === 0) return;

      const header = ['日期', '类型', '分类', '说明', '金额', '卡片/账户'];
      const rows = txs.map(tx => {
        const typeMap = { expense: '支出', income: '收入', transfer: '转账' };
        let cardInfo = '';
        if (tx.type === 'transfer') {
          cardInfo = `${this.getCardName(tx.fromCardId)} → ${this.getCardName(tx.toCardId)}`;
        } else {
          cardInfo = this.getCardName(tx.cardId);
        }
        return [
          tx.date,
          typeMap[tx.type],
          tx.category || '',
          tx.description || '',
          (tx.type === 'income' ? '' : '-') + tx.amount.toFixed(2),
          cardInfo,
        ];
      });

      const expenseTotal = txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
      const incomeTotal = txs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
      rows.push([]);
      rows.push(['汇总', '', '', '', '', '']);
      rows.push(['总支出', '', '', '', `-${expenseTotal.toFixed(2)}`, '']);
      rows.push(['总收入', '', '', '', `+${incomeTotal.toFixed(2)}`, '']);
      rows.push(['结余', '', '', '', (incomeTotal - expenseTotal).toFixed(2), '']);

      const BOM = '\uFEFF';
      const csv = BOM + [header, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const period = formatPeriodLabel(this.exportPeriodOffset, this.settings.payday).replace(/\s/g, '');
      a.download = `记账助手_${period}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      this.showToast('导出成功', 'success');
    },

    exportAllData() {
      const data = {
        cards: this.cards,
        transactions: this.transactions,
        expenseCategories: this.expenseCategories,
        incomeCategories: this.incomeCategories,
        settings: this.settings,
        exportDate: new Date().toISOString(),
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `记账助手_备份_${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      this.showToast('数据已导出', 'success');
    },

    importAllData(event) {
      const file = event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const data = JSON.parse(e.target.result);
          if (confirm('导入将覆盖当前所有数据，确定继续吗？')) {
            this.dataLoading = true;
            try {
              await FaStore.replaceAllData(this.user.id, {
                cards: data.cards || [],
                transactions: data.transactions || [],
                expenseCategories: data.expenseCategories || DEFAULT_EXPENSE_CATEGORIES,
                incomeCategories: data.incomeCategories || DEFAULT_INCOME_CATEGORIES,
                settings: data.settings || { payday: 10 },
              });
              await this.loadCloudData();
              this.showToast('数据导入成功', 'success');
            } catch (err) {
              this.showToast('导入失败: ' + err.message, 'error');
            } finally {
              this.dataLoading = false;
            }
          }
        } catch {
          this.showToast('文件格式错误', 'error');
        }
      };
      reader.readAsText(file);
      event.target.value = '';
    },

    confirmClearData() {
      if (confirm('确定要清空所有数据吗？此操作不可恢复！建议先导出备份。')) {
        if (confirm('再次确认：清空后所有卡片和交易记录都将丢失。')) {
          const expense = DEFAULT_EXPENSE_CATEGORIES.map(c => ({ ...c, id: uid() }));
          const income = DEFAULT_INCOME_CATEGORIES.map(c => ({ ...c, id: uid() }));
          this.dataLoading = true;
          FaStore.clearAllData(this.user.id, expense, income).then(async () => {
            this.cards = [];
            this.transactions = [];
            this.expenseCategories = expense;
            this.incomeCategories = income;
            this.settings = { payday: 10 };
            this.showToast('所有数据已清空', 'success');
            this.scheduleChartRender();
          }).catch(err => {
            this.showToast('清空失败: ' + err.message, 'error');
          }).finally(() => {
            this.dataLoading = false;
          });
        }
      }
    },

    // ========== 图表 ==========
    scheduleChartRender() {
      this._chartRenderGen += 1;
      const generation = this._chartRenderGen;
      nextTick(() => {
        if (generation !== this._chartRenderGen) return;
        this.renderCurrentCharts();
      });
    },

    destroyChart(id) {
      const canvas = document.getElementById(id);
      if (canvas) {
        const existing = Chart.getChart(canvas);
        if (existing) {
          existing.stop();
          existing.destroy();
        }
      }
      delete this.chartInstances[id];
    },

    destroyAnalyticsCharts() {
      ANALYTICS_CHART_IDS.forEach(id => this.destroyChart(id));
    },

    createChart(canvasId, config) {
      const canvas = document.getElementById(canvasId);
      if (!canvas) return null;
      this.destroyChart(canvasId);
      try {
        const chart = new Chart(canvas.getContext('2d'), config);
        this.chartInstances[canvasId] = chart;
        return chart;
      } catch (err) {
        console.error(`图表渲染失败 (${canvasId}):`, err);
        return null;
      }
    },

    upsertChart(canvasId, config) {
      const canvas = document.getElementById(canvasId);
      if (!canvas) return null;

      const existing = Chart.getChart(canvas);
      if (existing && existing.config.type === config.type) {
        try {
          existing.stop();
          existing.data.labels = config.data.labels;
          existing.data.datasets = config.data.datasets.map(ds => ({ ...ds }));
          existing.update('none');
          this.chartInstances[canvasId] = existing;
          return existing;
        } catch (err) {
          console.error(`图表更新失败 (${canvasId}):`, err);
          this.destroyChart(canvasId);
        }
      }

      return this.createChart(canvasId, config);
    },

    renderCurrentCharts() {
      if (this.currentView === 'dashboard') {
        this.renderDashboardCharts();
      } else if (this.currentView === 'analytics') {
        this.renderAnalyticsCharts();
      }
    },

    renderDashboardCharts() {
      this.renderDashTrend();
      this.renderDashCategory();
    },

    renderDashTrend() {
      const txs = this.currentPeriodTransactions.filter(t => t.type === 'expense');
      const dailyMap = {};
      txs.forEach(tx => {
        const key = tx.date;
        dailyMap[key] = (dailyMap[key] || 0) + tx.amount;
      });

      const { start, end } = this.currentPeriod;
      const labels = [];
      const data = [];
      const d = new Date(start);
      const today = new Date();
      while (d < end && d <= today) {
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        labels.push(`${d.getMonth()+1}/${d.getDate()}`);
        data.push(dailyMap[key] || 0);
        d.setDate(d.getDate() + 1);
      }

      this.createChart('dashTrendChart', {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: '每日支出',
            data,
            borderColor: '#EF4444',
            backgroundColor: 'rgba(239,68,68,0.1)',
            fill: true,
            tension: 0.4,
            pointRadius: 2,
            pointHoverRadius: 5,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { display: false } },
            y: { beginAtZero: true, grid: { color: '#F3F4F6' } },
          },
        },
      });
    },

    getDoughnutColors(canvasId, count) {
      let selected = this.selectedDoughnutIndex[canvasId];
      if (selected != null && selected >= count) {
        this.selectedDoughnutIndex[canvasId] = null;
        selected = null;
      }
      const base = CHART_CATEGORY_COLORS.slice(0, count);
      if (selected == null) return base;
      // 未选中的扇区降至 35% 不透明度，选中扇区保持原色
      return base.map((color, i) => (i === selected ? color : color + '59'));
    },

    buildDoughnutConfig(canvasId, labels, values) {
      const count = values.length;
      // 若分类标签发生变化，重置选中高亮和图例隐藏状态
      const prevData = this.doughnutChartData[canvasId];
      if (!prevData || JSON.stringify(prevData.labels) !== JSON.stringify(labels)) {
        this.selectedDoughnutIndex[canvasId] = null;
        this.hiddenDoughnutIndices[canvasId] = [];
      }
      // 存储图表数据供模板响应式展示
      this.doughnutChartData[canvasId] = { labels: [...labels], values: [...values] };
      return {
        type: 'doughnut',
        data: {
          labels,
          datasets: [{
            data: values,
            backgroundColor: this.getDoughnutColors(canvasId, count),
            borderColor: '#FFFFFF',
            borderWidth: 2,
            hoverBorderColor: '#FFFFFF',
            hoverBorderWidth: 3,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          aspectRatio: 2,
          cutout: '55%',
          layout: { padding: 24 },
          onClick: (_event, elements, chart) => {
            if (!elements.length) {
              this.selectedDoughnutIndex[canvasId] = null;
              chart.data.datasets[0].backgroundColor = this.getDoughnutColors(canvasId, chart.data.datasets[0].data.length);
              chart.update('none');
              return;
            }
            const index = elements[0].index;
            const current = this.selectedDoughnutIndex[canvasId];
            this.selectedDoughnutIndex[canvasId] = current === index ? null : index;
            chart.data.datasets[0].backgroundColor = this.getDoughnutColors(canvasId, chart.data.datasets[0].data.length);
            chart.update('none');
          },
          plugins: {
            legend: {
              position: 'right',
              labels: { boxWidth: 12, padding: 12, font: { size: 12 } },
              onClick: (e, legendItem, legend) => {
                const chart = legend.chart;
                const index = legendItem.index;
                // 圆环/饼图须按数据点索引切换可见性，不可用默认的数据集隐藏逻辑
                chart.toggleDataVisibility(index);
                chart.update('none');
                // 同步更新 Vue 中追踪的隐藏索引列表
                const hidden = [];
                for (let i = 0; i < (chart.data.labels?.length || 0); i++) {
                  if (!chart.getDataVisibility(i)) hidden.push(i);
                }
                this.hiddenDoughnutIndices[canvasId] = [...hidden];
              },
            },
          },
          elements: {
            arc: { hoverOffset: 22 },
          },
        },
      };
    },

    renderDashCategory() {
      const txs = this.currentPeriodTransactions.filter(t => t.type === 'expense');
      const catMap = {};
      txs.forEach(tx => {
        catMap[tx.category] = (catMap[tx.category] || 0) + tx.amount;
      });

      const cats = Object.entries(catMap).sort((a, b) => b[1] - a[1]);
      this.createChart('dashCategoryChart', this.buildDoughnutConfig(
        'dashCategoryChart',
        cats.map(c => c[0]),
        cats.map(c => c[1]),
      ));
    },

    renderAnalyticsCharts() {
      this.renderDailyTrend();
      this.renderCategoryPie();
      this.renderMonthlyCompare();
      this.renderSpendingLine();
      this.renderQualityTrend();
    },

    renderDailyTrend() {
      const { start, end } = getBillingPeriod(this.analyticsPeriodOffset, this.settings.payday);
      const txs = this.analyticsPeriodTransactions.filter(t => t.type === 'expense');
      const dailyMap = {};
      txs.forEach(tx => { dailyMap[tx.date] = (dailyMap[tx.date] || 0) + tx.amount; });

      const labels = [];
      const data = [];
      const d = new Date(start);
      const today = new Date();
      const limit = this.analyticsPeriodOffset < 0 ? end : (today < end ? today : end);
      while (d < limit) {
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        labels.push(`${d.getMonth()+1}/${d.getDate()}`);
        data.push(dailyMap[key] || 0);
        d.setDate(d.getDate() + 1);
      }

      this.upsertChart('dailyTrendChart', {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: '每日支出',
            data,
            backgroundColor: 'rgba(79,70,229,0.7)',
            borderRadius: 4,
          }],
        },
        options: {
          responsive: true,
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { display: false } },
            y: { beginAtZero: true, grid: { color: '#F3F4F6' } },
          },
        },
      });
    },

    renderCategoryPie() {
      const txs = this.analyticsPeriodTransactions.filter(t => t.type === 'expense');
      const catMap = {};
      txs.forEach(tx => { catMap[tx.category] = (catMap[tx.category] || 0) + tx.amount; });
      const cats = Object.entries(catMap).sort((a, b) => b[1] - a[1]);

      // 重置隐藏状态，确保切换月份后图例全部恢复显示
      this.hiddenDoughnutIndices['categoryPieChart'] = [];

      const chart = this.upsertChart('categoryPieChart', this.buildDoughnutConfig(
        'categoryPieChart',
        cats.map(c => c[0]),
        cats.map(c => c[1]),
      ));

      // 重置 Chart.js 内部每个数据点的可见性
      if (chart) {
        const count = chart.data.labels?.length || 0;
        let needUpdate = false;
        for (let i = 0; i < count; i++) {
          if (!chart.getDataVisibility(i)) {
            chart.toggleDataVisibility(i);
            needUpdate = true;
          }
        }
        if (needUpdate) chart.update('none');
      }
    },

    visibleDoughnutTotal(canvasId) {
      const data = this.doughnutChartData[canvasId];
      if (!data) return 0;
      const hidden = this.hiddenDoughnutIndices[canvasId] || [];
      return data.values.reduce((sum, v, i) => (hidden.includes(i) ? sum : sum + v), 0);
    },

    renderMonthlyCompare() {
      const labels = [];
      const expData = [];
      const incData = [];

      for (let i = -5; i <= 0; i++) {
        const offset = this.analyticsPeriodOffset + i;
        const { start, end } = getBillingPeriod(offset, this.settings.payday);
        labels.push(`${start.getMonth()+1}月`);

        const periodTxs = this.transactions.filter(tx => {
          const d = new Date(tx.date);
          return d >= start && d < end;
        });

        expData.push(periodTxs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0));
        incData.push(periodTxs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0));
      }

      this.upsertChart('monthlyCompareChart', {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label: '支出', data: expData, backgroundColor: 'rgba(239,68,68,0.7)', borderRadius: 4 },
            { label: '收入', data: incData, backgroundColor: 'rgba(16,185,129,0.7)', borderRadius: 4 },
          ],
        },
        options: {
          responsive: true,
          plugins: { legend: { labels: { boxWidth: 12 } } },
          scales: {
            x: { grid: { display: false } },
            y: { beginAtZero: true, grid: { color: '#F3F4F6' } },
          },
        },
      });
    },

    renderSpendingLine() {
      const labels = [];
      const data = [];

      for (let i = -5; i <= 0; i++) {
        const offset = this.analyticsPeriodOffset + i;
        const { start, end } = getBillingPeriod(offset, this.settings.payday);
        labels.push(`${start.getMonth()+1}月`);

        const total = this.transactions
          .filter(tx => {
            const d = new Date(tx.date);
            return d >= start && d < end && tx.type === 'expense';
          })
          .reduce((s, t) => s + t.amount, 0);
        data.push(total);
      }

      this.upsertChart('spendingLineChart', {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: '月度消费',
            data,
            borderColor: '#F59E0B',
            backgroundColor: 'rgba(245,158,11,0.1)',
            fill: true,
            tension: 0.4,
            pointRadius: 4,
            pointHoverRadius: 6,
          }],
        },
        options: {
          responsive: true,
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { display: false } },
            y: { beginAtZero: true, grid: { color: '#F3F4F6' } },
          },
        },
      });
    },

    renderQualityTrend() {
      const labels = [];
      const engelData = [];
      const savingsData = [];
      const scoreData = [];

      for (let i = -5; i <= 0; i++) {
        const offset = this.analyticsPeriodOffset + i;
        const { start, end } = getBillingPeriod(offset, this.settings.payday);
        labels.push(`${start.getMonth()+1}月`);

        const periodTxs = this.transactions.filter(tx => {
          const d = new Date(tx.date);
          return d >= start && d < end;
        });

        const expenses = periodTxs.filter(t => t.type === 'expense');
        const totalExp = expenses.reduce((s, t) => s + t.amount, 0);
        const foodExp = expenses.filter(t => t.category === '餐饮').reduce((s, t) => s + t.amount, 0);
        const totalInc = periodTxs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);

        const engel = totalExp > 0 ? Math.round((foodExp / totalExp) * 100) : 0;
        const savings = totalInc > 0 ? Math.round(((totalInc - totalExp) / totalInc) * 100) : 0;

        let score = 50;
        if (engel > 0) {
          if (engel <= 20) score += 25;
          else if (engel <= 30) score += 20;
          else if (engel <= 40) score += 10;
          else if (engel <= 50) score += 0;
          else score -= 10;
        }
        if (savings >= 50) score += 20;
        else if (savings >= 30) score += 15;
        else if (savings >= 10) score += 5;
        else if (savings >= 0) score += 0;
        else score -= 10;
        score = Math.max(0, Math.min(100, score));

        engelData.push(engel);
        savingsData.push(Math.max(0, savings));
        scoreData.push(score);
      }

      this.upsertChart('qualityTrendChart', {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: '恩格尔系数(%)',
              data: engelData,
              borderColor: '#EF4444',
              backgroundColor: 'transparent',
              tension: 0.4,
              pointRadius: 4,
            },
            {
              label: '储蓄率(%)',
              data: savingsData,
              borderColor: '#10B981',
              backgroundColor: 'transparent',
              tension: 0.4,
              pointRadius: 4,
            },
            {
              label: '综合评分',
              data: scoreData,
              borderColor: '#4F46E5',
              backgroundColor: 'rgba(79,70,229,0.05)',
              fill: true,
              tension: 0.4,
              pointRadius: 4,
            },
          ],
        },
        options: {
          responsive: true,
          plugins: { legend: { labels: { boxWidth: 12 } } },
          scales: {
            x: { grid: { display: false } },
            y: { min: 0, max: 100, grid: { color: '#F3F4F6' } },
          },
        },
      });
    },
  },
});

app.mount('#app');
