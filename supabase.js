const FaStore = (() => {
  let client = null;

  function getClient() {
    if (client) return client;
    const url = window.SUPABASE_URL;
    const key = window.SUPABASE_ANON_KEY;
    if (!url || !key || url.includes('你的项目')) {
      throw new Error('请配置 config.js（参考 config.example.js）');
    }
    client = window.supabase.createClient(url, key);
    return client;
  }

  function isConfigured() {
    const url = window.SUPABASE_URL;
    const key = window.SUPABASE_ANON_KEY;
    return url && key && !url.includes('你的项目');
  }

  function rowToCard(r) {
    return {
      id: r.id,
      name: r.name,
      type: r.type,
      balance: Number(r.balance),
      creditLimit: Number(r.credit_limit),
      color: r.color,
      createdAt: Number(r.created_at),
    };
  }

  function cardToRow(card, userId) {
    return {
      id: card.id,
      user_id: userId,
      name: card.name,
      type: card.type,
      balance: card.balance,
      credit_limit: card.creditLimit || 0,
      color: card.color,
      created_at: card.createdAt,
    };
  }

  function rowToTransaction(r) {
    return {
      id: r.id,
      date: r.date,
      type: r.type,
      category: r.category || '',
      description: r.description || '',
      amount: Number(r.amount),
      cardId: r.card_id || '',
      fromCardId: r.from_card_id || '',
      toCardId: r.to_card_id || '',
      createdAt: Number(r.created_at),
    };
  }

  function txToRow(tx, userId) {
    return {
      id: tx.id,
      user_id: userId,
      date: tx.date,
      type: tx.type,
      category: tx.category || '',
      description: tx.description || '',
      amount: tx.amount,
      card_id: tx.cardId || '',
      from_card_id: tx.fromCardId || '',
      to_card_id: tx.toCardId || '',
      created_at: tx.createdAt,
    };
  }

  function rowToCategory(r) {
    return { id: r.id, name: r.name, icon: r.icon, type: r.type };
  }

  function catToRow(cat, userId) {
    return { id: cat.id, user_id: userId, name: cat.name, icon: cat.icon, type: cat.type };
  }

  async function signUp(email, password) {
    const { data, error } = await getClient().auth.signUp({ email, password });
    if (error) throw error;
    return data;
  }

  async function signIn(email, password) {
    const { data, error } = await getClient().auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async function signOut() {
    const { error } = await getClient().auth.signOut();
    if (error) throw error;
  }

  async function getSession() {
    const { data, error } = await getClient().auth.getSession();
    if (error) throw error;
    return data.session;
  }

  function onAuthStateChange(callback) {
    return getClient().auth.onAuthStateChange((_event, session) => callback(session));
  }

  async function loadAll(userId) {
    const sb = getClient();
    const [cardsRes, txRes, catRes, settingsRes] = await Promise.all([
      sb.from('cards').select('*').eq('user_id', userId),
      sb.from('transactions').select('*').eq('user_id', userId),
      sb.from('categories').select('*').eq('user_id', userId),
      sb.from('user_settings').select('*').eq('user_id', userId).maybeSingle(),
    ]);

    if (cardsRes.error) throw cardsRes.error;
    if (txRes.error) throw txRes.error;
    if (catRes.error) throw catRes.error;
    if (settingsRes.error) throw settingsRes.error;

    const categories = (catRes.data || []).map(rowToCategory);
    return {
      cards: (cardsRes.data || []).map(rowToCard),
      transactions: (txRes.data || []).map(rowToTransaction),
      expenseCategories: categories.filter(c => c.type === 'expense'),
      incomeCategories: categories.filter(c => c.type === 'income'),
      settings: settingsRes.data ? { payday: settingsRes.data.payday } : null,
    };
  }

  async function upsertCard(card, userId) {
    const { error } = await getClient().from('cards').upsert(cardToRow(card, userId));
    if (error) throw error;
  }

  async function deleteCard(id) {
    const { error } = await getClient().from('cards').delete().eq('id', id);
    if (error) throw error;
  }

  async function upsertTransaction(tx, userId) {
    const { error } = await getClient().from('transactions').upsert(txToRow(tx, userId));
    if (error) throw error;
  }

  async function deleteTransaction(id) {
    const { error } = await getClient().from('transactions').delete().eq('id', id);
    if (error) throw error;
  }

  async function upsertCategory(cat, userId) {
    const { error } = await getClient().from('categories').upsert(catToRow(cat, userId));
    if (error) throw error;
  }

  async function deleteCategory(id) {
    const { error } = await getClient().from('categories').delete().eq('id', id);
    if (error) throw error;
  }

  async function upsertSettings(settings, userId) {
    const { error } = await getClient().from('user_settings').upsert({
      user_id: userId,
      payday: settings.payday,
    });
    if (error) throw error;
  }

  async function seedDefaults(userId, expenseCategories, incomeCategories) {
    const sb = getClient();

    // 先检查是否已有分类，有则跳过，防止重复插入
    const { data: existing } = await sb.from('categories').select('id').eq('user_id', userId).limit(1);
    if (!existing || existing.length === 0) {
      const cats = [
        ...expenseCategories.map(c => catToRow(c, userId)),
        ...incomeCategories.map(c => catToRow(c, userId)),
      ];
      const { error: catErr } = await sb.from('categories').insert(cats);
      if (catErr) throw catErr;
    }

    const { error: setErr } = await sb.from('user_settings').upsert({ user_id: userId, payday: 10 });
    if (setErr) throw setErr;
  }

  async function replaceAllData(userId, data) {
    const sb = getClient();
    await sb.from('transactions').delete().eq('user_id', userId);
    await sb.from('cards').delete().eq('user_id', userId);
    await sb.from('categories').delete().eq('user_id', userId);
    await sb.from('user_settings').delete().eq('user_id', userId);

    if (data.cards?.length) {
      const { error } = await sb.from('cards').insert(data.cards.map(c => cardToRow(c, userId)));
      if (error) throw error;
    }
    if (data.transactions?.length) {
      const { error } = await sb.from('transactions').insert(
        data.transactions.map(t => txToRow(t, userId))
      );
      if (error) throw error;
    }
    const cats = [
      ...(data.expenseCategories || []).map(c => catToRow(c, userId)),
      ...(data.incomeCategories || []).map(c => catToRow(c, userId)),
    ];
    if (cats.length) {
      const { error } = await sb.from('categories').insert(cats);
      if (error) throw error;
    }
    const { error: setErr } = await sb.from('user_settings').upsert({
      user_id: userId,
      payday: data.settings?.payday ?? 10,
    });
    if (setErr) throw setErr;
  }

  async function clearAllData(userId, expenseCategories, incomeCategories) {
    await replaceAllData(userId, {
      cards: [],
      transactions: [],
      expenseCategories,
      incomeCategories,
      settings: { payday: 10 },
    });
  }

  return {
    isConfigured,
    getClient,
    signUp,
    signIn,
    signOut,
    getSession,
    onAuthStateChange,
    loadAll,
    upsertCard,
    deleteCard,
    upsertTransaction,
    deleteTransaction,
    upsertCategory,
    deleteCategory,
    upsertSettings,
    seedDefaults,
    replaceAllData,
    clearAllData,
  };
})();
